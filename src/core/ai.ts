// 한 줄 목적: 전략 분석·역할 배정·전투 평가·생산 판단을 수행하는 난이도별 AI 턴 실행기
import { tileAt, unitAt, unitById, unitsOf } from './board';
import {
  issueCommand,
  type CommandExecutionResult,
  type GameCommand,
  type GameCommandPayload,
  type GameEvent,
} from './command';
import { MAX_UNITS_PER_FACTION, UNIT_STATS } from './data';
import { forecastAttack, terrainDefBonus, unitCost, unitRange } from './game';
import { hexDistance, hexKey, neighbors } from './hex';
import { movementRange } from './pathfind';
import { crownStatus } from './scenario/crown-status';
import { holdVictoryCondition } from './scenario/objectives';
import type { VictoryCondition } from './scenario/types';
import type {
  Axial,
  Difficulty,
  FactionId,
  GameState,
  Tile,
  Unit,
  UnitTypeId,
} from './types';
import { isUniqueUnit, producibleUnits } from './units';

/** AI 턴 실행 결과: 발행한 정본 명령(리플레이 기록용)과 연출용 정본 이벤트. */
export interface AiTurnResult {
  commands: GameCommand[];
  events: GameEvent[];
}

/** 명령 발행 함수: 성공한 명령·이벤트는 턴 결과에 자동 수집된다. */
type IssueFn = (payload: GameCommandPayload) => CommandExecutionResult;

/** 난이도별 의사결정 프로파일. 자원 치트는 없다 — 판단 수준만 다르다. */
interface AiProfile {
  /** 이동 후 공격 위치 최적화 */
  moveAttack: boolean;
  /** 반격 피해·사망 위험을 점수에 반영 */
  counterAware: boolean;
  /** 처치 못 하면서 자신이 죽는 교환 회피 */
  avoidBadTrades: boolean;
  /** 수도 위협 시 방어 역할 배정 */
  defend: boolean;
  /** 부상당한 적 집중 공격 가중치 강화(어려움) */
  focusFire: boolean;
  /** 공격 위치 선정 시 지형 방어 선호 */
  seekTerrain: boolean;
  /** 목표 탐색 지평(이 거리보다 먼 목표는 보지 못한다). 없으면 전장 전체 */
  horizon?: number;
  production: 'cycle' | 'balanced' | 'adaptive';
  /**
   * 적 왕관 임박 저지 가치 가산(hard 전용).
   * 자신이 이길 수 없어도 상대 즉시 승리를 막는 행동을 우선한다.
   */
  crownDenyBonus: number;
  /** 처치 성공 시 기본 가산 */
  killBonusBase: number;
  /** 처치 시 적 가치 배율 */
  killValueScale: number;
  /** 부상당한 적(잃은 HP) 가중 계수 */
  woundedWeight: number;
  /** 반격 피해 감점 계수(counterAware일 때만) */
  counterWeight: number;
  /** 반격 사망 시 감점 배율 */
  suicidePenaltyScale: number;
  /**
   * 같은 라운드(동일 turn)에 이미 맞은 적에 대한 집중 감쇠 계수.
   * 인간/AI 구분 없이 적용 — controller 라벨을 읽지 않는다.
   */
  multiHitDampening: number;
  /**
   * 최고 점수 대비 이 폭 안의 후보 중 위협·거리 2차 기준으로 결정론 선택.
   * 0이면 순수 최고 점수만 고른다.
   */
  softCandidateBand: number;
  /** 전진 목표로 부상당한 적을 쫓는 가중 */
  chaseWoundedWeight: number;
}

const PROFILES: Record<Difficulty, AiProfile> = {
  easy: {
    moveAttack: false,
    counterAware: false,
    avoidBadTrades: false,
    defend: false,
    focusFire: false,
    seekTerrain: false,
    horizon: 3,
    production: 'cycle',
    crownDenyBonus: 0,
    killBonusBase: 18,
    killValueScale: 1.5,
    woundedWeight: 0.15,
    counterWeight: 0,
    suicidePenaltyScale: 0,
    multiHitDampening: 0,
    softCandidateBand: 0,
    chaseWoundedWeight: 1,
  },
  normal: {
    moveAttack: true,
    counterAware: true,
    avoidBadTrades: false,
    defend: true,
    focusFire: false,
    seekTerrain: false,
    production: 'balanced',
    crownDenyBonus: 0,
    // 보통: 처치·부상 집결을 완화해 hard와의 난이도 계단을 확보한다
    killBonusBase: 8,
    killValueScale: 0.8,
    woundedWeight: 0.05,
    counterWeight: 0.3,
    suicidePenaltyScale: 2,
    multiHitDampening: 28,
    softCandidateBand: 10,
    chaseWoundedWeight: 0.3,
  },
  hard: {
    moveAttack: true,
    counterAware: true,
    avoidBadTrades: true,
    defend: true,
    focusFire: true,
    seekTerrain: true,
    production: 'adaptive',
    crownDenyBonus: 250,
    killBonusBase: 45,
    killValueScale: 2.8,
    woundedWeight: 1.0,
    counterWeight: 0.95,
    suicidePenaltyScale: 3.5,
    multiHitDampening: 0,
    softCandidateBand: 0,
    chaseWoundedWeight: 3.2,
  },
};

type Role = 'defend' | 'garrison' | 'attack' | 'protect' | 'hold';

interface Objective {
  q: number;
  r: number;
  value: number;
  claimed: number;
}

interface Analysis {
  enemies: Unit[];
  myCapital: Tile | null;
  capitalThreats: Unit[];
  crownTile: Tile | null;
  /** hold-building 승리 조건이 있는 시나리오(왕관의 심장 등) */
  crownScenario: boolean;
  /** conquest 승리 조건이 있는 정복형 시나리오 */
  conquestScenario: boolean;
  crownOwner: FactionId | null;
  crownActive: boolean;
  crownHeldTurns: number;
  crownNeed: number;
  /** 적 왕관 임박(다음 라운드 승리 가능) — 저지 최우선 */
  crownDenyImminent: boolean;
  objectives: Objective[];
  /** 사망이 패배(또는 생존이 승리 필수)인 유닛 태그 — 보호 역할을 받는다 */
  protectedTags: Set<string>;
  /** 상실이 패배인 아군 거점 — 사수 역할을 받는다 */
  holdTiles: Tile[];
  turnsLeft: number;
}

function flattenVictory(conditions: VictoryCondition[]): VictoryCondition[] {
  const out: VictoryCondition[] = [];
  for (const c of conditions) {
    if (c.type === 'all-of' || c.type === 'any-of') out.push(...flattenVictory(c.conditions));
    else out.push(c);
  }
  return out;
}

/** AI 세력 하나의 턴을 명령 실행기 경유로 실행하고 명령·이벤트를 반환한다(END_PHASE 포함).
 *  difficultyOverride는 밸런스 시뮬레이션에서 세력별 난이도를 달리할 때 쓴다. */
export function runAiTurn(
  state: GameState,
  faction: FactionId,
  difficultyOverride?: Difficulty,
): AiTurnResult {
  const commands: GameCommand[] = [];
  const events: GameEvent[] = [];
  const issue: IssueFn = (payload) => {
    const r = issueCommand(state, payload, 'ai');
    if (r.ok) {
      commands.push(r.command);
      events.push(...r.events);
    }
    return r;
  };
  // 자기 차례가 아니면 아무 명령도 발행하지 않는다(호출자 오류 방어)
  if (state.over || faction !== state.current) return { commands, events };
  if (state.factions[faction].eliminated) {
    issue({ type: 'end-phase' });
    return { commands, events };
  }
  const profile = PROFILES[difficultyOverride ?? state.config.difficulty] ?? PROFILES.normal;

  const analysis = analyze(state, faction, profile);
  const { roles, holdTargets } = assignRoles(state, faction, analysis, profile);

  const unitIds = unitsOf(state, faction).map((u) => u.id);
  for (const uid of unitIds) {
    const unit = unitById(state, uid);
    if (!unit || state.over) break;
    actUnit(state, unit, roles.get(uid) ?? 'attack', analysis, profile, issue, holdTargets.get(uid));
  }
  if (!state.over) produceUnits(state, faction, analysis, profile, issue);
  if (!state.over) issue({ type: 'end-phase' });
  return { commands, events };
}

// ---------------- 8.1 전략 상태 분석 ----------------

function analyze(state: GameState, faction: FactionId, profile: AiProfile): Analysis {
  const enemies = state.units.filter((u) => u.faction !== faction);
  const myCapital =
    state.tiles.find((t) => t.building === 'capital' && t.owner === faction) ?? null;
  // 위협: 다음 턴에 수도 사거리에 닿을 수 있는 적(이동력+사거리 근사)
  const capitalThreats = myCapital
    ? enemies.filter(
        (e) => hexDistance(e, myCapital) <= UNIT_STATS[e.type].move + unitRange(e),
      )
    : [];
  const hold = holdVictoryCondition(state);
  const cs = crownStatus(state);
  const crownTile = hold
    ? (tileAt(state, hold.at.q, hold.at.r) ?? null)
    : (state.tiles.find((t) => t.building === 'crown') ?? null);
  const isCrownScenario = hold !== null;
  const crownOwner = cs?.owner ?? null;
  const crownActive = cs?.active ?? false;
  const crownHeldTurns = cs?.heldTurns ?? 0;
  const crownNeed = cs?.needTurns ?? 0;
  const enemyHoldsCrown =
    isCrownScenario && crownActive && crownOwner !== null && crownOwner !== faction;
  const crownDenyImminent = enemyHoldsCrown && crownHeldTurns >= crownNeed - 1;

  // 왕관 목표 가치: 활성 전 110 / 활성 후 160 / 적 보유 시 상향 / 임박 시 최우선
  let crownObjValue = isCrownScenario ? (crownActive ? 160 : 110) : 70;
  if (enemyHoldsCrown) {
    crownObjValue = crownDenyImminent ? 500 : 280;
    crownObjValue += profile.crownDenyBonus;
  }

  const turnsLeft = Math.max(0, state.maxTurns - state.turn + 1);
  const hasConquest = flattenVictory(state.objectives.victory).some((c) => c.type === 'conquest');
  // 정복 시나리오만 수도 우선·마을 억제(턴 제한 점수전 ≤70%). 수비·캠페인은 기존 가치 유지.
  let capitalBase: number;
  if (crownDenyImminent) capitalBase = 90;
  else if (hasConquest) {
    capitalBase = turnsLeft <= 4 ? 240 : turnsLeft <= 7 ? 200 : turnsLeft <= 9 ? 170 : 150;
  } else {
    capitalBase = 100;
  }
  const villageBase = hasConquest
    ? turnsLeft <= 6
      ? 16
      : turnsLeft <= 9
        ? 26
        : 36
    : 50;

  const objectives: Objective[] = [];
  for (const t of state.tiles) {
    if (!t.building || t.owner === faction) continue;
    const value =
      t.building === 'crown'
        ? crownObjValue
        : t.building === 'capital'
          ? capitalBase
          : villageBase;
    objectives.push({ q: t.q, r: t.r, value, claimed: 0 });
  }

  // 적 왕관 저지: 인접 타일로 이동해 경합(카운트 정지) — 거점이 아닌 좌표도 목표로 추가
  if (enemyHoldsCrown && crownTile) {
    const adjValue = crownDenyImminent
      ? 420 + profile.crownDenyBonus
      : 220 + Math.floor(profile.crownDenyBonus / 2);
    for (const n of neighbors(crownTile)) {
      const nt = tileAt(state, n.q, n.r);
      if (!nt || nt.terrain === 'water') continue;
      if (nt.owner === faction && nt.building) continue;
      const existing = objectives.find((o) => o.q === n.q && o.r === n.r);
      if (existing) existing.value = Math.max(existing.value, adjValue);
      else objectives.push({ q: n.q, r: n.r, value: adjValue, claimed: 0 });
    }
  }

  // 목표 인식 계층: 승패 조건이 이 세력(인간 세력) 기준이면 미션 목표를 가중치·보호 대상에 반영한다
  const protectedTags = new Set<string>();
  if (state.config.humanFaction === faction) {
    for (const c of flattenVictory(state.objectives.victory)) {
      if (c.type === 'capture-building' || c.type === 'hold-building') {
        const o = objectives.find((x) => x.q === c.at.q && x.r === c.at.r);
        if (o) o.value = Math.max(o.value, 180);
      } else if (c.type === 'capture-count') {
        for (const o of objectives) {
          const t = tileAt(state, o.q, o.r);
          if (t?.building === c.building) o.value = Math.max(o.value, 130);
        }
      } else if (c.type === 'unit-alive') {
        protectedTags.add(c.tag);
      }
    }
    for (const c of state.objectives.defeat) {
      if (c.type === 'unit-dies') protectedTags.add(c.tag);
    }
  }
  const holdTiles: Tile[] = [];
  if (state.config.humanFaction === faction) {
    for (const c of state.objectives.defeat) {
      if (c.type === 'lose-building') {
        const t = tileAt(state, c.at.q, c.at.r);
        if (t && t.owner === faction) holdTiles.push(t);
      }
    }
  }

  return {
    enemies,
    myCapital,
    capitalThreats,
    crownTile,
    crownScenario: isCrownScenario,
    conquestScenario: hasConquest,
    crownOwner,
    crownActive,
    crownHeldTurns,
    crownNeed,
    crownDenyImminent,
    objectives,
    protectedTags,
    holdTiles,
    turnsLeft: state.maxTurns - state.turn,
  };
}

// ---------------- 8.2 전선과 목표 할당 ----------------

function assignRoles(
  state: GameState,
  faction: FactionId,
  an: Analysis,
  profile: AiProfile,
): { roles: Map<number, Role>; holdTargets: Map<number, Tile> } {
  const roles = new Map<number, Role>();
  const holdTargets = new Map<number, Tile>();
  const units = unitsOf(state, faction);

  // 보호 대상 유닛(사망 = 패배)은 항상 보호 역할이 최우선이다
  for (const u of units) {
    if (u.tag !== undefined && an.protectedTags.has(u.tag)) roles.set(u.id, 'protect');
  }

  // 상실 = 패배인 거점 사수: 위에 선 유닛은 고정하고, 비어 있으면 가장 가까운 유닛을 보낸다
  for (const t of an.holdTiles) {
    const occupant = units.find((u) => u.q === t.q && u.r === t.r);
    if (occupant) {
      if (!roles.has(occupant.id)) {
        roles.set(occupant.id, 'hold');
        holdTargets.set(occupant.id, t);
      }
      continue;
    }
    if (!unitAt(state, t.q, t.r)) {
      const candidate = units
        .filter((u) => !roles.has(u.id))
        .sort((a, b) => hexDistance(a, t) - hexDistance(b, t))[0];
      if (candidate) {
        roles.set(candidate.id, 'hold');
        holdTargets.set(candidate.id, t);
      }
    }
  }

  if (profile.defend && an.myCapital && an.capitalThreats.length > 0) {
    const cap = an.myCapital;
    // 초반 위협: 방어 인원을 넉넉히 두어 4턴 이하 전멸·수도 상실을 줄인다
    const need = Math.min(
      state.turn <= 4 ? 3 : 2,
      Math.max(1, an.capitalThreats.length),
    );
    // 수호대를 수도 방어에 우선 배정
    const defenders = units
      .filter((u) => !roles.has(u.id))
      .sort((a, b) => {
        const typeBias = (u: Unit) => (u.type === 'guardian' ? -2 : 0);
        return typeBias(a) - typeBias(b) || hexDistance(a, cap) - hexDistance(b, cap);
      })
      .slice(0, need);
    for (const d of defenders) roles.set(d.id, 'defend');
  }

  // 거점 위 수호대는 주둔(수호 태세 유지) — 불필요한 이탈 방지
  for (const u of units) {
    if (roles.has(u.id) || u.type !== 'guardian') continue;
    const tile = tileAt(state, u.q, u.r);
    if (tile?.building && tile.owner === faction) {
      roles.set(u.id, 'hold');
      holdTargets.set(u.id, tile);
    }
  }

  // 왕관 요새를 소유 중이면(활성화 후) 비어 있는 요새에 수비대를 보낸다
  if (
    an.crownTile &&
    an.crownTile.owner === faction &&
    an.crownScenario &&
    an.crownActive &&
    !unitAt(state, an.crownTile.q, an.crownTile.r)
  ) {
    const crown = an.crownTile;
    const candidate = units
      .filter((u) => !roles.has(u.id))
      .sort((a, b) => {
        const typeBias = (u: Unit) => (u.type === 'guardian' ? -2 : u.type === 'raider' ? 1 : 0);
        return typeBias(a) - typeBias(b) || hexDistance(a, crown) - hexDistance(b, crown);
      })[0];
    if (candidate) roles.set(candidate.id, 'garrison');
  }

  // 적 왕관 임박 저지: 가장 가까운 유닛을 왕관(점령) 또는 인접(경합)으로 보낸다
  if (an.crownDenyImminent && an.crownTile) {
    const crown = an.crownTile;
    const candidate = units
      .filter((u) => !roles.has(u.id))
      .sort((a, b) => {
        // 약탈대·기병이 왕관 경합 진입에 유리
        const typeBias = (u: Unit) =>
          u.type === 'raider' || u.type === 'cavalry' ? -2 : u.type === 'guardian' ? 1 : 0;
        return typeBias(a) - typeBias(b) || hexDistance(a, crown) - hexDistance(b, crown);
      })[0];
    if (candidate) roles.set(candidate.id, 'garrison');
  }
  return { roles, holdTargets };
}

/** 제자리에서 사거리 안 적을 공격한다(이동 없음). requireSafe면 반격 사망이 예상될 때 쏘지 않는다. */
function attackInPlace(
  state: GameState,
  unit: Unit,
  an: Analysis,
  issue: IssueFn,
  requireSafe: boolean,
): boolean {
  if (unit.attacked) return false;
  const range = unitRange(unit);
  const target = an.enemies
    .filter((e) => unitById(state, e.id) && hexDistance(unit, e) <= range)
    .sort((a, b) => a.hp - b.hp)[0];
  if (!target) return false;
  if (requireSafe && forecastAttack(state, unit, target).attackerDies) return false;
  return issue({ type: 'attack-unit', attackerId: unit.id, defenderId: target.id }).ok;
}

// ---------------- 유닛 행동 ----------------

function actUnit(
  state: GameState,
  unit: Unit,
  role: Role,
  an: Analysis,
  profile: AiProfile,
  issue: IssueFn,
  holdTarget?: Tile,
): void {
  if (role === 'hold' && holdTarget) {
    // 사수: 거점 위(또는 거점으로 이동)에서만 싸운다. 절대 거점을 버리고 진격하지 않는다
    if (unit.q !== holdTarget.q || unit.r !== holdTarget.r) {
      if (!tryOccupy(state, unit, holdTarget, issue)) {
        moveToward(state, unit, holdTarget, profile, issue);
      }
    }
    attackInPlace(state, unit, an, issue, false);
    return;
  }
  if (role === 'defend') {
    // 방어: 위협 공격 우선, 수도가 비어 있으면 주둔, 아니면 수도 쪽으로 물러난다
    // 수호대: 제자리 공격으로 수호 태세를 유지할 수 있으면 이동하지 않는다
    if (unit.type === 'guardian' && attackInPlace(state, unit, an, issue, false)) return;
    if (tryAttack(state, unit, an, profile, issue)) return;
    if (an.myCapital) {
      if (tryOccupy(state, unit, an.myCapital, issue)) return;
      moveToward(state, unit, an.myCapital, profile, issue);
    }
    return;
  }
  if (role === 'garrison') {
    // 수비대·저지: 요새 위(또는 적 왕관 임박 시 인접 경합)로 이동. 인접 적은 공격
    if (an.crownTile) {
      // ① 왕관 위 점령/주둔
      if (tryOccupy(state, unit, an.crownTile, issue)) return;
      // ② 왕관 위 적 또는 인근 적 공격
      if (tryAttack(state, unit, an, profile, issue)) return;
      // ③ 적 왕관 저지: 인접 빈칸으로 경합(카운트 정지)
      if (an.crownDenyImminent && tryOccupyCrownAdjacent(state, unit, an.crownTile, issue)) return;
      moveToward(state, unit, an.crownTile, profile, issue);
      return;
    }
  }
  if (role === 'protect') {
    // 보호 대상(사망 = 패배): 제자리 사격만 하고, 적 위협권 밖 안전 타일로 물러난다
    attackInPlace(state, unit, an, issue, true);
    retreatToSafety(state, unit, an, issue);
    return;
  }

  // ---- 병종 전술 특화 ----
  // 수호대: 거점 방어 우선, 빈 평원 추격·원거리 무한 추격 금지
  if (unit.type === 'guardian') {
    const tile = tileAt(state, unit.q, unit.r);
    const onOwnedBuilding = !!(tile?.building && tile.owner === unit.faction);
    if (onOwnedBuilding) {
      // 제자리 공격(수호 태세 유지) 우선 — 공격은 태세 해제 조건이 아님
      if (attackInPlace(state, unit, an, issue, false)) return;
      // 사거리 밖 적만 있을 때는 거점을 버리지 않는다
      return;
    }
    // 빈 아군 거점이 있으면 주둔
    const emptyHold = state.tiles.find(
      (t) => t.building && t.owner === unit.faction && !unitAt(state, t.q, t.r),
    );
    if (emptyHold && tryOccupy(state, unit, emptyHold, issue)) {
      attackInPlace(state, unit, an, issue, false);
      return;
    }
    if (tryAttack(state, unit, an, profile, issue)) return;
    // 수도·왕관 쪽으로만 전진(평원 추격 금지)
    if (an.myCapital) moveToward(state, unit, an.myCapital, profile, issue);
    return;
  }

  // 약탈대: 빈 마을·후방 거점 점령 우선, 수호대 거점 정면 돌파 회피
  if (unit.type === 'raider') {
    if (tryCapture(state, unit, an, issue, 0)) return;
    if (tryAttack(state, unit, an, profile, issue)) return;
    tryAdvance(state, unit, an, profile, issue);
    return;
  }

  // 쇠뇌대: 중장 목표 우선 사격, 기병·약탈 인접 단독 이동 회피
  if (unit.type === 'crossbow') {
    if (tryAttack(state, unit, an, profile, issue)) return;
    // 전선 뒤 안전 사격 위치 선호
    if (profile.seekTerrain || profile.counterAware) {
      const nearbyMelee = an.enemies.some(
        (e) =>
          unitById(state, e.id) &&
          (e.type === 'cavalry' || e.type === 'raider') &&
          hexDistance(unit, e) <= 2,
      );
      if (nearbyMelee) {
        retreatToSafety(state, unit, an, issue);
        return;
      }
    }
    if (tryCapture(state, unit, an, issue, 0)) return;
    tryAdvance(state, unit, an, profile, issue);
    return;
  }

  // 공용 병종: 고가치 빈 거점(승리 목표) 점령을 소모 교전보다 우선
  if (tryCapture(state, unit, an, issue, 100)) return;
  if (tryAttack(state, unit, an, profile, issue)) return;
  if (tryCapture(state, unit, an, issue, 0)) return;
  tryAdvance(state, unit, an, profile, issue);
}

function unitValue(u: Unit): number {
  return UNIT_STATS[u.type].cost / 10;
}

interface AttackPlan {
  destKey: string | null;
  target: Unit;
  score: number;
  /** softCandidateBand 2차 정렬용(위협·근접, 높을수록 우선) */
  threatTie: number;
}

/**
 * 같은 라운드(동일 turn 번호)에 이미 해당 유닛을 공격한 횟수.
 * commandLog가 없으면 0 — 인간 controller 여부는 절대 보지 않는다.
 */
function priorAttacksOnTargetThisRound(state: GameState, defenderId: number): number {
  const log = state.commandLog;
  if (!log || log.length === 0) return 0;
  let n = 0;
  for (const c of log) {
    if (c.turn !== state.turn) continue;
    if (c.type === 'attack-unit' && c.defenderId === defenderId) n++;
  }
  return n;
}

/**
 * 후보 위협 2차 점수: 아군 수도·왕관에 가까운 적, 전투력이 높은 적을 선호.
 * controller=human 라벨은 사용하지 않는다.
 */
function attackThreatTie(unit: Unit, enemy: Unit, an: Analysis): number {
  let t = UNIT_STATS[enemy.type].atk * 2 + UNIT_STATS[enemy.type].hp;
  // 풀피·근접 위협 가산 — 이미 빈사 유닛 마무리보다 실위협 우선에 도움
  const missing = UNIT_STATS[enemy.type].hp - enemy.hp;
  t -= missing * 0.5;
  t -= hexDistance(unit, enemy) * 3;
  if (an.myCapital) t += Math.max(0, 6 - hexDistance(enemy, an.myCapital)) * 4;
  if (an.crownTile && an.crownOwner && an.crownOwner !== unit.faction) {
    t += Math.max(0, 5 - hexDistance(enemy, an.crownTile)) * 3;
  }
  // 결정론 안정: 동일 위협이면 id가 작은 쪽
  t -= enemy.id * 0.001;
  return t;
}

/** 점수 비교: 1차 score, soft band 안이면 threatTie, 동점이면 target id */
function isBetterPlan(
  candidate: AttackPlan,
  best: AttackPlan,
  band: number,
): boolean {
  if (band <= 0) {
    if (candidate.score !== best.score) return candidate.score > best.score;
    return candidate.target.id < best.target.id;
  }
  // band 안 후보는 위협 2차 기준, 그다음 점수, 그다음 id
  const inBandOfBest = candidate.score >= best.score - band;
  const bestInBandOfCand = best.score >= candidate.score - band;
  if (inBandOfBest && bestInBandOfCand) {
    if (candidate.threatTie !== best.threatTie) return candidate.threatTie > best.threatTie;
    if (candidate.score !== best.score) return candidate.score > best.score;
    return candidate.target.id < best.target.id;
  }
  return candidate.score > best.score;
}

// ---------------- 8.3 전투 평가 ----------------

function tryAttack(
  state: GameState,
  unit: Unit,
  an: Analysis,
  profile: AiProfile,
  issue: IssueFn,
): boolean {
  if (unit.attacked) return false;
  const range = unitRange(unit);
  if (an.enemies.length === 0) return false;

  const reach = profile.moveAttack && !unit.moved ? movementRange(state, unit) : null;
  const positions: { key: string | null; q: number; r: number }[] = [
    { key: null, q: unit.q, r: unit.r },
  ];
  if (reach) {
    for (const [key, e] of reach) {
      if (key === hexKey(unit.q, unit.r)) continue;
      if (unitAt(state, e.q, e.r)) continue;
      positions.push({ key, q: e.q, r: e.r });
    }
  }

  let best: AttackPlan | null = null;
  for (const pos of positions) {
    for (const enemy of an.enemies) {
      if (!unitById(state, enemy.id)) continue;
      if (hexDistance(pos, enemy) > range) continue;
      const fc = forecastAttack(state, unit, enemy, {
        attackerPos: { q: pos.q, r: pos.r },
        attackerMoved: pos.key ? true : unit.moved,
      });
      // 처치 불가 + 반격 사망 확정인 교환은 회피(어려움)
      if (profile.avoidBadTrades && fc.attackerDies && !fc.defenderDies) continue;

      let score = fc.damage.total;
      // 어려움 초반(1~3): 처치 가산 완화 — 4턴 이하 전멸 즉시와 중후반 차이를 계단화
      const earlyHardSoft =
        profile.production === 'adaptive' && state.turn <= 3 ? 0.5 : 1;
      if (fc.defenderDies) {
        score +=
          (profile.killBonusBase + unitValue(enemy) * profile.killValueScale) * earlyHardSoft;
      }
      const missingHp = UNIT_STATS[enemy.type].hp - enemy.hp;
      score += missingHp * profile.woundedWeight * earlyHardSoft;
      if (profile.counterAware && fc.counter) {
        score -= fc.counter.total * profile.counterWeight;
        if (fc.attackerDies) {
          score -= profile.killBonusBase + unitValue(unit) * profile.suicidePenaltyScale;
        }
      }
      // 다중 AI·다유닛 연속 집중 완화(세력/controller 비의존)
      if (profile.multiHitDampening > 0) {
        const prior = priorAttacksOnTargetThisRound(state, enemy.id);
        if (prior > 0) {
          score -= prior * profile.multiHitDampening;
          // 이미 맞은 대상의 처치 가산 일부 상쇄 — 라운드 마무리 경쟁 완화
          if (fc.defenderDies) score -= profile.killBonusBase * 0.45 * prior;
        }
      }
      if (profile.seekTerrain && pos.key) {
        const t = tileAt(state, pos.q, pos.r)!;
        score += terrainDefBonus(t) * 1.2;
      }
      // 적 왕관 저지: 왕관 위 적·왕관 소유 세력 유닛 우선
      if (an.crownScenario && an.crownActive && an.crownOwner && an.crownOwner !== unit.faction) {
        if (an.crownTile && enemy.q === an.crownTile.q && enemy.r === an.crownTile.r) {
          score += an.crownDenyImminent ? 80 + profile.crownDenyBonus / 4 : 40;
        } else if (enemy.faction === an.crownOwner) {
          score += an.crownDenyImminent ? 50 + profile.crownDenyBonus / 5 : 20;
        }
      }
      // 병종 상성: 쇠뇌대는 고방어·수호대 우선, 약탈대는 원거리·빈 거점 적 우선
      score += unitMatchupBonus(unit, enemy, state, pos);
      // 약탈대: 수호대·보병이 지키는 거점 정면 돌파 억제
      if (unit.type === 'raider' && isHardBuildingDefense(state, enemy) && !fc.defenderDies) {
        score -= 18;
      }
      const plan: AttackPlan = {
        destKey: pos.key,
        target: enemy,
        score,
        threatTie: attackThreatTie(unit, enemy, an),
      };
      if (!best || isBetterPlan(plan, best, profile.softCandidateBand)) best = plan;
    }
  }
  if (!best) return false;
  if (profile.avoidBadTrades && best.score <= 0) return false;

  if (best.destKey && reach) {
    const entry = reach.get(best.destKey)!;
    issue({ type: 'move-unit', unitId: unit.id, to: { q: entry.q, r: entry.r } });
  }
  return issue({ type: 'attack-unit', attackerId: unit.id, defenderId: best.target.id }).ok;
}

/** 특정 타일 위로 이동을 시도한다(왕관 수비 등). */
function tryOccupy(state: GameState, unit: Unit, target: Axial, issue: IssueFn): boolean {
  if (unit.moved) return false;
  if (unit.q === target.q && unit.r === target.r) return true;
  if (unitAt(state, target.q, target.r)) return false;
  const reach = movementRange(state, unit);
  const key = hexKey(target.q, target.r);
  if (!reach.has(key)) return false;
  return issue({ type: 'move-unit', unitId: unit.id, to: { q: target.q, r: target.r } }).ok;
}

/** 왕관 인접 빈칸 중 도달 가능한 곳으로 이동해 경합을 만든다. */
function tryOccupyCrownAdjacent(
  state: GameState,
  unit: Unit,
  crown: Axial,
  issue: IssueFn,
): boolean {
  if (unit.moved) return false;
  // 이미 인접이면 자리 유지
  if (hexDistance(unit, crown) === 1) return true;
  const reach = movementRange(state, unit);
  let best: { q: number; r: number; dist: number } | null = null;
  for (const n of neighbors(crown)) {
    const t = tileAt(state, n.q, n.r);
    if (!t || t.terrain === 'water') continue;
    if (unitAt(state, n.q, n.r)) continue;
    if (!reach.has(hexKey(n.q, n.r))) continue;
    const dist = hexDistance(unit, n);
    if (!best || dist < best.dist) best = { q: n.q, r: n.r, dist };
  }
  if (!best) return false;
  return issue({ type: 'move-unit', unitId: unit.id, to: { q: best.q, r: best.r } }).ok;
}

/** 적의 다음 턴 위협권 밖으로 물러난다(안전 타일이 없으면 위협이 가장 적은 곳으로). */
function retreatToSafety(state: GameState, unit: Unit, an: Analysis, issue: IssueFn): void {
  if (unit.moved) return;
  const threat = (pos: Axial): number => {
    let v = 0;
    for (const e of an.enemies) {
      if (!unitById(state, e.id)) continue;
      if (hexDistance(pos, e) <= UNIT_STATS[e.type].move + unitRange(e)) v++;
    }
    return v;
  };
  const current = threat(unit);
  if (current === 0) return; // 이미 안전하면 자리를 지킨다
  const reach = movementRange(state, unit);
  let best: { key: string; threat: number; def: number } | null = null;
  for (const [key, e] of reach) {
    if (key === hexKey(unit.q, unit.r)) continue;
    if (unitAt(state, e.q, e.r)) continue;
    const th = threat(e);
    const def = terrainDefBonus(tileAt(state, e.q, e.r)!);
    if (!best || th < best.threat || (th === best.threat && def > best.def)) {
      best = { key, threat: th, def };
    }
  }
  if (!best || best.threat >= current) return;
  const entry = reach.get(best.key)!;
  issue({ type: 'move-unit', unitId: unit.id, to: { q: entry.q, r: entry.r } });
}

/**
 * 도달 가능한 적/중립 거점 점령.
 * minObjectiveValue > 0이면 그 가치 이상 목표만 후보(승리 목표 우선 점령용).
 */
function tryCapture(
  state: GameState,
  unit: Unit,
  an: Analysis,
  issue: IssueFn,
  minObjectiveValue = 0,
): boolean {
  if (unit.moved) return false;
  const reach = movementRange(state, unit);
  let best: { key: string; value: number } | null = null;
  for (const [key, e] of reach) {
    if (key === hexKey(unit.q, unit.r)) continue;
    if (unitAt(state, e.q, e.r)) continue;
    const tile = tileAt(state, e.q, e.r);
    if (!tile?.building || tile.owner === unit.faction) continue;
    const objective = an.objectives.find((o) => o.q === e.q && o.r === e.r);
    const objValue = objective?.value ?? 50;
    if (objValue < minObjectiveValue) continue;
    let value = objValue * 2 - e.cost;
    // 약탈대: 점령 보상·빈 마을 우선
    if (unit.type === 'raider') {
      value += 30;
      if (tile.building === 'village' && !tile.owner) value += 15;
      if (tile.building === 'village') value += 10;
    }
    if (!best || value > best.value) best = { key, value };
  }
  if (!best) return false;
  const entry = reach.get(best.key)!;
  return issue({ type: 'move-unit', unitId: unit.id, to: { q: entry.q, r: entry.r } }).ok;
}

/** 병종 상성 점수: 정본 forecast breakdown(관통·수호 태세 반영) 기반. */
function unitMatchupBonus(
  attacker: Unit,
  enemy: Unit,
  state: GameState,
  pos: { q: number; r: number },
): number {
  let bonus = 0;
  if (attacker.type === 'crossbow') {
    // 중장·수호대·거점 위 고방어 유닛 우선
    if (enemy.type === 'guardian') bonus += 18;
    else if (enemy.type === 'infantry') bonus += 10;
    const enemyDef = UNIT_STATS[enemy.type].def;
    if (enemyDef >= 2) bonus += 8;
    const tile = tileAt(state, enemy.q, enemy.r);
    if (tile?.building) bonus += 6;
    // 저방어 원거리만 계속 때리는 것 억제
    if (enemy.type === 'archer' || enemy.type === 'crossbow' || enemy.type === 'raider') bonus -= 4;
  }
  if (attacker.type === 'raider') {
    // 노출된 원거리 병종
    if (enemy.type === 'archer' || enemy.type === 'crossbow') bonus += 14;
    if (enemy.type === 'guardian') bonus -= 10;
  }
  if (attacker.type === 'guardian') {
    // 돌격 부대 저지
    if (enemy.type === 'cavalry' || enemy.type === 'raider') bonus += 12;
  }
  // 이동 후 위치에서 기병·약탈이 쇠뇌에 위협적이면 감점
  if (attacker.type === 'crossbow') {
    const afterPos = pos;
    for (const e of state.units) {
      if (e.faction === attacker.faction) continue;
      if (e.type !== 'cavalry' && e.type !== 'raider') continue;
      if (hexDistance(afterPos, e) <= 1) bonus -= 20;
    }
  }
  return bonus;
}

/** 수호대·보병이 거점을 지키는 강경 방어 여부. */
function isHardBuildingDefense(state: GameState, enemy: Unit): boolean {
  if (enemy.type !== 'guardian' && enemy.type !== 'infantry') return false;
  const tile = tileAt(state, enemy.q, enemy.r);
  return !!(tile?.building && tile.owner === enemy.faction);
}

/** 목표 지점을 향해 실제 도달 가능 타일 중 가장 가까워지는 곳으로 이동한다. */
function moveToward(
  state: GameState,
  unit: Unit,
  target: Axial,
  profile: AiProfile,
  issue: IssueFn,
): void {
  if (unit.moved) return;
  const reach = movementRange(state, unit);
  const currentDist = hexDistance(unit, target);
  let best: { key: string; dist: number; cost: number; def: number } | null = null;
  for (const [key, e] of reach) {
    if (key === hexKey(unit.q, unit.r)) continue;
    if (unitAt(state, e.q, e.r)) continue;
    const dist = hexDistance(e, target);
    const def = profile.seekTerrain ? terrainDefBonus(tileAt(state, e.q, e.r)!) : 0;
    if (
      !best ||
      dist < best.dist ||
      (dist === best.dist && def > best.def) ||
      (dist === best.dist && def === best.def && e.cost < best.cost)
    ) {
      best = { key, dist, cost: e.cost, def };
    }
  }
  if (!best || best.dist >= currentDist) return; // 전진이 안 되면 대기
  const entry = reach.get(best.key)!;
  issue({ type: 'move-unit', unitId: unit.id, to: { q: entry.q, r: entry.r } });
}

function tryAdvance(
  state: GameState,
  unit: Unit,
  an: Analysis,
  profile: AiProfile,
  issue: IssueFn,
): void {
  if (unit.moved) return;
  // 목표 선택: 거점 가치 - 거리 비용 - 혼잡 페널티, 적 유닛도 후보
  let goal: Axial | null = null;
  let goalScore = -Infinity;
  let chosen: Objective | null = null;
  const horizon = profile.horizon ?? Infinity;
  for (const o of an.objectives) {
    if (hexDistance(unit, o) > horizon) continue; // 쉬움: 먼 목표를 보지 못한다
    // 정복 목표(고가치 수도)는 거리 페널티를 완화해 원거리 진격을 유지한다
    const distCost = o.value >= 150 ? 5 : 8;
    const claimCost = o.value >= 150 ? 15 : 25;
    const score = o.value - hexDistance(unit, o) * distCost - o.claimed * claimCost;
    if (score > goalScore) {
      goalScore = score;
      goal = o;
      chosen = o;
    }
  }
  for (const e of an.enemies) {
    if (!unitById(state, e.id)) continue;
    if (hexDistance(unit, e) > horizon) continue;
    // controller 라벨 비의존 — 부상 추격 가중만 난이도 프로파일로 조절
    const score =
      40 +
      (UNIT_STATS[e.type].hp - e.hp) * profile.chaseWoundedWeight -
      hexDistance(unit, e) * 8;
    if (score > goalScore) {
      goalScore = score;
      goal = { q: e.q, r: e.r };
      chosen = null;
    }
  }
  // 지평 안에 아무 목표도 없으면 완전히 멈추는 대신 가장 가까운 거점으로 느리게 전진한다
  if (!goal && an.objectives.length > 0) {
    const nearest = an.objectives
      .slice()
      .sort((a, b) => hexDistance(unit, a) - hexDistance(unit, b))[0];
    goal = nearest;
    chosen = nearest;
  }
  if (!goal) return;
  if (chosen) chosen.claimed++;
  moveToward(state, unit, goal, profile, issue);
}

// ---------------- 8.4 생산 결정 ----------------

/** 병종 생산 점수: 보유 구성·적 구성·지도·왕관·금·고유 병종 역할을 반영한다. */
function scoreProductionType(
  state: GameState,
  faction: FactionId,
  type: UnitTypeId,
  an: Analysis,
  profile: AiProfile,
): number {
  const mine = unitsOf(state, faction);
  const count = mine.length;
  const ofType = mine.filter((u) => u.type === type).length;
  const fs = state.factions[faction];
  const cost = unitCost(faction, type, state.config.modifier);
  if (fs.gold < cost) return -Infinity;

  let score = 10;
  // 생산 후 즉시 행동 불가 — 비싸면 약간 감점
  score -= cost * 0.05;

  // 공용 비율 목표 — 보병 편중 억제, 기병 최소 비중 확보(공용 대비 ≥8%)
  // 자원(violet) 궁병은 장궁 교리 골격 — 시작 이후에도 범용 원거리 비율을 유지한다.
  if (type === 'infantry') {
    const target = Math.ceil((count + 1) * 0.3);
    score += ofType < target ? 20 : 3 - ofType * 3;
  } else if (type === 'archer') {
    const archerRatio = faction === 'violet' ? 0.32 : 0.24;
    const target = Math.ceil((count + 1) * archerRatio);
    const under = ofType < target;
    score += under ? (faction === 'violet' ? 26 : 20) : 4 - ofType * (faction === 'violet' ? 2 : 3);
  } else if (type === 'cavalry') {
    // 기병 목표 비율을 올려 공용 비중 게이트를 확보한다
    const cavTarget = Math.max(1, Math.ceil((count + 1) * 0.16));
    score += ofType < cavTarget ? 28 : ofType === cavTarget ? 10 : -2 - ofType * 2;
    // 정복형 후반: 기동으로 수도 압박 (캠페인 비정복에는 적용하지 않음)
    if (an.conquestScenario && an.turnsLeft <= 5) score += 14;
    // 왕관 경합: 기동 병종으로 선점
    if (an.crownScenario) score += 12;
  }

  // 고유 병종: 최소 1기 유도 + 기계적 과생산 억제(적격 40~95%)
  if (isUniqueUnit(type)) {
    if (ofType === 0) {
      // 쇠뇌대는 0생산 붕괴 방지, 약탈대는 95% 상한을 넘지 않게 약하게
      score += type === 'crossbow' ? 36 : type === 'raider' ? 14 : 22;
    } else if (ofType === 1) {
      score += type === 'raider' ? -6 : 2;
    } else {
      score -= 16 * ofType;
    }
  }

  // 수호대: 방어·거점 우선. 왕관 시나리오에서는 과생산을 억제한다.
  if (type === 'guardian') {
    if (an.capitalThreats.length > 0) score += 22;
    if (an.crownScenario) score -= 10;
    if (an.holdTiles.length > 0) score += 15;
    const enemyRaiders = an.enemies.filter((e) => e.type === 'cavalry' || e.type === 'raider').length;
    if (an.enemies.length > 0 && enemyRaiders / an.enemies.length >= 0.3) score += 18;
    // 넓은 지도·점령 경쟁에서는 억제
    if (an.objectives.length >= 6 && an.capitalThreats.length === 0) score -= 8;
  }

  // 약탈대: 빈 거점·왕관 경합·원거리 적
  if (type === 'raider') {
    const emptyBuildings = state.tiles.filter(
      (t) => t.building && t.owner !== faction && !unitAt(state, t.q, t.r),
    ).length;
    score += Math.min(18, emptyBuildings * 3);
    if (an.crownScenario) score += 12;
    const enemyRanged = an.enemies.filter((e) => e.type === 'archer' || e.type === 'crossbow').length;
    if (an.enemies.length > 0 && enemyRanged / an.enemies.length >= 0.3) score += 12;
    // 남은 턴이 매우 적으면 저렴한 보병 선호
    if (an.turnsLeft <= 2) score -= 15;
  }

  // 궁병: 범용 원거리 — 연·중방어 상대 비용효율, 자원 장궁 교리 가치
  if (type === 'archer') {
    if (faction === 'violet') {
      // 장궁(사거리 +1)이 실제 생산 이유로 남도록 세력 보너스
      score += 12;
    }
    if (an.enemies.length > 0) {
      // 기본 방어 2 이하·비수호 = 연·중방어. 관통 특화가 불필요한 상대.
      const softMed = an.enemies.filter(
        (e) => e.type !== 'guardian' && UNIT_STATS[e.type].def <= 2,
      ).length;
      const softRatio = softMed / an.enemies.length;
      if (softRatio >= 0.5) score += 18;
      else if (softRatio >= 0.3) score += 8;
      // 고방어가 지배적이면 쇠뇌대에 양보 (완전 제외는 아님)
      const highArmor = an.enemies.filter(
        (e) => e.type === 'guardian' || UNIT_STATS[e.type].def >= 3,
      ).length;
      if (highArmor / an.enemies.length >= 0.4) score -= 6;
    }
  }

  // 쇠뇌대: 고방어·수호대 관통 전용 (일반 보병 def=2는 고방어로 치지 않음)
  if (type === 'crossbow') {
    const highArmor = an.enemies.filter(
      (e) => e.type === 'guardian' || UNIT_STATS[e.type].def >= 3,
    ).length;
    if (an.enemies.length > 0) {
      const hardRatio = highArmor / an.enemies.length;
      if (hardRatio >= 0.2) score += 24;
      else if (hardRatio > 0) score += 12;
      else score -= 6; // 고방어 없으면 약가산 억제(완전 사장 방지)
      // 연·중방어 다수면 쇠뇌대 억제 (전 상황 상위호환 방지)
      const softMed = an.enemies.filter(
        (e) => e.type !== 'guardian' && UNIT_STATS[e.type].def <= 2,
      ).length;
      if (softMed / an.enemies.length >= 0.55) score -= 10;
    }
    if (an.enemies.some((e) => e.type === 'guardian')) score += 16;
    // 기병·약탈 다수면 억제
    const fast = an.enemies.filter((e) => e.type === 'cavalry' || e.type === 'raider').length;
    if (an.enemies.length > 0 && fast / an.enemies.length >= 0.4) score -= 10;
  }

  // adaptive: 적 구성 상성
  if (profile.production === 'adaptive' && an.enemies.length > 0) {
    const enemyCav =
      an.enemies.filter((e) => e.type === 'cavalry' || e.type === 'raider').length /
      an.enemies.length;
    const enemyArc =
      an.enemies.filter((e) => e.type === 'archer' || e.type === 'crossbow').length /
      an.enemies.length;
    const enemyGuard = an.enemies.filter((e) => e.type === 'guardian').length / an.enemies.length;
    if (enemyCav >= 0.35) {
      if (type === 'infantry' || type === 'guardian') score += 15;
      if (type === 'raider') score -= 8;
    }
    if (enemyArc >= 0.4) {
      // 연·중방어 원거리 다수면 기병 돌격보다 궁병 견제가 효율 — 가산 완화
      const softHeavy =
        an.enemies.filter((e) => e.type !== 'guardian' && UNIT_STATS[e.type].def <= 2).length /
          an.enemies.length >=
        0.5;
      if (type === 'cavalry' || type === 'raider') score += softHeavy ? 8 : 14;
    }
    // 수호대 비중 높을 때만 쇠뇌대 가산 (연·중방어 일반 보병과 분리)
    if (enemyGuard >= 0.2 && type === 'crossbow') score += 18;
    // 자원 궁병: adaptive에서도 범용 원거리 골격 유지
    if (faction === 'violet' && type === 'archer' && enemyGuard < 0.25) score += 6;
  }

  // 지도 크기(거점 수) — 넓은 지도는 기동 병종
  const buildings = state.tiles.filter((t) => t.building).length;
  if (buildings >= 8) {
    if (type === 'cavalry' || type === 'raider') score += 6;
    if (type === 'guardian') score -= 4;
  }

  // 금이 충분한데 싸게만 찍는 것 방지: 여유 금 + 역할 필요 시 고유/고급 병종
  if (fs.gold >= cost + 40 && isUniqueUnit(type) && ofType < 2) score += 6;

  return score;
}

function pickProductionType(
  state: GameState,
  faction: FactionId,
  an: Analysis,
  profile: AiProfile,
): UnitTypeId {
  const roster = producibleUnits(state, faction);
  const fs = state.factions[faction];
  const mine = unitsOf(state, faction);
  const count = mine.length;

  if (profile.production === 'cycle') {
    // 쉬움: 공용 순환 + 가끔 고유(허용 시)
    const unique = roster.find((t) => isUniqueUnit(t));
    if (unique && count > 0 && count % 5 === 4 && fs.gold >= unitCost(faction, unique, state.config.modifier)) {
      return unique;
    }
    return count % 2 === 0 ? 'infantry' : 'archer';
  }

  // 남은 턴이 1 이하면 저렴한 유닛으로 점수를 극대화한다
  if (an.turnsLeft <= 1) return 'infantry';

  // 자원(violet): 공용 3기 이상·고유 미보유 시 쇠뇌대 1기 강제(0생산 붕괴 방지)
  if (faction === 'violet') {
    const unique = roster.find((t) => isUniqueUnit(t));
    const sharedCount = mine.filter((u) => !isUniqueUnit(u.type)).length;
    if (
      unique &&
      sharedCount >= 3 &&
      !mine.some((u) => isUniqueUnit(u.type)) &&
      fs.gold >= unitCost(faction, unique, state.config.modifier)
    ) {
      return unique;
    }
  }

  let best: UnitTypeId = 'infantry';
  let bestScore = -Infinity;
  for (const type of roster) {
    const s = scoreProductionType(state, faction, type, an, profile);
    if (s > bestScore) {
      bestScore = s;
      best = type;
    }
  }
  return best;
}

function produceUnits(
  state: GameState,
  faction: FactionId,
  an: Analysis,
  profile: AiProfile,
  issue: IssueFn,
): void {
  const fs = state.factions[faction];
  const spots = state.tiles.filter(
    (t) => t.building && t.owner === faction && !unitAt(state, t.q, t.r),
  );
  // 수도 우선(안전)·위험 거점 후순위
  spots.sort((a, b) => (b.building === 'capital' ? 1 : 0) - (a.building === 'capital' ? 1 : 0));
  for (const spot of spots) {
    if (unitsOf(state, faction).length >= MAX_UNITS_PER_FACTION) break;
    // 쉬움: 경제 관리가 미숙해 수도에서만 생산한다
    if (profile.production === 'cycle' && spot.building !== 'capital') continue;
    // 어려움: 적이 바로 옆에 있는 거점 생산은 피한다(생산 유닛은 그 턴 무방비)
    if (profile.production === 'adaptive') {
      const adjacentEnemy = an.enemies.some(
        (e) => unitById(state, e.id) && hexDistance(e, spot) <= 1,
      );
      if (adjacentEnemy) continue;
    }
    let type = pickProductionType(state, faction, an, profile);
    if (fs.gold < unitCost(faction, type, state.config.modifier)) {
      // 살 수 있는 가장 싼 생산 가능 병종
      const affordable = producibleUnits(state, faction)
        .filter((t) => fs.gold >= unitCost(faction, t, state.config.modifier))
        .sort(
          (a, b) =>
            unitCost(faction, a, state.config.modifier) -
            unitCost(faction, b, state.config.modifier),
        );
      if (affordable.length === 0) break;
      type = affordable[0];
    }
    if (fs.gold < unitCost(faction, type, state.config.modifier)) break;
    issue({ type: 'produce-unit', at: { q: spot.q, r: spot.r }, unitType: type });
  }
}


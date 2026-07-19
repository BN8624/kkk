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
import { hexDistance, hexKey } from './hex';
import { movementRange } from './pathfind';
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
  /** 부상당한 적 집중 공격 가중치 강화 */
  focusFire: boolean;
  /** 공격 위치 선정 시 지형 방어 선호 */
  seekTerrain: boolean;
  /** 목표 탐색 지평(이 거리보다 먼 목표는 보지 못한다). 없으면 전장 전체 */
  horizon?: number;
  production: 'cycle' | 'balanced' | 'adaptive';
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
  },
  normal: {
    moveAttack: true,
    counterAware: true,
    avoidBadTrades: false,
    defend: true,
    focusFire: false,
    seekTerrain: false,
    production: 'balanced',
  },
  hard: {
    moveAttack: true,
    counterAware: true,
    avoidBadTrades: true,
    defend: true,
    focusFire: true,
    seekTerrain: true,
    production: 'adaptive',
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

  const analysis = analyze(state, faction);
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

function analyze(state: GameState, faction: FactionId): Analysis {
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
  const crownTile = hold
    ? (tileAt(state, hold.at.q, hold.at.r) ?? null)
    : (state.tiles.find((t) => t.building === 'crown') ?? null);
  const isCrownScenario = hold !== null;
  const objectives: Objective[] = [];
  for (const t of state.tiles) {
    if (!t.building || t.owner === faction) continue;
    const value =
      t.building === 'crown'
        ? isCrownScenario
          ? 160
          : 70
        : t.building === 'capital'
          ? 100
          : 50;
    objectives.push({ q: t.q, r: t.r, value, claimed: 0 });
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
    const defenders = units
      .filter((u) => !roles.has(u.id))
      .sort((a, b) => hexDistance(a, cap) - hexDistance(b, cap))
      .slice(0, Math.min(2, an.capitalThreats.length));
    for (const d of defenders) roles.set(d.id, 'defend');
  }

  // 왕관 요새를 소유 중이면 비어 있는 요새에 수비대를 보낸다
  if (
    an.crownTile &&
    an.crownTile.owner === faction &&
    an.crownScenario &&
    !unitAt(state, an.crownTile.q, an.crownTile.r)
  ) {
    const crown = an.crownTile;
    const candidate = units
      .filter((u) => !roles.has(u.id))
      .sort((a, b) => hexDistance(a, crown) - hexDistance(b, crown))[0];
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
    if (tryAttack(state, unit, an, profile, issue)) return;
    if (an.myCapital) {
      if (tryOccupy(state, unit, an.myCapital, issue)) return;
      moveToward(state, unit, an.myCapital, profile, issue);
    }
    return;
  }
  if (role === 'garrison') {
    // 수비대: 요새 위로 이동(도달 불가면 접근). 인접 적은 공격
    if (an.crownTile) {
      if (tryOccupy(state, unit, an.crownTile, issue)) return;
      if (tryAttack(state, unit, an, profile, issue)) return;
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
  // 공격 역할: 공격 → 점령 → 전진
  if (tryAttack(state, unit, an, profile, issue)) return;
  if (tryCapture(state, unit, an, issue)) return;
  tryAdvance(state, unit, an, profile, issue);
}

function unitValue(u: Unit): number {
  return UNIT_STATS[u.type].cost / 10;
}

interface AttackPlan {
  destKey: string | null;
  target: Unit;
  score: number;
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
      if (fc.defenderDies) score += 25 + unitValue(enemy) * 2;
      score += (UNIT_STATS[enemy.type].hp - enemy.hp) * (profile.focusFire ? 0.6 : 0.3);
      if (profile.counterAware && fc.counter) {
        score -= fc.counter.total * 0.8;
        if (fc.attackerDies) score -= 25 + unitValue(unit) * 3;
      }
      if (profile.seekTerrain && pos.key) {
        const t = tileAt(state, pos.q, pos.r)!;
        score += terrainDefBonus(t) * 1.2;
      }
      if (!best || score > best.score) best = { destKey: pos.key, target: enemy, score };
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
function tryOccupy(state: GameState, unit: Unit, target: Tile, issue: IssueFn): boolean {
  if (unit.moved) return false;
  if (unit.q === target.q && unit.r === target.r) return true;
  if (unitAt(state, target.q, target.r)) return false;
  const reach = movementRange(state, unit);
  const key = hexKey(target.q, target.r);
  if (!reach.has(key)) return false;
  return issue({ type: 'move-unit', unitId: unit.id, to: { q: target.q, r: target.r } }).ok;
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

function tryCapture(state: GameState, unit: Unit, an: Analysis, issue: IssueFn): boolean {
  if (unit.moved) return false;
  const reach = movementRange(state, unit);
  let best: { key: string; value: number } | null = null;
  for (const [key, e] of reach) {
    if (key === hexKey(unit.q, unit.r)) continue;
    if (unitAt(state, e.q, e.r)) continue;
    const tile = tileAt(state, e.q, e.r);
    if (!tile?.building || tile.owner === unit.faction) continue;
    const objective = an.objectives.find((o) => o.q === e.q && o.r === e.r);
    const value = (objective?.value ?? 50) * 2 - e.cost;
    if (!best || value > best.value) best = { key, value };
  }
  if (!best) return false;
  const entry = reach.get(best.key)!;
  return issue({ type: 'move-unit', unitId: unit.id, to: { q: entry.q, r: entry.r } }).ok;
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
    const score = o.value - hexDistance(unit, o) * 8 - o.claimed * 25;
    if (score > goalScore) {
      goalScore = score;
      goal = o;
      chosen = o;
    }
  }
  for (const e of an.enemies) {
    if (!unitById(state, e.id)) continue;
    if (hexDistance(unit, e) > horizon) continue;
    const score = 40 + (UNIT_STATS[e.type].hp - e.hp) * 2 - hexDistance(unit, e) * 8;
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

function pickProductionType(
  state: GameState,
  faction: FactionId,
  an: Analysis,
  profile: AiProfile,
): UnitTypeId {
  const fs = state.factions[faction];
  const mine = unitsOf(state, faction);
  const count = mine.length;

  if (profile.production === 'cycle') {
    return count % 2 === 0 ? 'infantry' : 'archer';
  }

  // 남은 턴이 1 이하면 저렴한 유닛으로 점수를 극대화한다
  if (an.turnsLeft <= 1) return 'infantry';

  if (profile.production === 'adaptive' && an.enemies.length > 0) {
    const enemyCav = an.enemies.filter((e) => e.type === 'cavalry').length;
    const enemyArc = an.enemies.filter((e) => e.type === 'archer').length;
    // 적 기병 비중이 크면 방어 보병, 적 궁병 비중이 크면 접근 기병
    if (enemyCav / an.enemies.length >= 0.4) return 'infantry';
    if (
      enemyArc / an.enemies.length >= 0.5 &&
      fs.gold >= unitCost(faction, 'cavalry', state.config.modifier)
    )
      return 'cavalry';
  }

  // 균형 구성: 보병 4 : 궁병 3 : 기병 3 비율을 향한다
  const inf = mine.filter((u) => u.type === 'infantry').length;
  const arc = mine.filter((u) => u.type === 'archer').length;
  const cav = mine.filter((u) => u.type === 'cavalry').length;
  const targetInf = Math.ceil((count + 1) * 0.4);
  const targetArc = Math.ceil((count + 1) * 0.3);
  if (inf < targetInf) return 'infantry';
  if (arc < targetArc) return 'archer';
  if (fs.gold >= unitCost(faction, 'cavalry', state.config.modifier) + 20 && cav <= arc)
    return 'cavalry';
  return 'infantry';
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
    if (fs.gold < unitCost(faction, type, state.config.modifier)) type = 'infantry';
    if (fs.gold < unitCost(faction, type, state.config.modifier)) break;
    issue({ type: 'produce-unit', at: { q: spot.q, r: spot.r }, unitType: type });
  }
}

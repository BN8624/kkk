// 한 줄 목적: 전략 분석·역할 배정·전투 평가·생산 판단을 수행하는 난이도별 AI 턴 실행기
import { tileAt, unitAt, unitById, unitsOf } from './board';
import { MAX_UNITS_PER_FACTION, UNIT_STATS } from './data';
import { attack, forecastAttack, moveUnit, produceUnit, terrainDefBonus, unitCost } from './game';
import { hexDistance, hexKey } from './hex';
import { movementRange, reconstructPath } from './pathfind';
import type {
  Axial,
  Difficulty,
  FactionId,
  GameState,
  Tile,
  Unit,
  UnitTypeId,
} from './types';

export type AiAction =
  | { kind: 'move'; unitId: number; path: Axial[] }
  | { kind: 'attack'; unitId: number; targetId: number; damage: number; counterDamage?: number }
  | { kind: 'capture'; unitId: number; at: Axial }
  | { kind: 'produce'; unitId: number; at: Axial; type: UnitTypeId };

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
    production: 'cycle',
  },
  normal: {
    moveAttack: true,
    counterAware: false,
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

type Role = 'defend' | 'garrison' | 'attack';

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
  objectives: Objective[];
  turnsLeft: number;
}

/** AI 세력 하나의 턴을 실행하고 애니메이션 재생용 행동 로그를 반환한다.
 *  difficultyOverride는 밸런스 시뮬레이션에서 세력별 난이도를 달리할 때 쓴다. */
export function runAiTurn(
  state: GameState,
  faction: FactionId,
  difficultyOverride?: Difficulty,
): AiAction[] {
  const log: AiAction[] = [];
  if (state.over || state.factions[faction].eliminated) return log;
  const profile = PROFILES[difficultyOverride ?? state.config.difficulty] ?? PROFILES.normal;

  const analysis = analyze(state, faction);
  const roles = assignRoles(state, faction, analysis, profile);

  const unitIds = unitsOf(state, faction).map((u) => u.id);
  for (const uid of unitIds) {
    const unit = unitById(state, uid);
    if (!unit || state.over) break;
    actUnit(state, unit, roles.get(uid) ?? 'attack', analysis, profile, log);
  }
  if (!state.over) produceUnits(state, faction, analysis, profile, log);
  return log;
}

// ---------------- 8.1 전략 상태 분석 ----------------

function analyze(state: GameState, faction: FactionId): Analysis {
  const enemies = state.units.filter((u) => u.faction !== faction);
  const myCapital =
    state.tiles.find((t) => t.building === 'capital' && t.owner === faction) ?? null;
  // 위협: 다음 턴에 수도 사거리에 닿을 수 있는 적(이동력+사거리 근사)
  const capitalThreats = myCapital
    ? enemies.filter(
        (e) => hexDistance(e, myCapital) <= UNIT_STATS[e.type].move + UNIT_STATS[e.type].range,
      )
    : [];
  const crownTile = state.tiles.find((t) => t.building === 'crown') ?? null;
  const isCrownScenario = state.config.scenario === 'crown-heart';
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
  return {
    enemies,
    myCapital,
    capitalThreats,
    crownTile,
    objectives,
    turnsLeft: state.maxTurns - state.turn,
  };
}

// ---------------- 8.2 전선과 목표 할당 ----------------

function assignRoles(
  state: GameState,
  faction: FactionId,
  an: Analysis,
  profile: AiProfile,
): Map<number, Role> {
  const roles = new Map<number, Role>();
  const units = unitsOf(state, faction);

  if (profile.defend && an.myCapital && an.capitalThreats.length > 0) {
    const cap = an.myCapital;
    const defenders = units
      .slice()
      .sort((a, b) => hexDistance(a, cap) - hexDistance(b, cap))
      .slice(0, Math.min(2, an.capitalThreats.length));
    for (const d of defenders) roles.set(d.id, 'defend');
  }

  // 왕관 요새를 소유 중이면 비어 있는 요새에 수비대를 보낸다
  if (
    an.crownTile &&
    an.crownTile.owner === faction &&
    state.config.scenario === 'crown-heart' &&
    !unitAt(state, an.crownTile.q, an.crownTile.r)
  ) {
    const crown = an.crownTile;
    const candidate = units
      .filter((u) => !roles.has(u.id))
      .sort((a, b) => hexDistance(a, crown) - hexDistance(b, crown))[0];
    if (candidate) roles.set(candidate.id, 'garrison');
  }
  return roles;
}

// ---------------- 유닛 행동 ----------------

function actUnit(
  state: GameState,
  unit: Unit,
  role: Role,
  an: Analysis,
  profile: AiProfile,
  log: AiAction[],
): void {
  if (role === 'defend') {
    // 방어: 위협 공격 우선, 수도가 비어 있으면 주둔, 아니면 수도 쪽으로 물러난다
    if (tryAttack(state, unit, an, profile, log)) return;
    if (an.myCapital) {
      if (tryOccupy(state, unit, an.myCapital, log)) return;
      moveToward(state, unit, an.myCapital, profile, log);
    }
    return;
  }
  if (role === 'garrison') {
    // 수비대: 요새 위로 이동(도달 불가면 접근). 인접 적은 공격
    if (an.crownTile) {
      if (tryOccupy(state, unit, an.crownTile, log)) return;
      if (tryAttack(state, unit, an, profile, log)) return;
      moveToward(state, unit, an.crownTile, profile, log);
      return;
    }
  }
  // 공격 역할: 공격 → 점령 → 전진
  if (tryAttack(state, unit, an, profile, log)) return;
  if (tryCapture(state, unit, an, log)) return;
  tryAdvance(state, unit, an, profile, log);
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
  log: AiAction[],
): boolean {
  if (unit.attacked) return false;
  const range = UNIT_STATS[unit.type].range;
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
    const result = moveUnit(state, unit.id, { q: entry.q, r: entry.r });
    if (result.ok && result.path) {
      log.push({ kind: 'move', unitId: unit.id, path: result.path });
      if (result.captured)
        log.push({ kind: 'capture', unitId: unit.id, at: { q: entry.q, r: entry.r } });
    }
  }
  const atkResult = attack(state, unit.id, best.target.id);
  if (atkResult.ok) {
    log.push({
      kind: 'attack',
      unitId: unit.id,
      targetId: best.target.id,
      damage: atkResult.damage!,
      counterDamage: atkResult.counterDamage,
    });
    return true;
  }
  return false;
}

/** 특정 타일 위로 이동을 시도한다(왕관 수비 등). */
function tryOccupy(state: GameState, unit: Unit, target: Tile, log: AiAction[]): boolean {
  if (unit.moved) return false;
  if (unit.q === target.q && unit.r === target.r) return true;
  if (unitAt(state, target.q, target.r)) return false;
  const reach = movementRange(state, unit);
  const key = hexKey(target.q, target.r);
  if (!reach.has(key)) return false;
  const result = moveUnit(state, unit.id, { q: target.q, r: target.r });
  if (result.ok && result.path) {
    log.push({ kind: 'move', unitId: unit.id, path: result.path });
    if (result.captured)
      log.push({ kind: 'capture', unitId: unit.id, at: { q: target.q, r: target.r } });
    return true;
  }
  return false;
}

function tryCapture(state: GameState, unit: Unit, an: Analysis, log: AiAction[]): boolean {
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
  const result = moveUnit(state, unit.id, { q: entry.q, r: entry.r });
  if (result.ok && result.path) {
    log.push({ kind: 'move', unitId: unit.id, path: result.path });
    log.push({ kind: 'capture', unitId: unit.id, at: { q: entry.q, r: entry.r } });
    return true;
  }
  return false;
}

/** 목표 지점을 향해 실제 도달 가능 타일 중 가장 가까워지는 곳으로 이동한다. */
function moveToward(
  state: GameState,
  unit: Unit,
  target: Axial,
  profile: AiProfile,
  log: AiAction[],
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
  const path = reconstructPath(reach, { q: entry.q, r: entry.r });
  const result = moveUnit(state, unit.id, { q: entry.q, r: entry.r });
  if (result.ok && path) {
    log.push({ kind: 'move', unitId: unit.id, path });
    if (result.captured)
      log.push({ kind: 'capture', unitId: unit.id, at: { q: entry.q, r: entry.r } });
  }
}

function tryAdvance(
  state: GameState,
  unit: Unit,
  an: Analysis,
  profile: AiProfile,
  log: AiAction[],
): void {
  if (unit.moved) return;
  // 목표 선택: 거점 가치 - 거리 비용 - 혼잡 페널티, 적 유닛도 후보
  let goal: Axial | null = null;
  let goalScore = -Infinity;
  let chosen: Objective | null = null;
  for (const o of an.objectives) {
    const score = o.value - hexDistance(unit, o) * 8 - o.claimed * 25;
    if (score > goalScore) {
      goalScore = score;
      goal = o;
      chosen = o;
    }
  }
  for (const e of an.enemies) {
    if (!unitById(state, e.id)) continue;
    const score = 40 + (UNIT_STATS[e.type].hp - e.hp) * 2 - hexDistance(unit, e) * 8;
    if (score > goalScore) {
      goalScore = score;
      goal = { q: e.q, r: e.r };
      chosen = null;
    }
  }
  if (!goal) return;
  if (chosen) chosen.claimed++;
  moveToward(state, unit, goal, profile, log);
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
    if (enemyArc / an.enemies.length >= 0.5 && fs.gold >= unitCost(faction, 'cavalry'))
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
  if (fs.gold >= unitCost(faction, 'cavalry') + 20 && cav <= arc) return 'cavalry';
  return 'infantry';
}

function produceUnits(
  state: GameState,
  faction: FactionId,
  an: Analysis,
  profile: AiProfile,
  log: AiAction[],
): void {
  const fs = state.factions[faction];
  const spots = state.tiles.filter(
    (t) => t.building && t.owner === faction && !unitAt(state, t.q, t.r),
  );
  // 수도 우선(안전)·위험 거점 후순위
  spots.sort((a, b) => (b.building === 'capital' ? 1 : 0) - (a.building === 'capital' ? 1 : 0));
  for (const spot of spots) {
    if (unitsOf(state, faction).length >= MAX_UNITS_PER_FACTION) break;
    // 어려움: 적이 바로 옆에 있는 거점 생산은 피한다(생산 유닛은 그 턴 무방비)
    if (profile.production === 'adaptive') {
      const adjacentEnemy = an.enemies.some(
        (e) => unitById(state, e.id) && hexDistance(e, spot) <= 1,
      );
      if (adjacentEnemy) continue;
    }
    let type = pickProductionType(state, faction, an, profile);
    if (fs.gold < unitCost(faction, type)) type = 'infantry';
    if (fs.gold < unitCost(faction, type)) break;
    const result = produceUnit(state, faction, spot, type);
    if (result.ok && result.unit) {
      log.push({ kind: 'produce', unitId: result.unit.id, at: { q: spot.q, r: spot.r }, type });
    }
  }
}

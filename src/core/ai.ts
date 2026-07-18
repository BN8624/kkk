// 한 줄 목적: 우선순위 기반 AI 세력 턴(공격·점령·전진·생산)을 유한 시간 안에 수행한다
import { tileAt, unitAt, unitById, unitsOf } from './board';
import { MAX_UNITS_PER_FACTION, UNIT_STATS } from './data';
import { attack, damageBreakdown, moveUnit, produceUnit, unitCost } from './game';
import { hexDistance, hexKey } from './hex';
import { movementRange, reconstructPath } from './pathfind';
import type { Axial, FactionId, GameState, Unit, UnitTypeId } from './types';

export type AiAction =
  | { kind: 'move'; unitId: number; path: Axial[] }
  | { kind: 'attack'; unitId: number; targetId: number; damage: number; counterDamage?: number }
  | { kind: 'capture'; unitId: number; at: Axial }
  | { kind: 'produce'; unitId: number; at: Axial; type: UnitTypeId };

/** AI 세력 하나의 턴을 실행하고 애니메이션 재생용 행동 로그를 반환한다. */
export function runAiTurn(state: GameState, faction: FactionId): AiAction[] {
  const log: AiAction[] = [];
  if (state.over || state.factions[faction].eliminated) return log;

  const unitIds = unitsOf(state, faction).map((u) => u.id);
  for (const uid of unitIds) {
    const unit = unitById(state, uid);
    if (!unit || state.over) break;
    actUnit(state, unit, log);
  }
  produceUnits(state, faction, log);
  return log;
}

function actUnit(state: GameState, unit: Unit, log: AiAction[]): void {
  // 1) 이동 후 공격까지 고려한 최적 공격 시도
  if (tryAttack(state, unit, log)) return;
  // 2) 도달 가능한 점령 대상(중립·적 거점)으로 이동
  if (tryCapture(state, unit, log)) return;
  // 3) 가장 가까운 목표를 향해 전진
  tryAdvance(state, unit, log);
}

interface AttackPlan {
  destKey: string | null;
  target: Unit;
  score: number;
}

function tryAttack(state: GameState, unit: Unit, log: AiAction[]): boolean {
  if (unit.attacked) return false;
  const range = UNIT_STATS[unit.type].range;
  const enemies = state.units.filter((u) => u.faction !== unit.faction);
  if (enemies.length === 0) return false;

  const reach = unit.moved ? null : movementRange(state, unit);
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
    for (const enemy of enemies) {
      if (hexDistance(pos, enemy) > range) continue;
      const dmg = damageBreakdown(state, unit, enemy, {
        attackerPos: { q: pos.q, r: pos.r },
        attackerMoved: pos.key ? true : unit.moved,
      }).total;
      let score = dmg;
      if (dmg >= enemy.hp) score += 20; // 처치 가능하면 최우선
      score += (UNIT_STATS[enemy.type].hp - enemy.hp) * 0.3; // 약한 적 선호
      if (!best || score > best.score) best = { destKey: pos.key, target: enemy, score };
    }
  }
  if (!best) return false;

  if (best.destKey && reach) {
    const entry = reach.get(best.destKey)!;
    const result = moveUnit(state, unit.id, { q: entry.q, r: entry.r });
    if (result.ok && result.path) {
      log.push({ kind: 'move', unitId: unit.id, path: result.path });
      if (result.captured) log.push({ kind: 'capture', unitId: unit.id, at: { q: entry.q, r: entry.r } });
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

function tryCapture(state: GameState, unit: Unit, log: AiAction[]): boolean {
  if (unit.moved) return false;
  const reach = movementRange(state, unit);
  let best: { key: string; value: number } | null = null;
  for (const [key, e] of reach) {
    if (key === hexKey(unit.q, unit.r)) continue;
    if (unitAt(state, e.q, e.r)) continue;
    const tile = tileAt(state, e.q, e.r);
    if (!tile?.building || tile.owner === unit.faction) continue;
    const value = (tile.building === 'capital' ? 100 : 50) - e.cost;
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

function tryAdvance(state: GameState, unit: Unit, log: AiAction[]): void {
  if (unit.moved) return;
  // 목표: 적·중립 거점과 적 유닛 중 가장 가까운 것
  const objectives: Axial[] = [];
  for (const t of state.tiles) {
    if (t.building && t.owner !== unit.faction) objectives.push(t);
  }
  for (const u of state.units) {
    if (u.faction !== unit.faction) objectives.push(u);
  }
  if (objectives.length === 0) return;
  objectives.sort((a, b) => hexDistance(unit, a) - hexDistance(unit, b));
  const goal = objectives[0];

  const reach = movementRange(state, unit);
  let best: { key: string; dist: number; cost: number } | null = null;
  for (const [key, e] of reach) {
    if (key === hexKey(unit.q, unit.r)) continue;
    if (unitAt(state, e.q, e.r)) continue;
    const dist = hexDistance(e, goal);
    if (!best || dist < best.dist || (dist === best.dist && e.cost < best.cost)) {
      best = { key, dist, cost: e.cost };
    }
  }
  if (!best || best.dist >= hexDistance(unit, goal)) return; // 전진이 안 되면 대기
  const entry = reach.get(best.key)!;
  const path = reconstructPath(reach, { q: entry.q, r: entry.r });
  const result = moveUnit(state, unit.id, { q: entry.q, r: entry.r });
  if (result.ok && path) {
    log.push({ kind: 'move', unitId: unit.id, path });
    if (result.captured) log.push({ kind: 'capture', unitId: unit.id, at: { q: entry.q, r: entry.r } });
  }
}

function produceUnits(state: GameState, faction: FactionId, log: AiAction[]): void {
  const fs = state.factions[faction];
  const spots = state.tiles.filter(
    (t) => t.building && t.owner === faction && !unitAt(state, t.q, t.r),
  );
  const order: UnitTypeId[] = ['infantry', 'archer', 'cavalry'];
  for (const spot of spots) {
    if (unitsOf(state, faction).length >= MAX_UNITS_PER_FACTION) break;
    // 여유 자금이 많으면 기병, 아니면 보병·궁병 균형
    const count = unitsOf(state, faction).length;
    let type: UnitTypeId = order[count % 2 === 0 ? 0 : 1];
    if (fs.gold >= unitCost(faction, 'cavalry') + 30) type = 'cavalry';
    if (fs.gold < unitCost(faction, type)) type = 'infantry';
    if (fs.gold < unitCost(faction, type)) break;
    const result = produceUnit(state, faction, spot, type);
    if (result.ok && result.unit) {
      log.push({ kind: 'produce', unitId: result.unit.id, at: { q: spot.q, r: spot.r }, type });
    }
  }
}

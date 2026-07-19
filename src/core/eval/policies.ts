// 한 줄 목적: 캠페인 품질 매트릭스용 테스트 전용 인간 대체 평가 정책 5종 — 실제 게임 AI를 대체하지 않는다
import { runAiTurn, type AiTurnResult } from '../ai';
import { tileAt, unitAt, unitById, unitsOf } from '../board';
import { issueCommand, type CommandExecutionResult, type GameCommandPayload } from '../command';
import { MAX_UNITS_PER_FACTION } from '../data';
import { forecastAttack, unitCost, unitRange } from '../game';
import { hexDistance, hexKey } from '../hex';
import { movementRange } from '../pathfind';
import { mulberry32, type Rng } from '../rng';
import type { Axial, FactionId, GameState, Tile, Unit, UnitTypeId } from '../types';

export type EvalPolicyId = 'aggressive' | 'defensive' | 'economic' | 'balanced' | 'noisy';

export const EVAL_POLICY_IDS: EvalPolicyId[] = [
  'aggressive',
  'defensive',
  'economic',
  'balanced',
  'noisy',
];

export const EVAL_POLICY_NAMES: Record<EvalPolicyId, string> = {
  aggressive: '공격 우선',
  defensive: '방어 우선',
  economic: '경제 우선',
  balanced: '균형(공개 AI)',
  noisy: '균형·시드 변형',
};

/** 정책별 성향 계수. 모든 행동은 정본 명령 실행기를 거치므로 불법 행동은 발행되지 않는다. */
interface PolicyProfile {
  /** 처치 보너스 가중 */
  killBonus: number;
  /** 반격 피해 감점 계수(0 = 반격 무시) */
  counterPenalty: number;
  /** 처치 없이 자신이 죽는 교환 회피 */
  avoidBadTrades: boolean;
  /** 전진 목표 선택 방식 */
  advance: 'enemy-capital' | 'objectives' | 'economy';
  /** 자기 수도에서 이 거리 밖으로 진격하지 않는다(방어 성향) */
  maxAdvanceFromCapital?: number;
  /** 생산 성향 */
  production: 'attack' | 'defense' | 'economy';
}

const POLICY_PROFILES: Record<Exclude<EvalPolicyId, 'balanced' | 'noisy'>, PolicyProfile> = {
  aggressive: {
    killBonus: 60,
    counterPenalty: 0.1,
    avoidBadTrades: false,
    advance: 'enemy-capital',
    production: 'attack',
  },
  defensive: {
    killBonus: 25,
    counterPenalty: 1.2,
    avoidBadTrades: true,
    advance: 'objectives',
    maxAdvanceFromCapital: 4,
    production: 'defense',
  },
  economic: {
    killBonus: 15,
    counterPenalty: 1.0,
    avoidBadTrades: true,
    advance: 'economy',
    production: 'economy',
  },
};

/**
 * 평가 정책으로 한 세력의 페이즈를 실행한다(END_PHASE 포함).
 * - balanced: 공개 보통 AI 그대로
 * - noisy: 공개 보통 AI와 동일한 후보 평가에 시드 기반 결정론적 동점 분해(유닛 행동 순서 셔플)를 더한다
 * 같은 (state, policy, seed)에 대해 항상 같은 명령열을 낸다.
 */
export function runEvalPolicyTurn(
  state: GameState,
  faction: FactionId,
  policy: EvalPolicyId,
  seed = 0,
): EvalTurnResult {
  if (policy === 'balanced') return { ...runAiTurn(state, faction, 'normal'), rejected: 0 };
  if (policy === 'noisy') return runNoisyTurn(state, faction, seed);
  return runProfileTurn(state, faction, POLICY_PROFILES[policy]);
}

type IssueFn = (payload: GameCommandPayload) => CommandExecutionResult;

/** 평가 정책 턴 결과: 정본 AI 결과에 거부된 명령 수를 더한다(품질 시험 보고용). */
export interface EvalTurnResult extends AiTurnResult {
  /** 실행기가 거부한 명령 발행 시도 수(불법 행동은 상태에 반영되지 않는다) */
  rejected: number;
}

function makeResult(state: GameState): { result: EvalTurnResult; issue: IssueFn } {
  const result: EvalTurnResult = { commands: [], events: [], rejected: 0 };
  const issue: IssueFn = (payload) => {
    const r = issueCommand(state, payload, 'test');
    if (r.ok) {
      result.commands.push(r.command);
      result.events.push(...r.events);
    } else {
      result.rejected++;
    }
    return r;
  };
  return { result, issue };
}

// ---------------- noisy: 시드 동점 분해 ----------------

/**
 * 보통 AI와 같은 결정 로직을 쓰되, 유닛 행동 순서를 시드로 셔플해 궤적을 갈라 낸다.
 * 명령 자체는 항상 정본 실행기를 통과하므로 불법 행동은 생기지 않는다.
 */
function runNoisyTurn(state: GameState, faction: FactionId, seed: number): EvalTurnResult {
  const { result, issue } = makeResult(state);
  if (state.over || faction !== state.current) return result;
  if (state.factions[faction].eliminated) {
    issue({ type: 'end-phase' });
    return result;
  }
  // 턴·명령 순번을 섞은 시드: 같은 시드는 같은 궤적, 다른 시드는 다른 행동 순서
  const rng = mulberry32((seed ^ (state.turn * 2654435761) ^ (state.cmdSeq ?? 0)) >>> 0);
  actAllUnits(state, faction, NOISY_PROFILE, issue, rng);
  if (!state.over) producePolicy(state, faction, NOISY_PROFILE, issue);
  if (!state.over) issue({ type: 'end-phase' });
  return result;
}

/** noisy의 기본 성향: 균형에 가깝게 두고 순서 셔플로만 궤적을 가른다. */
const NOISY_PROFILE: PolicyProfile = {
  killBonus: 30,
  counterPenalty: 0.8,
  avoidBadTrades: false,
  advance: 'objectives',
  production: 'economy',
};

// ---------------- 프로파일 실행 ----------------

function runProfileTurn(state: GameState, faction: FactionId, profile: PolicyProfile): EvalTurnResult {
  const { result, issue } = makeResult(state);
  if (state.over || faction !== state.current) return result;
  if (state.factions[faction].eliminated) {
    issue({ type: 'end-phase' });
    return result;
  }
  actAllUnits(state, faction, profile, issue, null);
  if (!state.over) producePolicy(state, faction, profile, issue);
  if (!state.over) issue({ type: 'end-phase' });
  return result;
}

function actAllUnits(
  state: GameState,
  faction: FactionId,
  profile: PolicyProfile,
  issue: IssueFn,
  rng: Rng | null,
): void {
  let ids = unitsOf(state, faction).map((u) => u.id);
  if (rng) {
    // 결정론적 셔플(동점 분해): 같은 rng 시드는 같은 순서를 낸다
    const arr = ids.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    ids = arr;
  }
  for (const uid of ids) {
    const unit = unitById(state, uid);
    if (!unit || state.over) break;
    actUnit(state, unit, profile, issue);
  }
}

function actUnit(state: GameState, unit: Unit, profile: PolicyProfile, issue: IssueFn): void {
  if (tryPolicyAttack(state, unit, profile, issue)) return;
  if (profile.advance === 'economy' && tryEconomyCapture(state, unit, issue)) return;
  if (tryCaptureAny(state, unit, issue)) return;
  advanceUnit(state, unit, profile, issue);
}

function enemiesOf(state: GameState, faction: FactionId): Unit[] {
  return state.units.filter((u) => u.faction !== faction);
}

/** 이동+공격 후보를 정책 가중치로 평가해 최선의 공격을 실행한다. */
function tryPolicyAttack(
  state: GameState,
  unit: Unit,
  profile: PolicyProfile,
  issue: IssueFn,
): boolean {
  if (unit.attacked) return false;
  const enemies = enemiesOf(state, unit.faction);
  if (enemies.length === 0) return false;
  const range = unitRange(unit);

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

  let best: { destKey: string | null; targetId: number; score: number } | null = null;
  for (const pos of positions) {
    for (const enemy of enemies) {
      if (!unitById(state, enemy.id)) continue;
      if (hexDistance(pos, enemy) > range) continue;
      const fc = forecastAttack(state, unit, enemy, {
        attackerPos: { q: pos.q, r: pos.r },
        attackerMoved: pos.key ? true : unit.moved,
      });
      if (profile.avoidBadTrades && fc.attackerDies && !fc.defenderDies) continue;
      let score = fc.damage.total;
      if (fc.defenderDies) score += profile.killBonus;
      if (fc.counter) score -= fc.counter.total * profile.counterPenalty;
      if (fc.attackerDies) score -= profile.avoidBadTrades ? 60 : 10;
      if (!best || score > best.score) best = { destKey: pos.key, targetId: enemy.id, score };
    }
  }
  if (!best) return false;
  if (profile.avoidBadTrades && best.score <= 0) return false;
  if (best.destKey && reach) {
    const entry = reach.get(best.destKey)!;
    issue({ type: 'move-unit', unitId: unit.id, to: { q: entry.q, r: entry.r } });
    if (state.over) return true; // 이동 점령으로 게임이 끝나면 후속 공격을 발행하지 않는다
  }
  return issue({ type: 'attack-unit', attackerId: unit.id, defenderId: best.targetId }).ok;
}

/** 경제 정책: 마을·생산 거점 점령을 최우선으로 한다. */
function tryEconomyCapture(state: GameState, unit: Unit, issue: IssueFn): boolean {
  if (unit.moved) return false;
  const reach = movementRange(state, unit);
  let best: { key: string; value: number } | null = null;
  for (const [key, e] of reach) {
    if (key === hexKey(unit.q, unit.r)) continue;
    if (unitAt(state, e.q, e.r)) continue;
    const tile = tileAt(state, e.q, e.r);
    if (!tile?.building || tile.owner === unit.faction) continue;
    const value = (tile.building === 'village' ? 120 : 60) - e.cost;
    if (!best || value > best.value) best = { key, value };
  }
  if (!best) return false;
  const entry = reach.get(best.key)!;
  return issue({ type: 'move-unit', unitId: unit.id, to: { q: entry.q, r: entry.r } }).ok;
}

/** 도달 가능한 미소유 거점이 있으면 점령한다(모든 정책 공용 폴백). */
function tryCaptureAny(state: GameState, unit: Unit, issue: IssueFn): boolean {
  if (unit.moved) return false;
  const reach = movementRange(state, unit);
  let best: { key: string; value: number } | null = null;
  for (const [key, e] of reach) {
    if (key === hexKey(unit.q, unit.r)) continue;
    if (unitAt(state, e.q, e.r)) continue;
    const tile = tileAt(state, e.q, e.r);
    if (!tile?.building || tile.owner === unit.faction) continue;
    const value =
      (tile.building === 'capital' ? 150 : tile.building === 'crown' ? 130 : 80) - e.cost;
    if (!best || value > best.value) best = { key, value };
  }
  if (!best) return false;
  const entry = reach.get(best.key)!;
  return issue({ type: 'move-unit', unitId: unit.id, to: { q: entry.q, r: entry.r } }).ok;
}

function myCapital(state: GameState, faction: FactionId): Tile | null {
  return state.tiles.find((t) => t.building === 'capital' && t.owner === faction) ?? null;
}

/** 정책 목표를 향해 전진한다. 방어 정책은 수도 반경을 벗어나지 않는다. */
function advanceUnit(state: GameState, unit: Unit, profile: PolicyProfile, issue: IssueFn): void {
  if (unit.moved) return;
  const faction = unit.faction;
  let goal: Axial | null = null;

  if (profile.advance === 'enemy-capital') {
    const cap = state.tiles
      .filter((t) => t.building === 'capital' && t.owner !== undefined && t.owner !== faction)
      .sort((a, b) => hexDistance(unit, a) - hexDistance(unit, b))[0];
    goal = cap ?? nearestEnemy(state, unit) ?? nearestObjective(state, unit);
  } else if (profile.advance === 'economy') {
    goal = nearestUnownedBuilding(state, unit, 'village') ?? nearestObjective(state, unit);
  } else {
    goal = nearestObjective(state, unit) ?? nearestEnemy(state, unit);
  }
  if (!goal) return;

  const cap = profile.maxAdvanceFromCapital !== undefined ? myCapital(state, faction) : null;
  const reach = movementRange(state, unit);
  const currentDist = hexDistance(unit, goal);
  let best: { key: string; dist: number; cost: number } | null = null;
  for (const [key, e] of reach) {
    if (key === hexKey(unit.q, unit.r)) continue;
    if (unitAt(state, e.q, e.r)) continue;
    // 방어 정책: 수도에서 너무 멀어지는 이동은 하지 않는다
    if (cap && hexDistance(e, cap) > profile.maxAdvanceFromCapital!) continue;
    const dist = hexDistance(e, goal);
    if (!best || dist < best.dist || (dist === best.dist && e.cost < best.cost)) {
      best = { key, dist, cost: e.cost };
    }
  }
  if (!best || best.dist >= currentDist) return;
  const entry = reach.get(best.key)!;
  issue({ type: 'move-unit', unitId: unit.id, to: { q: entry.q, r: entry.r } });
}

function nearestObjective(state: GameState, unit: Unit): Axial | null {
  const t = state.tiles
    .filter((t) => t.building && t.owner !== unit.faction)
    .sort((a, b) => hexDistance(unit, a) - hexDistance(unit, b))[0];
  return t ?? null;
}

function nearestEnemy(state: GameState, unit: Unit): Axial | null {
  const e = enemiesOf(state, unit.faction)
    .slice()
    .sort((a, b) => hexDistance(unit, a) - hexDistance(unit, b))[0];
  return e ? { q: e.q, r: e.r } : null;
}

function nearestUnownedBuilding(
  state: GameState,
  unit: Unit,
  prefer: 'village',
): Axial | null {
  const candidates = state.tiles.filter((t) => t.building && t.owner !== unit.faction);
  if (candidates.length === 0) return null;
  const villages = candidates.filter((t) => t.building === prefer);
  const pool = villages.length > 0 ? villages : candidates;
  return pool.sort((a, b) => hexDistance(unit, a) - hexDistance(unit, b))[0];
}

// ---------------- 생산 ----------------

function producePolicy(
  state: GameState,
  faction: FactionId,
  profile: PolicyProfile,
  issue: IssueFn,
): void {
  const fs = state.factions[faction];
  const spots = state.tiles.filter(
    (t) => t.building && t.owner === faction && !unitAt(state, t.q, t.r),
  );
  spots.sort((a, b) => (b.building === 'capital' ? 1 : 0) - (a.building === 'capital' ? 1 : 0));
  for (const spot of spots) {
    if (unitsOf(state, faction).length >= MAX_UNITS_PER_FACTION) break;
    let type = pickType(state, faction, profile);
    if (fs.gold < unitCost(faction, type, state.config.modifier)) type = 'infantry';
    if (fs.gold < unitCost(faction, type, state.config.modifier)) break;
    issue({ type: 'produce-unit', at: { q: spot.q, r: spot.r }, unitType: type });
  }
}

function pickType(state: GameState, faction: FactionId, profile: PolicyProfile): UnitTypeId {
  const mine = unitsOf(state, faction);
  const count = mine.length;
  if (profile.production === 'attack') {
    // 기병·궁병 위주의 공격 편성
    if (
      count % 3 !== 0 &&
      state.factions[faction].gold >= unitCost(faction, 'cavalry', state.config.modifier)
    )
      return 'cavalry';
    return count % 3 === 0 ? 'infantry' : 'archer';
  }
  if (profile.production === 'defense') {
    // 보병·궁병 위주의 방어 편성
    return count % 3 === 2 ? 'archer' : 'infantry';
  }
  // economy: 저렴한 보병으로 확장 속도를 낸다
  return count % 4 === 3 ? 'archer' : 'infantry';
}

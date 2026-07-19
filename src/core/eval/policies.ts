// 한 줄 목적: 캠페인·밸런스 품질 시험용 테스트 전용 인간 대체 평가 정책(실제 인간 데이터가 아닌 테스트 전용 대체 정책)
import { runAiTurn, type AiTurnResult } from '../ai';
import { tileAt, unitAt, unitById, unitsOf } from '../board';
import { issueCommand, type CommandExecutionResult, type GameCommandPayload } from '../command';
import { MAX_UNITS_PER_FACTION, UNIT_STATS } from '../data';
import { forecastAttack, unitCost, unitRange } from '../game';
import { hexDistance, hexKey, neighbors } from '../hex';
import { movementRange } from '../pathfind';
import { mulberry32, type Rng } from '../rng';
import { crownStatus } from '../scenario/crown-status';
import type { Axial, FactionId, GameState, Tile, Unit, UnitTypeId } from '../types';

export type EvalPolicyId =
  | 'aggressive'
  | 'defensive'
  | 'economic'
  | 'balanced'
  | 'noisy'
  | 'objective-denial'
  | 'human-like-cautious'
  | 'human-like-direct';

export const EVAL_POLICY_IDS: EvalPolicyId[] = [
  'aggressive',
  'defensive',
  'economic',
  'balanced',
  'noisy',
  'objective-denial',
  'human-like-cautious',
  'human-like-direct',
];

export const EVAL_POLICY_NAMES: Record<EvalPolicyId, string> = {
  aggressive: '공격 우선',
  defensive: '방어 우선',
  economic: '경제 우선',
  balanced: '균형(공개 AI)',
  noisy: '균형·시드 변형',
  'objective-denial': '목표 저지',
  'human-like-cautious': '신중형',
  'human-like-direct': '직행형',
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
  /**
   * 목표 저지: 활성화된 왕관을 적이 보유하면 왕관/인접 점령·경합을 최우선한다.
   * (실제 인간 데이터가 아닌 테스트 전용 대체 정책 플래그)
   */
  denyObjective?: boolean;
  /**
   * 신중형: 초반 이동 제한·고립 회피.
   * (실제 인간 데이터가 아닌 테스트 전용 대체 정책 플래그)
   */
  cautiousFirstMoves?: boolean;
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
  // 실제 인간 데이터가 아닌 테스트 전용 대체 정책: 적 활성 왕관 점령·경합 저지
  'objective-denial': {
    killBonus: 40,
    counterPenalty: 0.5,
    avoidBadTrades: false,
    advance: 'objectives',
    production: 'attack',
    denyObjective: true,
  },
  // 실제 인간 데이터가 아닌 테스트 전용 대체 정책: 초반 신중 전진·고립 회피
  'human-like-cautious': {
    killBonus: 25,
    counterPenalty: 1.0,
    avoidBadTrades: true,
    advance: 'objectives',
    maxAdvanceFromCapital: 5,
    production: 'defense',
    cautiousFirstMoves: true,
  },
  // 실제 인간 데이터가 아닌 테스트 전용 대체 정책: 핵심 목표 최단 직행
  'human-like-direct': {
    killBonus: 35,
    counterPenalty: 0.6,
    avoidBadTrades: false,
    advance: 'objectives',
    production: 'attack',
  },
};

/**
 * 평가 정책으로 한 세력의 페이즈를 실행한다(END_PHASE 포함).
 * - balanced: 공개 보통 AI 그대로
 * - noisy: 공개 보통 AI와 동일한 후보 평가에 시드 기반 결정론적 동점 분해(유닛 행동 순서 셔플)를 더한다
 * 같은 (state, policy, seed)에 대해 항상 같은 명령열을 낸다.
 * 모든 정책은 실제 인간 데이터가 아닌 테스트 전용 대체 정책이다.
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
  // 목표 저지: 적 활성 왕관 보유 시 점령·경합·관련 공격을 최우선
  if (profile.denyObjective && tryDenyObjective(state, unit, profile, issue)) return;
  if (tryPolicyAttack(state, unit, profile, issue)) return;
  if (profile.advance === 'economy' && tryEconomyCapture(state, unit, issue)) return;
  if (tryCaptureAny(state, unit, issue)) return;
  advanceUnit(state, unit, profile, issue);
}

/**
 * 활성화된 왕관을 적이 보유하면 왕관 위 점령 또는 인접 경합 이동을 최우선한다.
 * 왕관 위 적 공격도 포함한다. 조건 불충족 시 false.
 */
function tryDenyObjective(
  state: GameState,
  unit: Unit,
  profile: PolicyProfile,
  issue: IssueFn,
): boolean {
  const cs = crownStatus(state);
  if (!cs || !cs.active || !cs.owner || cs.owner === unit.faction) return false;
  const crown = cs.at;

  // 왕관 위 적 또는 왕관 소유 세력 유닛 우선 공격
  if (!unit.attacked) {
    const enemies = enemiesOf(state, unit.faction).filter(
      (e) =>
        e.faction === cs.owner &&
        (hexDistance(e, crown) === 0 || hexDistance(e, crown) === 1),
    );
    if (enemies.length > 0) {
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
          let score = fc.damage.total + 40;
          if (hexDistance(enemy, crown) === 0) score += 50;
          if (fc.defenderDies) score += profile.killBonus;
          if (fc.counter) score -= fc.counter.total * profile.counterPenalty;
          if (!best || score > best.score) best = { destKey: pos.key, targetId: enemy.id, score };
        }
      }
      if (best) {
        if (best.destKey && reach) {
          const entry = reach.get(best.destKey)!;
          issue({ type: 'move-unit', unitId: unit.id, to: { q: entry.q, r: entry.r } });
          if (state.over) return true;
        }
        if (issue({ type: 'attack-unit', attackerId: unit.id, defenderId: best.targetId }).ok)
          return true;
      }
    }
  }

  if (unit.moved) return false;

  // 이미 왕관 위·인접이면 일반 공격/점령 흐름에 맡긴다(위치 유지)
  if (hexDistance(unit, crown) <= 1) return false;

  const reach = movementRange(state, unit);
  // ① 왕관 타일 점령
  const crownKey = hexKey(crown.q, crown.r);
  const crownEntry = reach.get(crownKey);
  if (crownEntry && !unitAt(state, crown.q, crown.r)) {
    return issue({ type: 'move-unit', unitId: unit.id, to: { q: crown.q, r: crown.r } }).ok;
  }
  // ② 인접 빈칸으로 경합
  let bestAdj: { q: number; r: number; cost: number } | null = null;
  for (const n of neighbors(crown)) {
    if (unitAt(state, n.q, n.r)) continue;
    const t = tileAt(state, n.q, n.r);
    if (!t || t.terrain === 'water') continue;
    const e = reach.get(hexKey(n.q, n.r));
    if (!e) continue;
    if (!bestAdj || e.cost < bestAdj.cost) bestAdj = { q: n.q, r: n.r, cost: e.cost };
  }
  if (bestAdj) {
    return issue({ type: 'move-unit', unitId: unit.id, to: { q: bestAdj.q, r: bestAdj.r } }).ok;
  }
  // ③ 왕관을 향해 전진
  const currentDist = hexDistance(unit, crown);
  let best: { key: string; dist: number; cost: number } | null = null;
  for (const [key, e] of reach) {
    if (key === hexKey(unit.q, unit.r)) continue;
    if (unitAt(state, e.q, e.r)) continue;
    const dist = hexDistance(e, crown);
    if (!best || dist < best.dist || (dist === best.dist && e.cost < best.cost)) {
      best = { key, dist, cost: e.cost };
    }
  }
  if (!best || best.dist >= currentDist) return false;
  const entry = reach.get(best.key)!;
  return issue({ type: 'move-unit', unitId: unit.id, to: { q: entry.q, r: entry.r } }).ok;
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
      // 신중형: 고립 위협 위치로는 이동+공격하지 않는다
      if (profile.cautiousFirstMoves && wouldIsolate(state, unit, e)) continue;
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

/**
 * 신중형: 목적지가 적 위협권에 있고 인접 아군이 없으면 고립으로 본다.
 * (실제 인간 데이터가 아닌 테스트 전용 대체 정책 보조)
 */
function wouldIsolate(state: GameState, unit: Unit, dest: Axial): boolean {
  const enemies = enemiesOf(state, unit.faction);
  const threatened = enemies.some((e) => {
    const threatRange = UNIT_STATS[e.type].move + UNIT_STATS[e.type].range;
    return hexDistance(dest, e) <= Math.min(threatRange, 3);
  });
  if (!threatened) return false;
  const allyNearby = state.units.some(
    (u) =>
      u.faction === unit.faction &&
      u.id !== unit.id &&
      hexDistance(u, dest) <= 2,
  );
  return !allyNearby;
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
    // objectives(직행형 포함): 왕관 > 수도 > 마을 핵심 목표로 최단 전진
    goal = nearestKeyObjective(state, unit) ?? nearestEnemy(state, unit);
  }
  if (!goal) return;

  const cap = profile.maxAdvanceFromCapital !== undefined || profile.cautiousFirstMoves
    ? myCapital(state, faction)
    : null;
  const maxFromCap =
    profile.cautiousFirstMoves && state.turn <= 2
      ? Math.min(profile.maxAdvanceFromCapital ?? 5, 3)
      : profile.maxAdvanceFromCapital;
  // 신중형 첫 2턴: 한 턴 이동량을 최대 이동력의 절반으로 제한(과도한 최장 진격 방지)
  const maxCost =
    profile.cautiousFirstMoves && state.turn <= 2
      ? Math.max(1, Math.floor(UNIT_STATS[unit.type].move / 2))
      : Infinity;

  const reach = movementRange(state, unit);
  const currentDist = hexDistance(unit, goal);
  let best: { key: string; dist: number; cost: number } | null = null;
  for (const [key, e] of reach) {
    if (key === hexKey(unit.q, unit.r)) continue;
    if (unitAt(state, e.q, e.r)) continue;
    if (e.cost > maxCost) continue;
    // 방어·신중: 수도에서 너무 멀어지는 이동은 하지 않는다
    if (cap && maxFromCap !== undefined && hexDistance(e, cap) > maxFromCap) continue;
    // 신중형: 홀로 적 위협권에 고립되는 목적지 회피
    if (profile.cautiousFirstMoves && wouldIsolate(state, unit, e)) continue;
    const dist = hexDistance(e, goal);
    if (!best || dist < best.dist || (dist === best.dist && e.cost < best.cost)) {
      best = { key, dist, cost: e.cost };
    }
  }
  if (!best || best.dist >= currentDist) return;
  const entry = reach.get(best.key)!;
  issue({ type: 'move-unit', unitId: unit.id, to: { q: entry.q, r: entry.r } });
}

/** 핵심 목표(왕관 > 수도 > 마을) 중 가장 가까운 것을 고른다. */
function nearestKeyObjective(state: GameState, unit: Unit): Axial | null {
  for (const kind of ['crown', 'capital', 'village'] as const) {
    const t = state.tiles
      .filter((x) => x.building === kind && x.owner !== unit.faction)
      .sort((a, b) => hexDistance(unit, a) - hexDistance(unit, b))[0];
    if (t) return t;
  }
  return nearestObjective(state, unit);
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

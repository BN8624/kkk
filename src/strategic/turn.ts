// 한 줄 목적: 전략 턴·세력 순서·수입·승패 판정 순수 엔진을 제공한다
import { FACTION_IDS } from '../core/data';
import type { FactionId } from '../core/types';
import { applyStrategicOrder } from './orders';
import { cloneStrategicState } from './state';
import type { StrategicGameState, StrategicResult } from './types';
import { validateStrategicState } from './validate';

function fail(reason: string): StrategicResult<StrategicGameState> {
  return { ok: false, reason };
}

/**
 * 인간 세력부터 시작하는 세력 행동 순서.
 * FACTION_IDS 정본 순서를 인간 기준으로 회전한다.
 * 예: human=crimson → crimson → violet → azure
 */
export function strategicFactionOrder(humanFaction: FactionId): FactionId[] {
  const start = FACTION_IDS.indexOf(humanFaction);
  if (start < 0) return [...FACTION_IDS];
  return FACTION_IDS.map((_, i) => FACTION_IDS[(start + i) % FACTION_IDS.length]);
}

/** 다음 행동 세력(순환). 마지막 다음은 인간(턴 종료 트리거). */
export function nextStrategicFaction(state: StrategicGameState): FactionId {
  const order = strategicFactionOrder(state.humanFaction);
  const idx = order.indexOf(state.currentFaction);
  if (idx < 0) return state.humanFaction;
  return order[(idx + 1) % order.length];
}

/** 현재 세력이 순서상 마지막(라운드 종료 직전)인지. */
export function isLastFactionInRound(state: StrategicGameState): boolean {
  const order = strategicFactionOrder(state.humanFaction);
  return order[order.length - 1] === state.currentFaction;
}

/** 소유 지역 수입 합계. */
export function factionRegionIncome(state: StrategicGameState, faction: FactionId): number {
  return state.regions
    .filter((r) => r.owner === faction)
    .reduce((sum, r) => sum + r.income, 0);
}

/**
 * 각 세력 소유 지역 income을 국고에 1회 지급한다.
 * 라운드 종료 시 resolveStrategicRound에서만 호출한다.
 */
export function collectStrategicIncome(
  state: StrategicGameState,
): StrategicResult<StrategicGameState> {
  if (state.winner !== undefined) return fail('game-ended');
  if (state.pendingBattle) return fail('battle-pending');
  const next = cloneStrategicState(state);
  for (const fid of FACTION_IDS) {
    next.treasury[fid] += factionRegionIncome(next, fid);
  }
  const check = validateStrategicState(next);
  if (!check.ok) return fail(check.reason);
  return { ok: true, value: next };
}

/** 세력 점수(10턴 종료·동점 판정용). 국고 제외. */
export function computeStrategicScores(
  state: StrategicGameState,
): Record<FactionId, number> {
  const scores = {} as Record<FactionId, number>;
  for (const fid of FACTION_IDS) {
    let score = 0;
    for (const r of state.regions) {
      if (r.owner !== fid) continue;
      score += 10;
      if (r.settlement === 'capital') score += 20;
    }
    for (const a of state.armies) {
      if (a.faction !== fid) continue;
      for (const u of a.units) {
        score += 2;
        score += Math.floor(u.hp / 5);
      }
    }
    scores[fid] = score;
  }
  return scores;
}

/**
 * 즉시 승리(세 수도 점령) 또는 10턴 종료 점수 승패.
 * mode='immediate' — 수도만 검사. mode='end-of-turn' — 수도 + turn>=maxTurns 점수.
 */
export function evaluateStrategicWinner(
  state: StrategicGameState,
  mode: 'immediate' | 'end-of-turn' = 'immediate',
): StrategicResult<{ winner?: FactionId | 'draw'; scores: Record<FactionId, number> }> {
  const scores = computeStrategicScores(state);
  const capitalOwners = state.regions
    .filter((r) => r.settlement === 'capital')
    .map((r) => r.owner);
  if (capitalOwners.length === 3 && capitalOwners.every((o) => o !== null)) {
    const first = capitalOwners[0];
    if (capitalOwners.every((o) => o === first) && first !== null) {
      return { ok: true, value: { winner: first, scores } };
    }
  }
  if (mode === 'end-of-turn' && state.turn >= state.maxTurns) {
    let best = -1;
    let winners: FactionId[] = [];
    for (const fid of FACTION_IDS) {
      const sc = scores[fid];
      if (sc > best) {
        best = sc;
        winners = [fid];
      } else if (sc === best) {
        winners.push(fid);
      }
    }
    if (winners.length === 1) return { ok: true, value: { winner: winners[0], scores } };
    return { ok: true, value: { winner: 'draw', scores } };
  }
  return { ok: true, value: { scores } };
}

/** 미행동 군단에 hold-army를 순차 적용. */
function holdUnmovedArmies(
  state: StrategicGameState,
  faction: FactionId,
): StrategicResult<StrategicGameState> {
  let cur = state;
  const armyIds = cur.armies
    .filter((a) => a.faction === faction && !a.moved)
    .map((a) => a.id)
    .sort();
  for (const id of armyIds) {
    const applied = applyStrategicOrder(cur, { type: 'hold-army', armyId: id }, faction);
    if (!applied.ok) return fail(applied.reason);
    cur = applied.value;
  }
  return { ok: true, value: cur };
}

/**
 * 현재 세력 페이즈를 종료하고 다음 세력으로 넘긴다.
 * 미행동 군단은 자동 hold. pending battle이면 중단 거부.
 * 마지막 세력이면 resolveStrategicRound를 호출한다.
 */
export function advanceStrategicFaction(
  state: StrategicGameState,
): StrategicResult<StrategicGameState> {
  if (state.winner !== undefined) return fail('game-ended');
  if (state.pendingBattle) return fail('battle-pending');
  if (state.phase !== 'orders') return fail('not-orders-phase');

  const held = holdUnmovedArmies(state, state.currentFaction);
  if (!held.ok) return held;

  // 수도 즉시 승리 검사(명령 중 점령 가능)
  const imm = evaluateStrategicWinner(held.value, 'immediate');
  if (!imm.ok) return fail(imm.reason);
  if (imm.value.winner !== undefined) {
    const ended = cloneStrategicState(held.value);
    ended.phase = 'ended';
    ended.winner = imm.value.winner;
    const check = validateStrategicState(ended);
    if (!check.ok) return fail(check.reason);
    return { ok: true, value: ended };
  }

  if (isLastFactionInRound(held.value)) {
    return resolveStrategicRound(held.value);
  }

  const next = cloneStrategicState(held.value);
  next.currentFaction = nextStrategicFaction(held.value);
  const check = validateStrategicState(next);
  if (!check.ok) return fail(check.reason);
  return { ok: true, value: next };
}

/**
 * 세 세력 페이즈 종료 후 라운드 마감.
 * 1) 승패 2) turn++ 또는 종료 3) moved reset 4) 수입 5) 인간 페이즈
 */
export function resolveStrategicRound(
  state: StrategicGameState,
): StrategicResult<StrategicGameState> {
  if (state.pendingBattle) return fail('battle-pending');
  if (state.winner !== undefined) return fail('game-ended');
  if (state.phase !== 'orders') return fail('not-orders-phase');

  // 10턴 종료: turn이 maxTurns인 라운드가 끝났을 때 점수 판정
  const endEval = evaluateStrategicWinner(state, 'end-of-turn');
  if (!endEval.ok) return fail(endEval.reason);
  if (endEval.value.winner !== undefined) {
    const ended = cloneStrategicState(state);
    ended.phase = 'ended';
    ended.winner = endEval.value.winner;
    const check = validateStrategicState(ended);
    if (!check.ok) return fail(check.reason);
    return { ok: true, value: ended };
  }

  // 즉시 수도 승리도 라운드 경계에서 재확인
  const imm = evaluateStrategicWinner(state, 'immediate');
  if (!imm.ok) return fail(imm.reason);
  if (imm.value.winner !== undefined) {
    const ended = cloneStrategicState(state);
    ended.phase = 'ended';
    ended.winner = imm.value.winner;
    const check = validateStrategicState(ended);
    if (!check.ok) return fail(check.reason);
    return { ok: true, value: ended };
  }

  let next = cloneStrategicState(state);
  next.turn += 1;
  for (const a of next.armies) a.moved = false;

  const income = collectStrategicIncome(next);
  if (!income.ok) return income;
  next = income.value;
  next.currentFaction = next.humanFaction;
  next.phase = 'orders';

  const check = validateStrategicState(next);
  if (!check.ok) return fail(check.reason);
  return { ok: true, value: next };
}

/**
 * 전투 반영 후 즉시 승패 검사. 승자 있으면 ended, 없으면 입력 유지.
 * 입력 상태를 직접 변이하지 않는다.
 */
export function applyWinnerIfAny(
  state: StrategicGameState,
): StrategicResult<StrategicGameState> {
  if (state.winner !== undefined) return { ok: true, value: state };
  const imm = evaluateStrategicWinner(state, 'immediate');
  if (!imm.ok) return fail(imm.reason);
  if (imm.value.winner === undefined) return { ok: true, value: state };
  const next = cloneStrategicState(state);
  next.phase = 'ended';
  next.winner = imm.value.winner;
  const check = validateStrategicState(next);
  if (!check.ok) return fail(check.reason);
  return { ok: true, value: next };
}

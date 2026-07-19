// 한 줄 목적: 게임 상태에 대해 승리·패배·별점 조건을 평가하는 순수 함수를 제공한다
import { tileAt, unitsOf } from '../board';
import type { FactionId, GameState } from '../types';
import type { DefeatCondition, StarCondition, VictoryCondition } from './types';

/** 첫 hold-building 승리 조건을 반환한다(연속 보유 추적 대상). */
export function holdVictoryCondition(
  state: GameState,
): { at: { q: number; r: number }; turns: number } | null {
  for (const c of state.objectives.victory) {
    if (c.type === 'hold-building') return { at: c.at, turns: c.turns };
  }
  return null;
}

/** 정복 조건(모든 수도 점령) 포함 여부 — 대칭 규칙으로 평가된다. */
export function hasConquest(state: GameState): boolean {
  return state.objectives.victory.some((c) => c.type === 'conquest');
}

/** 인간 세력 기준 승리 조건 평가. score는 게임 엔진의 점수 함수를 주입받는다. */
export function victoryMet(
  state: GameState,
  c: VictoryCondition,
  score: (state: GameState, faction: FactionId) => number,
): boolean {
  const me = state.config.humanFaction;
  switch (c.type) {
    case 'conquest': {
      const caps = state.tiles.filter((t) => t.building === 'capital');
      return caps.length > 0 && caps.every((t) => t.owner === me);
    }
    case 'hold-building': {
      const h = state.crownHold;
      return !!h && h.owner === me && h.turns >= c.turns;
    }
    case 'capture-building':
      return tileAt(state, c.at.q, c.at.r)?.owner === me;
    case 'capture-count':
      return (
        state.tiles.filter((t) => t.building === c.building && t.owner === me).length >= c.count
      );
    case 'eliminate-faction':
      return state.factions[c.faction].eliminated;
    case 'survive-turns':
      return state.turn > c.turns && !state.factions[me].eliminated;
    case 'reach-score':
      return score(state, me) >= c.score;
    case 'unit-alive':
      return state.units.some((u) => u.tag === c.tag);
    case 'all-of':
      return c.conditions.every((x) => victoryMet(state, x, score));
    case 'any-of':
      return c.conditions.some((x) => victoryMet(state, x, score));
  }
}

/** 인간 세력 기준 패배 조건 평가(turn-limit은 턴 종료 판정에서 별도로 처리). */
export function defeatMet(state: GameState, c: DefeatCondition): boolean {
  const me = state.config.humanFaction;
  switch (c.type) {
    case 'human-eliminated':
      return state.factions[me].eliminated;
    case 'lose-building':
      return tileAt(state, c.at.q, c.at.r)?.owner !== me;
    case 'unit-dies':
      return !state.units.some((u) => u.tag === c.tag);
    case 'enemy-captures': {
      const owner = tileAt(state, c.at.q, c.at.r)?.owner;
      return owner !== undefined && owner !== me;
    }
    case 'turn-limit':
      return false;
  }
}

/** 게임 종료 후 별점 조건 평가. 결과 배열은 조건 순서와 같다. */
export function starsEarned(state: GameState): boolean[] {
  const me = state.config.humanFaction;
  const finalTurn = Math.min(state.turn, state.maxTurns);
  return state.objectives.stars.map((c: StarCondition) => {
    switch (c.type) {
      case 'win':
        return state.winner === me;
      case 'win-within-turns':
        return state.winner === me && finalTurn <= c.turns;
      case 'units-alive-at-least':
        return unitsOf(state, me).length >= c.count;
      case 'units-lost-at-most':
        return state.stats[me].lost <= c.count;
      case 'buildings-captured-at-least':
        return state.stats[me].captured >= c.count;
      case 'kills-at-least':
        return state.stats[me].kills >= c.count;
      case 'unit-alive':
        return state.units.some((u) => u.tag === c.tag);
      case 'gold-at-least':
        return state.factions[me].gold >= c.amount;
    }
  });
}

/** 별 수(0~조건 수). 조건이 없으면 승리=1별로 취급하지 않고 0을 반환한다. */
export function starCount(state: GameState): number {
  return starsEarned(state).filter(Boolean).length;
}

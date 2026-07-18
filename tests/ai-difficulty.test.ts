// 한 줄 목적: 난이도별 AI 의사결정 차이(교환 회피·수도 방어·왕관 수비)를 검증한다
import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/core/ai';
import { tileAt, unitAt, unitsOf } from '../src/core/board';
import { advancePhase, newGame } from '../src/core/game';
import { hexDistance } from '../src/core/hex';
import type { Difficulty, GameState } from '../src/core/types';
import { addUnit, makeState } from './helpers';

describe('난이도별 의사결정', () => {
  it('어려움은 처치 불가·반격 사망 교환을 회피하고 보통은 공격한다', () => {
    const build = (difficulty: Difficulty): GameState => {
      const state = makeState({ difficulty });
      // 빈사 AI 보병(이동 완료) 옆에 산 위 적 보병: 공격해도 1피해, 반격에 죽는다
      addUnit(state, { faction: 'crimson', q: 0, r: 0, hp: 2, moved: true });
      const t = tileAt(state, 1, 0)!;
      t.terrain = 'mountain';
      addUnit(state, { faction: 'azure', q: 1, r: 0 });
      return state;
    };
    const hardState = build('hard');
    const hardLog = runAiTurn(hardState, 'crimson');
    expect(hardLog.some((a) => a.kind === 'attack')).toBe(false);
    expect(unitsOf(hardState, 'crimson')).toHaveLength(1); // 살아남음

    const normalState = build('normal');
    const normalLog = runAiTurn(normalState, 'crimson');
    expect(normalLog.some((a) => a.kind === 'attack')).toBe(true);
  });

  it('보통 이상은 위협받는 수도에 방어 유닛을 배치한다', () => {
    const state = makeState({ difficulty: 'hard' });
    const cap = tileAt(state, 0, 0)!;
    cap.building = 'capital';
    cap.owner = 'crimson';
    // 적이 수도 근접, 아군 유닛은 수도에서 2칸 거리
    addUnit(state, { faction: 'azure', q: 2, r: 0, type: 'cavalry', hp: 3 });
    const defender = addUnit(state, { faction: 'crimson', q: 0, r: 2 });
    runAiTurn(state, 'crimson');
    // 방어 역할: 위협을 공격했거나 수도 위·근처로 이동했다
    const after = unitsOf(state, 'crimson').find((u) => u.id === defender.id)!;
    const distToCap = hexDistance(after, { q: 0, r: 0 });
    const attacked = state.units.every((u) => u.faction !== 'azure' || u.hp < 3);
    expect(distToCap <= 1 || attacked).toBe(true);
  });

  it('왕관의 심장에서 AI가 소유한 빈 요새에 수비대를 보낸다', () => {
    const state = makeState({ difficulty: 'normal', scenario: 'crown-heart' });
    state.crownHold = { owner: 'crimson', turns: 1 };
    const crown = tileAt(state, 2, 2)!;
    crown.building = 'crown';
    crown.owner = 'crimson';
    addUnit(state, { faction: 'crimson', q: 2, r: 3 });
    addUnit(state, { faction: 'azure', q: -2, r: 0 });
    runAiTurn(state, 'crimson');
    expect(unitAt(state, 2, 2)?.faction).toBe('crimson');
  });

  it('모든 난이도에서 전체 게임이 종료되고 상태가 유효하다', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as Difficulty[]) {
      for (const seed of [3, 77, 20260719]) {
        const state = newGame(seed, { difficulty });
        let guard = 0;
        while (!state.over && guard < 200) {
          guard++;
          advancePhase(state); // 인간은 대기
          if (!state.over) {
            runAiTurn(state, 'crimson');
            advancePhase(state);
          }
          if (!state.over) {
            runAiTurn(state, 'violet');
            advancePhase(state);
          }
        }
        expect(state.over, `${difficulty} seed ${seed}`).toBe(true);
        const keys = state.units.map((u) => `${u.q},${u.r}`);
        expect(new Set(keys).size).toBe(keys.length);
        for (const f of state.order) {
          expect(state.factions[f].gold).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('난이도 오버라이드로 세력별 난이도를 달리할 수 있다', () => {
    const state = newGame(5, { difficulty: 'easy' });
    // 오버라이드가 오류 없이 동작하고 로그를 만든다
    const log = runAiTurn(state, 'crimson', 'hard');
    expect(Array.isArray(log)).toBe(true);
  });
});

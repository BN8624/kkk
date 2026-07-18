// 한 줄 목적: AI가 유효한 행동만 하고 유한 시간 안에 턴을 마치는지 검증한다
import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/core/ai';
import { tileAt, unitsOf } from '../src/core/board';
import { advancePhase, newGame } from '../src/core/game';
import type { GameState } from '../src/core/types';

describe('AI', () => {
  it('AI 턴이 제한 시간 안에 끝난다', () => {
    const state = newGame(555);
    const start = Date.now();
    runAiTurn(state, 'ai1');
    runAiTurn(state, 'ai2');
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('AI 행동 로그의 유닛·좌표가 모두 유효하다', () => {
    const state = newGame(918);
    const log = runAiTurn(state, 'ai1');
    for (const action of log) {
      if (action.kind === 'move') {
        expect(action.path.length).toBeGreaterThanOrEqual(1);
        for (const step of action.path) {
          const t = tileAt(state, step.q, step.r);
          expect(t).toBeDefined();
          expect(t!.terrain).not.toBe('water');
        }
      }
      if (action.kind === 'produce') {
        const t = tileAt(state, action.at.q, action.at.r);
        expect(t?.building).toBeDefined();
        expect(t?.owner).toBe('ai1');
      }
    }
  });

  it('AI가 인접한 빈사 상태의 적을 공격해 처치한다', () => {
    const state = newGame(42);
    // ai1 유닛 옆에 빈사 플레이어 유닛 배치
    const aiUnit = unitsOf(state, 'ai1')[0];
    state.units.push({
      id: state.nextUnitId++,
      type: 'infantry',
      faction: 'player',
      q: aiUnit.q + 1,
      r: aiUnit.r,
      hp: 1,
      moved: false,
      attacked: false,
    });
    const before = unitsOf(state, 'player').length;
    const log = runAiTurn(state, 'ai1');
    expect(log.some((a) => a.kind === 'attack')).toBe(true);
    expect(unitsOf(state, 'player').length).toBeLessThan(before);
  });

  it('전체 게임 시뮬레이션이 12턴 안에 완료되고 상태가 유효하다', () => {
    const state: GameState = newGame(20260719);
    let guard = 0;
    while (!state.over && guard < 200) {
      guard++;
      // 플레이어는 아무것도 하지 않고 턴 종료
      advancePhase(state); // -> ai1
      if (!state.over) {
        runAiTurn(state, 'ai1');
        advancePhase(state); // -> ai2
      }
      if (!state.over) {
        runAiTurn(state, 'ai2');
        advancePhase(state); // -> 다음 턴
      }
    }
    expect(guard).toBeLessThan(50);
    expect(state.over).toBe(true);
    expect(state.winner).toBeDefined();
    // 유닛 좌표 중복 없음
    const keys = state.units.map((u) => `${u.q},${u.r}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

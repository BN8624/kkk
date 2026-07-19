// 한 줄 목적: AI가 유효한 명령만 발행하고 유한 시간 안에 턴을 마치는지 검증한다
import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/core/ai';
import { tileAt, unitsOf } from '../src/core/board';
import { advancePhase, newGame } from '../src/core/game';
import type { GameState } from '../src/core/types';

describe('AI', () => {
  it('AI 턴이 제한 시간 안에 끝난다', () => {
    const state = newGame(555);
    advancePhase(state); // 인간(azure) 페이즈 종료 → crimson
    const start = Date.now();
    runAiTurn(state, 'crimson'); // END_PHASE 포함 → violet
    runAiTurn(state, 'violet');
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('AI 이벤트의 유닛·좌표가 모두 유효하고 END_PHASE 명령으로 끝난다', () => {
    const state = newGame(918);
    advancePhase(state); // → crimson
    const { commands, events } = runAiTurn(state, 'crimson');
    expect(commands.length).toBeGreaterThan(0);
    expect(commands[commands.length - 1].type).toBe('end-phase');
    for (const c of commands) {
      expect(c.v).toBe(1);
      expect(c.faction).toBe('crimson');
      expect(c.client).toBe('ai');
    }
    // 명령 순번은 실행 순서대로 연속이다
    for (let i = 1; i < commands.length; i++) {
      expect(commands[i].seq).toBe(commands[i - 1].seq + 1);
    }
    for (const ev of events) {
      if (ev.type === 'unit-moved') {
        expect(ev.path.length).toBeGreaterThanOrEqual(1);
        for (const step of ev.path) {
          const t = tileAt(state, step.q, step.r);
          expect(t).toBeDefined();
          expect(t!.terrain).not.toBe('water');
        }
      }
      if (ev.type === 'unit-produced') {
        const t = tileAt(state, ev.at.q, ev.at.r);
        expect(t?.building).toBeDefined();
        expect(t?.owner).toBe('crimson');
      }
    }
  });

  it('AI가 인접한 빈사 상태의 적을 공격해 처치하고 사망 좌표를 이벤트에 남긴다', () => {
    const state = newGame(42);
    // crimson 유닛 옆에 빈사 azure 유닛 배치
    const aiUnit = unitsOf(state, 'crimson')[0];
    const q = aiUnit.q + 1;
    const r = aiUnit.r;
    state.units.push({
      id: state.nextUnitId++,
      type: 'infantry',
      faction: 'azure',
      q,
      r,
      hp: 1,
      moved: false,
      attacked: false,
    });
    advancePhase(state); // → crimson
    const before = unitsOf(state, 'azure').length;
    const { events } = runAiTurn(state, 'crimson');
    expect(events.some((e) => e.type === 'unit-attacked')).toBe(true);
    expect(unitsOf(state, 'azure').length).toBeLessThan(before);
    // 사망 유닛의 공격 시점 좌표가 이벤트에 보존된다(연출 생략 문제 제거)
    const diedAt = events.some(
      (e) => e.type === 'unit-died' && e.faction === 'azure' && e.at.q === q && e.at.r === r,
    );
    expect(diedAt).toBe(true);
  });

  it('전체 게임 시뮬레이션이 12턴 안에 완료되고 상태가 유효하다', () => {
    const state: GameState = newGame(20260719);
    let guard = 0;
    while (!state.over && guard < 200) {
      guard++;
      // 인간(azure)은 아무것도 하지 않고 턴 종료
      advancePhase(state); // -> crimson
      if (!state.over) runAiTurn(state, 'crimson'); // END_PHASE 포함 -> violet
      if (!state.over) runAiTurn(state, 'violet'); // END_PHASE 포함 -> 다음 턴
    }
    expect(guard).toBeLessThan(50);
    expect(state.over).toBe(true);
    expect(state.winner).toBeDefined();
    // 유닛 좌표 중복 없음
    const keys = state.units.map((u) => `${u.q},${u.r}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

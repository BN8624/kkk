// 한 줄 목적: 정본 다이제스트 안정성과 리플레이 기록·결정론 재생·변조 감지를 검증한다
import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/core/ai';
import { newGame } from '../src/core/game';
import {
  buildReplayDocument,
  canonicalJson,
  stateDigest,
  verifyReplay,
} from '../src/core/replay';
import { deserialize, serialize } from '../src/core/save';
import type { BuiltinScenarioId, FactionId, GameState } from '../src/core/types';

/** 모든 세력을 AI 명령으로 진행해 게임을 끝까지 플레이한다. */
function playFullGame(state: GameState): void {
  let guard = 0;
  const maxPhases = (state.maxTurns + 2) * 3;
  while (!state.over && guard < maxPhases) {
    guard++;
    const f = state.current;
    runAiTurn(state, f);
    if (!state.over && state.current === f) throw new Error('AI가 페이즈를 넘기지 못함');
  }
  if (!state.over) throw new Error('게임이 종료되지 않음');
}

describe('정본 다이제스트', () => {
  it('배열 순서를 섞어도 같은 상태는 같은 다이제스트를 낸다', () => {
    const a = newGame(123);
    const b = newGame(123);
    b.tiles.reverse();
    b.units.reverse();
    expect(stateDigest(b)).toBe(stateDigest(a));
  });

  it('다른 상태는 다른 다이제스트를 낸다', () => {
    const a = newGame(123);
    const b = newGame(124);
    expect(stateDigest(a)).not.toBe(stateDigest(b));
    const c = newGame(123);
    c.factions.azure.gold += 1;
    expect(stateDigest(c)).not.toBe(stateDigest(a));
  });

  it('정본 직렬화는 키 순서를 고정하고 undefined를 생략한다', () => {
    expect(canonicalJson({ b: 1, a: undefined, c: 'x' })).toBe('{"b":1,"c":"x"}');
    expect(canonicalJson({ z: [1, { b: 2, a: 1 }], a: null })).toBe(
      '{"a":null,"z":[1,{"a":1,"b":2}]}',
    );
  });
});

describe('리플레이 기록·결정론 재생', () => {
  const scenarios: BuiltinScenarioId[] = ['three-crowns', 'broken-strait', 'crown-heart'];
  const factions: FactionId[] = ['azure', 'crimson', 'violet'];

  it('세 시나리오·세 왕국의 전체 게임이 기록되고 동일하게 재생된다', () => {
    let checked = 0;
    for (const scenario of scenarios) {
      for (const humanFaction of factions) {
        const seed = 20260719 + checked;
        const state = newGame(seed, { scenario, humanFaction, difficulty: 'normal' });
        playFullGame(state);
        const doc = buildReplayDocument(state, {
          replayId: `test-${scenario}-${humanFaction}`,
          createdAt: '2026-07-19T00:00:00.000Z',
        });
        expect(doc, `${scenario}/${humanFaction}`).not.toBeNull();
        const v = verifyReplay(doc!);
        expect(v.ok, `${scenario}/${humanFaction}: ${v.reason}`).toBe(true);
        expect(doc!.result.winner).toBe(state.winner);
        checked++;
      }
    }
    expect(checked).toBe(9);
  });

  it('일일 도전 수정자가 있는 게임도 결정론적으로 재생된다', () => {
    for (const modifier of ['sharp-arrows', 'rich-villages', 'poor-start', 'short-war']) {
      const state = newGame(777, { mode: 'daily', modifier, difficulty: 'hard' });
      playFullGame(state);
      const doc = buildReplayDocument(state)!;
      expect(doc).not.toBeNull();
      const v = verifyReplay(doc);
      expect(v.ok, `${modifier}: ${v.reason}`).toBe(true);
    }
  });

  it('중간 저장·복원을 거쳐도 기록이 이어져 완전한 리플레이가 된다', () => {
    let state = newGame(4242);
    // 두 라운드 진행 후 저장·복원
    for (let i = 0; i < 6 && !state.over; i++) runAiTurn(state, state.current);
    const restored = deserialize(serialize(state));
    expect(restored).not.toBeNull();
    state = restored!;
    playFullGame(state);
    const doc = buildReplayDocument(state);
    expect(doc).not.toBeNull();
    expect(verifyReplay(doc!).ok).toBe(true);
  });

  it('명령 기록 없이 시작된 구버전 저장은 부분 리플레이를 만들지 않는다', () => {
    const state = newGame(99);
    delete state.commandLog;
    delete state.cmdSeq;
    playFullGame(state);
    expect(buildReplayDocument(state)).toBeNull();
  });

  it('변조된 리플레이를 감지한다', () => {
    const state = newGame(31337);
    playFullGame(state);
    const doc = buildReplayDocument(state)!;

    // 최종 다이제스트 변조
    const tampered1 = { ...doc, finalStateDigest: '0'.repeat(16) };
    expect(verifyReplay(tampered1).reason).toBe('digest-mismatch');

    // 명령 순서 뒤바꿈 → 순번 불일치로 실패
    const cmds = [...doc.commands];
    [cmds[0], cmds[1]] = [cmds[1], cmds[0]];
    const tampered2 = { ...doc, commands: cmds };
    const v2 = verifyReplay(tampered2);
    expect(v2.ok).toBe(false);
    expect(v2.reason).toBe('command-failed');
    expect(v2.failedSeq).toBeDefined();
    expect(v2.digestBefore).toBeDefined();

    // 마지막 명령 제거 → 최종 다이제스트 불일치
    const tampered3 = { ...doc, commands: doc.commands.slice(0, -1) };
    expect(verifyReplay(tampered3).reason).toBe('digest-mismatch');

    // 다른 스키마 버전 안전 거부(verifyReplay는 현행 v2만 재생한다)
    const tampered4 = { ...doc, schemaVersion: 3 as unknown as 2 };
    expect(verifyReplay(tampered4).reason).toBe('unsupported-version');
  });
});

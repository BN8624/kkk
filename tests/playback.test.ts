// 한 줄 목적: 리플레이 재생 세션의 전진·후진·턴 이동이 결정론적으로 동일 상태를 만드는지 검증한다
import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/core/ai';
import { newGame } from '../src/core/game';
import { buildReplayDocument, stateDigest, type ReplayDocument } from '../src/core/replay';
import { ReplayPlayback } from '../src/replay/playback';
import type { GameState } from '../src/core/types';

function recordGame(seed: number): ReplayDocument {
  const state: GameState = newGame(seed);
  let guard = 0;
  while (!state.over && guard < 200) {
    guard++;
    runAiTurn(state, state.current);
  }
  const doc = buildReplayDocument(state, { replayId: `pb-${seed}`, createdAt: '2026-01-01T00:00:00.000Z' });
  if (!doc) throw new Error('리플레이 문서 생성 실패');
  return doc;
}

describe('리플레이 재생 세션', () => {
  const doc = recordGame(2026);

  it('끝까지 전진하면 최종 다이제스트와 일치한다', () => {
    const pb = new ReplayPlayback(doc);
    expect(stateDigest(pb.state)).toBe(doc.initialStateDigest);
    while (!pb.atEnd) {
      expect(pb.stepForward()).not.toBeNull();
    }
    expect(stateDigest(pb.state)).toBe(doc.finalStateDigest);
  });

  it('임의 지점으로 뒤로 이동해도 같은 인덱스는 같은 상태다', () => {
    const pb = new ReplayPlayback(doc);
    pb.toEnd();
    const mid = Math.floor(doc.commands.length / 2);
    pb.seek(mid);
    const fresh = new ReplayPlayback(doc);
    fresh.seek(mid);
    expect(stateDigest(pb.state)).toBe(stateDigest(fresh.state));
    expect(pb.index).toBe(mid);

    // 한 명령 뒤로 = 인덱스 -1 상태
    pb.stepBack();
    fresh.seek(mid - 1);
    expect(stateDigest(pb.state)).toBe(stateDigest(fresh.state));
  });

  it('처음·마지막·턴 이동이 정확한 경계로 간다', () => {
    const pb = new ReplayPlayback(doc);
    pb.toEnd();
    expect(pb.atEnd).toBe(true);
    pb.toStart();
    expect(pb.index).toBe(0);
    expect(stateDigest(pb.state)).toBe(doc.initialStateDigest);

    // 2턴 시작으로 이동: 상태의 턴이 2이고 첫 세력 차례다
    pb.seekTurn(2);
    expect(pb.state.turn).toBe(2);
    expect(pb.state.current).toBe(pb.state.order[0]);

    // 다음 턴·이전 턴 왕복 후 상태 동일
    const d2 = stateDigest(pb.state);
    pb.nextTurn();
    pb.prevTurn();
    expect(stateDigest(pb.state)).toBe(d2);
  });
});

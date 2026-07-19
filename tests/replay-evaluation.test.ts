// 한 줄 목적: 플레이테스트 evaluation이 다이제스트·결정론에 영향 없이 왕복·관용 디코드되는지 검증한다
import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/core/ai';
import { newGame } from '../src/core/game';
import {
  buildReplayDocument,
  sanitizeEvaluation,
  stateDigest,
  verifyReplay,
  type PlaytestEvaluation,
  type ReplayDocument,
} from '../src/core/replay';
import { decodeReplayDocument, safeVerifyReplay } from '../src/core/replay-decode';
import { createBackup, parseBackup, restoreBackup } from '../src/storage/backup';
import { MemoryDocumentStore } from '../src/storage/docstore';
import type { GameState } from '../src/core/types';

function finishedGame(seed: number): GameState {
  const state: GameState = newGame(seed);
  let guard = 0;
  while (!state.over && guard < 200) {
    guard++;
    runAiTurn(state, state.current);
  }
  if (!state.over) throw new Error('게임이 종료되지 않았습니다');
  return state;
}

function recordDoc(seed: number): ReplayDocument {
  const doc = buildReplayDocument(finishedGame(seed), {
    replayId: `eval-${seed}`,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  if (!doc) throw new Error('리플레이 문서 생성 실패');
  return doc;
}

const sampleEval: PlaytestEvaluation = {
  enjoyment: 'fun',
  length: 'right',
  understoodLoss: true,
  defectTag: 'early-objective',
  note: '왕관을 너무 빨리 빼앗김',
};

describe('evaluation과 다이제스트 불변', () => {
  it('evaluation이 있어도 finalStateDigest·initialStateDigest·결정론 검증이 동일하다', () => {
    const plain = recordDoc(41);
    const withEval = buildReplayDocument(finishedGame(41), {
      replayId: 'eval-41',
      createdAt: '2026-01-01T00:00:00.000Z',
      evaluation: sampleEval,
    })!;
    expect(withEval.evaluation).toEqual(sampleEval);
    expect(withEval.finalStateDigest).toBe(plain.finalStateDigest);
    expect(withEval.initialStateDigest).toBe(plain.initialStateDigest);
    expect(withEval.scenarioDigest).toBe(plain.scenarioDigest);
    expect(verifyReplay(withEval).ok).toBe(true);
    expect(verifyReplay(plain).ok).toBe(true);
    // 상태 다이제스트 자체도 evaluation과 무관
    const a = finishedGame(42);
    const b = finishedGame(42);
    expect(stateDigest(a)).toBe(stateDigest(b));
  });

  it('문서에 evaluation을 나중에 붙여도 다이제스트·검증이 유지된다', () => {
    const plain = recordDoc(43);
    const attached: ReplayDocument = { ...plain, evaluation: sampleEval };
    expect(attached.finalStateDigest).toBe(plain.finalStateDigest);
    expect(verifyReplay(attached).ok).toBe(true);
    expect(safeVerifyReplay(attached).ok).toBe(true);
  });
});

describe('evaluation 왕복·정리', () => {
  it('build→직렬화→decode에서 evaluation을 보존한다', () => {
    const doc = buildReplayDocument(finishedGame(51), {
      replayId: 'roundtrip',
      createdAt: '2026-01-01T00:00:00.000Z',
      evaluation: sampleEval,
    })!;
    const json = JSON.stringify(doc);
    const decoded = decodeReplayDocument(json);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.evaluation).toEqual(sampleEval);
    expect(decoded.value.finalStateDigest).toBe(doc.finalStateDigest);
    expect(safeVerifyReplay(decoded.value).ok).toBe(true);
  });

  it('sanitizeEvaluation은 유효 필드만 남기고 빈 결과는 undefined다', () => {
    expect(sanitizeEvaluation(sampleEval)).toEqual(sampleEval);
    expect(sanitizeEvaluation(undefined)).toBeUndefined();
    expect(sanitizeEvaluation(null)).toBeUndefined();
    expect(sanitizeEvaluation('x')).toBeUndefined();
    expect(sanitizeEvaluation([])).toBeUndefined();
    expect(sanitizeEvaluation({ enjoyment: 'meh', note: '' })).toBeUndefined();
    expect(sanitizeEvaluation({ enjoyment: 'ok', length: 'nope' })).toEqual({ enjoyment: 'ok' });
    expect(sanitizeEvaluation({ note: 'a'.repeat(281) })).toBeUndefined();
    expect(sanitizeEvaluation({ note: '짧은 메모', understoodLoss: false })).toEqual({
      note: '짧은 메모',
      understoodLoss: false,
    });
  });

  it('잘못된 evaluation은 재생을 막지 않고 evaluation만 정리/제거한다', () => {
    const doc = recordDoc(52);
    const cases: unknown[] = [
      { enjoyment: 'amazing' },
      { length: 3 },
      { defectTag: 'not-a-tag' },
      { note: 'x'.repeat(300) },
      'string-eval',
      42,
      { enjoyment: 'fun', defectTag: 'bogus', note: 'ok' },
    ];
    for (const bad of cases) {
      const raw = { ...doc, evaluation: bad };
      const r = decodeReplayDocument(JSON.stringify(raw));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(safeVerifyReplay(r.value).ok).toBe(true);
      expect(r.value.finalStateDigest).toBe(doc.finalStateDigest);
      // 전부 무효면 제거, 일부 유효면 그 필드만
      if (bad && typeof bad === 'object' && !Array.isArray(bad) && (bad as { enjoyment?: string }).enjoyment === 'fun') {
        expect(r.value.evaluation).toEqual({ enjoyment: 'fun', note: 'ok' });
      } else {
        expect(r.value.evaluation).toBeUndefined();
      }
    }
  });
});

describe('백업 왕복에서 evaluation 유지', () => {
  it('replays 문서의 evaluation이 백업·복구 후 유지된다', async () => {
    const store = new MemoryDocumentStore();
    const doc = buildReplayDocument(finishedGame(61), {
      replayId: 'backup-eval',
      createdAt: '2026-01-01T00:00:00.000Z',
      evaluation: sampleEval,
    })!;
    await store.put('replays', doc.replayId, doc);

    class MemStorage {
      readonly values = new Map<string, string>();
      getItem(k: string): string | null {
        return this.values.get(k) ?? null;
      }
      setItem(k: string, v: string): void {
        this.values.set(k, v);
      }
      removeItem(k: string): void {
        this.values.delete(k);
      }
    }
    const storage = new MemStorage();
    const backup = await createBackup(['replays'], store, storage);
    expect(backup.documents.replays?.length).toBe(1);
    expect((backup.documents.replays![0].data as ReplayDocument).evaluation).toEqual(sampleEval);

    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const store2 = new MemoryDocumentStore();
    await restoreBackup(parsed.backup, 'replace', store2, storage);
    const restored = await store2.get<ReplayDocument>('replays', doc.replayId);
    expect(restored?.data.evaluation).toEqual(sampleEval);
    expect(restored?.data.finalStateDigest).toBe(doc.finalStateDigest);
  });
});

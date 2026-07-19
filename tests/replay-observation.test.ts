// 한 줄 목적: 관측 메타데이터 v2가 결정론·다이제스트에 영향 없이 기록·검증·마이그레이션되는지 검증한다
import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/core/ai';
import { newGame } from '../src/core/game';
import {
  buildReplayDocument,
  migrateReplayV1,
  sanitizeObservations,
  stateDigest,
  upgradeStoredReplay,
  verifyReplay,
  type ReplayDocument,
  type ReplayDocumentV1,
} from '../src/core/replay';
import { decodeReplayDocument, safeVerifyReplay } from '../src/core/replay-decode';
import { ObservationTracker, OBSERVATION_MAX_ELAPSED_MS } from '../src/replay/observation';
import type { GameState, ReplayObservation } from '../src/core/types';

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
    replayId: `obs-${seed}`,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  if (!doc) throw new Error('리플레이 문서 생성 실패');
  return doc;
}

/** 현행 v2 문서를 역사적 v1 형태로 되돌린다(마이그레이션 테스트용). */
function asV1(doc: ReplayDocument): ReplayDocumentV1 {
  const v1 = { ...doc, schemaVersion: 1 as const };
  delete (v1 as { observations?: unknown }).observations;
  return v1;
}

describe('관측 메타데이터와 다이제스트 불변', () => {
  it('observationLog는 상태 다이제스트에 영향을 주지 않는다', () => {
    const a = finishedGame(11);
    const b = finishedGame(11);
    b.observationLog = [{ commandSeq: 0, elapsedMs: 1234, canceledSelectionCount: 2 }];
    expect(stateDigest(b)).toBe(stateDigest(a));
  });

  it('관측이 있어도 결정론 검증 결과·다이제스트가 동일하다', () => {
    const state = finishedGame(12);
    const plain = buildReplayDocument(state, { replayId: 'p', createdAt: 'c' })!;
    state.observationLog = [
      { commandSeq: 1, elapsedMs: 500, hesitationMs: 200 },
      { commandSeq: 0, elapsedMs: 100 },
    ];
    const withObs = buildReplayDocument(state, { replayId: 'p', createdAt: 'c' })!;
    expect(withObs.observations).toEqual([
      { commandSeq: 0, elapsedMs: 100 },
      { commandSeq: 1, elapsedMs: 500, hesitationMs: 200 },
    ]);
    expect(withObs.finalStateDigest).toBe(plain.finalStateDigest);
    expect(withObs.initialStateDigest).toBe(plain.initialStateDigest);
    expect(verifyReplay(withObs).ok).toBe(true);
    expect(verifyReplay(plain).ok).toBe(true);
  });

  it('sanitizeObservations는 범위 밖·비정수 항목을 버리고 순번순으로 정렬한다', () => {
    const raw: ReplayObservation[] = [
      { commandSeq: 5 },
      { commandSeq: -1 },
      { commandSeq: 2, elapsedMs: -3 },
      { commandSeq: 999 },
      { commandSeq: 0, elapsedMs: 10 },
      { commandSeq: 1, hesitationMs: 2.5 },
    ];
    expect(sanitizeObservations(raw, 6)).toEqual([{ commandSeq: 0, elapsedMs: 10 }, { commandSeq: 5 }]);
    expect(sanitizeObservations([], 6)).toBeUndefined();
    expect(sanitizeObservations(undefined, 6)).toBeUndefined();
    expect(sanitizeObservations([{ commandSeq: 3 }], 0)).toBeUndefined();
  });
});

describe('v1 → v2 마이그레이션', () => {
  it('migrateReplayV1은 정본 필드를 유지하고 스키마만 올린다', () => {
    const v2 = recordDoc(21);
    const v1 = asV1(v2);
    const migrated = migrateReplayV1(v1);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.finalStateDigest).toBe(v2.finalStateDigest);
    expect(verifyReplay(migrated).ok).toBe(true);
  });

  it('decodeReplayDocument는 v1 JSON을 경고와 함께 v2로 변환한다', () => {
    const v1 = asV1(recordDoc(22));
    const r = decodeReplayDocument(JSON.stringify(v1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.schemaVersion).toBe(2);
    expect(r.warnings.some((w) => w.code === 'migrated-v1')).toBe(true);
    expect(safeVerifyReplay(r.value).ok).toBe(true);
  });

  it('upgradeStoredReplay는 v1·v2 레코드만 올리고 나머지는 거부한다', () => {
    const v2 = recordDoc(23);
    expect(upgradeStoredReplay(v2)).toBe(v2);
    const up = upgradeStoredReplay(asV1(v2));
    expect(up?.schemaVersion).toBe(2);
    expect(up && verifyReplay(up).ok).toBe(true);
    expect(upgradeStoredReplay(null)).toBeNull();
    expect(upgradeStoredReplay({ schemaVersion: 99 })).toBeNull();
    expect(upgradeStoredReplay('문자열')).toBeNull();
  });
});

describe('v2 관측 필드 정밀 검증', () => {
  const doc = recordDoc(31);

  it('유효한 관측이 있는 v2 문서를 수용한다', () => {
    const withObs = { ...doc, observations: [{ commandSeq: 0, elapsedMs: 100, cameraMoves: 1 }] };
    const r = decodeReplayDocument(JSON.stringify(withObs));
    expect(r.ok).toBe(true);
  });

  it.each<[string, unknown]>([
    ['배열이 아닌 관측', { ...doc, observations: { commandSeq: 0 } }],
    ['범위 밖 순번', { ...doc, observations: [{ commandSeq: doc.commands.length }] }],
    ['음수 시간', { ...doc, observations: [{ commandSeq: 0, elapsedMs: -1 }] }],
    ['비정수 시간', { ...doc, observations: [{ commandSeq: 0, hesitationMs: 1.5 }] }],
    ['지나친 횟수', { ...doc, observations: [{ commandSeq: 0, cameraMoves: 1_000_000 }] }],
    ['객체가 아닌 항목', { ...doc, observations: [42] }],
    ['v1 문서의 관측', { ...asV1(doc), observations: [{ commandSeq: 0 }] }],
  ])('%s 은(는) 거부한다', (_name, bad) => {
    expect(decodeReplayDocument(JSON.stringify(bad)).ok).toBe(false);
  });

  it('미래 스키마(3)는 여전히 future-schema로 거부한다', () => {
    const r = decodeReplayDocument(JSON.stringify({ ...doc, schemaVersion: 3 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].code).toBe('future-schema');
  });
});

describe('ObservationTracker', () => {
  function tracker(): { t: ObservationTracker; tick: (ms: number) => void } {
    let clock = 0;
    const t = new ObservationTracker(() => clock);
    return { t, tick: (ms) => (clock += ms) };
  }
  const state = { observationLog: undefined } as unknown as GameState;

  it('경과·망설임·취소·카메라를 명령 단위로 기록하고 초기화한다', () => {
    const s = { ...state, observationLog: undefined } as GameState;
    const { t, tick } = tracker();
    t.markPhaseStart();
    tick(1000);
    t.onSelect();
    t.onDeselect();
    t.onCameraMove();
    tick(500);
    t.onSelect();
    tick(200);
    t.record(s, 0);
    expect(s.observationLog).toEqual([
      { commandSeq: 0, elapsedMs: 1700, hesitationMs: 200, canceledSelectionCount: 1, cameraMoves: 1 },
    ]);
    // 다음 명령: 카운터가 초기화되고 기준점이 직전 명령 시점이다
    tick(300);
    t.record(s, 1);
    expect(s.observationLog![1]).toEqual({ commandSeq: 1, elapsedMs: 300 });
  });

  it('백그라운드 시간은 경과 시간에서 제외한다', () => {
    const s = { ...state, observationLog: undefined } as GameState;
    const { t, tick } = tracker();
    t.markPhaseStart();
    tick(100);
    t.onHidden();
    tick(60_000);
    t.onVisible();
    tick(400);
    t.record(s, 0);
    expect(s.observationLog![0].elapsedMs).toBe(500);
  });

  it('비정상적으로 긴 간격은 기록하지 않는다', () => {
    const s = { ...state, observationLog: undefined } as GameState;
    const { t, tick } = tracker();
    t.markPhaseStart();
    tick(OBSERVATION_MAX_ELAPSED_MS + 1);
    t.record(s, 0);
    expect(s.observationLog![0]).toEqual({ commandSeq: 0 });
  });

  it('reset 후에는 기준점 없이 기록된다(경과 시간 없음)', () => {
    const s = { ...state, observationLog: undefined } as GameState;
    const { t, tick } = tracker();
    t.markPhaseStart();
    tick(100);
    t.reset();
    tick(50);
    t.record(s, 0);
    expect(s.observationLog![0]).toEqual({ commandSeq: 0 });
  });
});

// 한 줄 목적: 결정론적 난수 mutation fuzz — 어떤 변형 입력에도 디코더가 예외·무한 반복 없이 끝나는지 검증한다
import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/core/ai';
import { decodeScenarioInput } from '../src/core/decode';
import { newGame } from '../src/core/game';
import { buildReplayDocument } from '../src/core/replay';
import { decodeReplayDocument, safeVerifyReplay } from '../src/core/replay-decode';
import { cloneBuiltinDocument } from '../src/editor/new-doc';
import type { GameState } from '../src/core/types';

/** 결정론 난수(mulberry32): 같은 시드는 항상 같은 변형을 만든다. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** JSON 텍스트를 무작위로 변형한다(삭제·치환·삽입·잘라내기). */
function mutateText(text: string, rnd: () => number): string {
  const kind = Math.floor(rnd() * 5);
  const at = Math.floor(rnd() * text.length);
  const junk = ['null', '1e999', '"<script>"', '{', ']', ',', '\\u0000', '"__proto__"', '-1', 'NaN'];
  switch (kind) {
    case 0: // 문자 삭제
      return text.slice(0, at) + text.slice(at + 1 + Math.floor(rnd() * 20));
    case 1: // 임의 문자 치환
      return text.slice(0, at) + String.fromCharCode(32 + Math.floor(rnd() * 90)) + text.slice(at + 1);
    case 2: // 정크 토큰 삽입
      return text.slice(0, at) + junk[Math.floor(rnd() * junk.length)] + text.slice(at);
    case 3: // 앞부분 잘라내기
      return text.slice(at);
    default: // 뒷부분 잘라내기
      return text.slice(0, at);
  }
}

/** 무작위 JSON 값 생성(깊이 제한). */
function randomValue(rnd: () => number, depth: number): unknown {
  const kind = Math.floor(rnd() * (depth > 3 ? 4 : 6));
  switch (kind) {
    case 0:
      return Math.floor(rnd() * 1e9) - 5e8;
    case 1:
      return 'str-' + Math.floor(rnd() * 1e6).toString(36).repeat(Math.floor(rnd() * 5) + 1);
    case 2:
      return rnd() < 0.5;
    case 3:
      return null;
    case 4: {
      const n = Math.floor(rnd() * 6);
      const arr: unknown[] = [];
      for (let i = 0; i < n; i++) arr.push(randomValue(rnd, depth + 1));
      return arr;
    }
    default: {
      const n = Math.floor(rnd() * 6);
      const obj: Record<string, unknown> = {};
      const keys = ['schemaVersion', 'commands', 'seq', 'board', 'units', 'to', 'q', 'r', 'type', 'seed', 'result', 'x'];
      for (let i = 0; i < n; i++) obj[keys[Math.floor(rnd() * keys.length)]] = randomValue(rnd, depth + 1);
      return obj;
    }
  }
}

function playFullGame(state: GameState): void {
  let guard = 0;
  const maxPhases = (state.maxTurns + 2) * 3;
  while (!state.over && guard < maxPhases) {
    guard++;
    runAiTurn(state, state.current);
  }
}

const PER_INPUT_BUDGET_MS = 2_000;

describe('mutation fuzz (결정론 시드)', () => {
  it('정상 리플레이 100개 변형: 예외·무한 반복 0', () => {
    const state = newGame(424242, { scenario: 'three-crowns', humanFaction: 'crimson', difficulty: 'normal' });
    playFullGame(state);
    const doc = buildReplayDocument(state, { replayId: 'fuzz-base', createdAt: '2026-07-19T00:00:00.000Z' });
    expect(doc).not.toBeNull();
    const base = JSON.stringify(doc);
    const rnd = mulberry32(1001);
    for (let i = 0; i < 100; i++) {
      let text = base;
      const times = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < times; k++) text = mutateText(text, rnd);
      const started = Date.now();
      const r = decodeReplayDocument(text);
      if (r.ok) safeVerifyReplay(r.value);
      expect(Date.now() - started, `입력 #${i}`).toBeLessThan(PER_INPUT_BUDGET_MS);
    }
  });

  it('정상 시나리오 100개 변형: 예외·무한 반복 0', () => {
    const base = JSON.stringify(cloneBuiltinDocument('three-crowns', 'custom-fuzz-base', 99, 'Fuzz'));
    const rnd = mulberry32(2002);
    for (let i = 0; i < 100; i++) {
      let text = base;
      const times = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < times; k++) text = mutateText(text, rnd);
      const started = Date.now();
      decodeScenarioInput(text);
      expect(Date.now() - started, `입력 #${i}`).toBeLessThan(PER_INPUT_BUDGET_MS);
    }
  });

  it('무작위 구조 500개: 예외·무한 반복 0', () => {
    const rnd = mulberry32(3003);
    for (let i = 0; i < 500; i++) {
      const value = randomValue(rnd, 0);
      const started = Date.now();
      decodeReplayDocument(value);
      decodeScenarioInput(value);
      decodeScenarioInput(JSON.stringify(value));
      expect(Date.now() - started, `입력 #${i}`).toBeLessThan(PER_INPUT_BUDGET_MS);
    }
  });
});

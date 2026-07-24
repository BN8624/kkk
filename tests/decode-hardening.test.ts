// 한 줄 목적: 외부 문서 디코드 파이프라인이 악성·손상 입력 fixture를 예외 없이 안전 거부하는지 검증한다
import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/core/ai';
import {
  DEFAULT_LIMITS,
  decodeScenarioInput,
  safeJsonParse,
  scanStructure,
} from '../src/core/decode';
import { newGame } from '../src/core/game';
import { buildReplayDocument, type ReplayDocument } from '../src/core/replay';
import { decodeReplayDocument, safeVerifyReplay } from '../src/core/replay-decode';
import { CAMPAIGNS } from '../src/core/campaign/missions';
import { normalizeScenario } from '../src/core/scenario/normalize';
import { builtinScenarioSnapshot } from '../src/core/scenario/builtin';
import { cloneBuiltinDocument } from '../src/editor/new-doc';
import { decodeShareCode } from '../src/editor/share';
import type { GameState } from '../src/core/types';

function playFullGame(state: GameState): void {
  let guard = 0;
  const maxPhases = (state.maxTurns + 2) * 3;
  while (!state.over && guard < maxPhases) {
    guard++;
    runAiTurn(state, state.current);
  }
  if (!state.over) throw new Error('게임이 종료되지 않음');
}

/** 검증 완료된 실제 리플레이 문서(테스트 공용). */
function validReplay(): ReplayDocument {
  const state = newGame(20260719, { scenario: 'three-crowns', humanFaction: 'azure', difficulty: 'normal' });
  playFullGame(state);
  const doc = buildReplayDocument(state, {
    replayId: 'test-valid-replay',
    createdAt: '2026-07-19T00:00:00.000Z',
  });
  expect(doc).not.toBeNull();
  return doc!;
}

function mutated(doc: ReplayDocument, patch: (d: Record<string, unknown>) => void): unknown {
  const copy = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  patch(copy);
  return copy;
}

describe('공용 구조 검사(scanStructure)', () => {
  it('지나치게 깊은 객체를 거부한다', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 40; i++) deep = { a: deep };
    expect(scanStructure(deep, DEFAULT_LIMITS)?.code).toBe('too-deep');
  });

  it('순환 참조를 거부한다', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(scanStructure(a, DEFAULT_LIMITS)?.code).toBe('circular');
  });

  it('금지된 특수 키(__proto__ 등)를 거부한다', () => {
    const viaJson = JSON.parse('{"__proto__": {"polluted": true}}') as unknown;
    expect(scanStructure(viaJson, DEFAULT_LIMITS)?.code).toBe('forbidden-key');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('유한하지 않은 숫자를 거부한다', () => {
    expect(scanStructure({ x: NaN }, DEFAULT_LIMITS)?.code).toBe('non-finite-number');
    expect(scanStructure({ x: Infinity }, DEFAULT_LIMITS)?.code).toBe('non-finite-number');
  });

  it('거대한 문자열·배열·키 수를 거부한다', () => {
    expect(scanStructure({ s: 'x'.repeat(DEFAULT_LIMITS.maxStringLen + 1) }, DEFAULT_LIMITS)?.code).toBe('string-too-long');
    expect(scanStructure(new Array(DEFAULT_LIMITS.maxArrayLen + 1).fill(0), DEFAULT_LIMITS)?.code).toBe('array-too-long');
    const wide: Record<string, number> = {};
    for (let i = 0; i <= DEFAULT_LIMITS.maxObjectKeys; i++) wide[`k${i}`] = i;
    expect(scanStructure(wide, DEFAULT_LIMITS)?.code).toBe('too-many-keys');
  });
});

describe('safeJsonParse', () => {
  it('빈 파일·잘못된 JSON·과대 입력을 예외 없이 거부한다', () => {
    expect(safeJsonParse('', DEFAULT_LIMITS).ok).toBe(false);
    expect(safeJsonParse('{broken', DEFAULT_LIMITS).ok).toBe(false);
    expect(safeJsonParse('x'.repeat(DEFAULT_LIMITS.maxBytes + 1), DEFAULT_LIMITS).ok).toBe(false);
  });
});

describe('리플레이 정밀 디코더', () => {
  const doc = validReplay();

  it('실제 기록된 리플레이는 디코드·검증을 통과한다', () => {
    const r = decodeReplayDocument(JSON.stringify(doc));
    expect(r.ok).toBe(true);
    if (r.ok) expect(safeVerifyReplay(r.value).ok).toBe(true);
  });

  it('캠페인 9개 미션·내장 3종 시나리오 스냅샷은 중첩 검증을 통과한다', () => {
    for (const campaign of CAMPAIGNS) {
      for (const mission of campaign.missions) {
        const snapshot = normalizeScenario(mission.scenario);
        const d = mutated(doc, (x) => {
          x.scenario = JSON.parse(JSON.stringify(snapshot));
        });
        const r = decodeReplayDocument(d);
        // 명령·다이제스트는 다른 시나리오의 것이므로 구조만 통과하면 된다
        expect(r.ok, `${mission.id}: ${r.ok ? '' : JSON.stringify(r.issues[0])}`).toBe(true);
      }
    }
    for (const id of ['three-crowns', 'broken-strait', 'crown-heart'] as const) {
      const snapshot = builtinScenarioSnapshot(id, 42, 'azure');
      const d = mutated(doc, (x) => {
        x.scenario = JSON.parse(JSON.stringify(snapshot));
      });
      expect(decodeReplayDocument(d).ok, id).toBe(true);
    }
  });

  const rejects: [string, () => unknown][] = [
    ['빈 파일', () => ''],
    ['잘못된 JSON', () => '{oops'],
    ['미래 스키마', () => mutated(doc, (d) => { d.schemaVersion = 99; })],
    ['지나치게 깊은 객체', () => {
      let deep: unknown = 1;
      for (let i = 0; i < 40; i++) deep = { a: deep };
      return mutated(doc, (d) => { d.result = deep as never; });
    }],
    ['거대한 문자열', () => mutated(doc, (d) => { d.replayId = 'x'.repeat(100_000); })],
    ['거대한 명령 배열', () => mutated(doc, (d) => {
      d.commands = new Array(100_001).fill({ v: 1, seq: 0, turn: 1, faction: 'azure', type: 'end-phase' });
    })],
    ['잘못된 좌표', () => mutated(doc, (d) => {
      const cmds = d.commands as Record<string, unknown>[];
      const mv = cmds.find((c) => c.type === 'move-unit');
      if (mv) mv.to = { q: 'x', r: 0 };
      else d.commands = [{ v: 1, seq: 0, turn: 1, faction: 'azure', type: 'move-unit', unitId: 1, to: { q: 'x' } }];
    })],
    ['NaN 대체 값', () => mutated(doc, (d) => { d.seed = NaN; })],
    ['음수 유닛 ID', () => mutated(doc, (d) => {
      d.commands = [{ v: 1, seq: 0, turn: 1, faction: 'azure', type: 'move-unit', unitId: -1, to: { q: 0, r: 0 } }];
    })],
    ['중복 seq', () => mutated(doc, (d) => {
      const cmds = d.commands as { seq: number }[];
      if (cmds.length > 1) cmds[1].seq = cmds[0].seq;
    })],
    ['누락 seq(건너뜀)', () => mutated(doc, (d) => {
      const cmds = d.commands as { seq: number }[];
      if (cmds.length > 1) cmds[1].seq = cmds[1].seq + 5;
    })],
    ['순서가 뒤집힌 명령', () => mutated(doc, (d) => {
      const cmds = d.commands as unknown[];
      cmds.reverse();
    })],
    ['잘못된 faction', () => mutated(doc, (d) => {
      (d.commands as Record<string, unknown>[])[0].faction = 'orcs';
    })],
    ['잘못된 unitType', () => mutated(doc, (d) => {
      d.commands = [{ v: 1, seq: 0, turn: 1, faction: 'azure', type: 'produce-unit', at: { q: 0, r: 0 }, unitType: 'dragon' }];
    })],
    ['검증되지 않은 시나리오(물 위 유닛)', () => mutated(doc, (d) => {
      const sc = d.scenario as { units: { q: number; r: number }[]; board: { tiles: { q: number; r: number; terrain: string }[] } };
      const u = sc.units[0];
      const tile = sc.board.tiles.find((t) => t.q === u.q && t.r === u.r);
      if (tile) tile.terrain = 'water';
    })],
    ['digest 형식 오류', () => mutated(doc, (d) => { d.finalStateDigest = 'ZZZ'; })],
    ['게임 버전 표기 오류', () => mutated(doc, (d) => { d.gameVersion = 'evil-version'; })],
    ['명령 스키마 버전 오류', () => mutated(doc, (d) => {
      (d.commands as Record<string, unknown>[])[0].v = 42;
    })],
    ['결과 구조 없음', () => mutated(doc, (d) => { delete d.result; })],
    ['배열 문서', () => [1, 2, 3]],
    ['null 문서', () => null],
  ];

  it.each(rejects)('%s 입력을 예외 없이 거부한다', (_name, make) => {
    const input = make();
    const r = decodeReplayDocument(typeof input === 'string' ? input : input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.length).toBeGreaterThan(0);
      expect(typeof r.issues[0].message).toBe('string');
    }
  });

  it('변조된 명령 내용은 디코드는 통과해도 재생 검증에서 잡힌다', () => {
    const tampered = mutated(doc, (d) => {
      const cmds = d.commands as { type: string; to?: { q: number; r: number } }[];
      const mv = cmds.find((c) => c.type === 'move-unit');
      if (mv?.to) mv.to.q += 1;
    });
    const r = decodeReplayDocument(tampered);
    if (r.ok) {
      expect(safeVerifyReplay(r.value).ok).toBe(false);
    }
  });
});

describe('시나리오 좌표 정수 검증', () => {
  it('소수 타일 좌표를 거부하고 경로를 반환한다', () => {
    const doc = cloneBuiltinDocument('three-crowns', 'frac-tile', 1, 'Frac');
    (doc.board.tiles[3] as { q: number }).q = 1.5;
    const r = decodeScenarioInput(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const hit = r.issues.find((i) => i.code === 'bad-coordinate');
      expect(hit?.path).toBe('board.tiles[3].q');
    }
  });

  it('문자열 유닛 좌표를 거부하고 경로를 반환한다', () => {
    const doc = cloneBuiltinDocument('three-crowns', 'str-unit', 2, 'Str');
    (doc.units[1] as { r: unknown }).r = '2';
    const r = decodeScenarioInput(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const hit = r.issues.find((i) => i.code === 'bad-coordinate');
      expect(hit?.path).toBe('units[1].r');
    }
  });

  it('무한대 목표 좌표를 거부하고 경로를 반환한다', () => {
    const doc = cloneBuiltinDocument('three-crowns', 'inf-at', 3, 'Inf');
    doc.victoryConditions = [
      { type: 'capture-building', at: { q: Infinity, r: 0 } },
    ];
    const r = decodeScenarioInput(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // scanStructure가 비유한 숫자를 먼저 잡을 수 있다
      expect(r.issues.some((i) => i.code === 'non-finite-number' || i.code === 'bad-coordinate')).toBe(
        true,
      );
    }
  });

  it('중첩 조건 내부 비정수 좌표를 거부하고 경로를 반환한다', () => {
    const doc = cloneBuiltinDocument('three-crowns', 'nested-coord', 4, 'Nest');
    doc.victoryConditions = [
      {
        type: 'all-of',
        conditions: [
          { type: 'conquest' },
          { type: 'capture-building', at: { q: 1, r: 2.5 } },
        ],
      },
    ];
    const r = decodeScenarioInput(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const hit = r.issues.find((i) => i.code === 'bad-coordinate');
      expect(hit?.path).toBe('victoryConditions[0].conditions[1].at.r');
    }
  });

  it('좌표 누락 필드도 bad-coordinate로 경로와 함께 거부한다', () => {
    const doc = cloneBuiltinDocument('three-crowns', 'missing-q', 5, 'Miss');
    delete (doc.units[0] as { q?: number }).q;
    const r = decodeScenarioInput(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const hit = r.issues.find((i) => i.code === 'bad-coordinate' && i.path === 'units[0].q');
      expect(hit).toBeDefined();
    }
  });
});

describe('시나리오 디코더·공유 코드', () => {
  it('HTML·스크립트가 포함된 제목은 데이터로만 다뤄 디코드된다', () => {
    const doc = cloneBuiltinDocument('three-crowns', 'custom-xss-test', 7, '<script>alert(1)</script>');
    const r = decodeScenarioInput(JSON.stringify(doc));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.title).toBe('<script>alert(1)</script>');
  });

  it('압축 폭탄 유사 공유 코드를 안전하게 거부한다', async () => {
    // 8MB 반복 데이터 → deflate 시 수 KB로 줄어드는 폭탄형 입력
    const bomb = new TextEncoder().encode('0'.repeat(8 * 1024 * 1024));
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    void writer.write(bomb).then(() => writer.close());
    const chunks: Uint8Array[] = [];
    const reader = cs.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const packed = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      packed.set(c, off);
      off += c.length;
    }
    let bin = '';
    for (let i = 0; i < packed.length; i += 0x8000) {
      bin += String.fromCharCode(...packed.subarray(i, i + 0x8000));
    }
    const code = 'TCS1.' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const r = await decodeShareCode(code);
    expect(r.doc).toBeNull();
    expect(r.issues.length).toBeGreaterThan(0);
  });
});

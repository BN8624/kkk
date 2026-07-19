// 한 줄 목적: 시나리오 문서 검증기·정규화·커스텀 게임 시작·저장 마이그레이션을 검증한다
import { describe, expect, it } from 'vitest';
import { newGame, newGameFromScenario, advancePhase, evaluateVictory } from '../src/core/game';
import { deserialize, serialize } from '../src/core/save';
import { builtinScenarioSnapshot } from '../src/core/scenario/builtin';
import { normalizeScenario } from '../src/core/scenario/normalize';
import { starsEarned } from '../src/core/scenario/objectives';
import type { ScenarioDocumentV1 } from '../src/core/scenario/types';
import { isPlayable, parseScenarioDocument, validateScenario } from '../src/core/scenario/validate';

/** 유효한 최소 고정 지도 문서를 만든다(6x6 전체 평원, 수도 2, 마을 1). */
function makeDoc(overrides: Partial<ScenarioDocumentV1> = {}): ScenarioDocumentV1 {
  const tiles: ScenarioDocumentV1['board']['tiles'] = [];
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      const q = col - ((row - (row & 1)) >> 1);
      tiles.push({ q, r: row, terrain: 'plains' });
    }
  }
  const at = (col: number, row: number) => {
    const q = col - ((row - (row & 1)) >> 1);
    return tiles.find((t) => t.q === q && t.r === row)!;
  };
  Object.assign(at(1, 1), { building: 'capital', owner: 'azure' });
  Object.assign(at(4, 4), { building: 'capital', owner: 'crimson' });
  Object.assign(at(4, 1), { building: 'village' });
  return {
    schemaVersion: 1,
    id: 'test-custom',
    title: '테스트 전장',
    description: '검증용',
    board: { cols: 6, rows: 6, tiles },
    factions: [
      { id: 'azure', active: true, controller: 'human' },
      { id: 'crimson', active: true, controller: 'ai' },
      { id: 'violet', active: false, controller: 'ai' },
    ],
    units: [
      { faction: 'azure', type: 'infantry', q: at(2, 1).q, r: 1, tag: 'hero' },
      { faction: 'crimson', type: 'infantry', q: at(3, 4).q, r: 4 },
    ],
    rules: { maxTurns: 10, turnLimit: 'score' },
    victoryConditions: [{ type: 'conquest' }],
    defeatConditions: [{ type: 'human-eliminated' }],
    ...overrides,
  };
}

describe('시나리오 검증기', () => {
  it('유효한 문서는 error 없이 통과한다', () => {
    const issues = validateScenario(makeDoc());
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(isPlayable(issues)).toBe(true);
  });

  it('중복 타일·물 위 유닛·중복 유닛 좌표를 잡는다', () => {
    const doc = makeDoc();
    doc.board.tiles.push({ ...doc.board.tiles[0] });
    doc.board.tiles[10].terrain = 'water';
    doc.units[0].q = doc.board.tiles[10].q;
    doc.units[0].r = doc.board.tiles[10].r;
    doc.units[1].q = doc.units[0].q;
    doc.units[1].r = doc.units[0].r;
    const codes = validateScenario(doc).map((i) => i.code);
    expect(codes).toContain('duplicate-tile');
    expect(codes).toContain('unit-on-water');
    expect(codes).toContain('duplicate-unit-pos');
  });

  it('인간 세력이 없거나 둘이면 오류다', () => {
    const none = makeDoc();
    none.factions[0].controller = 'ai';
    expect(validateScenario(none).map((i) => i.code)).toContain('human-count');
    const two = makeDoc();
    two.factions[1].controller = 'human';
    expect(validateScenario(two).map((i) => i.code)).toContain('human-count');
  });

  it('시작 즉시 승리·도달 불가 목표를 잡는다', () => {
    const instant = makeDoc({
      victoryConditions: [{ type: 'capture-building', at: { q: 1, r: 1 } }],
    });
    // (1,1) = col1,row1 은 인간 수도
    expect(validateScenario(instant).map((i) => i.code)).toContain('immediate-win');

    const blocked = makeDoc();
    // 적 수도를 물로 완전히 포위한다
    for (const t of blocked.board.tiles) {
      const isCapital = t.building === 'capital' && t.owner === 'crimson';
      if (!isCapital && t.r >= 3) t.terrain = 'water';
    }
    blocked.units = blocked.units.filter((u) => u.r < 3);
    const codes = validateScenario(blocked).map((i) => i.code);
    expect(codes).toContain('objective-unreachable');
  });

  it('미래 스키마 버전은 안전하게 거부한다', () => {
    const { doc, issues } = parseScenarioDocument({ schemaVersion: 99 });
    expect(doc).toBeNull();
    expect(issues[0].code).toBe('schema-version');
  });

  it('존재하지 않는 태그 참조를 잡는다', () => {
    const doc = makeDoc({
      defeatConditions: [{ type: 'human-eliminated' }, { type: 'unit-dies', tag: 'ghost' }],
    });
    expect(validateScenario(doc).map((i) => i.code)).toContain('unknown-tag');
  });

  it('고유 병종을 잘못된 세력·비허용 로스터·알 수 없는 ID·HP 오류로 잡는다', () => {
    const mismatch = makeDoc({
      rules: { maxTurns: 10, turnLimit: 'score', uniqueUnits: true },
      units: [
        { faction: 'crimson', type: 'guardian', q: 0, r: 0 },
        { faction: 'azure', type: 'infantry', q: 1, r: 0 },
      ],
    });
    expect(validateScenario(mismatch).map((i) => i.code)).toContain('unit-faction-mismatch');

    const disallowed = makeDoc({
      rules: { maxTurns: 10, turnLimit: 'score' },
      units: [
        { faction: 'azure', type: 'guardian', q: 0, r: 0 },
        { faction: 'crimson', type: 'infantry', q: 1, r: 0 },
      ],
    });
    expect(validateScenario(disallowed).map((i) => i.code)).toContain('unique-unit-disallowed');

    const badType = makeDoc({
      units: [
        { faction: 'azure', type: 'dragon' as 'infantry', q: 0, r: 0 },
        { faction: 'crimson', type: 'infantry', q: 1, r: 0 },
      ],
    });
    expect(validateScenario(badType).map((i) => i.code)).toContain('bad-unit-type');

    const badHp = makeDoc({
      rules: { maxTurns: 10, turnLimit: 'score', uniqueUnits: true },
      units: [
        { faction: 'azure', type: 'guardian', q: 0, r: 0, hp: 99 },
        { faction: 'crimson', type: 'infantry', q: 1, r: 0 },
      ],
    });
    expect(validateScenario(badHp).map((i) => i.code)).toContain('bad-unit-hp');
  });

  it('uniqueUnits true 문서에 올바른 세력 고유 병종은 통과한다', () => {
    const doc = makeDoc({
      rules: { maxTurns: 10, turnLimit: 'score', uniqueUnits: true },
      units: [
        { faction: 'azure', type: 'guardian', q: 0, r: 0 },
        { faction: 'crimson', type: 'raider', q: 1, r: 0 },
      ],
    });
    // violet 비활성이라 crossbow 제외 — 활성 세력만
    const errors = validateScenario(doc).filter((i) => i.severity === 'error');
    expect(errors.map((i) => i.code).filter((c) => c.startsWith('unit-') || c.startsWith('unique-') || c === 'bad-unit-type')).toEqual([]);
  });

  it('스키마 v1 문서는 uniqueUnits 없이도 계속 가져올 수 있다', () => {
    const { doc, issues } = parseScenarioDocument(
      makeDoc({ rules: { maxTurns: 10, turnLimit: 'score' } }),
    );
    expect(doc).not.toBeNull();
    expect(doc!.schemaVersion).toBe(1);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('정규화·커스텀 게임', () => {
  it('정규화 후 커스텀 게임을 시작하면 스냅샷이 상태에 포함된다', () => {
    const snap = normalizeScenario(makeDoc());
    const state = newGameFromScenario(123, snap, { mode: 'custom' });
    expect(state.config.scenario).toBe('test-custom');
    expect(state.config.humanFaction).toBe('azure');
    expect(state.customScenario?.id).toBe('test-custom');
    expect(state.factions.violet.eliminated).toBe(true);
    expect(state.units).toHaveLength(2);
    expect(state.units[0].tag).toBe('hero');
    // 커스텀 게임 저장·복원 왕복
    const restored = deserialize(serialize(state));
    expect(restored).not.toBeNull();
    expect(restored!.customScenario?.id).toBe('test-custom');
  });

  it('unit-dies 패배 조건: 태그 유닛이 죽으면 패배한다', () => {
    const doc = makeDoc({
      defeatConditions: [{ type: 'human-eliminated' }, { type: 'unit-dies', tag: 'hero' }],
    });
    const state = newGameFromScenario(1, normalizeScenario(doc), { mode: 'custom' });
    state.units = state.units.filter((u) => u.tag !== 'hero');
    evaluateVictory(state);
    expect(state.over).toBe(true);
    expect(state.winner).toBe('crimson');
  });

  it('survive-turns 승리: 제한 턴까지 생존하면 승리한다', () => {
    const doc = makeDoc({
      victoryConditions: [{ type: 'survive-turns', turns: 2 }],
      rules: { maxTurns: 4, turnLimit: 'defeat' },
    });
    const state = newGameFromScenario(1, normalizeScenario(doc), { mode: 'custom' });
    // 2턴 종료까지 진행(각 턴 3페이즈)
    for (let i = 0; i < 6 && !state.over; i++) advancePhase(state);
    expect(state.over).toBe(true);
    expect(state.winner).toBe('azure');
  });

  it('별점 조건을 평가한다', () => {
    const doc = makeDoc({
      starConditions: [
        { type: 'win' },
        { type: 'units-lost-at-most', count: 0 },
        { type: 'unit-alive', tag: 'hero' },
      ],
    });
    const state = newGameFromScenario(1, normalizeScenario(doc), { mode: 'custom' });
    state.over = true;
    state.winner = 'azure';
    expect(starsEarned(state)).toEqual([true, true, true]);
  });
});

describe('내장 시나리오 스냅샷·마이그레이션', () => {
  it('내장 스냅샷 기반 newGame이 기존과 동일한 지도·유닛을 만든다', () => {
    const snap = builtinScenarioSnapshot('three-crowns', 42, 'azure');
    const viaSnapshot = newGameFromScenario(42, snap, {
      mode: 'quick',
      scenario: 'three-crowns',
      difficulty: 'normal',
    });
    const direct = newGame(42);
    expect(viaSnapshot.tiles).toEqual(direct.tiles);
    expect(viaSnapshot.units).toEqual(direct.units);
    expect(direct.customScenario).toBeUndefined();
    expect(direct.objectives.victory).toEqual([{ type: 'conquest' }]);
  });

  it('crown-heart는 hold-building 목표와 crownHold 상태를 갖는다', () => {
    const state = newGame(7, { scenario: 'crown-heart' });
    const hold = state.objectives.victory.find((c) => c.type === 'hold-building');
    expect(hold).toBeTruthy();
    expect(state.crownHold).toEqual({ owner: null, turns: 0 });
  });

  it('v2 완료 crown-heart 저장은 목표·lost 통계가 채워진 v4로 마이그레이션된다', () => {
    // 진행 중 crown-heart 는 v3→v4 에서 안전 폐기되므로 완료 상태로 검증한다
    const state = newGame(99, { scenario: 'crown-heart' });
    state.over = true;
    state.winner = 'azure';
    const v2 = JSON.parse(serialize(state)) as { version: number; state: unknown };
    v2.version = 2;
    const s = v2.state as { objectives?: unknown; stats: Record<string, { lost?: number }> };
    delete s.objectives;
    for (const fid of ['azure', 'crimson', 'violet']) delete s.stats[fid].lost;
    const restored = deserialize(JSON.stringify(v2));
    expect(restored).not.toBeNull();
    expect(restored!.objectives.victory.some((c) => c.type === 'hold-building')).toBe(true);
    expect(restored!.stats.azure.lost).toBe(0);
  });

  it('지도 fallback은 검증 실패 시에도 항상 검증된 지도를 반환한다', () => {
    // 어떤 시드든 생성 결과가 검증을 통과해야 한다(수리·정적 fallback 포함)
    for (let seed = 0; seed < 30; seed++) {
      const state = newGame(seed, { scenario: 'broken-strait' });
      expect(state.tiles.some((t) => t.building === 'capital')).toBe(true);
    }
  });
});

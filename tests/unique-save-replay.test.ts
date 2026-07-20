// 한 줄 목적: 고유 병종 저장·리플레이·분석 지표가 결정론적으로 보존되는지 검증한다
import { describe, expect, it } from 'vitest';
import { analyzeReplay } from '../src/core/analysis/replay-metrics';
import { runAiTurn } from '../src/core/ai';
import { CAMPAIGNS } from '../src/core/campaign/missions';
import {
  braceDefBonus,
  damageBreakdown,
  newGame,
  newGameFromScenario,
} from '../src/core/game';
import {
  buildReplayDocument,
  canonicalGameState,
  GAME_VERSION,
  stateDigest,
  verifyReplay,
} from '../src/core/replay';
import { checkReplayCompatibility } from '../src/core/replay-compat';
import { deserialize, serialize } from '../src/core/save';
import { normalizeScenario } from '../src/core/scenario/normalize';
import { addUnit, makeState } from './helpers';

/** 캠페인 청람 미션2(수호대 소개)를 끝까지 플레이한 뒤 리플레이 문서를 만든다. */
function playAzureGuardianMission(seed: number) {
  const mission = CAMPAIGNS.find((c) => c.faction === 'azure')!.missions[1];
  const snap = normalizeScenario(mission.scenario);
  const state = newGameFromScenario(seed, snap, { mode: 'campaign', difficulty: 'normal' });
  expect(state.units.some((u) => u.type === 'guardian')).toBe(true);
  let guard = 0;
  while (!state.over && guard < 200) {
    guard++;
    runAiTurn(state, state.current);
  }
  expect(state.over).toBe(true);
  const doc = buildReplayDocument(state, {
    replayId: `guardian-mission-${seed}`,
    createdAt: '2026-07-20T00:00:00.000Z',
  });
  expect(doc).not.toBeNull();
  return { state, doc: doc! };
}

describe('수호 태세 정본 digest', () => {
  it('같은 guardian 상태에서 movedThisTurn false/true digest가 다르다', () => {
    const state = makeState({ humanFaction: 'azure' });
    const g = addUnit(state, { faction: 'azure', type: 'guardian', q: 0, r: 0 });
    g.movedThisTurn = false;
    const dFalse = stateDigest(state);
    g.movedThisTurn = true;
    const dTrue = stateDigest(state);
    expect(dFalse).not.toBe(dTrue);
  });

  it('수호 태세 활성·비활성 피해와 digest가 모두 다르다', () => {
    // 기병 atk7 vs 수호대 def4 → brace 시 피해1, 이동 후 피해3
    const idle = makeState({ humanFaction: 'azure' });
    const guardIdle = addUnit(idle, {
      faction: 'azure',
      type: 'guardian',
      q: 1,
      r: 1,
      movedThisTurn: false,
    });
    const atkIdle = addUnit(idle, { faction: 'crimson', type: 'cavalry', q: 2, r: 1 });
    const moved = makeState({ humanFaction: 'azure' });
    const guardMoved = addUnit(moved, {
      faction: 'azure',
      type: 'guardian',
      q: 1,
      r: 1,
      movedThisTurn: true,
    });
    const atkMoved = addUnit(moved, { faction: 'crimson', type: 'cavalry', q: 2, r: 1 });

    expect(braceDefBonus(guardIdle)).toBe(2);
    expect(braceDefBonus(guardMoved)).toBe(0);
    const bdIdle = damageBreakdown(idle, atkIdle, guardIdle);
    const bdMoved = damageBreakdown(moved, atkMoved, guardMoved);
    expect(bdIdle.braceDef).toBe(2);
    expect(bdMoved.braceDef).toBe(0);
    expect(bdIdle.total).toBeLessThan(bdMoved.total);
    expect(stateDigest(idle)).not.toBe(stateDigest(moved));
  });

  it('저장 왕복 후 guardian movedThisTurn=false가 보존된다', () => {
    const state = makeState({ humanFaction: 'azure' });
    addUnit(state, {
      faction: 'azure',
      type: 'guardian',
      q: 0,
      r: 1,
      movedThisTurn: false,
    });
    const restored = deserialize(serialize(state));
    expect(restored).not.toBeNull();
    const rg = restored!.units.find((u) => u.type === 'guardian')!;
    expect(rg.movedThisTurn).toBe(false);
    const canonUnits = (
      canonicalGameState(restored!) as { units: { type: string; movedThisTurn?: boolean }[] }
    ).units;
    const cg = canonUnits.find((u) => u.type === 'guardian')!;
    expect(cg.movedThisTurn).toBe(false);
  });

  it('저장 왕복 후 guardian movedThisTurn=true가 보존된다', () => {
    const state = makeState({ humanFaction: 'azure' });
    addUnit(state, {
      faction: 'azure',
      type: 'guardian',
      q: 0,
      r: 1,
      movedThisTurn: true,
    });
    const restored = deserialize(serialize(state));
    expect(restored).not.toBeNull();
    const rg = restored!.units.find((u) => u.type === 'guardian')!;
    expect(rg.movedThisTurn).toBe(true);
    const canonUnits = (
      canonicalGameState(restored!) as { units: { type: string; movedThisTurn?: boolean }[] }
    ).units;
    const cg = canonUnits.find((u) => u.type === 'guardian')!;
    expect(cg.movedThisTurn).toBe(true);
  });

  it('2.2 guardian 리플레이가 exact 검증을 통과한다', () => {
    const { doc } = playAzureGuardianMission(20262201);
    const v = verifyReplay(doc);
    expect(v.ok, v.ok ? '' : `${v.reason}`).toBe(true);
    expect(checkReplayCompatibility(doc).compatibility).toBe('exact');
  });

  it('guardian 수호 태세 정본 상태를 변조하면 digest 검증이 실패한다', () => {
    const { state, doc } = playAzureGuardianMission(20262202);
    expect(verifyReplay(doc).ok).toBe(true);

    // 재생된 최종 상태에서 guardian movedThisTurn만 뒤집으면 digest가 달라져 불일치가 난다
    const verified = verifyReplay(doc);
    expect(verified.ok).toBe(true);
    const live = verified.state!;
    const g = live.units.find((u) => u.type === 'guardian');
    if (g) {
      const before = stateDigest(live);
      g.movedThisTurn = !(g.movedThisTurn === true);
      const after = stateDigest(live);
      expect(after).not.toBe(before);
      expect(after).not.toBe(doc.finalStateDigest);
      // 기록된 최종 digest를 변조 상태로 바꾸면 재생 검증이 실패한다
      expect(verifyReplay({ ...doc, finalStateDigest: after }).ok).toBe(false);
    } else {
      // 수호대가 전멸한 시드: 최종 digest 문자열 변조로 검출을 확인
      expect(verifyReplay({ ...doc, finalStateDigest: 'deadbeefdeadbeef' }).ok).toBe(false);
    }
    void state;
  });

  it('공용 병종 정본에는 movedThisTurn이 없어 2.1 이하 digest 형식을 보존한다', () => {
    const state = makeState();
    addUnit(state, { faction: 'azure', type: 'infantry', q: 0, r: 0, movedThisTurn: true });
    addUnit(state, { faction: 'crimson', type: 'cavalry', q: 1, r: 0, movedThisTurn: false });
    addUnit(state, { faction: 'violet', type: 'archer', q: 2, r: 0 });
    const baseCanon = canonicalGameState(state) as { units: Record<string, unknown>[] };
    expect(
      baseCanon.units.every((u) => !Object.prototype.hasOwnProperty.call(u, 'movedThisTurn')),
    ).toBe(true);
    addUnit(state, { faction: 'azure', type: 'guardian', q: 0, r: 1, movedThisTurn: true });
    const canon = canonicalGameState(state) as {
      units: { type: string; movedThisTurn?: boolean }[];
    };
    const shared = canon.units.filter((u) => u.type !== 'guardian');
    expect(shared.every((u) => u.movedThisTurn === undefined)).toBe(true);
    const g = canon.units.find((u) => u.type === 'guardian')!;
    expect(g.movedThisTurn).toBe(true);
  });
});

describe('고유 병종 저장·리플레이', () => {
  it('고유 병종·movedThisTurn·uniqueUnits 규칙을 저장 왕복으로 보존한다', () => {
    const state = newGame(101, { difficulty: 'normal' });
    expect(state.objectives.uniqueUnits).toBe(true);
    const g = addUnit(state, {
      faction: 'azure',
      type: 'guardian',
      q: state.units[0].q + 2,
      r: state.units[0].r,
    });
    if (state.units.filter((u) => u.q === g.q && u.r === g.r).length > 1) {
      g.q += 1;
    }
    g.movedThisTurn = false;
    const free = state.tiles.find(
      (t) => t.terrain !== 'water' && !state.units.some((u) => u.q === t.q && u.r === t.r),
    )!;
    g.q = free.q;
    g.r = free.r;
    const restored = deserialize(serialize(state));
    expect(restored).not.toBeNull();
    expect(restored!.objectives.uniqueUnits).toBe(true);
    const rg = restored!.units.find((u) => u.type === 'guardian');
    expect(rg).toBeDefined();
    expect(rg!.faction).toBe('azure');
  });

  it('uniqueUnits 없는 기존 저장은 공용 로스터 의미를 유지한다', () => {
    const state = newGame(3);
    delete state.objectives.uniqueUnits;
    const restored = deserialize(serialize(state));
    expect(restored).not.toBeNull();
    expect(restored!.objectives.uniqueUnits).toBeUndefined();
  });

  it('캠페인 미션2(고유 소개) 전체 플레이 리플레이가 digest 0불일치다', () => {
    for (const c of CAMPAIGNS) {
      const m = c.missions[1];
      const snap = normalizeScenario(m.scenario);
      const state = newGameFromScenario(4242, snap, { mode: 'campaign', difficulty: 'hard' });
      expect(state.objectives.uniqueUnits).toBe(true);
      let guard = 0;
      while (!state.over && guard < 200) {
        guard++;
        runAiTurn(state, state.current);
      }
      expect(state.over).toBe(true);
      const doc = buildReplayDocument(state, {
        replayId: `unique-${m.id}`,
        createdAt: '2026-07-20T00:00:00.000Z',
      });
      expect(doc).not.toBeNull();
      const v = verifyReplay(doc!);
      expect(v.ok, `${m.id} ${!v.ok ? v.reason : ''}`).toBe(true);
    }
  });

  it('2.2.1 이후 현행 리플레이 호환 등급은 exact다', () => {
    const state = newGame(9);
    let guard = 0;
    while (!state.over && guard < 200) {
      guard++;
      runAiTurn(state, state.current);
    }
    const doc = buildReplayDocument(state, {
      replayId: 'compat-22',
      createdAt: '2026-07-20T00:00:00.000Z',
    })!;
    // 현행 GAME_VERSION(2.2.1+) 문서는 exact. 2.2.0 라벨을 붙여 exact를 가장하지 않는다.
    expect(doc.gameVersion).toBe(GAME_VERSION);
    expect(GAME_VERSION).not.toBe('2.2.0');
    const d = checkReplayCompatibility(doc);
    expect(d.compatibility).toBe('exact');
    expect(d.reasonCode).toBe('exact');
  });

  it('2.2.0 라벨 문서(현행 digest)는 migratable이며 migration 실패 시 unsupported다', () => {
    // 현행 digest로 만든 문서에 2.2.0 라벨만 붙이면 legacy 검증이 실패해야 정직하다
    const state = newGame(9);
    let guard = 0;
    while (!state.over && guard < 200) {
      guard++;
      runAiTurn(state, state.current);
    }
    const doc = buildReplayDocument(state, {
      replayId: 'compat-220-dishonest',
      createdAt: '2026-07-20T00:00:00.000Z',
    })!;
    const as220 = { ...doc, gameVersion: '2.2.0' };
    const d = checkReplayCompatibility(as220);
    // guardian 유무와 무관하게 정책은 migratable 항목을 탄다. 현행 digest는 legacy와 다를 수 있어
    // migration 실패(unsupported) 또는 성공(migratable) 모두 가능하나 exact는 아니다.
    expect(d.compatibility).not.toBe('exact');
    expect(['migratable', 'unsupported']).toContain(d.compatibility);
  });
});

describe('고유 병종 분석 지표', () => {
  it('빠른 전투 리플레이 분석에 6병종 슬롯과 고유 지표 필드가 있다', () => {
    const state = newGame(20260720, { difficulty: 'hard' });
    let guard = 0;
    while (!state.over && guard < 200) {
      guard++;
      runAiTurn(state, state.current);
    }
    const doc = buildReplayDocument(state, {
      replayId: 'an-unique',
      createdAt: '2026-07-20T00:00:00.000Z',
    })!;
    const r = analyzeReplay(doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const t of ['infantry', 'archer', 'cavalry', 'guardian', 'raider', 'crossbow'] as const) {
      expect(r.analysis.byClass[t]).toBeDefined();
      expect(r.analysis.productionByClass[t]).toBeGreaterThanOrEqual(0);
    }
    expect(r.analysis.braceActivations).toBeGreaterThanOrEqual(0);
    expect(r.analysis.plunderGold).toBeGreaterThanOrEqual(0);
    expect(r.analysis.armorPiercingAttacks).toBeGreaterThanOrEqual(0);
    expect(r.analysis.armorPiercingIgnored).toBeGreaterThanOrEqual(0);
  });
});

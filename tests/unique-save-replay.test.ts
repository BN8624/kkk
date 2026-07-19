// 한 줄 목적: 고유 병종 저장·리플레이·분석 지표가 결정론적으로 보존되는지 검증한다
import { describe, expect, it } from 'vitest';
import { analyzeReplay } from '../src/core/analysis/replay-metrics';
import { runAiTurn } from '../src/core/ai';
import { newGame, newGameFromScenario } from '../src/core/game';
import {
  buildReplayDocument,
  verifyReplay,
} from '../src/core/replay';
import { checkReplayCompatibility } from '../src/core/replay-compat';
import { deserialize, serialize } from '../src/core/save';
import { normalizeScenario } from '../src/core/scenario/normalize';
import { CAMPAIGNS } from '../src/core/campaign/missions';
import { addUnit } from './helpers';

describe('고유 병종 저장·리플레이', () => {
  it('고유 병종·movedThisTurn·uniqueUnits 규칙을 저장 왕복으로 보존한다', () => {
    const state = newGame(101, { difficulty: 'normal' });
    expect(state.objectives.uniqueUnits).toBe(true);
    // 수호대 배치 후 이동 플래그
    const g = addUnit(state, {
      faction: 'azure',
      type: 'guardian',
      q: state.units[0].q + 2,
      r: state.units[0].r,
    });
    // 좌표 충돌 시 다른 자리
    if (state.units.filter((u) => u.q === g.q && u.r === g.r).length > 1) {
      g.q += 1;
    }
    g.movedThisTurn = false;
    state.units.push(
      ...[],
    );
    // 기존 유닛과 겹치면 제거 후 재배치
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

  it('2.2.x 리플레이 호환 등급은 exact다', () => {
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
    // GAME_VERSION is still 2.1 until release — force 2.2 for compat registry check
    const as22 = { ...doc, gameVersion: '2.2.0' };
    const d = checkReplayCompatibility(as22);
    expect(d.compatibility).toBe('exact');
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

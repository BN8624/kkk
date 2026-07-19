// 한 줄 목적: 공식 시나리오 팩 6종이 구조·품질 검사를 통과하고 평가 정책 관전에서 종료·승리 가능함을 검증한다
import { describe, expect, it } from 'vitest';
import { runQualityTrial } from '../src/core/eval/quality-trial';
import { normalizeScenario } from '../src/core/scenario/normalize';
import { OFFICIAL_SCENARIOS, officialScenarioById } from '../src/core/scenario/official';
import { scenarioQualityReport } from '../src/core/scenario/quality';
import { isPlayable, validateScenario } from '../src/core/scenario/validate';

describe('공식 시나리오 팩', () => {
  it('6종이며 ID·제목·설명·권장 정보가 채워져 있다', () => {
    expect(OFFICIAL_SCENARIOS).toHaveLength(6);
    const ids = new Set(OFFICIAL_SCENARIOS.map((s) => s.id));
    expect(ids.size).toBe(6);
    for (const s of OFFICIAL_SCENARIOS) {
      expect(s.id.startsWith('official-')).toBe(true);
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.metadata?.tags).toContain('official');
      expect(s.metadata?.recommendedFaction).toBeDefined();
      expect(s.metadata?.estimatedMinutes).toBeGreaterThan(0);
    }
    expect(officialScenarioById('official-lightning-duel')?.title).toBe('번개 결투장');
    expect(officialScenarioById('no-such')).toBeNull();
  });

  it('최소 세 전장에서 각 고유 병종(수호대·약탈대·쇠뇌대)이 시작 배치된다', () => {
    const types = new Set(OFFICIAL_SCENARIOS.flatMap((s) => s.units.map((u) => u.type)));
    expect(types.has('guardian')).toBe(true);
    expect(types.has('raider')).toBe(true);
    expect(types.has('crossbow')).toBe(true);
    const withUnique = OFFICIAL_SCENARIOS.filter((s) =>
      s.units.some((u) => u.type === 'guardian' || u.type === 'raider' || u.type === 'crossbow'),
    );
    expect(withUnique.length).toBeGreaterThanOrEqual(3);
    for (const s of withUnique) {
      expect(s.rules.uniqueUnits).toBe(true);
    }
  });

  it.each(OFFICIAL_SCENARIOS.map((s) => [s.id, s] as const))(
    '%s — 구조 검증·품질 검사 PASS',
    (_id, doc) => {
      const issues = validateScenario(doc);
      expect(isPlayable(issues), issues.map((i) => i.code).join(',')).toBe(true);
      const quality = scenarioQualityReport(doc);
      const errors = quality.issues.filter((i) => i.severity === 'error');
      expect(errors, errors.map((e) => e.code).join(',')).toEqual([]);
    },
  );

  it.each(OFFICIAL_SCENARIOS.map((s) => [s.id, s] as const))(
    '%s — 평가 정책 관전에서 종료 불능·불법 상태 없이 끝나고 인간 승리가 존재한다',
    async (_id, doc) => {
      const report = await runQualityTrial(normalizeScenario(doc), {
        noisySeeds: 3,
        yieldBetweenGames: false,
      });
      expect(report).not.toBeNull();
      expect(report!.unfinished).toBe(0);
      expect(report!.invalidStates).toBe(0);
      expect(report!.rejectedCommands).toBe(0);
      expect(report!.stalledFactions).toEqual([]);
      const humanWins = Object.values(report!.policyWins).reduce((a, b) => a + (b ?? 0), 0);
      expect(humanWins, '어떤 정책도 승리하지 못함').toBeGreaterThanOrEqual(1);
    },
  );
});

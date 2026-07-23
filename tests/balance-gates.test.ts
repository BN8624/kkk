// 한 줄 목적: 6병종·왕국 승률·정복 종료·병종 편중 밸런스 게이트 회귀를 검증한다
import { describe, expect, it } from 'vitest';
import {
  checkConquestTurnLimitGates,
  checkOverallWinRateGates,
  checkScenarioWinRateGates,
  checkUnitBiasGates,
  evaluateBalanceGates,
  type ScenarioOutcomeSummary,
  type UnitProductionStats,
} from '../src/core/eval/balance-gates';
import { BALANCE_UNIT_TYPES } from '../src/core/eval/balance-gates';
import type { UnitTypeId } from '../src/core/types';

function emptyUnitStats(overrides?: Partial<Record<UnitTypeId, Partial<UnitProductionStats>>>): Record<
  UnitTypeId,
  UnitProductionStats
> {
  const base = {} as Record<UnitTypeId, UnitProductionStats>;
  for (const t of BALANCE_UNIT_TYPES) {
    base[t] = {
      produced: 100,
      spawned: 100,
      alive: 40,
      share: 1 / BALANCE_UNIT_TYPES.length,
      survivalRate: 0.4,
      gamesProduced: 50,
      eligibleGames: 100,
      produceRate: 0.5,
      byFaction: { azure: 30, crimson: 30, violet: 40 },
      byScenario: {},
      ...overrides?.[t],
    };
  }
  return base;
}

describe('balance gates', () => {
  it('6병종 모두 통계 키에 포함된다', () => {
    const stats = emptyUnitStats();
    expect(Object.keys(stats).sort()).toEqual([...BALANCE_UNIT_TYPES].sort());
    for (const t of BALANCE_UNIT_TYPES) {
      expect(stats[t].produced).toBeGreaterThan(0);
    }
  });

  it('고유 병종 분모가 적격 게임만 사용한다', () => {
    const stats = emptyUnitStats({
      guardian: { gamesProduced: 40, eligibleGames: 100, produceRate: 0.4, produced: 40 },
      raider: { gamesProduced: 90, eligibleGames: 100, produceRate: 0.9, produced: 90 },
      crossbow: { gamesProduced: 20, eligibleGames: 50, produceRate: 0.4, produced: 20 },
    });
    // 적격 50 중 20 = 40% → 통과, 전체 100 기준이면 20%로 실패했을 것
    const fails = checkUnitBiasGates(stats, 300);
    expect(fails.some((f) => f.code === 'unique-produce-low' && f.message.includes('crossbow'))).toBe(
      false,
    );
  });

  it('왕국 전체 승률 게이트 실패', () => {
    const fails = checkOverallWinRateGates({ azure: 0.5, crimson: 0.3, violet: 0.2 });
    expect(fails.some((f) => f.code === 'overall-win-high')).toBe(true);
    expect(fails.some((f) => f.code === 'overall-win-low')).toBe(true);
    expect(fails.some((f) => f.code === 'overall-win-spread')).toBe(true);
  });

  it('시나리오 승률 편차 게이트 실패', () => {
    const per: ScenarioOutcomeSummary[] = [
      {
        scenario: 'three-crowns',
        games: 100,
        winRates: { azure: 0.55, crimson: 0.25, violet: 0.2 },
        endReasons: { conquest: 40, 'crown-hold': 0, 'turn-limit': 60, unfinished: 0 },
        turnLimitRate: 0.6,
      },
    ];
    const fails = checkScenarioWinRateGates(per);
    expect(fails.some((f) => f.code === 'scenario-win-high')).toBe(true);
    expect(fails.some((f) => f.code === 'scenario-win-spread')).toBe(true);
  });

  it('정복 시나리오 턴 제한 비율 게이트 실패', () => {
    const per: ScenarioOutcomeSummary[] = [
      {
        scenario: 'three-crowns',
        games: 100,
        winRates: { azure: 0.34, crimson: 0.33, violet: 0.33 },
        endReasons: { conquest: 20, 'crown-hold': 0, 'turn-limit': 80, unfinished: 0 },
        turnLimitRate: 0.8,
      },
      {
        scenario: 'crown-heart',
        games: 100,
        winRates: { azure: 0.34, crimson: 0.33, violet: 0.33 },
        endReasons: { conquest: 5, 'crown-hold': 90, 'turn-limit': 5, unfinished: 0 },
        turnLimitRate: 0.05,
      },
    ];
    const fails = checkConquestTurnLimitGates(per);
    expect(fails).toHaveLength(1);
    expect(fails[0].code).toBe('conquest-turn-limit');
  });

  it('병종 편중 게이트 실패', () => {
    const stats = emptyUnitStats({
      infantry: { produced: 700, share: 0.7, gamesProduced: 100, eligibleGames: 100, produceRate: 1 },
      archer: { produced: 200, share: 0.2 },
      cavalry: { produced: 20, share: 0.02 },
      guardian: { produced: 30, share: 0.03, gamesProduced: 30, eligibleGames: 100, produceRate: 0.3 },
      raider: { produced: 30, share: 0.03, gamesProduced: 99, eligibleGames: 100, produceRate: 0.99 },
      crossbow: { produced: 20, share: 0.02, gamesProduced: 20, eligibleGames: 100, produceRate: 0.2 },
    });
    const fails = checkUnitBiasGates(stats, 920);
    expect(fails.some((f) => f.code === 'unit-share-high')).toBe(true);
    expect(fails.some((f) => f.code === 'cavalry-shared-low')).toBe(true);
    expect(fails.some((f) => f.code === 'unique-produce-low')).toBe(true);
    expect(fails.some((f) => f.code === 'unique-produce-mechanical')).toBe(true);
  });

  it('균형 입력은 PASS', () => {
    const stats = emptyUnitStats({
      infantry: { produced: 350, share: 0.35, produceRate: 0.9, gamesProduced: 90, eligibleGames: 100 },
      archer: { produced: 250, share: 0.25, produceRate: 0.7, gamesProduced: 70, eligibleGames: 100 },
      cavalry: { produced: 120, share: 0.12, produceRate: 0.5, gamesProduced: 50, eligibleGames: 100 },
      guardian: { produced: 100, share: 0.1, produceRate: 0.55, gamesProduced: 55, eligibleGames: 100 },
      raider: { produced: 100, share: 0.1, produceRate: 0.6, gamesProduced: 60, eligibleGames: 100 },
      crossbow: { produced: 80, share: 0.08, produceRate: 0.5, gamesProduced: 50, eligibleGames: 100 },
    });
    const r = evaluateBalanceGates({
      totalGames: 100,
      overallWinRates: { azure: 0.36, crimson: 0.33, violet: 0.31 },
      perScenario: [
        {
          scenario: 'three-crowns',
          games: 40,
          winRates: { azure: 0.38, crimson: 0.32, violet: 0.3 },
          endReasons: { conquest: 20, 'crown-hold': 0, 'turn-limit': 20, unfinished: 0 },
          turnLimitRate: 0.5,
        },
        {
          scenario: 'broken-strait',
          games: 30,
          winRates: { azure: 0.35, crimson: 0.35, violet: 0.3 },
          endReasons: { conquest: 15, 'crown-hold': 0, 'turn-limit': 15, unfinished: 0 },
          turnLimitRate: 0.5,
        },
        {
          scenario: 'crown-heart',
          games: 30,
          winRates: { azure: 0.34, crimson: 0.36, violet: 0.3 },
          endReasons: { conquest: 2, 'crown-hold': 26, 'turn-limit': 2, unfinished: 0 },
          turnLimitRate: 0.067,
        },
      ],
      unitStats: stats,
      sharedProducedTotal: 720,
    });
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
  });
});

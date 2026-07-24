// 한 줄 목적: 6병종·왕국 승률·정복 종료·병종 편중 밸런스 게이트 회귀를 검증한다
import { describe, expect, it } from 'vitest';
import {
  aggregateOverallWinRates,
  aggregateScenarioOutcomeSummaries,
  aggregateUnitProductionStats,
  BALANCE_UNIT_TYPES,
  checkConquestTurnLimitGates,
  checkOverallWinRateGates,
  checkScenarioWinRateGates,
  checkUnitBiasGates,
  evaluateBalanceGates,
  formatGateFailure,
  type ScenarioOutcomeSummary,
  type UnitAggGame,
  type UnitProductionStats,
} from '../src/core/eval/balance-gates';
import type { FactionId, UnitTypeId } from '../src/core/types';

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

function zeroProduced(): Record<UnitTypeId, number> {
  return Object.fromEntries(BALANCE_UNIT_TYPES.map((t) => [t, 0])) as Record<UnitTypeId, number>;
}

function zeroByFaction(): Record<FactionId, Record<UnitTypeId, number>> {
  return {
    azure: zeroProduced(),
    crimson: zeroProduced(),
    violet: zeroProduced(),
  };
}

/** 집계 테스트용 최소 게임 슬라이스 */
function makeAggGame(
  partial: Partial<UnitAggGame> & { typesProduced?: ReadonlySet<UnitTypeId>; illegal?: string[] },
): UnitAggGame {
  const produced = { ...zeroProduced(), ...(partial.produced as Record<UnitTypeId, number> | undefined) };
  return {
    scenario: partial.scenario ?? 'three-crowns',
    illegal: partial.illegal ?? [],
    produced,
    spawned: partial.spawned ? { ...zeroProduced(), ...partial.spawned } : { ...produced },
    alive: partial.alive ? { ...zeroProduced(), ...partial.alive } : { ...produced },
    producedByFaction: partial.producedByFaction
      ? {
          azure: { ...zeroProduced(), ...partial.producedByFaction.azure },
          crimson: { ...zeroProduced(), ...partial.producedByFaction.crimson },
          violet: { ...zeroProduced(), ...partial.producedByFaction.violet },
        }
      : zeroByFaction(),
    typesProduced: partial.typesProduced ?? new Set(),
  };
}

describe('unit production aggregation', () => {
  it('6병종 키를 모두 출력하고 produceRate를 gamesProduced/eligibleGames로 계산한다', () => {
    const outcomes: UnitAggGame[] = [
      makeAggGame({
        typesProduced: new Set(['infantry', 'guardian']),
        produced: { ...zeroProduced(), infantry: 2, guardian: 1 },
        producedByFaction: {
          azure: { ...zeroProduced(), infantry: 1, guardian: 1 },
          crimson: { ...zeroProduced(), infantry: 1 },
          violet: zeroProduced(),
        },
      }),
      makeAggGame({
        typesProduced: new Set(['infantry', 'raider']),
        produced: { ...zeroProduced(), infantry: 1, raider: 1 },
        producedByFaction: {
          azure: { ...zeroProduced(), infantry: 1 },
          crimson: { ...zeroProduced(), raider: 1 },
          violet: zeroProduced(),
        },
      }),
      makeAggGame({
        // 불법 게임: 고유 병종 적격 집합에서 제외. 여기서만 crossbow 생산.
        illegal: ['unit-on-water'],
        typesProduced: new Set(['crossbow', 'infantry']),
        produced: { ...zeroProduced(), crossbow: 5, infantry: 1 },
        producedByFaction: {
          azure: zeroProduced(),
          crimson: zeroProduced(),
          violet: { ...zeroProduced(), crossbow: 5, infantry: 1 },
        },
      }),
    ];

    const { unitStats, sharedProducedTotal } = aggregateUnitProductionStats(outcomes);

    expect(Object.keys(unitStats).sort()).toEqual([...BALANCE_UNIT_TYPES].sort());
    for (const t of BALANCE_UNIT_TYPES) {
      expect(unitStats[t]).toBeDefined();
      expect(unitStats[t].produceRate).toBe(
        unitStats[t].eligibleGames > 0
          ? unitStats[t].gamesProduced / unitStats[t].eligibleGames
          : 0,
      );
    }

    // 공용: 전체 3게임 기준
    expect(unitStats.infantry.eligibleGames).toBe(3);
    expect(unitStats.infantry.gamesProduced).toBe(3);
    expect(unitStats.infantry.produceRate).toBe(1);

    // 고유: 합법 2게임만 적격. 불법 게임의 crossbow 생산은 분자에 넣지 않음
    expect(unitStats.guardian.eligibleGames).toBe(2);
    expect(unitStats.guardian.gamesProduced).toBe(1);
    expect(unitStats.guardian.produceRate).toBe(0.5);

    expect(unitStats.crossbow.eligibleGames).toBe(2);
    expect(unitStats.crossbow.gamesProduced).toBe(0);
    expect(unitStats.crossbow.produceRate).toBe(0);
    // 불법 게임 생산 수치는 produced에는 남지만 produceRate 분모/분자와 분리
    expect(unitStats.crossbow.produced).toBe(5);

    expect(sharedProducedTotal).toBe(
      unitStats.infantry.produced + unitStats.archer.produced + unitStats.cavalry.produced,
    );
  });

  it('불법 게임에서만 고유 병종을 생산해도 produceRate가 1을 초과하지 않는다', () => {
    const outcomes: UnitAggGame[] = [
      makeAggGame({ illegal: [], typesProduced: new Set(['infantry']) }),
      makeAggGame({
        illegal: ['nan-gold'],
        typesProduced: new Set(['guardian', 'raider', 'crossbow']),
        produced: { ...zeroProduced(), guardian: 1, raider: 1, crossbow: 1 },
      }),
    ];
    const { unitStats } = aggregateUnitProductionStats(outcomes);
    for (const t of ['guardian', 'raider', 'crossbow'] as const) {
      expect(unitStats[t].eligibleGames).toBe(1);
      expect(unitStats[t].gamesProduced).toBe(0);
      expect(unitStats[t].produceRate).toBe(0);
      expect(unitStats[t].produceRate).toBeLessThanOrEqual(1);
    }
  });
});

describe('win-rate aggregation (raw rates)', () => {
  it('게이트 입력 승률·턴제한율을 반올림 없이 집계한다', () => {
    // 1/3 ≈ 0.333... — toFixed(4)면 0.3333으로 잘림
    const outcomes = [
      { scenario: 'three-crowns' as const, winner: 'azure' as const, endReason: 'conquest' as const },
      { scenario: 'three-crowns' as const, winner: 'crimson' as const, endReason: 'turn-limit' as const },
      { scenario: 'three-crowns' as const, winner: 'violet' as const, endReason: 'conquest' as const },
    ];
    const overall = aggregateOverallWinRates(outcomes);
    expect(overall.azure).toBe(1 / 3);
    expect(overall.azure).not.toBe(+(1 / 3).toFixed(4));

    const per = aggregateScenarioOutcomeSummaries(outcomes, ['three-crowns']);
    expect(per[0].winRates.azure).toBe(1 / 3);
    expect(per[0].turnLimitRate).toBe(1 / 3);
  });

  it('임계값 근소 위반이 반올림으로 가려지지 않는다', () => {
    // 0.45001 > 0.45 → raw면 high 실패, 넷째 자리 반올림(0.4500)이면 통과
    const rates = { azure: 0.45001, crimson: 0.3, violet: 0.24999 };
    const fails = checkOverallWinRateGates(rates);
    expect(fails.some((f) => f.code === 'overall-win-high' && f.actual === 0.45001)).toBe(true);
    expect(fails.some((f) => f.code === 'overall-win-low' && f.actual === 0.24999)).toBe(true);
  });
});

describe('balance gates', () => {
  it('6병종 모두 통계 키에 포함된다', () => {
    const stats = emptyUnitStats();
    expect(Object.keys(stats).sort()).toEqual([...BALANCE_UNIT_TYPES].sort());
    for (const t of BALANCE_UNIT_TYPES) {
      expect(stats[t].produced).toBeGreaterThan(0);
    }
  });

  it('고유 병종 분모가 적격 게임만 사용한다', () => {
    // 집계 결과(동일 집합)를 게이트에 넣어 적격 분모 경로를 검증
    const outcomes: UnitAggGame[] = Array.from({ length: 50 }, () =>
      makeAggGame({
        typesProduced: new Set(['crossbow', 'infantry']),
        produced: { ...zeroProduced(), crossbow: 1, infantry: 1 },
      }),
    ).concat(
      Array.from({ length: 50 }, () =>
        makeAggGame({
          typesProduced: new Set(['infantry']),
          produced: { ...zeroProduced(), infantry: 1 },
        }),
      ),
    );
    const { unitStats, sharedProducedTotal } = aggregateUnitProductionStats(outcomes);
    expect(unitStats.crossbow.eligibleGames).toBe(100);
    expect(unitStats.crossbow.gamesProduced).toBe(50);
    expect(unitStats.crossbow.produceRate).toBe(0.5);
    // 적격 50% → unique-produce-low(40%) 미발동
    const fails = checkUnitBiasGates(unitStats, sharedProducedTotal);
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

  it('실패 게이트 포맷에 코드·actual·limit가 포함된다', () => {
    const fails = checkOverallWinRateGates({ azure: 0.5, crimson: 0.3, violet: 0.2 });
    const line = formatGateFailure(fails[0]);
    expect(line).toMatch(/^\[/);
    expect(line).toContain('actual=');
    expect(line).toContain('limit=');
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

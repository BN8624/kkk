// 한 줄 목적: 전술 밸런스 시뮬레이션 승률·종료·병종 편중 게이트를 순수 함수로 판정한다
// units.ts를 임포트하지 않는다(data↔units 순환 방지).
import type { FactionId, BuiltinScenarioId, UnitTypeId } from '../types';

/** 게이트·집계용 6병종 정본(UNIT_TYPE_IDS와 동일 순서). */
export const BALANCE_UNIT_TYPES: UnitTypeId[] = [
  'infantry',
  'archer',
  'cavalry',
  'guardian',
  'raider',
  'crossbow',
];

export const CONQUEST_SCENARIOS: BuiltinScenarioId[] = ['three-crowns', 'broken-strait'];

export function isUniqueUnitType(type: UnitTypeId): boolean {
  return type === 'guardian' || type === 'raider' || type === 'crossbow';
}

export function uniqueUnitFaction(type: UnitTypeId): FactionId | null {
  if (type === 'guardian') return 'azure';
  if (type === 'raider') return 'crimson';
  if (type === 'crossbow') return 'violet';
  return null;
}

export interface FactionWinRates {
  azure: number;
  crimson: number;
  violet: number;
}

export interface UnitProductionStats {
  produced: number;
  spawned: number;
  alive: number;
  share: number;
  survivalRate: number;
  gamesProduced: number;
  eligibleGames: number;
  produceRate: number;
  byFaction: Record<FactionId, number>;
  byScenario: Partial<Record<BuiltinScenarioId, number>>;
}

export interface ScenarioOutcomeSummary {
  scenario: BuiltinScenarioId;
  games: number;
  winRates: FactionWinRates;
  endReasons: {
    conquest: number;
    'crown-hold': number;
    'turn-limit': number;
    unfinished: number;
  };
  turnLimitRate: number;
}

export interface BalanceGateInput {
  totalGames: number;
  overallWinRates: FactionWinRates;
  perScenario: ScenarioOutcomeSummary[];
  unitStats: Record<UnitTypeId, UnitProductionStats>;
  sharedProducedTotal: number;
}

export interface BalanceGateFailure {
  code: string;
  message: string;
  actual: number;
  limit: number;
}

export function checkOverallWinRateGates(rates: FactionWinRates): BalanceGateFailure[] {
  const failures: BalanceGateFailure[] = [];
  const entries = Object.entries(rates) as [FactionId, number][];
  for (const [f, rate] of entries) {
    if (rate < 0.25) {
      failures.push({
        code: 'overall-win-low',
        message: `${f} 전체 승률 ${(rate * 100).toFixed(1)}% < 25%`,
        actual: rate,
        limit: 0.25,
      });
    }
    if (rate > 0.45) {
      failures.push({
        code: 'overall-win-high',
        message: `${f} 전체 승률 ${(rate * 100).toFixed(1)}% > 45%`,
        actual: rate,
        limit: 0.45,
      });
    }
  }
  const vals = entries.map(([, r]) => r);
  const spread = Math.max(...vals) - Math.min(...vals);
  if (spread > 0.15) {
    failures.push({
      code: 'overall-win-spread',
      message: `전체 승률 최고·최저 차이 ${(spread * 100).toFixed(1)}%p > 15%p`,
      actual: spread,
      limit: 0.15,
    });
  }
  return failures;
}

export function checkScenarioWinRateGates(
  perScenario: ScenarioOutcomeSummary[],
): BalanceGateFailure[] {
  const failures: BalanceGateFailure[] = [];
  for (const s of perScenario) {
    if (s.games <= 0) continue;
    const entries = Object.entries(s.winRates) as [FactionId, number][];
    for (const [f, rate] of entries) {
      if (rate < 0.2) {
        failures.push({
          code: 'scenario-win-low',
          message: `${s.scenario}/${f} 승률 ${(rate * 100).toFixed(1)}% < 20%`,
          actual: rate,
          limit: 0.2,
        });
      }
      if (rate > 0.5) {
        failures.push({
          code: 'scenario-win-high',
          message: `${s.scenario}/${f} 승률 ${(rate * 100).toFixed(1)}% > 50%`,
          actual: rate,
          limit: 0.5,
        });
      }
    }
    const vals = entries.map(([, r]) => r);
    const spread = Math.max(...vals) - Math.min(...vals);
    if (spread > 0.25) {
      failures.push({
        code: 'scenario-win-spread',
        message: `${s.scenario} 승률 최고·최저 차이 ${(spread * 100).toFixed(1)}%p > 25%p`,
        actual: spread,
        limit: 0.25,
      });
    }
  }
  return failures;
}

export function checkConquestTurnLimitGates(
  perScenario: ScenarioOutcomeSummary[],
): BalanceGateFailure[] {
  const failures: BalanceGateFailure[] = [];
  for (const s of perScenario) {
    if (!CONQUEST_SCENARIOS.includes(s.scenario)) continue;
    if (s.turnLimitRate > 0.7) {
      failures.push({
        code: 'conquest-turn-limit',
        message: `${s.scenario} 턴 제한 종료 ${(s.turnLimitRate * 100).toFixed(1)}% > 70%`,
        actual: s.turnLimitRate,
        limit: 0.7,
      });
    }
  }
  return failures;
}

export function checkUnitBiasGates(
  unitStats: Record<UnitTypeId, UnitProductionStats>,
  sharedProducedTotal: number,
): BalanceGateFailure[] {
  const failures: BalanceGateFailure[] = [];
  const totalProduced = BALANCE_UNIT_TYPES.reduce((s, t) => s + unitStats[t].produced, 0);

  for (const t of BALANCE_UNIT_TYPES) {
    const st = unitStats[t];
    if (totalProduced > 0 && st.share > 0.6) {
      failures.push({
        code: 'unit-share-high',
        message: `${t} 생산 비중 ${(st.share * 100).toFixed(1)}% > 60%`,
        actual: st.share,
        limit: 0.6,
      });
    }
  }

  if (sharedProducedTotal > 0) {
    const cavShare = unitStats.cavalry.produced / sharedProducedTotal;
    if (cavShare < 0.08) {
      failures.push({
        code: 'cavalry-shared-low',
        message: `공용 기병 비중 ${(cavShare * 100).toFixed(1)}% < 8% (공용 대비)`,
        actual: cavShare,
        limit: 0.08,
      });
    }
  }

  for (const t of BALANCE_UNIT_TYPES) {
    if (!isUniqueUnitType(t)) continue;
    const st = unitStats[t];
    if (st.eligibleGames <= 0) continue;
    if (st.produceRate < 0.4) {
      failures.push({
        code: 'unique-produce-low',
        message: `${t} 적격 생산률 ${(st.produceRate * 100).toFixed(1)}% < 40%`,
        actual: st.produceRate,
        limit: 0.4,
      });
    }
    if (st.produceRate > 0.95) {
      failures.push({
        code: 'unique-produce-mechanical',
        message: `${t} 적격 생산률 ${(st.produceRate * 100).toFixed(1)}% > 95%`,
        actual: st.produceRate,
        limit: 0.95,
      });
    }
  }
  return failures;
}

export function evaluateBalanceGates(input: BalanceGateInput): {
  pass: boolean;
  failures: BalanceGateFailure[];
} {
  const failures = [
    ...checkOverallWinRateGates(input.overallWinRates),
    ...checkScenarioWinRateGates(input.perScenario),
    ...checkConquestTurnLimitGates(input.perScenario),
    ...checkUnitBiasGates(input.unitStats, input.sharedProducedTotal),
  ];
  return { pass: failures.length === 0, failures };
}

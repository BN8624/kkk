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

/** 병종 생산 집계에 필요한 게임 슬라이스. */
export interface UnitAggGame {
  scenario: BuiltinScenarioId;
  illegal: readonly string[];
  produced: Readonly<Record<UnitTypeId, number>>;
  spawned: Readonly<Record<UnitTypeId, number>>;
  alive: Readonly<Record<UnitTypeId, number>>;
  producedByFaction: Readonly<Record<FactionId, Readonly<Record<UnitTypeId, number>>>>;
  typesProduced: ReadonlySet<UnitTypeId>;
}

export interface WinAggGame {
  scenario: BuiltinScenarioId;
  winner: FactionId | 'draw' | null;
  endReason: 'conquest' | 'crown-hold' | 'turn-limit' | 'unfinished';
}

const FACTIONS: FactionId[] = ['azure', 'crimson', 'violet'];

/** 실패 게이트를 코드·실제값·한도와 함께 한 줄로 포맷한다. */
export function formatGateFailure(f: BalanceGateFailure): string {
  return `[${f.code}] ${f.message} (actual=${f.actual}, limit=${f.limit})`;
}

/**
 * 6병종 생산 통계를 집계한다.
 * 병종별 적격 게임 집합을 먼저 정한 뒤 gamesProduced·eligibleGames·produceRate를 동일 집합에서 계산한다.
 * 비율 필드(share·survivalRate·produceRate)는 반올림하지 않은 원시 값이다.
 */
export function aggregateUnitProductionStats(
  outcomes: readonly UnitAggGame[],
): { unitStats: Record<UnitTypeId, UnitProductionStats>; sharedProducedTotal: number } {
  const legalOutcomes = outcomes.filter((o) => o.illegal.length === 0);
  const unitStats = {} as Record<UnitTypeId, UnitProductionStats>;

  for (const t of BALANCE_UNIT_TYPES) {
    const produced = outcomes.reduce((s, o) => s + (o.produced[t] ?? 0), 0);
    const spawned = outcomes.reduce((s, o) => s + (o.spawned[t] ?? 0), 0);
    const alive = outcomes.reduce((s, o) => s + (o.alive[t] ?? 0), 0);
    const byFaction = Object.fromEntries(FACTIONS.map((f) => [f, 0])) as Record<FactionId, number>;
    const byScenario: Partial<Record<BuiltinScenarioId, number>> = {};
    for (const o of outcomes) {
      for (const f of FACTIONS) byFaction[f] += o.producedByFaction[f]?.[t] ?? 0;
      byScenario[o.scenario] = (byScenario[o.scenario] ?? 0) + (o.produced[t] ?? 0);
    }

    // 고유 병종: 합법 게임만 적격. 공용 병종: 전체 게임. 분자·분모 동일 집합.
    const owner = uniqueUnitFaction(t);
    const eligible = owner != null ? legalOutcomes : outcomes;
    const eligibleGames = eligible.length;
    const gamesProduced = eligible.filter((o) => o.typesProduced.has(t)).length;
    const produceRate = eligibleGames > 0 ? gamesProduced / eligibleGames : 0;

    unitStats[t] = {
      produced,
      spawned,
      alive,
      share: 0,
      survivalRate: spawned > 0 ? alive / spawned : 0,
      gamesProduced,
      eligibleGames,
      produceRate,
      byFaction,
      byScenario,
    };
  }

  const producedSum = BALANCE_UNIT_TYPES.reduce((s, t) => s + unitStats[t].produced, 0);
  for (const t of BALANCE_UNIT_TYPES) {
    unitStats[t].share = producedSum > 0 ? unitStats[t].produced / producedSum : 0;
  }

  const sharedProducedTotal = BALANCE_UNIT_TYPES.filter((t) => !isUniqueUnitType(t)).reduce(
    (s, t) => s + unitStats[t].produced,
    0,
  );

  return { unitStats, sharedProducedTotal };
}

/** 전체 왕국 승률(원시 비율, 반올림 없음). */
export function aggregateOverallWinRates(
  outcomes: readonly { winner: FactionId | 'draw' | null }[],
): FactionWinRates {
  const total = outcomes.length || 1;
  const wins = Object.fromEntries(FACTIONS.map((f) => [f, 0])) as Record<FactionId, number>;
  for (const o of outcomes) {
    if (o.winner && o.winner !== 'draw') wins[o.winner]++;
  }
  return {
    azure: wins.azure / total,
    crimson: wins.crimson / total,
    violet: wins.violet / total,
  };
}

/** 시나리오별 승률·턴제한 종료율(원시 비율, 반올림 없음). */
export function aggregateScenarioOutcomeSummaries(
  outcomes: readonly WinAggGame[],
  scenarioIds: readonly BuiltinScenarioId[],
): ScenarioOutcomeSummary[] {
  return scenarioIds.map((sid) => {
    const games = outcomes.filter((o) => o.scenario === sid);
    const wins = Object.fromEntries(FACTIONS.map((f) => [f, 0])) as Record<FactionId, number>;
    for (const o of games) if (o.winner && o.winner !== 'draw') wins[o.winner]++;
    const reasons = { conquest: 0, 'crown-hold': 0, 'turn-limit': 0, unfinished: 0 };
    for (const o of games) reasons[o.endReason]++;
    const n = games.length || 1;
    return {
      scenario: sid,
      games: games.length,
      winRates: {
        azure: wins.azure / n,
        crimson: wins.crimson / n,
        violet: wins.violet / n,
      },
      endReasons: reasons,
      turnLimitRate: reasons['turn-limit'] / n,
    };
  });
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

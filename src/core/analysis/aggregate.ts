// 한 줄 목적: 여러 리플레이 분석을 합산해 승률·평균 턴·왕국/시나리오별 기록·추세 비교를 계산한다
import type { UnitTypeId } from '../types';
import type { ReplayAnalysis } from './replay-metrics';
import { difficultyName, factionName, t } from '../../i18n';

export interface GroupRecord {
  key: string;
  label: string;
  games: number;
  wins: number;
  avgTurns: number;
  avgScore: number;
}

export interface TrendComparison {
  recentGames: number;
  previousGames: number;
  recentWinRate: number;
  previousWinRate: number;
  recentAvgTurns: number;
  previousAvgTurns: number;
}

export interface AggregateAnalysis {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  avgTurns: number;
  avgScore: number;
  totalStars: number;
  starTotal: number;
  byFaction: GroupRecord[];
  byScenario: GroupRecord[];
  byDifficulty: GroupRecord[];
  /** 병과별 생산 비율(생산 총합 대비) */
  productionShare: Record<UnitTypeId, number>;
  /** 반복 패배 원인(빈도순) */
  commonLossReasons: { reason: string; count: number }[];
  /** 최근 5판 vs 이전 5판(생성 시각순, 10판 이상일 때) */
  trend: TrendComparison | null;
}

const UNIT_TYPES: UnitTypeId[] = ['infantry', 'archer', 'cavalry'];

function groupBy(
  list: ReplayAnalysis[],
  key: (a: ReplayAnalysis) => string,
  label: (a: ReplayAnalysis) => string,
): GroupRecord[] {
  const map = new Map<string, { label: string; items: ReplayAnalysis[] }>();
  for (const a of list) {
    const k = key(a);
    const g = map.get(k) ?? { label: label(a), items: [] };
    g.items.push(a);
    map.set(k, g);
  }
  return [...map.entries()].map(([k, g]) => ({
    key: k,
    label: g.label,
    games: g.items.length,
    wins: g.items.filter((x) => x.outcome === 'win').length,
    avgTurns: avg(g.items.map((x) => x.turns)),
    avgScore: avg(g.items.map((x) => x.score)),
  }));
}

function avg(nums: number[]): number {
  return nums.length === 0 ? 0 : Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

/** 패배 한 판의 대표 원인 문자열(규칙 기반). */
export function lossReason(a: ReplayAnalysis): string {
  if (a.outcome !== 'lose') return '';
  if (a.capitalThreatTurn !== null && a.lostUnits >= 3) return t('analysis.loss.capital');
  if (a.unfavorableTrades >= 2) return t('analysis.loss.trade');
  if (a.idleProductionTurns >= 2) return t('analysis.loss.production');
  if (a.lostUnits > a.kills + 1) return t('analysis.loss.units');
  if (a.idleUnitTurns >= a.turns) return t('analysis.loss.idle');
  return t('analysis.loss.objective');
}

/** 여러 분석의 합산. 빈 목록도 안전하게 처리한다. */
export function aggregateAnalyses(list: ReplayAnalysis[]): AggregateAnalysis {
  const wins = list.filter((a) => a.outcome === 'win').length;
  const losses = list.filter((a) => a.outcome === 'lose').length;
  const draws = list.filter((a) => a.outcome === 'draw').length;

  const prodTotal = { infantry: 0, archer: 0, cavalry: 0 } as Record<UnitTypeId, number>;
  for (const a of list) for (const t of UNIT_TYPES) prodTotal[t] += a.productionByClass[t];
  const prodSum = UNIT_TYPES.reduce((n, t) => n + prodTotal[t], 0);
  const productionShare = {} as Record<UnitTypeId, number>;
  for (const t of UNIT_TYPES) {
    productionShare[t] = prodSum > 0 ? Math.round((prodTotal[t] / prodSum) * 100) : 0;
  }

  const reasonCounts = new Map<string, number>();
  for (const a of list) {
    if (a.outcome !== 'lose') continue;
    const r = lossReason(a);
    reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
  }

  const sorted = [...list].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  let trend: TrendComparison | null = null;
  if (sorted.length >= 10) {
    const recent = sorted.slice(-5);
    const previous = sorted.slice(-10, -5);
    trend = {
      recentGames: recent.length,
      previousGames: previous.length,
      recentWinRate: Math.round((recent.filter((a) => a.outcome === 'win').length / 5) * 100),
      previousWinRate: Math.round((previous.filter((a) => a.outcome === 'win').length / 5) * 100),
      recentAvgTurns: avg(recent.map((a) => a.turns)),
      previousAvgTurns: avg(previous.map((a) => a.turns)),
    };
  }

  return {
    games: list.length,
    wins,
    losses,
    draws,
    winRate: list.length > 0 ? Math.round((wins / list.length) * 100) : 0,
    avgTurns: avg(list.map((a) => a.turns)),
    avgScore: avg(list.map((a) => a.score)),
    totalStars: list.reduce((n, a) => n + a.stars, 0),
    starTotal: list.reduce((n, a) => n + a.starTotal, 0),
    byFaction: groupBy(
      list,
      (a) => a.config.humanFaction,
      (a) => factionName(a.config.humanFaction),
    ),
    byScenario: groupBy(
      list,
      (a) => a.config.scenario,
      (a) => a.scenarioTitle,
    ),
    byDifficulty: groupBy(
      list,
      (a) => a.config.difficulty,
      (a) => difficultyName(a.config.difficulty),
    ),
    productionShare,
    commonLossReasons: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    trend,
  };
}

// 한 줄 목적: 분석 지표에서 규칙 기반 코칭 문구(잘한 점·놓친 기회·개선 후보)를 만든다(LLM·서버 없음)
import { t, unitName } from '../../i18n';
import type { AggregateAnalysis } from './aggregate';
import type { ReplayAnalysis } from './replay-metrics';

export interface CoachingNote {
  kind: 'praise' | 'missed' | 'advice';
  text: string;
}

/** 단일 게임 코칭. 규칙 기반으로 최대 6개를 만든다. */
export function coachSingleGame(a: ReplayAnalysis): CoachingNote[] {
  const notes: CoachingNote[] = [];

  // 잘한 점
  if (a.outcome === 'win' && a.turns <= Math.max(4, Math.round(a.turns * 0.75))) {
    notes.push({ kind: 'praise', text: t('analysis.coach.fastWin', { turns: a.turns }) });
  }
  if (a.kills >= 3 && a.unfavorableTrades === 0) {
    notes.push({ kind: 'praise', text: t('analysis.coach.cleanKills', { kills: a.kills }) });
  }
  if (a.captures.length >= 2) {
    notes.push({ kind: 'praise', text: t('analysis.coach.captures', { n: a.captures.length }) });
  }
  if (a.idleProductionTurns === 0 && a.productions > 0) {
    notes.push({ kind: 'praise', text: t('analysis.coach.production') });
  }

  // 놓친 기회
  if (a.missedKills.length > 0) {
    const m = a.missedKills[0];
    notes.push({
      kind: 'missed',
      text: t('analysis.coach.missedKills', {
        n: a.missedKills.length,
        turn: m.turn,
        attacker: unitName(m.attackerType),
        defender: unitName(m.defenderType),
      }),
    });
  }
  if (a.idleProductionTurns > 0) {
    notes.push({
      kind: 'missed',
      text: t('analysis.coach.idleProduction', {
        turns: a.idleProductionTurns,
        gold: a.idleProductionGold,
      }),
    });
  }
  if (a.idleUnitTurns >= 3) {
    notes.push({
      kind: 'missed',
      text: t('analysis.coach.idleUnits', { n: a.idleUnitTurns }),
    });
  }
  if (a.stagnantUnits > 0) {
    notes.push({
      kind: 'missed',
      text: t('analysis.coach.stagnant', { n: a.stagnantUnits }),
    });
  }

  // 개선 조언
  if (a.unfavorableTrades > 0) {
    notes.push({
      kind: 'advice',
      text: t('analysis.coach.badTrades', { n: a.unfavorableTrades }),
    });
  }
  if (a.counterDamageTaken > a.damageDealt / 2 && a.attacks > 0) {
    notes.push({
      kind: 'advice',
      text: t('analysis.coach.counter'),
    });
  }
  if (a.outcome === 'lose' && a.capitalThreatTurn !== null) {
    notes.push({
      kind: 'advice',
      text: t('analysis.coach.capital', { turn: a.capitalThreatTurn }),
    });
  }
  if (a.avgGoldAtTurnEnd >= 40) {
    notes.push({
      kind: 'advice',
      text: t('analysis.coach.gold', { gold: a.avgGoldAtTurnEnd }),
    });
  }

  return notes.slice(0, 6);
}

/** 다중 게임 코칭. */
export function coachAggregate(agg: AggregateAnalysis): CoachingNote[] {
  const notes: CoachingNote[] = [];
  if (agg.games === 0) return notes;

  if (agg.winRate >= 70) {
    notes.push({ kind: 'praise', text: t('analysis.coach.highWinRate', { rate: agg.winRate }) });
  } else if (agg.winRate <= 30 && agg.games >= 3) {
    notes.push({ kind: 'advice', text: t('analysis.coach.lowWinRate', { rate: agg.winRate }) });
  }

  const top = agg.commonLossReasons[0];
  if (top && top.count >= 2) {
    notes.push({
      kind: 'advice',
      text: t('analysis.coach.lossReason', { reason: top.reason, count: top.count }),
    });
  }

  const share = agg.productionShare;
  const classes = Object.entries(share).filter(([, v]) => v > 0);
  if (classes.length === 1) {
    notes.push({
      kind: 'advice',
      text: t('analysis.coach.oneUnit'),
    });
  }

  if (agg.trend) {
    const d = agg.trend.recentWinRate - agg.trend.previousWinRate;
    if (d > 0) {
      notes.push({ kind: 'praise', text: t('analysis.coach.trendUp', { rate: d }) });
    } else if (d < 0) {
      notes.push({ kind: 'advice', text: t('analysis.coach.trendDown', { rate: -d }) });
    }
  }

  return notes.slice(0, 6);
}

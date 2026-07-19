// 한 줄 목적: 분석 지표에서 규칙 기반 한국어 코칭 문구(잘한 점·놓친 기회·개선 후보)를 만든다(LLM·서버 없음)
import { UNIT_NAMES } from '../data';
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
    notes.push({ kind: 'praise', text: `${a.turns}턴 만에 승리했습니다 — 빠른 마무리였습니다.` });
  }
  if (a.kills >= 3 && a.unfavorableTrades === 0) {
    notes.push({ kind: 'praise', text: `${a.kills}기를 처치하는 동안 불리한 교환이 없었습니다.` });
  }
  if (a.captures.length >= 2) {
    notes.push({ kind: 'praise', text: `거점 ${a.captures.length}곳을 점령해 경제 우위를 만들었습니다.` });
  }
  if (a.idleProductionTurns === 0 && a.productions > 0) {
    notes.push({ kind: 'praise', text: '생산 가능한 턴을 놓치지 않고 병력을 보충했습니다.' });
  }

  // 놓친 기회
  if (a.missedKills.length > 0) {
    const m = a.missedKills[0];
    notes.push({
      kind: 'missed',
      text: `처치가 확실한 적을 ${a.missedKills.length}번 놓쳤습니다(예: ${m.turn}턴 ${UNIT_NAMES[m.attackerType]} → ${UNIT_NAMES[m.defenderType]}).`,
    });
  }
  if (a.idleProductionTurns > 0) {
    notes.push({
      kind: 'missed',
      text: `생산 가능한 거점이 있었지만 금을 사용하지 않은 턴이 ${a.idleProductionTurns}번 있었습니다(놀린 금 합계 ${a.idleProductionGold}).`,
    });
  }
  if (a.idleUnitTurns >= 3) {
    notes.push({
      kind: 'missed',
      text: `턴 종료 시 행동하지 않은 유닛이 누적 ${a.idleUnitTurns}기였습니다.`,
    });
  }
  if (a.stagnantUnits > 0) {
    notes.push({
      kind: 'missed',
      text: `${a.stagnantUnits}기가 3턴 이상 같은 자리에 머물렀습니다.`,
    });
  }

  // 개선 조언
  if (a.unfavorableTrades > 0) {
    notes.push({
      kind: 'advice',
      text: `공격자가 죽고 적이 살아남은 교환이 ${a.unfavorableTrades}번 있었습니다 — 공격 전 전투 예측을 확인하세요.`,
    });
  }
  if (a.counterDamageTaken > a.damageDealt / 2 && a.attacks > 0) {
    notes.push({
      kind: 'advice',
      text: '반격 피해가 큽니다 — 궁병으로 먼저 깎거나 지형 방어를 활용하세요.',
    });
  }
  if (a.outcome === 'lose' && a.capitalThreatTurn !== null) {
    notes.push({
      kind: 'advice',
      text: `${a.capitalThreatTurn}턴부터 수도가 위협받았습니다 — 방어 병력을 남겨 두세요.`,
    });
  }
  if (a.avgGoldAtTurnEnd >= 40) {
    notes.push({
      kind: 'advice',
      text: `턴 종료 평균 보유 금이 ${a.avgGoldAtTurnEnd}입니다 — 금을 병력으로 바꾸는 속도를 높이세요.`,
    });
  }

  return notes.slice(0, 6);
}

/** 다중 게임 코칭. */
export function coachAggregate(agg: AggregateAnalysis): CoachingNote[] {
  const notes: CoachingNote[] = [];
  if (agg.games === 0) return notes;

  if (agg.winRate >= 70) {
    notes.push({ kind: 'praise', text: `승률 ${agg.winRate}% — 더 높은 난이도에 도전할 때입니다.` });
  } else if (agg.winRate <= 30 && agg.games >= 3) {
    notes.push({ kind: 'advice', text: `승률 ${agg.winRate}% — 쉬운 난이도에서 전투 예측과 거점 점령을 연습해 보세요.` });
  }

  const top = agg.commonLossReasons[0];
  if (top && top.count >= 2) {
    notes.push({ kind: 'advice', text: `반복되는 패배 원인: ${top.reason}(${top.count}회).` });
  }

  const share = agg.productionShare;
  const classes = Object.entries(share).filter(([, v]) => v > 0);
  if (classes.length === 1) {
    notes.push({
      kind: 'advice',
      text: '한 병과만 생산하고 있습니다 — 상성(기병>궁병>보병>기병)을 활용해 조합을 섞어 보세요.',
    });
  }

  if (agg.trend) {
    const d = agg.trend.recentWinRate - agg.trend.previousWinRate;
    if (d > 0) {
      notes.push({ kind: 'praise', text: `최근 5판 승률이 이전 5판보다 ${d}%p 올랐습니다.` });
    } else if (d < 0) {
      notes.push({ kind: 'advice', text: `최근 5판 승률이 이전 5판보다 ${-d}%p 내렸습니다.` });
    }
  }

  return notes.slice(0, 6);
}

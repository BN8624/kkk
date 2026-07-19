// 한 줄 목적: 플레이 분석 결과를 JSON·Markdown·CSV 보고서 텍스트로 만든다(개인 식별 정보 없음)
import { GAME_VERSION } from '../replay';
import { UNIT_NAMES } from '../data';
import type { UnitTypeId } from '../types';
import { aggregateAnalyses, lossReason, type AggregateAnalysis } from './aggregate';
import { coachAggregate, coachSingleGame } from './coaching';
import type { ReplayAnalysis } from './replay-metrics';

export interface ReportFilters {
  /** 사용자에게 보여 준 필터 설명(예: "왕국: 남색 · 난이도: 보통"). 없으면 '전체'. */
  description: string;
}

const UNIT_TYPES: UnitTypeId[] = ['infantry', 'archer', 'cavalry'];

function outcomeWord(o: 'win' | 'lose' | 'draw'): string {
  return o === 'win' ? '승리' : o === 'lose' ? '패배' : '무승부';
}

/** JSON 보고서(기계 판독용). 브라우저 정보·개인 식별 정보는 포함하지 않는다. */
export function reportJson(list: ReplayAnalysis[], filters: ReportFilters): string {
  const agg = aggregateAnalyses(list);
  return JSON.stringify(
    {
      generator: 'three-crowns-island-playtest',
      gameVersion: GAME_VERSION,
      generatedAt: new Date().toISOString(),
      filters: filters.description,
      aggregate: agg,
      games: list,
    },
    null,
    1,
  );
}

/** CSV 요약(판별 1행). */
export function reportCsv(list: ReplayAnalysis[]): string {
  const header = [
    'replayId',
    'scenario',
    'faction',
    'difficulty',
    'mode',
    'outcome',
    'turns',
    'score',
    'stars',
    'commands',
    'moves',
    'attacks',
    'productions',
    'kills',
    'losses',
    'damageDealt',
    'damageTaken',
    'unfavorableTrades',
    'missedKills',
    'idleProductionTurns',
    'goldAtEnd',
  ].join(',');
  const rows = list.map((a) =>
    [
      a.replayId,
      a.config.scenario,
      a.config.humanFaction,
      a.config.difficulty,
      a.config.mode,
      a.outcome,
      a.turns,
      a.score,
      a.stars,
      a.commandCount,
      a.moves,
      a.attacks,
      a.productions,
      a.kills,
      a.lostUnits,
      a.damageDealt,
      a.damageTaken,
      a.unfavorableTrades,
      a.missedKills.length,
      a.idleProductionTurns,
      a.goldAtEnd,
    ]
      .map((v) => String(v).replace(/[",\n]/g, ' '))
      .join(','),
  );
  return [header, ...rows].join('\n');
}

/** Markdown 보고서(사람 판독용, GitHub 기여 첨부용). */
export function reportMarkdown(list: ReplayAnalysis[], filters: ReportFilters): string {
  const agg: AggregateAnalysis = aggregateAnalyses(list);
  const lines: string[] = [];
  lines.push('# 세 왕관의 섬 — 플레이테스트 보고서');
  lines.push('');
  lines.push(`- 게임 버전: ${GAME_VERSION}`);
  lines.push(`- 분석한 리플레이: ${agg.games}판`);
  lines.push(`- 필터: ${filters.description}`);
  lines.push(`- 승/패/무: ${agg.wins}/${agg.losses}/${agg.draws} (승률 ${agg.winRate}%)`);
  lines.push(`- 평균 종료 턴: ${agg.avgTurns} · 평균 점수: ${agg.avgScore}`);
  if (agg.starTotal > 0) lines.push(`- 별 획득: ${agg.totalStars}/${agg.starTotal}`);
  lines.push('');

  lines.push('## 병과 사용(생산 비율)');
  lines.push('');
  for (const t of UNIT_TYPES) {
    lines.push(`- ${UNIT_NAMES[t]}: ${agg.productionShare[t]}%`);
  }
  lines.push('');

  if (agg.commonLossReasons.length > 0) {
    lines.push('## 주요 패배 원인');
    lines.push('');
    for (const r of agg.commonLossReasons) lines.push(`- ${r.reason}: ${r.count}회`);
    lines.push('');
  }

  if (agg.byScenario.length > 0) {
    lines.push('## 시나리오별 기록');
    lines.push('');
    lines.push('| 시나리오 | 판 수 | 승리 | 평균 턴 | 평균 점수 |');
    lines.push('| --- | ---: | ---: | ---: | ---: |');
    for (const g of agg.byScenario) {
      lines.push(`| ${g.label} | ${g.games} | ${g.wins} | ${g.avgTurns} | ${g.avgScore} |`);
    }
    lines.push('');
  }

  if (agg.byFaction.length > 0) {
    lines.push('## 왕국별 기록');
    lines.push('');
    lines.push('| 왕국 | 판 수 | 승리 | 평균 턴 |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const g of agg.byFaction) lines.push(`| ${g.label} | ${g.games} | ${g.wins} | ${g.avgTurns} |`);
    lines.push('');
  }

  const campaignGames = list.filter((a) => a.config.mode === 'campaign');
  if (campaignGames.length > 0) {
    lines.push('## 캠페인 별점 분포');
    lines.push('');
    const byMission = new Map<string, ReplayAnalysis[]>();
    for (const a of campaignGames) {
      const arr = byMission.get(a.config.scenario) ?? [];
      arr.push(a);
      byMission.set(a.config.scenario, arr);
    }
    for (const [id, games] of byMission) {
      const stars = games.map((g) => g.stars).join(', ');
      lines.push(`- ${games[0].scenarioTitle}(${id}): [${stars}]`);
    }
    lines.push('');
  }

  const coaching = coachAggregate(agg);
  if (coaching.length > 0) {
    lines.push('## 개선 후보');
    lines.push('');
    for (const c of coaching) lines.push(`- ${c.text}`);
    lines.push('');
  }

  lines.push('## 게임별 요약');
  lines.push('');
  lines.push('| 리플레이 | 시나리오 | 결과 | 턴 | 점수 | 별 | 비고 |');
  lines.push('| --- | --- | --- | ---: | ---: | ---: | --- |');
  for (const a of list) {
    const note = a.outcome === 'lose' ? lossReason(a) : coachSingleGame(a)[0]?.text ?? '';
    lines.push(
      `| ${a.replayId} | ${a.scenarioTitle} | ${outcomeWord(a.outcome)} | ${a.turns} | ${a.score} | ${a.stars}/${a.starTotal} | ${note.replace(/\|/g, '·')} |`,
    );
  }
  lines.push('');
  lines.push(`원본 리플레이 ID: ${list.map((a) => a.replayId).join(', ')}`);
  lines.push('');
  return lines.join('\n');
}

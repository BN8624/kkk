// 한 줄 목적: 플레이 분석 결과를 JSON·Markdown·CSV 보고서 텍스트로 만든다(개인 식별 정보 없음)
import { GAME_VERSION } from '../replay';
import type { UnitTypeId } from '../types';
import { t, unitName } from '../../i18n';
import { aggregateAnalyses, lossReason, type AggregateAnalysis } from './aggregate';
import { coachAggregate, coachSingleGame } from './coaching';
import type { ReplayAnalysis } from './replay-metrics';

export interface ReportFilters {
  /** 사용자에게 보여 준 필터 설명(예: "왕국: 남색 · 난이도: 보통"). 없으면 '전체'. */
  description: string;
}

const UNIT_TYPES: UnitTypeId[] = ['infantry', 'archer', 'cavalry'];

function outcomeWord(o: 'win' | 'lose' | 'draw'): string {
  return o === 'win' ? t('result.win') : o === 'lose' ? t('result.lose') : t('result.draw');
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
  lines.push(`# ${t('report.title')}`);
  lines.push('');
  lines.push(`- ${t('report.gameVersion')}: ${GAME_VERSION}`);
  lines.push(`- ${t('report.replays')}: ${t('format.games', { n: agg.games })}`);
  lines.push(`- ${t('report.filters')}: ${filters.description}`);
  lines.push(
    `- ${t('report.record')}: ${agg.wins}/${agg.losses}/${agg.draws} (${t('report.winRate', { rate: agg.winRate })})`,
  );
  lines.push(`- ${t('report.averages', { turns: agg.avgTurns, score: agg.avgScore })}`);
  if (agg.starTotal > 0) lines.push(`- ${t('report.stars')}: ${agg.totalStars}/${agg.starTotal}`);
  // 선택 평가 분류별 개수(한 줄, 있을 때만)
  const tagCounts = new Map<string, number>();
  for (const a of list) {
    if (!a.defectTag) continue;
    tagCounts.set(a.defectTag, (tagCounts.get(a.defectTag) ?? 0) + 1);
  }
  if (tagCounts.size > 0) {
    const parts = [...tagCounts.entries()]
      .map(([tag, n]) => `${t(`eval.tag.${tag as 'early-objective' | 'lost-before-acting' | 'unclear-objective' | 'no-retake-chance'}`)} ${n}`)
      .join(' · ');
    lines.push(`- ${t('eval.title')}: ${parts}`);
  }
  lines.push('');

  lines.push(`## ${t('report.unitUsage')}`);
  lines.push('');
  for (const t of UNIT_TYPES) {
    lines.push(`- ${unitName(t)}: ${agg.productionShare[t]}%`);
  }
  lines.push('');

  if (agg.commonLossReasons.length > 0) {
    lines.push(`## ${t('report.lossReasons')}`);
    lines.push('');
    for (const r of agg.commonLossReasons)
      lines.push(`- ${r.reason}: ${t('analysis.count', { n: r.count })}`);
    lines.push('');
  }

  if (agg.byScenario.length > 0) {
    lines.push(`## ${t('report.scenarioRecords')}`);
    lines.push('');
    lines.push(t('report.scenarioHeader'));
    lines.push('| --- | ---: | ---: | ---: | ---: |');
    for (const g of agg.byScenario) {
      lines.push(`| ${g.label} | ${g.games} | ${g.wins} | ${g.avgTurns} | ${g.avgScore} |`);
    }
    lines.push('');
  }

  if (agg.byFaction.length > 0) {
    lines.push(`## ${t('report.factionRecords')}`);
    lines.push('');
    lines.push(t('report.factionHeader'));
    lines.push('| --- | ---: | ---: | ---: |');
    for (const g of agg.byFaction) lines.push(`| ${g.label} | ${g.games} | ${g.wins} | ${g.avgTurns} |`);
    lines.push('');
  }

  const campaignGames = list.filter((a) => a.config.mode === 'campaign');
  if (campaignGames.length > 0) {
    lines.push(`## ${t('report.campaignStars')}`);
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
    lines.push(`## ${t('report.improvements')}`);
    lines.push('');
    for (const c of coaching) lines.push(`- ${c.text}`);
    lines.push('');
  }

  lines.push(`## ${t('report.gameSummary')}`);
  lines.push('');
  lines.push(t('report.gameHeader'));
  lines.push('| --- | --- | --- | ---: | ---: | ---: | --- |');
  for (const a of list) {
    const note = a.outcome === 'lose' ? lossReason(a) : coachSingleGame(a)[0]?.text ?? '';
    lines.push(
      `| ${a.replayId} | ${a.scenarioTitle} | ${outcomeWord(a.outcome)} | ${a.turns} | ${a.score} | ${a.stars}/${a.starTotal} | ${note.replace(/\|/g, '·')} |`,
    );
  }
  lines.push('');
  lines.push(t('report.sourceIds', { ids: list.map((a) => a.replayId).join(', ') }));
  lines.push('');
  return lines.join('\n');
}

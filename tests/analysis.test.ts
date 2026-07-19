// 한 줄 목적: 리플레이 분석 지표·합산·규칙 코칭·보고서 내보내기가 실제 게임 리플레이로 정합함을 검증한다
import { afterEach, describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/core/ai';
import { newGame } from '../src/core/game';
import { buildReplayDocument, type ReplayDocument } from '../src/core/replay';
import { analyzeReplay, type ReplayAnalysis } from '../src/core/analysis/replay-metrics';
import { aggregateAnalyses } from '../src/core/analysis/aggregate';
import { coachAggregate, coachSingleGame } from '../src/core/analysis/coaching';
import { reportCsv, reportJson, reportMarkdown } from '../src/core/analysis/report';
import type { BuiltinScenarioId, FactionId, GameState } from '../src/core/types';
import { setLocale } from '../src/i18n';

afterEach(() => setLocale('ko'));

function playFullGame(state: GameState): void {
  let guard = 0;
  const maxPhases = (state.maxTurns + 2) * 3;
  while (!state.over && guard < maxPhases) {
    guard++;
    runAiTurn(state, state.current);
  }
  if (!state.over) throw new Error('게임이 종료되지 않음');
}

function makeReplay(seed: number, scenario: BuiltinScenarioId, faction: FactionId): ReplayDocument {
  const state = newGame(seed, { scenario, humanFaction: faction, difficulty: 'normal' });
  playFullGame(state);
  const doc = buildReplayDocument(state, {
    replayId: `analysis-${scenario}-${faction}-${seed}`,
    createdAt: new Date(2026, 6, 19, 0, 0, seed % 60).toISOString(),
  });
  expect(doc).not.toBeNull();
  return doc!;
}

describe('단일 리플레이 분석', () => {
  it('실제 리플레이의 지표가 결과와 정합한다', () => {
    const doc = makeReplay(20260719, 'three-crowns', 'azure');
    const r = analyzeReplay(doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.analysis;
    // 결과 일치
    expect(a.turns).toBe(doc.result.turns);
    expect(a.score).toBe(doc.result.score);
    expect(a.stars).toBe(doc.result.stars);
    expect(a.outcome).toBe(doc.result.winner === 'azure' ? 'win' : doc.result.winner === 'draw' ? 'draw' : 'lose');
    // 행동 수는 명령 수 이하이고 음수가 아니다
    expect(a.moves + a.attacks + a.productions).toBeLessThanOrEqual(a.commandCount);
    for (const v of [a.moves, a.attacks, a.productions, a.kills, a.lostUnits, a.damageDealt, a.damageTaken]) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
    // 타임라인은 종료 사건을 포함한다
    expect(a.timeline.some((e) => e.kind === 'end')).toBe(true);
    // 병과별 합계가 전체 처치·손실과 모순되지 않는다
    const classKills = a.byClass.infantry.kills + a.byClass.archer.kills + a.byClass.cavalry.kills;
    expect(classKills).toBeLessThanOrEqual(a.kills);
  });

  it('여러 시나리오·왕국 조합 모두 예외 없이 분석된다', () => {
    const scenarios: BuiltinScenarioId[] = ['three-crowns', 'broken-strait', 'crown-heart'];
    const factions: FactionId[] = ['azure', 'crimson', 'violet'];
    let n = 0;
    for (const s of scenarios) {
      for (const f of factions) {
        const doc = makeReplay(100 + n, s, f);
        const r = analyzeReplay(doc);
        expect(r.ok, `${s}/${f}`).toBe(true);
        n++;
      }
    }
    expect(n).toBe(9);
  });

  it('규칙 기반 코칭이 문자열 배열을 만든다(외부 호출 없음)', () => {
    const doc = makeReplay(555, 'crown-heart', 'violet');
    const r = analyzeReplay(doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const notes = coachSingleGame(r.analysis);
    expect(Array.isArray(notes)).toBe(true);
    for (const note of notes) expect(typeof note.text).toBe('string');
  });
});

describe('다중 리플레이 합산', () => {
  const analyses: ReplayAnalysis[] = [
    makeReplay(1, 'three-crowns', 'azure'),
    makeReplay(2, 'three-crowns', 'crimson'),
    makeReplay(3, 'broken-strait', 'violet'),
    makeReplay(4, 'crown-heart', 'azure'),
  ].flatMap((d) => {
    const r = analyzeReplay(d);
    return r.ok ? [r.analysis] : [];
  });

  it('승률·평균·왕국별 집계가 판 수와 정합한다', () => {
    const agg = aggregateAnalyses(analyses);
    expect(agg.games).toBe(analyses.length);
    expect(agg.wins + agg.losses + agg.draws).toBe(analyses.length);
    const byFactionGames = agg.byFaction.reduce((n, g) => n + g.games, 0);
    expect(byFactionGames).toBe(analyses.length);
    const shareSum = Object.values(agg.productionShare).reduce((a, b) => a + b, 0);
    expect(shareSum === 0 || Math.abs(shareSum - 100) <= 1).toBe(true);
  });

  it('빈 목록도 안전하게 합산된다', () => {
    const agg = aggregateAnalyses([]);
    expect(agg.games).toBe(0);
    expect(agg.winRate).toBe(0);
    expect(coachAggregate(agg)).toEqual([]);
  });

  it('추세 비교는 10판 미만이면 null', () => {
    expect(aggregateAnalyses(analyses).trend).toBeNull();
  });
});

describe('보고서 내보내기', () => {
  const docs = [makeReplay(11, 'three-crowns', 'azure'), makeReplay(12, 'broken-strait', 'crimson')];
  const analyses = docs.map((d) => {
    const r = analyzeReplay(d);
    if (!r.ok) throw new Error('분석 실패');
    return r.analysis;
  });

  it('JSON 보고서는 파싱 가능하고 서버 정보를 포함하지 않는다', () => {
    const json = reportJson(analyses, { description: '전체' });
    const parsed = JSON.parse(json);
    expect(parsed.games.length).toBe(2);
    expect(parsed.gameVersion).toMatch(/^\d+\.\d+\.\d+/);
    // 개인 식별·브라우저 정보 미포함
    expect(json).not.toContain('userAgent');
    expect(json).not.toContain('navigator');
  });

  it('Markdown 보고서는 핵심 섹션과 원본 ID를 포함한다', () => {
    const md = reportMarkdown(analyses, { description: '왕국: 남색' });
    expect(md).toContain('# 세 왕관의 섬 — 플레이테스트 보고서');
    expect(md).toContain('병과 사용');
    expect(md).toContain('원본 리플레이 ID');
    for (const a of analyses) expect(md).toContain(a.replayId);
  });

  it('CSV 요약은 헤더와 판별 1행을 만든다', () => {
    const csv = reportCsv(analyses).split('\n');
    expect(csv[0]).toContain('replayId');
    expect(csv.length).toBe(analyses.length + 1);
  });

  it('영어 보고서·코칭·사건 설명에 한국어가 남지 않는다', () => {
    setLocale('en');
    const doc = makeReplay(77, 'broken-strait', 'crimson');
    const result = analyzeReplay(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const md = reportMarkdown([result.analysis], { description: 'All' });
    const coaching = coachSingleGame(result.analysis).map((note) => note.text).join('\n');
    const timeline = result.analysis.timeline.map((event) => event.text).join('\n');
    expect(md).toContain('# Three Crowns Island — Playtest Report');
    expect(`${md}\n${coaching}\n${timeline}`).not.toMatch(/[가-힣]/);
  });
});

// 한 줄 목적: 시나리오 품질 보고서와 AI 품질 시험이 기준 콘텐츠를 통과시키고 결함 시나리오를 정확히 신고하는지 검증한다
import { describe, expect, it } from 'vitest';
import { CAMPAIGNS } from '../src/core/campaign/missions';
import { runQualityTrial } from '../src/core/eval/quality-trial';
import { hexKey } from '../src/core/hex';
import { normalizeScenario } from '../src/core/scenario/normalize';
import { countBottlenecks, scenarioQualityReport } from '../src/core/scenario/quality';
import { validateScenario, isPlayable } from '../src/core/scenario/validate';
import type { ScenarioDocumentV1, ScenarioTile } from '../src/core/scenario/types';

/** 두 세력 대결 기본 문서(품질 결함 주입용). */
function baseDoc(): ScenarioDocumentV1 {
  const tiles: ScenarioTile[] = [];
  for (let r = 0; r < 7; r++) {
    for (let col = 0; col < 7; col++) {
      const q = col - ((r - (r & 1)) >> 1);
      tiles.push({ q, r, terrain: 'plains' });
    }
  }
  const at = (col: number, r: number) => ({ q: col - ((r - (r & 1)) >> 1), r });
  const setTile = (col: number, r: number, patch: Partial<ScenarioTile>) => {
    const p = at(col, r);
    const t = tiles.find((x) => x.q === p.q && x.r === p.r)!;
    Object.assign(t, patch);
  };
  setTile(0, 3, { building: 'capital', owner: 'azure' });
  setTile(6, 3, { building: 'capital', owner: 'crimson' });
  return {
    schemaVersion: 1,
    id: 'quality-test',
    title: '품질 시험장',
    description: '',
    board: { cols: 7, rows: 7, tiles },
    factions: [
      { id: 'azure', controller: 'human', active: true },
      { id: 'crimson', controller: 'ai', active: true },
      { id: 'violet', controller: 'ai', active: false },
    ],
    units: [
      { faction: 'azure', type: 'infantry', ...at(1, 3) },
      { faction: 'crimson', type: 'infantry', ...at(5, 3) },
    ],
    rules: { maxTurns: 12, turnLimit: 'score' },
    victoryConditions: [{ type: 'conquest' }],
    defeatConditions: [{ type: 'human-eliminated' }],
    starConditions: [{ type: 'win' }],
  };
}

describe('시나리오 품질 보고서', () => {
  it('캠페인 9미션은 구조 검증과 품질 보고서에서 오류가 없다', () => {
    for (const campaign of CAMPAIGNS) {
      for (const mission of campaign.missions) {
        expect(isPlayable(validateScenario(mission.scenario)), mission.id).toBe(true);
        const report = scenarioQualityReport(mission.scenario);
        const errors = report.issues.filter((i) => i.severity === 'error');
        expect(errors, `${mission.id}: ${errors.map((e) => e.code).join(',')}`).toEqual([]);
      }
    }
  });

  it('세력 시작 전력·자원과 지표를 계산한다', () => {
    const report = scenarioQualityReport(baseDoc());
    expect(report.metrics.factionStrengths).toHaveLength(2);
    expect(report.metrics.objectiveDistance).toBeGreaterThan(0);
    expect(report.metrics.estimatedFirstCombatTurn).toBeGreaterThanOrEqual(1);
    expect(report.metrics.waterRatio).toBe(0);
  });

  it('적이 생산할 수 없는데 처치 조건이 적 유닛 수를 넘으면 달성 불가 오류다', () => {
    const doc = baseDoc();
    // 적 수도를 중립으로 바꿔 생산 수단을 없앤다
    const cap = doc.board.tiles.find((t) => t.building === 'capital' && t.owner === 'crimson')!;
    delete cap.owner;
    doc.starConditions = [{ type: 'win' }, { type: 'kills-at-least', count: 5 }];
    const codes = scenarioQualityReport(doc).issues.map((i) => i.code);
    expect(codes).toContain('star-impossible');
  });

  it('제한 턴과 같은 별점 턴 조건은 승리와 동일하다고 경고한다', () => {
    const doc = baseDoc();
    doc.starConditions = [{ type: 'win' }, { type: 'win-within-turns', turns: 12 }];
    const codes = scenarioQualityReport(doc).issues.map((i) => i.code);
    expect(codes).toContain('star-trivial');
  });

  it('물이 지나치게 많으면 경고한다', () => {
    const doc = baseDoc();
    for (const t of doc.board.tiles) {
      if (!t.building && !doc.units.some((u) => u.q === t.q && u.r === t.r)) t.terrain = 'water';
    }
    const codes = scenarioQualityReport(doc).issues.map((i) => i.code);
    expect(codes).toContain('too-much-water');
  });

  it('세력 간 전력 격차가 크면 경고한다', () => {
    const doc = baseDoc();
    doc.factions = doc.factions.map((f) =>
      f.id === 'azure' ? { ...f, startGold: 500 } : { ...f, startGold: 0 },
    );
    doc.units = doc.units.filter((u) => u.faction !== 'crimson');
    // crimson은 수도만 남는다(전력 0)
    const codes = scenarioQualityReport(doc).issues.map((i) => i.code);
    expect(codes).toContain('strength-imbalance');
  });

  it('countBottlenecks는 외길 통로의 단절점을 찾는다', () => {
    // 3타일 일렬: 가운데가 단절점
    const land = new Map<string, ScenarioTile>();
    for (let q = 0; q < 3; q++) land.set(hexKey(q, 0), { q, r: 0, terrain: 'plains' });
    expect(countBottlenecks(land)).toBe(1);
  });
});

describe('AI 품질 시험', () => {
  const snapshot = normalizeScenario(CAMPAIGNS[0].missions[0].scenario);

  it('자동 관전이 종료 불능·불법 상태·거부 명령 없이 끝난다', async () => {
    const report = await runQualityTrial(snapshot, {
      policies: ['balanced', 'aggressive', 'noisy'],
      noisySeeds: 2,
      yieldBetweenGames: false,
    });
    expect(report).not.toBeNull();
    expect(report!.games).toBe(4);
    expect(report!.unfinished).toBe(0);
    expect(report!.invalidStates).toBe(0);
    expect(report!.rejectedCommands).toBe(0);
    expect(report!.stalledFactions).toEqual([]);
    expect(report!.avgEndTurn).toBeGreaterThan(0);
  });

  it('진행 콜백이 게임마다 호출되고 취소 시 null을 반환한다', async () => {
    const progress: number[] = [];
    const done = await runQualityTrial(snapshot, {
      policies: ['balanced'],
      yieldBetweenGames: false,
      onProgress: (d) => progress.push(d),
    });
    expect(done).not.toBeNull();
    expect(progress).toEqual([1]);

    const canceled = await runQualityTrial(snapshot, {
      policies: ['balanced', 'aggressive'],
      yieldBetweenGames: false,
      shouldCancel: () => true,
    });
    expect(canceled).toBeNull();
  });
});

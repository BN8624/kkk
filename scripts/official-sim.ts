// 한 줄 목적: 공식 시나리오 팩 6종을 품질 검사·평가 정책 관전으로 검증해 보고서 아티팩트를 만든다(게이트)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runQualityTrial, type QualityTrialReport } from '../src/core/eval/quality-trial';
import { normalizeScenario } from '../src/core/scenario/normalize';
import { OFFICIAL_SCENARIOS } from '../src/core/scenario/official';
import { scenarioQualityReport } from '../src/core/scenario/quality';
import { isPlayable, validateScenario } from '../src/core/scenario/validate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artifacts');
mkdirSync(outDir, { recursive: true });

interface OfficialReport {
  id: string;
  title: string;
  structureOk: boolean;
  qualityErrors: number;
  qualityWarnings: number;
  trial: QualityTrialReport;
}

const startedAt = Date.now();
const reports: OfficialReport[] = [];

for (const doc of OFFICIAL_SCENARIOS) {
  const structureOk = isPlayable(validateScenario(doc));
  const quality = scenarioQualityReport(doc);
  const trial = await runQualityTrial(normalizeScenario(doc), {
    noisySeeds: 4,
    yieldBetweenGames: false,
  });
  if (!trial) throw new Error(`${doc.id} 시험이 취소되었습니다`);
  reports.push({
    id: doc.id,
    title: doc.title,
    structureOk,
    qualityErrors: quality.issues.filter((i) => i.severity === 'error').length,
    qualityWarnings: quality.issues.filter((i) => i.severity === 'warning').length,
    trial,
  });
}

const pass = reports.every(
  (r) =>
    r.structureOk &&
    r.qualityErrors === 0 &&
    r.trial.unfinished === 0 &&
    r.trial.invalidStates === 0 &&
    r.trial.rejectedCommands === 0 &&
    r.trial.stalledFactions.length === 0 &&
    Object.values(r.trial.policyWins).reduce((a, b) => a + (b ?? 0), 0) >= 1,
);

const elapsedSec = +((Date.now() - startedAt) / 1000).toFixed(1);
const summary = { generatedAt: new Date().toISOString(), elapsedSec, pass, reports };
writeFileSync(join(outDir, 'official-pack-summary.json'), JSON.stringify(summary, null, 2));

const md = [
  '# 공식 시나리오 팩 검증 요약',
  '',
  `- 생성: ${summary.generatedAt} (${elapsedSec}s) · 시나리오 ${reports.length}종`,
  '- 평가 정책 5종(공격·방어·경제·균형·시드 변형 4종) 자동 관전 결과이며 인간 검증이 아니다.',
  '',
  '| 전장 | 구조 | 품질 오류/경고 | 관전 판 | 종료불능 | 불법상태 | 인간 승수 | 평균턴 | 승리 별 0/1/2/3 |',
  '|---|---|---|---|---|---|---|---|---|',
  ...reports.map((r) => {
    const wins = Object.values(r.trial.policyWins).reduce((a, b) => a + (b ?? 0), 0);
    return `| ${r.title} | ${r.structureOk ? 'PASS' : 'FAIL'} | ${r.qualityErrors}/${r.qualityWarnings} | ${r.trial.games} | ${r.trial.unfinished} | ${r.trial.invalidStates} | ${wins} | ${r.trial.avgEndTurn} | ${r.trial.starHistogram.join('/')} |`;
  }),
  '',
  `## 판정: ${pass ? 'PASS' : 'FAIL'}`,
  '',
].join('\n');
writeFileSync(join(outDir, 'official-pack-summary.md'), md);
console.log(md);
if (!pass) process.exit(1);

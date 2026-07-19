// 한 줄 목적: 9개 미션을 평가 정책 5종·난이도 3종·시드 변형으로 시뮬레이션해 고유 궤적·별 분포·패배 원인을 보고하는 품질 매트릭스 게이트
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAiTurn } from '../src/core/ai';
import { CAMPAIGNS } from '../src/core/campaign/missions';
import { EVAL_POLICY_IDS, runEvalPolicyTurn, type EvalPolicyId } from '../src/core/eval/policies';
import { newGameFromScenario } from '../src/core/game';
import { canonicalJson, digestString } from '../src/core/replay';
import { validateState } from '../src/core/save';
import { starsEarned } from '../src/core/scenario/objectives';
import { normalizeScenario } from '../src/core/scenario/normalize';
import type { Difficulty, GameState, UnitTypeId } from '../src/core/types';

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
/** noisy 정책의 시드 변형 수(같은 조합 안에서 실제 다른 궤적을 만든다) */
const NOISY_SEEDS = Number(process.argv.find((a) => a.startsWith('--noisy-seeds='))?.slice(14) ?? 8);
/** 미션별 고유 궤적 최소 기준(정책 4종 + noisy 변형에서 나와야 하는 서로 다른 명령 다이제스트 수) */
const MIN_UNIQUE_TRAJECTORIES = 6;
const SEED_BASE = 20270700;

type DefeatCause = '전멸' | '목표 상실' | '턴 제한' | '적 목표 달성';

interface PolicyCell {
  policy: EvalPolicyId;
  games: number;
  wins: number;
  stars: [number, number, number, number];
}

interface MissionReport {
  missionId: string;
  games: number;
  unfinished: number;
  invalidStates: number;
  uniqueTrajectories: number;
  winRate: number;
  avgEndTurn: number;
  starHistogram: [number, number, number, number];
  defeatCauses: Record<string, number>;
  /** 승리한 게임의 목표 달성 경로 분포 */
  victoryPaths: Record<string, number>;
  /** 인간 대체 정책이 생산한 병과 분포 */
  unitUsage: Record<UnitTypeId, number>;
  /** 인간 페이즈 중 end-phase만 발행한 턴 수(전체 합) */
  idleHumanTurns: number;
  /** 공격 명령 0회 승리(명백한 자동 승리 신호) */
  autoWins: number;
  perPolicy: PolicyCell[];
  /** 승리가 한 번도 없는 정책 */
  winlessPolicies: EvalPolicyId[];
  warnings: string[];
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artifacts');
mkdirSync(outDir, { recursive: true });

const startedAt = Date.now();
const reports: MissionReport[] = [];
let totalGames = 0;

for (const campaign of CAMPAIGNS) {
  for (const mission of campaign.missions) {
    const snapshot = normalizeScenario(mission.scenario);
    const rep: MissionReport = {
      missionId: mission.id,
      games: 0,
      unfinished: 0,
      invalidStates: 0,
      uniqueTrajectories: 0,
      winRate: 0,
      avgEndTurn: 0,
      starHistogram: [0, 0, 0, 0],
      defeatCauses: {},
      victoryPaths: {},
      unitUsage: { infantry: 0, archer: 0, cavalry: 0, guardian: 0, raider: 0, crossbow: 0 },
      idleHumanTurns: 0,
      autoWins: 0,
      perPolicy: EVAL_POLICY_IDS.map((p) => ({ policy: p, games: 0, wins: 0, stars: [0, 0, 0, 0] })),
      winlessPolicies: [],
      warnings: [],
    };
    const digests = new Set<string>();
    let wins = 0;
    let turnSum = 0;
    let finished = 0;

    for (const policy of EVAL_POLICY_IDS) {
      const cell = rep.perPolicy.find((c) => c.policy === policy)!;
      const seedCount = policy === 'noisy' ? NOISY_SEEDS : 1;
      for (const difficulty of DIFFICULTIES) {
        for (let i = 0; i < seedCount; i++) {
          const seed = SEED_BASE + i;
          const state: GameState = newGameFromScenario(seed, snapshot, {
            mode: 'campaign',
            difficulty,
          });
          rep.games++;
          cell.games++;
          totalGames++;
          const human = state.config.humanFaction;
          let humanAttacks = 0;
          let idleTurns = 0;
          let guard = 0;
          const maxPhases = (state.maxTurns + 2) * state.order.length;
          while (!state.over && guard < maxPhases) {
            guard++;
            const f = state.current;
            if (f === human) {
              const { commands } = runEvalPolicyTurn(state, f, policy, seed);
              humanAttacks += commands.filter((c) => c.type === 'attack-unit').length;
              if (commands.every((c) => c.type === 'end-phase')) idleTurns++;
              for (const c of commands) {
                if (c.type === 'produce-unit') rep.unitUsage[c.unitType]++;
              }
            } else {
              runAiTurn(state, f);
            }
          }
          if (!state.over) {
            rep.unfinished++;
            continue;
          }
          if (!validateState(state)) rep.invalidStates++;
          finished++;
          rep.idleHumanTurns += idleTurns;
          turnSum += Math.min(state.turn, state.maxTurns);
          digests.add(digestString(canonicalJson(state.commandLog ?? [])));
          if (state.winner === human) {
            wins++;
            cell.wins++;
            const s = Math.min(3, starsEarned(state).filter(Boolean).length);
            rep.starHistogram[s]++;
            cell.stars[s]++;
            if (humanAttacks === 0) rep.autoWins++;
            const enemiesLeft = state.units.some((u) => u.faction !== human);
            const path = enemiesLeft ? '목표 달성' : '정복(전멸)';
            rep.victoryPaths[path] = (rep.victoryPaths[path] ?? 0) + 1;
          } else {
            let cause: DefeatCause;
            if (state.factions[human].eliminated || !state.units.some((u) => u.faction === human))
              cause = '전멸';
            else if (state.turn >= state.maxTurns) cause = '턴 제한';
            else if (state.winner === 'draw') cause = '턴 제한';
            else cause = '적 목표 달성';
            rep.defeatCauses[cause] = (rep.defeatCauses[cause] ?? 0) + 1;
          }
        }
      }
    }

    rep.uniqueTrajectories = digests.size;
    rep.winRate = finished > 0 ? +(wins / finished).toFixed(3) : 0;
    rep.avgEndTurn = finished > 0 ? +(turnSum / finished).toFixed(1) : 0;
    rep.winlessPolicies = rep.perPolicy.filter((c) => c.wins === 0).map((c) => c.policy);

    // 경고: 별점 분포 고정 신호(게이트 실패는 아니고 별점 조건 검토 대상)
    const winStars = rep.starHistogram.slice(0, 4);
    const winTotal = winStars.reduce((a, b) => a + b, 0);
    if (winTotal > 0) {
      const nonZero = winStars.filter((n) => n > 0).length;
      if (nonZero === 1) {
        const fixed = winStars.findIndex((n) => n > 0);
        rep.warnings.push(`모든 승리가 항상 ${fixed}별 — 별점 조건이 분포를 만들지 못한다`);
      }
      if (rep.perPolicy.every((c) => c.wins === 0 || (c.stars[3] === c.wins))) {
        if (winStars[3] === winTotal) rep.warnings.push('모든 정책이 승리 시 항상 3별');
      }
    }
    if (rep.autoWins > 0) rep.warnings.push(`공격 0회 승리 ${rep.autoWins}건 — 자동 승리 신호`);
    reports.push(rep);
  }
}

// 강제 기준: 종료 불능 0 · 불법 상태 0 · 미션별 고유 궤적 최소 기준 · 보통 계열 정책(balanced) 승리 존재
const pass = reports.every(
  (r) =>
    r.unfinished === 0 &&
    r.invalidStates === 0 &&
    r.uniqueTrajectories >= MIN_UNIQUE_TRAJECTORIES &&
    (r.perPolicy.find((c) => c.policy === 'balanced')?.wins ?? 0) >= 1,
);

const elapsedSec = +((Date.now() - startedAt) / 1000).toFixed(1);
const summary = {
  generatedAt: new Date().toISOString(),
  elapsedSec,
  totalGames,
  noisySeeds: NOISY_SEEDS,
  minUniqueTrajectories: MIN_UNIQUE_TRAJECTORIES,
  pass,
  reports,
};
writeFileSync(join(outDir, 'campaign-matrix-summary.json'), JSON.stringify(summary, null, 2));

const md = [
  '# 캠페인 품질 매트릭스 요약',
  '',
  `- 생성: ${summary.generatedAt} (${elapsedSec}s) · 총 ${totalGames}게임`,
  `- 조합: 미션 9 × 정책 ${EVAL_POLICY_IDS.length}종 × 난이도 ${DIFFICULTIES.length}종 (noisy는 시드 ${NOISY_SEEDS}종 변형)`,
  '- 고유 궤적 = 서로 다른 명령 다이제스트 수. AI 시뮬레이션 결과이며 인간 검증이 아니다.',
  '',
  '| 미션 | 게임 | 고유궤적 | 종료불능 | 불법상태 | 승률 | 평균턴 | 별 0/1/2/3 | 무승 정책 | 주요 패배 원인 |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...reports.map((r) => {
    const cause =
      Object.entries(r.defeatCauses)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}(${v})`)
        .join(' ') || '-';
    return `| ${r.missionId} | ${r.games} | ${r.uniqueTrajectories} | ${r.unfinished} | ${r.invalidStates} | ${(r.winRate * 100).toFixed(0)}% | ${r.avgEndTurn} | ${r.starHistogram.join('/')} | ${r.winlessPolicies.join(',') || '-'} | ${cause} |`;
  }),
  '',
  '## 정책별 승리·별 분포',
  '',
  '| 미션 | ' + EVAL_POLICY_IDS.map((p) => p).join(' | ') + ' |',
  '|---|' + EVAL_POLICY_IDS.map(() => '---').join('|') + '|',
  ...reports.map(
    (r) =>
      `| ${r.missionId} | ` +
      r.perPolicy
        .map((c) => `${c.wins}/${c.games}승 ★${c.stars.join('/')}`)
        .join(' | ') +
      ' |',
  ),
  '',
  '## 경고',
  '',
  ...(reports.some((r) => r.warnings.length > 0)
    ? reports.flatMap((r) => r.warnings.map((w) => `- ${r.missionId}: ${w}`))
    : ['- 없음']),
  '',
  `## 판정: ${pass ? 'PASS' : 'FAIL'}`,
  '',
].join('\n');
writeFileSync(join(outDir, 'campaign-matrix-summary.md'), md);
console.log(md);
if (!pass) process.exit(1);

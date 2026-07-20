// 한 줄 목적: 캠페인 9미션을 난이도 조합·시드로 대량 시뮬레이션해 안정성(강제 PASS)과 승리 가능성·별 분포를 검증한다
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAiTurn } from '../src/core/ai';
import { CAMPAIGNS } from '../src/core/campaign/missions';
import { FACTION_IDS } from '../src/core/data';
import { newGameFromScenario } from '../src/core/game';
import { normalizeScenario } from '../src/core/scenario/normalize';
import { starsEarned } from '../src/core/scenario/objectives';
import { validateState } from '../src/core/save';
import type { Difficulty, FactionId, GameState } from '../src/core/types';

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
const SEEDS = Number(process.argv.find((a) => a.startsWith('--seeds='))?.slice(8) ?? 12);
const SEED_BASE = 20270500;

interface MissionReport {
  missionId: string;
  games: number;
  unfinished: number;
  invalidStates: number;
  immediateEnds: number;
  /** 인간 승리 중 종료 턴이 1인 횟수(첫 라운드 종료 승리) */
  firstRoundWins: number;
  /** 인간 승리 중 종료 턴이 2 미만인 횟수 */
  winsBeforeTurn2: number;
  stalledFactions: string[];
  /** 인간 보통 실력 vs 미션 기본 난이도(normal) 승리 수 */
  normalWins: number;
  winRateAll: number;
  avgEndTurn: number;
  starHistogram: [number, number, number, number];
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
      immediateEnds: 0,
      firstRoundWins: 0,
      winsBeforeTurn2: 0,
      stalledFactions: [],
      normalWins: 0,
      winRateAll: 0,
      avgEndTurn: 0,
      starHistogram: [0, 0, 0, 0],
    };
    let wins = 0;
    let turnSum = 0;
    const stalled = new Set<FactionId>();

    for (const humanSkill of DIFFICULTIES) {
      for (const enemyDifficulty of DIFFICULTIES) {
        for (let i = 0; i < SEEDS; i++) {
          const seed = SEED_BASE + i;
          const state: GameState = newGameFromScenario(seed, snapshot, {
            mode: 'campaign',
            difficulty: enemyDifficulty,
          });
          rep.games++;
          totalGames++;
          if (state.over) {
            rep.immediateEnds++;
            continue;
          }
          const human = state.config.humanFaction;
          const acted: Record<string, number> = {};
          const phases: Record<string, number> = {};
          let guard = 0;
          const maxPhases = (state.maxTurns + 2) * FACTION_IDS.length;
          while (!state.over && guard < maxPhases) {
            guard++;
            const f = state.current;
            const { commands } = runAiTurn(state, f, f === human ? humanSkill : undefined);
            phases[f] = (phases[f] ?? 0) + 1;
            acted[f] = (acted[f] ?? 0) + commands.filter((c) => c.type !== 'end-phase').length;
          }
          if (!state.over) {
            rep.unfinished++;
            continue;
          }
          if (!validateState(state)) rep.invalidStates++;
          // 활성 세력이 3페이즈 이상 받고도 실제 행동이 0이면 목표 인식 정체 신호(짧은 게임 오검출 방지)
          for (const f of FACTION_IDS) {
            if (
              snapshot.factions.find((x) => x.id === f)?.active &&
              !state.factions[f].eliminated &&
              (phases[f] ?? 0) >= 3 &&
              (acted[f] ?? 0) === 0
            ) {
              stalled.add(f);
            }
          }
          const endTurn = Math.min(state.turn, state.maxTurns);
          turnSum += endTurn;
          if (state.winner === human) {
            wins++;
            if (endTurn <= 1) rep.firstRoundWins++;
            if (endTurn < 2) rep.winsBeforeTurn2++;
            if (humanSkill === 'normal' && enemyDifficulty === 'normal') rep.normalWins++;
            const s = Math.min(3, starsEarned(state).filter(Boolean).length);
            rep.starHistogram[s]++;
          }
        }
      }
    }
    const finished = rep.games - rep.unfinished - rep.immediateEnds;
    rep.winRateAll = finished > 0 ? +(wins / finished).toFixed(3) : 0;
    rep.avgEndTurn = finished > 0 ? +(turnSum / finished).toFixed(1) : 0;
    rep.stalledFactions = [...stalled];
    reports.push(rep);
  }
}

// 강제 PASS 조건: 종료 불능·불법 상태·시작 즉시 승패 0, 첫 라운드 승리 0,
// 모든 미션이 보통/보통에서 승리 가능, 행동 정체 없음
const pass =
  totalGames >= 900 &&
  reports.every(
    (r) =>
      r.unfinished === 0 &&
      r.invalidStates === 0 &&
      r.immediateEnds === 0 &&
      r.firstRoundWins === 0 &&
      r.winsBeforeTurn2 === 0 &&
      r.normalWins >= 1 &&
      r.stalledFactions.length === 0,
  );

const elapsedSec = +((Date.now() - startedAt) / 1000).toFixed(1);
const firstRoundWinsByMission = Object.fromEntries(
  reports.map((r) => [r.missionId, r.firstRoundWins]),
);
const summary = {
  generatedAt: new Date().toISOString(),
  elapsedSec,
  totalGames,
  pass,
  firstRoundWinsByMission,
  reports,
};
writeFileSync(join(outDir, 'campaign-sim-summary.json'), JSON.stringify(summary, null, 2));

const md = [
  '# 캠페인 시뮬레이션 요약',
  '',
  `- 생성: ${summary.generatedAt} (${elapsedSec}s) · 총 ${totalGames}게임 (미션당 ${DIFFICULTIES.length * DIFFICULTIES.length}조합 × ${SEEDS}시드)`,
  '- 주의: 고정 지도 + 결정론 AI라 같은 난이도 조합 안에서 시드는 궤적을 바꾸지 않는다.',
  '  이 수치는 안정성·상대 난이도 검증이며 인간 재미의 증거가 아니다.',
  '',
  '| 미션 | 게임 | 종료불능 | 불법상태 | 즉시승패 | 1R승리 | <2턴승 | 정체 | 보통승리 | 전체승률 | 평균턴 | 별 0/1/2/3 |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...reports.map(
    (r) =>
      `| ${r.missionId} | ${r.games} | ${r.unfinished} | ${r.invalidStates} | ${r.immediateEnds} | ${r.firstRoundWins} | ${r.winsBeforeTurn2} | ${r.stalledFactions.join(',') || '-'} | ${r.normalWins} | ${(r.winRateAll * 100).toFixed(0)}% | ${r.avgEndTurn} | ${r.starHistogram.join('/')} |`,
  ),
  '',
  '### 미션별 첫 라운드 승리 횟수',
  ...reports.map((r) => `- ${r.missionId}: firstRoundWins=${r.firstRoundWins}, winsBeforeTurn2=${r.winsBeforeTurn2}`),
  '',
  `## 판정: ${pass ? 'PASS' : 'FAIL'}`,
  '',
].join('\n');
writeFileSync(join(outDir, 'campaign-sim-summary.md'), md);
console.log(md);
if (!pass) process.exit(1);

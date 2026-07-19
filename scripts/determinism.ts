// 한 줄 목적: 대량의 실제 게임을 기록·재생해 결정론(재생 실패 0·다이제스트 불일치 0)을 검증한다
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAiTurn } from '../src/core/ai';
import { CAMPAIGNS } from '../src/core/campaign/missions';
import { FACTION_IDS } from '../src/core/data';
import { newGame, newGameFromScenario } from '../src/core/game';
import { randomDocument } from '../src/editor/new-doc';
import { normalizeScenario } from '../src/core/scenario/normalize';
import {
  buildReplayDocument,
  verifyReplay,
  type ReplayVerification,
} from '../src/core/replay';
import { SCENARIO_IDS } from '../src/core/scenarios';
import type { Difficulty, GameState } from '../src/core/types';

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
const MODIFIER_IDS = ['poor-start', 'rich-villages', 'costly-cavalry', 'sharp-arrows', 'short-war'];
const SEEDS_PER_COMBO = Number(process.argv.find((a) => a.startsWith('--seeds='))?.slice(8) ?? 19);
const SEED_BASE = 20270000;

interface Failure {
  label: string;
  reason: string;
  failedSeq?: number;
  digestBefore?: string;
  actualDigest?: string;
  expectedDigest?: string;
  /** 재현 가능한 리플레이 파일 경로 */
  file?: string;
}

function playFullGame(state: GameState): boolean {
  let guard = 0;
  const maxPhases = (state.maxTurns + 2) * FACTION_IDS.length;
  while (!state.over && guard < maxPhases) {
    guard++;
    const f = state.current;
    runAiTurn(state, f);
    if (!state.over && state.current === f) return false;
  }
  return state.over;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artifacts');
mkdirSync(outDir, { recursive: true });

const startedAt = Date.now();
let games = 0;
let recorded = 0;
let winners = { azure: 0, crimson: 0, violet: 0, draw: 0 };
const failures: Failure[] = [];
const unfinished: string[] = [];

function checkGame(label: string, state: GameState): void {
  games++;
  if (!playFullGame(state)) {
    unfinished.push(label);
    return;
  }
  const w = state.winner ?? 'draw';
  winners[w === 'draw' ? 'draw' : w]++;
  const doc = buildReplayDocument(state, {
    replayId: `det-${label}`,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  if (!doc) {
    failures.push({ label, reason: 'no-replay-document' });
    return;
  }
  recorded++;
  const v: ReplayVerification = verifyReplay(doc);
  if (!v.ok) {
    // 재현 가능한 리플레이 파일 보존
    const file = join(outDir, `determinism-failure-${failures.length}.json`);
    writeFileSync(file, JSON.stringify(doc, null, 1));
    failures.push({
      label,
      reason: v.reason ?? 'unknown',
      failedSeq: v.failedSeq,
      digestBefore: v.digestBefore,
      actualDigest: v.actualDigest,
      expectedDigest: v.expectedDigest,
      file,
    });
  }
}

// 세 시나리오 × 세 왕국 × 세 난이도 × 시드
let combo = 0;
for (const scenario of SCENARIO_IDS) {
  for (const humanFaction of FACTION_IDS) {
    for (const difficulty of DIFFICULTIES) {
      for (let i = 0; i < SEEDS_PER_COMBO; i++) {
        const seed = SEED_BASE + combo * SEEDS_PER_COMBO + i;
        const state = newGame(seed, { scenario, humanFaction, difficulty });
        checkGame(`${scenario}-${humanFaction}-${difficulty}-${seed}`, state);
      }
      combo++;
    }
  }
}

// 일일 도전 수정자 게임(수정자별 시드 4개)
for (const modifier of MODIFIER_IDS) {
  for (let i = 0; i < 4; i++) {
    const seed = SEED_BASE + 90000 + MODIFIER_IDS.indexOf(modifier) * 4 + i;
    const state = newGame(seed, { mode: 'daily', modifier, difficulty: 'normal' });
    checkGame(`daily-${modifier}-${seed}`, state);
  }
}

// 캠페인 9개 미션(난이도 3종 × 시드 2개 — 고정 지도라 시드보다 난이도가 궤적을 바꾼다)
for (const campaign of CAMPAIGNS) {
  for (const mission of campaign.missions) {
    const snapshot = normalizeScenario(mission.scenario);
    for (const difficulty of DIFFICULTIES) {
      for (let i = 0; i < 2; i++) {
        const seed = SEED_BASE + 95000 + i;
        const state = newGameFromScenario(seed, snapshot, { mode: 'campaign', difficulty });
        checkGame(`campaign-${mission.id}-${difficulty}-${seed}`, state);
      }
    }
  }
}

// 커스텀 시나리오(제작실 랜덤 지도 문서 경유, 시드 6개)
for (let i = 0; i < 6; i++) {
  const seed = SEED_BASE + 97000 + i;
  const doc = randomDocument(`custom-det-${i}`, seed);
  const state = newGameFromScenario(seed, normalizeScenario(doc), { mode: 'custom' });
  checkGame(`custom-random-${seed}`, state);
}

const elapsedSec = (Date.now() - startedAt) / 1000;
const pass = failures.length === 0 && unfinished.length === 0 && games >= 500;

const summary = {
  generatedAt: new Date().toISOString(),
  elapsedSec: +elapsedSec.toFixed(1),
  totalGames: games,
  recordedReplays: recorded,
  replayFailures: failures.length,
  digestMismatches: failures.filter((f) => f.reason === 'digest-mismatch').length,
  commandOrderMismatches: failures.filter((f) => f.reason === 'command-failed').length,
  unfinishedGames: unfinished.length,
  winners,
  pass,
  failures: failures.slice(0, 20),
  unfinished: unfinished.slice(0, 20),
};
writeFileSync(join(outDir, 'determinism-summary.json'), JSON.stringify(summary, null, 2));

const md = [
  '# 결정론 검증 요약',
  '',
  `- 생성: ${summary.generatedAt} (${summary.elapsedSec}s)`,
  `- 게임: ${games}개 · 기록된 리플레이: ${recorded}개`,
  `- 리플레이 재생 실패: ${failures.length}`,
  `- 최종 다이제스트 불일치: ${summary.digestMismatches}`,
  `- 명령 순서 불일치: ${summary.commandOrderMismatches}`,
  `- 종료 불능: ${unfinished.length}`,
  '',
  `## 판정: ${pass ? 'PASS' : 'FAIL'}`,
  ...(pass ? [] : ['', ...failures.map((f) => `- ${f.label}: ${f.reason}`), ...unfinished.map((u) => `- 종료 불능: ${u}`)]),
  '',
].join('\n');
writeFileSync(join(outDir, 'determinism-summary.md'), md);
console.log(md);
if (!pass) process.exit(1);

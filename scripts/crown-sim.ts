// 한 줄 목적: crown-heart 집중 시뮬로 평가 정책×난이도 통계를 수집한다(인간 재미 증명이 아닌 자동 대체 정책 통계)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAiTurn } from '../src/core/ai';
import { FACTION_IDS, FACTION_NAMES } from '../src/core/data';
import {
  EVAL_POLICY_IDS,
  EVAL_POLICY_NAMES,
  runEvalPolicyTurn,
  type EvalPolicyId,
} from '../src/core/eval/policies';
import { newGame } from '../src/core/game';
import { generateScenarioMap } from '../src/core/map';
import { canonicalJson, digestString } from '../src/core/replay';
import { analyzeObjectiveArrival } from '../src/core/scenario/arrival';
import { SCENARIOS } from '../src/core/scenarios';
import type { Difficulty, FactionId, GameState } from '../src/core/types';

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
const SEEDS_PER_COMBO = Number(process.argv.find((a) => a.startsWith('--seeds='))?.slice(8) ?? 24);
const SEED_BASE = 20260800;
const SCENARIO = 'crown-heart' as const;

interface GameOutcome {
  humanFaction: FactionId;
  difficulty: Difficulty;
  policy: EvalPolicyId;
  seed: number;
  finished: boolean;
  winner: FactionId | 'draw' | null;
  turns: number;
  endReason: 'conquest' | 'crown-hold' | 'turn-limit' | 'unfinished';
  illegal: string[];
  commandDigest: string;
  firstCrownOwner: FactionId | null;
  firstCrownTurn: number | null;
  crownOwnerChanges: number;
  contestedRounds: number;
  arrivalByFaction: Record<FactionId, number>;
  arrivalMaxGap: number;
  endedBeforeHumanAction: boolean;
  crownWinWithin4: boolean;
  crownCaptureTurn1: boolean;
}

/** 상태 불변식 검사: 위반 사유 문자열을 수집한다. */
function checkIllegal(state: GameState, out: Set<string>): void {
  const seen = new Set<string>();
  for (const u of state.units) {
    const key = `${u.q},${u.r}`;
    if (seen.has(key)) out.add(`duplicate-coord:${key}`);
    seen.add(key);
    if (u.hp <= 0) out.add('nonpositive-hp');
    const tile = state.tiles.find((t) => t.q === u.q && t.r === u.r);
    if (!tile) out.add('unit-off-map');
    else if (tile.terrain === 'water') out.add('unit-on-water');
  }
  for (const fid of FACTION_IDS) {
    const gold = state.factions[fid].gold;
    if (!Number.isFinite(gold)) out.add('nan-gold');
    else if (gold < 0) out.add('negative-gold');
  }
}

function endReasonOf(state: GameState): GameOutcome['endReason'] {
  if (!state.over) return 'unfinished';
  const need = SCENARIOS[SCENARIO].crownHoldTurns ?? Infinity;
  if (state.crownHold && state.crownHold.owner === state.winner && state.crownHold.turns >= need)
    return 'crown-hold';
  if (state.turn > state.maxTurns) return 'turn-limit';
  return 'conquest';
}

function runGame(
  humanFaction: FactionId,
  difficulty: Difficulty,
  policy: EvalPolicyId,
  seed: number,
): GameOutcome {
  const map = generateScenarioMap(SCENARIO, seed);
  const arrival = map.crown
    ? analyzeObjectiveArrival(map, map.crown)
    : {
        earliestByFaction: Object.fromEntries(FACTION_IDS.map((f) => [f, Infinity])) as Record<
          FactionId,
          number
        >,
        maxGap: Infinity,
      };

  const state = newGame(seed, { scenario: SCENARIO, difficulty, humanFaction });
  const illegal = new Set<string>();
  let phases = 0;
  const maxPhases = (state.maxTurns + 2) * FACTION_IDS.length;

  let firstCrownOwner: FactionId | null = null;
  let firstCrownTurn: number | null = null;
  let crownOwnerChanges = 0;
  let contestedRounds = 0;
  let prevHoldOwner: FactionId | null = state.crownHold?.owner ?? null;
  let prevHoldTurns = state.crownHold?.turns ?? 0;
  let humanDidAction = false;
  let crownCaptureTurn1 = false;
  let lastRoundTurn = state.turn;

  while (!state.over && phases < maxPhases) {
    const f = state.current;
    if (f === humanFaction) {
      const { commands } = runEvalPolicyTurn(state, f, policy, seed);
      if (commands.some((c) => c.type === 'move-unit' || c.type === 'attack-unit')) {
        humanDidAction = true;
      }
    } else {
      runAiTurn(state, f, difficulty);
    }
    phases++;

    const hold = state.crownHold;
    if (hold) {
      if (hold.owner && firstCrownOwner === null) {
        firstCrownOwner = hold.owner;
        firstCrownTurn = state.turn;
        if (state.turn <= 1) crownCaptureTurn1 = true;
      }
      if (hold.owner !== prevHoldOwner) {
        if (prevHoldOwner !== null && hold.owner !== null && hold.owner !== prevHoldOwner) {
          crownOwnerChanges++;
        }
        prevHoldOwner = hold.owner;
        prevHoldTurns = hold.turns;
      } else if (
        hold.owner !== null &&
        hold.turns === prevHoldTurns &&
        state.turn > lastRoundTurn
      ) {
        // 라운드가 넘어갔는데 보유 턴이 늘지 않으면 경합으로 간주
        contestedRounds++;
        prevHoldTurns = hold.turns;
      } else if (hold.turns !== prevHoldTurns) {
        prevHoldTurns = hold.turns;
      }
    }

    if (state.turn > lastRoundTurn) lastRoundTurn = state.turn;

    const ct = state.tiles.find((t) => t.building === 'crown');
    if (ct?.owner && state.turn <= 1) crownCaptureTurn1 = true;

    checkIllegal(state, illegal);
    if (state.current === f && !state.over) break;
  }

  const reason = endReasonOf(state);
  const crownWinWithin4 =
    reason === 'crown-hold' &&
    !!state.winner &&
    state.winner !== 'draw' &&
    Math.min(state.turn, state.maxTurns) <= 4;

  return {
    humanFaction,
    difficulty,
    policy,
    seed,
    finished: state.over,
    winner: state.winner ?? null,
    turns: Math.min(state.turn, state.maxTurns),
    endReason: reason,
    illegal: [...illegal],
    commandDigest: digestString(canonicalJson(state.commandLog ?? [])),
    firstCrownOwner,
    firstCrownTurn,
    crownOwnerChanges,
    contestedRounds,
    arrivalByFaction: { ...arrival.earliestByFaction },
    arrivalMaxGap: arrival.maxGap,
    endedBeforeHumanAction: state.over && !humanDidAction,
    crownWinWithin4,
    crownCaptureTurn1,
  };
}

// ---------------- 실행 ----------------

const startedAt = Date.now();
const outcomes: GameOutcome[] = [];
let combo = 0;
for (const humanFaction of FACTION_IDS) {
  for (const difficulty of DIFFICULTIES) {
    for (const policy of EVAL_POLICY_IDS) {
      for (let i = 0; i < SEEDS_PER_COMBO; i++) {
        const seed = SEED_BASE + combo * SEEDS_PER_COMBO + i;
        outcomes.push(runGame(humanFaction, difficulty, policy, seed));
      }
      combo++;
    }
  }
}
const elapsedSec = (Date.now() - startedAt) / 1000;

// ---------------- 집계 ----------------

const total = outcomes.length;
const unfinished = outcomes.filter((o) => !o.finished);
const illegalGames = outcomes.filter((o) => o.illegal.length > 0);
const uniqueTrajectories = new Set(outcomes.map((o) => o.commandDigest)).size;

const winsByFaction = Object.fromEntries(FACTION_IDS.map((f) => [f, 0])) as Record<
  FactionId,
  number
>;
for (const o of outcomes) {
  if (o.winner && o.winner !== 'draw') winsByFaction[o.winner]++;
}

const avgEndTurn = +(outcomes.reduce((s, o) => s + o.turns, 0) / total).toFixed(2);
const endWithin4 = outcomes.filter((o) => o.turns <= 4).length;
const endWithin4Rate = +(endWithin4 / total).toFixed(3);

const firstCrownDist = Object.fromEntries(FACTION_IDS.map((f) => [f, 0])) as Record<
  FactionId,
  number
>;
let firstCrownKnown = 0;
const firstCrownTurns: number[] = [];
for (const o of outcomes) {
  if (o.firstCrownOwner) {
    firstCrownDist[o.firstCrownOwner]++;
    firstCrownKnown++;
    if (o.firstCrownTurn !== null) firstCrownTurns.push(o.firstCrownTurn);
  }
}

const avgFirstCrownTurn = firstCrownTurns.length
  ? +(firstCrownTurns.reduce((a, b) => a + b, 0) / firstCrownTurns.length).toFixed(2)
  : null;
const avgOwnerChanges = +(
  outcomes.reduce((s, o) => s + o.crownOwnerChanges, 0) / total
).toFixed(2);
const avgContested = +(outcomes.reduce((s, o) => s + o.contestedRounds, 0) / total).toFixed(2);

const avgArrivalByFaction = Object.fromEntries(
  FACTION_IDS.map((f) => {
    const vals = outcomes.map((o) => o.arrivalByFaction[f]).filter((n) => Number.isFinite(n));
    return [f, vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null];
  }),
);

const endedBeforeHuman = outcomes.filter((o) => o.endedBeforeHumanAction);
const earlyAutoLoss = outcomes.filter(
  (o) => o.endedBeforeHumanAction && o.winner !== o.humanFaction && o.turns <= 4,
);
const turn1Captures = outcomes.filter((o) => o.crownCaptureTurn1);
const arrivalGapViolations = outcomes.filter((o) => o.arrivalMaxGap > 1);
const earlyCrownWinsByFaction = Object.fromEntries(FACTION_IDS.map((f) => [f, 0])) as Record<
  FactionId,
  number
>;
for (const o of outcomes) {
  if (o.crownWinWithin4 && o.winner && o.winner !== 'draw') {
    earlyCrownWinsByFaction[o.winner]++;
  }
}

// 진홍의 동일 조기 승리 궤적: 같은 최초점령·같은 종료턴(4 이하) 반복
const crimsonEarlyKeyCounts = new Map<string, number>();
for (const o of outcomes) {
  if (
    o.winner === 'crimson' &&
    o.turns <= 4 &&
    o.endReason === 'crown-hold' &&
    o.firstCrownOwner === 'crimson'
  ) {
    const key = `crimson|t${o.turns}|first=${o.firstCrownOwner}`;
    crimsonEarlyKeyCounts.set(key, (crimsonEarlyKeyCounts.get(key) ?? 0) + 1);
  }
}
const crimsonEarlyRepeats = [...crimsonEarlyKeyCounts.values()].filter((c) => c > 1).length;
const crimsonEarlyRepeatTotal = [...crimsonEarlyKeyCounts.entries()]
  .filter(([, c]) => c > 1)
  .reduce((s, [, c]) => s + c, 0);

// ---------------- 강제 판정 ----------------

const failures: string[] = [];
if (unfinished.length > 0) failures.push(`종료 불능 ${unfinished.length}개`);
if (illegalGames.length > 0) failures.push(`불법 상태 ${illegalGames.length}개`);
if (earlyAutoLoss.length > 0)
  failures.push(`인간 개입 전 4턴 이하 자동 패배 ${earlyAutoLoss.length}개`);
if (turn1Captures.length > 0) failures.push(`1턴 왕관 점령 ${turn1Captures.length}개`);
if (arrivalGapViolations.length > 0)
  failures.push(`도착 턴 격차>1 지도 ${arrivalGapViolations.length}개`);
for (const f of FACTION_IDS) {
  if (earlyCrownWinsByFaction[f] > 0)
    failures.push(`${FACTION_NAMES[f]} 4턴 이하 왕관 승리 ${earlyCrownWinsByFaction[f]}개`);
}
if (crimsonEarlyRepeatTotal > 0)
  failures.push(
    `진홍 동일 조기 승리 궤적 반복 ${crimsonEarlyRepeatTotal}회 (키 ${crimsonEarlyRepeats}종)`,
  );

const summary = {
  generatedAt: new Date().toISOString(),
  elapsedSec: +elapsedSec.toFixed(1),
  scenario: SCENARIO,
  seedsPerCombo: SEEDS_PER_COMBO,
  totalGames: total,
  uniqueTrajectories,
  overallWinRates: Object.fromEntries(
    FACTION_IDS.map((f) => [f, +(winsByFaction[f] / total).toFixed(3)]),
  ),
  avgEndTurn,
  endWithin4Rate,
  firstCrownOwnerDist: Object.fromEntries(
    FACTION_IDS.map((f) => [
      f,
      firstCrownKnown ? +(firstCrownDist[f] / firstCrownKnown).toFixed(3) : 0,
    ]),
  ),
  avgFirstCrownTurn,
  avgCrownOwnerChanges: avgOwnerChanges,
  avgContestedRounds: avgContested,
  avgArrivalByFaction,
  endedBeforeHumanAction: endedBeforeHuman.length,
  unfinishedGames: unfinished.length,
  illegalGames: illegalGames.length,
  earlyAutoLossBeforeHuman: earlyAutoLoss.length,
  turn1CrownCaptures: turn1Captures.length,
  arrivalGapViolations: arrivalGapViolations.length,
  earlyCrownWinsByFaction,
  crimsonEarlyRepeatTotal,
  pass: failures.length === 0,
  failures,
  note: '이 수치는 인간 재미의 증명이 아니라 자동 대체 정책 통계이다.',
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artifacts');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'crown-heart-balance-summary.json'), JSON.stringify(summary, null, 2));

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const md = [
  '# crown-heart 집중 시뮬레이션 요약',
  '',
  `- 생성: ${summary.generatedAt} (${summary.elapsedSec}s)`,
  `- 조합: 인간세력 3 × 난이도 3 × 평가정책 ${EVAL_POLICY_IDS.length} × 시드 ${SEEDS_PER_COMBO} = 게임 ${total}개`,
  `- 고유 궤적(명령 다이제스트): ${uniqueTrajectories}`,
  '',
  '## 세력별 승률',
  '',
  '| 세력 | 승률 |',
  '| --- | --- |',
  ...FACTION_IDS.map((f) => `| ${FACTION_NAMES[f]} | ${pct(winsByFaction[f] / total)} |`),
  '',
  `## 평균 종료 턴: ${avgEndTurn}`,
  `## 4턴 이하 종료율: ${pct(endWithin4Rate)}`,
  '',
  '## 최초 왕관 점령',
  '',
  '| 세력 | 분포 |',
  '| --- | --- |',
  ...FACTION_IDS.map((f) => {
    const rate = firstCrownKnown ? firstCrownDist[f] / firstCrownKnown : 0;
    return `| ${FACTION_NAMES[f]} | ${pct(rate)} |`;
  }),
  `- 평균 최초 점령 턴: ${avgFirstCrownTurn ?? 'n/a'}`,
  `- 평균 탈환(소유 변경) 횟수: ${avgOwnerChanges}`,
  `- 평균 경합 라운드 수: ${avgContested}`,
  '',
  '## 세력별 최초 도착 턴(초기 지도 분석 평균)',
  '',
  ...FACTION_IDS.map((f) => `- ${FACTION_NAMES[f]}: ${avgArrivalByFaction[f] ?? '∞'}`),
  '',
  '## 안정성',
  '',
  `- 인간 개입 전 종료: ${endedBeforeHuman.length}`,
  `- 종료 불능: ${unfinished.length}`,
  `- 불법 상태: ${illegalGames.length}`,
  `- 1턴 왕관 점령: ${turn1Captures.length}`,
  `- 도착 격차>1: ${arrivalGapViolations.length}`,
  '',
  `## 판정: ${failures.length === 0 ? 'PASS' : 'FAIL'}`,
  ...(failures.length ? ['', ...failures.map((f) => `- ${f}`)] : []),
  '',
  '---',
  '',
  '**이 수치는 인간 재미의 증명이 아니라 자동 대체 정책 통계이다.**',
  '',
  '정책 목록: ' + EVAL_POLICY_IDS.map((p) => EVAL_POLICY_NAMES[p]).join(', '),
  '',
].join('\n');
writeFileSync(join(outDir, 'crown-heart-balance-summary.md'), md);

console.log(md);
if (failures.length > 0) process.exit(1);

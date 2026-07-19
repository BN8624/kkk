// 한 줄 목적: 헤드리스 대규모 밸런스 시뮬레이션을 실행해 승률·안정성 허용 기준을 검증한다
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAiTurn } from '../src/core/ai';
import { FACTION_IDS, FACTION_NAMES, UNIT_NAMES } from '../src/core/data';
import { newGame } from '../src/core/game';
import { SCENARIO_IDS, SCENARIOS } from '../src/core/scenarios';
import type {
  Difficulty,
  FactionId,
  GameState,
  BuiltinScenarioId,
  UnitTypeId,
} from '../src/core/types';

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
const UNIT_TYPES: UnitTypeId[] = ['infantry', 'archer', 'cavalry'];
const SEEDS_PER_COMBO = Number(process.argv.find((a) => a.startsWith('--seeds='))?.slice(8) ?? 40);
const SEED_BASE = 20260000;

interface GameOutcome {
  scenario: BuiltinScenarioId;
  humanFaction: FactionId;
  difficulty: Difficulty;
  seed: number;
  finished: boolean;
  winner: FactionId | 'draw' | null;
  turns: number;
  endReason: 'conquest' | 'crown-hold' | 'turn-limit' | 'unfinished';
  illegal: string[];
  produced: Record<UnitTypeId, number>;
  spawned: Record<UnitTypeId, number>;
  alive: Record<UnitTypeId, number>;
  captured: number;
  idlePhases: number;
  eligiblePhases: number;
  maxPhaseMs: number;
}

function zeroByType(): Record<UnitTypeId, number> {
  return { infantry: 0, archer: 0, cavalry: 0 };
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

function runGame(
  scenario: BuiltinScenarioId,
  humanFaction: FactionId,
  difficulty: Difficulty,
  seed: number,
): GameOutcome {
  const state = newGame(seed, { scenario, difficulty, humanFaction });
  const spawned = zeroByType();
  const produced = zeroByType();
  for (const u of state.units) spawned[u.type]++;
  const illegal = new Set<string>();
  let idlePhases = 0;
  let eligiblePhases = 0;
  let maxPhaseMs = 0;
  let phases = 0;
  const maxPhases = (state.maxTurns + 2) * FACTION_IDS.length;

  while (!state.over && phases < maxPhases) {
    const f = state.current;
    const t0 = performance.now();
    // 인간 대체 AI: 선택 왕국은 항상 '보통' 실력으로 고정하고, 나머지는 설정 난이도를 따른다
    // (runAiTurn이 END_PHASE 명령까지 발행해 페이즈를 넘긴다)
    const { commands } = runAiTurn(state, f, f === humanFaction ? 'normal' : undefined);
    maxPhaseMs = Math.max(maxPhaseMs, performance.now() - t0);
    phases++;
    const unitCommands = commands.filter((c) => c.type !== 'end-phase');
    if (!state.factions[f].eliminated && state.units.some((u) => u.faction === f)) {
      eligiblePhases++;
      if (unitCommands.length === 0) idlePhases++;
    }
    for (const c of commands) {
      if (c.type === 'produce-unit') {
        produced[c.unitType]++;
        spawned[c.unitType]++;
      }
    }
    checkIllegal(state, illegal);
    // AI가 페이즈를 넘기지 못하면(방어적 가드) 무한 루프를 피하기 위해 종료한다
    if (state.current === f && !state.over) break;
  }

  const alive = zeroByType();
  for (const u of state.units) alive[u.type]++;
  const captured = FACTION_IDS.reduce((s, fid) => s + state.stats[fid].captured, 0);
  const need = SCENARIOS[scenario].crownHoldTurns ?? Infinity;
  const endReason: GameOutcome['endReason'] = !state.over
    ? 'unfinished'
    : state.crownHold && state.crownHold.owner === state.winner && state.crownHold.turns >= need
      ? 'crown-hold'
      : state.turn > state.maxTurns
        ? 'turn-limit'
        : 'conquest';
  return {
    scenario,
    humanFaction,
    difficulty,
    seed,
    finished: state.over,
    winner: state.winner ?? null,
    turns: Math.min(state.turn, state.maxTurns),
    endReason,
    illegal: [...illegal],
    produced,
    spawned,
    alive,
    captured,
    idlePhases,
    eligiblePhases,
    maxPhaseMs,
  };
}

// ---------------- 실행 ----------------

const startedAt = Date.now();
const outcomes: GameOutcome[] = [];
for (const scenario of SCENARIO_IDS) {
  let combo = 0;
  for (const humanFaction of FACTION_IDS) {
    for (const difficulty of DIFFICULTIES) {
      for (let i = 0; i < SEEDS_PER_COMBO; i++) {
        // 시나리오 안에서 조합마다 서로 다른 시드를 사용해 시나리오별 시드 수를 확보한다
        const seed = SEED_BASE + combo * SEEDS_PER_COMBO + i;
        outcomes.push(runGame(scenario, humanFaction, difficulty, seed));
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
const draws = outcomes.filter((o) => o.winner === 'draw').length;

const winsByFaction = Object.fromEntries(FACTION_IDS.map((f) => [f, 0])) as Record<
  FactionId,
  number
>;
for (const o of outcomes) {
  if (o.winner && o.winner !== 'draw') winsByFaction[o.winner]++;
}

const perScenario = SCENARIO_IDS.map((sid) => {
  const games = outcomes.filter((o) => o.scenario === sid);
  const wins = Object.fromEntries(FACTION_IDS.map((f) => [f, 0])) as Record<FactionId, number>;
  for (const o of games) if (o.winner && o.winner !== 'draw') wins[o.winner]++;
  const reasons = { conquest: 0, 'crown-hold': 0, 'turn-limit': 0, unfinished: 0 };
  for (const o of games) reasons[o.endReason]++;
  return {
    scenario: sid,
    games: games.length,
    seeds: new Set(games.map((o) => o.seed)).size,
    winRates: Object.fromEntries(
      FACTION_IDS.map((f) => [f, +(wins[f] / games.length).toFixed(3)]),
    ),
    avgEndTurn: +(games.reduce((s, o) => s + o.turns, 0) / games.length).toFixed(2),
    endReasons: reasons,
  };
});

// 난이도 검증: 대체 인간(보통 고정)의 승률이 상대 AI 난이도가 오를수록 낮아져야 한다
const proxyRateByDifficulty = Object.fromEntries(
  DIFFICULTIES.map((d) => {
    const games = outcomes.filter((o) => o.difficulty === d);
    const wins = games.filter((o) => o.winner === o.humanFaction).length;
    return [d, +(wins / games.length).toFixed(3)];
  }),
) as Record<Difficulty, number>;

// 난이도별 진단: 종료 사유와 턴 제한 승부에서의 대체 인간 승률
const perDifficulty = DIFFICULTIES.map((d) => {
  const games = outcomes.filter((o) => o.difficulty === d);
  const reasons = { conquest: 0, 'crown-hold': 0, 'turn-limit': 0, unfinished: 0 };
  for (const o of games) reasons[o.endReason]++;
  const tl = games.filter((o) => o.endReason === 'turn-limit');
  const tlProxyWins = tl.filter((o) => o.winner === o.humanFaction).length;
  const cq = games.filter((o) => o.endReason !== 'turn-limit');
  const cqProxyWins = cq.filter((o) => o.winner === o.humanFaction).length;
  return {
    difficulty: d,
    games: games.length,
    endReasons: reasons,
    proxyWinRateTurnLimit: tl.length ? +(tlProxyWins / tl.length).toFixed(3) : null,
    proxyWinRateDecisive: cq.length ? +(cqProxyWins / cq.length).toFixed(3) : null,
    avgEndTurn: +(games.reduce((s, o) => s + o.turns, 0) / games.length).toFixed(2),
  };
});

const proxyRateByFaction = Object.fromEntries(
  FACTION_IDS.map((f) => {
    const games = outcomes.filter((o) => o.humanFaction === f);
    const wins = games.filter((o) => o.winner === f).length;
    return [f, +(wins / games.length).toFixed(3)];
  }),
) as Record<FactionId, number>;

const producedTotals = zeroByType();
const spawnedTotals = zeroByType();
const aliveTotals = zeroByType();
for (const o of outcomes) {
  for (const t of UNIT_TYPES) {
    producedTotals[t] += o.produced[t];
    spawnedTotals[t] += o.spawned[t];
    aliveTotals[t] += o.alive[t];
  }
}
const producedSum = UNIT_TYPES.reduce((s, t) => s + producedTotals[t], 0);
const productionShare = Object.fromEntries(
  UNIT_TYPES.map((t) => [t, +(producedTotals[t] / producedSum).toFixed(3)]),
) as Record<UnitTypeId, number>;
const survivalRate = Object.fromEntries(
  UNIT_TYPES.map((t) => [t, +(aliveTotals[t] / spawnedTotals[t]).toFixed(3)]),
) as Record<UnitTypeId, number>;

const idleSum = outcomes.reduce((s, o) => s + o.idlePhases, 0);
const eligibleSum = outcomes.reduce((s, o) => s + o.eligiblePhases, 0);
const avgCaptured = +(outcomes.reduce((s, o) => s + o.captured, 0) / total).toFixed(2);
const maxPhaseMs = +Math.max(...outcomes.map((o) => o.maxPhaseMs)).toFixed(1);

// ---------------- 허용 기준 ----------------

const failures: string[] = [];
if (unfinished.length > 0) failures.push(`종료되지 않은 게임 ${unfinished.length}개`);
if (illegalGames.length > 0)
  failures.push(
    `불법 상태 ${illegalGames.length}개: ${[...new Set(illegalGames.flatMap((o) => o.illegal))].join(', ')}`,
  );
for (const f of FACTION_IDS) {
  const rate = winsByFaction[f] / total;
  if (rate > 0.65) failures.push(`${FACTION_NAMES[f]} 전체 승률 ${(rate * 100).toFixed(1)}% > 65%`);
  if (rate < 0.2) failures.push(`${FACTION_NAMES[f]} 전체 승률 ${(rate * 100).toFixed(1)}% < 20%`);
}
for (const t of UNIT_TYPES) {
  if (productionShare[t] > 0.7)
    failures.push(`${UNIT_NAMES[t]} 생산 비중 ${(productionShare[t] * 100).toFixed(1)}% > 70%`);
}
const MARGIN = 0.04;
if (proxyRateByDifficulty.easy < proxyRateByDifficulty.normal + MARGIN)
  failures.push(
    `보통 AI가 쉬움보다 명확히 강하지 않음 (대체 인간 승률 easy ${proxyRateByDifficulty.easy} vs normal ${proxyRateByDifficulty.normal})`,
  );
if (proxyRateByDifficulty.normal < proxyRateByDifficulty.hard + MARGIN)
  failures.push(
    `어려움 AI가 보통보다 명확히 강하지 않음 (대체 인간 승률 normal ${proxyRateByDifficulty.normal} vs hard ${proxyRateByDifficulty.hard})`,
  );

// ---------------- 출력 ----------------

const summary = {
  generatedAt: new Date().toISOString(),
  elapsedSec: +elapsedSec.toFixed(1),
  totalGames: total,
  seedsPerCombo: SEEDS_PER_COMBO,
  unfinishedGames: unfinished.length,
  illegalGames: illegalGames.length,
  draws,
  overallWinRates: Object.fromEntries(
    FACTION_IDS.map((f) => [f, +(winsByFaction[f] / total).toFixed(3)]),
  ),
  proxyWinRateByFaction: proxyRateByFaction,
  proxyWinRateByDifficulty: proxyRateByDifficulty,
  perDifficulty,
  perScenario,
  productionShare,
  survivalRate,
  idlePhaseRate: +(idleSum / eligibleSum).toFixed(3),
  avgCapturesPerGame: avgCaptured,
  maxPhaseMs,
  pass: failures.length === 0,
  failures,
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artifacts');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'balance-summary.json'), JSON.stringify(summary, null, 2));

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const md = [
  '# 밸런스 시뮬레이션 요약',
  '',
  `- 생성: ${summary.generatedAt} (${summary.elapsedSec}s, 게임 ${total}개, 조합당 시드 ${SEEDS_PER_COMBO})`,
  `- 종료 불능 게임: ${unfinished.length} · 불법 상태: ${illegalGames.length} · 무승부: ${draws}`,
  `- AI 무행동 페이즈 비율: ${pct(summary.idlePhaseRate)} · 게임당 평균 점령: ${avgCaptured} · 최장 페이즈: ${maxPhaseMs}ms`,
  '',
  '## 전체 왕국 승률',
  '',
  '| 왕국 | 전체 승률 | 대체 인간 승률 |',
  '| --- | --- | --- |',
  ...FACTION_IDS.map(
    (f) =>
      `| ${FACTION_NAMES[f]} | ${pct(winsByFaction[f] / total)} | ${pct(proxyRateByFaction[f])} |`,
  ),
  '',
  '## 난이도별 대체 인간(보통 고정) 승률',
  '',
  '| 상대 난이도 | 승률 |',
  '| --- | --- |',
  ...DIFFICULTIES.map((d) => `| ${d} | ${pct(proxyRateByDifficulty[d])} |`),
  '',
  '## 시나리오별',
  '',
  '| 시나리오 | 게임 | 시드 | 청람 | 진홍 | 자원 | 평균 종료 턴 | 정복 | 왕관 | 턴 제한 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...perScenario.map(
    (s) =>
      `| ${SCENARIOS[s.scenario].name} | ${s.games} | ${s.seeds} | ${pct(s.winRates.azure)} | ${pct(s.winRates.crimson)} | ${pct(s.winRates.violet)} | ${s.avgEndTurn} | ${s.endReasons.conquest} | ${s.endReasons['crown-hold']} | ${s.endReasons['turn-limit']} |`,
  ),
  '',
  '## 병과',
  '',
  '| 병과 | 생산 비중 | 생존율 |',
  '| --- | --- | --- |',
  ...UNIT_TYPES.map((t) => `| ${UNIT_NAMES[t]} | ${pct(productionShare[t])} | ${pct(survivalRate[t])} |`),
  '',
  `## 판정: ${failures.length === 0 ? 'PASS' : 'FAIL'}`,
  ...(failures.length ? ['', ...failures.map((f) => `- ${f}`)] : []),
  '',
].join('\n');
writeFileSync(join(outDir, 'balance-summary.md'), md);

console.log(md);
if (failures.length > 0) process.exit(1);

// 한 줄 목적: 헤드리스 대규모 밸런스 시뮬레이션을 실행해 승률·종료·6병종 편중 게이트를 검증한다
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAiTurn } from '../src/core/ai';
import { FACTION_IDS, FACTION_NAMES, UNIT_NAMES } from '../src/core/data';
import {
  BALANCE_UNIT_TYPES,
  CONQUEST_SCENARIOS,
  evaluateBalanceGates,
  isUniqueUnitType,
  type ScenarioOutcomeSummary,
  type UnitProductionStats,
  uniqueUnitFaction,
} from '../src/core/eval/balance-gates';
import { newGame } from '../src/core/game';
import { SCENARIO_IDS, SCENARIOS } from '../src/core/scenarios';
import type {
  Difficulty,
  FactionId,
  GameState,
  BuiltinScenarioId,
  UnitTypeId,
} from '../src/core/types';
import { UNIT_TYPE_IDS } from '../src/core/units';

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
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
  /** 세력별 병종 생산 */
  producedByFaction: Record<FactionId, Record<UnitTypeId, number>>;
  /** 해당 게임에서 한 번 이상 생산된 병종 */
  typesProduced: Set<UnitTypeId>;
  captured: number;
  idlePhases: number;
  eligiblePhases: number;
  maxPhaseMs: number;
}

function zeroByType(): Record<UnitTypeId, number> {
  const o = {} as Record<UnitTypeId, number>;
  for (const t of UNIT_TYPE_IDS) o[t] = 0;
  return o;
}

function zeroByFactionType(): Record<FactionId, Record<UnitTypeId, number>> {
  return {
    azure: zeroByType(),
    crimson: zeroByType(),
    violet: zeroByType(),
  };
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
  const producedByFaction = zeroByFactionType();
  const typesProduced = new Set<UnitTypeId>();
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
        producedByFaction[f][c.unitType]++;
        typesProduced.add(c.unitType);
      }
    }
    checkIllegal(state, illegal);
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
    producedByFaction,
    typesProduced,
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

const overallWinRates = Object.fromEntries(
  FACTION_IDS.map((f) => [f, +(winsByFaction[f] / total).toFixed(4)]),
) as Record<FactionId, number>;

const perScenario: ScenarioOutcomeSummary[] = SCENARIO_IDS.map((sid) => {
  const games = outcomes.filter((o) => o.scenario === sid);
  const wins = Object.fromEntries(FACTION_IDS.map((f) => [f, 0])) as Record<FactionId, number>;
  for (const o of games) if (o.winner && o.winner !== 'draw') wins[o.winner]++;
  const reasons = { conquest: 0, 'crown-hold': 0, 'turn-limit': 0, unfinished: 0 };
  for (const o of games) reasons[o.endReason]++;
  const n = games.length || 1;
  return {
    scenario: sid,
    games: games.length,
    winRates: Object.fromEntries(
      FACTION_IDS.map((f) => [f, +(wins[f] / n).toFixed(4)]),
    ) as Record<FactionId, number>,
    endReasons: reasons,
    turnLimitRate: +(reasons['turn-limit'] / n).toFixed(4),
  };
});

// 시나리오 부가 진단(평균 턴·시드)
const perScenarioDetail = SCENARIO_IDS.map((sid) => {
  const games = outcomes.filter((o) => o.scenario === sid);
  const base = perScenario.find((s) => s.scenario === sid)!;
  return {
    ...base,
    seeds: new Set(games.map((o) => o.seed)).size,
    avgEndTurn: +(games.reduce((s, o) => s + o.turns, 0) / (games.length || 1)).toFixed(2),
  };
});

const proxyRateByDifficulty = Object.fromEntries(
  DIFFICULTIES.map((d) => {
    const games = outcomes.filter((o) => o.difficulty === d);
    const wins = games.filter((o) => o.winner === o.humanFaction).length;
    return [d, +(wins / games.length).toFixed(3)];
  }),
) as Record<Difficulty, number>;

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

// 6병종 통계 — UNIT_TYPE_IDS 정본
const unitStats = {} as Record<UnitTypeId, UnitProductionStats>;
for (const t of UNIT_TYPE_IDS) {
  const produced = outcomes.reduce((s, o) => s + o.produced[t], 0);
  const spawned = outcomes.reduce((s, o) => s + o.spawned[t], 0);
  const alive = outcomes.reduce((s, o) => s + o.alive[t], 0);
  const byFaction = Object.fromEntries(FACTION_IDS.map((f) => [f, 0])) as Record<FactionId, number>;
  const byScenario: Partial<Record<BuiltinScenarioId, number>> = {};
  for (const o of outcomes) {
    for (const f of FACTION_IDS) byFaction[f] += o.producedByFaction[f][t];
    byScenario[o.scenario] = (byScenario[o.scenario] ?? 0) + o.produced[t];
  }
  // 고유 병종 분모: 해당 세력이 참여한 게임만(내장 시뮬은 항상 3세력)
  void uniqueUnitFaction(t);
  const eligibleGames = isUniqueUnitType(t)
    ? outcomes.filter((o) => !o.illegal.length).length // 모든 게임이 uniqueUnits 내장
    : outcomes.length;
  const gamesProduced = outcomes.filter((o) => o.typesProduced.has(t)).length;
  unitStats[t] = {
    produced,
    spawned,
    alive,
    share: 0, // 아래에서 채움
    survivalRate: spawned > 0 ? +(alive / spawned).toFixed(4) : 0,
    gamesProduced,
    eligibleGames,
    produceRate: eligibleGames > 0 ? +(gamesProduced / eligibleGames).toFixed(4) : 0,
    byFaction,
    byScenario,
  };
}
const producedSum = UNIT_TYPE_IDS.reduce((s, t) => s + unitStats[t].produced, 0);
for (const t of UNIT_TYPE_IDS) {
  unitStats[t].share = producedSum > 0 ? +(unitStats[t].produced / producedSum).toFixed(4) : 0;
}

const sharedProducedTotal = UNIT_TYPE_IDS.filter((t) => !isUniqueUnitType(t)).reduce(
  (s, t) => s + unitStats[t].produced,
  0,
);

// 세력별 병종 구성(생산 합)
const rosterByFaction = Object.fromEntries(
  FACTION_IDS.map((f) => [
    f,
    Object.fromEntries(UNIT_TYPE_IDS.map((t) => [t, unitStats[t].byFaction[f]])),
  ]),
) as Record<FactionId, Record<UnitTypeId, number>>;

const idleSum = outcomes.reduce((s, o) => s + o.idlePhases, 0);
const eligibleSum = outcomes.reduce((s, o) => s + o.eligiblePhases, 0);
const avgCaptured = +(outcomes.reduce((s, o) => s + o.captured, 0) / total).toFixed(2);
const maxPhaseMs = +Math.max(...outcomes.map((o) => o.maxPhaseMs)).toFixed(1);

// ---------------- 허용 기준 ----------------

const structuralFailures: string[] = [];
if (unfinished.length > 0) structuralFailures.push(`종료되지 않은 게임 ${unfinished.length}개`);
if (illegalGames.length > 0) {
  structuralFailures.push(
    `불법 상태 ${illegalGames.length}개: ${[...new Set(illegalGames.flatMap((o) => o.illegal))].join(', ')}`,
  );
}
const MARGIN = 0.04;
if (proxyRateByDifficulty.easy < proxyRateByDifficulty.normal + MARGIN) {
  structuralFailures.push(
    `보통 AI가 쉬움보다 명확히 강하지 않음 (대체 인간 승률 easy ${proxyRateByDifficulty.easy} vs normal ${proxyRateByDifficulty.normal})`,
  );
}
if (proxyRateByDifficulty.normal < proxyRateByDifficulty.hard + MARGIN) {
  structuralFailures.push(
    `어려움 AI가 보통보다 명확히 강하지 않음 (대체 인간 승률 normal ${proxyRateByDifficulty.normal} vs hard ${proxyRateByDifficulty.hard})`,
  );
}

const gateResult = evaluateBalanceGates({
  totalGames: total,
  overallWinRates: overallWinRates as { azure: number; crimson: number; violet: number },
  perScenario,
  unitStats,
  sharedProducedTotal,
});

const failures = [
  ...structuralFailures,
  ...gateResult.failures.map((f) => f.message),
];

// ---------------- 출력 ----------------

const summary = {
  generatedAt: new Date().toISOString(),
  elapsedSec: +elapsedSec.toFixed(1),
  totalGames: total,
  seedsPerCombo: SEEDS_PER_COMBO,
  unfinishedGames: unfinished.length,
  illegalGames: illegalGames.length,
  draws,
  overallWinRates,
  proxyWinRateByFaction: proxyRateByFaction,
  proxyWinRateByDifficulty: proxyRateByDifficulty,
  perDifficulty,
  perScenario: perScenarioDetail,
  unitStats,
  productionShare: Object.fromEntries(UNIT_TYPE_IDS.map((t) => [t, unitStats[t].share])),
  survivalRate: Object.fromEntries(UNIT_TYPE_IDS.map((t) => [t, unitStats[t].survivalRate])),
  uniqueProduceRates: Object.fromEntries(
    UNIT_TYPE_IDS.filter(isUniqueUnitType).map((t) => [t, unitStats[t].produceRate]),
  ),
  rosterByFaction,
  sharedProducedTotal,
  cavalrySharedShare:
    sharedProducedTotal > 0 ? +(unitStats.cavalry.produced / sharedProducedTotal).toFixed(4) : 0,
  idlePhaseRate: +(idleSum / (eligibleSum || 1)).toFixed(3),
  avgCapturesPerGame: avgCaptured,
  maxPhaseMs,
  pass: failures.length === 0,
  failures,
  gateFailures: gateResult.failures,
  conquestScenarios: CONQUEST_SCENARIOS,
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
  '> 자동 시뮬레이션은 종료 가능성, 불법 상태, 극단적 편중과 난이도 순서를 검증한다.',
  '> 인간 플레이의 재미·가독성·조작감은 별도 실기 검증 대상이며 이 산출물로 증명되지 않는다.',
  '',
  '## 전체 왕국 승률',
  '',
  '| 왕국 | 전체 승률 | 대체 인간 승률 |',
  '| --- | --- | --- |',
  ...FACTION_IDS.map(
    (f) =>
      `| ${FACTION_NAMES[f]} | ${pct(overallWinRates[f])} | ${pct(proxyRateByFaction[f])} |`,
  ),
  '',
  '## 시나리오별 왕국 승률·종료 방식',
  '',
  '| 시나리오 | 게임 | 청람 | 진홍 | 자원 | 평균 종료 턴 | 정복 | 왕관 | 턴 제한 | 턴제한비율 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...perScenarioDetail.map(
    (s) =>
      `| ${SCENARIOS[s.scenario].name} | ${s.games} | ${pct(s.winRates.azure)} | ${pct(s.winRates.crimson)} | ${pct(s.winRates.violet)} | ${s.avgEndTurn} | ${s.endReasons.conquest} | ${s.endReasons['crown-hold']} | ${s.endReasons['turn-limit']} | ${pct(s.turnLimitRate)} |`,
  ),
  '',
  '## 6병종 생산·생존 통계',
  '',
  '| 병종 | 생산 | 등장(시작포함) | 생존 | 생산비중 | 생존율 | 생산게임비율 | 적격게임 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...UNIT_TYPE_IDS.map((t) => {
    const u = unitStats[t];
    return `| ${UNIT_NAMES[t]} | ${u.produced} | ${u.spawned} | ${u.alive} | ${pct(u.share)} | ${pct(u.survivalRate)} | ${pct(u.produceRate)} | ${u.eligibleGames} |`;
  }),
  '',
  `- 공용 기병 비중(공용 대비): ${pct(summary.cavalrySharedShare)}`,
  '',
  '## 세력별 병종 구성(생산)',
  '',
  '| 세력 | 보병 | 궁병 | 기병 | 수호대 | 약탈대 | 쇠뇌대 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...FACTION_IDS.map((f) => {
    const r = rosterByFaction[f];
    return `| ${FACTION_NAMES[f]} | ${r.infantry} | ${r.archer} | ${r.cavalry} | ${r.guardian} | ${r.raider} | ${r.crossbow} |`;
  }),
  '',
  '## 난이도별 대체 인간(보통 고정) 승률',
  '',
  '| 상대 난이도 | 승률 |',
  '| --- | --- |',
  ...DIFFICULTIES.map((d) => `| ${d} | ${pct(proxyRateByDifficulty[d])} |`),
  '',
  `## 판정: ${failures.length === 0 ? 'PASS' : 'FAIL'}`,
  '',
  ...(failures.length
    ? ['### 실패한 게이트와 실제 수치', '', ...failures.map((f) => `- ${f}`)]
    : ['실패한 게이트: 0건']),
  '',
].join('\n');
writeFileSync(join(outDir, 'balance-summary.md'), md);

console.log(md);
if (failures.length > 0) process.exit(1);

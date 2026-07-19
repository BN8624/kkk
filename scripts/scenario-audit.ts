// 한 줄 목적: 전 시나리오 전수 감사로 조기 자동 승리·개입 전 종료 등 경고를 집계한다(자동 대체 정책)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAiTurn } from '../src/core/ai';
import { FACTION_IDS, FACTION_NAMES } from '../src/core/data';
import { newGame } from '../src/core/game';
import { hexDistance } from '../src/core/hex';
import { generateScenarioMap } from '../src/core/map';
import { analyzeObjectiveArrival } from '../src/core/scenario/arrival';
import { SCENARIO_IDS, SCENARIOS } from '../src/core/scenarios';
import type {
  BuiltinScenarioId,
  Difficulty,
  FactionId,
  GameState,
} from '../src/core/types';

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
const SEEDS_PER_COMBO = Number(process.argv.find((a) => a.startsWith('--seeds='))?.slice(8) ?? 16);
const SEED_BASE = 20260900;

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
  firstCombatTurn: number | null;
  firstCaptureTurn: number | null;
  endedBeforeHumanAction: boolean;
  humanAttacked: boolean;
  humanReachedKeyAdjacent: boolean;
  keyVictoryBeforeHumanAdjacent: boolean;
  arrivalByFaction: Record<FactionId, number>;
  arrivalMaxGap: number;
  startUnitTypes: Record<FactionId, string[]>;
  firstCrownOwner: FactionId | null;
  crownWinWithin4: boolean;
}

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

function endReasonOf(state: GameState, scenario: BuiltinScenarioId): GameOutcome['endReason'] {
  if (!state.over) return 'unfinished';
  const need = SCENARIOS[scenario].crownHoldTurns ?? Infinity;
  if (
    SCENARIOS[scenario].victory === 'crown-hold' &&
    state.crownHold &&
    state.crownHold.owner === state.winner &&
    state.crownHold.turns >= need
  )
    return 'crown-hold';
  if (state.turn > state.maxTurns) return 'turn-limit';
  return 'conquest';
}

/** 핵심 목표 좌표(왕관 우선, 없으면 적 수도). */
function keyTargets(state: GameState, human: FactionId): { q: number; r: number }[] {
  const crowns = state.tiles.filter((t) => t.building === 'crown');
  if (crowns.length) return crowns.map((t) => ({ q: t.q, r: t.r }));
  return state.tiles
    .filter((t) => t.building === 'capital' && t.owner !== human)
    .map((t) => ({ q: t.q, r: t.r }));
}

function runGame(
  scenario: BuiltinScenarioId,
  humanFaction: FactionId,
  difficulty: Difficulty,
  seed: number,
): GameOutcome {
  const map = generateScenarioMap(scenario, seed);
  let arrivalByFaction = Object.fromEntries(FACTION_IDS.map((f) => [f, Infinity])) as Record<
    FactionId,
    number
  >;
  let arrivalMaxGap = Infinity;
  if (map.crown) {
    const rep = analyzeObjectiveArrival(map, map.crown);
    arrivalByFaction = { ...rep.earliestByFaction };
    arrivalMaxGap = rep.maxGap;
  } else {
    // 비왕관: 각 세력 기준 가장 가까운 적 수도 도착 평균 대신 수도 간 도착
    const targets = FACTION_IDS.map((f) => map.capitals[f]);
    const gaps: number[] = [];
    for (const f of FACTION_IDS) {
      const others = targets.filter((_, i) => FACTION_IDS[i] !== f);
      const reps = others.map((t) => analyzeObjectiveArrival(map, t).earliestByFaction[f]);
      arrivalByFaction[f] = Math.min(...reps.filter((n) => Number.isFinite(n)));
      gaps.push(arrivalByFaction[f]);
    }
    const finite = gaps.filter((n) => Number.isFinite(n));
    arrivalMaxGap =
      finite.length > 0 ? Math.max(...finite) - Math.min(...finite) : Number.POSITIVE_INFINITY;
  }

  const state = newGame(seed, { scenario, difficulty, humanFaction });
  const startUnitTypes = Object.fromEntries(
    FACTION_IDS.map((f) => [
      f,
      state.units.filter((u) => u.faction === f).map((u) => u.type),
    ]),
  ) as Record<FactionId, string[]>;

  const illegal = new Set<string>();
  let phases = 0;
  const maxPhases = (state.maxTurns + 2) * FACTION_IDS.length;
  let humanDidAction = false;
  let humanAttacked = false;
  let humanReachedKeyAdjacent = false;
  let firstCombatTurn: number | null = null;
  let firstCaptureTurn: number | null = null;
  let firstCrownOwner: FactionId | null = null;
  const buildingOwnerAtStart = new Map<string, FactionId | null>(
    state.tiles
      .filter((t) => t.building)
      .map((t) => [`${t.q},${t.r}`, t.owner ?? null]),
  );

  while (!state.over && phases < maxPhases) {
    const f = state.current;
    // 인간=보통 AI 대체, 상대=설정 난이도 AI (simulate.ts 와 동일)
    const { commands } = runAiTurn(state, f, f === humanFaction ? 'normal' : undefined);
    phases++;

    if (f === humanFaction) {
      if (commands.some((c) => c.type === 'move-unit' || c.type === 'attack-unit')) {
        humanDidAction = true;
      }
      if (commands.some((c) => c.type === 'attack-unit')) humanAttacked = true;
    }

    if (commands.some((c) => c.type === 'attack-unit') && firstCombatTurn === null) {
      firstCombatTurn = state.turn;
    }

    // 거점 점령 최초 턴
    if (firstCaptureTurn === null) {
      for (const t of state.tiles) {
        if (!t.building) continue;
        const key = `${t.q},${t.r}`;
        const prev = buildingOwnerAtStart.get(key) ?? null;
        if (t.owner && t.owner !== prev) {
          firstCaptureTurn = state.turn;
          break;
        }
      }
    }

    // 인간 유닛이 핵심 목표 인접 도달
    if (!humanReachedKeyAdjacent) {
      const keys = keyTargets(state, humanFaction);
      const mine = state.units.filter((u) => u.faction === humanFaction);
      if (mine.some((u) => keys.some((k) => hexDistance(u, k) <= 1))) {
        humanReachedKeyAdjacent = true;
      }
    }

    if (state.crownHold?.owner && firstCrownOwner === null) {
      firstCrownOwner = state.crownHold.owner;
    }

    checkIllegal(state, illegal);
    if (state.current === f && !state.over) break;
  }

  const reason = endReasonOf(state, scenario);
  const turns = Math.min(state.turn, state.maxTurns);
  // 조기 자동 승리 신호: 목표 승리가 확정됐는데 인간이 핵심 목표 인접에 못 간 채 조기 종료(또는 개입 전 종료)
  const keyVictoryBeforeHumanAdjacent =
    state.over &&
    !!state.winner &&
    state.winner !== 'draw' &&
    state.winner !== humanFaction &&
    !humanReachedKeyAdjacent &&
    (reason === 'crown-hold' || reason === 'conquest') &&
    (turns <= 4 || (state.over && !humanDidAction));

  const crownWinWithin4 =
    reason === 'crown-hold' &&
    !!state.winner &&
    state.winner !== 'draw' &&
    turns <= 4;

  return {
    scenario,
    humanFaction,
    difficulty,
    seed,
    finished: state.over,
    winner: state.winner ?? null,
    turns,
    endReason: reason,
    illegal: [...illegal],
    firstCombatTurn,
    firstCaptureTurn,
    endedBeforeHumanAction: state.over && !humanDidAction,
    humanAttacked,
    humanReachedKeyAdjacent,
    keyVictoryBeforeHumanAdjacent,
    arrivalByFaction,
    arrivalMaxGap,
    startUnitTypes,
    firstCrownOwner,
    crownWinWithin4,
  };
}

// ---------------- 실행 ----------------

const startedAt = Date.now();
const outcomes: GameOutcome[] = [];
let combo = 0;
for (const scenario of SCENARIO_IDS) {
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

// ---------------- 경고·강제 집계 ----------------

type Warning = { level: 'warn' | 'fail'; scenario: BuiltinScenarioId; message: string; count: number };

const warnings: Warning[] = [];

function addWarn(
  level: 'warn' | 'fail',
  scenario: BuiltinScenarioId,
  message: string,
  count: number,
): void {
  if (count <= 0) return;
  warnings.push({ level, scenario, message, count });
}

for (const scenario of SCENARIO_IDS) {
  const games = outcomes.filter((o) => o.scenario === scenario);
  const isCrown = scenario === 'crown-heart';
  const lvl = isCrown ? 'fail' : 'warn';

  // 4턴 이하 종료
  addWarn(lvl, scenario, '4턴 이하 종료', games.filter((o) => o.turns <= 4).length);

  // 인간이 공격 명령을 한 번도 못한 패배(조기·개입 전 패배 신호)
  addWarn(
    lvl,
    scenario,
    '인간 공격 0회 패배',
    games.filter(
      (o) =>
        o.finished &&
        o.winner !== o.humanFaction &&
        o.winner !== 'draw' &&
        !o.humanAttacked &&
        (o.turns <= 4 || o.endedBeforeHumanAction),
    ).length,
  );

  // 인간이 핵심 목표 인접 도달 전 목표 승리 확정
  addWarn(
    lvl,
    scenario,
    '인간 핵심목표 인접 전 목표 승리 확정',
    games.filter((o) => o.keyVictoryBeforeHumanAdjacent).length,
  );

  // 한 세력이 특정 시나리오에서 80% 이상 동일 방식 조기 승리
  for (const f of FACTION_IDS) {
    const earlyWins = games.filter(
      (o) => o.winner === f && o.turns <= 4 && o.endReason !== 'unfinished',
    );
    const rate = earlyWins.length / games.length;
    if (rate >= 0.8) {
      addWarn(
        lvl,
        scenario,
        `${FACTION_NAMES[f]} 동일 방식 조기 승리 ${(rate * 100).toFixed(0)}%`,
        earlyWins.length,
      );
    }
  }

  // 특정 시작 병과 하나가 목표 자동 선점(1턴 도착 가능 = 시작 병과 선점 편향)
  if (isCrown) {
    addWarn(
      lvl,
      scenario,
      '시작 병과 목표 자동 선점(arrival≤1)',
      games.filter((o) => FACTION_IDS.some((f) => o.arrivalByFaction[f] <= 1)).length,
    );
    addWarn(
      lvl,
      scenario,
      '도착 격차>1',
      games.filter((o) => o.arrivalMaxGap > 1).length,
    );
  }
}

const unfinished = outcomes.filter((o) => !o.finished);
const illegalGames = outcomes.filter((o) => o.illegal.length > 0);

// crown-heart 강제 + 전역 종료/불법 강제
const failures: string[] = [];
if (unfinished.length > 0) failures.push(`종료 불능 ${unfinished.length}개`);
if (illegalGames.length > 0) failures.push(`불법 상태 ${illegalGames.length}개`);
for (const w of warnings) {
  if (w.level === 'fail' && w.count > 0) {
    failures.push(`[${w.scenario}] ${w.message}: ${w.count}`);
  }
}

// 시나리오×세력×난이도 요약
const comboRows = SCENARIO_IDS.flatMap((scenario) =>
  FACTION_IDS.flatMap((humanFaction) =>
    DIFFICULTIES.map((difficulty) => {
      const games = outcomes.filter(
        (o) =>
          o.scenario === scenario &&
          o.humanFaction === humanFaction &&
          o.difficulty === difficulty,
      );
      const wins = games.filter((o) => o.winner === humanFaction).length;
      const avgTurn = games.length
        ? +(games.reduce((s, o) => s + o.turns, 0) / games.length).toFixed(2)
        : 0;
      const early = games.filter((o) => o.turns <= 4).length;
      const beforeAction = games.filter((o) => o.endedBeforeHumanAction).length;
      return {
        scenario,
        humanFaction,
        difficulty,
        games: games.length,
        humanWinRate: games.length ? +(wins / games.length).toFixed(3) : 0,
        avgEndTurn: avgTurn,
        earlyEnds: early,
        endedBeforeHumanAction: beforeAction,
      };
    }),
  ),
);

const summary = {
  generatedAt: new Date().toISOString(),
  elapsedSec: +elapsedSec.toFixed(1),
  seedsPerCombo: SEEDS_PER_COMBO,
  totalGames: outcomes.length,
  unfinishedGames: unfinished.length,
  illegalGames: illegalGames.length,
  comboRows,
  warnings: warnings.map((w) => ({
    level: w.level,
    scenario: w.scenario,
    message: w.message,
    count: w.count,
  })),
  pass: failures.length === 0,
  failures,
  note: '경고는 자동 대체 정책 통계이며 인간 플레이 검증이 아니다. crown-heart 경고는 강제 FAIL.',
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artifacts');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'scenario-audit.json'), JSON.stringify(summary, null, 2));

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const md = [
  '# 전수 시나리오 감사',
  '',
  `- 생성: ${summary.generatedAt} (${summary.elapsedSec}s)`,
  `- 조합: 시나리오 3 × 인간세력 3 × 난이도 3 × 시드 ${SEEDS_PER_COMBO} = 게임 ${outcomes.length}개`,
  `- 종료 불능: ${unfinished.length} · 불법 상태: ${illegalGames.length}`,
  '',
  '## 시나리오 × 세력 × 난이도 요약',
  '',
  '| 시나리오 | 인간 세력 | 난이도 | 게임 | 인간 승률 | 평균 종료 턴 | 4턴↓ | 개입 전 종료 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...comboRows.map(
    (r) =>
      `| ${SCENARIOS[r.scenario].name} | ${FACTION_NAMES[r.humanFaction]} | ${r.difficulty} | ${r.games} | ${pct(r.humanWinRate)} | ${r.avgEndTurn} | ${r.earlyEnds} | ${r.endedBeforeHumanAction} |`,
  ),
  '',
  '## 경고 목록',
  '',
  ...(warnings.length
    ? warnings.map(
        (w) =>
          `- [${w.level.toUpperCase()}] ${SCENARIOS[w.scenario].name}: ${w.message} (${w.count})`,
      )
    : ['- (없음)']),
  '',
  `## 판정: ${failures.length === 0 ? 'PASS' : 'FAIL'}`,
  ...(failures.length ? ['', ...failures.map((f) => `- ${f}`)] : []),
  '',
  '---',
  '',
  '경고는 자동 대체 정책 통계이며 인간 플레이 검증이 아니다. crown-heart 항목은 강제 판정이다.',
  '',
].join('\n');
writeFileSync(join(outDir, 'scenario-audit.md'), md);

console.log(md);
if (failures.length > 0) process.exit(1);

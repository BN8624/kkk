// 한 줄 목적: 고정 시드로 난이도·세력별 인간 전투 교환비·집중공격 지표를 감사한다
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAiTurn } from '../src/core/ai';
import { FACTION_IDS } from '../src/core/data';
import { newGame } from '../src/core/game';
import { SCENARIO_IDS } from '../src/core/scenarios';
import type { Difficulty, FactionId, GameState, BuiltinScenarioId } from '../src/core/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artifacts');
mkdirSync(outDir, { recursive: true });

const SEEDS = Number(process.argv.find((a) => a.startsWith('--seeds='))?.slice(8) ?? 12);
const SEED_BASE = 20260722;
const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

interface AttackRec {
  turn: number;
  attackerFaction: FactionId;
  defenderFaction: FactionId;
  defenderId: number;
  damage: number;
  defenderDied: boolean;
}

interface GameMetrics {
  scenario: BuiltinScenarioId;
  humanFaction: FactionId;
  difficulty: Difficulty;
  seed: number;
  finished: boolean;
  winner: FactionId | 'draw' | null;
  turns: number;
  illegal: boolean;
  humanDamageTaken: number;
  aiDamageTaken: number;
  humanUnitDeaths: number;
  aiUnitDeaths: number;
  humanKills: number;
  aiKills: number;
  maxAttacksSameHumanUnitRound: number;
  multiHitHumanUnits: number;
  maxConsecutiveHumanDeaths: number;
  attackCount: number;
  totalDamage: number;
  killCount: number;
  humanBaseAttackedByAi: number;
  aiBaseAttackedByHuman: number;
  aiAttacksOnHuman: number;
  aiAttacksTotal: number;
  humanForceDamage: number;
  otherAiForceDamage: number;
  aiVsAiAttacks: number;
}

function checkIllegal(state: GameState): boolean {
  const seen = new Set<string>();
  for (const u of state.units) {
    const k = `${u.q},${u.r}`;
    if (seen.has(k)) return true;
    seen.add(k);
    if (u.hp <= 0) return true;
  }
  for (const fid of FACTION_IDS) {
    if (!Number.isFinite(state.factions[fid].gold) || state.factions[fid].gold < 0) return true;
  }
  return false;
}

function isBuildingBase(state: GameState, q: number, r: number, owner: FactionId): boolean {
  const t = state.tiles.find((x) => x.q === q && x.r === r);
  return !!(t?.building && t.owner === owner && (t.building === 'capital' || t.building === 'village'));
}

function runGame(
  scenario: BuiltinScenarioId,
  humanFaction: FactionId,
  difficulty: Difficulty,
  seed: number,
): GameMetrics {
  const state = newGame(seed, { scenario, difficulty, humanFaction });
  const attacks: AttackRec[] = [];
  let illegal = false;
  let phases = 0;
  const maxPhases = (state.maxTurns + 2) * FACTION_IDS.length;
  let consecutiveHumanDeaths = 0;
  let maxConsecutiveHumanDeaths = 0;

  while (!state.over && phases < maxPhases) {
    const f = state.current;
    const result = runAiTurn(state, f, f === humanFaction ? 'normal' : undefined);
    phases++;
    for (const ev of result.events) {
      if (ev.type === 'unit-attacked') {
        attacks.push({
          turn: state.turn,
          attackerFaction: ev.attackerFaction,
          defenderFaction: ev.defenderFaction,
          defenderId: ev.defenderId,
          damage: ev.damage,
          defenderDied: false,
        });
      }
      if (ev.type === 'unit-died') {
        const last = attacks[attacks.length - 1];
        if (last && last.defenderId === ev.unitId && !last.defenderDied) {
          last.defenderDied = true;
        }
        if (ev.faction === humanFaction) {
          consecutiveHumanDeaths++;
          maxConsecutiveHumanDeaths = Math.max(maxConsecutiveHumanDeaths, consecutiveHumanDeaths);
        } else {
          consecutiveHumanDeaths = 0;
        }
      }
    }
    if (checkIllegal(state)) illegal = true;
    if (state.current === f && !state.over) break;
  }

  let humanDamageTaken = 0;
  let aiDamageTaken = 0;
  let humanUnitDeaths = 0;
  let aiUnitDeaths = 0;
  let humanKills = 0;
  let aiKills = 0;
  let attackCount = 0;
  let totalDamage = 0;
  let killCount = 0;
  let humanBaseAttackedByAi = 0;
  let aiBaseAttackedByHuman = 0;
  let aiAttacksOnHuman = 0;
  let aiAttacksTotal = 0;
  let humanForceDamage = 0;
  let otherAiForceDamage = 0;
  let aiVsAiAttacks = 0;

  // 라운드별 동일 인간 유닛 피격 집계
  const roundHits = new Map<string, number>();
  const multiHitUnits = new Set<string>();
  let maxAttacksSameHumanUnitRound = 0;

  for (const a of attacks) {
    attackCount++;
    totalDamage += a.damage;
    if (a.defenderDied) killCount++;

    if (a.defenderFaction === humanFaction) {
      humanDamageTaken += a.damage;
      if (a.defenderDied) humanUnitDeaths++;
    } else {
      aiDamageTaken += a.damage;
      if (a.defenderDied) aiUnitDeaths++;
    }

    if (a.attackerFaction === humanFaction) {
      if (a.defenderDied) humanKills++;
      humanForceDamage += a.damage;
    } else {
      if (a.defenderDied) aiKills++;
      aiAttacksTotal++;
      if (a.defenderFaction === humanFaction) {
        aiAttacksOnHuman++;
        const key = `${a.turn}:${a.defenderId}`;
        const n = (roundHits.get(key) ?? 0) + 1;
        roundHits.set(key, n);
        maxAttacksSameHumanUnitRound = Math.max(maxAttacksSameHumanUnitRound, n);
        if (n >= 2) multiHitUnits.add(key);
      } else if (a.defenderFaction !== a.attackerFaction) {
        aiVsAiAttacks++;
        otherAiForceDamage += a.damage;
      }
    }
  }

  // 거점 위 유닛 피격 근사: 사망/피격 좌표는 이벤트에 있으나 거점 소유는 시점 의존 — 생략하고 0 유지
  // (감사 핵심은 교환비·집중공격)
  void humanBaseAttackedByAi;
  void aiBaseAttackedByHuman;
  void isBuildingBase;

  return {
    scenario,
    humanFaction,
    difficulty,
    seed,
    finished: state.over,
    winner: state.winner ?? null,
    turns: Math.min(state.turn, state.maxTurns),
    illegal,
    humanDamageTaken,
    aiDamageTaken,
    humanUnitDeaths,
    aiUnitDeaths,
    humanKills,
    aiKills,
    maxAttacksSameHumanUnitRound,
    multiHitHumanUnits: multiHitUnits.size,
    maxConsecutiveHumanDeaths,
    attackCount,
    totalDamage,
    killCount,
    humanBaseAttackedByAi: 0,
    aiBaseAttackedByHuman: 0,
    aiAttacksOnHuman,
    aiAttacksTotal,
    humanForceDamage,
    otherAiForceDamage,
    aiVsAiAttacks,
  };
}

interface Agg {
  n: number;
  unfinished: number;
  illegal: number;
  humanWins: number;
  humanDamageTaken: number;
  aiDamageTaken: number;
  humanUnitDeaths: number;
  aiUnitDeaths: number;
  maxAttacksSameHumanUnitRound: number;
  multiHitHumanUnits: number;
  maxConsecutiveHumanDeaths: number;
  attackCount: number;
  totalDamage: number;
  killCount: number;
  aiAttacksOnHuman: number;
  aiAttacksTotal: number;
  humanForceDamage: number;
  otherAiForceDamage: number;
  aiVsAiAttacks: number;
  turns: number;
}

function emptyAgg(): Agg {
  return {
    n: 0,
    unfinished: 0,
    illegal: 0,
    humanWins: 0,
    humanDamageTaken: 0,
    aiDamageTaken: 0,
    humanUnitDeaths: 0,
    aiUnitDeaths: 0,
    maxAttacksSameHumanUnitRound: 0,
    multiHitHumanUnits: 0,
    maxConsecutiveHumanDeaths: 0,
    attackCount: 0,
    totalDamage: 0,
    killCount: 0,
    aiAttacksOnHuman: 0,
    aiAttacksTotal: 0,
    humanForceDamage: 0,
    otherAiForceDamage: 0,
    aiVsAiAttacks: 0,
    turns: 0,
  };
}

function add(a: Agg, m: GameMetrics): void {
  a.n++;
  if (!m.finished) a.unfinished++;
  if (m.illegal) a.illegal++;
  if (m.winner === m.humanFaction) a.humanWins++;
  a.humanDamageTaken += m.humanDamageTaken;
  a.aiDamageTaken += m.aiDamageTaken;
  a.humanUnitDeaths += m.humanUnitDeaths;
  a.aiUnitDeaths += m.aiUnitDeaths;
  a.maxAttacksSameHumanUnitRound = Math.max(
    a.maxAttacksSameHumanUnitRound,
    m.maxAttacksSameHumanUnitRound,
  );
  a.multiHitHumanUnits += m.multiHitHumanUnits;
  a.maxConsecutiveHumanDeaths = Math.max(a.maxConsecutiveHumanDeaths, m.maxConsecutiveHumanDeaths);
  a.attackCount += m.attackCount;
  a.totalDamage += m.totalDamage;
  a.killCount += m.killCount;
  a.aiAttacksOnHuman += m.aiAttacksOnHuman;
  a.aiAttacksTotal += m.aiAttacksTotal;
  a.humanForceDamage += m.humanForceDamage;
  a.otherAiForceDamage += m.otherAiForceDamage;
  a.aiVsAiAttacks += m.aiVsAiAttacks;
  a.turns += m.turns;
}

function rate(a: Agg): Record<string, number> {
  const n = Math.max(1, a.n);
  return {
    games: a.n,
    unfinished: a.unfinished,
    illegal: a.illegal,
    humanWinRate: a.humanWins / n,
    avgHumanDamageTaken: a.humanDamageTaken / n,
    avgAiDamageTaken: a.aiDamageTaken / n,
    avgHumanUnitDeaths: a.humanUnitDeaths / n,
    avgAiUnitDeaths: a.aiUnitDeaths / n,
    maxAttacksSameHumanUnitRound: a.maxAttacksSameHumanUnitRound,
    avgMultiHitHumanUnits: a.multiHitHumanUnits / n,
    maxConsecutiveHumanDeaths: a.maxConsecutiveHumanDeaths,
    avgDamagePerAttack: a.attackCount > 0 ? a.totalDamage / a.attackCount : 0,
    avgAttacksPerKill: a.killCount > 0 ? a.attackCount / a.killCount : 0,
    aiHumanTargetShare: a.aiAttacksTotal > 0 ? a.aiAttacksOnHuman / a.aiAttacksTotal : 0,
    avgAiVsAiAttacks: a.aiVsAiAttacks / n,
    avgTurns: a.turns / n,
  };
}

const byDifficulty = {
  easy: emptyAgg(),
  normal: emptyAgg(),
  hard: emptyAgg(),
} as Record<Difficulty, Agg>;
const byFactionNormal = {
  azure: emptyAgg(),
  crimson: emptyAgg(),
  violet: emptyAgg(),
} as Record<FactionId, Agg>;
const byScenarioNormal = {} as Record<string, Agg>;
for (const s of SCENARIO_IDS) byScenarioNormal[s] = emptyAgg();

const all: GameMetrics[] = [];
let combo = 0;
for (const scenario of SCENARIO_IDS) {
  for (const humanFaction of FACTION_IDS) {
    for (const difficulty of DIFFICULTIES) {
      for (let i = 0; i < SEEDS; i++) {
        const seed = SEED_BASE + combo * SEEDS + i;
        const m = runGame(scenario, humanFaction, difficulty, seed);
        all.push(m);
        add(byDifficulty[difficulty], m);
        if (difficulty === 'normal') {
          add(byFactionNormal[humanFaction], m);
          add(byScenarioNormal[scenario], m);
        }
      }
      combo++;
    }
  }
}

const summary = {
  seedBase: SEED_BASE,
  seedsPerCombo: SEEDS,
  byDifficulty: {
    easy: rate(byDifficulty.easy),
    normal: rate(byDifficulty.normal),
    hard: rate(byDifficulty.hard),
  },
  byFactionNormal: {
    azure: rate(byFactionNormal.azure),
    crimson: rate(byFactionNormal.crimson),
    violet: rate(byFactionNormal.violet),
  },
  byScenarioNormal: Object.fromEntries(
    SCENARIO_IDS.map((s) => [s, rate(byScenarioNormal[s])]),
  ),
  gates: {
    unfinished: byDifficulty.normal.unfinished,
    illegal: byDifficulty.normal.illegal,
    orderWinRate: {
      easy: rate(byDifficulty.easy).humanWinRate,
      normal: rate(byDifficulty.normal).humanWinRate,
      hard: rate(byDifficulty.hard).humanWinRate,
    },
    normalHumanDeaths: rate(byDifficulty.normal).avgHumanUnitDeaths,
    normalMultiHit: rate(byDifficulty.normal).avgMultiHitHumanUnits,
    normalAiHumanShare: rate(byDifficulty.normal).aiHumanTargetShare,
    hardAiHumanShare: rate(byDifficulty.hard).aiHumanTargetShare,
  },
};

const jsonPath = join(outDir, 'phase7-normal-difficulty-combat.json');
writeFileSync(jsonPath, JSON.stringify({ summary, samples: all }, null, 2), 'utf8');

const d = summary.byDifficulty;
const lines = [
  '# Phase 7-2 보통 난이도 전투 교환비·인간 집중공격 감사',
  '',
  `- 생성: 2026-07-22 (자동 재측정)`,
  `- seedBase: ${SEED_BASE}, seeds/combo: ${SEEDS}`,
  `- 총 게임: ${all.length}`,
  `- JSON: artifacts/phase7-normal-difficulty-combat.json`,
  '',
  '## 플레이 피드백 요약',
  '',
  '- 보통이 초보·중급·숙련 모두에 과도하게 어렵다는 보고',
  '- 한 번 맞은 유닛이 같은 라운드에 연쇄 소멸하는 체감',
  '- 병종 시각 식별 문제는 별도 이슈(범위 외)',
  '',
  '## 구조 원인 (코드)',
  '',
  '- 별도 AI 스탯 버퍼 없음 — 동일 스탯·피해 공식',
  '- controller=human 직접 가산 없음',
  '- 처치 가산 + 부상 가중 + 두 AI 독립 선택이 같은 빈사 목표에 집결',
  '- 보통: 처치/부상/반격 계수 연화 + 라운드 multiHitDampening + softCandidateBand',
  '',
  '## 난이도별 요약',
  '',
  '| 난이도 | 인간 승률 | 인간 유닛 사망 | 다중 피격 유닛 | AI→인간 공격비 | 평균 턴 | 종료불능 | 불법 |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...DIFFICULTIES.map((diff) => {
    const r = d[diff];
    return `| ${diff} | ${(r.humanWinRate * 100).toFixed(1)}% | ${r.avgHumanUnitDeaths.toFixed(2)} | ${r.avgMultiHitHumanUnits.toFixed(2)} | ${(r.aiHumanTargetShare * 100).toFixed(1)}% | ${r.avgTurns.toFixed(1)} | ${r.unfinished} | ${r.illegal} |`;
  }),
  '',
  '## 보통 · 인간 세력별',
  '',
  '| 세력 | 승률 | 인간 사망 | 다중 피격 | AI→인간 비 |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...FACTION_IDS.map((f) => {
    const r = summary.byFactionNormal[f];
    return `| ${f} | ${(r.humanWinRate * 100).toFixed(1)}% | ${r.avgHumanUnitDeaths.toFixed(2)} | ${r.avgMultiHitHumanUnits.toFixed(2)} | ${(r.aiHumanTargetShare * 100).toFixed(1)}% |`;
  }),
  '',
  '## 보통 · 시나리오별',
  '',
  '| 시나리오 | 승률 | 인간 사망 | 다중 피격 | AI→인간 비 |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...SCENARIO_IDS.map((s) => {
    const r = summary.byScenarioNormal[s];
    return `| ${s} | ${(r.humanWinRate * 100).toFixed(1)}% | ${r.avgHumanUnitDeaths.toFixed(2)} | ${r.avgMultiHitHumanUnits.toFixed(2)} | ${(r.aiHumanTargetShare * 100).toFixed(1)}% |`;
  }),
  '',
  '## 핵심 지표 (보통)',
  '',
  `- 공격 1회당 평균 피해: ${d.normal.avgDamagePerAttack.toFixed(2)}`,
  `- 처치 1회에 필요한 평균 공격 수: ${d.normal.avgAttacksPerKill.toFixed(2)}`,
  `- 최대 동일 인간 유닛 라운드 피격: ${d.normal.maxAttacksSameHumanUnitRound}`,
  `- 최대 연속 인간 유닛 사망: ${d.normal.maxConsecutiveHumanDeaths}`,
  `- AI 간 교전 평균: ${d.normal.avgAiVsAiAttacks.toFixed(2)}`,
  '',
  '## 난이도 정체성',
  '',
  '- 쉬움: 이동후공격 없음, 반격 미고려',
  '- 보통: 이동후공격·기본 반격·다중 피격 감쇠 (처치/부상 연화)',
  '- 어려움: focusFire·나쁜 교환 회피·지형·왕관 저지 강화',
  '',
  '## 단독 인간 플레이 확인',
  '',
  '- [ ] 세 세력 보통 각 1판: 라운드 연쇄 소멸 완화 체감',
  '- [ ] 적 AI가 서로 교전·거점 경쟁',
  '- [ ] 쉬움 < 보통 < 어려움 체감 서열',
  '- [ ] 피해 공식 체감 불변',
  '',
  '## 후속 UX (범위 외)',
  '',
  '- 병종 스프라이트·아이콘·전장 레전드 등 시각 식별 → 별도 이슈',
  '',
];

const mdPath = join(outDir, 'phase7-normal-difficulty-combat.md');
writeFileSync(mdPath, lines.join('\n'), 'utf8');

console.log(JSON.stringify(summary.gates, null, 2));
console.log(`wrote ${mdPath}`);
console.log(`wrote ${jsonPath}`);

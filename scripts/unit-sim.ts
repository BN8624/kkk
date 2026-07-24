// 한 줄 목적: 고유 병종 생산·능력 발동·공용 역할 유지율을 자동 시뮬로 검증한다
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAiTurn } from '../src/core/ai';
import { tileAt, unitsOf } from '../src/core/board';
import { CAMPAIGNS } from '../src/core/campaign/missions';
import { FACTION_IDS } from '../src/core/data';
import { newGame, newGameFromScenario } from '../src/core/game';
import { normalizeScenario } from '../src/core/scenario/normalize';
import { OFFICIAL_SCENARIOS } from '../src/core/scenario/official';
import type { FactionId, GameState, UnitTypeId } from '../src/core/types';
import { isUniqueUnit, UNIT_TYPE_IDS } from '../src/core/units';
import { addUnit, makeState } from '../tests/helpers';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artifacts');
mkdirSync(outDir, { recursive: true });

// Phase 7-1: 역할 분리 게이트는 최소 36개 고정 시드. --seeds= 로 축소 가능(CI는 기본값 유지).
const SEEDS = Number(process.argv.find((a) => a.startsWith('--seeds='))?.slice(8) ?? 36);
const SEED_BASE = 20262200;

interface FactionUsage {
  produced: Record<UnitTypeId, number>;
  uniqueProduced: number;
  sharedProduced: number;
  gamesWithUnique: number;
  gamesWithArcher: number;
  games: number;
}

interface SimBucket {
  label: string;
  games: number;
  unfinished: number;
  illegal: number;
  byFaction: Record<FactionId, FactionUsage>;
  braceHits: number;
  plunderEvents: number;
  pierceAttacks: number;
}

function emptyUsage(): FactionUsage {
  const produced = {} as Record<UnitTypeId, number>;
  for (const t of UNIT_TYPE_IDS) produced[t] = 0;
  return {
    produced,
    uniqueProduced: 0,
    sharedProduced: 0,
    gamesWithUnique: 0,
    gamesWithArcher: 0,
    games: 0,
  };
}

function emptyBucket(label: string): SimBucket {
  return {
    label,
    games: 0,
    unfinished: 0,
    illegal: 0,
    byFaction: {
      azure: emptyUsage(),
      crimson: emptyUsage(),
      violet: emptyUsage(),
    },
    braceHits: 0,
    plunderEvents: 0,
    pierceAttacks: 0,
  };
}

function checkIllegal(state: GameState): boolean {
  const seen = new Set<string>();
  for (const u of state.units) {
    const k = `${u.q},${u.r}`;
    if (seen.has(k)) return true;
    seen.add(k);
    if (u.hp <= 0) return true;
  }
  return FACTION_IDS.some((f) => state.factions[f].gold < 0);
}

function playAndCollect(state: GameState, bucket: SimBucket): void {
  bucket.games++;
  const producedThisGame: Record<FactionId, Set<UnitTypeId>> = {
    azure: new Set(),
    crimson: new Set(),
    violet: new Set(),
  };
  let guard = 0;
  const maxPhases = (state.maxTurns + 2) * FACTION_IDS.length;
  while (!state.over && guard < maxPhases) {
    guard++;
    const f = state.current;
    const idsBefore = new Set(state.units.map((u) => u.id));
    const { events } = runAiTurn(state, f);
    for (const u of state.units) {
      if (!idsBefore.has(u.id) && u.faction === f) {
        producedThisGame[f].add(u.type);
        bucket.byFaction[f].produced[u.type]++;
        if (isUniqueUnit(u.type)) bucket.byFaction[f].uniqueProduced++;
        else bucket.byFaction[f].sharedProduced++;
      }
    }
    for (const ev of events) {
      if (ev.type === 'gold-changed' && ev.reason === 'plunder') bucket.plunderEvents++;
      if (ev.type === 'unit-attacked') {
        if (ev.attackerType === 'crossbow') bucket.pierceAttacks++;
        if (ev.defenderType === 'guardian') bucket.braceHits++;
      }
    }
    if (checkIllegal(state)) {
      bucket.illegal++;
      break;
    }
  }
  if (!state.over) bucket.unfinished++;
  for (const f of FACTION_IDS) {
    bucket.byFaction[f].games++;
    if ([...producedThisGame[f]].some((t) => isUniqueUnit(t))) {
      bucket.byFaction[f].gamesWithUnique++;
    }
    if (producedThisGame[f].has('archer')) {
      bucket.byFaction[f].gamesWithArcher++;
    }
  }
}

/** 적 구성별 자원 AI 1턴 생산 선택 분포(역할 분기 검증). */
function probeVioletProduction(
  enemyTypes: UnitTypeId[],
  trials: number,
): { archer: number; crossbow: number; other: number; total: number } {
  const counts = { archer: 0, crossbow: 0, other: 0, total: 0 };
  for (let i = 0; i < trials; i++) {
    const state = makeState({ difficulty: 'hard', humanFaction: 'azure' });
    state.objectives.uniqueUnits = true;
    state.current = 'violet';
    state.controllers.violet = 'ai';
    state.factions.violet.gold = 200;
    // 수도만 비워 두고 생산한다. 아군은 이미 moved/attacked로 수도를 점유하지 않게 한다.
    const cap = tileAt(state, 0, 0)!;
    cap.building = 'capital';
    cap.owner = 'violet';
    // 시작 궁병 골격 비율 반영(행동 불능 — 수도 점유·교전 없음)
    addUnit(state, {
      faction: 'violet',
      type: 'archer',
      q: 1,
      r: 0,
      moved: true,
      attacked: true,
    });
    addUnit(state, {
      faction: 'violet',
      type: 'infantry',
      q: 0,
      r: 1,
      moved: true,
      attacked: true,
    });
    // 적 구성 (미니맵 안, 수도와 비인접 — adaptive 생산 스킵 방지)
    const enemySlots: Array<{ q: number; r: number }> = [
      { q: 4, r: 3 },
      { q: 3, r: 4 },
      { q: 4, r: 4 },
      { q: 2, r: 4 },
      { q: 4, r: 2 },
    ];
    enemyTypes.forEach((t, idx) => {
      const slot = enemySlots[idx % enemySlots.length];
      addUnit(state, { faction: 'azure', type: t, q: slot.q, r: slot.r });
    });
    const before = new Set(state.units.map((u) => u.id));
    runAiTurn(state, 'violet');
    const produced = state.units.filter((u) => u.faction === 'violet' && !before.has(u.id));
    for (const u of produced) {
      counts.total++;
      if (u.type === 'archer') counts.archer++;
      else if (u.type === 'crossbow') counts.crossbow++;
      else counts.other++;
    }
    void unitsOf;
  }
  return counts;
}

const buckets: SimBucket[] = [];

// 빠른 전투(uniqueUnits 내장) — 고정 시드 집합
{
  const b = emptyBucket('quick-battle');
  for (let i = 0; i < SEEDS; i++) {
    playAndCollect(newGame(SEED_BASE + i, { difficulty: 'hard' }), b);
  }
  buckets.push(b);
}

// 캠페인 미션2·3
{
  const b = emptyBucket('campaign-m2-m3');
  for (const c of CAMPAIGNS) {
    for (const m of c.missions.slice(1)) {
      for (let i = 0; i < Math.max(2, Math.floor(SEEDS / 6)); i++) {
        const state = newGameFromScenario(
          SEED_BASE + 1000 + i,
          normalizeScenario(m.scenario),
          { mode: 'campaign', difficulty: 'hard' },
        );
        playAndCollect(state, b);
      }
    }
  }
  buckets.push(b);
}

// 공식 전장(고유 배치 포함)
{
  const b = emptyBucket('official');
  for (const doc of OFFICIAL_SCENARIOS) {
    if (doc.rules.uniqueUnits !== true) continue;
    for (let i = 0; i < Math.max(2, Math.floor(SEEDS / 8)); i++) {
      const state = newGameFromScenario(SEED_BASE + 2000 + i, normalizeScenario(doc), {
        mode: 'custom',
        difficulty: 'hard',
      });
      playAndCollect(state, b);
    }
  }
  buckets.push(b);
}

// 구성 프로브: 고방어 vs 연·중방어
const PROBE_TRIALS = 24;
// 연·중방어: 기병 대응(보병 가산)과 분리해 궁병 vs 쇠뇌대 역할만 본다
const softProbe = probeVioletProduction(
  ['infantry', 'infantry', 'archer', 'archer'],
  PROBE_TRIALS,
);
const hardProbe = probeVioletProduction(
  ['guardian', 'guardian', 'infantry', 'guardian'],
  PROBE_TRIALS,
);

// 게이트: 미사용·과사용·종료불능·불법 + 자원 궁병/쇠뇌대 역할 분리
function gate(b: SimBucket): { ok: boolean; notes: string[] } {
  const notes: string[] = [];
  if (b.unfinished > 0) notes.push(`unfinished=${b.unfinished}`);
  if (b.illegal > 0) notes.push(`illegal=${b.illegal}`);
  // 빠른 전투: 세 세력 고유 생산 의무 + 자원 역할 분리
  if (b.label === 'quick-battle') {
    for (const f of FACTION_IDS) {
      const u = b.byFaction[f];
      const uniqueType =
        f === 'azure' ? 'guardian' : f === 'crimson' ? 'raider' : 'crossbow';
      if (u.produced[uniqueType] === 0) notes.push(`${f}-no-${uniqueType}`);
      // 과사용: 고유 비율 75% 초과
      const total = u.uniqueProduced + u.sharedProduced;
      if (total > 0 && u.uniqueProduced / total > 0.75) notes.push(`${f}-unique-overuse`);
      if (total > 0 && u.sharedProduced === 0) notes.push(`${f}-no-shared`);
    }

    const v = b.byFaction.violet;
    const archerN = v.produced.archer;
    const crossbowN = v.produced.crossbow;
    const ranged = archerN + crossbowN;

    // 1) 궁병 생산 총량 0 금지
    if (archerN === 0) notes.push('violet-no-archer');
    // 2) 궁병을 한 번 이상 생산한 게임 ≥ 40%
    if (v.games > 0 && v.gamesWithArcher / v.games < 0.4) {
      notes.push(
        `violet-archer-games-low=${(v.gamesWithArcher / v.games).toFixed(2)}`,
      );
    }
    // 3) 쇠뇌대 생산 0 금지 (위 unique 게이트와 중복이지만 명시)
    if (crossbowN === 0) notes.push('violet-no-crossbow');
    // 4·5) 사격계(궁병+쇠뇌대) 중 궁병 ≥20%, 쇠뇌대 ≤80%
    if (ranged > 0) {
      const archerShare = archerN / ranged;
      const crossbowShare = crossbowN / ranged;
      if (archerShare < 0.2) notes.push(`violet-archer-ranged-share-low=${archerShare.toFixed(2)}`);
      if (crossbowShare > 0.8) {
        notes.push(`violet-crossbow-ranged-share-high=${crossbowShare.toFixed(2)}`);
      }
    } else {
      notes.push('violet-no-ranged-production');
    }
  }

  // 공식 전장: 고유 병종 허용 맵에서 세력별 고유 0생산은 역할 붕괴로 실패
  if (b.label === 'official') {
    for (const f of FACTION_IDS) {
      const u = b.byFaction[f];
      const uniqueType =
        f === 'azure' ? 'guardian' : f === 'crimson' ? 'raider' : 'crossbow';
      if (u.produced[uniqueType] === 0) notes.push(`${f}-no-${uniqueType}`);
    }
  }
  return { ok: notes.length === 0, notes };
}

function compositionGate(): { ok: boolean; notes: string[] } {
  const notes: string[] = [];
  // 6) 고방어 조합에서 쇠뇌대 선택 비중이 연·중방어 조합보다 높아야 한다
  const softCross =
    softProbe.total > 0 ? softProbe.crossbow / softProbe.total : 0;
  const hardCross =
    hardProbe.total > 0 ? hardProbe.crossbow / hardProbe.total : 0;
  if (hardProbe.total === 0 || softProbe.total === 0) {
    notes.push('composition-probe-no-production');
  } else if (hardCross <= softCross) {
    notes.push(
      `crossbow-hard-not-higher soft=${softCross.toFixed(2)} hard=${hardCross.toFixed(2)}`,
    );
  }
  // 7) 연·중방어 조합에서 궁병이 쇠뇌대를 완전히 대체하지 않음(둘 다 존재 가능) + 궁병 비중 유지
  const softArcher = softProbe.total > 0 ? softProbe.archer / softProbe.total : 0;
  if (softProbe.total > 0 && softArcher < 0.2) {
    notes.push(`soft-composition-archer-low=${softArcher.toFixed(2)}`);
  }
  // 고방어에서도 쇠뇌대가 아예 0이면 역할 붕괴
  if (hardProbe.total > 0 && hardProbe.crossbow === 0) {
    notes.push('hard-composition-no-crossbow');
  }
  return { ok: notes.length === 0, notes };
}

const gates = buckets.map((b) => ({ label: b.label, ...gate(b) }));
const compGate = { label: 'composition-probe', ...compositionGate() };
gates.push(compGate);
const pass = gates.every((g) => g.ok);

const qb = buckets.find((b) => b.label === 'quick-battle')!;
const vQuick = qb.byFaction.violet;
const rangedQuick = vQuick.produced.archer + vQuick.produced.crossbow;

const summary = {
  generatedAt: new Date().toISOString(),
  seedsPerQuick: SEEDS,
  seedBase: SEED_BASE,
  pass,
  gates,
  violetQuick: {
    archer: vQuick.produced.archer,
    crossbow: vQuick.produced.crossbow,
    infantry: vQuick.produced.infantry,
    cavalry: vQuick.produced.cavalry,
    rangedArcherShare: rangedQuick > 0 ? vQuick.produced.archer / rangedQuick : 0,
    rangedCrossbowShare: rangedQuick > 0 ? vQuick.produced.crossbow / rangedQuick : 0,
    gamesWithArcher: vQuick.gamesWithArcher,
    gamesWithUnique: vQuick.gamesWithUnique,
    games: vQuick.games,
  },
  compositionProbes: {
    soft: softProbe,
    hard: hardProbe,
  },
  buckets,
};

writeFileSync(join(outDir, 'unique-unit-simulation.json'), JSON.stringify(summary, null, 2));

const md = [
  '# 고유 병종 시뮬레이션 요약',
  '',
  `- 생성: ${summary.generatedAt}`,
  `- 판정: ${pass ? 'PASS' : 'FAIL'}`,
  `- 빠른 전투 시드: ${SEEDS} (base ${SEED_BASE})`,
  '',
  '| 묶음 | 판 | 종료불능 | 불법 | 수호피격 | 약탈 | 관통공격 | 게이트 |',
  '|---|---:|---:|---:|---:|---:|---:|---|',
  ...buckets.map((b, i) => {
    const g = gates[i];
    return `| ${b.label} | ${b.games} | ${b.unfinished} | ${b.illegal} | ${b.braceHits} | ${b.plunderEvents} | ${b.pierceAttacks} | ${g.ok ? 'PASS' : g.notes.join('; ')} |`;
  }),
  `| composition-probe | ${PROBE_TRIALS * 2} | — | — | — | — | — | ${compGate.ok ? 'PASS' : compGate.notes.join('; ')} |`,
  '',
  '## 세력별 생산(빠른 전투)',
  '',
];
for (const f of FACTION_IDS) {
  const u = qb.byFaction[f];
  const parts = UNIT_TYPE_IDS.filter((t) => u.produced[t] > 0)
    .map((t) => `${t}:${u.produced[t]}`)
    .join(' · ');
  md.push(
    `- **${f}**: ${parts || '(없음)'} (고유 생산 판 ${u.gamesWithUnique}/${u.games}` +
      (f === 'violet' ? `, 궁병 생산 판 ${u.gamesWithArcher}/${u.games}` : '') +
      ')',
  );
}
md.push('');
md.push('## 자원 후국 사격계 역할 (빠른 전투)');
md.push('');
md.push(
  `- 궁병: ${vQuick.produced.archer} · 쇠뇌대: ${vQuick.produced.crossbow}` +
    ` · 사격계 궁병 비중: ${rangedQuick > 0 ? (vQuick.produced.archer / rangedQuick).toFixed(2) : 'n/a'}` +
    ` · 사격계 쇠뇌대 비중: ${rangedQuick > 0 ? (vQuick.produced.crossbow / rangedQuick).toFixed(2) : 'n/a'}`,
);
md.push(
  `- 궁병 생산 게임 비율: ${vQuick.games > 0 ? (vQuick.gamesWithArcher / vQuick.games).toFixed(2) : 'n/a'}`,
);
md.push('');
md.push('## 적 구성 프로브 (자원 1턴 생산)');
md.push('');
md.push(
  `- 연·중방어: total=${softProbe.total} archer=${softProbe.archer} crossbow=${softProbe.crossbow} other=${softProbe.other}`,
);
md.push(
  `- 고방어(수호): total=${hardProbe.total} archer=${hardProbe.archer} crossbow=${hardProbe.crossbow} other=${hardProbe.other}`,
);
md.push('');
writeFileSync(join(outDir, 'unique-unit-simulation.md'), md.join('\n'));
console.log(md.join('\n'));
if (!pass) process.exit(1);

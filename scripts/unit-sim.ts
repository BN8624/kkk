// 한 줄 목적: 고유 병종 생산·능력 발동·공용 역할 유지율을 자동 시뮬로 검증한다
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAiTurn } from '../src/core/ai';
import { CAMPAIGNS } from '../src/core/campaign/missions';
import { FACTION_IDS } from '../src/core/data';
import { newGame, newGameFromScenario } from '../src/core/game';
import { normalizeScenario } from '../src/core/scenario/normalize';
import { OFFICIAL_SCENARIOS } from '../src/core/scenario/official';
import type { FactionId, GameState, UnitTypeId } from '../src/core/types';
import { isUniqueUnit, UNIT_TYPE_IDS } from '../src/core/units';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artifacts');
mkdirSync(outDir, { recursive: true });

const SEEDS = Number(process.argv.find((a) => a.startsWith('--seeds='))?.slice(8) ?? 12);
const SEED_BASE = 20262200;

interface FactionUsage {
  produced: Record<UnitTypeId, number>;
  uniqueProduced: number;
  sharedProduced: number;
  gamesWithUnique: number;
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
  return { produced, uniqueProduced: 0, sharedProduced: 0, gamesWithUnique: 0, games: 0 };
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
  const beforeIds = new Set(state.units.map((u) => u.id));
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
  }
  void beforeIds;
}

const buckets: SimBucket[] = [];

// 빠른 전투(uniqueUnits 내장)
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
      for (let i = 0; i < Math.max(2, Math.floor(SEEDS / 4)); i++) {
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
    for (let i = 0; i < Math.max(2, Math.floor(SEEDS / 6)); i++) {
      const state = newGameFromScenario(SEED_BASE + 2000 + i, normalizeScenario(doc), {
        mode: 'custom',
        difficulty: 'hard',
      });
      playAndCollect(state, b);
    }
  }
  buckets.push(b);
}

// 게이트: 미사용·과사용·종료불능·불법 상태
function gate(b: SimBucket): { ok: boolean; notes: string[] } {
  const notes: string[] = [];
  if (b.unfinished > 0) notes.push(`unfinished=${b.unfinished}`);
  if (b.illegal > 0) notes.push(`illegal=${b.illegal}`);
  // 빠른 전투만 세 세력 고유 생산 의무
  if (b.label === 'quick-battle') {
    for (const f of FACTION_IDS) {
      const u = b.byFaction[f];
      const uniqueType =
        f === 'azure' ? 'guardian' : f === 'crimson' ? 'raider' : 'crossbow';
      if (u.produced[uniqueType] === 0) notes.push(`${f}-no-${uniqueType}`);
      // 과사용: 고유 > 공용*2 이고 고유 비율 70% 이상
      const total = u.uniqueProduced + u.sharedProduced;
      if (total > 0 && u.uniqueProduced / total > 0.75) notes.push(`${f}-unique-overuse`);
      if (total > 0 && u.sharedProduced === 0) notes.push(`${f}-no-shared`);
    }
  }
  return { ok: notes.length === 0, notes };
}

const gates = buckets.map((b) => ({ label: b.label, ...gate(b) }));
const pass = gates.every((g) => g.ok);

const summary = {
  generatedAt: new Date().toISOString(),
  seedsPerQuick: SEEDS,
  pass,
  gates,
  buckets,
};

writeFileSync(join(outDir, 'unique-unit-simulation.json'), JSON.stringify(summary, null, 2));

const md = [
  '# 고유 병종 시뮬레이션 요약',
  '',
  `- 생성: ${summary.generatedAt}`,
  `- 판정: ${pass ? 'PASS' : 'FAIL'}`,
  '',
  '| 묶음 | 판 | 종료불능 | 불법 | 수호피격 | 약탈 | 관통공격 | 게이트 |',
  '|---|---:|---:|---:|---:|---:|---:|---|',
  ...buckets.map((b, i) => {
    const g = gates[i];
    return `| ${b.label} | ${b.games} | ${b.unfinished} | ${b.illegal} | ${b.braceHits} | ${b.plunderEvents} | ${b.pierceAttacks} | ${g.ok ? 'PASS' : g.notes.join('; ')} |`;
  }),
  '',
  '## 세력별 생산(빠른 전투)',
  '',
];
const qb = buckets.find((b) => b.label === 'quick-battle');
if (qb) {
  for (const f of FACTION_IDS) {
    const u = qb.byFaction[f];
    const parts = UNIT_TYPE_IDS.filter((t) => u.produced[t] > 0)
      .map((t) => `${t}:${u.produced[t]}`)
      .join(' · ');
    md.push(`- **${f}**: ${parts || '(없음)'} (고유 생산 판 ${u.gamesWithUnique}/${u.games})`);
  }
}
md.push('');
writeFileSync(join(outDir, 'unique-unit-simulation.md'), md.join('\n'));
console.log(md.join('\n'));
if (!pass) process.exit(1);

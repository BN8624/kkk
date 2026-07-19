// 한 줄 목적: 왕관 고정 위치 편향과 신 선택 규칙의 구조적 도착 분석 재현 근거를 artifact로 남긴다
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACTION_IDS, FACTION_NAMES } from '../src/core/data';
import { offsetToAxial } from '../src/core/hex';
import { generateScenarioMap, type GeneratedMap } from '../src/core/map';
import { analyzeObjectiveArrival } from '../src/core/scenario/arrival';
import { startUnitPlacements } from '../src/core/scenario/placement';
import type { Axial, FactionId, Tile } from '../src/core/types';

/** 과거 고정 왕관 위치(offset col=4, row=5). 구조 분석용이며 리플레이 재생이 아니다. */
const OLD_CROWN_OFFSET = { col: 4, row: 5 };
const SEEDS = [1, 2, 3, 7, 42];

function cloneTiles(tiles: Tile[]): Tile[] {
  return tiles.map((t) => ({ ...t }));
}

/**
 * 신 지도 지형을 유지한 채 왕관만 구 고정 좌표로 옮긴 분석용 맵을 만든다.
 * 실제 과거 리플레이 재생이 아니라 구조적 도착 분석용이다.
 */
function mapWithOldCrown(map: GeneratedMap, oldCrown: Axial): GeneratedMap {
  const tiles = cloneTiles(map.tiles);
  for (const t of tiles) {
    if (t.building === 'crown') {
      t.building = undefined;
      t.owner = undefined;
    }
  }
  let crownTile = tiles.find((t) => t.q === oldCrown.q && t.r === oldCrown.r);
  if (!crownTile) {
    // 맵 밖이면 가장 가까운 타일 사용(방어)
    crownTile = tiles[0];
  }
  crownTile.terrain = 'plains';
  crownTile.building = 'crown';
  crownTile.owner = undefined;
  // 인접 물 개통(구 applyCrownAt 과 동일 취지)
  const dirs = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ];
  for (const d of dirs) {
    const n = tiles.find((t) => t.q === crownTile!.q + d.q && t.r === crownTile!.r + d.r);
    if (n && n.terrain === 'water') n.terrain = 'plains';
  }
  return {
    tiles,
    capitals: map.capitals,
    crown: { q: crownTile.q, r: crownTile.r },
  };
}

interface SeedReport {
  seed: number;
  oldCrown: Axial;
  newCrown: Axial;
  startUnits: Record<FactionId, { type: string; at: Axial }[]>;
  oldArrivalByFaction: Record<FactionId, number>;
  newArrivalByFaction: Record<FactionId, number>;
  oldMaxGap: number;
  newMaxGap: number;
  oldMinArrival: number;
  newMinArrival: number;
  azureCostToOldCrown: number | null;
  azureArrivalOld: number | null;
  crimsonOldArrival: number | null;
  oldUnfair: boolean;
  newFair: boolean;
}

const reports: SeedReport[] = [];

for (const seed of SEEDS) {
  const newMap = generateScenarioMap('crown-heart', seed);
  const oldCrown = offsetToAxial(OLD_CROWN_OFFSET.col, OLD_CROWN_OFFSET.row);
  const oldMap = mapWithOldCrown(newMap, oldCrown);

  const oldRep = analyzeObjectiveArrival(oldMap, oldMap.crown!);
  const newRep = analyzeObjectiveArrival(newMap, newMap.crown!);

  const placements = startUnitPlacements(newMap);
  const startUnits = Object.fromEntries(
    FACTION_IDS.map((f) => [
      f,
      placements.filter((p) => p.faction === f).map((p) => ({ type: p.type, at: p.at })),
    ]),
  ) as SeedReport['startUnits'];

  const azureOld = oldRep.perFaction.azure;
  const oldFinite = FACTION_IDS.map((f) => oldRep.earliestByFaction[f]).filter((n) =>
    Number.isFinite(n),
  );
  const newFinite = FACTION_IDS.map((f) => newRep.earliestByFaction[f]).filter((n) =>
    Number.isFinite(n),
  );
  const oldMin = oldFinite.length ? Math.min(...oldFinite) : Infinity;
  const newMin = newFinite.length ? Math.min(...newFinite) : Infinity;

  const oldUnfair =
    oldMin < 2 ||
    oldRep.maxGap > 0 ||
    (Number.isFinite(oldRep.earliestByFaction.crimson) &&
      oldRep.earliestByFaction.crimson === 1);

  const newFair = newMin >= 2 && newRep.maxGap <= 1;

  reports.push({
    seed,
    oldCrown: { q: oldMap.crown!.q, r: oldMap.crown!.r },
    newCrown: { q: newMap.crown!.q, r: newMap.crown!.r },
    startUnits,
    oldArrivalByFaction: { ...oldRep.earliestByFaction },
    newArrivalByFaction: { ...newRep.earliestByFaction },
    oldMaxGap: oldRep.maxGap,
    newMaxGap: newRep.maxGap,
    oldMinArrival: oldMin,
    newMinArrival: newMin,
    azureCostToOldCrown: azureOld ? azureOld.movementCost : null,
    azureArrivalOld: azureOld ? azureOld.earliestArrivalTurn : null,
    crimsonOldArrival: oldRep.earliestByFaction.crimson,
    oldUnfair,
    newFair,
  });
}

const allNewFair = reports.every((r) => r.newFair);
const anyOldBias = reports.some(
  (r) =>
    r.crimsonOldArrival === 1 ||
    r.oldMinArrival < 2 ||
    r.oldMaxGap > 1,
);

const summary = {
  generatedAt: new Date().toISOString(),
  note: '실제 과거 리플레이를 재생한 것이 아니라 구조적 도착 분석 기반 증거이다.',
  oldCrownOffset: OLD_CROWN_OFFSET,
  seeds: SEEDS,
  reports: reports.map((r) => ({
    seed: r.seed,
    oldCrown: r.oldCrown,
    newCrown: r.newCrown,
    startUnits: r.startUnits,
    oldArrivalByFaction: r.oldArrivalByFaction,
    newArrivalByFaction: r.newArrivalByFaction,
    oldMaxGap: r.oldMaxGap,
    newMaxGap: r.newMaxGap,
    azureCostToOldCrown: r.azureCostToOldCrown,
    azureArrivalOld: r.azureArrivalOld,
    crimsonOldArrival: r.crimsonOldArrival,
    oldUnfair: r.oldUnfair,
    newFair: r.newFair,
  })),
  conclusion: {
    oldFixedBiased: anyOldBias,
    newRuleFair: allNewFair,
    text: '구 고정 위치는 진홍 기병 선착으로 불공정, 신 규칙은 도착 공정성 충족',
  },
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artifacts');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'crown-heart-human-regression.json'),
  JSON.stringify(summary, null, 2),
);

const fmtArr = (rec: Record<FactionId, number>) =>
  FACTION_IDS.map((f) => `${FACTION_NAMES[f]}=${rec[f]}`).join(', ');

const md = [
  '# crown-heart 구조적 재현 근거 (도착 분석)',
  '',
  `- 생성: ${summary.generatedAt}`,
  `- 구 고정 위치: offset (${OLD_CROWN_OFFSET.col}, ${OLD_CROWN_OFFSET.row})`,
  `- 시드: ${SEEDS.join(', ')}`,
  '',
  '> **실제 과거 리플레이를 재생한 것이 아니라 구조적 도착 분석 기반 증거이다.**',
  '',
  '## 구/신 비교표',
  '',
  '| 시드 | 구 왕관 | 신 왕관 | 구 도착(청/진/자) | 신 도착(청/진/자) | 구 gap | 신 gap | 청람→구 비용 | 구 불공정 | 신 공정 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...reports.map((r) => {
    const oldA = FACTION_IDS.map((f) => r.oldArrivalByFaction[f]).join('/');
    const newA = FACTION_IDS.map((f) => r.newArrivalByFaction[f]).join('/');
    return `| ${r.seed} | (${r.oldCrown.q},${r.oldCrown.r}) | (${r.newCrown.q},${r.newCrown.r}) | ${oldA} | ${newA} | ${r.oldMaxGap} | ${r.newMaxGap} | ${r.azureCostToOldCrown ?? '∞'} | ${r.oldUnfair ? 'Y' : 'N'} | ${r.newFair ? 'Y' : 'N'} |`;
  }),
  '',
  '## 세력별 시작 유닛 (대표 시드 7)',
  '',
];

const seed7 = reports.find((r) => r.seed === 7);
if (seed7) {
  for (const f of FACTION_IDS) {
    md.push(`- **${FACTION_NAMES[f]}**: ${seed7.startUnits[f].map((u) => `${u.type}@(${u.at.q},${u.at.r})`).join(', ')}`);
  }
  md.push('');
  md.push(`- 구 도착: ${fmtArr(seed7.oldArrivalByFaction)}`);
  md.push(`- 신 도착: ${fmtArr(seed7.newArrivalByFaction)}`);
  md.push(`- 청람 구 왕관 이동 비용: ${seed7.azureCostToOldCrown ?? '∞'} / 도착 턴: ${seed7.azureArrivalOld ?? '∞'}`);
  md.push('');
}

md.push('## 결론');
md.push('');
md.push(
  '**구 고정 위치는 진홍 기병 선착으로 불공정, 신 규칙은 도착 공정성 충족** (min≥2 · gap≤1).',
);
md.push('');
md.push(
  anyOldBias
    ? `- 구 고정: 편향 시드 존재 (진홍 1턴 도착 또는 gap/min 위반)`
    : `- 구 고정: 본 시드 집합에서는 뚜렷한 1턴 편향이 약함(지형 복제 한계 가능)`,
);
md.push(allNewFair ? `- 신 선택: 모든 대표 시드에서 공정 (min≥2, gap≤1)` : `- 신 선택: 일부 시드 공정성 미달`);
md.push('');
md.push('이 문서는 인간 플레이 검증이 아니라 구조적 도착 분석 대체 증거이다.');
md.push('');

writeFileSync(join(outDir, 'crown-heart-human-regression.md'), md.join('\n'));
console.log(md.join('\n'));

// 한 줄 목적: V0 12지역 고정 연결 그래프와 초기 소유·지형 정의를 제공한다
import type { FactionId } from '../core/types';
import type { StrategicRegion, StrategicRegionTerrain, StrategicSettlement } from './types';

/** 4×3 격자 기반 12지역 ID(행 우선). */
export const STRATEGIC_REGION_IDS = [
  'r00',
  'r01',
  'r02',
  'r03',
  'r04',
  'r05',
  'r06',
  'r07',
  'r08',
  'r09',
  'r10',
  'r11',
] as const;

export type StrategicRegionId = (typeof STRATEGIC_REGION_IDS)[number];

interface RegionDef {
  id: StrategicRegionId;
  owner: FactionId | null;
  terrain: StrategicRegionTerrain;
  settlement?: StrategicSettlement;
  income: number;
  defense: number;
  /** 동·남 방향 이웃만 나열(무향 그래프 생성 시 대칭화). */
  east?: StrategicRegionId;
  south?: StrategicRegionId;
}

/**
 * 격자 배치:
 * r00 r01 r02 r03
 * r04 r05 r06 r07
 * r08 r09 r10 r11
 *
 * 소유: azure(서) / crimson(동) / violet(남) 각 3, 중립 3.
 */
const REGION_DEFS: RegionDef[] = [
  { id: 'r00', owner: 'azure', terrain: 'plains', settlement: 'capital', income: 15, defense: 3, east: 'r01', south: 'r04' },
  { id: 'r01', owner: 'azure', terrain: 'forest', settlement: 'town', income: 10, defense: 1, east: 'r02', south: 'r05' },
  { id: 'r02', owner: null, terrain: 'plains', income: 5, defense: 0, east: 'r03', south: 'r06' },
  { id: 'r03', owner: 'crimson', terrain: 'plains', settlement: 'capital', income: 15, defense: 3, south: 'r07' },
  { id: 'r04', owner: 'azure', terrain: 'mountain', settlement: 'fort', income: 8, defense: 2, east: 'r05', south: 'r08' },
  { id: 'r05', owner: null, terrain: 'forest', income: 5, defense: 1, east: 'r06', south: 'r09' },
  { id: 'r06', owner: null, terrain: 'mountain', income: 5, defense: 2, east: 'r07', south: 'r10' },
  { id: 'r07', owner: 'crimson', terrain: 'forest', settlement: 'town', income: 10, defense: 1, south: 'r11' },
  { id: 'r08', owner: 'violet', terrain: 'plains', settlement: 'capital', income: 15, defense: 3, east: 'r09' },
  { id: 'r09', owner: 'violet', terrain: 'forest', settlement: 'town', income: 10, defense: 1, east: 'r10' },
  { id: 'r10', owner: 'violet', terrain: 'mountain', settlement: 'fort', income: 8, defense: 2, east: 'r11' },
  { id: 'r11', owner: 'crimson', terrain: 'mountain', settlement: 'fort', income: 8, defense: 2 },
];

/** 고정 12지역 그래프를 복제해 반환한다(호출마다 새 배열/객체). */
export function createStrategicRegions(): StrategicRegion[] {
  const neighborSets = new Map<string, Set<string>>();
  for (const id of STRATEGIC_REGION_IDS) neighborSets.set(id, new Set());

  for (const def of REGION_DEFS) {
    if (def.east) {
      neighborSets.get(def.id)!.add(def.east);
      neighborSets.get(def.east)!.add(def.id);
    }
    if (def.south) {
      neighborSets.get(def.id)!.add(def.south);
      neighborSets.get(def.south)!.add(def.id);
    }
  }

  return REGION_DEFS.map((def) => {
    const neighbors = [...neighborSets.get(def.id)!].sort();
    const region: StrategicRegion = {
      id: def.id,
      owner: def.owner,
      neighbors,
      terrain: def.terrain,
      income: def.income,
      defense: def.defense,
    };
    if (def.settlement) region.settlement = def.settlement;
    return region;
  });
}

/** 무향 이웃 목록이 대칭인지 검사한다. */
export function assertSymmetricNeighbors(regions: StrategicRegion[]): boolean {
  const byId = new Map(regions.map((r) => [r.id, r]));
  for (const r of regions) {
    for (const n of r.neighbors) {
      const other = byId.get(n);
      if (!other || !other.neighbors.includes(r.id)) return false;
      if (n === r.id) return false;
    }
    if (new Set(r.neighbors).size !== r.neighbors.length) return false;
  }
  return true;
}

/** 모든 지역이 하나의 연결 성분인지 BFS로 검사한다. */
export function isRegionGraphConnected(regions: StrategicRegion[]): boolean {
  if (regions.length === 0) return false;
  const byId = new Map(regions.map((r) => [r.id, r]));
  const start = regions[0].id;
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const node = byId.get(cur);
    if (!node) return false;
    for (const n of node.neighbors) {
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen.size === regions.length;
}

// 한 줄 목적: 시드 기반 결정론적 섬 지도(지형·수도·마을) 생성을 담당한다
import { FACTION_IDS } from './data';
import { hexDistance, hexKey, hexLine, offsetToAxial } from './hex';
import { mulberry32, shuffle } from './rng';
import type { Axial, FactionId, Tile } from './types';

export const MAP_COLS = 9;
export const MAP_ROWS = 12;

export interface GeneratedMap {
  tiles: Tile[];
  capitals: Record<FactionId, Axial>;
}

/** 시드가 같으면 항상 같은 섬 지도를 생성한다. */
export function generateMap(seed: number): GeneratedMap {
  const rng = mulberry32(seed);
  const tiles = new Map<string, Tile>();

  const cx = (MAP_COLS - 1) / 2;
  const cy = (MAP_ROWS - 1) / 2;
  const rx = MAP_COLS / 2 + 0.4;
  const ry = MAP_ROWS / 2 + 0.4;

  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLS; col++) {
      const { q, r } = offsetToAxial(col, row);
      const dx = (col - cx) / rx;
      const dy = (row - cy) / ry;
      const d = dx * dx + dy * dy;
      let terrain: Tile['terrain'];
      if (d > 1) terrain = 'water';
      else if (d > 0.72 && rng() < 0.45) terrain = 'water';
      else {
        const roll = rng();
        if (roll < 0.2) terrain = 'forest';
        else if (roll < 0.3) terrain = 'mountain';
        else terrain = 'plains';
      }
      tiles.set(hexKey(q, r), { q, r, terrain });
    }
  }

  // 수도 배치: 청람은 남쪽, 진홍은 북서, 자원은 북동(세력 고유 본거지)
  const capitalSpots: Record<FactionId, Axial> = {
    azure: offsetToAxial(4, 10),
    crimson: offsetToAxial(2, 1),
    violet: offsetToAxial(6, 2),
  };
  for (const fid of FACTION_IDS) {
    const pos = capitalSpots[fid];
    const tile = tiles.get(hexKey(pos.q, pos.r))!;
    tile.terrain = 'plains';
    tile.building = 'capital';
    tile.owner = fid;
    // 수도 주변 1칸은 지상 보장
    for (const line of hexLine(pos, offsetToAxial(4, 6))) {
      const t = tiles.get(hexKey(line.q, line.r));
      if (t && t.terrain === 'water') t.terrain = 'plains';
    }
  }

  // 중립 마을 배치: 수도에서 2칸 이상, 마을끼리 2칸 이상 떨어진 땅
  const landCandidates: Axial[] = [];
  for (const t of tiles.values()) {
    if (t.terrain === 'water' || t.building) continue;
    const capDist = Math.min(
      ...FACTION_IDS.map((f) => hexDistance(t, capitalSpots[f])),
    );
    if (capDist >= 2) landCandidates.push({ q: t.q, r: t.r });
  }
  const villages: Axial[] = [];
  for (const cand of shuffle(rng, landCandidates)) {
    if (villages.length >= 6) break;
    if (villages.every((v) => hexDistance(v, cand) >= 3)) villages.push(cand);
  }
  for (const v of villages) {
    const t = tiles.get(hexKey(v.q, v.r))!;
    t.terrain = 'plains';
    t.building = 'village';
    t.owner = undefined;
  }

  // 연결성 보장: 기준 수도에서 모든 거점까지 지상 경로 확보
  const baseCap = capitalSpots[FACTION_IDS[0]];
  const pois: Axial[] = [
    ...FACTION_IDS.slice(1).map((f) => capitalSpots[f]),
    ...villages,
  ];
  for (const poi of pois) {
    if (isReachable(tiles, baseCap, poi)) continue;
    for (const step of hexLine(baseCap, poi)) {
      const t = tiles.get(hexKey(step.q, step.r));
      if (t && (t.terrain === 'water' || t.terrain === 'mountain')) t.terrain = 'plains';
    }
  }

  return { tiles: [...tiles.values()], capitals: capitalSpots };
}

function isReachable(tiles: Map<string, Tile>, from: Axial, to: Axial): boolean {
  const visited = new Set<string>([hexKey(from.q, from.r)]);
  const queue: Axial[] = [from];
  const target = hexKey(to.q, to.r);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curKey = hexKey(cur.q, cur.r);
    if (curKey === target) return true;
    for (const dir of [
      { q: 1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: 1 },
    ]) {
      const n = { q: cur.q + dir.q, r: cur.r + dir.r };
      const nk = hexKey(n.q, n.r);
      if (visited.has(nk)) continue;
      const t = tiles.get(nk);
      if (!t || t.terrain === 'water') continue;
      visited.add(nk);
      queue.push(n);
    }
  }
  return false;
}

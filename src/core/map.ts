// 한 줄 목적: 시드 기반 결정론적 시나리오 지도 생성과 자동 검증·재생성·fallback을 담당한다
import { FACTION_IDS } from './data';
import { hexDistance, hexesInRange, hexKey, hexLine, offsetToAxial } from './hex';
import { mulberry32, shuffle, type Rng } from './rng';
import { analyzeObjectiveArrival } from './scenario/arrival';
import type { Axial, FactionId, BuiltinScenarioId, Tile } from './types';

export const MAP_COLS = 9;
export const MAP_ROWS = 12;

export interface GeneratedMap {
  tiles: Tile[];
  capitals: Record<FactionId, Axial>;
  /** 왕관의 심장 시나리오의 중앙 요새 위치 */
  crown?: Axial;
}

/** 세력 고유 본거지: 청람 남쪽, 진홍 북서, 자원 북동. 세 수도가 서로 등거리(8)가 되도록 배치한다 */
function capitalSpots(): Record<FactionId, Axial> {
  return {
    azure: offsetToAxial(4, 10),
    crimson: offsetToAxial(0, 2),
    violet: offsetToAxial(8, 2),
  };
}

/** 타원형 섬 기본 지형을 생성한다. */
function baseIsland(rng: Rng): Map<string, Tile> {
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
  return tiles;
}

function placeCapitals(tiles: Map<string, Tile>): Record<FactionId, Axial> {
  const spots = capitalSpots();
  const center = offsetToAxial(4, 6);
  for (const fid of FACTION_IDS) {
    const pos = spots[fid];
    const tile = tiles.get(hexKey(pos.q, pos.r))!;
    tile.terrain = 'plains';
    tile.building = 'capital';
    tile.owner = fid;
    // 수도에서 중앙 방향 직선은 지상 보장
    for (const line of hexLine(pos, center)) {
      const t = tiles.get(hexKey(line.q, line.r));
      if (t && t.terrain === 'water') t.terrain = 'plains';
    }
  }
  return spots;
}

function placeVillages(
  tiles: Map<string, Tile>,
  rng: Rng,
  capitals: Record<FactionId, Axial>,
  count: number,
  avoid?: Axial,
): Axial[] {
  const landCandidates: Axial[] = [];
  for (const t of tiles.values()) {
    if (t.terrain === 'water' || t.building) continue;
    const capDist = Math.min(...FACTION_IDS.map((f) => hexDistance(t, capitals[f])));
    if (capDist < 2) continue;
    if (avoid && hexDistance(t, avoid) < 2) continue;
    landCandidates.push({ q: t.q, r: t.r });
  }
  const villages: Axial[] = [];
  for (const cand of shuffle(rng, landCandidates)) {
    if (villages.length >= count) break;
    if (villages.every((v) => hexDistance(v, cand) >= 3)) villages.push(cand);
  }
  for (const v of villages) {
    const t = tiles.get(hexKey(v.q, v.r))!;
    t.terrain = 'plains';
    t.building = 'village';
    t.owner = undefined;
  }
  return villages;
}

/** 기준 지점에서 모든 거점까지 지상 경로를 보장한다(막히면 직선 경로를 육지로 개통). */
function ensureConnectivity(tiles: Map<string, Tile>, from: Axial, pois: Axial[]): void {
  for (const poi of pois) {
    if (isReachable(tiles, from, poi)) continue;
    for (const step of hexLine(from, poi)) {
      const t = tiles.get(hexKey(step.q, step.r));
      if (t && (t.terrain === 'water' || t.terrain === 'mountain')) t.terrain = 'plains';
    }
  }
}

function isReachable(tiles: Map<string, Tile>, from: Axial, to: Axial): boolean {
  const visited = new Set<string>([hexKey(from.q, from.r)]);
  const queue: Axial[] = [from];
  const target = hexKey(to.q, to.r);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (hexKey(cur.q, cur.r) === target) return true;
    for (const dir of HEX_DIRS) {
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

const HEX_DIRS: Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

// ---------------- 시나리오별 생성기 ----------------

/** 시나리오 1 — 세 왕관 전쟁: 표준 섬 */
function genThreeCrowns(seed: number): GeneratedMap {
  const rng = mulberry32(seed);
  const tiles = baseIsland(rng);
  const capitals = placeCapitals(tiles);
  const villages = placeVillages(tiles, rng, capitals, 6);
  finishConnectivity(tiles, capitals, villages);
  return { tiles: [...tiles.values()], capitals };
}

/** 시나리오 2 — 갈라진 해협: 중앙 해협이 섬을 남북으로 가르고 좁은 육교 2개로 연결된다 */
function genBrokenStrait(seed: number): GeneratedMap {
  const rng = mulberry32(seed);
  const tiles = baseIsland(rng);
  // 중앙 두 줄을 바다로 만든다
  const straitRows = [5, 6];
  for (const row of straitRows) {
    for (let col = 0; col < MAP_COLS; col++) {
      const { q, r } = offsetToAxial(col, row);
      const t = tiles.get(hexKey(q, r));
      if (t) t.terrain = 'water';
    }
  }
  // 좁은 육교 2개(서쪽·동쪽)를 개통한다
  const westCol = 1 + Math.floor(rng() * 2); // 1~2
  const eastCol = 6 + Math.floor(rng() * 2); // 6~7
  for (const col of [westCol, eastCol]) {
    for (const row of straitRows) {
      const { q, r } = offsetToAxial(col, row);
      const t = tiles.get(hexKey(q, r));
      if (t) t.terrain = 'plains';
    }
  }
  const capitals = placeCapitals(tiles);
  // 육교 입구는 가치 있는 거점: 각 육교 남단에 마을 배치
  const bridgeVillages: Axial[] = [];
  for (const col of [westCol, eastCol]) {
    const pos = offsetToAxial(col, 6);
    const t = tiles.get(hexKey(pos.q, pos.r));
    if (t && !t.building) {
      t.terrain = 'plains';
      t.building = 'village';
      t.owner = undefined;
      bridgeVillages.push(pos);
    }
  }
  const villages = placeVillages(tiles, rng, capitals, 4);
  finishConnectivity(tiles, capitals, [...bridgeVillages, ...villages]);
  return { tiles: [...tiles.values()], capitals };
}

/** 후보 맵에 왕관을 배치하고 인접 물을 평원으로 개통한다. */
function applyCrownAt(tiles: Map<string, Tile>, crown: Axial): void {
  const crownTile = tiles.get(hexKey(crown.q, crown.r))!;
  crownTile.terrain = 'plains';
  crownTile.building = 'crown';
  crownTile.owner = undefined;
  for (const dir of HEX_DIRS) {
    const t = tiles.get(hexKey(crown.q + dir.q, crown.r + dir.r));
    if (t && t.terrain === 'water') t.terrain = 'plains';
  }
}

/** 타일 맵을 얕은 복제한다(후보 평가용). */
function cloneTileMap(tiles: Map<string, Tile>): Map<string, Tile> {
  const out = new Map<string, Tile>();
  for (const [k, t] of tiles) out.set(k, { ...t });
  return out;
}

/** 시나리오 3 — 왕관의 심장: 중앙 후보 중 도착 공정성을 만족하는 왕관 위치를 고른다 */
function genCrownHeart(seed: number): GeneratedMap {
  const rng = mulberry32(seed);
  const tiles = baseIsland(rng);
  const capitals = placeCapitals(tiles);
  const center = offsetToAxial(4, 6);

  type CrownCandidate = {
    cand: Axial;
    maxGap: number;
    minEarliest: number;
    distCenter: number;
    passableAdj: number;
  };
  const candidates: CrownCandidate[] = [];
  for (const cand of hexesInRange(center, 2)) {
    const base = tiles.get(hexKey(cand.q, cand.r));
    if (!base || base.building === 'capital' || base.building === 'village') continue;
    const trial = cloneTileMap(tiles);
    applyCrownAt(trial, cand);
    const trialMap: GeneratedMap = {
      tiles: [...trial.values()],
      capitals,
      crown: cand,
    };
    const rep = analyzeObjectiveArrival(trialMap, cand);
    const earliest = FACTION_IDS.map((f) => rep.earliestByFaction[f]);
    if (!earliest.every((n) => Number.isFinite(n))) continue;
    const minEarliest = Math.min(...earliest);
    if (minEarliest < 2 || rep.maxGap > 1) continue;
    let passableAdj = 0;
    for (const dir of HEX_DIRS) {
      const t = trial.get(hexKey(cand.q + dir.q, cand.r + dir.r));
      if (t && t.terrain !== 'water') passableAdj++;
    }
    candidates.push({
      cand,
      maxGap: rep.maxGap,
      minEarliest,
      distCenter: hexDistance(cand, center),
      passableAdj,
    });
  }

  candidates.sort((a, b) => {
    if (a.maxGap !== b.maxGap) return a.maxGap - b.maxGap;
    if (a.minEarliest !== b.minEarliest) return b.minEarliest - a.minEarliest;
    if (a.distCenter !== b.distCenter) return a.distCenter - b.distCenter;
    if (a.passableAdj !== b.passableAdj) return b.passableAdj - a.passableAdj;
    if (a.cand.q !== b.cand.q) return a.cand.q - b.cand.q;
    return a.cand.r - b.cand.r;
  });

  // 유효 후보가 없으면 중앙 배치(검증 실패 시 상위 repair·static fallback이 이어진다)
  const crown = candidates[0]?.cand ?? center;
  applyCrownAt(tiles, crown);
  const villages = placeVillages(tiles, rng, capitals, 4, crown);
  finishConnectivity(tiles, capitals, [crown, ...villages]);
  return { tiles: [...tiles.values()], capitals, crown };
}

function finishConnectivity(
  tiles: Map<string, Tile>,
  capitals: Record<FactionId, Axial>,
  extraPois: Axial[],
): void {
  const base = capitals[FACTION_IDS[0]];
  const pois = [...FACTION_IDS.slice(1).map((f) => capitals[f]), ...extraPois];
  ensureConnectivity(tiles, base, pois);
}

// ---------------- 검증·재생성 ----------------

/** 지도 구조 결함 목록을 반환한다. 비어 있으면 유효한 지도다. */
export function validateMap(map: GeneratedMap): string[] {
  const issues: string[] = [];
  const byKey = new Map(map.tiles.map((t) => [hexKey(t.q, t.r), t]));
  const buildings = map.tiles.filter((t) => t.building);
  // 거점 좌표 중복 없음(같은 타일에 두 건물이 있을 수는 없지만 방어적으로 검사)
  const buildingKeys = new Set(buildings.map((t) => hexKey(t.q, t.r)));
  if (buildingKeys.size !== buildings.length) issues.push('duplicate-building');

  for (const fid of FACTION_IDS) {
    const cap = map.capitals[fid];
    const capTile = byKey.get(hexKey(cap.q, cap.r));
    if (!capTile || capTile.terrain === 'water') issues.push(`capital-on-water:${fid}`);
    if (capTile?.building !== 'capital' || capTile.owner !== fid)
      issues.push(`capital-missing:${fid}`);
    // 시작 유닛 배치 가능: 지상 이웃 2칸 이상
    const landNeighbors = HEX_DIRS.filter((d) => {
      const t = byKey.get(hexKey(cap.q + d.q, cap.r + d.r));
      return t && t.terrain !== 'water';
    }).length;
    if (landNeighbors < 2) issues.push(`capital-cramped:${fid}`);
  }

  // 모든 거점이 기준 수도에서 지상 경로로 연결
  const base = map.capitals[FACTION_IDS[0]];
  for (const b of buildings) {
    if (!isReachable(byKey, base, b)) issues.push(`unreachable:${b.q},${b.r}`);
  }

  // 공정성: 왕관 요새까지 세력별 실제 도착 턴(1턴 점령 불가·격차 1 이하)
  if (map.crown) {
    const rep = analyzeObjectiveArrival(map, map.crown);
    const earliest = FACTION_IDS.map((f) => rep.earliestByFaction[f]);
    if (earliest.some((n) => !Number.isFinite(n))) issues.push('crown-unreachable');
    else {
      const minEarliest = Math.min(...earliest);
      if (minEarliest < 2) issues.push('crown-turn1');
      if (rep.maxGap > 1) issues.push('crown-arrival-unfair');
    }
  }
  // 공정성: 가장 가까운 마을 거리 격차 4 이하
  const villages = buildings.filter((t) => t.building === 'village');
  if (villages.length > 0) {
    const nearest = FACTION_IDS.map((f) =>
      Math.min(...villages.map((v) => hexDistance(map.capitals[f], v))),
    );
    if (Math.max(...nearest) - Math.min(...nearest) > 4) issues.push('village-unfair');
  }
  return issues;
}

const GENERATORS: Record<BuiltinScenarioId, (seed: number) => GeneratedMap> = {
  'three-crowns': genThreeCrowns,
  'broken-strait': genBrokenStrait,
  'crown-heart': genCrownHeart,
};

const MAX_ATTEMPTS = 8;

/** 마지막 후보 지도를 결정론적으로 수리한다(수도 주변 개간 + 전체 연결 개통). */
function repairMap(map: GeneratedMap): void {
  const byKey = new Map(map.tiles.map((t) => [hexKey(t.q, t.r), t]));
  for (const fid of FACTION_IDS) {
    const cap = map.capitals[fid];
    for (const dir of HEX_DIRS) {
      const t = byKey.get(hexKey(cap.q + dir.q, cap.r + dir.r));
      if (t && t.terrain === 'water') t.terrain = 'plains';
    }
  }
  const base = map.capitals[FACTION_IDS[0]];
  ensureConnectivity(byKey, base, map.tiles.filter((t) => t.building));
}

/** 최후의 검증된 정적 fallback: 전체 평원 지도에 정규 위치의 수도·마을(·왕관)을 놓는다. */
function staticFallbackMap(scenario: BuiltinScenarioId): GeneratedMap {
  const tiles = new Map<string, Tile>();
  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLS; col++) {
      const { q, r } = offsetToAxial(col, row);
      tiles.set(hexKey(q, r), { q, r, terrain: 'plains' });
    }
  }
  const capitals = placeCapitals(tiles);
  for (const [col, row] of [
    [4, 8],
    [2, 3],
    [6, 3],
  ]) {
    const p = offsetToAxial(col, row);
    const t = tiles.get(hexKey(p.q, p.r))!;
    if (!t.building) {
      t.building = 'village';
      t.owner = undefined;
    }
  }
  let crown: Axial | undefined;
  if (scenario === 'crown-heart') {
    // 전평원에서 중앙(4,6)이 min>=2·gap<=1 을 만족한다
    crown = offsetToAxial(4, 6);
    const t = tiles.get(hexKey(crown.q, crown.r))!;
    t.building = 'crown';
    t.owner = undefined;
  }
  return { tiles: [...tiles.values()], capitals, crown };
}

/**
 * 시나리오 지도를 생성한다. 생성 → 검증 → 제한 재생성 → 결정론적 수리 → 재검증 →
 * 검증된 정적 fallback → 그래도 실패하면 명시적 오류. 검증되지 않은 지도는 반환하지 않는다.
 */
export function generateScenarioMap(scenario: BuiltinScenarioId, seed: number): GeneratedMap {
  const gen = GENERATORS[scenario];
  let last: GeneratedMap | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const derived = attempt === 0 ? seed : (seed + attempt * 2654435761) >>> 0;
    const map = gen(derived);
    last = map;
    if (validateMap(map).length === 0) return map;
  }
  const map = last!;
  repairMap(map);
  if (validateMap(map).length === 0) return map;
  const fallback = staticFallbackMap(scenario);
  const issues = validateMap(fallback);
  if (issues.length === 0) return fallback;
  throw new Error(`지도 생성 실패(${scenario}): ${issues.join(', ')}`);
}

/** 기본(세 왕관 전쟁) 지도 생성 — 기존 호출부 호환용. */
export function generateMap(seed: number): GeneratedMap {
  return generateScenarioMap('three-crowns', seed);
}

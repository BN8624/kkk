// 한 줄 목적: 지형 비용을 반영한 이동 가능 범위 계산과 경로 복원을 제공한다
import { UNIT_STATS } from './data';
import { hexKey, neighbors } from './hex';
import type { Axial, GameState, Tile, Unit } from './types';
import { movementCostForUnit } from './units';

export interface ReachEntry {
  q: number;
  r: number;
  cost: number;
  prev: string | null;
}

/** 유닛이 이번 턴에 도달할 수 있는 모든 타일을 다익스트라로 계산한다. */
export function movementRange(state: GameState, unit: Unit): Map<string, ReachEntry> {
  const stats = UNIT_STATS[unit.type];
  const tiles = new Map<string, Tile>();
  for (const t of state.tiles) tiles.set(hexKey(t.q, t.r), t);
  const occupied = new Map<string, Unit>();
  for (const u of state.units) {
    if (u.id !== unit.id) occupied.set(hexKey(u.q, u.r), u);
  }

  const start = hexKey(unit.q, unit.r);
  const reach = new Map<string, ReachEntry>();
  reach.set(start, { q: unit.q, r: unit.r, cost: 0, prev: null });
  const frontier: string[] = [start];

  while (frontier.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < frontier.length; i++) {
      if (reach.get(frontier[i])!.cost < reach.get(frontier[bestIdx])!.cost) bestIdx = i;
    }
    const currentKey = frontier.splice(bestIdx, 1)[0];
    const current = reach.get(currentKey)!;

    for (const n of neighbors({ q: current.q, r: current.r })) {
      const nk = hexKey(n.q, n.r);
      const tile = tiles.get(nk);
      if (!tile) continue;
      const enterCost = movementCostForUnit(unit.type, tile.terrain);
      if (!Number.isFinite(enterCost)) continue;
      const occ = occupied.get(nk);
      if (occ && occ.faction !== unit.faction) continue; // 적 유닛 통과 불가
      const nextCost = current.cost + enterCost;
      if (nextCost > stats.move) continue;
      const existing = reach.get(nk);
      if (existing && existing.cost <= nextCost) continue;
      reach.set(nk, { q: n.q, r: n.r, cost: nextCost, prev: currentKey });
      frontier.push(nk);
    }
  }
  return reach;
}

/** 정지 가능한(빈 타일) 목적지 목록을 반환한다. 현재 위치는 제외한다. */
export function reachableDestinations(state: GameState, unit: Unit): ReachEntry[] {
  const reach = movementRange(state, unit);
  const out: ReachEntry[] = [];
  for (const [key, entry] of reach) {
    if (key === hexKey(unit.q, unit.r)) continue;
    const occ = state.units.find((u) => u.q === entry.q && u.r === entry.r && u.id !== unit.id);
    if (occ) continue; // 아군 통과는 가능하지만 정지 불가
    out.push(entry);
  }
  return out;
}

/** movementRange 결과에서 목적지까지의 경로를 복원한다(출발지 포함). */
export function reconstructPath(
  reach: Map<string, ReachEntry>,
  dest: Axial,
): Axial[] | null {
  let key: string | null = hexKey(dest.q, dest.r);
  if (!reach.has(key)) return null;
  const path: Axial[] = [];
  while (key) {
    const e: ReachEntry = reach.get(key)!;
    path.push({ q: e.q, r: e.r });
    key = e.prev;
  }
  path.reverse();
  return path;
}

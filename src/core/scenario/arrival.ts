// 한 줄 목적: 정본 지형 이동 비용을 재사용해 세력별 목표 타일 실제 최초 도착 턴을 계산한다
import { FACTION_IDS, TERRAIN_RULES, UNIT_STATS } from '../data';
import { HEX_DIRS, hexKey } from '../hex';
import type { GeneratedMap } from '../map';
import type { Axial, FactionId, Tile, UnitTypeId } from '../types';
import { startUnitPlacements } from './builtin';

/** 다턴 최단 도착 결과. turns는 목표 타일에 처음 서는 이동 턴(첫 이동 페이즈 도달=1). */
interface ArrivalResult {
  turns: number;
  cost: number;
  path: Axial[];
}

interface Label {
  turns: number;
  used: number;
  prev: string | null;
}

/**
 * 시작 타일에서 목표 타일까지 실제 지형 이동 비용을 반영한 최소 이동 턴을 계산한다.
 *
 * - 정본 TERRAIN_RULES 비용을 그대로 재사용한다(평원 1·숲 2·산 3·물 불가).
 * - 매 턴 이동력 예산을 초과할 수 없고, 부족하면 다음 턴으로 넘어간다(잔여 예산 이월 없음).
 * - 한 턴 예산으로도 진입 불가한 지형(예: 궁병 move 2 < 산 3)은 통과하지 않는다.
 *
 * 라벨 (turns, used)에 대한 지배 관계로 타일당 하나의 최적 라벨만 유지한다:
 * turns가 작을수록, 같은 turns면 used(현재 턴 소비)가 작을수록 우월하다.
 */
export function earliestArrival(
  tiles: Map<string, Tile>,
  start: Axial,
  target: Axial,
  move: number,
): ArrivalResult | null {
  const startKey = hexKey(start.q, start.r);
  const targetKey = hexKey(target.q, target.r);
  if (!tiles.has(startKey) || !tiles.has(targetKey)) return null;

  const best = new Map<string, Label>();
  best.set(startKey, { turns: 1, used: 0, prev: null });
  const frontier = new Set<string>([startKey]);
  // used는 항상 move(<=5) 이하이므로 1000 배수면 turns가 항상 상위 정렬 기준이 된다
  const rank = (l: Label): number => l.turns * 1000 + l.used;

  while (frontier.size > 0) {
    let curKey: string | null = null;
    let curRank = Infinity;
    for (const k of frontier) {
      const r = rank(best.get(k)!);
      if (r < curRank) {
        curRank = r;
        curKey = k;
      }
    }
    frontier.delete(curKey!);
    const cur = best.get(curKey!)!;
    const [cq, cr] = curKey!.split(',').map(Number);

    for (const d of HEX_DIRS) {
      const nk = hexKey(cq + d.q, cr + d.r);
      const tile = tiles.get(nk);
      if (!tile) continue;
      const cost = TERRAIN_RULES[tile.terrain].cost;
      if (!Number.isFinite(cost)) continue; // 물: 진입 불가
      if (cost > move) continue; // 한 턴 예산으로도 진입 불가

      let turns = cur.turns;
      let used = cur.used + cost;
      if (used > move) {
        turns = cur.turns + 1;
        used = cost;
      }
      const cand: Label = { turns, used, prev: curKey };
      const existing = best.get(nk);
      if (existing && rank(existing) <= rank(cand)) continue;
      best.set(nk, cand);
      frontier.add(nk);
    }
  }

  const goal = best.get(targetKey);
  if (!goal) return null;

  const path: Axial[] = [];
  let key: string | null = targetKey;
  let totalCost = 0;
  while (key) {
    const [q, r] = key.split(',').map(Number);
    path.push({ q, r });
    const lbl: Label = best.get(key)!;
    if (lbl.prev) totalCost += TERRAIN_RULES[tiles.get(key)!.terrain].cost;
    key = lbl.prev;
  }
  path.reverse();
  return { turns: goal.turns, cost: totalCost, path };
}

/** 시작 유닛 한 기의 목표 도착 분석(섹션 6 ObjectiveArrivalAnalysis 대응). */
export interface UnitArrival {
  faction: FactionId;
  unitType: UnitTypeId;
  start: Axial;
  /** 경로 지형 이동 비용 합. 도달 불가면 Infinity. */
  movementCost: number;
  /** 실제 최초 도착 가능 턴. 도달 불가면 Infinity. */
  earliestArrivalTurn: number;
  path: Axial[];
}

/** 목표 타일에 대한 세력별 최초 도착 분석 종합. */
export interface ObjectiveArrivalReport {
  target: Axial;
  perUnit: UnitArrival[];
  /** 세력별 가장 빠른 유닛(도달 불가면 null). */
  perFaction: Record<FactionId, UnitArrival | null>;
  /** 세력별 최초 도착 턴(도달 불가면 Infinity). */
  earliestByFaction: Record<FactionId, number>;
  /** 유한 도착 턴들의 최대-최소 격차(모두 불가면 Infinity). */
  maxGap: number;
}

/**
 * 지도의 시작 유닛 배치를 기준으로 목표 타일까지 세력별 실제 최초 도착 턴을 분석한다.
 * 단순 거리÷이동력이 아니라 지형 비용과 병과 이동력을 반영한다.
 */
export function analyzeObjectiveArrival(map: GeneratedMap, target: Axial): ObjectiveArrivalReport {
  const tiles = new Map(map.tiles.map((t) => [hexKey(t.q, t.r), t]));
  const perUnit: UnitArrival[] = startUnitPlacements(map).map((p) => {
    const res = earliestArrival(tiles, p.at, target, UNIT_STATS[p.type].move);
    return {
      faction: p.faction,
      unitType: p.type,
      start: p.at,
      movementCost: res?.cost ?? Infinity,
      earliestArrivalTurn: res?.turns ?? Infinity,
      path: res?.path ?? [],
    };
  });

  const perFaction = {} as Record<FactionId, UnitArrival | null>;
  const earliestByFaction = {} as Record<FactionId, number>;
  for (const fid of FACTION_IDS) {
    let best: UnitArrival | null = null;
    for (const u of perUnit) {
      if (u.faction !== fid) continue;
      if (!best || u.earliestArrivalTurn < best.earliestArrivalTurn) best = u;
    }
    perFaction[fid] = best;
    earliestByFaction[fid] = best ? best.earliestArrivalTurn : Infinity;
  }

  const finite = FACTION_IDS.map((f) => earliestByFaction[f]).filter((n) => Number.isFinite(n));
  const maxGap =
    finite.length > 0 ? Math.max(...finite) - Math.min(...finite) : Number.POSITIVE_INFINITY;

  return { target, perUnit, perFaction, earliestByFaction, maxGap };
}

// 한 줄 목적: 내장 절차적 시나리오를 검증된 런타임 스냅샷으로 변환한다(기존 newGame 배치와 동일)
import { FACTION_IDS, UNIT_STATS } from '../data';
import { DOCTRINES } from '../doctrines';
import { hexKey, neighbors } from '../hex';
import { generateScenarioMap, MAP_COLS, MAP_ROWS, type GeneratedMap } from '../map';
import { SCENARIOS } from '../scenarios';
import type { Axial, BuiltinScenarioId, FactionId, UnitTypeId } from '../types';
import type {
  DefeatCondition,
  GameObjectives,
  ScenarioRuntimeSnapshot,
  SnapshotUnit,
  VictoryCondition,
} from './types';

/** 시작 유닛 한 기의 배치(세력·병과·타일). 도착 분석과 스냅샷이 공유하는 단일 정본이다. */
export interface StartPlacement {
  faction: FactionId;
  type: UnitTypeId;
  at: Axial;
}

/**
 * 세력별 시작 유닛 배치를 결정한다(수도 인접 지상 타일 순서, 교리 시작 병과 순).
 * 지도 검증·UI·시뮬레이션·도착 분석이 서로 다른 배치를 쓰지 않도록 여기 하나로 모은다.
 */
export function startUnitPlacements(map: GeneratedMap): StartPlacement[] {
  const tileMap = new Map(map.tiles.map((t) => [hexKey(t.q, t.r), t]));
  const out: StartPlacement[] = [];
  const occupied = new Set<string>();
  for (const fid of FACTION_IDS) {
    const cap = map.capitals[fid];
    const spots = neighbors(cap).filter((n) => {
      const t = tileMap.get(hexKey(n.q, n.r));
      return t && t.terrain !== 'water' && !occupied.has(hexKey(n.q, n.r));
    });
    DOCTRINES[fid].startUnits.forEach((type, i) => {
      const spot = spots[i] ?? cap;
      occupied.add(hexKey(spot.q, spot.r));
      out.push({ faction: fid, type, at: spot });
    });
  }
  return out;
}

/**
 * 내장 시나리오의 런타임 스냅샷을 만든다. 같은 시드는 항상 같은 스냅샷을 만든다.
 * 시작 유닛 배치는 기존 newGame과 동일한 규칙(수도 인접 지상 타일 순서)이다.
 */
export function builtinScenarioSnapshot(
  id: BuiltinScenarioId,
  seed: number,
  humanFaction: FactionId,
): ScenarioRuntimeSnapshot {
  const def = SCENARIOS[id];
  const map = generateScenarioMap(id, seed);

  const units: SnapshotUnit[] = startUnitPlacements(map).map((p) => ({
    faction: p.faction,
    type: p.type,
    q: p.at.q,
    r: p.at.r,
    hp: UNIT_STATS[p.type].hp,
    canAct: true,
  }));

  const victory: VictoryCondition[] = [{ type: 'conquest' }];
  if (def.victory === 'crown-hold' && map.crown) {
    victory.push({
      type: 'hold-building',
      at: { q: map.crown.q, r: map.crown.r },
      turns: def.crownHoldTurns ?? 4,
    });
  }
  const defeat: DefeatCondition[] = [{ type: 'human-eliminated' }];

  return {
    schemaVersion: 1,
    id,
    title: def.name,
    generatedFromSeed: seed,
    board: { cols: MAP_COLS, rows: MAP_ROWS, tiles: map.tiles },
    factions: FACTION_IDS.map((fid) => ({
      id: fid,
      active: true,
      controller: fid === humanFaction ? ('human' as const) : ('ai' as const),
      startGold: DOCTRINES[fid].startGold,
      useDoctrine: true,
    })),
    units,
    rules: { maxTurns: def.maxTurns, turnLimit: 'score', doctrines: true },
    victoryConditions: victory,
    defeatConditions: defeat,
    starConditions: [],
  };
}

/** 스냅샷에서 게임 상태에 탑재할 목표 집합을 추출한다. */
export function objectivesFromSnapshot(s: ScenarioRuntimeSnapshot): GameObjectives {
  return {
    victory: s.victoryConditions,
    defeat: s.defeatConditions,
    stars: s.starConditions,
    turnLimit: s.rules.turnLimit,
  };
}

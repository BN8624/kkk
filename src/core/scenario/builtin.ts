// 한 줄 목적: 내장 절차적 시나리오를 검증된 런타임 스냅샷으로 변환한다(기존 newGame 배치와 동일)
import { FACTION_IDS, UNIT_STATS } from '../data';
import { DOCTRINES } from '../doctrines';
import { generateScenarioMap, MAP_COLS, MAP_ROWS } from '../map';
import { SCENARIOS } from '../scenarios';
import type { BuiltinScenarioId, FactionId } from '../types';
import { startUnitPlacements } from './placement';
import type {
  DefeatCondition,
  GameObjectives,
  ScenarioRuntimeSnapshot,
  SnapshotUnit,
  VictoryCondition,
} from './types';

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
      activationTurn: def.crownActivationTurn,
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
    rules: { maxTurns: def.maxTurns, turnLimit: 'score', doctrines: true, uniqueUnits: true },
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
    ...(s.rules.uniqueUnits !== undefined ? { uniqueUnits: s.rules.uniqueUnits } : {}),
  };
}

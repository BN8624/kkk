// 한 줄 목적: Strategic Layer V0의 순수 상태·명령·전투 브리지 타입을 정의한다
import type { ScenarioDocumentV1 } from '../core/scenario/types';
import type { FactionId, UnitTypeId } from '../core/types';

export type StrategicPhase = 'orders' | 'battle' | 'resolution' | 'ended';

export type StrategicRegionTerrain = 'plains' | 'forest' | 'mountain';

export type StrategicSettlement = 'capital' | 'town' | 'fort';

export interface StrategicUnit {
  id: string;
  type: UnitTypeId;
  hp: number;
}

export interface StrategicArmy {
  id: string;
  faction: FactionId;
  regionId: string;
  units: StrategicUnit[];
  moved: boolean;
}

export interface StrategicRegion {
  id: string;
  owner: FactionId | null;
  neighbors: string[];
  terrain: StrategicRegionTerrain;
  settlement?: StrategicSettlement;
  income: number;
  defense: number;
}

export interface TacticalUnitBinding {
  strategicUnitId: string;
  tacticalTag: string;
  armyId: string;
  faction: FactionId;
  type: UnitTypeId;
  startingHp: number;
}

export interface StrategicBattleContext {
  schemaVersion: 1;
  battleId: string;
  strategicTurn: number;
  battleSeed: number;
  regionId: string;
  attackerArmyId: string;
  defenderArmyId: string;
  attackerOriginRegionId: string;
  humanFaction: FactionId;
  unitBindings: TacticalUnitBinding[];
}

export interface StrategicGameState {
  schemaVersion: 1;
  seed: number;
  turn: number;
  maxTurns: 10;
  humanFaction: FactionId;
  currentFaction: FactionId;
  phase: StrategicPhase;
  regions: StrategicRegion[];
  armies: StrategicArmy[];
  treasury: Record<FactionId, number>;
  pendingBattle?: StrategicBattleContext;
  winner?: FactionId | 'draw';
}

export type StrategicOrder =
  | {
      type: 'move-army';
      armyId: string;
      toRegionId: string;
    }
  | {
      type: 'hold-army';
      armyId: string;
    }
  | {
      type: 'replenish-army';
      armyId: string;
    };

export interface TacticalBattleReport {
  schemaVersion: 1;
  battleId: string;
  winner: FactionId | 'draw';
  survivingUnits: {
    strategicUnitId: string;
    armyId: string;
    faction: FactionId;
    type: UnitTypeId;
    hp: number;
  }[];
  losses: {
    strategicUnitId: string;
    armyId: string;
    faction: FactionId;
    type: UnitTypeId;
  }[];
  retreatingArmyIds: string[];
  turns: number;
  scoreByFaction: Record<FactionId, number>;
}

export type StrategicResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

/** 전술 UI 진입 vs AI 자동 해결 필요 분류(Phase 8-0 fail-closed). */
export type StrategicBattlePreparation =
  | {
      kind: 'human-tactical';
      context: StrategicBattleContext;
      scenario: ScenarioDocumentV1;
    }
  | {
      kind: 'auto-resolve-required';
      context: StrategicBattleContext;
    };

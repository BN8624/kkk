// 한 줄 목적: 병종 정본 레지스트리와 로스터·특성 조회 공용 함수를 제공한다
import { TERRAIN_RULES } from './data';
import { DOCTRINES } from './doctrines';
import type {
  FactionId,
  GameState,
  TerrainId,
  UnitDefinition,
  UnitTrait,
  UnitTypeId,
} from './types';

export const UNIT_DEFS: Record<UnitTypeId, UnitDefinition> = {
  infantry: {
    id: 'infantry',
    hp: 12,
    atk: 5,
    def: 2,
    move: 3,
    range: 1,
    cost: 30,
    faction: null,
    traits: [],
  },
  archer: {
    id: 'archer',
    hp: 10,
    atk: 5,
    def: 0,
    move: 2,
    range: 2,
    cost: 35,
    faction: null,
    traits: [],
  },
  cavalry: {
    id: 'cavalry',
    hp: 14,
    atk: 7,
    def: 1,
    move: 5,
    range: 1,
    // 공용 기병 비중·정복 기동 확보: 비용 소폭 인하(시작 금 너프 없이 생산 유도)
    cost: 45,
    faction: null,
    traits: [],
  },
  guardian: {
    id: 'guardian',
    hp: 16,
    atk: 4,
    def: 4,
    move: 2,
    range: 1,
    cost: 48,
    faction: 'azure',
    traits: [{ type: 'brace', defenseBonus: 2 }],
  },
  raider: {
    id: 'raider',
    hp: 11,
    atk: 6,
    def: 0,
    move: 4,
    range: 1,
    cost: 42,
    faction: 'crimson',
    traits: [
      { type: 'terrain-mobility', forestCost: 1, mountainCost: 2 },
      { type: 'plunder', bonusGold: 5 },
    ],
  },
  crossbow: {
    id: 'crossbow',
    hp: 10,
    atk: 7,
    def: 0,
    move: 2,
    range: 2,
    cost: 50,
    faction: 'violet',
    traits: [{ type: 'armor-piercing', amount: 2 }],
  },
};

/** 공용 3개 먼저, 그 뒤 azure/crimson/violet 고유 순 */
export const UNIT_TYPE_IDS: UnitTypeId[] = [
  'infantry',
  'archer',
  'cavalry',
  'guardian',
  'raider',
  'crossbow',
];

export function unitDefinition(type: UnitTypeId): UnitDefinition {
  return UNIT_DEFS[type];
}

export function unitTraits(type: UnitTypeId): UnitTrait[] {
  return UNIT_DEFS[type].traits;
}

export function unitTrait<T extends UnitTrait['type']>(
  type: UnitTypeId,
  t: T,
): Extract<UnitTrait, { type: T }> | undefined {
  return unitTraits(type).find((tr): tr is Extract<UnitTrait, { type: T }> => tr.type === t);
}

export function isUniqueUnit(type: UnitTypeId): boolean {
  return UNIT_DEFS[type].faction !== null;
}

export function canFactionUseUnit(faction: FactionId, type: UnitTypeId): boolean {
  const def = UNIT_DEFS[type];
  return def.faction === null || def.faction === faction;
}

export function isKnownUnitType(v: unknown): v is UnitTypeId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(UNIT_DEFS, v);
}

/** 시나리오 규칙의 uniqueUnits. 필드 없으면 false(기존 문서·저장 의미 유지). */
export function uniqueUnitsEnabled(state: GameState): boolean {
  return state.objectives.uniqueUnits === true;
}

/**
 * 현재 규칙·세력 기준으로 생산 가능한 병종 목록.
 * uniqueUnits가 false면 공용 3개만, true면 공용 3개 + 해당 faction 고유 1개.
 * 항상 UNIT_TYPE_IDS 순서를 따른다.
 */
export function producibleUnits(state: GameState, faction: FactionId): UnitTypeId[] {
  const allowUnique = uniqueUnitsEnabled(state);
  return UNIT_TYPE_IDS.filter((type) => {
    const def = UNIT_DEFS[type];
    if (def.faction === null) return true;
    return allowUnique && def.faction === faction;
  });
}

// 유닛 병종 특성을 반영한 타일 진입 비용. terrain-mobility 특성이 지형 비용을 낮춘다.
export function movementCostForUnit(type: UnitTypeId, terrain: TerrainId): number {
  if (terrain === 'water') return Infinity; // 특성으로도 통과 불가
  if (terrain === 'plains') return 1;
  const mobility = unitTrait(type, 'terrain-mobility');
  if (mobility) {
    if (terrain === 'forest') return mobility.forestCost;
    if (terrain === 'mountain') return mobility.mountainCost;
  }
  return TERRAIN_RULES[terrain].cost;
}

// 이 유닛이 건물 타일을 점령했을 때의 총 추가 금과 내역. plunder 특성이 세력 교리 보너스에 중첩된다.
export interface CaptureReward {
  doctrineGold: number;
  plunderGold: number;
  total: number;
}

export function captureRewardForUnit(faction: FactionId, unitType: UnitTypeId): CaptureReward {
  const doctrineGold = DOCTRINES[faction].captureGold;
  const plunder = unitTrait(unitType, 'plunder');
  const plunderGold = plunder?.bonusGold ?? 0;
  return { doctrineGold, plunderGold, total: doctrineGold + plunderGold };
}

// 방어 관통: 대상 병종 기본 방어만 최대 amount까지 무시. 없으면 0.
export function unitArmorPiercing(type: UnitTypeId): number {
  return unitTrait(type, 'armor-piercing')?.amount ?? 0;
}

// 한 줄 목적: 병종 정본 레지스트리와 로스터·특성 조회 공용 함수를 제공한다
import type { FactionId, GameState, UnitDefinition, UnitTrait, UnitTypeId } from './types';

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
    cost: 50,
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

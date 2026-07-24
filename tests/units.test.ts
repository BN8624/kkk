// 한 줄 목적: 병종 레지스트리·로스터 계약·생산 제한을 검증한다
import { describe, expect, it } from 'vitest';
import { tileAt, unitAt } from '../src/core/board';
import { UNIT_STATS } from '../src/core/data';
import { newGame, produceUnit } from '../src/core/game';
import type { FactionId } from '../src/core/types';
import {
  UNIT_DEFS,
  UNIT_TYPE_IDS,
  canFactionUseUnit,
  isKnownUnitType,
  isUniqueUnit,
  producibleUnits,
  uniqueUnitsEnabled,
  unitDefinition,
  unitTrait,
  unitTraits,
} from '../src/core/units';
import { makeState } from './helpers';

const STAT_KEYS = ['hp', 'atk', 'def', 'move', 'range', 'cost'] as const;

describe('UNIT_DEFS 레지스트리', () => {
  it('6병종 수치·진영·특성이 정본과 일치한다', () => {
    expect(UNIT_TYPE_IDS).toEqual([
      'infantry',
      'archer',
      'cavalry',
      'guardian',
      'raider',
      'crossbow',
    ]);

    expect(unitDefinition('infantry')).toMatchObject({
      hp: 12,
      atk: 5,
      def: 2,
      move: 3,
      range: 1,
      cost: 30,
      faction: null,
      traits: [],
    });
    expect(unitDefinition('archer')).toMatchObject({
      hp: 10,
      atk: 5,
      def: 0,
      move: 2,
      range: 2,
      cost: 35,
      faction: null,
      traits: [],
    });
    expect(unitDefinition('cavalry')).toMatchObject({
      hp: 14,
      atk: 7,
      def: 1,
      move: 5,
      range: 1,
      cost: 50,
      faction: null,
      traits: [],
    });
    expect(unitDefinition('guardian')).toMatchObject({
      hp: 16,
      atk: 4,
      def: 4,
      move: 2,
      range: 1,
      cost: 48,
      faction: 'azure',
      traits: [{ type: 'brace', defenseBonus: 1 }],
    });
    expect(unitDefinition('raider')).toMatchObject({
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
    });
    expect(unitDefinition('crossbow')).toMatchObject({
      hp: 10,
      atk: 7,
      def: 0,
      move: 2,
      range: 2,
      cost: 50,
      faction: 'violet',
      traits: [{ type: 'armor-piercing', amount: 2 }],
    });
  });

  it('UNIT_STATS는 UNIT_DEFS에서 파생된 수치와 일치한다', () => {
    for (const id of UNIT_TYPE_IDS) {
      const def = UNIT_DEFS[id];
      for (const k of STAT_KEYS) {
        expect(UNIT_STATS[id][k]).toBe(def[k]);
      }
    }
    expect(Object.keys(UNIT_STATS).sort()).toEqual([...UNIT_TYPE_IDS].sort());
  });

  it('특성·고유 병종·세력 사용 가능 여부가 맞다', () => {
    expect(unitTraits('infantry')).toEqual([]);
    expect(unitTrait('guardian', 'brace')).toEqual({ type: 'brace', defenseBonus: 1 });
    expect(unitTrait('raider', 'plunder')).toEqual({ type: 'plunder', bonusGold: 5 });
    expect(unitTrait('crossbow', 'armor-piercing')).toEqual({ type: 'armor-piercing', amount: 2 });
    expect(unitTrait('infantry', 'brace')).toBeUndefined();

    expect(isUniqueUnit('infantry')).toBe(false);
    expect(isUniqueUnit('guardian')).toBe(true);
    expect(canFactionUseUnit('azure', 'infantry')).toBe(true);
    expect(canFactionUseUnit('azure', 'guardian')).toBe(true);
    expect(canFactionUseUnit('crimson', 'guardian')).toBe(false);
    expect(isKnownUnitType('raider')).toBe(true);
    expect(isKnownUnitType('dragon')).toBe(false);
  });
});

describe('producibleUnits / uniqueUnits', () => {
  it('uniqueUnits 미지정 시 공용 3병종만 허용한다', () => {
    const state = makeState();
    expect(uniqueUnitsEnabled(state)).toBe(false);
    for (const f of ['azure', 'crimson', 'violet'] as FactionId[]) {
      expect(producibleUnits(state, f)).toEqual(['infantry', 'archer', 'cavalry']);
    }
  });

  it('uniqueUnits off면 공용 3개만, on이면 공용+해당 왕국 고유 1개다', () => {
    const off = makeState();
    off.objectives.uniqueUnits = false;
    expect(producibleUnits(off, 'azure')).toEqual(['infantry', 'archer', 'cavalry']);

    const on = makeState();
    on.objectives.uniqueUnits = true;
    expect(producibleUnits(on, 'azure')).toEqual(['infantry', 'archer', 'cavalry', 'guardian']);
    expect(producibleUnits(on, 'crimson')).toEqual(['infantry', 'archer', 'cavalry', 'raider']);
    expect(producibleUnits(on, 'violet')).toEqual(['infantry', 'archer', 'cavalry', 'crossbow']);
  });

  it('다른 왕국 고유 병종 생산은 거부된다', () => {
    const state = makeState();
    state.objectives.uniqueUnits = true;
    state.factions.azure.gold = 200;
    const t = tileAt(state, 0, 0)!;
    t.building = 'capital';
    t.owner = 'azure';

    expect(produceUnit(state, 'azure', { q: 0, r: 0 }, 'guardian').ok).toBe(true);

    const t2 = tileAt(state, 1, 0)!;
    t2.building = 'village';
    t2.owner = 'azure';
    const denied = produceUnit(state, 'azure', { q: 1, r: 0 }, 'raider');
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('invalid');
    expect(unitAt(state, 1, 0)).toBeUndefined();
  });

  it('uniqueUnits off에서 고유 병종 생산이 거부된다', () => {
    const state = makeState();
    state.factions.azure.gold = 200;
    const t = tileAt(state, 0, 0)!;
    t.building = 'capital';
    t.owner = 'azure';
    expect(produceUnit(state, 'azure', { q: 0, r: 0 }, 'guardian').ok).toBe(false);
  });

  it('내장 시나리오 newGame은 uniqueUnits가 켜진다', () => {
    const state = newGame(1, { scenario: 'three-crowns' });
    expect(uniqueUnitsEnabled(state)).toBe(true);
    expect(producibleUnits(state, 'azure')).toContain('guardian');
  });
});

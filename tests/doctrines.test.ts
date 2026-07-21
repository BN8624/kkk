// 한 줄 목적: 세 왕국 교리(보루·돌격·장궁·경제 보너스)가 규칙에 실제 적용되는지 검증한다
import { describe, expect, it } from 'vitest';
import { tileAt, unitsOf } from '../src/core/board';
import { BUILDING_INCOME, UNIT_STATS } from '../src/core/data';
import {
  AZURE_BULWARK_DEF,
  CRIMSON_CHARGE_ATK,
  DOCTRINES,
  VIOLET_ARCHER_RANGE,
} from '../src/core/doctrines';
import {
  advancePhase,
  attack,
  attackTargets,
  damageBreakdown,
  forecastAttack,
  moveUnit,
  newGame,
  unitCost,
  unitRange,
} from '../src/core/game';
import { addUnit, makeState } from './helpers';

describe('청람 왕국 — 보루', () => {
  it('보병이 숲에서 방어 +1을 받는다', () => {
    const state = makeState();
    const atk = addUnit(state, { faction: 'crimson', q: 0, r: 0 });
    const def = addUnit(state, { faction: 'azure', q: 1, r: 0 });
    const plains = damageBreakdown(state, atk, def).total;
    tileAt(state, 1, 0)!.terrain = 'forest';
    const forest = damageBreakdown(state, atk, def);
    // 숲 지형 방어 1 + 보루 1
    expect(forest.total).toBe(Math.max(1, plains - 1 - AZURE_BULWARK_DEF));
    expect(forest.doctrineDef).toBe(AZURE_BULWARK_DEF);
  });

  it('보병이 거점에서도 보루 방어를 받고, 다른 병과는 받지 않는다', () => {
    const state = makeState();
    const atk = addUnit(state, { faction: 'crimson', q: 0, r: 0 });
    const inf = addUnit(state, { faction: 'azure', q: 1, r: 0 });
    tileAt(state, 1, 0)!.building = 'village';
    expect(damageBreakdown(state, atk, inf).doctrineDef).toBe(AZURE_BULWARK_DEF);
    const archer = addUnit(state, { faction: 'azure', q: 2, r: 0, type: 'archer' });
    tileAt(state, 2, 0)!.building = 'village';
    expect(damageBreakdown(state, atk, archer).doctrineDef).toBe(0);
  });

  it('보병 생산 비용이 교리 할인만큼 싸다', () => {
    expect(unitCost('azure', 'infantry')).toBe(
      UNIT_STATS.infantry.cost + DOCTRINES.azure.unitCostDelta.infantry!,
    );
    expect(unitCost('crimson', 'infantry')).toBe(UNIT_STATS.infantry.cost);
  });
});

describe('진홍 공국 — 돌격', () => {
  it('기병이 이동 후 공격하면 공격 +2', () => {
    const state = makeState();
    const cav = addUnit(state, { faction: 'crimson', q: 0, r: 0, type: 'cavalry' });
    const def = addUnit(state, { faction: 'azure', q: 2, r: 0, type: 'archer' });
    const still = damageBreakdown(state, cav, def).total;
    moveUnit(state, cav.id, { q: 1, r: 0 });
    const charged = damageBreakdown(state, cav, def);
    expect(charged.atkBonus).toBe(CRIMSON_CHARGE_ATK);
    expect(charged.total).toBe(still + CRIMSON_CHARGE_ATK);
  });

  it('반격에는 돌격 보너스가 없다', () => {
    const state = makeState();
    const cav = addUnit(state, { faction: 'crimson', q: 0, r: 0, type: 'cavalry', moved: true });
    const inf = addUnit(state, { faction: 'azure', q: 1, r: 0 });
    // azure 보병이 진홍 기병을 공격 → 기병의 반격에 돌격이 붙으면 안 된다
    const fc = forecastAttack(state, inf, cav);
    expect(fc.counter).not.toBeNull();
    expect(fc.counter!.atkBonus).toBe(0);
  });

  it('타 세력 기병은 돌격 보너스가 없다', () => {
    const state = makeState();
    const cav = addUnit(state, { faction: 'violet', q: 0, r: 0, type: 'cavalry', moved: true });
    const def = addUnit(state, { faction: 'azure', q: 1, r: 0 });
    expect(damageBreakdown(state, cav, def).atkBonus).toBe(0);
  });

  it('거점 점령 시 즉시 금 +8', () => {
    const state = makeState();
    const goldBefore = state.factions.crimson.gold;
    tileAt(state, 1, 0)!.building = 'village';
    const u = addUnit(state, { faction: 'crimson', q: 0, r: 0 });
    const result = moveUnit(state, u.id, { q: 1, r: 0 });
    expect(result.bonusGold).toBe(DOCTRINES.crimson.captureGold);
    expect(state.factions.crimson.gold).toBe(goldBefore + DOCTRINES.crimson.captureGold);
  });
});

describe('자원 후국 — 장궁과 경제', () => {
  it('자원 궁병만 사거리 +1로 3칸 공격이 가능하다', () => {
    const state = makeState();
    const vArcher = addUnit(state, { faction: 'violet', q: 0, r: 0, type: 'archer' });
    const aArcher = addUnit(state, { faction: 'azure', q: 0, r: 3, type: 'archer' });
    const target = addUnit(state, { faction: 'crimson', q: 3, r: 0 });
    expect(unitRange(vArcher)).toBe(UNIT_STATS.archer.range + VIOLET_ARCHER_RANGE);
    expect(unitRange(aArcher)).toBe(UNIT_STATS.archer.range);
    // 거리 3: 자원 궁병은 공격 가능, 청람 궁병은 불가
    expect(attackTargets(state, vArcher).map((u) => u.id)).toContain(target.id);
    expect(attack(state, aArcher.id, vArcher.id).reason).toBe('out-of-range');
  });

  it('거리 3 공격에는 일반 궁병의 반격이 없다', () => {
    const state = makeState();
    const vArcher = addUnit(state, { faction: 'violet', q: 0, r: 0, type: 'archer' });
    const enemy = addUnit(state, { faction: 'azure', q: 3, r: 0, type: 'archer' });
    const fc = forecastAttack(state, vArcher, enemy);
    expect(fc.counter).toBeNull();
  });

  it('마을 수입 보너스가 적용된다', () => {
    const state = makeState();
    const v1 = tileAt(state, 0, 0)!;
    v1.building = 'village';
    v1.owner = 'violet';
    const v2 = tileAt(state, 2, 2)!;
    v2.building = 'village';
    v2.owner = 'azure';
    const violetBefore = state.factions.violet.gold;
    const azureBefore = state.factions.azure.gold;
    state.current = 'violet';
    advancePhase(state); // 턴 종료 수입
    expect(state.factions.violet.gold).toBe(
      violetBefore + BUILDING_INCOME.village + DOCTRINES.violet.villageIncomeBonus,
    );
    expect(state.factions.azure.gold).toBe(azureBefore + BUILDING_INCOME.village);
  });

  it('자원 궁병 생산 비용이 교리 할인만큼 싸다', () => {
    expect(unitCost('violet', 'archer')).toBe(
      UNIT_STATS.archer.cost + DOCTRINES.violet.unitCostDelta.archer!,
    );
    expect(unitCost('azure', 'archer')).toBe(UNIT_STATS.archer.cost);
    expect(unitCost('violet', 'crossbow')).toBe(UNIT_STATS.crossbow.cost);
  });
});

describe('시작 배치·예측 일관성', () => {
  it('교리별 시작 유닛과 시작 금이 다르다', () => {
    const state = newGame(99);
    expect(unitsOf(state, 'azure').map((u) => u.type).sort()).toEqual(['archer', 'infantry']);
    expect(unitsOf(state, 'crimson').map((u) => u.type).sort()).toEqual(['cavalry', 'infantry']);
    expect(unitsOf(state, 'violet').map((u) => u.type).sort()).toEqual(['archer', 'archer']);
    expect(state.factions.azure.gold).toBe(DOCTRINES.azure.startGold);
    expect(state.factions.crimson.gold).toBe(DOCTRINES.crimson.startGold);
    expect(state.factions.violet.gold).toBe(DOCTRINES.violet.startGold);
  });

  it('forecastAttack 예측이 실제 attack 결과와 일치한다', () => {
    const state = makeState();
    const cav = addUnit(state, { faction: 'crimson', q: 0, r: 0, type: 'cavalry', moved: true });
    const inf = addUnit(state, { faction: 'azure', q: 1, r: 0 });
    tileAt(state, 1, 0)!.terrain = 'forest';
    const fc = forecastAttack(state, cav, inf);
    const hpBefore = { atk: cav.hp, def: inf.hp };
    const result = attack(state, cav.id, inf.id);
    expect(result.damage).toBe(fc.damage.total);
    if (fc.counter) {
      expect(result.counterDamage).toBe(fc.counter.total);
      expect(cav.hp).toBe(hpBefore.atk - fc.counter.total);
    }
    expect(result.defenderDied).toBe(fc.defenderDies);
    expect(inf.hp).toBe(hpBefore.def - fc.damage.total);
  });
});

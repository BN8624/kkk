// 한 줄 목적: 고유 병종 특성(이동·약탈·수호 태세·관통)의 정본 규칙 효과를 검증한다
import { describe, expect, it } from 'vitest';
import { tileAt } from '../src/core/board';
import { issueCommand } from '../src/core/command';
import { DOCTRINES } from '../src/core/doctrines';
import {
  advancePhase,
  attack,
  braceDefBonus,
  damageBreakdown,
  forecastAttack,
  moveUnit,
  produceUnit,
  unitRange,
} from '../src/core/game';
import {
  captureRewardForUnit,
  movementCostForUnit,
  unitArmorPiercing,
} from '../src/core/units';
import { addUnit, makeState } from './helpers';

describe('약탈대 이동 비용 (terrain-mobility)', () => {
  it('약탈대는 숲=1·산=2, 공용 병종은 숲=2·산=3 그대로', () => {
    expect(movementCostForUnit('raider', 'forest')).toBe(1);
    expect(movementCostForUnit('raider', 'mountain')).toBe(2);
    expect(movementCostForUnit('raider', 'plains')).toBe(1);
    expect(movementCostForUnit('raider', 'water')).toBe(Infinity);

    for (const type of ['infantry', 'archer', 'cavalry'] as const) {
      expect(movementCostForUnit(type, 'forest')).toBe(2);
      expect(movementCostForUnit(type, 'mountain')).toBe(3);
      expect(movementCostForUnit(type, 'plains')).toBe(1);
      expect(movementCostForUnit(type, 'water')).toBe(Infinity);
    }
  });

  it('movementRange에 약탈대 숲 비용이 반영된다', async () => {
    const { movementRange } = await import('../src/core/pathfind');
    const state = makeState();
    tileAt(state, 1, 2)!.terrain = 'forest';
    const raider = addUnit(state, { faction: 'crimson', q: 0, r: 2, type: 'raider' });
    const inf = addUnit(state, { faction: 'azure', q: 0, r: 0, type: 'infantry' });
    expect(movementRange(state, raider).get('1,2')!.cost).toBe(1);
    tileAt(state, 1, 0)!.terrain = 'forest';
    expect(movementRange(state, inf).get('1,0')!.cost).toBe(2);
  });
});

describe('약탈대 점령 보상 (plunder)', () => {
  it('진홍 약탈대는 교리+약탈이 중첩되고 이벤트 이유가 구분된다', () => {
    const reward = captureRewardForUnit('crimson', 'raider');
    expect(reward.doctrineGold).toBe(DOCTRINES.crimson.captureGold);
    expect(reward.plunderGold).toBe(5);
    expect(reward.total).toBe(DOCTRINES.crimson.captureGold + 5);

    // 공용 병종 진홍은 교리만
    expect(captureRewardForUnit('crimson', 'infantry')).toEqual({
      doctrineGold: DOCTRINES.crimson.captureGold,
      plunderGold: 0,
      total: DOCTRINES.crimson.captureGold,
    });
    // 타 세력 약탈 특성 없음(약탈대는 진홍 전용 정의지만 함수는 병종 기준)
    expect(captureRewardForUnit('azure', 'infantry').total).toBe(0);
  });

  it('moveUnit·명령 이벤트가 doctrine/plunder를 구분한다', () => {
    const state = makeState();
    state.current = 'crimson';
    state.controllers.crimson = 'human';
    const goldBefore = state.factions.crimson.gold;
    tileAt(state, 1, 0)!.building = 'village';
    const u = addUnit(state, { faction: 'crimson', q: 0, r: 0, type: 'raider' });

    const result = moveUnit(state, u.id, { q: 1, r: 0 });
    expect(result.bonusGold).toBe(DOCTRINES.crimson.captureGold + 5);
    expect(result.doctrineGold).toBe(DOCTRINES.crimson.captureGold);
    expect(result.plunderGold).toBe(5);
    expect(state.factions.crimson.gold).toBe(goldBefore + DOCTRINES.crimson.captureGold + 5);

    // 명령 경로 이벤트 구분(새 게임 상태로 재검증)
    const state2 = makeState();
    state2.current = 'crimson';
    state2.controllers.crimson = 'human';
    state2.cmdSeq = 0;
    state2.commandLog = [];
    tileAt(state2, 1, 0)!.building = 'village';
    const u2 = addUnit(state2, { faction: 'crimson', q: 0, r: 0, type: 'raider' });
    const cmd = issueCommand(
      state2,
      { type: 'move-unit', unitId: u2.id, to: { q: 1, r: 0 } },
      'test',
    );
    expect(cmd.ok).toBe(true);
    const goldEvents = cmd.events.filter((e) => e.type === 'gold-changed');
    expect(goldEvents).toHaveLength(2);
    expect(goldEvents[0]).toMatchObject({
      reason: 'capture-bonus',
      delta: DOCTRINES.crimson.captureGold,
    });
    expect(goldEvents[1]).toMatchObject({ reason: 'plunder', delta: 5 });
    const totalDelta = goldEvents.reduce(
      (s, e) => s + (e.type === 'gold-changed' ? e.delta : 0),
      0,
    );
    expect(totalDelta).toBe(DOCTRINES.crimson.captureGold + 5);
  });
});

describe('수호대 수호 태세 (brace)', () => {
  it('이동하지 않으면 braceDef=2, 이동하면 0', () => {
    const state = makeState();
    const guard = addUnit(state, { faction: 'azure', q: 1, r: 0, type: 'guardian' });
    const atk = addUnit(state, { faction: 'crimson', q: 0, r: 0 });

    expect(braceDefBonus(guard)).toBe(2);
    expect(damageBreakdown(state, atk, guard).braceDef).toBe(2);

    // 이동 후 brace 해제
    moveUnit(state, guard.id, { q: 2, r: 0 });
    expect(guard.movedThisTurn).toBe(true);
    expect(braceDefBonus(guard)).toBe(0);
    expect(damageBreakdown(state, atk, guard).braceDef).toBe(0);
  });

  it('제자리 공격은 brace를 유지한다', () => {
    const state = makeState();
    const guard = addUnit(state, { faction: 'azure', q: 0, r: 0, type: 'guardian' });
    const enemy = addUnit(state, { faction: 'crimson', q: 1, r: 0 });

    expect(braceDefBonus(guard)).toBe(2);
    const r = attack(state, guard.id, enemy.id);
    expect(r.ok).toBe(true);
    expect(guard.moved).toBe(true); // 공격 후 moved 플래그는 true
    expect(guard.movedThisTurn).toBeFalsy(); // 이동 명령이 아니므로 brace 유지
    expect(braceDefBonus(guard)).toBe(2);

    // 반격 피해 계산 시에도 수호 태세 반영(방어자=원 공격자)
    // 적이 살아 있으면 반격 시 원 공격자의 brace가 적용됨
  });

  it('생산 턴에는 brace가 발동하지 않고 다음 턴 리셋으로 정상화된다', () => {
    const state = makeState();
    tileAt(state, 0, 0)!.building = 'capital';
    tileAt(state, 0, 0)!.owner = 'azure';
    state.factions.azure.gold = 200;
    state.objectives = {
      ...state.objectives,
      uniqueUnits: true,
    };

    const produced = produceUnit(state, 'azure', { q: 0, r: 0 }, 'guardian');
    expect(produced.ok).toBe(true);
    const g = produced.unit!;
    expect(g.movedThisTurn).toBe(true);
    expect(braceDefBonus(g)).toBe(0);

    // 턴 진행으로 리셋
    advancePhase(state); // crimson
    advancePhase(state); // violet
    advancePhase(state); // 라운드 종료 → 리셋
    expect(g.movedThisTurn).toBe(false);
    expect(braceDefBonus(g)).toBe(2);
  });
});

describe('쇠뇌대 방어 관통 (armor-piercing)', () => {
  it('대상 기본 방어만 관통하고 지형·건물·brace는 관통하지 않는다', () => {
    expect(unitArmorPiercing('crossbow')).toBe(2);
    expect(unitArmorPiercing('infantry')).toBe(0);

    const state = makeState();
    // 진홍 보병(def=2) — 청람 보루 교리 제외
    const xbow = addUnit(state, { faction: 'violet', q: 0, r: 0, type: 'crossbow' });
    const inf = addUnit(state, { faction: 'crimson', q: 2, r: 0, type: 'infantry' });
    const plain = damageBreakdown(state, xbow, inf);
    expect(plain.defense).toBe(2);
    expect(plain.pierced).toBe(2);
    // base 7 - (2-2) - 0 - 0 - 0 = 7
    expect(plain.total).toBe(7);

    // 산 지형 def+2는 관통 안 됨
    tileAt(state, 2, 0)!.terrain = 'mountain';
    const mtn = damageBreakdown(state, xbow, inf);
    expect(mtn.pierced).toBe(2);
    expect(mtn.terrainDef).toBe(2);
    expect(mtn.doctrineDef).toBe(0);
    // 7 - 0 - 2 = 5
    expect(mtn.total).toBe(5);

    // 건물 방어도 관통 안 됨
    tileAt(state, 2, 0)!.terrain = 'plains';
    tileAt(state, 2, 0)!.building = 'village';
    const bld = damageBreakdown(state, xbow, inf);
    expect(bld.pierced).toBe(2);
    expect(bld.terrainDef).toBe(1); // village +1
    expect(bld.total).toBe(6); // 7 - 0 - 1

    // brace 방어는 관통 안 됨
    const guard = addUnit(state, { faction: 'azure', q: 1, r: 1, type: 'guardian' });
    // guardian def=4, pierce min(2,4)=2, braceDef=2
    // 7 - (4-2) - 0 - 0 - 2 = 3
    const vsGuard = damageBreakdown(state, xbow, guard);
    expect(vsGuard.defense).toBe(4);
    expect(vsGuard.pierced).toBe(2);
    expect(vsGuard.braceDef).toBe(2);
    expect(vsGuard.total).toBe(3);
  });

  it('관통량이 기본 방어보다 크면 기본 방어까지만 관통한다', () => {
    const state = makeState();
    // 궁병 def=0 → pierced=0
    const xbow = addUnit(state, { faction: 'violet', q: 0, r: 0, type: 'crossbow' });
    const arc = addUnit(state, { faction: 'crimson', q: 2, r: 0, type: 'archer' });
    const bd = damageBreakdown(state, xbow, arc);
    expect(bd.defense).toBe(0);
    expect(bd.pierced).toBe(0);
    expect(bd.total).toBe(7); // 7 - 0

    // 기병 def=1 → pierced=1 (amount 2지만 min)
    const cav = addUnit(state, { faction: 'crimson', q: 2, r: 1, type: 'cavalry' });
    const vsCav = damageBreakdown(state, xbow, cav);
    expect(vsCav.defense).toBe(1);
    expect(vsCav.pierced).toBe(1);
    expect(vsCav.total).toBe(7); // 7 - (1-1)
  });

  it('자원 궁병 사거리+1 교리는 쇠뇌대에 적용되지 않는다', () => {
    const state = makeState();
    const xbow = addUnit(state, { faction: 'violet', q: 0, r: 0, type: 'crossbow' });
    const archer = addUnit(state, { faction: 'violet', q: 0, r: 1, type: 'archer' });
    expect(unitRange(xbow)).toBe(2);
    expect(unitRange(archer)).toBe(3);
  });
});

describe('forecast와 실제 attack 피해 일치', () => {
  it('수호 태세·관통이 반영된 예측과 실제가 같다', () => {
    const state = makeState();
    const xbow = addUnit(state, { faction: 'violet', q: 0, r: 0, type: 'crossbow' });
    const guard = addUnit(state, { faction: 'azure', q: 2, r: 0, type: 'guardian' });
    // plains, brace on, pierce 2 vs def 4 → total 3
    const fc = forecastAttack(state, xbow, guard);
    expect(fc.damage.braceDef).toBe(2);
    expect(fc.damage.pierced).toBe(2);
    expect(fc.damage.total).toBe(3);

    const hpBefore = guard.hp;
    const r = attack(state, xbow.id, guard.id);
    expect(r.ok).toBe(true);
    expect(r.damage).toBe(fc.damage.total);
    expect(guard.hp).toBe(hpBefore - fc.damage.total);
  });
});

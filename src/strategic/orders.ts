// 한 줄 목적: 전략 이동·대기 명령의 순수 검증과 immutable 적용을 제공한다
import type { FactionId } from '../core/types';
import { buildBattleContext } from './battle-bridge';
import { cloneStrategicState } from './state';
import type {
  StrategicArmy,
  StrategicGameState,
  StrategicOrder,
  StrategicResult,
} from './types';
import { validateStrategicState } from './validate';

function fail(reason: string): StrategicResult<StrategicGameState> {
  return { ok: false, reason };
}

function armyById(state: StrategicGameState, id: string): StrategicArmy | undefined {
  return state.armies.find((a) => a.id === id);
}

function regionById(state: StrategicGameState, id: string) {
  return state.regions.find((r) => r.id === id);
}

function armiesInRegion(state: StrategicGameState, regionId: string): StrategicArmy[] {
  return state.armies.filter((a) => a.regionId === regionId);
}

/** 명령 사전 검증(상태 변경 없음). */
export function validateStrategicOrder(
  state: StrategicGameState,
  order: StrategicOrder,
  actingFaction?: FactionId,
): StrategicResult<true> {
  if (state.phase !== 'orders') return { ok: false, reason: 'not-orders-phase' };
  if (state.pendingBattle) return { ok: false, reason: 'battle-pending' };
  if (state.winner !== undefined) return { ok: false, reason: 'game-ended' };

  const faction = actingFaction ?? state.currentFaction;
  const army = armyById(state, order.armyId);
  if (!army) return { ok: false, reason: 'army-missing' };
  if (army.faction !== faction) return { ok: false, reason: 'not-own-army' };
  if (army.moved) return { ok: false, reason: 'already-moved' };
  if (army.units.length === 0) return { ok: false, reason: 'empty-army' };

  if (order.type === 'hold-army') return { ok: true, value: true };

  if (order.type === 'move-army') {
    const to = regionById(state, order.toRegionId);
    if (!to) return { ok: false, reason: 'region-missing' };
    const from = regionById(state, army.regionId);
    if (!from) return { ok: false, reason: 'origin-missing' };
    if (!from.neighbors.includes(order.toRegionId)) return { ok: false, reason: 'not-adjacent' };
    if (order.toRegionId === army.regionId) return { ok: false, reason: 'same-region' };

    const occupants = armiesInRegion(state, order.toRegionId);
    const enemies = occupants.filter((a) => a.faction !== army.faction);
    const allies = occupants.filter((a) => a.faction === army.faction);
    // 아군 군단이 이미 있으면 합류 미구현 — V0 거절
    if (allies.length > 0) return { ok: false, reason: 'ally-occupied' };
    // 적 군단 2개 이상은 비정상
    if (enemies.length > 1) return { ok: false, reason: 'ambiguous-defender' };
    return { ok: true, value: true };
  }

  return { ok: false, reason: 'unknown-order' };
}

/**
 * 전략 명령을 순수 함수로 적용한다.
 * - 입력 상태는 변경하지 않는다.
 * - 적 군단 지역 진입 시 pendingBattle을 만들고 phase=battle.
 * - 빈 지역 진입 시 즉시 점령·이동.
 */
export function applyStrategicOrder(
  state: StrategicGameState,
  order: StrategicOrder,
  actingFaction?: FactionId,
): StrategicResult<StrategicGameState> {
  const v = validateStrategicOrder(state, order, actingFaction);
  if (!v.ok) return fail(v.reason);

  const next = cloneStrategicState(state);
  const faction = actingFaction ?? next.currentFaction;
  const army = armyById(next, order.armyId)!;

  if (order.type === 'hold-army') {
    army.moved = true;
    const check = validateStrategicState(next);
    if (!check.ok) return fail(check.reason);
    return { ok: true, value: next };
  }

  // move-army
  const toRegion = regionById(next, order.toRegionId)!;
  const enemies = armiesInRegion(next, order.toRegionId).filter((a) => a.faction !== army.faction);

  if (enemies.length === 1) {
    const defender = enemies[0];
    const origin = army.regionId;
    const ctx = buildBattleContext(next, {
      attackerArmyId: army.id,
      defenderArmyId: defender.id,
      regionId: toRegion.id,
      attackerOriginRegionId: origin,
    });
    if (!ctx.ok) return fail(ctx.reason);
    army.moved = true;
    next.pendingBattle = ctx.value;
    next.phase = 'battle';
    const check = validateStrategicState(next);
    if (!check.ok) return fail(check.reason);
    return { ok: true, value: next };
  }

  // 빈 지역(또는 무방비): 즉시 이동·점령
  army.regionId = toRegion.id;
  army.moved = true;
  toRegion.owner = faction;

  const check = validateStrategicState(next);
  if (!check.ok) return fail(check.reason);
  return { ok: true, value: next };
}

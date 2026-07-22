// 한 줄 목적: 전략 전투 battleId·battleSeed 단일 정본 계산을 공유한다
import { UNIT_STATS } from '../core/data';
import { digestString, canonicalJson } from '../core/replay';
import { isKnownUnitType } from '../core/units';
import type { StrategicGameState, StrategicResult } from './types';

export interface BattleContextRequest {
  attackerArmyId: string;
  defenderArmyId: string;
  regionId: string;
  attackerOriginRegionId: string;
}

function fail<T>(reason: string): StrategicResult<T> {
  return { ok: false, reason };
}

function fnv(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * battleId·battleSeed 단일 정본 계산.
 * buildBattleContext와 pendingBattle validator가 동일 함수를 사용한다.
 */
export function deriveBattleIdentity(
  state: StrategicGameState,
  request: BattleContextRequest,
): StrategicResult<{ battleId: string; battleSeed: number }> {
  const attacker = state.armies.find((a) => a.id === request.attackerArmyId);
  const defender = state.armies.find((a) => a.id === request.defenderArmyId);
  if (!attacker) return fail('attacker-missing');
  if (!defender) return fail('defender-missing');
  if (attacker.id === defender.id) return fail('same-army');
  if (attacker.faction === defender.faction) return fail('same-faction');
  if (attacker.units.length === 0 || defender.units.length === 0) return fail('empty-army');

  const seenUnits = new Set<string>();
  const unitRows: [string, string, number][] = [];
  for (const army of [attacker, defender]) {
    for (const u of army.units) {
      if (seenUnits.has(u.id)) return fail('duplicate-strategic-unit');
      seenUnits.add(u.id);
      if (!isKnownUnitType(u.type)) return fail('bad-unit-type');
      const maxHp = UNIT_STATS[u.type].hp;
      if (!Number.isInteger(u.hp) || u.hp < 1 || u.hp > maxHp) return fail('bad-unit-hp');
      unitRows.push([u.id, u.type, u.hp]);
    }
  }
  unitRows.sort((a, b) => a[0].localeCompare(b[0]));

  const idPayload = {
    seed: state.seed,
    turn: state.turn,
    regionId: request.regionId,
    attackerArmyId: request.attackerArmyId,
    defenderArmyId: request.defenderArmyId,
    origin: request.attackerOriginRegionId,
    units: unitRows,
  };
  const battleId = digestString(canonicalJson(idPayload));
  const battleSeed = fnv(`${state.seed}|${battleId}|${state.turn}`) >>> 0;
  return { ok: true, value: { battleId, battleSeed } };
}

/** 보드 타일 결정론용 FNV (시나리오 생성 공유). */
export function battleFnv(str: string): number {
  return fnv(str);
}

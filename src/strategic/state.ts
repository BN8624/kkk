// 한 줄 목적: seed·humanFaction 기준 결정론적 Strategic V0 초기 상태를 생성한다
import { FACTION_IDS, UNIT_STATS } from '../core/data';
import type { FactionId, UnitTypeId } from '../core/types';
import { createStrategicRegions } from './map';
import type { StrategicArmy, StrategicGameState, StrategicUnit } from './types';
import { validateStrategicState } from './validate';

/** 간단한 결정론 난수(xorshift32). */
function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

function pickUnitTypes(faction: FactionId, count: number, rng: () => number): UnitTypeId[] {
  const pool: UnitTypeId[] =
    faction === 'azure'
      ? ['infantry', 'archer', 'cavalry', 'guardian']
      : faction === 'crimson'
        ? ['infantry', 'archer', 'cavalry', 'raider']
        : ['infantry', 'archer', 'cavalry', 'crossbow'];
  const out: UnitTypeId[] = [];
  for (let i = 0; i < count; i++) {
    out.push(pool[Math.floor(rng() * pool.length) % pool.length]);
  }
  return out;
}

function buildArmy(
  armyId: string,
  faction: FactionId,
  regionId: string,
  unitCount: number,
  rng: () => number,
): StrategicArmy {
  const types = pickUnitTypes(faction, unitCount, rng);
  const units: StrategicUnit[] = types.map((type, i) => ({
    id: `${armyId}-u${i}`,
    type,
    hp: UNIT_STATS[type].hp,
  }));
  return {
    id: armyId,
    faction,
    regionId,
    units,
    moved: false,
  };
}

/**
 * V0 초기 전략 상태.
 * - 12지역 고정 그래프
 * - 세력당 수도 1·초기 소유 3·시작 군단 2
 * - 군단당 유닛 4~6(전술 보드 과밀 방지)
 * - 동일 seed+humanFaction → 동일 상태
 */
export function createStrategicState(seed: number, humanFaction: FactionId): StrategicGameState {
  if (!FACTION_IDS.includes(humanFaction)) {
    throw new Error(`invalid humanFaction: ${String(humanFaction)}`);
  }
  const rng = makeRng(seed ^ 0x5a17e61c);
  const regions = createStrategicRegions();

  // 세력당 2군단, 고정 시작 지역(수도 + 보조 거점)
  const armyPlans: { faction: FactionId; regionId: string; index: number }[] = [
    { faction: 'azure', regionId: 'r00', index: 0 },
    { faction: 'azure', regionId: 'r04', index: 1 },
    { faction: 'crimson', regionId: 'r03', index: 0 },
    { faction: 'crimson', regionId: 'r11', index: 1 },
    { faction: 'violet', regionId: 'r08', index: 0 },
    { faction: 'violet', regionId: 'r10', index: 1 },
  ];

  const armies: StrategicArmy[] = armyPlans.map((plan) => {
    const count = 4 + Math.floor(rng() * 3); // 4..6
    return buildArmy(`army-${plan.faction}-${plan.index}`, plan.faction, plan.regionId, count, rng);
  });

  const treasury = {} as Record<FactionId, number>;
  for (const fid of FACTION_IDS) treasury[fid] = 50;

  const state: StrategicGameState = {
    schemaVersion: 1,
    seed,
    turn: 1,
    maxTurns: 10,
    humanFaction,
    currentFaction: humanFaction,
    phase: 'orders',
    regions,
    armies,
    treasury,
  };

  const check = validateStrategicState(state);
  if (!check.ok) {
    throw new Error(`createStrategicState invalid: ${check.reason}`);
  }
  return state;
}

/** 깊은 구조 복제(순수 갱신용). */
export function cloneStrategicState(state: StrategicGameState): StrategicGameState {
  return {
    schemaVersion: 1,
    seed: state.seed,
    turn: state.turn,
    maxTurns: state.maxTurns,
    humanFaction: state.humanFaction,
    currentFaction: state.currentFaction,
    phase: state.phase,
    regions: state.regions.map((r) => ({
      ...r,
      neighbors: [...r.neighbors],
    })),
    armies: state.armies.map((a) => ({
      ...a,
      units: a.units.map((u) => ({ ...u })),
    })),
    treasury: { ...state.treasury },
    pendingBattle: state.pendingBattle
      ? {
          ...state.pendingBattle,
          unitBindings: state.pendingBattle.unitBindings.map((b) => ({ ...b })),
        }
      : undefined,
    winner: state.winner,
  };
}

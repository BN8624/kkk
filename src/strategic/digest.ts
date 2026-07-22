// 한 줄 목적: 전략 상태의 결정론 검증용 정본 digest를 계산한다
import { canonicalJson, digestString } from '../core/replay';
import type { StrategicBattleContext, StrategicGameState } from './types';

/** pendingBattle의 정본 필드만 추출한다(바인딩 배열은 정렬). */
function canonicalPendingBattle(ctx: StrategicBattleContext): unknown {
  return {
    schemaVersion: ctx.schemaVersion,
    battleId: ctx.battleId,
    strategicTurn: ctx.strategicTurn,
    battleSeed: ctx.battleSeed,
    regionId: ctx.regionId,
    attackerArmyId: ctx.attackerArmyId,
    defenderArmyId: ctx.defenderArmyId,
    attackerOriginRegionId: ctx.attackerOriginRegionId,
    humanFaction: ctx.humanFaction,
    unitBindings: [...ctx.unitBindings]
      .map((b) => ({
        strategicUnitId: b.strategicUnitId,
        tacticalTag: b.tacticalTag,
        armyId: b.armyId,
        faction: b.faction,
        type: b.type,
        startingHp: b.startingHp,
      }))
      .sort((a, b) => a.strategicUnitId.localeCompare(b.strategicUnitId)),
  };
}

/**
 * 전략 상태 정본 형태.
 * 포함: turn/currentFaction/phase, region owner, army 위치·유닛, treasury, pendingBattle, winner.
 * 제외: UI·카메라·로그 등 비결정 메타.
 */
export function canonicalStrategicState(state: StrategicGameState): unknown {
  const regions = [...state.regions]
    .map((r) => ({ id: r.id, owner: r.owner }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const armies = [...state.armies]
    .map((a) => ({
      id: a.id,
      faction: a.faction,
      regionId: a.regionId,
      moved: a.moved,
      units: [...a.units]
        .map((u) => ({ id: u.id, type: u.type, hp: u.hp }))
        .sort((x, y) => x.id.localeCompare(y.id)),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const treasury = {
    azure: state.treasury.azure,
    crimson: state.treasury.crimson,
    violet: state.treasury.violet,
  };

  const out: Record<string, unknown> = {
    turn: state.turn,
    currentFaction: state.currentFaction,
    phase: state.phase,
    regions,
    armies,
    treasury,
  };
  if (state.pendingBattle) out.pendingBattle = canonicalPendingBattle(state.pendingBattle);
  if (state.winner !== undefined) out.winner = state.winner;
  return out;
}

export function strategicStateDigest(state: StrategicGameState): string {
  return digestString(canonicalJson(canonicalStrategicState(state)));
}

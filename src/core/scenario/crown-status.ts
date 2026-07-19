// 한 줄 목적: 왕관 요새의 활성화·경합·보유·예상 승리 턴을 순수 함수로 계산한다
import { tileAt } from '../board';
import { neighbors } from '../hex';
import type { Axial, FactionId, GameState } from '../types';
import { holdVictoryCondition } from './objectives';

/** UI·AI·테스트가 공유하는 왕관 요새 표시 상태. */
export interface CrownStatus {
  /** 연속 보유 카운트가 활성화되었는지 */
  active: boolean;
  /** 활성화까지 남은 라운드(활성화됐으면 0) */
  turnsToActivate: number;
  owner: FactionId | null;
  heldTurns: number;
  needTurns: number;
  /** 활성화 후 경합으로 확보가 정지 중인지 */
  contested: boolean;
  garrisoned: boolean;
  /** 소유·비경합 유지 가정 시 가장 빠른 예상 승리 턴(애매하면 null) */
  earliestWinTurn: number | null;
  /** 왕관 좌표 */
  at: Axial;
}

/**
 * game.ts 라운드 종료 판정과 동일한 주둔·경합 규칙.
 * owner가 있을 때만 의미가 있다.
 */
export function crownContestFlags(
  state: GameState,
  at: Axial,
  owner: FactionId,
): { garrisoned: boolean; contested: boolean } {
  const garrisoned = state.units.some(
    (u) => u.faction === owner && u.q === at.q && u.r === at.r,
  );
  const enemyAdjacent = neighbors(at).some((n) =>
    state.units.some((u) => u.faction !== owner && u.q === n.q && u.r === n.r),
  );
  return { garrisoned, contested: enemyAdjacent && !garrisoned };
}

/** 왕관 hold-building 시나리오가 아니면 null. */
export function crownStatus(state: GameState): CrownStatus | null {
  const hold = holdVictoryCondition(state);
  if (!hold || !state.crownHold) return null;

  const activationTurn = hold.activationTurn;
  const active = activationTurn === undefined || state.turn >= activationTurn;
  const turnsToActivate = active ? 0 : (activationTurn as number) - state.turn;
  const needTurns = hold.turns;

  // 판정 시점의 타일 소유(라운드 종료 규칙과 동일 소스)
  const tileOwner = tileAt(state, hold.at.q, hold.at.r)?.owner ?? null;
  // 표시용 소유: 공식 보유 추적 상태(라운드 종료 시 동기화)
  const owner = state.crownHold.owner;
  const heldTurns = state.crownHold.turns;

  let garrisoned = false;
  let contested = false;
  if (tileOwner) {
    const flags = crownContestFlags(state, hold.at, tileOwner);
    garrisoned = flags.garrisoned;
    // 경합 정지는 활성화 후에만 적용(활성화 전에는 카운트 자체가 없음)
    contested = active && flags.contested;
  }

  // 엔진은 라운드 종료 시 held를 올린 뒤 승리하면 turn++ 전에 return한다.
  // 남은 필요 라운드 r이면 현재 턴 포함 r번째 라운드 종료에 승리 → turn + r - 1.
  let earliestWinTurn: number | null = null;
  if (!active && activationTurn !== undefined) {
    earliestWinTurn = activationTurn + needTurns - 1;
  } else if (owner && active && !contested) {
    earliestWinTurn = state.turn + needTurns - heldTurns - 1;
  } else if (!owner && active) {
    // 미점령: 이번 라운드 점령 가정 후 연속 보유 하한
    earliestWinTurn = state.turn + needTurns - 1;
  }

  return {
    active,
    turnsToActivate,
    owner,
    heldTurns,
    needTurns,
    contested,
    garrisoned,
    earliestWinTurn,
    at: hold.at,
  };
}

// 한 줄 목적: 게임 상태를 바꾸는 모든 행동을 정본 명령·이벤트로 통합하는 명령 실행기를 제공한다
import { tileAt, unitById } from './board';
import {
  advancePhase,
  attack,
  factionScore,
  moveUnit,
  produceUnit,
} from './game';
import { holdVictoryCondition, starsEarned, victoryMet } from './scenario/objectives';
import type { VictoryCondition } from './scenario/types';
import type { Axial, BuildingId, FactionId, GameState, UnitTypeId } from './types';

export const COMMAND_SCHEMA_VERSION = 1;

/** 명령을 만든 주체 표시(결과에 영향을 주지 않는 클라이언트 메타데이터). */
export type CommandClient = 'human' | 'ai' | 'replay' | 'test';

interface CommandBase {
  /** 명령 스키마 버전 */
  v: typeof COMMAND_SCHEMA_VERSION;
  /** 게임 시작부터의 성공 명령 순번(0부터). 리플레이 순서 검증에 쓴다 */
  seq: number;
  turn: number;
  faction: FactionId;
  client?: CommandClient;
}

export interface MoveUnitCommand extends CommandBase {
  type: 'move-unit';
  unitId: number;
  to: Axial;
}

export interface AttackUnitCommand extends CommandBase {
  type: 'attack-unit';
  attackerId: number;
  defenderId: number;
}

export interface ProduceUnitCommand extends CommandBase {
  type: 'produce-unit';
  at: Axial;
  unitType: UnitTypeId;
}

export interface EndPhaseCommand extends CommandBase {
  type: 'end-phase';
}

export type GameCommand =
  | MoveUnitCommand
  | AttackUnitCommand
  | ProduceUnitCommand
  | EndPhaseCommand;

/** buildCommand가 공통 필드를 채우기 전의 명령 본문. */
export type GameCommandPayload =
  | { type: 'move-unit'; unitId: number; to: Axial }
  | { type: 'attack-unit'; attackerId: number; defenderId: number }
  | { type: 'produce-unit'; at: Axial; unitType: UnitTypeId }
  | { type: 'end-phase' };

export type CommandFailureReason =
  | 'bad-schema'
  | 'game-over'
  | 'wrong-seq'
  | 'wrong-turn'
  | 'wrong-faction'
  | 'no-unit'
  | 'not-your-unit'
  | 'invalid'
  | 'already-moved'
  | 'already-attacked'
  | 'occupied'
  | 'out-of-range'
  | 'friendly'
  | 'not-owned'
  | 'no-gold'
  | 'unit-cap';

// ---------------- 정본 GameEvent ----------------
// 렌더링·기록은 최종 상태를 추측하지 않고 이 이벤트를 사용한다.
// 사망 유닛의 좌표·병과도 이벤트에 보존되므로 연출이 생략되지 않는다.

export type GameEvent =
  | {
      type: 'unit-moved';
      unitId: number;
      faction: FactionId;
      unitType: UnitTypeId;
      from: Axial;
      to: Axial;
      path: Axial[];
    }
  | {
      type: 'building-captured';
      at: Axial;
      building: BuildingId;
      prevOwner?: FactionId;
      newOwner: FactionId;
      byUnitId: number;
    }
  | {
      type: 'gold-changed';
      faction: FactionId;
      delta: number;
      gold: number;
      reason: 'capture-bonus' | 'production';
    }
  | {
      type: 'unit-attacked';
      attackerId: number;
      attackerFaction: FactionId;
      attackerType: UnitTypeId;
      /** 공격 시점의 공격자 좌표 */
      from: Axial;
      defenderId: number;
      defenderFaction: FactionId;
      defenderType: UnitTypeId;
      /** 공격 시점의 방어자 좌표 */
      at: Axial;
      damage: number;
    }
  | {
      type: 'unit-countered';
      /** 반격한 유닛(방어자) */
      unitId: number;
      targetId: number;
      from: Axial;
      at: Axial;
      damage: number;
    }
  | { type: 'unit-damaged'; unitId: number; damage: number; hp: number }
  | { type: 'unit-died'; unitId: number; faction: FactionId; unitType: UnitTypeId; at: Axial }
  | {
      type: 'unit-produced';
      unitId: number;
      faction: FactionId;
      unitType: UnitTypeId;
      at: Axial;
      cost: number;
    }
  | { type: 'phase-ended'; faction: FactionId; next?: FactionId }
  | { type: 'income-granted'; faction: FactionId; amount: number; gold: number }
  | { type: 'turn-started'; turn: number }
  | { type: 'crown-hold-changed'; owner?: FactionId; turns: number; required: number }
  | { type: 'objective-completed'; index: number; condition: VictoryCondition }
  | { type: 'game-ended'; winner: FactionId | 'draw'; turn: number }
  | { type: 'star-awarded'; earned: boolean[]; count: number };

export interface CommandExecutionResult {
  ok: boolean;
  reason?: CommandFailureReason;
  events: GameEvent[];
}

/** 이벤트 배열에서 특정 유형의 첫 이벤트를 타입 좁혀 찾는다. */
export function findEvent<T extends GameEvent['type']>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** 현재 상태 기준으로 공통 필드(버전·순번·턴·세력)를 채운 명령을 만든다. */
export function buildCommand(
  state: GameState,
  payload: GameCommandPayload,
  client?: CommandClient,
): GameCommand {
  return {
    v: COMMAND_SCHEMA_VERSION,
    seq: state.cmdSeq ?? 0,
    turn: state.turn,
    faction: state.current,
    ...(client !== undefined ? { client } : {}),
    ...payload,
  };
}

/** 명령을 만들어 즉시 실행한다(인간 UI·AI 공용 경로). 기록을 위해 명령 자체도 반환한다. */
export function issueCommand(
  state: GameState,
  payload: GameCommandPayload,
  client?: CommandClient,
): CommandExecutionResult & { command: GameCommand } {
  const command = buildCommand(state, payload, client);
  return { ...executeCommand(state, command), command };
}

function fail(reason: CommandFailureReason): CommandExecutionResult {
  return { ok: false, reason, events: [] };
}

function mapReason(reason?: string): CommandFailureReason {
  if (reason === 'over') return 'game-over';
  return (reason as CommandFailureReason | undefined) ?? 'invalid';
}

/**
 * 정본 명령 실행기. 검증과 상태 변경이 이 한 경로에 있다.
 * 실패한 명령은 상태를 변경하지 않고, 성공한 명령은 순번을 올리고 정본 이벤트를 반환한다.
 */
export function executeCommand(state: GameState, command: GameCommand): CommandExecutionResult {
  if (command.v !== COMMAND_SCHEMA_VERSION) return fail('bad-schema');
  if (state.over) return fail('game-over');
  if (command.seq !== (state.cmdSeq ?? 0)) return fail('wrong-seq');
  if (command.turn !== state.turn) return fail('wrong-turn');
  if (command.faction !== state.current) return fail('wrong-faction');

  let result: CommandExecutionResult;
  switch (command.type) {
    case 'move-unit':
      result = execMove(state, command);
      break;
    case 'attack-unit':
      result = execAttack(state, command);
      break;
    case 'produce-unit':
      result = execProduce(state, command);
      break;
    case 'end-phase':
      result = execEndPhase(state, command);
      break;
  }
  if (!result.ok) return result;
  state.cmdSeq = (state.cmdSeq ?? 0) + 1;
  // 기록은 게임 시작 시 초기화된 로그에만 쌓는다(기록 없이 시작된 구버전 저장은 부분 리플레이를 만들지 않는다)
  if (state.commandLog) state.commandLog.push(command);
  if (state.over) result.events.push(...gameEndEvents(state));
  return result;
}

function execMove(state: GameState, cmd: MoveUnitCommand): CommandExecutionResult {
  const unit = unitById(state, cmd.unitId);
  if (!unit) return fail('no-unit');
  if (unit.faction !== cmd.faction) return fail('not-your-unit');
  const from = { q: unit.q, r: unit.r };
  const unitType = unit.type;
  const prevOwner = tileAt(state, cmd.to.q, cmd.to.r)?.owner;
  const goldBefore = state.factions[cmd.faction].gold;

  const r = moveUnit(state, cmd.unitId, cmd.to);
  if (!r.ok) return fail(mapReason(r.reason));

  const events: GameEvent[] = [
    {
      type: 'unit-moved',
      unitId: cmd.unitId,
      faction: cmd.faction,
      unitType,
      from,
      to: { q: cmd.to.q, r: cmd.to.r },
      path: r.path!,
    },
  ];
  if (r.captured) {
    events.push({
      type: 'building-captured',
      at: { q: cmd.to.q, r: cmd.to.r },
      building: r.captured.building!,
      ...(prevOwner !== undefined ? { prevOwner } : {}),
      newOwner: cmd.faction,
      byUnitId: cmd.unitId,
    });
    const bonus = state.factions[cmd.faction].gold - goldBefore;
    if (bonus > 0) {
      events.push({
        type: 'gold-changed',
        faction: cmd.faction,
        delta: bonus,
        gold: state.factions[cmd.faction].gold,
        reason: 'capture-bonus',
      });
    }
  }
  return { ok: true, events };
}

function execAttack(state: GameState, cmd: AttackUnitCommand): CommandExecutionResult {
  const attacker = unitById(state, cmd.attackerId);
  const defender = unitById(state, cmd.defenderId);
  if (!attacker || !defender) return fail('no-unit');
  if (attacker.faction !== cmd.faction) return fail('not-your-unit');
  // 공격 시점 정보 보존: 사망으로 상태에서 사라져도 이벤트에는 남는다
  const aPos = { q: attacker.q, r: attacker.r };
  const dPos = { q: defender.q, r: defender.r };
  const aInfo = { faction: attacker.faction, type: attacker.type, hp: attacker.hp };
  const dInfo = { faction: defender.faction, type: defender.type, hp: defender.hp };

  const r = attack(state, cmd.attackerId, cmd.defenderId);
  if (!r.ok) return fail(mapReason(r.reason));

  const events: GameEvent[] = [
    {
      type: 'unit-attacked',
      attackerId: cmd.attackerId,
      attackerFaction: aInfo.faction,
      attackerType: aInfo.type,
      from: aPos,
      defenderId: cmd.defenderId,
      defenderFaction: dInfo.faction,
      defenderType: dInfo.type,
      at: dPos,
      damage: r.damage!,
    },
    {
      type: 'unit-damaged',
      unitId: cmd.defenderId,
      damage: r.damage!,
      hp: Math.max(0, dInfo.hp - r.damage!),
    },
  ];
  if (r.defenderDied) {
    events.push({
      type: 'unit-died',
      unitId: cmd.defenderId,
      faction: dInfo.faction,
      unitType: dInfo.type,
      at: dPos,
    });
  }
  if (r.counterDamage !== undefined) {
    events.push(
      {
        type: 'unit-countered',
        unitId: cmd.defenderId,
        targetId: cmd.attackerId,
        from: dPos,
        at: aPos,
        damage: r.counterDamage,
      },
      {
        type: 'unit-damaged',
        unitId: cmd.attackerId,
        damage: r.counterDamage,
        hp: Math.max(0, aInfo.hp - r.counterDamage),
      },
    );
    if (r.attackerDied) {
      events.push({
        type: 'unit-died',
        unitId: cmd.attackerId,
        faction: aInfo.faction,
        unitType: aInfo.type,
        at: aPos,
      });
    }
  }
  return { ok: true, events };
}

function execProduce(state: GameState, cmd: ProduceUnitCommand): CommandExecutionResult {
  const goldBefore = state.factions[cmd.faction].gold;
  const r = produceUnit(state, cmd.faction, cmd.at, cmd.unitType);
  if (!r.ok) return fail(mapReason(r.reason));
  const gold = state.factions[cmd.faction].gold;
  const cost = goldBefore - gold;
  return {
    ok: true,
    events: [
      {
        type: 'unit-produced',
        unitId: r.unit!.id,
        faction: cmd.faction,
        unitType: cmd.unitType,
        at: { q: cmd.at.q, r: cmd.at.r },
        cost,
      },
      { type: 'gold-changed', faction: cmd.faction, delta: -cost, gold, reason: 'production' },
    ],
  };
}

function execEndPhase(state: GameState, cmd: EndPhaseCommand): CommandExecutionResult {
  const turnBefore = state.turn;
  const goldBefore = {} as Record<FactionId, number>;
  for (const fid of state.order) goldBefore[fid] = state.factions[fid].gold;
  const holdBefore = state.crownHold ? { ...state.crownHold } : undefined;
  const roundEnds = state.order.indexOf(state.current) === state.order.length - 1;

  advancePhase(state);

  const events: GameEvent[] = [
    {
      type: 'phase-ended',
      faction: cmd.faction,
      ...(state.over ? {} : { next: state.current }),
    },
  ];
  if (roundEnds) {
    for (const fid of state.order) {
      const amount = state.factions[fid].gold - goldBefore[fid];
      if (amount > 0) {
        events.push({
          type: 'income-granted',
          faction: fid,
          amount,
          gold: state.factions[fid].gold,
        });
      }
    }
    const hold = holdVictoryCondition(state);
    if (
      hold &&
      state.crownHold &&
      (holdBefore?.owner !== state.crownHold.owner || holdBefore?.turns !== state.crownHold.turns)
    ) {
      events.push({
        type: 'crown-hold-changed',
        ...(state.crownHold.owner ? { owner: state.crownHold.owner } : {}),
        turns: state.crownHold.turns,
        required: hold.turns,
      });
    }
    if (!state.over && state.turn !== turnBefore) {
      events.push({ type: 'turn-started', turn: state.turn });
    }
  }
  return { ok: true, events };
}

/** 게임 종료 시점의 목표 달성·승자·별점 이벤트. */
function gameEndEvents(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  const me = state.config.humanFaction;
  if (state.winner === me) {
    state.objectives.victory.forEach((condition, index) => {
      if (victoryMet(state, condition, factionScore)) {
        events.push({ type: 'objective-completed', index, condition });
      }
    });
  }
  events.push({
    type: 'game-ended',
    winner: state.winner ?? 'draw',
    turn: Math.min(state.turn, state.maxTurns),
  });
  if (state.objectives.stars.length > 0) {
    const earned = starsEarned(state);
    events.push({ type: 'star-awarded', earned, count: earned.filter(Boolean).length });
  }
  return events;
}

// 한 줄 목적: 이동·전투·점령·생산·턴 진행·승패 판정 등 게임 규칙 엔진을 구현한다
import { buildingsOf, tileAt, unitAt, unitById, unitsOf } from './board';
import {
  BUILDING_DEF_BONUS,
  BUILDING_INCOME,
  DEFAULT_MAX_TURNS,
  FACTION_IDS,
  MAX_UNITS_PER_FACTION,
  SCORE_WEIGHTS,
  START_GOLD,
  TERRAIN_RULES,
  UNIT_STATS,
} from './data';
import { hexDistance, hexKey, neighbors } from './hex';
import { generateMap } from './map';
import { movementRange, reconstructPath } from './pathfind';
import type { Axial, FactionId, GameState, Tile, Unit, UnitTypeId } from './types';

export function newGame(seed: number, maxTurns: number = DEFAULT_MAX_TURNS): GameState {
  const { tiles, capitals } = generateMap(seed);
  const state: GameState = {
    seed,
    turn: 1,
    maxTurns,
    current: 'player',
    tiles,
    units: [],
    factions: {
      player: { id: 'player', gold: START_GOLD, eliminated: false },
      ai1: { id: 'ai1', gold: START_GOLD, eliminated: false },
      ai2: { id: 'ai2', gold: START_GOLD, eliminated: false },
    },
    nextUnitId: 1,
    over: false,
    stats: { kills: 0, produced: 0, captured: 0 },
  };

  // 시작 유닛: 각 세력 수도 인접에 보병·궁병 1기씩
  for (const fid of FACTION_IDS) {
    const cap = capitals[fid];
    const spots = neighbors(cap).filter((n) => {
      const t = tileAt(state, n.q, n.r);
      return t && t.terrain !== 'water' && !unitAt(state, n.q, n.r);
    });
    const types: UnitTypeId[] = ['infantry', 'archer'];
    types.forEach((type, i) => {
      const spot = spots[i] ?? cap;
      spawnUnit(state, fid, type, spot);
    });
  }
  return state;
}

function spawnUnit(state: GameState, faction: FactionId, type: UnitTypeId, pos: Axial): Unit {
  const unit: Unit = {
    id: state.nextUnitId++,
    type,
    faction,
    q: pos.q,
    r: pos.r,
    hp: UNIT_STATS[type].hp,
    moved: false,
    attacked: false,
  };
  state.units.push(unit);
  return unit;
}

export function terrainDefBonus(tile: Tile): number {
  let def = TERRAIN_RULES[tile.terrain].def;
  if (tile.building) def += BUILDING_DEF_BONUS[tile.building];
  return def;
}

/** 결정론적 피해 계산: 최소 1의 피해를 보장한다. */
export function computeDamage(attacker: Unit, defender: Unit, defenderTile: Tile): number {
  const atk = UNIT_STATS[attacker.type].atk;
  const def = UNIT_STATS[defender.type].def + terrainDefBonus(defenderTile);
  return Math.max(1, atk - def);
}

export interface MoveResult {
  ok: boolean;
  path?: Axial[];
  captured?: Tile;
  reason?: string;
}

export function moveUnit(state: GameState, unitId: number, dest: Axial): MoveResult {
  const unit = unitById(state, unitId);
  if (!unit || state.over) return { ok: false, reason: 'invalid' };
  if (unit.moved) return { ok: false, reason: 'already-moved' };
  if (unitAt(state, dest.q, dest.r)) return { ok: false, reason: 'occupied' };
  const reach = movementRange(state, unit);
  const key = hexKey(dest.q, dest.r);
  if (!reach.has(key)) return { ok: false, reason: 'out-of-range' };
  const path = reconstructPath(reach, dest)!;

  unit.q = dest.q;
  unit.r = dest.r;
  unit.moved = true;

  let captured: Tile | undefined;
  const tile = tileAt(state, dest.q, dest.r)!;
  if (tile.building && tile.owner !== unit.faction) {
    tile.owner = unit.faction;
    captured = tile;
    if (unit.faction === 'player') state.stats.captured++;
    evaluateVictory(state);
  }
  return { ok: true, path, captured };
}

/** 현 위치에서 공격 가능한 적 유닛 목록을 반환한다. */
export function attackTargets(state: GameState, unit: Unit): Unit[] {
  if (unit.attacked) return [];
  const range = UNIT_STATS[unit.type].range;
  return state.units.filter(
    (u) => u.faction !== unit.faction && hexDistance(unit, u) <= range,
  );
}

export interface AttackResult {
  ok: boolean;
  damage?: number;
  counterDamage?: number;
  defenderDied?: boolean;
  attackerDied?: boolean;
  reason?: string;
}

export function attack(state: GameState, attackerId: number, defenderId: number): AttackResult {
  const attacker = unitById(state, attackerId);
  const defender = unitById(state, defenderId);
  if (!attacker || !defender || state.over) return { ok: false, reason: 'invalid' };
  if (attacker.faction === defender.faction) return { ok: false, reason: 'friendly' };
  if (attacker.attacked) return { ok: false, reason: 'already-attacked' };
  const range = UNIT_STATS[attacker.type].range;
  const dist = hexDistance(attacker, defender);
  if (dist > range) return { ok: false, reason: 'out-of-range' };

  const defTile = tileAt(state, defender.q, defender.r)!;
  const damage = computeDamage(attacker, defender, defTile);
  defender.hp -= damage;
  attacker.attacked = true;
  attacker.moved = true; // 공격하면 그 턴 이동 종료

  let counterDamage: number | undefined;
  let defenderDied = false;
  let attackerDied = false;

  if (defender.hp <= 0) {
    defenderDied = true;
    removeUnit(state, defender.id);
    if (attacker.faction === 'player') state.stats.kills++;
  } else if (hexDistance(attacker, defender) <= UNIT_STATS[defender.type].range) {
    const atkTile = tileAt(state, attacker.q, attacker.r)!;
    counterDamage = computeDamage(defender, attacker, atkTile);
    attacker.hp -= counterDamage;
    if (attacker.hp <= 0) {
      attackerDied = true;
      removeUnit(state, attacker.id);
      if (defender.faction === 'player') state.stats.kills++;
    }
  }
  evaluateVictory(state);
  return { ok: true, damage, counterDamage, defenderDied, attackerDied };
}

function removeUnit(state: GameState, unitId: number): void {
  state.units = state.units.filter((u) => u.id !== unitId);
}

export interface ProduceResult {
  ok: boolean;
  unit?: Unit;
  reason?: string;
}

/** 소유한 수도·마을 타일에서 유닛을 생산한다. 타일이 비어 있어야 한다. */
export function produceUnit(
  state: GameState,
  faction: FactionId,
  at: Axial,
  type: UnitTypeId,
): ProduceResult {
  if (state.over) return { ok: false, reason: 'over' };
  const tile = tileAt(state, at.q, at.r);
  if (!tile || !tile.building || tile.owner !== faction) return { ok: false, reason: 'not-owned' };
  if (unitAt(state, at.q, at.r)) return { ok: false, reason: 'occupied' };
  const fs = state.factions[faction];
  const cost = UNIT_STATS[type].cost;
  if (fs.gold < cost) return { ok: false, reason: 'no-gold' };
  if (unitsOf(state, faction).length >= MAX_UNITS_PER_FACTION)
    return { ok: false, reason: 'unit-cap' };
  fs.gold -= cost;
  const unit = spawnUnit(state, faction, type, at);
  unit.moved = true;
  unit.attacked = true; // 생산 턴에는 행동 불가
  if (faction === 'player') state.stats.produced++;
  return { ok: true, unit };
}

/** 세력별 지배 점수를 계산한다. */
export function factionScore(state: GameState, faction: FactionId): number {
  let score = 0;
  for (const t of buildingsOf(state, faction)) {
    score += t.building === 'capital' ? SCORE_WEIGHTS.capital : SCORE_WEIGHTS.village;
  }
  score += unitsOf(state, faction).length * SCORE_WEIGHTS.unit;
  return score;
}

function capitalsOwned(state: GameState, faction: FactionId): number {
  return state.tiles.filter((t) => t.building === 'capital' && t.owner === faction).length;
}

/** 승패를 판정한다. 상태의 over/winner를 갱신한다. */
export function evaluateVictory(state: GameState): void {
  if (state.over) return;
  // 세력 소멸 판정: 수도가 없고 유닛도 없으면 탈락
  for (const fid of FACTION_IDS) {
    const fs = state.factions[fid];
    if (!fs.eliminated && capitalsOwned(state, fid) === 0 && unitsOf(state, fid).length === 0) {
      fs.eliminated = true;
    }
  }
  const playerOut = state.factions.player.eliminated;
  const aiOut = state.factions.ai1.eliminated && state.factions.ai2.eliminated;
  // 플레이어가 모든 수도를 점령하면 즉시 승리
  if (capitalsOwned(state, 'player') === 3 || aiOut) {
    state.over = true;
    state.winner = 'player';
    return;
  }
  if (playerOut) {
    state.over = true;
    state.winner = factionScore(state, 'ai1') >= factionScore(state, 'ai2') ? 'ai1' : 'ai2';
    return;
  }
}

/** 제한 턴 종료 시 점수로 승자를 결정한다. */
export function evaluateTurnLimit(state: GameState): void {
  if (state.over) return;
  if (state.turn <= state.maxTurns) return;
  const scores = FACTION_IDS.map((f) => ({ f, s: factionScore(state, f) }));
  scores.sort((a, b) => b.s - a.s);
  state.over = true;
  if (scores[0].s === scores[1].s && scores[0].f !== 'player' && scores[1].f !== 'player') {
    state.winner = scores[0].f;
  } else if (scores[0].s === scores[1].s) {
    // 동점에 플레이어가 포함되면 무승부 대신 플레이어 패배 방지: 무승부 처리
    state.winner = scores[0].f === 'player' || scores[1].f === 'player' ? 'draw' : scores[0].f;
  } else {
    state.winner = scores[0].f;
  }
}

/** 세력 하나의 페이즈를 마치고 다음 세력 또는 다음 턴으로 넘어간다. */
export function advancePhase(state: GameState): void {
  if (state.over) return;
  const order: FactionId[] = ['player', 'ai1', 'ai2'];
  const idx = order.indexOf(state.current);
  if (idx < order.length - 1) {
    state.current = order[idx + 1];
    return;
  }
  // 턴 종료: 자원 생산·유닛 행동 초기화
  for (const fid of FACTION_IDS) {
    const fs = state.factions[fid];
    if (fs.eliminated) continue;
    for (const t of buildingsOf(state, fid)) {
      fs.gold += BUILDING_INCOME[t.building!];
    }
  }
  for (const u of state.units) {
    u.moved = false;
    u.attacked = false;
  }
  state.turn++;
  state.current = 'player';
  evaluateTurnLimit(state);
}

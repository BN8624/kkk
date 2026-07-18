// 한 줄 목적: 이동·전투·점령·생산·턴 진행·승패 판정 등 게임 규칙 엔진을 구현한다
import { buildingsOf, humanFaction, tileAt, unitAt, unitById, unitsOf } from './board';
import {
  BUILDING_DEF_BONUS,
  BUILDING_INCOME,
  DEFAULT_MAX_TURNS,
  FACTION_IDS,
  MAX_UNITS_PER_FACTION,
  SCORE_WEIGHTS,
  TERRAIN_RULES,
  UNIT_STATS,
} from './data';
import {
  AZURE_BULWARK_DEF,
  CRIMSON_CHARGE_ATK,
  DOCTRINES,
  HIGHGROUND_TERRAINS,
  VIOLET_HIGHGROUND_ATK,
} from './doctrines';
import { hexDistance, hexKey, neighbors } from './hex';
import { generateScenarioMap } from './map';
import { movementRange, reconstructPath } from './pathfind';
import { SCENARIOS } from './scenarios';
import type {
  Axial,
  FactionId,
  GameConfig,
  GameState,
  Tile,
  Unit,
  UnitTypeId,
} from './types';

export const DEFAULT_CONFIG: GameConfig = {
  mode: 'quick',
  scenario: 'three-crowns',
  difficulty: 'normal',
  humanFaction: 'azure',
};

export function newGame(
  seed: number,
  config: Partial<GameConfig> = {},
  maxTurnsOverride?: number,
): GameState {
  const cfg: GameConfig = { ...DEFAULT_CONFIG, ...config };
  const scenario = SCENARIOS[cfg.scenario];
  const maxTurns = maxTurnsOverride ?? scenario.maxTurns ?? DEFAULT_MAX_TURNS;
  const { tiles, capitals } = generateScenarioMap(cfg.scenario, seed);
  const controllers = {} as GameState['controllers'];
  const factions = {} as GameState['factions'];
  const stats = {} as GameState['stats'];
  for (const fid of FACTION_IDS) {
    controllers[fid] = fid === cfg.humanFaction ? 'human' : 'ai';
    factions[fid] = { id: fid, gold: DOCTRINES[fid].startGold, eliminated: false };
    stats[fid] = { kills: 0, produced: 0, captured: 0 };
  }
  const state: GameState = {
    seed,
    config: cfg,
    turn: 1,
    maxTurns,
    order: [...FACTION_IDS],
    current: FACTION_IDS[0],
    controllers,
    tiles,
    units: [],
    factions,
    nextUnitId: 1,
    over: false,
    stats,
  };
  if (scenario.victory === 'crown-hold') {
    state.crownHold = { owner: null, turns: 0 };
  }

  // 시작 유닛: 각 세력 교리에 따른 시작 배치를 수도 인접에 놓는다
  for (const fid of FACTION_IDS) {
    const cap = capitals[fid];
    const spots = neighbors(cap).filter((n) => {
      const t = tileAt(state, n.q, n.r);
      return t && t.terrain !== 'water' && !unitAt(state, n.q, n.r);
    });
    DOCTRINES[fid].startUnits.forEach((type, i) => {
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

/** 교리에 따른 방어 보너스(청람 보루: 보병이 숲·산·거점에서 +1). */
export function doctrineDefBonus(unit: Unit, tile: Tile): number {
  if (
    unit.faction === 'azure' &&
    unit.type === 'infantry' &&
    (HIGHGROUND_TERRAINS.includes(tile.terrain) || tile.building)
  ) {
    return AZURE_BULWARK_DEF;
  }
  return 0;
}

/** 교리에 따른 공격 보너스(진홍 돌격·자원 고지 사격). 반격에는 적용되지 않는다. */
export function doctrineAtkBonus(
  unit: Unit,
  attackerTile: Tile,
  moved: boolean,
  counter: boolean,
): number {
  if (counter) return 0;
  if (unit.faction === 'crimson' && unit.type === 'cavalry' && moved) return CRIMSON_CHARGE_ATK;
  if (
    unit.faction === 'violet' &&
    unit.type === 'archer' &&
    HIGHGROUND_TERRAINS.includes(attackerTile.terrain)
  ) {
    return VIOLET_HIGHGROUND_ATK;
  }
  return 0;
}

/** 세력 교리를 반영한 병과 생산 비용. */
export function unitCost(faction: FactionId, type: UnitTypeId): number {
  return UNIT_STATS[type].cost + (DOCTRINES[faction].unitCostDelta[type] ?? 0);
}

export interface DamageBreakdown {
  base: number;
  atkBonus: number;
  defense: number;
  terrainDef: number;
  doctrineDef: number;
  total: number;
}

interface DamageOpts {
  /** 공격자가 이 위치에서 공격한다고 가정(이동 후 공격 예측용) */
  attackerPos?: Axial;
  /** 공격 시점의 이동 여부 가정(돌격 판정용) */
  attackerMoved?: boolean;
  /** 반격 계산 여부(반격에는 공격 교리 보너스가 없다) */
  counter?: boolean;
  /** 피격자가 이 위치에 있다고 가정(반격 예측용) */
  defenderPos?: Axial;
}

/** 결정론적 피해 계산: 최소 1의 피해를 보장한다. 실전·예측 UI·AI가 모두 이 함수를 쓴다. */
export function damageBreakdown(
  state: GameState,
  attacker: Unit,
  defender: Unit,
  opts: DamageOpts = {},
): DamageBreakdown {
  const atkPos = opts.attackerPos ?? attacker;
  const defPos = opts.defenderPos ?? defender;
  const atkTile = tileAt(state, atkPos.q, atkPos.r)!;
  const defTile = tileAt(state, defPos.q, defPos.r)!;
  const moved = opts.attackerMoved ?? attacker.moved;
  const base = UNIT_STATS[attacker.type].atk;
  const atkBonus = doctrineAtkBonus(attacker, atkTile, moved, opts.counter ?? false);
  const defense = UNIT_STATS[defender.type].def;
  const terrainDef = terrainDefBonus(defTile);
  const doctrineDef = doctrineDefBonus(defender, defTile);
  const total = Math.max(1, base + atkBonus - defense - terrainDef - doctrineDef);
  return { base, atkBonus, defense, terrainDef, doctrineDef, total };
}

export interface AttackForecast {
  damage: DamageBreakdown;
  counter: DamageBreakdown | null;
  defenderDies: boolean;
  attackerDies: boolean;
}

/** 공격 결과 예측. attack()과 동일한 계산을 공유하므로 UI 예측과 실제 결과가 항상 일치한다. */
export function forecastAttack(
  state: GameState,
  attacker: Unit,
  defender: Unit,
  opts: { attackerPos?: Axial; attackerMoved?: boolean } = {},
): AttackForecast {
  const damage = damageBreakdown(state, attacker, defender, opts);
  const defenderDies = damage.total >= defender.hp;
  const pos = opts.attackerPos ?? attacker;
  let counter: DamageBreakdown | null = null;
  let attackerDies = false;
  if (!defenderDies && hexDistance(pos, defender) <= UNIT_STATS[defender.type].range) {
    counter = damageBreakdown(state, defender, attacker, {
      counter: true,
      defenderPos: { q: pos.q, r: pos.r },
    });
    attackerDies = counter.total >= attacker.hp;
  }
  return { damage, counter, defenderDies, attackerDies };
}

export interface MoveResult {
  ok: boolean;
  path?: Axial[];
  captured?: Tile;
  /** 점령 교리 보너스로 즉시 획득한 금 */
  bonusGold?: number;
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
  let bonusGold = 0;
  const tile = tileAt(state, dest.q, dest.r)!;
  if (tile.building && tile.owner !== unit.faction) {
    tile.owner = unit.faction;
    captured = tile;
    state.stats[unit.faction].captured++;
    bonusGold = DOCTRINES[unit.faction].captureGold;
    if (bonusGold > 0) state.factions[unit.faction].gold += bonusGold;
    evaluateVictory(state);
  }
  return { ok: true, path, captured, bonusGold: bonusGold || undefined };
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

  const fc = forecastAttack(state, attacker, defender);
  const damage = fc.damage.total;
  defender.hp -= damage;
  attacker.attacked = true;
  attacker.moved = true; // 공격하면 그 턴 이동 종료

  let counterDamage: number | undefined;
  let defenderDied = false;
  let attackerDied = false;

  if (defender.hp <= 0) {
    defenderDied = true;
    removeUnit(state, defender.id);
    state.stats[attacker.faction].kills++;
  } else if (fc.counter) {
    counterDamage = fc.counter.total;
    attacker.hp -= counterDamage;
    if (attacker.hp <= 0) {
      attackerDied = true;
      removeUnit(state, attacker.id);
      state.stats[defender.faction].kills++;
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
  const cost = unitCost(faction, type);
  if (fs.gold < cost) return { ok: false, reason: 'no-gold' };
  if (unitsOf(state, faction).length >= MAX_UNITS_PER_FACTION)
    return { ok: false, reason: 'unit-cap' };
  fs.gold -= cost;
  const unit = spawnUnit(state, faction, type, at);
  unit.moved = true;
  unit.attacked = true; // 생산 턴에는 행동 불가
  state.stats[faction].produced++;
  return { ok: true, unit };
}

/** 세력별 지배 점수를 계산한다. */
export function factionScore(state: GameState, faction: FactionId): number {
  let score = 0;
  for (const t of buildingsOf(state, faction)) {
    score +=
      t.building === 'capital'
        ? SCORE_WEIGHTS.capital
        : t.building === 'crown'
          ? SCORE_WEIGHTS.crown
          : SCORE_WEIGHTS.village;
  }
  score += unitsOf(state, faction).length * SCORE_WEIGHTS.unit;
  return score;
}

function capitalsOwned(state: GameState, faction: FactionId): number {
  return state.tiles.filter((t) => t.building === 'capital' && t.owner === faction).length;
}

function totalCapitals(state: GameState): number {
  return state.tiles.filter((t) => t.building === 'capital').length;
}

/** 점수 순으로 정렬해 승자를 정한다. 동점에 인간 세력이 끼면 무승부. */
function scoreWinner(state: GameState, candidates: FactionId[]): FactionId | 'draw' {
  const scores = candidates.map((f) => ({ f, s: factionScore(state, f) }));
  scores.sort((a, b) => b.s - a.s || state.order.indexOf(a.f) - state.order.indexOf(b.f));
  const top = scores.filter((x) => x.s === scores[0].s);
  if (top.length > 1 && top.some((x) => x.f === humanFaction(state))) return 'draw';
  return top[0].f;
}

/** 승패를 판정한다. 상태의 over/winner를 갱신한다. */
export function evaluateVictory(state: GameState): void {
  if (state.over) return;
  // 세력 소멸 판정: 수도가 없고 유닛도 없으면 탈락
  for (const fid of state.order) {
    const fs = state.factions[fid];
    if (!fs.eliminated && capitalsOwned(state, fid) === 0 && unitsOf(state, fid).length === 0) {
      fs.eliminated = true;
    }
  }
  // 한 세력이 모든 수도를 점령하면 즉시 승리
  const total = totalCapitals(state);
  for (const fid of state.order) {
    if (total > 0 && capitalsOwned(state, fid) === total) {
      state.over = true;
      state.winner = fid;
      return;
    }
  }
  const alive = state.order.filter((f) => !state.factions[f].eliminated);
  if (alive.length === 1) {
    state.over = true;
    state.winner = alive[0];
    return;
  }
  // 인간 세력이 탈락하면 게임 종료: 남은 세력 중 최고 점수가 승자
  if (state.factions[humanFaction(state)].eliminated) {
    state.over = true;
    const winner = scoreWinner(state, alive);
    state.winner = winner === 'draw' ? alive[0] : winner;
  }
}

/** 제한 턴 종료 시 점수로 승자를 결정한다. */
export function evaluateTurnLimit(state: GameState): void {
  if (state.over) return;
  if (state.turn <= state.maxTurns) return;
  state.over = true;
  state.winner = scoreWinner(state, state.order);
}

/** 세력 하나의 페이즈를 마치고 다음 세력 또는 다음 턴으로 넘어간다. */
export function advancePhase(state: GameState): void {
  if (state.over) return;
  const idx = state.order.indexOf(state.current);
  if (idx < state.order.length - 1) {
    state.current = state.order[idx + 1];
    return;
  }
  // 턴 종료: 자원 생산·유닛 행동 초기화(자원 후국은 마을 수입 보너스)
  for (const fid of state.order) {
    const fs = state.factions[fid];
    if (fs.eliminated) continue;
    for (const t of buildingsOf(state, fid)) {
      fs.gold += BUILDING_INCOME[t.building!];
      if (t.building === 'village') fs.gold += DOCTRINES[fid].villageIncomeBonus;
    }
  }
  for (const u of state.units) {
    u.moved = false;
    u.attacked = false;
  }
  // 왕관의 심장: 라운드 종료 시 연속 보유 판정
  if (state.crownHold) {
    const crownTile = state.tiles.find((t) => t.building === 'crown');
    const owner = crownTile?.owner ?? null;
    if (owner && owner === state.crownHold.owner) state.crownHold.turns++;
    else state.crownHold = { owner, turns: owner ? 1 : 0 };
    const need = SCENARIOS[state.config.scenario].crownHoldTurns ?? Infinity;
    if (owner && state.crownHold.turns >= need) {
      state.over = true;
      state.winner = owner;
      return;
    }
  }
  state.turn++;
  state.current = state.order[0];
  evaluateTurnLimit(state);
}

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
  VIOLET_ARCHER_RANGE,
} from './doctrines';
import { hexDistance, hexKey } from './hex';
import { movementRange, reconstructPath } from './pathfind';
import { isBuiltinScenarioId } from './scenarios';
import { builtinScenarioSnapshot, objectivesFromSnapshot } from './scenario/builtin';
import { crownContestFlags } from './scenario/crown-status';
import {
  defeatMet,
  hasConquest,
  holdVictoryCondition,
  victoryMet,
} from './scenario/objectives';
import type { ScenarioRuntimeSnapshot } from './scenario/types';
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

/** 내장 시나리오로 새 게임을 시작한다(스냅샷 생성 → 상태 구성 경로를 항상 거친다). */
export function newGame(
  seed: number,
  config: Partial<GameConfig> = {},
  maxTurnsOverride?: number,
): GameState {
  const cfg: GameConfig = { ...DEFAULT_CONFIG, ...config };
  if (!isBuiltinScenarioId(cfg.scenario)) {
    throw new Error(`내장 시나리오가 아닙니다: ${cfg.scenario} (newGameFromScenario를 사용하세요)`);
  }
  const snapshot = builtinScenarioSnapshot(cfg.scenario, seed, cfg.humanFaction);
  return newGameFromScenario(seed, snapshot, cfg, maxTurnsOverride);
}

/**
 * 정규화된 시나리오 스냅샷으로 새 게임을 시작한다.
 * 내장 시나리오는 시드로 재구성 가능하므로 스냅샷을 상태에 넣지 않고,
 * 커스텀·캠페인 시나리오는 이어하기·리플레이 재현을 위해 스냅샷을 상태에 포함한다.
 */
export function newGameFromScenario(
  seed: number,
  snapshot: ScenarioRuntimeSnapshot,
  config: Partial<GameConfig> = {},
  maxTurnsOverride?: number,
): GameState {
  const humanSetup = snapshot.factions.find((f) => f.active && f.controller === 'human');
  const cfg: GameConfig = {
    ...DEFAULT_CONFIG,
    scenario: snapshot.id,
    ...config,
    ...(humanSetup ? { humanFaction: humanSetup.id } : {}),
  };
  if (cfg.modifier === undefined && snapshot.rules.modifier !== undefined) {
    cfg.modifier = snapshot.rules.modifier;
  }
  let maxTurns = maxTurnsOverride ?? snapshot.rules.maxTurns ?? DEFAULT_MAX_TURNS;
  if (cfg.modifier === 'short-war') maxTurns = Math.max(6, maxTurns - 2);

  const controllers = {} as GameState['controllers'];
  const factions = {} as GameState['factions'];
  const stats = {} as GameState['stats'];
  for (const fid of FACTION_IDS) {
    const setup = snapshot.factions.find((f) => f.id === fid);
    const active = setup?.active ?? false;
    controllers[fid] = fid === cfg.humanFaction ? 'human' : 'ai';
    let gold = active ? (setup?.startGold ?? DOCTRINES[fid].startGold) : 0;
    if (cfg.modifier === 'poor-start') gold = Math.max(0, gold - 15);
    factions[fid] = { id: fid, gold, eliminated: !active };
    stats[fid] = { kills: 0, produced: 0, captured: 0, lost: 0 };
  }
  const isBuiltin =
    isBuiltinScenarioId(snapshot.id) && snapshot.generatedFromSeed !== undefined;
  const state: GameState = {
    seed,
    config: cfg,
    turn: 1,
    maxTurns,
    order: [...FACTION_IDS],
    current: FACTION_IDS[0],
    controllers,
    tiles: snapshot.board.tiles.map((t) => ({ ...t })),
    units: [],
    factions,
    nextUnitId: 1,
    over: false,
    stats,
    objectives: objectivesFromSnapshot(snapshot),
    cmdSeq: 0,
    commandLog: [],
  };
  if (!isBuiltin) state.customScenario = snapshot;
  if (holdVictoryCondition(state)) {
    state.crownHold = { owner: null, turns: 0 };
  }
  for (const su of snapshot.units) {
    const unit = spawnUnit(state, su.faction, su.type, su, su.hp);
    if (su.tag !== undefined) unit.tag = su.tag;
    if (!su.canAct) {
      unit.moved = true;
      unit.attacked = true;
    }
  }
  return state;
}

function spawnUnit(
  state: GameState,
  faction: FactionId,
  type: UnitTypeId,
  pos: Axial,
  hp?: number,
): Unit {
  const unit: Unit = {
    id: state.nextUnitId++,
    type,
    faction,
    q: pos.q,
    r: pos.r,
    hp: hp ?? UNIT_STATS[type].hp,
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

/** 교리에 따른 공격 보너스(진홍 돌격). 반격에는 적용되지 않는다. */
export function doctrineAtkBonus(
  unit: Unit,
  _attackerTile: Tile,
  moved: boolean,
  counter: boolean,
): number {
  if (counter) return 0;
  if (unit.faction === 'crimson' && unit.type === 'cavalry' && moved) return CRIMSON_CHARGE_ATK;
  return 0;
}

/** 교리를 반영한 유닛 사거리(자원 장궁: 궁병 사거리 +1). 공격·반격·UI가 모두 이 함수를 쓴다. */
export function unitRange(unit: Unit): number {
  let range = UNIT_STATS[unit.type].range;
  if (unit.faction === 'violet' && unit.type === 'archer') range += VIOLET_ARCHER_RANGE;
  return range;
}

/** 세력 교리·일일 수정자를 반영한 병과 생산 비용. */
export function unitCost(faction: FactionId, type: UnitTypeId, modifier?: string): number {
  let cost = UNIT_STATS[type].cost + (DOCTRINES[faction].unitCostDelta[type] ?? 0);
  if (modifier === 'costly-cavalry' && type === 'cavalry') cost += 15;
  return cost;
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
  let atkBonus = doctrineAtkBonus(attacker, atkTile, moved, opts.counter ?? false);
  // 일일 수정자: 날카로운 화살(모든 궁병 공격 +1, 반격 포함)
  if (state.config.modifier === 'sharp-arrows' && attacker.type === 'archer') atkBonus += 1;
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
  if (!defenderDies && hexDistance(pos, defender) <= unitRange(defender)) {
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
  const range = unitRange(unit);
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
  const range = unitRange(attacker);
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
    state.stats[defender.faction].lost++;
  } else if (fc.counter) {
    counterDamage = fc.counter.total;
    attacker.hp -= counterDamage;
    if (attacker.hp <= 0) {
      attackerDied = true;
      removeUnit(state, attacker.id);
      state.stats[defender.faction].kills++;
      state.stats[attacker.faction].lost++;
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
  const cost = unitCost(faction, type, state.config.modifier);
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
  score += state.stats[faction].kills * SCORE_WEIGHTS.kill;
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
  // 정복 조건: 한 세력이 모든 수도를 점령하면 즉시 승리(모든 세력에 대칭 적용)
  if (hasConquest(state)) {
    const total = totalCapitals(state);
    for (const fid of state.order) {
      if (total > 0 && capitalsOwned(state, fid) === total) {
        state.over = true;
        state.winner = fid;
        return;
      }
    }
  }
  const alive = state.order.filter((f) => !state.factions[f].eliminated);
  if (alive.length === 0) {
    state.over = true;
    state.winner = 'draw';
    return;
  }
  if (alive.length === 1) {
    state.over = true;
    state.winner = alive[0];
    return;
  }
  const me = humanFaction(state);
  // 인간 세력이 탈락하면 게임 종료: 남은 세력 중 최고 점수가 승자
  if (state.factions[me].eliminated) {
    state.over = true;
    const winner = scoreWinner(state, alive);
    state.winner = winner === 'draw' ? alive[0] : winner;
    return;
  }
  // 시나리오 패배 조건(수도 상실·지정 유닛 사망·적 거점 점령 등)
  if (state.objectives.defeat.some((c) => c.type !== 'human-eliminated' && defeatMet(state, c))) {
    state.over = true;
    state.winner = enemyWinner(state, alive);
    return;
  }
  // 시나리오 승리 조건(대칭 처리되는 conquest·hold-building 제외)
  for (const c of state.objectives.victory) {
    if (c.type === 'conquest' || c.type === 'hold-building') continue;
    if (victoryMet(state, c, factionScore)) {
      state.over = true;
      state.winner = me;
      return;
    }
  }
}

/** 인간 패배 시 승자: 생존 적 세력 중 최고 점수(적이 없으면 무승부). */
function enemyWinner(state: GameState, alive: FactionId[]): FactionId | 'draw' {
  const me = humanFaction(state);
  const enemies = alive.filter((f) => f !== me);
  if (enemies.length === 0) return 'draw';
  const w = scoreWinner(state, enemies);
  return w === 'draw' ? enemies[0] : w;
}

/** 제한 턴 종료 시 판정: score 모드는 점수 승부, defeat 모드는 승리 조건 미달성 시 패배. */
export function evaluateTurnLimit(state: GameState): void {
  if (state.over) return;
  if (state.turn <= state.maxTurns) return;
  state.over = true;
  if (state.objectives.turnLimit === 'defeat') {
    const alive = state.order.filter((f) => !state.factions[f].eliminated);
    state.winner = enemyWinner(state, alive);
    return;
  }
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
      if (t.building === 'village') {
        fs.gold += DOCTRINES[fid].villageIncomeBonus;
        if (state.config.modifier === 'rich-villages') fs.gold += 5;
      }
    }
  }
  for (const u of state.units) {
    u.moved = false;
    u.attacked = false;
  }
  // hold-building 승리 조건(왕관의 심장 등): 라운드 종료 시 연속 보유 판정(대칭)
  const hold = holdVictoryCondition(state);
  if (state.crownHold && hold) {
    const crownTile = tileAt(state, hold.at.q, hold.at.r);
    const owner = crownTile?.owner ?? null;
    const activationTurn = hold.activationTurn;
    // 활성화 전: 소유만 추적하고 카운트·승리는 없다
    if (activationTurn !== undefined && state.turn < activationTurn) {
      state.crownHold = { owner, turns: 0 };
    } else if (!owner) {
      state.crownHold = { owner: null, turns: 0 };
    } else {
      const { contested } = crownContestFlags(state, hold.at, owner);
      if (owner !== state.crownHold.owner) {
        state.crownHold = { owner, turns: contested ? 0 : 1 };
      } else if (!contested) {
        state.crownHold.turns++;
      }
      if (state.crownHold.turns >= hold.turns) {
        state.over = true;
        state.winner = owner;
        return;
      }
    }
  }
  state.turn++;
  state.current = state.order[0];
  // 턴 경계에서만 달성되는 조건(생존 턴 등)을 평가한 뒤 제한 턴을 판정한다
  evaluateVictory(state);
  evaluateTurnLimit(state);
}

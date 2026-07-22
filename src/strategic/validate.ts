// 한 줄 목적: 전략 상태·전투 컨텍스트의 구조 무결성을 fail-closed로 검증한다
import { FACTION_IDS, UNIT_STATS } from '../core/data';
import { isKnownUnitType } from '../core/units';
import type { FactionId } from '../core/types';
import { deriveBattleIdentity } from './battle-identity';
import { assertSymmetricNeighbors, isRegionGraphConnected } from './map';
import type {
  StrategicArmy,
  StrategicBattleContext,
  StrategicGameState,
  StrategicRegion,
  StrategicResult,
} from './types';

function fail(reason: string): StrategicResult<true> {
  return { ok: false, reason };
}

function isFactionId(v: unknown): v is FactionId {
  return typeof v === 'string' && (FACTION_IDS as string[]).includes(v);
}

function validateRegion(r: StrategicRegion, path: string): string | null {
  if (typeof r.id !== 'string' || r.id.length === 0) return `${path}: bad id`;
  if (r.owner !== null && !isFactionId(r.owner)) return `${path}: bad owner`;
  if (!Array.isArray(r.neighbors)) return `${path}: neighbors`;
  if (r.terrain !== 'plains' && r.terrain !== 'forest' && r.terrain !== 'mountain')
    return `${path}: terrain`;
  if (!Number.isFinite(r.income) || r.income < 0) return `${path}: income`;
  if (!Number.isFinite(r.defense) || r.defense < 0) return `${path}: defense`;
  if (
    r.settlement !== undefined &&
    r.settlement !== 'capital' &&
    r.settlement !== 'town' &&
    r.settlement !== 'fort'
  )
    return `${path}: settlement`;
  return null;
}

function validateArmy(a: StrategicArmy, path: string, regionIds: Set<string>): string | null {
  if (typeof a.id !== 'string' || a.id.length === 0) return `${path}: bad id`;
  if (!isFactionId(a.faction)) return `${path}: faction`;
  if (!regionIds.has(a.regionId)) return `${path}: region`;
  if (typeof a.moved !== 'boolean') return `${path}: moved`;
  if (!Array.isArray(a.units) || a.units.length === 0) return `${path}: units empty`;
  const unitIds = new Set<string>();
  for (let i = 0; i < a.units.length; i++) {
    const u = a.units[i];
    const up = `${path}.units[${i}]`;
    if (typeof u.id !== 'string' || u.id.length === 0) return `${up}: id`;
    if (unitIds.has(u.id)) return `${up}: duplicate unit id`;
    unitIds.add(u.id);
    if (!isKnownUnitType(u.type)) return `${up}: type`;
    const maxHp = UNIT_STATS[u.type].hp;
    if (!Number.isInteger(u.hp) || u.hp < 1 || u.hp > maxHp) return `${up}: hp`;
  }
  return null;
}

function validateBattleContext(
  ctx: StrategicBattleContext,
  state: StrategicGameState,
): string | null {
  if (ctx.schemaVersion !== 1) return 'pendingBattle.schemaVersion';
  if (typeof ctx.battleId !== 'string' || ctx.battleId.length === 0) return 'pendingBattle.battleId';
  if (!Number.isInteger(ctx.strategicTurn) || ctx.strategicTurn < 1) return 'pendingBattle.turn';
  if (!Number.isInteger(ctx.battleSeed)) return 'pendingBattle.battleSeed';
  const regionIds = new Set(state.regions.map((r) => r.id));
  if (!regionIds.has(ctx.regionId)) return 'pendingBattle.regionId';
  if (!regionIds.has(ctx.attackerOriginRegionId)) return 'pendingBattle.origin';

  // 8.1 턴·인간 세력
  if (ctx.strategicTurn !== state.turn) return 'pendingBattle.strategicTurn mismatch';
  if (ctx.humanFaction !== state.humanFaction) return 'pendingBattle.humanFaction mismatch';
  if (!isFactionId(ctx.humanFaction)) return 'pendingBattle.humanFaction';

  // 8.2 군단 위치
  if (ctx.attackerOriginRegionId === ctx.regionId) return 'pendingBattle.origin equals region';
  const originRegion = state.regions.find((r) => r.id === ctx.attackerOriginRegionId);
  if (!originRegion) return 'pendingBattle.origin';
  if (!originRegion.neighbors.includes(ctx.regionId)) return 'pendingBattle.not adjacent';

  const att = state.armies.find((a) => a.id === ctx.attackerArmyId);
  const def = state.armies.find((a) => a.id === ctx.defenderArmyId);
  if (!att) return 'pendingBattle.attacker missing';
  if (!def) return 'pendingBattle.defender missing';
  if (att.id === def.id) return 'pendingBattle.same army';
  if (att.faction === def.faction) return 'pendingBattle.same faction';
  if (att.regionId !== ctx.attackerOriginRegionId) return 'pendingBattle.attacker origin mismatch';
  if (def.regionId !== ctx.regionId) return 'pendingBattle.defender region mismatch';

  // 8.3 전투 지역 점유 — 지정 방어군만, 제3 군단 없음
  const armiesAtBattle = state.armies.filter((a) => a.regionId === ctx.regionId);
  if (!armiesAtBattle.some((a) => a.id === def.id)) return 'pendingBattle.defender not at region';
  if (armiesAtBattle.some((a) => a.id !== def.id)) return 'pendingBattle.extra army at region';

  if (!Array.isArray(ctx.unitBindings) || ctx.unitBindings.length === 0)
    return 'pendingBattle.bindings empty';

  // 8.4 바인딩
  const bindingUnitIds = new Set<string>();
  const tags = new Set<string>();
  const expected = new Map<string, { armyId: string; faction: FactionId; type: string; hp: number }>();
  for (const army of [att, def]) {
    for (const u of army.units) {
      expected.set(u.id, { armyId: army.id, faction: army.faction, type: u.type, hp: u.hp });
    }
  }
  if (ctx.unitBindings.length !== expected.size) return 'pendingBattle.binding count';

  for (const b of ctx.unitBindings) {
    if (bindingUnitIds.has(b.strategicUnitId)) return 'pendingBattle.dup binding unit';
    bindingUnitIds.add(b.strategicUnitId);
    if (tags.has(b.tacticalTag)) return 'pendingBattle.dup tag';
    tags.add(b.tacticalTag);
    const exp = expected.get(b.strategicUnitId);
    if (!exp) return 'pendingBattle.unknown unit';
    if (b.armyId !== exp.armyId || b.faction !== exp.faction || b.type !== exp.type)
      return 'pendingBattle.binding mismatch';
    if (b.startingHp !== exp.hp) return 'pendingBattle.binding hp';
    if (typeof b.tacticalTag !== 'string' || b.tacticalTag.length === 0)
      return 'pendingBattle.tag';
    // 공격 바인딩은 공격군에만, 방어는 방어군에만
    if (b.armyId === att.id) {
      if (b.faction !== att.faction) return 'pendingBattle.attacker binding faction';
    } else if (b.armyId === def.id) {
      if (b.faction !== def.faction) return 'pendingBattle.defender binding faction';
    } else {
      return 'pendingBattle.binding army not participant';
    }
  }
  for (const id of expected.keys()) {
    if (!bindingUnitIds.has(id)) return 'pendingBattle.missing binding';
  }

  // 8.5 battleId·battleSeed 재계산 일치
  const identity = deriveBattleIdentity(state, {
    attackerArmyId: ctx.attackerArmyId,
    defenderArmyId: ctx.defenderArmyId,
    regionId: ctx.regionId,
    attackerOriginRegionId: ctx.attackerOriginRegionId,
  });
  if (!identity.ok) return `pendingBattle.identity: ${identity.reason}`;
  if (ctx.battleId !== identity.value.battleId) return 'pendingBattle.battleId mismatch';
  if (ctx.battleSeed !== identity.value.battleSeed) return 'pendingBattle.battleSeed mismatch';

  return null;
}

/** 전략 상태 전체 무결성 검사. 통과 시에만 ok. */
export function validateStrategicState(state: StrategicGameState): StrategicResult<true> {
  if (!state || typeof state !== 'object') return fail('not object');
  if (state.schemaVersion !== 1) return fail('schemaVersion');
  if (!Number.isInteger(state.seed)) return fail('seed');
  if (!Number.isInteger(state.turn) || state.turn < 1) return fail('turn');
  if (state.maxTurns !== 10) return fail('maxTurns');
  if (!isFactionId(state.humanFaction)) return fail('humanFaction');
  if (!isFactionId(state.currentFaction)) return fail('currentFaction');
  if (
    state.phase !== 'orders' &&
    state.phase !== 'battle' &&
    state.phase !== 'resolution' &&
    state.phase !== 'ended'
  )
    return fail('phase');
  if (state.winner !== undefined && state.winner !== 'draw' && !isFactionId(state.winner))
    return fail('winner');

  if (!Array.isArray(state.regions) || state.regions.length !== 12) return fail('region count');
  const regionIds = new Set<string>();
  for (let i = 0; i < state.regions.length; i++) {
    const r = state.regions[i];
    const err = validateRegion(r, `regions[${i}]`);
    if (err) return fail(err);
    if (regionIds.has(r.id)) return fail('duplicate region id');
    regionIds.add(r.id);
  }
  if (!assertSymmetricNeighbors(state.regions)) return fail('asymmetric neighbors');
  if (!isRegionGraphConnected(state.regions)) return fail('disconnected graph');

  if (!Array.isArray(state.armies)) return fail('armies');
  const armyIds = new Set<string>();
  const allUnitIds = new Set<string>();
  for (let i = 0; i < state.armies.length; i++) {
    const a = state.armies[i];
    const err = validateArmy(a, `armies[${i}]`, regionIds);
    if (err) return fail(err);
    if (armyIds.has(a.id)) return fail('duplicate army id');
    armyIds.add(a.id);
    for (const u of a.units) {
      if (allUnitIds.has(u.id)) return fail('duplicate unit id');
      allUnitIds.add(u.id);
    }
  }

  for (const fid of FACTION_IDS) {
    if (!Number.isInteger(state.treasury[fid]) || state.treasury[fid] < 0)
      return fail(`treasury.${fid}`);
  }

  if (state.pendingBattle) {
    const err = validateBattleContext(state.pendingBattle, state);
    if (err) return fail(err);
    if (state.phase !== 'battle') return fail('pending without battle phase');
  } else if (state.phase === 'battle') {
    return fail('battle phase without pending');
  }

  return { ok: true, value: true };
}

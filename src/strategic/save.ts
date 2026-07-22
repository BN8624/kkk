// 한 줄 목적: 전략 레이어 전용 저장 직렬화·복원(전술 three-crowns-save와 분리)
import type { FactionId } from '../core/types';
import { FACTION_IDS, UNIT_STATS } from '../core/data';
import { isKnownUnitType } from '../core/units';
import type {
  StrategicArmy,
  StrategicBattleContext,
  StrategicGameState,
  StrategicRegion,
  StrategicResult,
  StrategicUnit,
  TacticalUnitBinding,
} from './types';
import { validateStrategicState } from './validate';

export const STRATEGIC_SAVE_VERSION = 1;
export const STRATEGIC_SAVE_KEY = 'three-crowns-strategy-save';

export interface StrategicSaveData {
  version: number;
  state: StrategicGameState;
}

function isFactionId(v: unknown): v is FactionId {
  return typeof v === 'string' && (FACTION_IDS as string[]).includes(v);
}

function parseUnit(raw: unknown): StrategicUnit | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !isKnownUnitType(o.type)) return null;
  if (!Number.isInteger(o.hp)) return null;
  const maxHp = UNIT_STATS[o.type].hp;
  if ((o.hp as number) < 1 || (o.hp as number) > maxHp) return null;
  return { id: o.id, type: o.type, hp: o.hp as number };
}

function parseArmy(raw: unknown): StrategicArmy | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !isFactionId(o.faction) || typeof o.regionId !== 'string')
    return null;
  if (typeof o.moved !== 'boolean' || !Array.isArray(o.units)) return null;
  const units: StrategicUnit[] = [];
  for (const u of o.units) {
    const parsed = parseUnit(u);
    if (!parsed) return null;
    units.push(parsed);
  }
  if (units.length === 0) return null;
  return {
    id: o.id,
    faction: o.faction,
    regionId: o.regionId,
    units,
    moved: o.moved,
  };
}

function parseRegion(raw: unknown): StrategicRegion | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string') return null;
  if (o.owner !== null && !isFactionId(o.owner)) return null;
  if (!Array.isArray(o.neighbors) || !o.neighbors.every((n) => typeof n === 'string')) return null;
  if (o.terrain !== 'plains' && o.terrain !== 'forest' && o.terrain !== 'mountain') return null;
  if (!Number.isFinite(o.income) || !Number.isFinite(o.defense)) return null;
  const region: StrategicRegion = {
    id: o.id,
    owner: o.owner as FactionId | null,
    neighbors: [...(o.neighbors as string[])],
    terrain: o.terrain,
    income: o.income as number,
    defense: o.defense as number,
  };
  if (o.settlement !== undefined) {
    if (o.settlement !== 'capital' && o.settlement !== 'town' && o.settlement !== 'fort')
      return null;
    region.settlement = o.settlement;
  }
  return region;
}

function parseBinding(raw: unknown): TacticalUnitBinding | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.strategicUnitId !== 'string' ||
    typeof o.tacticalTag !== 'string' ||
    typeof o.armyId !== 'string' ||
    !isFactionId(o.faction) ||
    !isKnownUnitType(o.type) ||
    !Number.isInteger(o.startingHp)
  )
    return null;
  return {
    strategicUnitId: o.strategicUnitId,
    tacticalTag: o.tacticalTag,
    armyId: o.armyId,
    faction: o.faction,
    type: o.type,
    startingHp: o.startingHp as number,
  };
}

function parseBattle(raw: unknown): StrategicBattleContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 1) return null;
  if (
    typeof o.battleId !== 'string' ||
    !Number.isInteger(o.strategicTurn) ||
    !Number.isInteger(o.battleSeed) ||
    typeof o.regionId !== 'string' ||
    typeof o.attackerArmyId !== 'string' ||
    typeof o.defenderArmyId !== 'string' ||
    typeof o.attackerOriginRegionId !== 'string' ||
    !isFactionId(o.humanFaction) ||
    !Array.isArray(o.unitBindings)
  )
    return null;
  const unitBindings: TacticalUnitBinding[] = [];
  for (const b of o.unitBindings) {
    const parsed = parseBinding(b);
    if (!parsed) return null;
    unitBindings.push(parsed);
  }
  return {
    schemaVersion: 1,
    battleId: o.battleId,
    strategicTurn: o.strategicTurn as number,
    battleSeed: o.battleSeed as number,
    regionId: o.regionId,
    attackerArmyId: o.attackerArmyId,
    defenderArmyId: o.defenderArmyId,
    attackerOriginRegionId: o.attackerOriginRegionId,
    humanFaction: o.humanFaction,
    unitBindings,
  };
}

/** 전략 상태를 버전 래핑 JSON 문자열로 직렬화한다. */
export function serializeStrategic(state: StrategicGameState): string {
  const data: StrategicSaveData = { version: STRATEGIC_SAVE_VERSION, state };
  return JSON.stringify(data);
}

/**
 * 전략 저장 문자열 복원. 구조·무결성 검증 실패 시 null.
 * 전술 SAVE_VERSION / three-crowns-save와 완전히 분리된다.
 */
export function deserializeStrategic(raw: string): StrategicGameState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const root = parsed as Record<string, unknown>;
  if (root.version !== STRATEGIC_SAVE_VERSION) return null;
  if (!root.state || typeof root.state !== 'object') return null;
  const s = root.state as Record<string, unknown>;

  if (s.schemaVersion !== 1) return null;
  if (!Number.isInteger(s.seed) || !Number.isInteger(s.turn) || s.maxTurns !== 10) return null;
  if (!isFactionId(s.humanFaction) || !isFactionId(s.currentFaction)) return null;
  if (
    s.phase !== 'orders' &&
    s.phase !== 'battle' &&
    s.phase !== 'resolution' &&
    s.phase !== 'ended'
  )
    return null;
  if (!Array.isArray(s.regions) || !Array.isArray(s.armies)) return null;
  if (!s.treasury || typeof s.treasury !== 'object') return null;

  const regions: StrategicRegion[] = [];
  for (const r of s.regions) {
    const pr = parseRegion(r);
    if (!pr) return null;
    regions.push(pr);
  }

  const armies: StrategicArmy[] = [];
  for (const a of s.armies) {
    const pa = parseArmy(a);
    if (!pa) return null;
    armies.push(pa);
  }

  const treasury = {} as Record<FactionId, number>;
  for (const fid of FACTION_IDS) {
    const v = (s.treasury as Record<string, unknown>)[fid];
    if (!Number.isInteger(v) || (v as number) < 0) return null;
    treasury[fid] = v as number;
  }

  const state: StrategicGameState = {
    schemaVersion: 1,
    seed: s.seed as number,
    turn: s.turn as number,
    maxTurns: 10,
    humanFaction: s.humanFaction,
    currentFaction: s.currentFaction,
    phase: s.phase,
    regions,
    armies,
    treasury,
  };

  if (s.winner !== undefined) {
    if (s.winner !== 'draw' && !isFactionId(s.winner)) return null;
    state.winner = s.winner;
  }

  if (s.pendingBattle !== undefined) {
    const pb = parseBattle(s.pendingBattle);
    if (!pb) return null;
    state.pendingBattle = pb;
  }

  const check = validateStrategicState(state);
  if (!check.ok) return null;
  return state;
}

/** localStorage 저장(가능 환경). 실패해도 예외를 밖으로 던지지 않는다. */
export function saveStrategicToStorage(state: StrategicGameState): StrategicResult<true> {
  try {
    if (typeof localStorage === 'undefined') return { ok: false, reason: 'no-localStorage' };
    localStorage.setItem(STRATEGIC_SAVE_KEY, serializeStrategic(state));
    return { ok: true, value: true };
  } catch {
    return { ok: false, reason: 'storage-write-failed' };
  }
}

export function loadStrategicFromStorage(): StrategicGameState | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STRATEGIC_SAVE_KEY);
    if (raw === null) return null;
    return deserializeStrategic(raw);
  } catch {
    return null;
  }
}

export function clearStrategicStorage(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(STRATEGIC_SAVE_KEY);
  } catch {
    // ignore
  }
}

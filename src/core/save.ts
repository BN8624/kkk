// 한 줄 목적: 게임 상태·설정의 버전 관리 직렬화와 안전한 복원을 담당한다
import { FACTION_IDS, TERRAIN_RULES, UNIT_STATS, BUILDING_INCOME } from './data';
import { hexKey } from './hex';
import { isBuiltinScenarioId, SCENARIOS } from './scenarios';
import type { GameObjectives } from './scenario/types';
import type { FactionId, GameState } from './types';

export const SAVE_VERSION = 3;
export const SAVE_KEY = 'three-crowns-save';
export const SETTINGS_KEY = 'three-crowns-settings';

export interface SaveData {
  version: number;
  state: GameState;
}

export interface Settings {
  soundOn: boolean;
  tutorialDone: boolean;
  /** AI 턴 재생 속도: 1 = 기본, 2 = 2배속, 0 = 건너뛰기 */
  aiSpeed: number;
}

export const DEFAULT_SETTINGS: Settings = { soundOn: true, tutorialDone: false, aiSpeed: 1 };

export function serialize(state: GameState): string {
  const data: SaveData = { version: SAVE_VERSION, state };
  return JSON.stringify(data);
}

/** v1 저장(player/ai1/ai2 세력 체계)을 v2 상태로 변환한다. */
const V1_FACTION_MAP: Record<string, FactionId> = {
  player: 'azure',
  ai1: 'crimson',
  ai2: 'violet',
};

interface V1State {
  seed: number;
  turn: number;
  maxTurns: number;
  current: string;
  tiles: { q: number; r: number; terrain: string; building?: string; owner?: string }[];
  units: { id: number; type: string; faction: string; q: number; r: number; hp: number; moved: boolean; attacked: boolean }[];
  factions: Record<string, { id: string; gold: number; eliminated: boolean }>;
  nextUnitId: number;
  over: boolean;
  winner?: string;
  stats: { kills: number; produced: number; captured: number };
}

function migrateV1(old: V1State): GameState | null {
  try {
    const mapF = (f: string | undefined): FactionId | undefined =>
      f === undefined ? undefined : V1_FACTION_MAP[f];
    const current = mapF(old.current);
    if (!current) return null;
    const factions = {} as GameState['factions'];
    const controllers = {} as GameState['controllers'];
    const stats = {} as GameState['stats'];
    for (const fid of FACTION_IDS) {
      const oldId = Object.keys(V1_FACTION_MAP).find((k) => V1_FACTION_MAP[k] === fid)!;
      const of = old.factions[oldId];
      if (!of) return null;
      factions[fid] = { id: fid, gold: of.gold, eliminated: of.eliminated };
      controllers[fid] = fid === 'azure' ? 'human' : 'ai';
      stats[fid] =
        fid === 'azure'
          ? { ...old.stats, lost: 0 }
          : { kills: 0, produced: 0, captured: 0, lost: 0 };
    }
    const state: GameState = {
      seed: old.seed,
      config: {
        mode: 'quick',
        scenario: 'three-crowns',
        difficulty: 'normal',
        humanFaction: 'azure',
      },
      turn: old.turn,
      maxTurns: old.maxTurns,
      order: [...FACTION_IDS],
      current,
      controllers,
      factions,
      tiles: old.tiles.map((t) => ({
        ...t,
        terrain: t.terrain as GameState['tiles'][number]['terrain'],
        building: t.building as GameState['tiles'][number]['building'],
        owner: mapF(t.owner),
      })),
      units: old.units.map((u) => ({
        ...u,
        type: u.type as GameState['units'][number]['type'],
        faction: mapF(u.faction)!,
      })),
      nextUnitId: old.nextUnitId,
      over: old.over,
      winner: old.winner === 'draw' ? 'draw' : mapF(old.winner),
      stats,
      // 목표는 migrateV2에서 시나리오 기준으로 채운다
      objectives: { victory: [], defeat: [], stars: [], turnLimit: 'score' },
    };
    if (state.units.some((u) => !u.faction)) return null;
    return state;
  } catch {
    return null;
  }
}

/** v2 저장(목표 없음·lost 통계 없음)을 v3 상태로 변환한다. v2는 항상 내장 시나리오다. */
function migrateV2(state: GameState): GameState | null {
  const scenario = state.config?.scenario;
  if (typeof scenario !== 'string' || !isBuiltinScenarioId(scenario)) return null;
  const def = SCENARIOS[scenario];
  const objectives: GameObjectives = {
    victory: [{ type: 'conquest' }],
    defeat: [{ type: 'human-eliminated' }],
    stars: [],
    turnLimit: 'score',
  };
  if (def.victory === 'crown-hold') {
    const crown = state.tiles?.find?.((t) => t.building === 'crown');
    if (crown) {
      objectives.victory.push({
        type: 'hold-building',
        at: { q: crown.q, r: crown.r },
        turns: def.crownHoldTurns ?? 4,
        activationTurn: def.crownActivationTurn,
      });
    }
  }
  const stats = {} as GameState['stats'];
  for (const fid of FACTION_IDS) {
    const s = state.stats?.[fid];
    if (!s) return null;
    stats[fid] = { kills: s.kills, produced: s.produced, captured: s.captured, lost: s.lost ?? 0 };
  }
  return { ...state, stats, objectives };
}

const VALID_MODES = ['quick', 'daily', 'custom', 'campaign'];
const VALID_DIFFICULTIES = ['easy', 'normal', 'hard'];

/** 저장된 시나리오 ID 형식 검증(내장 3개 + 커스텀/캠페인 확장 대비 소문자 슬러그). */
export function isValidScenarioIdFormat(id: unknown): boolean {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

/** v2 상태의 구조적 유효성을 검증한다. */
export function validateState(s: GameState): boolean {
  if (!s || typeof s.seed !== 'number' || !Number.isFinite(s.seed)) return false;
  if (typeof s.turn !== 'number' || !Number.isInteger(s.turn) || s.turn < 1) return false;
  if (typeof s.maxTurns !== 'number' || !Number.isInteger(s.maxTurns) || s.maxTurns < 1)
    return false;
  if (!Array.isArray(s.tiles) || !Array.isArray(s.units)) return false;
  if (!s.config || !FACTION_IDS.includes(s.config.humanFaction)) return false;
  if (!VALID_MODES.includes(s.config.mode)) return false;
  if (!isValidScenarioIdFormat(s.config.scenario)) return false;
  if (!VALID_DIFFICULTIES.includes(s.config.difficulty)) return false;
  // 세력 순서: FACTION_IDS의 순열이어야 한다(중복 금지)
  if (!Array.isArray(s.order) || s.order.length !== FACTION_IDS.length) return false;
  if (new Set(s.order).size !== s.order.length) return false;
  if (!s.order.every((f) => FACTION_IDS.includes(f))) return false;
  if (!FACTION_IDS.includes(s.current)) return false;
  let humans = 0;
  for (const fid of FACTION_IDS) {
    const f = s.factions?.[fid];
    if (!f || typeof f.gold !== 'number' || !Number.isFinite(f.gold) || f.gold < 0) return false;
    const c = s.controllers?.[fid];
    if (c !== 'human' && c !== 'ai') return false;
    if (c === 'human') humans++;
    const st = s.stats?.[fid];
    if (!st || typeof st.kills !== 'number' || typeof st.produced !== 'number') return false;
  }
  // 인간 controller는 정확히 하나여야 하며 humanFaction과 일치해야 한다
  if (humans !== 1 || s.controllers[s.config.humanFaction] !== 'human') return false;
  // 타일: 유효한 지형·건물·소유자, 좌표 중복 금지
  const tileKeys = new Set<string>();
  for (const t of s.tiles) {
    if (typeof t.q !== 'number' || typeof t.r !== 'number') return false;
    if (!(t.terrain in TERRAIN_RULES)) return false;
    if (t.building !== undefined && !(t.building in BUILDING_INCOME)) return false;
    if (t.owner !== undefined && !FACTION_IDS.includes(t.owner)) return false;
    const key = hexKey(t.q, t.r);
    if (tileKeys.has(key)) return false;
    tileKeys.add(key);
  }
  // 유닛: 유효한 병과·세력·HP 범위, ID·좌표 중복 금지, 존재하는 지상 타일 위
  const seen = new Set<string>();
  const seenIds = new Set<number>();
  let maxUnitId = 0;
  for (const u of s.units) {
    if (!FACTION_IDS.includes(u.faction)) return false;
    if (!(u.type in UNIT_STATS)) return false;
    if (typeof u.id !== 'number' || !Number.isInteger(u.id) || u.id < 1) return false;
    if (seenIds.has(u.id)) return false;
    seenIds.add(u.id);
    maxUnitId = Math.max(maxUnitId, u.id);
    if (typeof u.hp !== 'number' || !Number.isFinite(u.hp) || u.hp < 1) return false;
    if (u.hp > UNIT_STATS[u.type].hp) return false;
    const key = hexKey(u.q, u.r);
    if (seen.has(key)) return false;
    seen.add(key);
    if (!tileKeys.has(key)) return false;
    const tile = s.tiles.find((t) => t.q === u.q && t.r === u.r)!;
    if (tile.terrain === 'water') return false;
  }
  // nextUnitId 정합: 존재하는 유닛 ID보다 커야 한다
  if (
    typeof s.nextUnitId !== 'number' ||
    !Number.isInteger(s.nextUnitId) ||
    s.nextUnitId <= maxUnitId
  )
    return false;
  // 명령 순번: 존재하면 0 이상의 정수여야 한다
  if (s.cmdSeq !== undefined && (!Number.isInteger(s.cmdSeq) || s.cmdSeq < 0)) return false;
  // 명령 기록: 존재하면 배열이어야 한다(불완전 기록은 리플레이 생성 시점에 걸러진다)
  if (s.commandLog !== undefined && !Array.isArray(s.commandLog)) return false;
  // winner·over 정합: winner가 있으면 over여야 한다
  if (s.winner !== undefined && !s.over) return false;
  if (s.winner !== undefined && s.winner !== 'draw' && !FACTION_IDS.includes(s.winner))
    return false;
  // 목표 정합: 배열 구조여야 한다
  if (
    !s.objectives ||
    !Array.isArray(s.objectives.victory) ||
    !Array.isArray(s.objectives.defeat) ||
    !Array.isArray(s.objectives.stars) ||
    (s.objectives.turnLimit !== 'score' && s.objectives.turnLimit !== 'defeat')
  )
    return false;
  // 커스텀 시나리오 저장은 재현용 스냅샷을 반드시 포함해야 한다(ID 일치)
  if (!isBuiltinScenarioId(s.config.scenario)) {
    const snap = s.customScenario;
    if (!snap || snap.id !== s.config.scenario || !Array.isArray(snap.board?.tiles)) return false;
  }
  return true;
}

/** 저장 데이터를 검증하며 복원한다. 버전 불일치·손상 시 null을 반환한다(v1은 마이그레이션). */
export function deserialize(raw: string): GameState | null {
  try {
    const data = JSON.parse(raw) as SaveData;
    let state: GameState | null = null;
    if (data.version === SAVE_VERSION) state = data.state;
    else if (data.version === 2) state = migrateV2(data.state);
    else if (data.version === 1) {
      const v2 = migrateV1(data.state as unknown as V1State);
      state = v2 ? migrateV2(v2) : null;
    }
    if (!state || !validateState(state)) return null;
    return state;
  } catch {
    return null;
  }
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): StorageLike | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* Safari 프라이빗 모드 등에서 접근 불가 */
  }
  return null;
}

export function saveGame(state: GameState): void {
  try {
    storage()?.setItem(SAVE_KEY, serialize(state));
  } catch {
    /* 저장 공간 부족 등 실패해도 게임은 계속 진행 */
  }
}

/** 직렬화 문자열을 그대로 저장한다(AI 페이즈 체크포인트 복구용). */
export function saveRaw(raw: string): void {
  try {
    storage()?.setItem(SAVE_KEY, raw);
  } catch {
    /* 실패해도 게임은 계속 진행 */
  }
}

export function loadGame(): GameState | null {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(SAVE_KEY) ?? null;
  } catch {
    return null; /* 읽기 실패는 저장 없음으로 처리 */
  }
  if (!raw) return null;
  const state = deserialize(raw);
  if (!state) clearSave();
  return state;
}

export function clearSave(): void {
  try {
    storage()?.removeItem(SAVE_KEY);
  } catch {
    /* 삭제 실패해도 게임은 계속 진행 */
  }
}

export function loadSettings(): Settings {
  try {
    const raw = storage()?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      soundOn: typeof s.soundOn === 'boolean' ? s.soundOn : true,
      tutorialDone: typeof s.tutorialDone === 'boolean' ? s.tutorialDone : false,
      aiSpeed: s.aiSpeed === 0 || s.aiSpeed === 2 ? s.aiSpeed : 1,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* 실패해도 게임은 계속 진행 */
  }
}

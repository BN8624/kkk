// 한 줄 목적: 게임 상태·설정의 버전 관리 직렬화와 안전한 복원을 담당한다
import { FACTION_IDS } from './data';
import type { FactionId, GameState } from './types';

export const SAVE_VERSION = 2;
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
          ? { ...old.stats }
          : { kills: 0, produced: 0, captured: 0 };
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
    };
    if (state.units.some((u) => !u.faction)) return null;
    return state;
  } catch {
    return null;
  }
}

/** v2 상태의 구조적 유효성을 검증한다. */
function validateState(s: GameState): boolean {
  if (!s || typeof s.seed !== 'number' || typeof s.turn !== 'number') return false;
  if (!Array.isArray(s.tiles) || !Array.isArray(s.units)) return false;
  if (!s.config || !FACTION_IDS.includes(s.config.humanFaction)) return false;
  if (!Array.isArray(s.order) || s.order.length !== FACTION_IDS.length) return false;
  if (!FACTION_IDS.includes(s.current)) return false;
  for (const fid of FACTION_IDS) {
    if (!s.factions?.[fid] || typeof s.factions[fid].gold !== 'number') return false;
    if (s.controllers?.[fid] !== 'human' && s.controllers?.[fid] !== 'ai') return false;
    if (!s.stats?.[fid]) return false;
  }
  // 유닛 좌표 중복·불법 세력 검사
  const seen = new Set<string>();
  for (const u of s.units) {
    if (!FACTION_IDS.includes(u.faction)) return false;
    const key = `${u.q},${u.r}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** 저장 데이터를 검증하며 복원한다. 버전 불일치·손상 시 null을 반환한다(v1은 마이그레이션). */
export function deserialize(raw: string): GameState | null {
  try {
    const data = JSON.parse(raw) as SaveData;
    let state: GameState | null = null;
    if (data.version === SAVE_VERSION) state = data.state;
    else if (data.version === 1) state = migrateV1(data.state as unknown as V1State);
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
  const raw = storage()?.getItem(SAVE_KEY);
  if (!raw) return null;
  const state = deserialize(raw);
  if (!state) storage()?.removeItem(SAVE_KEY);
  return state;
}

export function clearSave(): void {
  storage()?.removeItem(SAVE_KEY);
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

// 한 줄 목적: 게임 상태·설정의 버전 관리 직렬화와 안전한 복원을 담당한다
import type { GameState } from './types';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'three-crowns-save';
export const SETTINGS_KEY = 'three-crowns-settings';

export interface SaveData {
  version: number;
  state: GameState;
}

export interface Settings {
  soundOn: boolean;
  tutorialDone: boolean;
}

export const DEFAULT_SETTINGS: Settings = { soundOn: true, tutorialDone: false };

export function serialize(state: GameState): string {
  const data: SaveData = { version: SAVE_VERSION, state };
  return JSON.stringify(data);
}

/** 저장 데이터를 검증하며 복원한다. 버전 불일치·손상 시 null을 반환한다. */
export function deserialize(raw: string): GameState | null {
  try {
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== SAVE_VERSION) return null;
    const s = data.state;
    if (!s || typeof s.seed !== 'number' || typeof s.turn !== 'number') return null;
    if (!Array.isArray(s.tiles) || !Array.isArray(s.units)) return null;
    if (!s.factions?.player || !s.factions?.ai1 || !s.factions?.ai2) return null;
    return s;
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
  storage()?.setItem(SAVE_KEY, serialize(state));
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
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  storage()?.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

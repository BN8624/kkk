// 한 줄 목적: 전략 전술 전투 중 임시 저장(일반 three-crowns-save와 분리)
import { deserialize, serialize, type SaveData } from '../core/save';
import type { GameState } from '../core/types';
import { strategicStateDigest } from './digest';
import type { StrategicGameState, StrategicResult } from './types';

export const STRATEGIC_BATTLE_SAVE_KEY = 'three-crowns-strategy-battle-save';
export const STRATEGIC_BATTLE_SAVE_VERSION = 1;

export interface StrategicTacticalSaveV1 {
  schemaVersion: 1;
  battleId: string;
  strategicDigest: string;
  state: GameState;
}

function isStrategicTacticalSaveV1(raw: unknown): raw is {
  schemaVersion: 1;
  battleId: string;
  strategicDigest: string;
  state: unknown;
} {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return (
    o.schemaVersion === 1 &&
    typeof o.battleId === 'string' &&
    typeof o.strategicDigest === 'string' &&
    o.state !== undefined
  );
}

/** 직렬화: 전술 GameState는 기존 SAVE_VERSION 경로를 래핑한다. */
export function serializeStrategicBattleSave(save: StrategicTacticalSaveV1): string {
  // state는 기존 serialize로 문자열화 후 다시 파싱해 SaveData 형태를 보존
  const tacticalRaw = serialize(save.state);
  const tacticalParsed = JSON.parse(tacticalRaw) as SaveData;
  return JSON.stringify({
    schemaVersion: 1,
    battleId: save.battleId,
    strategicDigest: save.strategicDigest,
    state: tacticalParsed,
  });
}

/**
 * 전투 임시 저장 복원. 구조 실패 시 null.
 * battleId·digest 일치는 호출자가 pendingBattle과 대조한다.
 */
export function deserializeStrategicBattleSave(raw: string): StrategicTacticalSaveV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isStrategicTacticalSaveV1(parsed)) return null;

  // 기존 전술 deserialize 경로로 GameState 복원
  let tacticalJson: string;
  try {
    tacticalJson = JSON.stringify(parsed.state);
  } catch {
    return null;
  }
  const state = deserialize(tacticalJson);
  if (!state) return null;

  return {
    schemaVersion: 1,
    battleId: parsed.battleId,
    strategicDigest: parsed.strategicDigest,
    state,
  };
}

/** 현재 전략 상태 digest와 battleId로 임시 저장 객체를 만든다. */
export function buildStrategicBattleSave(
  strategic: StrategicGameState,
  battleId: string,
  tactical: GameState,
): StrategicTacticalSaveV1 {
  return {
    schemaVersion: 1,
    battleId,
    strategicDigest: strategicStateDigest(strategic),
    state: tactical,
  };
}

/**
 * 복원 가능 여부: pendingBattle.battleId·전략 digest 일치.
 * 불일치 시 해당 전투 저장만 폐기 가능(전략 원본 보존).
 */
export function validateStrategicBattleSaveMatch(
  strategic: StrategicGameState,
  save: StrategicTacticalSaveV1,
): StrategicResult<true> {
  if (!strategic.pendingBattle) return { ok: false, reason: 'no-pending-battle' };
  if (strategic.phase !== 'battle') return { ok: false, reason: 'not-battle-phase' };
  if (strategic.pendingBattle.battleId !== save.battleId) {
    return { ok: false, reason: 'battle-id-mismatch' };
  }
  const dig = strategicStateDigest(strategic);
  if (dig !== save.strategicDigest) return { ok: false, reason: 'strategic-digest-mismatch' };
  if (save.state.over) return { ok: false, reason: 'battle-already-over' };
  return { ok: true, value: true };
}

export function saveStrategicBattleToStorage(
  strategic: StrategicGameState,
  battleId: string,
  tactical: GameState,
): StrategicResult<true> {
  try {
    if (typeof localStorage === 'undefined') return { ok: false, reason: 'no-localStorage' };
    const save = buildStrategicBattleSave(strategic, battleId, tactical);
    localStorage.setItem(STRATEGIC_BATTLE_SAVE_KEY, serializeStrategicBattleSave(save));
    return { ok: true, value: true };
  } catch {
    return { ok: false, reason: 'storage-write-failed' };
  }
}

export function loadStrategicBattleFromStorage(): StrategicTacticalSaveV1 | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STRATEGIC_BATTLE_SAVE_KEY);
    if (raw === null) return null;
    return deserializeStrategicBattleSave(raw);
  } catch {
    return null;
  }
}

export function clearStrategicBattleStorage(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(STRATEGIC_BATTLE_SAVE_KEY);
  } catch {
    // ignore
  }
}

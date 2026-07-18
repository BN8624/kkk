// 한 줄 목적: 게임 상태에서 타일·유닛을 조회하는 공용 헬퍼를 제공한다
import { hexKey } from './hex';
import type { FactionId, GameState, Tile, Unit } from './types';

export function tileMap(state: GameState): Map<string, Tile> {
  const m = new Map<string, Tile>();
  for (const t of state.tiles) m.set(hexKey(t.q, t.r), t);
  return m;
}

export function tileAt(state: GameState, q: number, r: number): Tile | undefined {
  return state.tiles.find((t) => t.q === q && t.r === r);
}

export function unitAt(state: GameState, q: number, r: number): Unit | undefined {
  return state.units.find((u) => u.q === q && u.r === r);
}

export function unitById(state: GameState, id: number): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

export function unitsOf(state: GameState, faction: FactionId): Unit[] {
  return state.units.filter((u) => u.faction === faction);
}

export function buildingsOf(state: GameState, faction: FactionId): Tile[] {
  return state.tiles.filter((t) => t.building && t.owner === faction);
}

/** 인간 플레이어가 조작하는 세력을 반환한다. */
export function humanFaction(state: GameState): FactionId {
  return state.config.humanFaction;
}

export function isHumanTurn(state: GameState): boolean {
  return state.controllers[state.current] === 'human';
}

// 한 줄 목적: 게임 상태·유닛·타일 등 코어 로직의 공용 타입을 정의한다

export type FactionId = 'player' | 'ai1' | 'ai2';
export type TerrainId = 'plains' | 'forest' | 'mountain' | 'water';
export type BuildingId = 'capital' | 'village';
export type UnitTypeId = 'infantry' | 'archer' | 'cavalry';

export interface Axial {
  q: number;
  r: number;
}

export interface Tile {
  q: number;
  r: number;
  terrain: TerrainId;
  building?: BuildingId;
  owner?: FactionId;
}

export interface Unit {
  id: number;
  type: UnitTypeId;
  faction: FactionId;
  q: number;
  r: number;
  hp: number;
  moved: boolean;
  attacked: boolean;
}

export interface FactionState {
  id: FactionId;
  gold: number;
  eliminated: boolean;
}

export interface PlayerStats {
  kills: number;
  produced: number;
  captured: number;
}

export interface GameState {
  seed: number;
  turn: number;
  maxTurns: number;
  current: FactionId;
  tiles: Tile[];
  units: Unit[];
  factions: Record<FactionId, FactionState>;
  nextUnitId: number;
  over: boolean;
  winner?: FactionId | 'draw';
  stats: PlayerStats;
}

export interface UnitStats {
  hp: number;
  atk: number;
  def: number;
  move: number;
  range: number;
  cost: number;
}

export interface TerrainRule {
  cost: number;
  def: number;
}

// 한 줄 목적: 게임 상태·유닛·타일 등 코어 로직의 공용 타입을 정의한다

export type FactionId = 'azure' | 'crimson' | 'violet';
export type ControllerType = 'human' | 'ai';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type GameMode = 'quick' | 'daily';
export type ScenarioId = 'three-crowns' | 'broken-strait' | 'crown-heart';
export type TerrainId = 'plains' | 'forest' | 'mountain' | 'water';
export type BuildingId = 'capital' | 'village' | 'crown';
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

export interface FactionStats {
  kills: number;
  produced: number;
  captured: number;
}

/** 게임 시작 시 결정되어 판 내내 유지되는 설정 */
export interface GameConfig {
  mode: GameMode;
  scenario: ScenarioId;
  difficulty: Difficulty;
  humanFaction: FactionId;
  /** 일일 도전 규칙 수정자(하루 최대 1개) */
  modifier?: string;
}

export interface GameState {
  seed: number;
  config: GameConfig;
  turn: number;
  maxTurns: number;
  /** 세력 행동 순서. 항상 이 순서대로 페이즈가 돈다 */
  order: FactionId[];
  current: FactionId;
  controllers: Record<FactionId, ControllerType>;
  tiles: Tile[];
  units: Unit[];
  factions: Record<FactionId, FactionState>;
  nextUnitId: number;
  over: boolean;
  winner?: FactionId | 'draw';
  stats: Record<FactionId, FactionStats>;
  /** 왕관의 심장 시나리오: 중앙 요새 연속 보유 상태 */
  crownHold?: { owner: FactionId | null; turns: number };
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

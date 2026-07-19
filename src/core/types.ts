// 한 줄 목적: 게임 상태·유닛·타일 등 코어 로직의 공용 타입을 정의한다

import type { GameObjectives, ScenarioRuntimeSnapshot } from './scenario/types';

export type FactionId = 'azure' | 'crimson' | 'violet';
export type ControllerType = 'human' | 'ai';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type GameMode = 'quick' | 'daily' | 'custom' | 'campaign';
export type BuiltinScenarioId = 'three-crowns' | 'broken-strait' | 'crown-heart';
/** 열린 시나리오 ID(내장 + 커스텀·캠페인). 형식은 scenario/types의 isValidScenarioId로 검증한다 */
export type ScenarioId = string;
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
  /** 시나리오 조건(unit-alive·unit-dies)이 참조하는 태그 */
  tag?: string;
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
  /** 잃은 유닛 수(별점 조건 평가용) */
  lost: number;
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
  /** hold-building 승리 조건의 연속 보유 상태(왕관의 심장 등) */
  crownHold?: { owner: FactionId | null; turns: number };
  /** 시나리오에서 파생된 승리·패배·별점 목표(저장에 포함되어 원본 문서 변경의 영향을 받지 않는다) */
  objectives: GameObjectives;
  /** 커스텀·캠페인 게임의 정규화 스냅샷(이어하기·리플레이 재현용). 내장 시나리오는 시드로 재구성한다 */
  customScenario?: ScenarioRuntimeSnapshot;
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

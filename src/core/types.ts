// 한 줄 목적: 게임 상태·유닛·타일 등 코어 로직의 공용 타입을 정의한다

import type { GameCommand } from './command';
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
  /** 게임 시작부터 성공한 명령 수(다음 명령의 순번). 리플레이 순서 검증에 쓴다 */
  cmdSeq?: number;
  /** 성공한 명령 전체 기록(리플레이 생성용). 규칙에는 영향을 주지 않으며 다이제스트에서 제외된다 */
  commandLog?: GameCommand[];
  /** 인간 행동 관측 기록(리플레이 v2 관측 메타데이터). 규칙·다이제스트에 영향을 주지 않는다 */
  observationLog?: ReplayObservation[];
}

/**
 * 명령 하나에 대한 사용자 행동 관측(결정론 게임 명령과 분리된 선택적 메타데이터).
 * 상대 시간(ms)만 기록하며 실제 벽시계 시각·개인 식별 정보는 담지 않는다.
 */
export interface ReplayObservation {
  /** 관측 대상 명령의 순번 */
  commandSeq: number;
  /** 직전 인간 명령(또는 인간 차례 시작)부터 이 명령까지 걸린 시간. 백그라운드 시간 제외 */
  elapsedMs?: number;
  /** 이 명령을 만든 선택이 시작된 시점부터 명령까지의 망설임 시간 */
  hesitationMs?: number;
  /** 직전 명령 이후 명령 없이 취소한 선택 횟수 */
  canceledSelectionCount?: number;
  /** 직전 명령 이후 사용자가 카메라를 움직인 횟수(드래그 제스처 단위) */
  cameraMoves?: number;
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

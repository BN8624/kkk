// 한 줄 목적: 시나리오 정본 문서(ScenarioDocument v1)·승패·별점 조건·런타임 스냅샷 타입을 정의한다
import type {
  Axial,
  BuildingId,
  Difficulty,
  FactionId,
  TerrainId,
  UnitTypeId,
} from '../types';

// ---------------- 조건(tagged union — 자유 스크립트 금지) ----------------

/** 승리 조건. conquest·hold-building은 모든 세력에 대칭 적용, 나머지는 인간 세력 기준이다. */
export type VictoryCondition =
  | { type: 'conquest' } // 한 세력이 모든 수도 점령
  | { type: 'hold-building'; at: Axial; turns: number; activationTurn?: number } // 지정 거점 N턴 연속 보유(대칭)
  | { type: 'capture-building'; at: Axial } // 지정 거점 점령
  | { type: 'capture-count'; building: BuildingId; count: number } // 지정 종류 거점 N개 보유
  | { type: 'eliminate-faction'; faction: FactionId } // 지정 세력 제거
  | { type: 'survive-turns'; turns: number } // 지정 턴 시작까지 생존
  | { type: 'reach-score'; score: number } // 지정 점수 달성
  | { type: 'unit-alive'; tag: string } // 지정 유닛 생존(단독으로는 all-of 안에서 사용)
  | { type: 'all-of'; conditions: VictoryCondition[] } // 복수 목표 모두
  | { type: 'any-of'; conditions: VictoryCondition[] }; // 복수 목표 중 하나

/** 패배 조건(인간 세력 기준). */
export type DefeatCondition =
  | { type: 'human-eliminated' } // 인간 세력 제거
  | { type: 'lose-building'; at: Axial } // 특정 수도·거점 상실(한 번이라도 소유했다가 잃음)
  | { type: 'unit-dies'; tag: string } // 특정 유닛 사망
  | { type: 'enemy-captures'; at: Axial } // 적이 특정 거점 점령
  | { type: 'turn-limit' }; // 제한 턴 초과(승리 조건 미충족 시 패배)

/** 별점 조건(게임 종료 시 평가, 인간 세력 기준). */
export type StarCondition =
  | { type: 'win' }
  | { type: 'win-within-turns'; turns: number }
  | { type: 'units-alive-at-least'; count: number }
  | { type: 'units-lost-at-most'; count: number }
  | { type: 'buildings-captured-at-least'; count: number }
  | { type: 'kills-at-least'; count: number }
  | { type: 'unit-alive'; tag: string }
  | { type: 'gold-at-least'; amount: number };

// ---------------- 문서 ----------------

export interface ScenarioTile {
  q: number;
  r: number;
  terrain: TerrainId;
  building?: BuildingId;
  owner?: FactionId;
}

export interface ScenarioFactionSetup {
  id: FactionId;
  /** 비활성 세력은 게임에 참여하지 않는다(수도·유닛 배치 불가) */
  active: boolean;
  controller: 'human' | 'ai';
  /** 시작 금. 생략 시 교리 기본값 */
  startGold?: number;
  /** 교리(고유 능력) 사용 여부. 생략 시 true */
  useDoctrine?: boolean;
}

export interface ScenarioUnitSetup {
  faction: FactionId;
  type: UnitTypeId;
  q: number;
  r: number;
  /** 생략 시 병과 최대 HP */
  hp?: number;
  /** 시작 턴 행동 가능 여부. 생략 시 true */
  canAct?: boolean;
  /** 조건(unit-alive·unit-dies)에서 참조하는 태그 */
  tag?: string;
}

export interface ScenarioRules {
  maxTurns: number;
  /** 제한 턴 초과 시 판정: score = 점수 승부(기본), defeat = 승리 조건 미달성 시 패배 */
  turnLimit: 'score' | 'defeat';
  /** 일일 도전과 동일한 제한적 규칙 수정자 */
  modifier?: string;
  /** 교리(왕국 고유 능력) 전역 활성화. 생략 시 true */
  doctrines?: boolean;
  /** 왕국 고유 병종 생산 허용. 생략 시 false(기존 문서·저장 의미 유지) */
  uniqueUnits?: boolean;
}

/** 지도 생성 방식: fixed = 문서의 타일 그대로, procedural = 내장 생성기 + 시드 */
export type ScenarioBoardSource =
  | { kind: 'fixed' }
  | { kind: 'procedural'; generator: 'three-crowns' | 'broken-strait' | 'crown-heart' };

export interface ScenarioDocumentV1 {
  schemaVersion: 1;

  id: string;
  title: string;
  description: string;
  author?: string;

  board: {
    cols: number;
    rows: number;
    /** procedural 문서는 비워 두고 시작 시 생성한다 */
    tiles: ScenarioTile[];
    source?: ScenarioBoardSource;
  };

  factions: ScenarioFactionSetup[];
  units: ScenarioUnitSetup[];

  rules: ScenarioRules;

  victoryConditions: VictoryCondition[];
  defeatConditions: DefeatCondition[];
  starConditions?: StarCondition[];

  metadata?: {
    tags?: string[];
    recommendedFaction?: FactionId;
    recommendedDifficulty?: Difficulty;
    estimatedMinutes?: number;
  };
}

// ---------------- 런타임 스냅샷 ----------------

/**
 * 검증·정규화를 마친 시나리오 스냅샷. 게임 시작 이후 원본 문서 변경의 영향을 받지 않도록
 * 시작 시점에 완전히 확정된 값(절차적 지도 포함)만 담는다.
 */
export interface SnapshotFaction {
  id: FactionId;
  active: boolean;
  controller: 'human' | 'ai';
  startGold: number;
  useDoctrine: boolean;
}

export interface SnapshotUnit {
  faction: FactionId;
  type: UnitTypeId;
  q: number;
  r: number;
  hp: number;
  canAct: boolean;
  tag?: string;
}

export interface ScenarioRuntimeSnapshot {
  schemaVersion: 1;
  id: string;
  title: string;
  /** 원본이 절차적이면 생성에 사용한 시드(고정 지도는 undefined) */
  generatedFromSeed?: number;
  board: {
    cols: number;
    rows: number;
    tiles: ScenarioTile[];
  };
  factions: SnapshotFaction[];
  units: SnapshotUnit[];
  rules: ScenarioRules;
  victoryConditions: VictoryCondition[];
  defeatConditions: DefeatCondition[];
  starConditions: StarCondition[];
}

/** 게임 상태에 탑재되는 목표 집합(스냅샷에서 파생, 저장에 포함). */
export interface GameObjectives {
  victory: VictoryCondition[];
  defeat: DefeatCondition[];
  stars: StarCondition[];
  turnLimit: 'score' | 'defeat';
  /**
   * 왕국 고유 병종 생산 허용(시나리오 rules.uniqueUnits에서 복사).
   * 생략 시 false — 내장 시나리오는 스냅샷에 넣지 않으므로 상태에도 실어 둔다.
   */
  uniqueUnits?: boolean;
}

// ---------------- 검증 ----------------

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  /** 문제가 있는 필드 경로(예: units[3].hp) */
  path?: string;
  /** 관련 타일 좌표 */
  at?: Axial;
  /** 관련 유닛 인덱스 */
  unitIndex?: number;
  /** 가능한 수리 방법 설명 */
  repair?: string;
}

export const SCENARIO_LIMITS = {
  minCols: 6,
  minRows: 6,
  maxCols: 20,
  maxRows: 20,
  maxUnits: 60,
  maxTurnsMin: 4,
  maxTurnsMax: 40,
  maxConditions: 12,
  maxTitleLen: 40,
  maxDescriptionLen: 300,
  maxAuthorLen: 24,
  maxTagLen: 24,
  /** 가져오기 파일 크기 제한(바이트) */
  maxImportBytes: 512 * 1024,
} as const;

/** 시나리오 ID 형식: 소문자 슬러그(내장·커스텀 공용). 임의 문자열을 그대로 신뢰하지 않는다. */
export function isValidScenarioId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

// 한 줄 목적: 컨트롤러 사이의 명시적 경계 — 상위 화면 이동과 컨트롤러 간 공개 계약을 정의한다
import type { GameState } from '../core/types';
import type { ReplayDocumentV1 } from '../core/replay';
import type { ScenarioDocumentV1 } from '../core/scenario/types';

/** 일반 플레이 진입 옵션. */
export interface LaunchOptions {
  /** 제작실 테스트 플레이(실제 저장·기록을 오염시키지 않음). */
  testPlay?: boolean;
  /** AI 관전(인간 차례도 AI가 대신 진행). */
  spectate?: boolean;
}

/** 상위 화면 이동. 컨트롤러는 다른 컨트롤러를 직접 만들지 않고 이 인터페이스만 사용한다. */
export interface AppNavigation {
  toTitle(): void;
  toSetup(): void;
  continueGame(): void;
  toDaily(): void;
  toRecords(): void;
  toCampaign(): void;
  toCustomScenarios(): void;
  toEditorHome(): void;
  toReplayArchive(): void;
  toAnalysis(): void;
  launch(state: GameState, opts?: LaunchOptions): void;
  openPlayback(doc: ReplayDocumentV1): void;
}

/** PlayController가 다른 컨트롤러·셸에 공개하는 계약. */
export interface PlaySession {
  launch(state: GameState, opts?: LaunchOptions): void;
  onTileTap(q: number, r: number): void;
  /** 테스트 플레이를 결과 없이 중단한다(에디터 복귀 등). */
  abandonTestPlay(): void;
  /** 타이틀 이동 시 테스트 플레이 UI 요소만 정리한다(게임 상태는 유지). */
  clearTestPlayUi(): void;
  /** pagehide 등에서 진행 중 게임을 저장한다. */
  persistOnExit(): void;
  readonly state: GameState | null;
  readonly busy: boolean;
}

/** CampaignController 공개 계약. */
export interface CampaignFlow {
  show(): void;
  /** 캠페인 미션 종료를 처리했으면 true(진행 저장·결과 화면 예약 포함). */
  handleGameEnd(state: GameState): boolean;
}

/** EditorFlowController 공개 계약. */
export interface EditorFlow {
  showHome(): Promise<void>;
  /** 공유 URL로 받은 문서를 새 초안으로 연다. */
  openImportedDocument(doc: ScenarioDocumentV1): void;
  /** 테스트 플레이 진입 직전: 에디터 화면 요소만 걷어낸다(세션 유지). */
  suspendForTestPlay(): void;
  /** 세션·씬·패널 완전 정리(타이틀 등으로 나갈 때). */
  closeSession(): void;
  /** 테스트 플레이 종료 결과 화면을 연다. */
  handleTestPlayEnd(state: GameState): void;
  /** 테스트 플레이에서 에디터로 복귀한다(편집 원본·undo 히스토리 유지). */
  returnFromTestPlay(): void;
}

/** ReplayController 공개 계약. */
export interface ReplayArchiveFlow {
  showArchive(): Promise<void>;
  openPlayback(doc: ReplayDocumentV1, opts?: { unverified?: boolean }): void;
  /** 분석 화면에서 특정 턴으로 바로 이동해 재생을 연다. */
  openPlaybackAtTurn(doc: ReplayDocumentV1, turn: number): void;
  /** 재생 UI 정리(다른 화면으로 나갈 때). */
  stopPlaybackUi(): void;
  /** 게임 종료 시 리플레이 자동 보관(실패 무시). */
  captureReplay(state: GameState): void;
  /** 요청 시 보관(테스트 플레이 결과 화면 전용). 성공 여부 반환. */
  captureReplayOnDemand(state: GameState): boolean;
  readonly hasLastReplay: boolean;
  openLastReplay(): void;
}

/** 일일 도전·기록·커스텀 시나리오 목록 화면 계약. */
export interface LibraryFlow {
  showDaily(): void;
  showRecords(): void;
  showCustomScenarios(): Promise<void>;
}

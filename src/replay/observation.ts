// 한 줄 목적: 인간 플레이 중 명령별 관측 메타데이터(상대 시간·선택 취소·카메라 이동)를 기록한다 — 결정론·다이제스트와 무관
import type { GameState, ReplayObservation } from '../core/types';

/** 비정상적으로 긴 간격(자리 비움 등)은 관측 시간으로 기록하지 않는다. */
export const OBSERVATION_MAX_ELAPSED_MS = 5 * 60_000;

/**
 * 관측 기록기. 벽시계 시각을 저장하지 않고 상대 시간(ms)만 계산하며,
 * 문서가 백그라운드에 있던 시간은 elapsedMs에서 제외한다.
 * 어떤 호출도 게임 규칙·상태 다이제스트에 영향을 주지 않는다.
 */
export class ObservationTracker {
  private lastMark: number | null = null;
  private selectionMark: number | null = null;
  private selectionActive = false;
  private canceled = 0;
  private cameraMoves = 0;
  private hiddenAccum = 0;
  private hiddenSince: number | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** 새 게임 시작·이어하기 때 모든 관측 상태를 초기화한다. */
  reset(): void {
    this.lastMark = null;
    this.selectionMark = null;
    this.selectionActive = false;
    this.canceled = 0;
    this.cameraMoves = 0;
    this.hiddenAccum = 0;
    this.hiddenSince = null;
  }

  /** 인간 차례가 시작될 때 경과 시간 기준점을 새로 잡는다. */
  markPhaseStart(): void {
    this.lastMark = this.now();
    this.hiddenAccum = 0;
    this.hiddenSince = null;
  }

  /** 문서가 백그라운드로 전환됨. */
  onHidden(): void {
    if (this.hiddenSince === null) this.hiddenSince = this.now();
  }

  /** 문서가 다시 보임 — 숨어 있던 시간을 경과 시간에서 제외할 몫으로 적립한다. */
  onVisible(): void {
    if (this.hiddenSince !== null) {
      this.hiddenAccum += this.now() - this.hiddenSince;
      this.hiddenSince = null;
    }
  }

  /** 유닛 선택 시작(이미 선택 중이면 망설임 기준점을 유지한다). */
  onSelect(): void {
    if (!this.selectionActive) {
      this.selectionActive = true;
      this.selectionMark = this.now();
    }
  }

  /** 명령 없이 선택을 해제함 — 취소 횟수로 센다. */
  onDeselect(): void {
    if (this.selectionActive) {
      this.selectionActive = false;
      this.selectionMark = null;
      this.canceled++;
    }
  }

  /** 사용자가 카메라를 움직임(드래그·핀치 제스처 단위). */
  onCameraMove(): void {
    this.cameraMoves++;
  }

  /** 성공한 인간 명령 하나를 관측으로 기록하고 다음 명령 기준으로 초기화한다. */
  record(state: GameState, commandSeq: number): void {
    const t = this.now();
    if (this.hiddenSince !== null) {
      this.hiddenAccum += t - this.hiddenSince;
      this.hiddenSince = t;
    }
    const obs: ReplayObservation = { commandSeq };
    if (this.lastMark !== null) {
      const elapsed = Math.round(t - this.lastMark - this.hiddenAccum);
      if (elapsed >= 0 && elapsed <= OBSERVATION_MAX_ELAPSED_MS) obs.elapsedMs = elapsed;
    }
    if (this.selectionMark !== null) {
      const hesitation = Math.round(t - this.selectionMark);
      if (hesitation >= 0 && hesitation <= OBSERVATION_MAX_ELAPSED_MS) obs.hesitationMs = hesitation;
    }
    if (this.canceled > 0) obs.canceledSelectionCount = this.canceled;
    if (this.cameraMoves > 0) obs.cameraMoves = this.cameraMoves;
    (state.observationLog ??= []).push(obs);
    this.lastMark = t;
    this.hiddenAccum = 0;
    this.selectionActive = false;
    this.selectionMark = null;
    this.canceled = 0;
    this.cameraMoves = 0;
  }
}

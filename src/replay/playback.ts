// 한 줄 목적: 리플레이 문서를 명령 단위로 앞뒤 재생하는 결정론적 재생 세션을 제공한다
import { executeCommand, type GameCommand, type GameEvent } from '../core/command';
import { replayInitialState, type ReplayDocument } from '../core/replay';
import type { GameState } from '../core/types';

/**
 * 리플레이 재생 세션. 상태는 명령을 순서대로 재실행해 얻으며,
 * 역방향 이동은 매 프레임 저장 대신 게임 시작·턴 시작 스냅샷에서 가까운 지점부터 재실행한다.
 */
export class ReplayPlayback {
  readonly doc: ReplayDocument;
  private current: GameState;
  /** 다음에 실행할 명령 인덱스(= 지금까지 실행된 명령 수) */
  private cursor = 0;
  /** 명령 인덱스 → 그 지점 상태의 직렬화 스냅샷(게임 시작·턴 시작 경계) */
  private snapshots = new Map<number, string>();
  /** 턴 → 그 턴 첫 명령 인덱스 */
  private turnStart = new Map<number, number>();
  /** 마지막 stepForward가 만든 이벤트(설명 표시용) */
  lastEvents: GameEvent[] = [];

  constructor(doc: ReplayDocument) {
    this.doc = doc;
    this.current = replayInitialState(doc);
    this.snapshots.set(0, JSON.stringify(this.current));
    // 턴 경계는 명령의 turn 필드로 사전 계산한다(재실행 불필요)
    for (let i = 0; i < doc.commands.length; i++) {
      const t = doc.commands[i].turn;
      if (!this.turnStart.has(t)) this.turnStart.set(t, i);
    }
  }

  get state(): GameState {
    return this.current;
  }

  get index(): number {
    return this.cursor;
  }

  get length(): number {
    return this.doc.commands.length;
  }

  get atStart(): boolean {
    return this.cursor === 0;
  }

  get atEnd(): boolean {
    return this.cursor >= this.length;
  }

  /** 다음에 실행될 명령(끝이면 null). */
  nextCommand(): GameCommand | null {
    return this.doc.commands[this.cursor] ?? null;
  }

  /** 재생에 존재하는 턴 목록 기준 최대 턴. */
  get lastTurn(): number {
    return this.doc.result.turns;
  }

  /**
   * 한 명령을 실행하고 정본 이벤트를 반환한다(연출용).
   * 손상된 문서로 명령이 실패하면 null을 반환하고 커서를 멈춘다.
   */
  stepForward(): GameEvent[] | null {
    if (this.atEnd) return null;
    const command = this.doc.commands[this.cursor];
    const r = executeCommand(this.current, command);
    if (!r.ok) return null;
    this.cursor++;
    if (
      r.events.some((e) => e.type === 'turn-started') &&
      !this.snapshots.has(this.cursor)
    ) {
      this.snapshots.set(this.cursor, JSON.stringify(this.current));
    }
    this.lastEvents = r.events;
    return r.events;
  }

  /** 한 명령 뒤로 이동한다. 상태 객체가 교체되므로 호출 후 화면을 다시 그려야 한다. */
  stepBack(): void {
    this.seek(this.cursor - 1);
  }

  /** 특정 명령 인덱스 상태로 이동한다: 가까운 스냅샷 복원 후 재실행. */
  seek(target: number): void {
    const t = Math.max(0, Math.min(this.length, target));
    if (t === this.cursor) return;
    if (t < this.cursor) {
      let best = 0;
      for (const k of this.snapshots.keys()) if (k <= t && k > best) best = k;
      this.current = JSON.parse(this.snapshots.get(best)!) as GameState;
      this.cursor = best;
    }
    while (this.cursor < t) {
      if (this.stepForward() === null) break;
    }
    this.lastEvents = [];
  }

  /** 지정 턴 시작 지점으로 이동한다(존재하지 않으면 가장 가까운 이전 턴). */
  seekTurn(turn: number): void {
    let t = Math.max(1, Math.min(turn, this.lastTurn));
    while (t > 1 && !this.turnStart.has(t)) t--;
    this.seek(this.turnStart.get(t) ?? 0);
  }

  /** 현재 위치가 속한 턴(다음 명령 기준, 끝이면 최종 턴). */
  get currentTurn(): number {
    return this.atEnd ? this.doc.commands[this.length - 1]?.turn ?? 1 : this.doc.commands[this.cursor].turn;
  }

  prevTurn(): void {
    const cur = this.currentTurn;
    const start = this.turnStart.get(cur) ?? 0;
    // 턴 시작 지점에 있으면 이전 턴으로, 아니면 현재 턴 시작으로
    this.seekTurn(this.cursor > start ? cur : cur - 1);
  }

  nextTurn(): void {
    this.seekTurn(this.currentTurn + 1);
  }

  toStart(): void {
    this.seek(0);
  }

  toEnd(): void {
    this.seek(this.length);
  }
}

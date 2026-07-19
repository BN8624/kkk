// 한 줄 목적: 컨트롤러 수명주기 계약과 비동기 취소·정리(타이머·리스너·구독)를 한곳에서 추적한다

/** 모드별 컨트롤러가 구현하는 공통 수명주기. AppShell이 화면 전환 시 호출한다. */
export interface AppController {
  /** 컨트롤러의 화면으로 들어올 때. */
  enter?(): void | Promise<void>;
  /** 다른 화면으로 떠날 때(세션 유지 가능). */
  leave?(): void | Promise<void>;
  /** 완전 해제. 이후 이 컨트롤러의 어떤 콜백도 UI를 갱신하면 안 된다. */
  dispose(): void;
}

/** 화면 전환 세대 토큰. 발급 시점 이후 전환이 일어나면 stale이 된다. */
export interface ModeToken {
  readonly alive: boolean;
}

let liveCleanups = 0;

/** 테스트·누수 진단용: 현재 등록돼 해제되지 않은 정리 항목 수. */
export function activeCleanupCount(): number {
  return liveCleanups;
}

/**
 * 취소 가능한 작업 묶음. 타이머·리스너를 등록해 두면 dispose 한 번으로 정리된다.
 * dispose 이후 등록되는 정리는 즉시 실행된다(stale 등록 방지).
 */
export class Lifetime {
  private cleanups = new Set<() => void>();
  private disposed = false;

  get alive(): boolean {
    return !this.disposed;
  }

  /** 정리 함수를 등록한다. 반환 함수로 조기 해제할 수 있다. */
  defer(fn: () => void): () => void {
    if (this.disposed) {
      fn();
      return () => {};
    }
    this.cleanups.add(fn);
    liveCleanups++;
    return () => {
      if (this.cleanups.delete(fn)) liveCleanups--;
    };
  }

  /** dispose 시 자동 해제되는 setTimeout. 실행되면 추적에서 빠진다. */
  setTimeout(fn: () => void, ms: number): void {
    if (this.disposed) return;
    const id = window.setTimeout(() => {
      remove();
      fn();
    }, ms);
    const remove = this.defer(() => window.clearTimeout(id));
  }

  /** dispose 시 자동 해제되는 이벤트 리스너. */
  listen<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    fn: (ev: WindowEventMap[K]) => void,
  ): void {
    if (this.disposed) return;
    target.addEventListener(type, fn as EventListener);
    this.defer(() => target.removeEventListener(type, fn as EventListener));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const fns = [...this.cleanups];
    liveCleanups -= this.cleanups.size;
    this.cleanups.clear();
    for (const fn of fns) fn();
  }
}

// 한 줄 목적: 전체 화면 오버레이(타이틀·설정·결과 등)의 표시·숨김을 담당하는 공용 호스트를 제공한다
import { el } from './dom';

/** 화면 모듈들이 공유하는 오버레이 컨테이너. 한 번에 한 화면만 표시한다. */
export class OverlayHost {
  readonly element: HTMLElement;
  private returnFocus: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    this.element = el('div', 'overlay');
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-hidden', 'true');
    this.element.tabIndex = -1;
    this.element.addEventListener('keydown', (event) => this.onKeyDown(event));
    root.appendChild(this.element);
  }

  /** HTML을 채우고 오버레이를 표시한다. 반환된 요소에 이벤트를 바인딩한다. */
  show(html: string): HTMLElement {
    if (!this.element.classList.contains('show')) {
      this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    this.element.innerHTML = html;
    this.element.classList.add('show');
    this.element.setAttribute('aria-hidden', 'false');
    queueMicrotask(() => this.focusFirst());
    return this.element;
  }

  hide(): void {
    this.element.classList.remove('show');
    this.element.setAttribute('aria-hidden', 'true');
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
    this.returnFocus = null;
  }

  /** 버튼 id → 핸들러 바인딩 헬퍼. 존재하지 않는 id는 무시한다. */
  bind(handlers: Record<string, () => void>): void {
    for (const [id, fn] of Object.entries(handlers)) {
      this.element.querySelector(`#${id}`)?.addEventListener('click', fn);
    }
  }

  private focusable(): HTMLElement[] {
    return [...this.element.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((node) => !node.hasAttribute('hidden'));
  }

  private focusFirst(): void {
    if (!this.element.classList.contains('show')) return;
    (this.focusable()[0] ?? this.element).focus();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.element.classList.contains('show')) return;
    if (event.key === 'Escape') {
      const close = this.element.querySelector<HTMLElement>(
        '[data-overlay-close], #btn-back, #btn-resume, #ex-close',
      );
      if (close) {
        event.preventDefault();
        close.click();
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = this.focusable();
    if (nodes.length === 0) {
      event.preventDefault();
      this.element.focus();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

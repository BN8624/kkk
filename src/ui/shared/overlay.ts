// 한 줄 목적: 전체 화면 오버레이(타이틀·설정·결과 등)의 표시·숨김을 담당하는 공용 호스트를 제공한다
import { el } from './dom';

/** 화면 모듈들이 공유하는 오버레이 컨테이너. 한 번에 한 화면만 표시한다. */
export class OverlayHost {
  readonly element: HTMLElement;

  constructor(root: HTMLElement) {
    this.element = el('div', 'overlay');
    root.appendChild(this.element);
  }

  /** HTML을 채우고 오버레이를 표시한다. 반환된 요소에 이벤트를 바인딩한다. */
  show(html: string): HTMLElement {
    this.element.innerHTML = html;
    this.element.classList.add('show');
    return this.element;
  }

  hide(): void {
    this.element.classList.remove('show');
  }

  /** 버튼 id → 핸들러 바인딩 헬퍼. 존재하지 않는 id는 무시한다. */
  bind(handlers: Record<string, () => void>): void {
    for (const [id, fn] of Object.entries(handlers)) {
      this.element.querySelector(`#${id}`)?.addEventListener('click', fn);
    }
  }
}

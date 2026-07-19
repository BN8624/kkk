// 한 줄 목적: 화면 모듈들이 공유하는 DOM 헬퍼와 세력 색·문장(엠블럼) 등 공통 비주얼 상수를 제공한다
import type { FactionId } from '../../core/types';

export const FACTION_CSS: Record<FactionId, string> = {
  azure: '#31558f',
  crimson: '#93313c',
  violet: '#5f3d75',
};

export const EMBLEM_SVG: Record<FactionId, string> = {
  azure:
    '<svg viewBox="0 0 20 20"><rect x="8.4" y="3" width="3.2" height="14" fill="#f2ead8"/><rect x="3" y="8.4" width="14" height="3.2" fill="#f2ead8"/></svg>',
  crimson: '<svg viewBox="0 0 20 20"><path d="M3 15 10 4l7 11h-3.4L10 9.2 6.4 15Z" fill="#f2ead8"/></svg>',
  violet: '<svg viewBox="0 0 20 20"><path d="M10 2.5 12 7.6l5.5.3-4.3 3.4 1.5 5.3L10 13.4l-4.7 3.2 1.5-5.3-4.3-3.4 5.5-.3Z" fill="#f2ead8"/></svg>',
};

export const GEAR_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M21.2 12h-3M5.8 12h-3M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1M18.5 18.5l-2.1-2.1M7.6 7.6 5.5 5.5"/></svg>';
export const COIN_SVG =
  '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#c9a227" stroke="#8a6d14" stroke-width="1.4"/><circle cx="10" cy="10" r="4.6" fill="none" stroke="#8a6d14" stroke-width="1.2"/></svg>';
export const CROWN_SVG =
  '<svg viewBox="0 0 64 44"><path d="M6 34 10 12l12 10 10-16 10 16 12-10 4 22Z" fill="#c9a227" stroke="#8a6d14" stroke-width="2" stroke-linejoin="round"/><rect x="6" y="34" width="52" height="6" rx="2" fill="#c9a227" stroke="#8a6d14" stroke-width="2"/></svg>';

export function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

export function button(cls: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

/** label/value 목록을 결과 테이블 HTML로 만든다(값은 escape 처리). */
export function resultTableHtml(lines: { label: string; value: string }[]): string {
  return `<div class="result-table">
    ${lines.map((l) => `<div><span>${escapeHtml(l.label)}</span><b>${escapeHtml(l.value)}</b></div>`).join('')}
  </div>`;
}

/** 사용자 입력 등 신뢰할 수 없는 문자열을 HTML에 안전하게 넣기 위한 escape. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

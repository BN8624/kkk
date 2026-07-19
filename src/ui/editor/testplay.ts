// 한 줄 목적: 테스트 플레이 전용 상단 바와 목표 상태 시트를 렌더링한다(일반 공개 게임 미노출)
import { factionScore } from '../../core/game';
import { defeatMet, starsEarned, victoryMet } from '../../core/scenario/objectives';
import type { GameState } from '../../core/types';
import { t } from '../../i18n';
import { escapeHtml } from '../shared/dom';
import { describeDefeat, describeStar, describeVictory } from './index';

export interface TestPlayHandlers {
  onBackToEditor: () => void;
}

/** 테스트 플레이 배너: 목표 상태 보기와 에디터 복귀 버튼. */
export class TestPlayBar {
  private bar: HTMLElement;
  private sheet: HTMLElement;
  private getState: () => GameState | null;

  constructor(root: HTMLElement, getState: () => GameState | null, handlers: TestPlayHandlers) {
    this.getState = getState;
    this.bar = document.createElement('div');
    this.bar.className = 'ed-pick-banner tp-bar';
    this.bar.innerHTML = `
      <span>${escapeHtml(t('testplay.label'))}</span>
      <button id="tp-objectives">${escapeHtml(t('testplay.objectives'))}</button>
      <button id="tp-exit">${escapeHtml(t('testplay.toEditor'))}</button>`;
    root.appendChild(this.bar);

    this.sheet = document.createElement('div');
    this.sheet.className = 'sheet ed-sheet';
    root.appendChild(this.sheet);

    this.bar.querySelector('#tp-objectives')!.addEventListener('click', () => this.toggleSheet());
    this.bar.querySelector('#tp-exit')!.addEventListener('click', handlers.onBackToEditor);
  }

  private toggleSheet(): void {
    if (this.sheet.classList.contains('show')) {
      this.sheet.classList.remove('show');
      return;
    }
    const state = this.getState();
    if (!state) return;
    const mark = (met: boolean) => (met ? '✓' : '·');
    const rows: string[] = [];
    rows.push(`<b>${escapeHtml(t('testplay.victory'))}</b>`);
    for (const c of state.objectives.victory) {
      rows.push(`<div class="tp-line">${mark(victoryMet(state, c, factionScore))} ${escapeHtml(describeVictory(c))}</div>`);
    }
    rows.push(`<b>${escapeHtml(t('testplay.defeat'))}</b>`);
    for (const c of state.objectives.defeat) {
      rows.push(`<div class="tp-line">${mark(defeatMet(state, c))} ${escapeHtml(describeDefeat(c))}</div>`);
    }
    if (state.objectives.stars.length > 0) {
      rows.push(`<b>${escapeHtml(t('testplay.stars'))}</b>`);
      const earned = starsEarned(state);
      state.objectives.stars.forEach((c, i) => {
        rows.push(`<div class="tp-line">${mark(earned[i])} ${escapeHtml(describeStar(c))}</div>`);
      });
    }
    this.sheet.innerHTML = `
      <h3>${escapeHtml(t('testplay.status'))} <span style="font-size:12.5px;color:#6b6250;">${escapeHtml(t('testplay.statusHint'))}</span></h3>
      <div class="ed-cond-list">${rows.join('')}</div>
      <button class="close-btn">${escapeHtml(t('common.close'))}</button>`;
    this.sheet.querySelector('.close-btn')!.addEventListener('click', () => this.sheet.classList.remove('show'));
    this.sheet.classList.add('show');
  }

  destroy(): void {
    this.bar.remove();
    this.sheet.remove();
  }
}

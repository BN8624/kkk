// 한 줄 목적: 플레이 중 게임 HUD(상단 정보·유닛 패널·생산 시트·튜토리얼·토스트)를 관리한다
import { UNIT_STATS } from '../../core/data';
import { factionScore } from '../../core/game';
import type { FactionId, GameState, Tile, Unit, UnitTypeId } from '../../core/types';
import { factionName, t, terrainName, unitName } from '../../i18n';
import { COIN_SVG, EMBLEM_SVG, FACTION_CSS, GEAR_SVG, el, button, escapeHtml } from '../shared/dom';

export interface HudHandlers {
  onEndTurn: () => void;
  onZoom: (factor: number) => void;
  onProduce: (type: UnitTypeId) => void;
  onCloseProduction: () => void;
  onPause: () => void;
}

/** 플레이 화면 전용 HUD. 오버레이 화면(타이틀·설정·결과 등)은 src/ui의 화면 모듈이 담당한다. */
export class Hud {
  private root: HTMLElement;
  private handlers: HudHandlers;
  private topBar!: HTMLElement;
  private bottomPanel!: HTMLElement;
  private endTurnBtn!: HTMLButtonElement;
  private productionSheet!: HTMLElement;
  private toastEl!: HTMLElement;
  private aiChip!: HTMLElement;
  private tutorialBar!: HTMLElement;

  constructor(root: HTMLElement, handlers: HudHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.build();
  }

  private build(): void {
    this.topBar = el('div', 'hud-top');
    this.root.appendChild(this.topBar);

    this.aiChip = el('div', 'ai-chip');
    this.aiChip.setAttribute('role', 'status');
    this.aiChip.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.aiChip);

    this.tutorialBar = el('div', 'tutorial-bar');
    this.tutorialBar.setAttribute('role', 'status');
    this.root.appendChild(this.tutorialBar);

    const zoomCol = el('div', 'zoom-col');
    const zoomIn = button('icon-btn', '+', () => this.handlers.onZoom(1.25));
    const zoomOut = button('icon-btn', '−', () => this.handlers.onZoom(0.8));
    zoomIn.setAttribute('aria-label', t('hud.zoomIn'));
    zoomOut.setAttribute('aria-label', t('hud.zoomOut'));
    zoomCol.append(zoomIn, zoomOut);
    this.root.appendChild(zoomCol);

    const bottom = el('div', 'hud-bottom');
    this.bottomPanel = el('div', 'unit-panel');
    this.endTurnBtn = button('end-turn', t('hud.endTurn'), () => this.handlers.onEndTurn());
    bottom.append(this.bottomPanel, this.endTurnBtn);
    this.root.appendChild(bottom);

    this.productionSheet = el('div', 'sheet');
    this.root.appendChild(this.productionSheet);

    this.toastEl = el('div', 'toast');
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.toastEl);
  }

  // ---------------- 상단 바 ----------------

  updateTop(state: GameState): void {
    const scores = state.order
      .map((f) => {
        const dead = state.factions[f].eliminated;
        return `<span class="score-chip" style="opacity:${dead ? 0.4 : 1}">
          <span class="crest" style="background:${FACTION_CSS[f]}">${EMBLEM_SVG[f]}</span>
          ${factionScore(state, f)}
        </span>`;
      })
      .join('');
    let crownChip = '';
    if (state.crownHold) {
      const holdCond = state.objectives.victory.find((c) => c.type === 'hold-building');
      const need = holdCond?.turns ?? 0;
      const owner = state.crownHold.owner;
      crownChip = `<span class="hud-chip" style="border-color:${owner ? FACTION_CSS[owner] : '#c9a227'}">👑 ${
        owner ? `${state.crownHold.turns}/${need}` : escapeHtml(t('hud.crownUnclaimed'))
      }</span>`;
    }
    this.topBar.innerHTML = `
      <span class="hud-chip">${escapeHtml(t('hud.turn', { current: state.turn > state.maxTurns ? state.maxTurns : state.turn, max: state.maxTurns }))}</span>
      ${crownChip}
      <span class="hud-scores">${scores}</span>
      <span style="display:flex;gap:7px;align-items:center;">
        <span class="hud-chip">${COIN_SVG}${state.factions[state.config.humanFaction].gold}</span>
        <button class="icon-btn" id="hud-gear" aria-label="${escapeHtml(t('hud.settings'))}">${GEAR_SVG}</button>
      </span>`;
    this.topBar.querySelector('#hud-gear')!.addEventListener('click', () => this.handlers.onPause());
  }

  setAiThinking(faction: FactionId | null): void {
    if (!faction) {
      this.aiChip.classList.remove('show');
      return;
    }
    this.aiChip.textContent = t('hud.aiTurn', { faction: factionName(faction) });
    this.aiChip.classList.add('show');
  }

  setEndTurnEnabled(on: boolean): void {
    this.endTurnBtn.disabled = !on;
  }

  /** 리플레이 재생 등 비플레이 화면에서 플레이 전용 HUD를 숨긴다(줌 버튼은 공유). */
  setPlayControlsVisible(on: boolean): void {
    this.topBar.style.display = on ? '' : 'none';
    this.endTurnBtn.style.display = on ? '' : 'none';
    if (!on) {
      this.bottomPanel.classList.remove('show');
      this.aiChip.classList.remove('show');
      this.hideProduction();
      this.hideTutorial();
    }
  }

  // ---------------- 하단 유닛 패널 ----------------

  showUnitPanel(unit: Unit | null, tile: Tile | null, hint: string): void {
    if (!unit && !tile) {
      this.bottomPanel.classList.remove('show');
      return;
    }
    let html = '';
    if (unit) {
      const s = UNIT_STATS[unit.type];
      html = `<h3><span class="dot" style="background:${FACTION_CSS[unit.faction]}"></span>
        ${escapeHtml(factionName(unit.faction))} ${escapeHtml(unitName(unit.type))}</h3>
        <div class="stats">
          <span>${escapeHtml(t('hud.hp', { current: unit.hp, max: s.hp }))}</span><span>${escapeHtml(t('hud.attackStat', { n: s.atk }))}</span>
          <span>${escapeHtml(t('hud.defenseStat', { n: s.def }))}</span><span>${escapeHtml(t('hud.moveStat', { n: s.move }))}</span><span>${escapeHtml(t('hud.rangeStat', { n: s.range }))}</span>
        </div>`;
    } else if (tile) {
      html = `<h3>${escapeHtml(terrainName(tile.terrain))}</h3>`;
    }
    if (hint) html += `<div class="hint">${escapeHtml(hint)}</div>`;
    this.bottomPanel.innerHTML = html;
    this.bottomPanel.classList.add('show');
  }

  /** 전투 예측 패널: 실제 엔진 계산 결과를 그대로 보여준다. */
  showForecast(o: {
    attackerName: string;
    defenderName: string;
    damage: number;
    counter: number | null;
    kill: boolean;
    die: boolean;
    notes: string[];
    onConfirm: () => void;
  }): void {
    const counterLine = o.kill
      ? `<span style="color:#4f7a3a">${escapeHtml(t('hud.noCounterKill'))}</span>`
      : o.counter !== null
        ? `${escapeHtml(t('hud.counterExpected'))} <b style="color:#8a4a1f">-${o.counter}</b>${o.die ? ` <b style="color:#a33636">${escapeHtml(t('hud.allyDestroyed'))}</b>` : ''}`
        : `<span style="color:#4f7a3a">${escapeHtml(t('hud.noCounter'))}</span>`;
    this.bottomPanel.innerHTML = `
      <h3>⚔ ${escapeHtml(o.attackerName)} → ${escapeHtml(o.defenderName)}</h3>
      <div class="stats">
        <span>${escapeHtml(t('hud.damageExpected'))} <b style="color:#a33636">-${o.damage}</b>${o.kill ? ` <b style="color:#a33636">${escapeHtml(t('hud.kill'))}</b>` : ''}</span>
        <span>${counterLine}</span>
      </div>
      ${o.notes.length > 0 ? `<div class="stats">${o.notes.map((n) => `<span>${escapeHtml(n)}</span>`).join('')}</div>` : ''}
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button id="fc-attack" style="flex:1;height:42px;border-radius:10px;border:1.5px solid #8a6d14;background:#c9a227;font-weight:bold;font-size:15px;color:#2b2416;">${escapeHtml(t('hud.attack'))}</button>
        <button id="fc-cancel" style="flex:1;height:42px;border-radius:10px;border:1.5px solid #8a6d14;background:#e5dbc2;font-size:15px;color:#2b2416;">${escapeHtml(t('common.cancel'))}</button>
      </div>
      <div class="hint">${escapeHtml(t('hud.attackEndsAction'))}</div>`;
    this.bottomPanel.querySelector('#fc-attack')!.addEventListener('click', o.onConfirm);
    this.bottomPanel
      .querySelector('#fc-cancel')!
      .addEventListener('click', () => this.showUnitPanel(null, null, ''));
    this.bottomPanel.classList.add('show');
  }

  // ---------------- 생산 시트 ----------------

  showProduction(buildingName: string, gold: number, costFor: (t: UnitTypeId) => number): void {
    const card = (type: UnitTypeId) => {
      const s = UNIT_STATS[type];
      return `<button class="prod-card" data-type="${type}" ${gold >= costFor(type) ? '' : 'disabled'}>
        <b>${escapeHtml(unitName(type))}</b>
        <span class="cost">${COIN_SVG}${costFor(type)}</span>
        <span class="mini">${escapeHtml(t('hud.attackStat', { n: s.atk }))} · ${escapeHtml(t('hud.defenseStat', { n: s.def }))}<br>${escapeHtml(t('hud.moveStat', { n: s.move }))} · ${escapeHtml(t('hud.rangeStat', { n: s.range }))}</span>
      </button>`;
    };
    this.productionSheet.innerHTML = `
      <h3>${escapeHtml(t('hud.production', { building: buildingName }))} <span class="gold">${COIN_SVG}${gold}</span></h3>
      <div class="prod-cards">${card('infantry')}${card('archer')}${card('cavalry')}</div>
      <button class="close-btn">${escapeHtml(t('common.close'))}</button>`;
    for (const btn of this.productionSheet.querySelectorAll<HTMLButtonElement>('.prod-card')) {
      btn.addEventListener('click', () => this.handlers.onProduce(btn.dataset.type as UnitTypeId));
    }
    this.productionSheet
      .querySelector('.close-btn')!
      .addEventListener('click', () => this.handlers.onCloseProduction());
    this.productionSheet.classList.add('show');
  }

  hideProduction(): void {
    this.productionSheet.classList.remove('show');
  }

  // ---------------- 튜토리얼 ----------------

  showTutorialStep(
    step: number,
    total: number,
    text: string,
    confirmLabel: string | null,
    onConfirm?: () => void,
  ): void {
    this.tutorialBar.innerHTML = `
      <div class="step-label">${escapeHtml(t('hud.tutorial', { step, total }))}</div>
      <p>${escapeHtml(text)}</p>
      ${confirmLabel ? `<button id="tut-ok">${escapeHtml(confirmLabel)}</button>` : ''}`;
    if (confirmLabel && onConfirm) {
      this.tutorialBar.querySelector('#tut-ok')!.addEventListener('click', onConfirm);
    }
    this.tutorialBar.classList.add('show');
  }

  hideTutorial(): void {
    this.tutorialBar.classList.remove('show');
  }

  // ---------------- 토스트 ----------------

  private toastTimer: number | undefined;

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1800);
  }
}

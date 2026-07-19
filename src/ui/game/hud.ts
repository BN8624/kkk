// 한 줄 목적: 플레이 중 게임 HUD(상단 정보·유닛 패널·생산 시트·튜토리얼·토스트)를 관리한다
import { UNIT_STATS } from '../../core/data';
import { factionScore } from '../../core/game';
import { crownStatus } from '../../core/scenario/crown-status';
import type { FactionId, GameState, Tile, Unit, UnitTypeId } from '../../core/types';
import { factionName, t, terrainName, unitName, victoryConditionText } from '../../i18n';
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
  private gameStatusEl!: HTMLElement;
  private productionReturnFocus: HTMLElement | null = null;
  private turnStatus = '';
  private objectiveStatus = '';
  private selectionStatus = '';
  private actionStatus = '';

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
    this.productionSheet.setAttribute('role', 'dialog');
    this.productionSheet.setAttribute('aria-modal', 'true');
    this.productionSheet.setAttribute('aria-hidden', 'true');
    this.productionSheet.tabIndex = -1;
    this.productionSheet.addEventListener('keydown', (event) => this.onProductionKeyDown(event));
    this.root.appendChild(this.productionSheet);

    this.toastEl = el('div', 'toast');
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.toastEl);

    this.gameStatusEl = el('div', 'sr-only');
    this.gameStatusEl.setAttribute('role', 'status');
    this.gameStatusEl.setAttribute('aria-live', 'polite');
    this.gameStatusEl.setAttribute('aria-atomic', 'true');
    this.root.appendChild(this.gameStatusEl);
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
    const cs = crownStatus(state);
    if (cs) {
      const owner = cs.owner;
      const border = owner ? FACTION_CSS[owner] : '#c9a227';
      let label: string;
      if (!cs.active) {
        label = t('hud.crownSealed', { turns: cs.turnsToActivate });
      } else if (owner) {
        label = `${cs.heldTurns}/${cs.needTurns}`;
        if (cs.contested) label += ` · ${t('hud.crownContested')}`;
      } else {
        label = t('hud.crownUnclaimed');
      }
      crownChip = `<span class="hud-chip" style="border-color:${border}">👑 ${escapeHtml(label)}</span>`;
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
    this.turnStatus = t('a11y.turnStatus', {
      current: Math.min(state.turn, state.maxTurns),
      max: state.maxTurns,
      faction: factionName(state.current),
    });
    this.objectiveStatus = t('a11y.objectives', {
      objectives: state.objectives.victory.map(victoryConditionText).join('; '),
    });
    this.updateAccessibleStatus();
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

  showUnitPanel(unit: Unit | null, tile: Tile | null, hint: string, state?: GameState): void {
    if (!unit && !tile) {
      this.bottomPanel.classList.remove('show');
      this.selectionStatus = '';
      this.actionStatus = '';
      this.updateAccessibleStatus();
      return;
    }
    let html = '';
    if (unit) {
      const s = UNIT_STATS[unit.type];
      this.selectionStatus = t('a11y.selectedUnit', {
        faction: factionName(unit.faction),
        unit: unitName(unit.type),
        hp: unit.hp,
        maxHp: s.hp,
      });
      html = `<h3><span class="dot" style="background:${FACTION_CSS[unit.faction]}"></span>
        ${escapeHtml(factionName(unit.faction))} ${escapeHtml(unitName(unit.type))}</h3>
        <div class="stats">
          <span>${escapeHtml(t('hud.hp', { current: unit.hp, max: s.hp }))}</span><span>${escapeHtml(t('hud.attackStat', { n: s.atk }))}</span>
          <span>${escapeHtml(t('hud.defenseStat', { n: s.def }))}</span><span>${escapeHtml(t('hud.moveStat', { n: s.move }))}</span><span>${escapeHtml(t('hud.rangeStat', { n: s.range }))}</span>
        </div>`;
    } else if (tile) {
      this.selectionStatus = t('a11y.selectedTile', { terrain: terrainName(tile.terrain) });
      html = `<h3>${escapeHtml(terrainName(tile.terrain))}</h3>`;
    }
    // 왕관 타일(또는 왕관 위 유닛) 선택 시 상세 상태 패널
    if (state) {
      const crownTile =
        tile?.building === 'crown'
          ? tile
          : unit
            ? state.tiles.find((x) => x.q === unit.q && x.r === unit.r && x.building === 'crown')
            : undefined;
      if (crownTile) {
        const panel = this.renderCrownPanel(state);
        if (panel) html += panel;
      }
    }
    if (hint) html += `<div class="hint">${escapeHtml(hint)}</div>`;
    this.actionStatus = hint ? t('a11y.availableAction', { action: hint }) : '';
    this.bottomPanel.innerHTML = html;
    this.bottomPanel.classList.add('show');
    this.updateAccessibleStatus();
  }

  /** 왕관 요새 선택 시 소유·보유·봉인/경합·예상 승리 상세 HTML. */
  private renderCrownPanel(state: GameState): string {
    const cs = crownStatus(state);
    if (!cs) {
      // hold-building 없는 시나리오의 장식용 왕관 타일
      return `<div class="stats" style="margin-top:6px;flex-direction:column;align-items:flex-start;gap:3px;">
        <span><b>${escapeHtml(t('crown.panel.title'))}</b></span>
      </div>`;
    }
    const lines: string[] = [`<b>${escapeHtml(t('crown.panel.title'))}</b>`];
    lines.push(
      cs.owner
        ? escapeHtml(t('crown.panel.owner', { faction: factionName(cs.owner) }))
        : escapeHtml(t('crown.panel.unclaimed')),
    );
    if (!cs.active) {
      lines.push(escapeHtml(t('crown.panel.sealed', { turns: cs.turnsToActivate })));
    } else {
      lines.push(
        escapeHtml(t('crown.panel.held', { turns: cs.heldTurns, need: cs.needTurns })),
      );
      if (cs.contested) lines.push(escapeHtml(t('crown.panel.contested')));
    }
    const tile = state.tiles.find((x) => x.q === cs.at.q && x.r === cs.at.r);
    if (tile?.owner && cs.owner && tile.owner !== cs.owner) {
      lines.push(escapeHtml(t('crown.panel.reset')));
    }
    if (cs.earliestWinTurn !== null) {
      lines.push(escapeHtml(t('crown.panel.predict', { turn: cs.earliestWinTurn })));
    }
    lines.push(escapeHtml(t('crown.panel.rule', { need: cs.needTurns })));
    return `<div class="stats" style="margin-top:6px;flex-direction:column;align-items:flex-start;gap:3px;">
      ${lines.map((l) => `<span>${l}</span>`).join('')}
    </div>`;
  }

  private updateAccessibleStatus(): void {
    this.gameStatusEl.textContent = [
      this.turnStatus,
      this.objectiveStatus,
      this.selectionStatus,
      this.actionStatus,
    ].filter(Boolean).join('. ');
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
    this.productionReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
    this.productionSheet.setAttribute('aria-hidden', 'false');
    queueMicrotask(() => this.productionFocusable()[0]?.focus());
  }

  hideProduction(): void {
    this.productionSheet.classList.remove('show');
    this.productionSheet.setAttribute('aria-hidden', 'true');
    if (this.productionReturnFocus?.isConnected) this.productionReturnFocus.focus();
    this.productionReturnFocus = null;
  }

  private productionFocusable(): HTMLElement[] {
    return [...this.productionSheet.querySelectorAll<HTMLElement>('button:not([disabled])')];
  }

  private onProductionKeyDown(event: KeyboardEvent): void {
    if (!this.productionSheet.classList.contains('show')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.handlers.onCloseProduction();
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = this.productionFocusable();
    if (nodes.length === 0) return;
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

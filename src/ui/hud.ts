// 한 줄 목적: 상단 정보·유닛 패널·생산 시트·타이틀·일시정지·결과·튜토리얼 등 DOM HUD 전체를 관리한다
import { FACTION_NAMES, TERRAIN_NAMES, UNIT_NAMES, UNIT_STATS } from '../core/data';
import { factionScore } from '../core/game';
import type { FactionId, GameState, Tile, Unit, UnitTypeId } from '../core/types';

export interface HudHandlers {
  onEndTurn: () => void;
  onZoom: (factor: number) => void;
  onProduce: (type: UnitTypeId) => void;
  onCloseProduction: () => void;
  onPause: () => void;
  onResume: () => void;
  onToggleSound: () => boolean; // 새 상태 반환
  onNewGame: () => void;
  onContinue: () => void;
  onToTitle: () => void;
  onReplayTutorial: () => void;
}

const FACTION_CSS: Record<FactionId, string> = {
  player: '#31558f',
  ai1: '#93313c',
  ai2: '#5f3d75',
};

const EMBLEM_SVG: Record<FactionId, string> = {
  player:
    '<svg viewBox="0 0 20 20"><rect x="8.4" y="3" width="3.2" height="14" fill="#f2ead8"/><rect x="3" y="8.4" width="14" height="3.2" fill="#f2ead8"/></svg>',
  ai1: '<svg viewBox="0 0 20 20"><path d="M3 15 10 4l7 11h-3.4L10 9.2 6.4 15Z" fill="#f2ead8"/></svg>',
  ai2: '<svg viewBox="0 0 20 20"><path d="M10 2.5 12 7.6l5.5.3-4.3 3.4 1.5 5.3L10 13.4l-4.7 3.2 1.5-5.3-4.3-3.4 5.5-.3Z" fill="#f2ead8"/></svg>',
};

const GEAR_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M21.2 12h-3M5.8 12h-3M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1M18.5 18.5l-2.1-2.1M7.6 7.6 5.5 5.5"/></svg>';
const COIN_SVG =
  '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#c9a227" stroke="#8a6d14" stroke-width="1.4"/><circle cx="10" cy="10" r="4.6" fill="none" stroke="#8a6d14" stroke-width="1.2"/></svg>';
const CROWN_SVG =
  '<svg viewBox="0 0 64 44"><path d="M6 34 10 12l12 10 10-16 10 16 12-10 4 22Z" fill="#c9a227" stroke="#8a6d14" stroke-width="2" stroke-linejoin="round"/><rect x="6" y="34" width="52" height="6" rx="2" fill="#c9a227" stroke="#8a6d14" stroke-width="2"/></svg>';

export class Hud {
  private root: HTMLElement;
  private handlers: HudHandlers;
  private topBar!: HTMLElement;
  private bottomPanel!: HTMLElement;
  private endTurnBtn!: HTMLButtonElement;
  private productionSheet!: HTMLElement;
  private overlay!: HTMLElement;
  private toastEl!: HTMLElement;
  private aiChip!: HTMLElement;
  private tutorialBar!: HTMLElement;

  constructor(root: HTMLElement, handlers: HudHandlers) {
    this.root = root;
    this.handlers = handlers;
    this.injectStyles();
    this.build();
  }

  private injectStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
#hud * { box-sizing: border-box; margin: 0; font-family: Georgia, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; }
#hud button { cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.hud-top {
  position: absolute; left: 0; right: 0; top: 0;
  padding: calc(env(safe-area-inset-top, 0px) + 8px) 10px 8px;
  display: flex; align-items: center; gap: 8px; justify-content: space-between;
  pointer-events: none;
}
.hud-chip {
  background: rgba(29, 26, 20, 0.82); color: #f2ead8;
  border: 1px solid #c9a227; border-radius: 10px;
  padding: 6px 10px; font-size: 14px; line-height: 1.2;
  display: flex; align-items: center; gap: 6px; pointer-events: auto;
  white-space: nowrap;
}
.hud-chip svg { width: 16px; height: 16px; display: block; }
.hud-scores { display: flex; gap: 5px; }
.score-chip { display: flex; align-items: center; gap: 4px; padding: 5px 7px; border-radius: 9px;
  border: 1px solid rgba(242,234,216,.35); font-size: 13px; color: #f2ead8; }
.score-chip .crest { width: 17px; height: 17px; border-radius: 5px; display: flex; align-items: center; justify-content: center; }
.score-chip .crest svg { width: 12px; height: 12px; }
.icon-btn {
  width: 42px; height: 42px; border-radius: 12px; border: 1px solid #c9a227;
  background: rgba(29, 26, 20, 0.82); color: #e8d9a0;
  display: flex; align-items: center; justify-content: center; pointer-events: auto;
}
.icon-btn svg { width: 22px; height: 22px; }
.zoom-col {
  position: absolute; right: 10px; top: 50%; transform: translateY(-70%);
  display: flex; flex-direction: column; gap: 8px; pointer-events: none;
}
.zoom-col .icon-btn { font-size: 24px; font-weight: bold; }
.ai-chip {
  position: absolute; top: calc(env(safe-area-inset-top, 0px) + 58px); left: 50%;
  transform: translateX(-50%);
  background: rgba(29,26,20,.88); color: #f2ead8; border: 1px solid #c9a227;
  padding: 7px 14px; border-radius: 20px; font-size: 14px; display: none;
  pointer-events: none;
}
.ai-chip.show { display: block; }
.hud-bottom {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 8px 10px calc(env(safe-area-inset-bottom, 0px) + 10px);
  display: flex; align-items: flex-end; gap: 10px; pointer-events: none;
}
.unit-panel {
  flex: 1; background: rgba(242, 234, 216, 0.95); border: 1.5px solid #8a6d14;
  border-radius: 14px; padding: 10px 12px; color: #2b2416; display: none;
  pointer-events: auto; box-shadow: 0 4px 14px rgba(0,0,0,.35);
}
.unit-panel.show { display: block; }
.unit-panel h3 { font-size: 16px; display: flex; align-items: center; gap: 7px; }
.unit-panel .dot { width: 13px; height: 13px; border-radius: 4px; display: inline-block; }
.unit-panel .stats { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 5px; font-size: 13px; color: #4f4636; }
.unit-panel .hint { margin-top: 6px; font-size: 13px; color: #6b5b2a; font-weight: bold; }
.end-turn {
  min-width: 96px; height: 56px; border-radius: 16px; border: 2px solid #8a6d14;
  background: linear-gradient(#d9b544, #c9a227); color: #2b2416;
  font-size: 17px; font-weight: bold; pointer-events: auto;
  box-shadow: 0 4px 12px rgba(0,0,0,.4);
}
.end-turn:disabled { filter: grayscale(.7) brightness(.75); }
.sheet {
  position: absolute; left: 0; right: 0; bottom: 0;
  background: #f2ead8; border-top: 2px solid #8a6d14; border-radius: 18px 18px 0 0;
  padding: 14px 14px calc(env(safe-area-inset-bottom, 0px) + 14px);
  transform: translateY(110%); transition: transform .22s ease; pointer-events: auto;
  box-shadow: 0 -6px 20px rgba(0,0,0,.4); color: #2b2416;
}
.sheet.show { transform: translateY(0); }
.sheet h3 { font-size: 17px; margin-bottom: 4px; display:flex; justify-content: space-between; align-items:center; }
.sheet .gold { font-size: 14px; display: flex; align-items: center; gap: 5px; }
.sheet .gold svg { width: 15px; height: 15px; }
.prod-cards { display: flex; gap: 8px; margin-top: 10px; }
.prod-card {
  flex: 1; border: 1.5px solid #8a6d14; border-radius: 12px; background: #faf5e8;
  padding: 10px 6px; text-align: center; font-size: 13px; color: #2b2416;
}
.prod-card b { font-size: 15px; display: block; }
.prod-card .cost { color: #8a6d14; font-weight: bold; margin: 3px 0; display: flex; align-items: center; justify-content: center; gap: 3px; }
.prod-card .cost svg { width: 13px; height: 13px; }
.prod-card .mini { color: #6b6250; font-size: 11.5px; line-height: 1.5; }
.prod-card:disabled { opacity: .45; }
.sheet .close-btn {
  margin-top: 10px; width: 100%; height: 44px; border-radius: 12px;
  border: 1.5px solid #8a6d14; background: #e5dbc2; font-size: 15px; color: #2b2416;
}
.overlay {
  position: absolute; inset: 0; background: #151b2b;
  display: none; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; pointer-events: auto; padding: 24px;
  padding-top: calc(env(safe-area-inset-top, 0px) + 24px);
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 24px);
  overflow-y: auto;
}
.overlay.show { display: flex; }
.overlay .crown { width: 84px; }
.overlay h1 { color: #f2ead8; font-size: 34px; letter-spacing: 2px; text-align: center; }
.overlay .subtitle { color: #a9b4cc; font-size: 15px; text-align: center; line-height: 1.6; }
.overlay .big-btn {
  width: min(300px, 82vw); height: 56px; border-radius: 16px; font-size: 18px; font-weight: bold;
  border: 2px solid #8a6d14; background: linear-gradient(#d9b544, #c9a227); color: #2b2416;
}
.overlay .sub-btn {
  width: min(300px, 82vw); height: 52px; border-radius: 16px; font-size: 16px;
  border: 1.5px solid #6b7894; background: rgba(242,234,216,.08); color: #d8deeb;
}
.overlay .result-word { font-size: 44px; }
.overlay .result-word.win { color: #e8c95a; }
.overlay .result-word.lose { color: #b95c66; }
.result-table {
  background: rgba(242,234,216,.06); border: 1px solid rgba(201,162,39,.5);
  border-radius: 14px; padding: 12px 20px; min-width: min(300px, 82vw);
}
.result-table div { display: flex; justify-content: space-between; gap: 24px; color: #c6cede;
  font-size: 15px; padding: 4px 0; }
.result-table div b { color: #f2ead8; }
.tutorial-bar {
  position: absolute; left: 50%; transform: translateX(-50%);
  top: calc(env(safe-area-inset-top, 0px) + 58px);
  width: min(430px, calc(100vw - 24px));
  background: rgba(242, 234, 216, 0.97); border: 1.5px solid #8a6d14; border-radius: 14px;
  padding: 10px 14px; color: #2b2416; display: none; pointer-events: auto;
  box-shadow: 0 4px 14px rgba(0,0,0,.4);
}
.tutorial-bar.show { display: block; }
.tutorial-bar .step-label { font-size: 12px; color: #8a6d14; font-weight: bold; }
.tutorial-bar p { font-size: 15px; margin-top: 2px; line-height: 1.45; }
.tutorial-bar button {
  margin-top: 8px; height: 40px; padding: 0 18px; border-radius: 10px;
  border: 1.5px solid #8a6d14; background: #c9a227; font-size: 14px; font-weight: bold; color: #2b2416;
}
.toast {
  position: absolute; left: 50%; bottom: calc(env(safe-area-inset-bottom, 0px) + 96px);
  transform: translateX(-50%);
  background: rgba(29,26,20,.9); color: #f2ead8; border: 1px solid #c9a227;
  padding: 9px 16px; border-radius: 20px; font-size: 14px; opacity: 0;
  transition: opacity .25s; pointer-events: none; white-space: nowrap;
}
.toast.show { opacity: 1; }
@media (orientation: landscape) {
  .hud-bottom { max-width: 640px; left: 50%; transform: translateX(-50%); right: auto; width: 100%; }
  .sheet { max-width: 560px; left: 50%; transform: translate(-50%, 110%); border-radius: 18px 18px 0 0; }
  .sheet.show { transform: translate(-50%, 0); }
}
`;
    document.head.appendChild(style);
  }

  private build(): void {
    this.root.innerHTML = '';
    this.topBar = el('div', 'hud-top');
    this.root.appendChild(this.topBar);

    this.aiChip = el('div', 'ai-chip');
    this.root.appendChild(this.aiChip);

    this.tutorialBar = el('div', 'tutorial-bar');
    this.root.appendChild(this.tutorialBar);

    const zoomCol = el('div', 'zoom-col');
    const zoomIn = button('icon-btn', '+', () => this.handlers.onZoom(1.25));
    const zoomOut = button('icon-btn', '−', () => this.handlers.onZoom(0.8));
    zoomCol.append(zoomIn, zoomOut);
    this.root.appendChild(zoomCol);

    const bottom = el('div', 'hud-bottom');
    this.bottomPanel = el('div', 'unit-panel');
    this.endTurnBtn = button('end-turn', '턴 종료', () => this.handlers.onEndTurn());
    bottom.append(this.bottomPanel, this.endTurnBtn);
    this.root.appendChild(bottom);

    this.productionSheet = el('div', 'sheet');
    this.root.appendChild(this.productionSheet);

    this.toastEl = el('div', 'toast');
    this.root.appendChild(this.toastEl);

    this.overlay = el('div', 'overlay');
    this.root.appendChild(this.overlay);
  }

  // ---------------- 상단 바 ----------------

  updateTop(state: GameState): void {
    const scores = (['player', 'ai1', 'ai2'] as FactionId[])
      .map((f) => {
        const dead = state.factions[f].eliminated;
        return `<span class="score-chip" style="opacity:${dead ? 0.4 : 1}">
          <span class="crest" style="background:${FACTION_CSS[f]}">${EMBLEM_SVG[f]}</span>
          ${factionScore(state, f)}
        </span>`;
      })
      .join('');
    this.topBar.innerHTML = `
      <span class="hud-chip">${state.turn > state.maxTurns ? state.maxTurns : state.turn}/${state.maxTurns}턴</span>
      <span class="hud-scores">${scores}</span>
      <span style="display:flex;gap:7px;align-items:center;">
        <span class="hud-chip">${COIN_SVG}${state.factions.player.gold}</span>
        <button class="icon-btn" id="hud-gear" aria-label="설정">${GEAR_SVG}</button>
      </span>`;
    this.topBar.querySelector('#hud-gear')!.addEventListener('click', () => this.handlers.onPause());
  }

  setAiThinking(faction: FactionId | null): void {
    if (!faction) {
      this.aiChip.classList.remove('show');
      return;
    }
    this.aiChip.textContent = `${FACTION_NAMES[faction]}의 턴...`;
    this.aiChip.classList.add('show');
  }

  setEndTurnEnabled(on: boolean): void {
    this.endTurnBtn.disabled = !on;
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
        ${FACTION_NAMES[unit.faction]} ${UNIT_NAMES[unit.type]}</h3>
        <div class="stats">
          <span>체력 ${unit.hp}/${s.hp}</span><span>공격 ${s.atk}</span>
          <span>방어 ${s.def}</span><span>이동 ${s.move}</span><span>사거리 ${s.range}</span>
        </div>`;
    } else if (tile) {
      html = `<h3>${TERRAIN_NAMES[tile.terrain]}</h3>`;
    }
    if (hint) html += `<div class="hint">${hint}</div>`;
    this.bottomPanel.innerHTML = html;
    this.bottomPanel.classList.add('show');
  }

  // ---------------- 생산 시트 ----------------

  showProduction(buildingName: string, gold: number, canAfford: (t: UnitTypeId) => boolean): void {
    const card = (type: UnitTypeId) => {
      const s = UNIT_STATS[type];
      return `<button class="prod-card" data-type="${type}" ${canAfford(type) ? '' : 'disabled'}>
        <b>${UNIT_NAMES[type]}</b>
        <span class="cost">${COIN_SVG}${s.cost}</span>
        <span class="mini">공격 ${s.atk} · 방어 ${s.def}<br>이동 ${s.move} · 사거리 ${s.range}</span>
      </button>`;
    };
    this.productionSheet.innerHTML = `
      <h3>${buildingName} — 유닛 생산 <span class="gold">${COIN_SVG}${gold}</span></h3>
      <div class="prod-cards">${card('infantry')}${card('archer')}${card('cavalry')}</div>
      <button class="close-btn">닫기</button>`;
    for (const btn of this.productionSheet.querySelectorAll<HTMLButtonElement>('.prod-card')) {
      btn.addEventListener('click', () =>
        this.handlers.onProduce(btn.dataset.type as UnitTypeId),
      );
    }
    this.productionSheet
      .querySelector('.close-btn')!
      .addEventListener('click', () => this.handlers.onCloseProduction());
    this.productionSheet.classList.add('show');
  }

  hideProduction(): void {
    this.productionSheet.classList.remove('show');
  }

  // ---------------- 오버레이 화면 ----------------

  showTitle(hasSave: boolean): void {
    this.overlay.innerHTML = `
      <div class="crown">${CROWN_SVG}</div>
      <h1>세 왕관의 섬</h1>
      <p class="subtitle">하나의 섬, 세 개의 왕관.<br>12턴 안에 가장 강한 왕국을 세우십시오.</p>
      ${hasSave ? '<button class="big-btn" id="btn-continue">이어하기</button>' : ''}
      <button class="${hasSave ? 'sub-btn' : 'big-btn'}" id="btn-new">새 게임</button>`;
    this.overlay.querySelector('#btn-new')!.addEventListener('click', () => this.handlers.onNewGame());
    this.overlay
      .querySelector('#btn-continue')
      ?.addEventListener('click', () => this.handlers.onContinue());
    this.overlay.classList.add('show');
  }

  showPause(soundOn: boolean): void {
    this.overlay.innerHTML = `
      <h1 style="font-size:26px;">일시정지</h1>
      <button class="big-btn" id="btn-resume">계속하기</button>
      <button class="sub-btn" id="btn-sound">사운드: ${soundOn ? '켜짐' : '꺼짐'}</button>
      <button class="sub-btn" id="btn-tutorial">튜토리얼 다시 보기</button>
      <button class="sub-btn" id="btn-restart">새 게임 (저장 초기화)</button>
      <button class="sub-btn" id="btn-title">타이틀로</button>`;
    this.overlay.querySelector('#btn-resume')!.addEventListener('click', () => this.handlers.onResume());
    this.overlay.querySelector('#btn-sound')!.addEventListener('click', (e) => {
      const on = this.handlers.onToggleSound();
      (e.currentTarget as HTMLElement).textContent = `사운드: ${on ? '켜짐' : '꺼짐'}`;
    });
    this.overlay
      .querySelector('#btn-tutorial')!
      .addEventListener('click', () => this.handlers.onReplayTutorial());
    this.overlay.querySelector('#btn-restart')!.addEventListener('click', () => this.handlers.onNewGame());
    this.overlay.querySelector('#btn-title')!.addEventListener('click', () => this.handlers.onToTitle());
    this.overlay.classList.add('show');
  }

  showResult(state: GameState): void {
    const won = state.winner === 'player';
    const draw = state.winner === 'draw';
    const word = draw ? '무승부' : won ? '승리' : '패배';
    const cls = won ? 'win' : 'lose';
    this.overlay.innerHTML = `
      ${won ? `<div class="crown">${CROWN_SVG}</div>` : ''}
      <h1 class="result-word ${cls}">${word}</h1>
      <div class="result-table">
        <div><span>총 턴</span><b>${Math.min(state.turn, state.maxTurns)}턴</b></div>
        <div><span>점령한 거점</span><b>${state.stats.captured}곳</b></div>
        <div><span>처치한 적</span><b>${state.stats.kills}기</b></div>
        <div><span>생산한 유닛</span><b>${state.stats.produced}기</b></div>
        <div><span>최종 지배 점수</span><b>${factionScore(state, 'player')}점</b></div>
      </div>
      <button class="big-btn" id="btn-again">다시 하기</button>
      <button class="sub-btn" id="btn-title">타이틀로</button>`;
    this.overlay.querySelector('#btn-again')!.addEventListener('click', () => this.handlers.onNewGame());
    this.overlay.querySelector('#btn-title')!.addEventListener('click', () => this.handlers.onToTitle());
    this.overlay.classList.add('show');
  }

  hideOverlay(): void {
    this.overlay.classList.remove('show');
  }

  // ---------------- 튜토리얼 ----------------

  showTutorialStep(step: number, total: number, text: string, confirmLabel: string | null, onConfirm?: () => void): void {
    this.tutorialBar.innerHTML = `
      <div class="step-label">튜토리얼 ${step}/${total}</div>
      <p>${text}</p>
      ${confirmLabel ? `<button id="tut-ok">${confirmLabel}</button>` : ''}`;
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

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

function button(cls: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

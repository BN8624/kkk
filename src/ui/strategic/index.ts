// 한 줄 목적: 전략 모드 메인 화면(지도·HUD·군단 패널) 렌더링 API를 노출한다
import { UNIT_STATS } from '../../core/data';
import type { FactionId } from '../../core/types';
import type { StrategicArmy, StrategicGameState } from '../../strategic/types';
import { factionName, t, unitName } from '../../i18n';
import { escapeHtml } from '../shared/dom';
import { bindStrategicMap, renderStrategicMapHtml, strategicRegionName } from './map-view';
import { injectStrategicStyles } from './styles';

export { showStrategicFactionPick, showStrategicBattleSummary, showStrategicCampaignResult } from './screens';
export { strategicRegionName } from './map-view';
export { injectStrategicStyles } from './styles';

export interface StrategicScreenHandlers {
  onRegion: (regionId: string) => void;
  onSelectArmy: (armyId: string) => void;
  onHold: () => void;
  onReplenish: () => void;
  onEndTurn: () => void;
  onTitle: () => void;
}

export interface StrategicScreenOpts {
  state: StrategicGameState;
  selectedArmyId: string | null;
  moveTargets: string[];
  busy: boolean;
  log: string[];
  host: HTMLElement;
  handlers: StrategicScreenHandlers;
}

function countOwned(state: StrategicGameState, faction: FactionId, kind: 'regions' | 'capitals'): number {
  return state.regions.filter((r) => {
    if (r.owner !== faction) return false;
    if (kind === 'capitals') return r.settlement === 'capital';
    return true;
  }).length;
}

function armyPanelHtml(state: StrategicGameState, army: StrategicArmy | null, busy: boolean): string {
  if (!army) {
    return `<div class="strategic-panel" id="strategic-panel"><p class="row">${escapeHtml(t('strategic.army.moveHint'))}</p></div>`;
  }
  const regionName = strategicRegionName(army.regionId);
  const units = army.units
    .map((u) => {
      const max = UNIT_STATS[u.type].hp;
      return `<div class="unit-line">${escapeHtml(unitName(u.type))} · HP ${u.hp}/${max}</div>`;
    })
    .join('');
  const canAct = !army.moved && !busy && state.currentFaction === state.humanFaction && state.phase === 'orders';
  return `
    <div class="strategic-panel" id="strategic-panel">
      <h3>${escapeHtml(t('strategic.army.name'))} · ${escapeHtml(army.id)}</h3>
      <div class="row">${escapeHtml(t('strategic.army.faction', { faction: factionName(army.faction) }))}</div>
      <div class="row">${escapeHtml(t('strategic.army.region', { region: regionName }))}</div>
      <div class="row">${escapeHtml(army.moved ? t('strategic.army.moved') : t('strategic.army.ready'))}</div>
      <div class="row">${escapeHtml(t('strategic.army.units', { n: army.units.length }))}</div>
      ${units}
      <div class="btn-row">
        <button type="button" id="st-hold" ${canAct ? '' : 'disabled'}>${escapeHtml(t('strategic.army.hold'))}</button>
        <button type="button" id="st-replenish" ${canAct ? '' : 'disabled'}>${escapeHtml(t('strategic.army.replenish'))}</button>
      </div>
      <p class="row" style="margin-top:6px;">${escapeHtml(t('strategic.army.moveHint'))}</p>
    </div>`;
}

/** 전략 루트 호스트에 전체 UI를 그린다. */
export function renderStrategicScreen(opts: StrategicScreenOpts): void {
  injectStrategicStyles();
  const { state, selectedArmyId, moveTargets, busy, log, host, handlers } = opts;
  const me = state.humanFaction;
  const selected =
    selectedArmyId ? state.armies.find((a) => a.id === selectedArmyId) ?? null : null;

  host.hidden = false;
  host.innerHTML = `
    <div class="strategic-hud" role="region" aria-label="strategic hud">
      <span class="chip">${escapeHtml(t('strategic.hud.turn', { turn: state.turn, max: state.maxTurns }))}</span>
      <span class="chip">${escapeHtml(t('strategic.hud.faction', { faction: factionName(state.currentFaction) }))}</span>
      <span class="chip">${escapeHtml(t('strategic.hud.treasury', { gold: state.treasury[me] }))}</span>
      <span class="chip">${escapeHtml(t('strategic.hud.regions', { n: countOwned(state, me, 'regions') }))}</span>
      <span class="chip">${escapeHtml(t('strategic.hud.capitals', { n: countOwned(state, me, 'capitals') }))}</span>
      <span class="chip">${escapeHtml(t('strategic.hud.armies', { n: state.armies.filter((a) => a.faction === me).length }))}</span>
      <div class="actions">
        <button type="button" id="st-end" ${busy || state.currentFaction !== me || state.phase !== 'orders' ? 'disabled' : ''}>${escapeHtml(t('strategic.hud.endTurn'))}</button>
        <button type="button" class="secondary" id="st-title">${escapeHtml(t('strategic.hud.toTitle'))}</button>
      </div>
    </div>
    <div class="strategic-body">
      ${renderStrategicMapHtml(state, { selectedArmyId, moveTargets })}
      ${armyPanelHtml(state, selected, busy)}
      <div class="strategic-log" aria-live="polite">${log.map((l) => escapeHtml(l)).join('<br>')}</div>
    </div>
    ${busy ? `<div class="strategic-busy-banner" role="status">${escapeHtml(t('strategic.busy'))}</div>` : ''}
  `;

  bindStrategicMap(host, {
    onRegion: handlers.onRegion,
    onArmy: handlers.onSelectArmy,
  });

  // 지역 탭 시 해당 주둔 아군 군단도 선택 가능하도록 보조: 군단 칩이 없으므로 region 핸들러에서 처리
  host.querySelector('#st-hold')?.addEventListener('click', () => handlers.onHold());
  host.querySelector('#st-replenish')?.addEventListener('click', () => handlers.onReplenish());
  host.querySelector('#st-end')?.addEventListener('click', () => handlers.onEndTurn());
  host.querySelector('#st-title')?.addEventListener('click', () => handlers.onTitle());
}

export function hideStrategicScreen(host: HTMLElement): void {
  host.hidden = true;
  host.innerHTML = '';
}

/** 전략 루트 DOM을 hud 아래에 보장한다. */
export function ensureStrategicHost(hudRoot: HTMLElement): HTMLElement {
  injectStrategicStyles();
  let el = document.getElementById('strategic-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'strategic-root';
    el.className = 'strategic-root';
    el.hidden = true;
    hudRoot.appendChild(el);
  }
  return el;
}

// 한 줄 목적: 전략 모드 메인 화면(섬 지도·HUD·선택 패널) 렌더링 API를 노출한다
import type { FactionId } from '../../core/types';
import type { StrategicGameState } from '../../strategic/types';
import { factionName, t } from '../../i18n';
import { escapeHtml } from '../shared/dom';
import { bindStrategicMap, renderStrategicMapHtml } from './map-view';
import { renderSelectionPanel } from './map-panel';
import { injectStrategicStyles } from './styles';

export {
  showStrategicFactionPick,
  showStrategicBattleSummary,
  showStrategicCampaignResult,
} from './screens';
export { strategicRegionName, getArmyTokenEl, getStrategicMapSvg } from './map-view';
export { injectStrategicStyles } from './styles';
export {
  animateArmyMove,
  flashBattleClash,
  flashRegionCapture,
  showMovePreviewPath,
} from './map-animation';
export {
  STRATEGIC_REGION_GEOMETRY,
  STRATEGIC_MAP_VIEWBOX,
  geometryAdjacencyMatchesCanon,
  assertGeometryCoverage,
  isValidSvgPath,
  isPointInViewBox,
  buildMovePathPoints,
} from './map-geometry';

export interface StrategicScreenHandlers {
  onRegion: (regionId: string) => void;
  onSelectArmy: (armyId: string) => void;
  onClearSelection: () => void;
  onHold: () => void;
  onReplenish: () => void;
  onEndTurn: () => void;
  onTitle: () => void;
}

export interface StrategicScreenOpts {
  state: StrategicGameState;
  selectedArmyId: string | null;
  selectedRegionId: string | null;
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

/** 전략 루트 호스트에 전체 UI를 그린다. */
export function renderStrategicScreen(opts: StrategicScreenOpts): void {
  injectStrategicStyles();
  const { state, selectedArmyId, selectedRegionId, moveTargets, busy, log, host, handlers } =
    opts;
  const me = state.humanFaction;

  host.hidden = false;
  host.innerHTML = `
    <div class="strategic-hud" role="region" aria-label="strategic hud">
      <span class="chip">${escapeHtml(t('strategic.hud.turn', { turn: state.turn, max: state.maxTurns }))}</span>
      <span class="chip">${escapeHtml(t('strategic.hud.treasury', { gold: state.treasury[me] }))}</span>
      <span class="chip">${escapeHtml(factionName(state.currentFaction))}</span>
      <span class="chip">${escapeHtml(t('strategic.hud.regions', { n: countOwned(state, me, 'regions') }))} · ${escapeHtml(t('strategic.hud.armies', { n: state.armies.filter((a) => a.faction === me).length }))}</span>
      <div class="actions">
        <button type="button" id="st-end" ${busy || state.currentFaction !== me || state.phase !== 'orders' ? 'disabled' : ''}>${escapeHtml(t('strategic.hud.endTurn'))}</button>
        <button type="button" class="secondary" id="st-title">${escapeHtml(t('strategic.hud.toTitle'))}</button>
      </div>
    </div>
    <div class="strategic-body">
      ${renderStrategicMapHtml(state, { selectedArmyId, selectedRegionId, moveTargets })}
      ${renderSelectionPanel({ state, selectedArmyId, selectedRegionId, moveTargets, busy })}
      ${log.length ? `<div class="strategic-log-inline" aria-live="polite">${log.map((l) => escapeHtml(l)).join(' · ')}</div>` : ''}
    </div>
    ${busy ? `<div class="strategic-busy-banner" role="status">${escapeHtml(t('strategic.busy'))}</div>` : ''}
  `;

  bindStrategicMap(host, {
    onRegion: handlers.onRegion,
    onArmy: handlers.onSelectArmy,
    onOcean: handlers.onClearSelection,
  });

  host.querySelector('#st-hold')?.addEventListener('click', () => handlers.onHold());
  host.querySelector('#st-replenish')?.addEventListener('click', () => handlers.onReplenish());
  host.querySelector('#st-end')?.addEventListener('click', () => handlers.onEndTurn());
  host.querySelector('#st-title')?.addEventListener('click', () => handlers.onTitle());
  host.querySelector('#st-panel-close')?.addEventListener('click', () => handlers.onClearSelection());
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

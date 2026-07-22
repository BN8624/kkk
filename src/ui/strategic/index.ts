// 한 줄 목적: 전략 모드 메인 화면(섬 지도·compact HUD·선택 패널) 렌더링 API를 노출한다
import type { FactionId } from '../../core/types';
import type { StrategicGameState } from '../../strategic/types';
import { factionName, t } from '../../i18n';
import { escapeHtml } from '../shared/dom';
import { bindStrategicMap, renderStrategicMapHtml } from './map-view';
import { renderSelectionPanel } from './map-panel';
import { injectStrategicStyles } from './styles';
import { factionEmblemSvg } from './map-icons';

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

/** compact HUD HTML — 칩 박스 다수 대신 한 줄 메타. */
export function renderCompactHud(state: StrategicGameState, busy: boolean): string {
  const me = state.humanFaction;
  const regions = countOwned(state, me, 'regions');
  const armies = state.armies.filter((a) => a.faction === me).length;
  const canEnd =
    !busy && state.currentFaction === me && state.phase === 'orders';
  // crest: inline SVG (viewBox 맞춤)
  const crest = `<span class="hud-crest" aria-hidden="true"><svg viewBox="-8 -8 16 16" width="26" height="26">${factionEmblemSvg(me, 14)}</svg></span>`;
  return `
    <div class="strategic-hud" role="region" aria-label="strategic hud">
      ${crest}
      <div class="hud-main">
        <span class="hud-kingdom">${escapeHtml(factionName(me))}</span>
        <span class="hud-meta">${escapeHtml(String(state.turn))}/${escapeHtml(String(state.maxTurns))}</span>
        <span class="hud-meta">
          ${escapeHtml(t('strategic.hud.treasury', { gold: state.treasury[me] }))}
          <span class="sep">·</span>
          ${escapeHtml(t('strategic.hud.regions', { n: regions }))}
          <span class="sep">·</span>
          ${escapeHtml(t('strategic.hud.armies', { n: armies }))}
        </span>
      </div>
      <div class="hud-actions">
        <button type="button" id="st-end" ${canEnd ? '' : 'disabled'}>${escapeHtml(t('strategic.hud.endTurn'))}</button>
        <button type="button" class="secondary" id="st-title" title="${escapeHtml(t('strategic.hud.toTitle'))}" aria-label="${escapeHtml(t('strategic.hud.toTitle'))}">☰</button>
      </div>
    </div>`;
}

/** 전략 화면 전체 HTML(순수 문자열, 단위 테스트용). */
export function buildStrategicScreenHtml(opts: {
  state: StrategicGameState;
  selectedArmyId: string | null;
  selectedRegionId: string | null;
  moveTargets: string[];
  busy: boolean;
  log: string[];
}): string {
  const { state, selectedArmyId, selectedRegionId, moveTargets, busy, log } = opts;
  return `
    ${renderCompactHud(state, busy)}
    <div class="strategic-body">
      ${renderStrategicMapHtml(state, { selectedArmyId, selectedRegionId, moveTargets })}
      ${renderSelectionPanel({ state, selectedArmyId, selectedRegionId, moveTargets, busy })}
      ${log.length ? `<div class="strategic-log-inline" aria-live="polite">${log.map((l) => escapeHtml(l)).join(' · ')}</div>` : ''}
    </div>
    ${busy ? `<div class="strategic-busy-banner" role="status">${escapeHtml(t('strategic.busy'))}</div>` : ''}`;
}

/** 전략 루트 호스트에 전체 UI를 그린다. */
export function renderStrategicScreen(opts: StrategicScreenOpts): void {
  injectStrategicStyles();
  const { state, selectedArmyId, selectedRegionId, moveTargets, busy, log, host, handlers } =
    opts;

  host.hidden = false;
  host.innerHTML = buildStrategicScreenHtml({
    state,
    selectedArmyId,
    selectedRegionId,
    moveTargets,
    busy,
    log,
  });

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

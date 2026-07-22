// 한 줄 목적: 전략 지도 하단 선택 슬라이드 패널(지역·군단) HTML을 생성한다
import { UNIT_STATS } from '../../core/data';
import type { StrategicArmy, StrategicGameState, StrategicRegion } from '../../strategic/types';
import { factionName, t, unitName, type MessageKey } from '../../i18n';
import { escapeHtml } from '../shared/dom';
import { strategicRegionName } from './map-view';

function settlementLabel(region: StrategicRegion): string {
  if (!region.settlement) return '—';
  if (region.settlement === 'capital') return t('strategic.region.settlement.capital');
  if (region.settlement === 'town') return t('strategic.region.settlement.town');
  return t('strategic.region.settlement.fort');
}

function terrainLabel(terrain: StrategicRegion['terrain']): string {
  return t(`terrain.${terrain}` as MessageKey);
}

function ownerText(region: StrategicRegion): string {
  if (region.owner === null) return t('strategic.region.neutral');
  return t('strategic.region.owner', { owner: factionName(region.owner) });
}

export function emptyPanelHtml(): string {
  return `
    <div class="strategic-panel strategic-panel--hint" id="strategic-panel">
      <p class="row hint">${escapeHtml(t('strategic.panel.hint'))}</p>
    </div>`;
}

export function regionPanelHtml(
  region: StrategicRegion,
  armies: StrategicArmy[],
): string {
  const garrison = armies
    .map((a) => {
      const n = a.units.length;
      return `${factionName(a.faction)} · ${n}`;
    })
    .join(', ');
  return `
    <div class="strategic-panel" id="strategic-panel" role="region" aria-label="${escapeHtml(strategicRegionName(region.id))}">
      <div class="panel-head">
        <h3>${escapeHtml(strategicRegionName(region.id))}</h3>
        <button type="button" class="panel-close" id="st-panel-close" aria-label="${escapeHtml(t('strategic.panel.close'))}">×</button>
      </div>
      <div class="row">${escapeHtml(ownerText(region))}</div>
      <div class="row">${escapeHtml(t('strategic.region.terrain', { terrain: terrainLabel(region.terrain) }))} · ${escapeHtml(settlementLabel(region))}</div>
      <div class="row">${escapeHtml(t('strategic.region.income', { n: region.income }))} · ${escapeHtml(t('strategic.region.defense', { n: region.defense }))}</div>
      <div class="row">${escapeHtml(t('strategic.region.garrison', { n: armies.length }))}${garrison ? `: ${escapeHtml(garrison)}` : ''}</div>
    </div>`;
}

export function armyPanelHtml(
  state: StrategicGameState,
  army: StrategicArmy,
  busy: boolean,
  moveTargets: string[],
): string {
  const regionName = strategicRegionName(army.regionId);
  const units = army.units
    .map((u) => {
      const max = UNIT_STATS[u.type].hp;
      const dmg = u.hp < max ? ` · HP ${u.hp}/${max}` : '';
      return `<div class="unit-line">${escapeHtml(unitName(u.type))}${escapeHtml(dmg)}</div>`;
    })
    .join('');
  const canAct =
    !army.moved &&
    !busy &&
    state.currentFaction === state.humanFaction &&
    state.phase === 'orders' &&
    army.faction === state.humanFaction;
  const targets =
    moveTargets.length > 0
      ? `<div class="row move-list">${escapeHtml(t('strategic.army.moveHint'))}: ${escapeHtml(
          moveTargets.map((id) => strategicRegionName(id)).join(', '),
        )}</div>`
      : `<p class="row">${escapeHtml(t('strategic.army.moveHint'))}</p>`;
  const isMine = army.faction === state.humanFaction;
  return `
    <div class="strategic-panel" id="strategic-panel" role="region" aria-label="${escapeHtml(t('strategic.army.name'))}">
      <div class="panel-head">
        <h3>${escapeHtml(t('strategic.army.name'))} · ${escapeHtml(army.id)}</h3>
        <button type="button" class="panel-close" id="st-panel-close" aria-label="${escapeHtml(t('strategic.panel.close'))}">×</button>
      </div>
      <div class="row">${escapeHtml(t('strategic.army.faction', { faction: factionName(army.faction) }))}</div>
      <div class="row">${escapeHtml(t('strategic.army.region', { region: regionName }))}</div>
      <div class="row">${escapeHtml(army.moved ? t('strategic.army.moved') : t('strategic.army.ready'))}</div>
      <div class="row">${escapeHtml(t('strategic.army.units', { n: army.units.length }))}</div>
      ${units}
      ${isMine ? targets : ''}
      ${
        isMine
          ? `<div class="btn-row">
        <button type="button" id="st-hold" ${canAct ? '' : 'disabled'}>${escapeHtml(t('strategic.army.hold'))}</button>
        <button type="button" id="st-replenish" ${canAct ? '' : 'disabled'}>${escapeHtml(t('strategic.army.replenish'))}</button>
      </div>`
          : ''
      }
    </div>`;
}

export function renderSelectionPanel(opts: {
  state: StrategicGameState;
  selectedArmyId: string | null;
  selectedRegionId: string | null;
  moveTargets: string[];
  busy: boolean;
}): string {
  const { state, selectedArmyId, selectedRegionId, moveTargets, busy } = opts;
  if (selectedArmyId) {
    const army = state.armies.find((a) => a.id === selectedArmyId);
    if (army) return armyPanelHtml(state, army, busy, moveTargets);
  }
  if (selectedRegionId) {
    const region = state.regions.find((r) => r.id === selectedRegionId);
    if (region) {
      const armies = state.armies.filter((a) => a.regionId === region.id);
      return regionPanelHtml(region, armies);
    }
  }
  return emptyPanelHtml();
}

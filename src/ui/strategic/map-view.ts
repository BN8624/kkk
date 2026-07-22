// 한 줄 목적: 12지역 전략 지도 DOM·연결선·이동 강조를 렌더링한다
import { FACTION_IDS } from '../../core/data';
import type { FactionId } from '../../core/types';
import { STRATEGIC_REGION_IDS } from '../../strategic/map';
import type { StrategicArmy, StrategicGameState, StrategicRegion } from '../../strategic/types';
import { factionName, t, type MessageKey } from '../../i18n';
import { escapeHtml } from '../shared/dom';

const REGION_NAME_KEYS: Record<string, MessageKey> = {
  r00: 'strategic.region.r00',
  r01: 'strategic.region.r01',
  r02: 'strategic.region.r02',
  r03: 'strategic.region.r03',
  r04: 'strategic.region.r04',
  r05: 'strategic.region.r05',
  r06: 'strategic.region.r06',
  r07: 'strategic.region.r07',
  r08: 'strategic.region.r08',
  r09: 'strategic.region.r09',
  r10: 'strategic.region.r10',
  r11: 'strategic.region.r11',
};

export function strategicRegionName(id: string): string {
  const key = REGION_NAME_KEYS[id];
  return key ? t(key) : id;
}

function factionMark(owner: FactionId | null): string {
  if (!owner) {
    return `<span class="strategic-faction-mark neutral" aria-hidden="true">N</span>`;
  }
  const letter = owner === 'azure' ? 'A' : owner === 'crimson' ? 'C' : 'V';
  return `<span class="strategic-faction-mark ${owner}" aria-hidden="true">${letter}</span>`;
}

function settlementLabel(region: StrategicRegion): string {
  if (!region.settlement) return '';
  if (region.settlement === 'capital') return t('strategic.region.settlement.capital');
  if (region.settlement === 'town') return t('strategic.region.settlement.town');
  return t('strategic.region.settlement.fort');
}

function terrainLabel(terrain: StrategicRegion['terrain']): string {
  return t(`terrain.${terrain}` as MessageKey);
}

function gridIndex(id: string): { col: number; row: number } {
  const idx = STRATEGIC_REGION_IDS.indexOf(id as (typeof STRATEGIC_REGION_IDS)[number]);
  return { col: idx % 4, row: Math.floor(idx / 4) };
}

export interface MapViewHandlers {
  onRegion: (regionId: string) => void;
  onArmy: (armyId: string) => void;
}

export function renderStrategicMapHtml(
  state: StrategicGameState,
  opts: {
    selectedArmyId: string | null;
    moveTargets: string[];
  },
): string {
  const byRegion = new Map<string, StrategicArmy[]>();
  for (const a of state.armies) {
    const list = byRegion.get(a.regionId) ?? [];
    list.push(a);
    byRegion.set(a.regionId, list);
  }

  // 연결선: 이동 가능 이웃만 (id 사전순 중복 제거)
  const edges: [string, string][] = [];
  const seen = new Set<string>();
  for (const r of state.regions) {
    for (const n of r.neighbors) {
      const key = r.id < n ? `${r.id}|${n}` : `${n}|${r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(r.id < n ? [r.id, n] : [n, r.id]);
    }
  }

  const lines = edges
    .map(([a, b]) => {
      const pa = gridIndex(a);
      const pb = gridIndex(b);
      // 격자 중심 % 좌표
      const x1 = ((pa.col + 0.5) / 4) * 100;
      const y1 = ((pa.row + 0.5) / 3) * 100;
      const x2 = ((pb.col + 0.5) / 4) * 100;
      const y2 = ((pb.row + 0.5) / 3) * 100;
      return `<line x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%" stroke="rgba(201,162,39,.45)" stroke-width="2" />`;
    })
    .join('');

  const cells = STRATEGIC_REGION_IDS.map((id) => {
    const region = state.regions.find((r) => r.id === id)!;
    const armies = byRegion.get(id) ?? [];
    const ownerClass =
      region.owner === null ? 'owner-neutral' : `owner-${region.owner}`;
    const moveClass = opts.moveTargets.includes(id) ? ' move-target' : '';
    const selectedHere =
      opts.selectedArmyId && armies.some((a) => a.id === opts.selectedArmyId)
        ? ' selected-army'
        : '';
    const ownerText =
      region.owner === null
        ? t('strategic.region.neutral')
        : t('strategic.region.owner', { owner: factionName(region.owner) });
    const settle = settlementLabel(region);
    const garrison = armies
      .map((a) => {
        const mark = factionMark(a.faction);
        const n = a.units.length;
        return `${mark}${escapeHtml(a.faction[0]!.toUpperCase())}×${n}`;
      })
      .join(' ');
    const aria = `${strategicRegionName(id)}. ${ownerText}. ${t('strategic.region.garrison', { n: armies.length })}`;
    return `
      <button type="button" class="strategic-region ${ownerClass}${moveClass}${selectedHere}"
        data-region="${escapeHtml(id)}" aria-label="${escapeHtml(aria)}">
        <div class="name">${factionMark(region.owner)} ${escapeHtml(strategicRegionName(id))}</div>
        <div class="meta">${escapeHtml(ownerText)}</div>
        <div class="meta">${escapeHtml(t('strategic.region.terrain', { terrain: terrainLabel(region.terrain) }))}${settle ? ` · ${escapeHtml(settle)}` : ''}</div>
        <div class="meta">${escapeHtml(t('strategic.region.income', { n: region.income }))} · ${escapeHtml(t('strategic.region.defense', { n: region.defense }))}</div>
        <div class="meta">${garrison || '—'}</div>
      </button>`;
  }).join('');

  return `
    <div class="strategic-map-wrap">
      <div class="strategic-map" id="strategic-map">
        <svg class="strategic-links" aria-hidden="true">${lines}</svg>
        ${cells}
      </div>
    </div>`;
}

export function bindStrategicMap(root: HTMLElement, handlers: MapViewHandlers): void {
  root.querySelectorAll<HTMLElement>('[data-region]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-region');
      if (id) handlers.onRegion(id);
    });
  });
  void FACTION_IDS;
  void handlers.onArmy;
}

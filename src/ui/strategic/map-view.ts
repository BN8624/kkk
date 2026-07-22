// 한 줄 목적: 자연 섬 전략 지도 DOM·군단 깃발·전선·이동 강조를 렌더링한다
import { UNIT_STATS } from '../../core/data';
import type { FactionId } from '../../core/types';
import { STRATEGIC_REGION_IDS } from '../../strategic/map';
import type { StrategicArmy, StrategicGameState, StrategicRegion } from '../../strategic/types';
import { factionName, t, type MessageKey } from '../../i18n';
import { escapeHtml } from '../shared/dom';
import {
  ISLAND_OUTLINE_PATH,
  ISLAND_SHOAL_PATH,
  RIVER_PATH,
  ROAD_PATHS,
  STRATEGIC_MAP_VIEWBOX,
  STRATEGIC_REGION_GEOMETRY,
  getRegionGeometry,
  listSharedEdges,
} from './map-geometry';
import {
  armyBannerTokenSvg,
  factionEmblemSvg,
  ownerStroke,
  ownerTintFill,
  settlementIconSvg,
  strategicMapPatternDefs,
  terrainBaseFill,
  terrainDecorSvg,
  terrainOverlayUrl,
} from './map-icons';

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

function armyTotalHp(army: StrategicArmy): { hp: number; max: number } {
  let hp = 0;
  let max = 0;
  for (const u of army.units) {
    hp += u.hp;
    max += UNIT_STATS[u.type].hp;
  }
  return { hp, max };
}

function armyTokenSvg(
  army: StrategicArmy,
  x: number,
  y: number,
  opts: { selected: boolean; isEnemy: boolean },
): string {
  const { hp, max } = armyTotalHp(army);
  const damaged = hp < max;
  const n = army.units.length;
  const movedClass = army.moved ? ' acted' : '';
  const selClass = opts.selected ? ' selected' : '';
  const enemyClass = opts.isEnemy ? ' enemy' : '';
  const aria = `${t('strategic.army.name')} · ${factionName(army.faction)} · ${t('strategic.army.units', { n })}${
    damaged ? ` · HP ${hp}/${max}` : ''
  }${army.moved ? ` · ${t('strategic.army.moved')}` : ''}`;
  const body = armyBannerTokenSvg({
    faction: army.faction,
    unitCount: n,
    selected: opts.selected,
    acted: army.moved,
    damaged,
    hpRatio: max > 0 ? hp / max : 1,
    enemy: opts.isEnemy,
  });
  return `
    <g class="strategic-army${movedClass}${selClass}${enemyClass}" data-army="${escapeHtml(army.id)}"
       data-region="${escapeHtml(army.regionId)}" data-x="${x}" data-y="${y}"
       transform="translate(${x},${y})" role="button" tabindex="0"
       aria-label="${escapeHtml(aria)}" filter="url(#st-banner-shadow)">
      ${body}
    </g>`;
}

function regionAria(region: StrategicRegion, armyCount: number): string {
  const owner =
    region.owner === null
      ? t('strategic.region.neutral')
      : t('strategic.region.owner', { owner: factionName(region.owner) });
  const settle = region.settlement
    ? region.settlement === 'capital'
      ? t('strategic.region.settlement.capital')
      : region.settlement === 'town'
        ? t('strategic.region.settlement.town')
        : t('strategic.region.settlement.fort')
    : '';
  const terrain = t(`terrain.${region.terrain}` as MessageKey);
  return `${strategicRegionName(region.id)}. ${owner}. ${terrain}${settle ? `. ${settle}` : ''}. ${t('strategic.region.garrison', { n: armyCount })}`;
}

export interface MapViewHandlers {
  onRegion: (regionId: string) => void;
  onArmy: (armyId: string) => void;
  onOcean?: () => void;
}

export interface MapViewRenderOpts {
  selectedArmyId: string | null;
  selectedRegionId: string | null;
  moveTargets: string[];
  /** 이동 미리보기 경로 (from→to) */
  pathPreview?: { from: string; to: string } | null;
}

/** 동맹 내륙 경계 vs 적대 전선 구분. */
function frontLineSvg(state: StrategicGameState): string {
  const byId = new Map(state.regions.map((r) => [r.id, r]));
  const parts: string[] = [];
  for (const edge of listSharedEdges()) {
    const ra = byId.get(edge.a);
    const rb = byId.get(edge.b);
    if (!ra || !rb) continue;
    const oa = ra.owner;
    const ob = rb.owner;
    // 같은 세력: 얇은 내륙 경계
    if (oa && oa === ob) {
      parts.push(
        `<line class="st-border-ally" x1="${edge.aCenter.x}" y1="${edge.aCenter.y}" x2="${edge.bCenter.x}" y2="${edge.bCenter.y}"
          stroke="${ownerStroke(oa)}" stroke-width="0.9" stroke-opacity="0.35" pointer-events="none"/>`,
      );
      continue;
    }
    // 서로 다른 소유(또는 한쪽 중립이 아닌 적대 접촉): 전선
    const hostile =
      (oa && ob && oa !== ob) ||
      (oa && !ob) ||
      (!oa && ob);
    if (!hostile) continue;
    if (!oa || !ob) {
      // 중립 접경 — 약한 점선
      parts.push(
        `<line class="st-border-neutral" x1="${edge.mid.x - 6}" y1="${edge.mid.y - 4}" x2="${edge.mid.x + 6}" y2="${edge.mid.y + 4}"
          stroke="#cfc8b8" stroke-width="1.2" stroke-dasharray="3 2" stroke-opacity="0.5" pointer-events="none"/>`,
      );
      continue;
    }
    // 적대 전선: 중점에 이중 색 짧은 호
    const dx = edge.bCenter.x - edge.aCenter.x;
    const dy = edge.bCenter.y - edge.aCenter.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 7;
    const ny = (dx / len) * 7;
    const mx = edge.mid.x;
    const my = edge.mid.y;
    parts.push(
      `<g class="st-front-line" data-front="${escapeHtml(edge.a)}-${escapeHtml(edge.b)}" pointer-events="none">
        <line x1="${mx - nx}" y1="${my - ny}" x2="${mx + nx}" y2="${my + ny}"
          stroke="${ownerStroke(oa)}" stroke-width="2.4" stroke-opacity="0.85" stroke-linecap="round"/>
        <line x1="${mx - nx * 0.55}" y1="${my - ny * 0.55}" x2="${mx + nx * 0.55}" y2="${my + ny * 0.55}"
          stroke="${ownerStroke(ob)}" stroke-width="2.4" stroke-opacity="0.75" stroke-linecap="round"
          transform="translate(${nx * 0.35},${ny * 0.35})"/>
      </g>`,
    );
  }
  return parts.join('');
}

/** 수도 위협(적 군단 인접) 경고 링. */
function capitalThreatSvg(state: StrategicGameState): string {
  const parts: string[] = [];
  for (const region of state.regions) {
    if (region.settlement !== 'capital' || !region.owner) continue;
    const geo = getRegionGeometry(region.id);
    if (!geo) continue;
    const enemyNear = state.armies.some(
      (a) =>
        a.faction !== region.owner &&
        (a.regionId === region.id || region.neighbors.includes(a.regionId)),
    );
    if (!enemyNear) continue;
    const p = geo.structureAnchor;
    parts.push(
      `<g class="st-capital-threat" transform="translate(${p.x},${p.y})" pointer-events="none" aria-hidden="true">
        <circle r="16" fill="none" stroke="#e05050" stroke-width="1.6" stroke-dasharray="3 2" opacity="0.85"/>
        <circle r="12" fill="none" stroke="#e05050" stroke-width="0.8" opacity="0.5"/>
      </g>`,
    );
  }
  return parts.join('');
}

export function renderStrategicMapHtml(
  state: StrategicGameState,
  opts: MapViewRenderOpts,
): string {
  const byRegion = new Map<string, StrategicArmy[]>();
  for (const a of state.armies) {
    const list = byRegion.get(a.regionId) ?? [];
    list.push(a);
    byRegion.set(a.regionId, list);
  }

  const regionPaths = STRATEGIC_REGION_GEOMETRY.map((geo) => {
    const region = state.regions.find((r) => r.id === geo.regionId)!;
    const armies = byRegion.get(geo.regionId) ?? [];
    const ownerClass =
      region.owner === null ? 'owner-neutral' : `owner-${region.owner}`;
    const moveClass = opts.moveTargets.includes(geo.regionId) ? ' move-target' : '';
    const selectedClass =
      opts.selectedRegionId === geo.regionId ||
      (opts.selectedArmyId && armies.some((a) => a.id === opts.selectedArmyId))
        ? ' selected'
        : '';
    const blockedClass =
      opts.moveTargets.length > 0 && !opts.moveTargets.includes(geo.regionId)
        ? ' move-blocked'
        : '';
    const coastClass = geo.coastal ? ' coastal' : ' inland';
    const base = terrainBaseFill(region.terrain);
    const tint = ownerTintFill(region.owner);
    const stroke = ownerStroke(region.owner);
    const aria = regionAria(region, armies.length);
    // 지형 베이스 → 소유 틴트 → 지형 텍스처 (강한 소유 패턴 없음)
    return `
      <g class="strategic-region-group${coastClass}" data-region-group="${escapeHtml(geo.regionId)}">
        <path class="strategic-region-hit" data-region="${escapeHtml(geo.regionId)}"
          d="${geo.path}" fill="transparent" stroke="transparent" stroke-width="14"
          pointer-events="stroke"/>
        <path class="strategic-region-base" d="${geo.path}" fill="${base}" pointer-events="none"/>
        <path class="strategic-region ${ownerClass}${moveClass}${selectedClass}${blockedClass}${coastClass}"
          data-region="${escapeHtml(geo.regionId)}"
          d="${geo.path}" fill="${tint}" stroke="${stroke}" stroke-width="${geo.coastal ? 1.8 : 1.1}"
          role="button" tabindex="0" aria-label="${escapeHtml(aria)}"/>
        <path class="strategic-region-terrain" d="${geo.path}"
          fill="${terrainOverlayUrl(region.terrain)}" pointer-events="none"/>
      </g>`;
  }).join('');

  const terrainDecor = STRATEGIC_REGION_GEOMETRY.map((geo) => {
    const region = state.regions.find((r) => r.id === geo.regionId)!;
    // 구조와 겹치지 않게 약간 오프셋
    const dx = region.settlement ? 12 : 0;
    const dy = region.settlement ? 10 : 0;
    return terrainDecorSvg(region.terrain, geo.labelAnchor.x + dx, geo.labelAnchor.y + dy);
  }).join('');

  const structures = STRATEGIC_REGION_GEOMETRY.map((geo) => {
    const region = state.regions.find((r) => r.id === geo.regionId)!;
    if (!region.settlement) return '';
    return settlementIconSvg(region.settlement, geo.structureAnchor.x, geo.structureAnchor.y);
  }).join('');

  // 소유 문양은 거점 없을 때만 은은하게
  const emblems = STRATEGIC_REGION_GEOMETRY.map((geo) => {
    const region = state.regions.find((r) => r.id === geo.regionId)!;
    if (!region.owner || region.settlement) return '';
    const p = geo.labelAnchor;
    return `<g class="st-owner-mark" transform="translate(${p.x - 16},${p.y - 12})" opacity="0.55">${factionEmblemSvg(region.owner as FactionId, 8)}</g>`;
  }).join('');

  const roads = ROAD_PATHS.map(
    (d) =>
      `<path class="st-road" d="${d}" fill="none" stroke="rgba(180,150,90,.45)" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="4 3" pointer-events="none"/>`,
  ).join('');

  const armySvg: string[] = [];
  for (const id of STRATEGIC_REGION_IDS) {
    const geo = getRegionGeometry(id);
    if (!geo) continue;
    const armies = byRegion.get(id) ?? [];
    armies.forEach((army, i) => {
      const anchor = geo.armyAnchors[i] ?? {
        x: geo.armyAnchors[0]!.x + i * 14,
        y: geo.armyAnchors[0]!.y + (i % 2) * 10,
      };
      armySvg.push(
        armyTokenSvg(army, anchor.x, anchor.y, {
          selected: opts.selectedArmyId === army.id,
          isEnemy: army.faction !== state.humanFaction,
        }),
      );
    });
  }

  return `
    <div class="strategic-map-wrap" id="strategic-map">
      <svg class="strategic-map-svg" viewBox="${STRATEGIC_MAP_VIEWBOX.attr}"
        role="img" aria-label="${escapeHtml(t('strategic.map.label'))}"
        preserveAspectRatio="xMidYMid meet">
        ${strategicMapPatternDefs()}
        <rect class="st-ocean" x="0" y="0" width="${STRATEGIC_MAP_VIEWBOX.width}" height="${STRATEGIC_MAP_VIEWBOX.height}"
          fill="url(#st-ocean-grad)" data-ocean="1"/>
        <path class="st-shoal" d="${ISLAND_SHOAL_PATH}" fill="rgba(60,140,150,.22)" pointer-events="none"/>
        <path class="st-island-shadow" d="${ISLAND_OUTLINE_PATH}" transform="translate(2.5,3.5)" fill="rgba(0,0,0,.32)" pointer-events="none"/>
        <path class="st-island-base" d="${ISLAND_OUTLINE_PATH}" fill="url(#st-island-base-grad)" stroke="#1a2830" stroke-width="1.5" pointer-events="none"/>
        <g class="st-regions">${regionPaths}</g>
        <path class="st-coast st-coast-outer" d="${ISLAND_OUTLINE_PATH}" fill="none"
          stroke="rgba(170,210,220,.7)" stroke-width="2.6" pointer-events="none"/>
        <path class="st-coast st-coast-foam" d="${ISLAND_OUTLINE_PATH}" fill="none"
          stroke="rgba(220,240,245,.35)" stroke-width="1.1" stroke-dasharray="2 4" pointer-events="none"/>
        <g class="st-roads" pointer-events="none">${roads}</g>
        <path class="st-river" d="${RIVER_PATH}" fill="none" stroke="#4a8aaa" stroke-width="2.2"
          stroke-linecap="round" opacity="0.75" pointer-events="none"/>
        <path class="st-river-highlight" d="${RIVER_PATH}" fill="none" stroke="rgba(160,210,230,.45)" stroke-width="0.9"
          stroke-linecap="round" pointer-events="none"/>
        <g class="st-fronts">${frontLineSvg(state)}</g>
        <g class="st-terrain-decor" pointer-events="none">${terrainDecor}</g>
        <g class="st-structures" pointer-events="none">${structures}</g>
        <g class="st-emblems" pointer-events="none">${emblems}</g>
        <g class="st-threats">${capitalThreatSvg(state)}</g>
        <g id="st-path-layer"></g>
        <g class="st-armies">${armySvg.join('')}</g>
      </svg>
    </div>`;
}

function activateFromKeyboard(el: Element, handler: () => void): void {
  el.addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  });
}

export function bindStrategicMap(root: HTMLElement, handlers: MapViewHandlers): void {
  const svg = root.querySelector<SVGSVGElement>('.strategic-map-svg');
  if (!svg) return;

  root.querySelectorAll<SVGElement>('[data-region]').forEach((el) => {
    const id = el.getAttribute('data-region');
    if (!id) return;
    const go = (ev: Event) => {
      ev.stopPropagation();
      handlers.onRegion(id);
    };
    el.addEventListener('click', go);
    if (el.classList.contains('strategic-region')) {
      activateFromKeyboard(el, () => handlers.onRegion(id));
    }
  });

  root.querySelectorAll<SVGGElement>('.strategic-army').forEach((el) => {
    const id = el.getAttribute('data-army');
    if (!id) return;
    const go = (ev: Event) => {
      ev.stopPropagation();
      handlers.onArmy(id);
    };
    el.addEventListener('click', go);
    activateFromKeyboard(el, () => handlers.onArmy(id));
  });

  svg.querySelector('.st-ocean')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    handlers.onOcean?.();
  });
}

/** 현재 렌더된 SVG 루트. */
export function getStrategicMapSvg(host: HTMLElement): SVGSVGElement | null {
  return host.querySelector<SVGSVGElement>('.strategic-map-svg');
}

/** 군단 토큰 요소. */
export function getArmyTokenEl(host: HTMLElement, armyId: string): SVGGElement | null {
  return host.querySelector<SVGGElement>(`.strategic-army[data-army="${CSS.escape(armyId)}"]`);
}

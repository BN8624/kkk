// 한 줄 목적: SVG 섬 영토 전략 지도 DOM·군단 토큰·이동 강조를 렌더링한다
import { UNIT_STATS } from '../../core/data';
import { STRATEGIC_REGION_IDS } from '../../strategic/map';
import type { StrategicArmy, StrategicGameState, StrategicRegion } from '../../strategic/types';
import { factionName, t, type MessageKey } from '../../i18n';
import { escapeHtml } from '../shared/dom';
import {
  ISLAND_OUTLINE_PATH,
  STRATEGIC_MAP_VIEWBOX,
  STRATEGIC_REGION_GEOMETRY,
  getRegionGeometry,
} from './map-geometry';
import {
  factionEmblemSvg,
  factionLetter,
  ownerFillUrl,
  ownerStroke,
  settlementIconSvg,
  strategicMapPatternDefs,
  terrainIconSvg,
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
  const letter = factionLetter(army.faction);
  const movedClass = army.moved ? ' acted' : '';
  const selClass = opts.selected ? ' selected' : '';
  const enemyClass = opts.isEnemy ? ' enemy' : '';
  const aria = `${t('strategic.army.name')} ${letter} · ${factionName(army.faction)} · ${t('strategic.army.units', { n })}${
    damaged ? ` · HP ${hp}/${max}` : ''
  }${army.moved ? ` · ${t('strategic.army.moved')}` : ''}`;
  const hpBar =
    damaged && max > 0
      ? `<rect class="st-hp-bg" x="-12" y="12" width="24" height="3.5" rx="1" />
         <rect class="st-hp-fg" x="-12" y="12" width="${(24 * hp) / max}" height="3.5" rx="1" />`
      : '';
  const actedMark = army.moved
    ? `<path class="st-acted-mark" d="M8,-10 L10,-8 L14,-13" fill="none" stroke="#f4cf55" stroke-width="1.6"/>`
    : '';
  return `
    <g class="strategic-army${movedClass}${selClass}${enemyClass}" data-army="${escapeHtml(army.id)}"
       data-region="${escapeHtml(army.regionId)}" data-x="${x}" data-y="${y}"
       transform="translate(${x},${y})" role="button" tabindex="0"
       aria-label="${escapeHtml(aria)}">
      <circle class="st-army-hit" r="16" fill="transparent"/>
      <circle class="st-army-disc" r="11" fill="rgba(20,18,14,.88)" stroke="${ownerStroke(army.faction)}" stroke-width="2"/>
      <g transform="translate(0,-1)">${factionEmblemSvg(army.faction, 12)}</g>
      <text class="st-army-count" y="4" text-anchor="middle" dominant-baseline="central">${n}</text>
      ${hpBar}
      ${actedMark}
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
    const fill = ownerFillUrl(region.owner);
    const stroke = ownerStroke(region.owner);
    const aria = regionAria(region, armies.length);
    // 히트 확장을 위한 두꺼운 투명 스트로크 패스 + 본 패스
    return `
      <g class="strategic-region-group" data-region-group="${escapeHtml(geo.regionId)}">
        <path class="strategic-region-hit" data-region="${escapeHtml(geo.regionId)}"
          d="${geo.path}" fill="transparent" stroke="transparent" stroke-width="14"
          pointer-events="stroke"/>
        <path class="strategic-region ${ownerClass}${moveClass}${selectedClass}${blockedClass}"
          data-region="${escapeHtml(geo.regionId)}"
          d="${geo.path}" fill="${fill}" stroke="${stroke}" stroke-width="1.6"
          role="button" tabindex="0" aria-label="${escapeHtml(aria)}"/>
        <path class="strategic-region-terrain" d="${geo.path}"
          fill="${terrainOverlayUrl(region.terrain)}" pointer-events="none"/>
      </g>`;
  }).join('');

  const structures = STRATEGIC_REGION_GEOMETRY.map((geo) => {
    const region = state.regions.find((r) => r.id === geo.regionId)!;
    const sa = geo.structureAnchor;
    const settle = region.settlement
      ? settlementIconSvg(region.settlement, sa.x, sa.y)
      : '';
    const terr = terrainIconSvg(region.terrain, sa.x + 14, sa.y + 10);
    return settle + terr;
  }).join('');

  // 세력 문양(라벨 앵커 근처, 소유 표시 보조)
  const emblems = STRATEGIC_REGION_GEOMETRY.map((geo) => {
    const region = state.regions.find((r) => r.id === geo.regionId)!;
    if (!region.owner) return '';
    const p = geo.labelAnchor;
    return `<g transform="translate(${p.x - 14},${p.y - 10})" opacity="0.9">${factionEmblemSvg(region.owner, 9)}</g>`;
  }).join('');

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
        <rect class="st-ocean" x="0" y="0" width="${STRATEGIC_MAP_VIEWBOX.width}" height="${STRATEGIC_MAP_VIEWBOX.height}" data-ocean="1"/>
        <path class="st-island-shadow" d="${ISLAND_OUTLINE_PATH}" transform="translate(3,4)" fill="rgba(0,0,0,.28)"/>
        <path class="st-island-base" d="${ISLAND_OUTLINE_PATH}" fill="#3a4a3a" stroke="#1a2830" stroke-width="2"/>
        <g class="st-regions">${regionPaths}</g>
        <path class="st-coast" d="${ISLAND_OUTLINE_PATH}" fill="none" stroke="rgba(160,200,220,.55)" stroke-width="2.2" pointer-events="none"/>
        <g class="st-structures" pointer-events="none">${structures}</g>
        <g class="st-emblems" pointer-events="none">${emblems}</g>
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

  // 영토: hit path + 본 path 모두
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

  // 바다 클릭 → 선택 해제
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

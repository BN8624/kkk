// 한 줄 목적: 전략 섬 geometry 정본·인접 일치·자연 해안·군단 토큰 계약을 단위 검증한다
import { describe, expect, it } from 'vitest';
import { createStrategicState } from '../src/strategic/state';
import {
  ISLAND_OUTLINE_PATH,
  RIVER_PATH,
  ROAD_PATHS,
  STRATEGIC_MAP_VIEWBOX,
  STRATEGIC_REGION_GEOMETRY,
  STRATEGIC_SHARED_EDGES,
  anchorsInsideRegionBounds,
  assertGeometryCoverage,
  buildMovePathPoints,
  geometryAdjacencyMatchesCanon,
  getRegionGeometry,
  getSharedEdge,
  isPointInViewBox,
  isValidSvgPath,
  listSharedEdges,
  pointsToSvg,
  sharedEdgesMatchCanonCount,
} from '../src/ui/strategic/map-geometry';
import { prefersReducedMotion, pointAlongPath } from '../src/ui/strategic/map-animation';
import {
  armyBannerTokenSvg,
  ownerFillUrl,
  ownerStroke,
  ownerTintFill,
  settlementIconSvg,
  terrainDecorSvg,
} from '../src/ui/strategic/map-icons';
import {
  renderStrategicMapHtml,
  strategicRegionName,
} from '../src/ui/strategic/map-view';
import { renderSelectionPanel } from '../src/ui/strategic/map-panel';
import { buildStrategicScreenHtml, renderCompactHud } from '../src/ui/strategic';
import { setLocale } from '../src/i18n';

describe('strategic map geometry', () => {
  it('12개 geometry가 모두 존재하고 region ID 중복이 없다', () => {
    const cov = assertGeometryCoverage();
    expect(cov.ok).toBe(true);
    expect(cov.missing).toEqual([]);
    expect(cov.duplicate).toEqual([]);
    expect(STRATEGIC_REGION_GEOMETRY).toHaveLength(12);
  });

  it('모든 path가 유효하고 앵커가 viewBox 안이다', () => {
    for (const g of STRATEGIC_REGION_GEOMETRY) {
      expect(isValidSvgPath(g.path)).toBe(true);
      expect(isPointInViewBox(g.labelAnchor)).toBe(true);
      expect(isPointInViewBox(g.structureAnchor)).toBe(true);
      expect(g.armyAnchors.length).toBeGreaterThan(0);
      for (const a of g.armyAnchors) {
        expect(isPointInViewBox(a)).toBe(true);
      }
      expect(typeof g.coastal).toBe('boolean');
    }
  });

  it('인접 그래프와 geometry edgeMidpoints가 일치한다', () => {
    const adj = geometryAdjacencyMatchesCanon();
    expect(adj.missing).toEqual([]);
    expect(adj.extra).toEqual([]);
    expect(adj.ok).toBe(true);
  });

  it('이동 경로가 출발·도착을 잇고 viewBox 안 점을 쓴다', () => {
    const pts = buildMovePathPoints('r00', 'r01');
    expect(pts.length).toBeGreaterThanOrEqual(2);
    for (const p of pts) expect(isPointInViewBox(p, 2)).toBe(true);
    const svg = pointsToSvg(pts);
    expect(svg).toContain(',');
    const mid = pointAlongPath(pts, 0.5);
    expect(isPointInViewBox(mid, 2)).toBe(true);
  });

  it('viewBox 상수가 양의 크기이고 모바일 세로 비율에 가깝다', () => {
    expect(STRATEGIC_MAP_VIEWBOX.width).toBe(280);
    expect(STRATEGIC_MAP_VIEWBOX.height).toBe(530);
    expect(STRATEGIC_MAP_VIEWBOX.attr).toBe('0 0 280 530');
    const aspect = STRATEGIC_MAP_VIEWBOX.width / STRATEGIC_MAP_VIEWBOX.height;
    expect(aspect).toBeGreaterThan(0.45);
    expect(aspect).toBeLessThan(0.6);
  });

  it('모든 앵커가 해당 영토 bounds 안이고 공유 경계가 정본과 일치한다', () => {
    for (const g of STRATEGIC_REGION_GEOMETRY) {
      expect(anchorsInsideRegionBounds(g)).toBe(true);
    }
    expect(sharedEdgesMatchCanonCount()).toBe(true);
    expect(STRATEGIC_SHARED_EDGES.length).toBeGreaterThanOrEqual(12);
    for (const e of STRATEGIC_SHARED_EDGES) {
      expect(e.path.length).toBeGreaterThan(8);
      expect(getSharedEdge(e.a, e.b)?.path).toBe(e.path);
    }
  });

  it('섬 외곽·강·도로 레이어 path가 유효하다', () => {
    expect(isValidSvgPath(ISLAND_OUTLINE_PATH)).toBe(true);
    // 강·도로는 열린 path(Z 없음) — M/C 토큰만 확인
    expect(RIVER_PATH).toMatch(/^[MLCZmlcz0-9.,\s-]+$/);
    expect(RIVER_PATH).toMatch(/[Mm]/);
    expect(ROAD_PATHS.length).toBeGreaterThanOrEqual(2);
    for (const d of ROAD_PATHS) {
      expect(d).toMatch(/^[MLCZmlcz0-9.,\s-]+$/);
      expect(d).toMatch(/[Mm]/);
    }
  });

  it('listSharedEdges가 정본 인접 수와 일치한다', () => {
    const edges = listSharedEdges();
    const adj = geometryAdjacencyMatchesCanon();
    expect(adj.ok).toBe(true);
    // undirected edge count from edgeMidpoints
    expect(edges.length).toBeGreaterThanOrEqual(12);
  });

  it('해안·내륙 영토가 모두 존재한다', () => {
    const coastal = STRATEGIC_REGION_GEOMETRY.filter((g) => g.coastal);
    const inland = STRATEGIC_REGION_GEOMETRY.filter((g) => !g.coastal);
    expect(coastal.length).toBeGreaterThanOrEqual(6);
    expect(inland.length).toBeGreaterThanOrEqual(2);
  });
});

describe('strategic map render contracts', () => {
  it('카드형 지역 버튼 DOM을 만들지 않고 SVG path 12개를 쓴다', () => {
    setLocale('ko');
    const state = createStrategicState(42, 'azure');
    const html = renderStrategicMapHtml(state, {
      selectedArmyId: null,
      selectedRegionId: null,
      moveTargets: [],
    });
    expect(html).toContain('strategic-map-svg');
    expect(html).toContain('viewBox="0 0 280 530"');
    expect(html).toContain('st-ocean');
    expect(html).not.toMatch(/grid-template-columns:\s*repeat\(4/);
    expect(html).not.toContain('strategic-links');
    const regionMatches = html.match(/class="strategic-region(?:\s|")/g) ?? [];
    expect(regionMatches.length).toBe(12);
    const armyMatches = html.match(/class="strategic-army/g) ?? [];
    expect(armyMatches.length).toBe(6);
    expect(html).not.toMatch(/class="meta"/);
  });

  it('소유 세력별 soft tint와 중립 클래스를 적용하고 강한 소유 패턴을 쓰지 않는다', () => {
    const state = createStrategicState(7, 'azure');
    const html = renderStrategicMapHtml(state, {
      selectedArmyId: null,
      selectedRegionId: null,
      moveTargets: [],
    });
    expect(html).toContain('owner-azure');
    expect(html).toContain('owner-crimson');
    expect(html).toContain('owner-violet');
    expect(html).toContain('owner-neutral');
    // 강한 사선/격자 소유 패턴 id 부재
    expect(html).not.toContain('st-pat-azure');
    expect(html).not.toContain('st-pat-crimson');
    expect(html).not.toContain('st-pat-violet');
    expect(ownerTintFill('azure')).toMatch(/rgba|rgb|#/);
    expect(ownerFillUrl(null)).toMatch(/rgba|rgb|#|url/);
    expect(ownerStroke('crimson')).toMatch(/#/);
  });

  it('지형 베이스·장식·강·도로·해안 레이어가 존재한다', () => {
    const state = createStrategicState(11, 'azure');
    const html = renderStrategicMapHtml(state, {
      selectedArmyId: null,
      selectedRegionId: null,
      moveTargets: [],
    });
    expect(html).toContain('strategic-region-base');
    expect(html).toContain('st-terrain-decor');
    expect(html).toContain('st-river');
    expect(html).toContain('st-road');
    expect(html).toContain('st-coast');
    expect(html).toContain('st-island-base');
    expect(html).toContain('st-plains');
    expect(html).toContain('st-forest');
    expect(html).toContain('st-mountain');
  });

  it('수도 3·도시·요새 랜드마크와 전선 레이어가 있다', () => {
    const state = createStrategicState(3, 'azure');
    const html = renderStrategicMapHtml(state, {
      selectedArmyId: null,
      selectedRegionId: null,
      moveTargets: [],
    });
    expect(html).toContain('st-capital');
    expect(html).toContain('st-town');
    expect(html).toContain('st-fort');
    expect((html.match(/st-capital/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('st-fronts');
    // 초기 배치에서 적대 접경 존재
    expect(html).toContain('st-front-line');
  });

  it('군단 토큰이 깃발·문양·병력·HP를 갖고 A/C/V 문자 마커가 아니다', () => {
    const state = createStrategicState(99, 'azure');
    const army = state.armies.find((a) => a.faction === 'azure')!;
    army.moved = true;
    army.units[0]!.hp = 1;
    const region = state.regions.find((r) => r.id === army.regionId)!;
    const targets = region.neighbors.slice(0, 2);
    const html = renderStrategicMapHtml(state, {
      selectedArmyId: army.id,
      selectedRegionId: army.regionId,
      moveTargets: targets,
    });
    expect(html).toContain(`data-army="${army.id}"`);
    expect(html).toContain('selected');
    expect(html).toContain('acted');
    expect(html).toContain('st-army-banner');
    expect(html).toContain('st-army-count');
    expect(html).toContain('st-hp-fg');
    expect(html).toContain('st-acted-mark');
    // 구형 원형 문자 마커 중심 텍스트 A/C/V 단독 패턴 지양 — factionLetter 미사용
    expect(html).not.toMatch(/class="st-army-letter"/);
    for (const tid of targets) {
      expect(html).toContain(`data-region="${tid}"`);
      expect(html).toMatch(
        new RegExp(`move-target[^"]*"[^>]*data-region="${tid}"|data-region="${tid}"[^>]*move-target`),
      );
    }
    const banner = armyBannerTokenSvg({
      faction: 'azure',
      unitCount: 4,
      selected: false,
      acted: false,
      damaged: true,
      hpRatio: 0.5,
      enemy: false,
    });
    expect(banner).toContain('st-army-banner');
    expect(banner).toContain('st-army-count');
    expect(banner).toContain('>4<');
    expect(banner).toContain('st-army-hit');
    // 터치 영역: r≥24 (모바일에서 ≥48 CSS px)
    expect(banner).toMatch(/st-army-hit"[^>]*r="(?:2[4-9]|[3-9]\d)/);
  });

  it('거점·지형 decor SVG가 비어 있지 않다', () => {
    expect(settlementIconSvg('capital', 0, 0)).toContain('st-capital');
    expect(settlementIconSvg('town', 0, 0)).toContain('st-town');
    expect(settlementIconSvg('fort', 0, 0)).toContain('st-fort');
    expect(terrainDecorSvg('forest', 0, 0)).toContain('st-forest');
    expect(terrainDecorSvg('mountain', 0, 0)).toContain('st-mountain');
    expect(terrainDecorSvg('plains', 0, 0)).toContain('st-plains');
  });

  it('지역 상세는 선택 패널에만 있고 비선택 시 힌트만 보인다', () => {
    setLocale('ko');
    const state = createStrategicState(3, 'azure');
    const empty = renderSelectionPanel({
      state,
      selectedArmyId: null,
      selectedRegionId: null,
      moveTargets: [],
      busy: false,
    });
    expect(empty).toContain('strategic-panel--hint');
    expect(empty).toContain('군단이나 영토');

    const region = state.regions[0]!;
    const reg = renderSelectionPanel({
      state,
      selectedArmyId: null,
      selectedRegionId: region.id,
      moveTargets: [],
      busy: false,
    });
    expect(reg).toContain(strategicRegionName(region.id));
    expect(reg).toContain('st-panel-close');
    expect(reg).toMatch(/수입|Income|income/i);
    expect(reg).toContain('panel-stat');

    const army = state.armies.find((a) => a.faction === 'azure')!;
    const ap = renderSelectionPanel({
      state,
      selectedArmyId: army.id,
      selectedRegionId: army.regionId,
      moveTargets: ['r01'],
      busy: false,
    });
    expect(ap).toContain('st-hold');
    expect(ap).toContain('st-replenish');
    expect(ap).toContain('HP');
  });

  it('compact HUD는 칩 박스 다수 없이 문양·턴·국고를 한 줄로 쓴다', () => {
    setLocale('ko');
    const state = createStrategicState(5, 'azure');
    const hud = renderCompactHud(state, false);
    expect(hud).toContain('strategic-hud');
    expect(hud).toContain('hud-main');
    expect(hud).toContain('hud-crest');
    expect(hud).toContain('hud-kingdom');
    expect(hud).not.toContain('class="chip"');
    expect(hud).toContain('id="st-end"');
    expect(hud).toContain('id="st-title"');
    const full = buildStrategicScreenHtml({
      state,
      selectedArmyId: null,
      selectedRegionId: null,
      moveTargets: [],
      busy: false,
      log: [],
    });
    expect(full).toContain('strategic-body');
    expect(full).toContain('strategic-map-svg');
    expect(full).toContain('strategic-panel--hint');
    expect(full).not.toContain('strategic-marquee');
    expect(full).not.toContain('tip-cyan');
  });

  it('geometry 조회와 reduced-motion 헬퍼가 동작한다', () => {
    expect(getRegionGeometry('r00')?.regionId).toBe('r00');
    expect(getRegionGeometry('nope')).toBeUndefined();
    expect(typeof prefersReducedMotion()).toBe('boolean');
  });

  it('i18n 지역명이 하드코드 ID가 아니다', () => {
    setLocale('ko');
    expect(strategicRegionName('r00')).not.toBe('r00');
    setLocale('en');
    expect(strategicRegionName('r00')).toMatch(/Azure|Capital/i);
    setLocale('ko');
  });
});

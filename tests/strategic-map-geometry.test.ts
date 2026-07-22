// 한 줄 목적: 전략 섬 geometry 정본·인접 일치·이동 경로 계약을 단위 검증한다
import { describe, expect, it } from 'vitest';
import { createStrategicState } from '../src/strategic/state';
import {
  STRATEGIC_MAP_VIEWBOX,
  STRATEGIC_REGION_GEOMETRY,
  assertGeometryCoverage,
  buildMovePathPoints,
  geometryAdjacencyMatchesCanon,
  getRegionGeometry,
  isPointInViewBox,
  isValidSvgPath,
  pointsToSvg,
} from '../src/ui/strategic/map-geometry';
import { prefersReducedMotion, pointAlongPath } from '../src/ui/strategic/map-animation';
import { ownerFillUrl, ownerStroke } from '../src/ui/strategic/map-icons';
import {
  renderStrategicMapHtml,
  strategicRegionName,
} from '../src/ui/strategic/map-view';
import { renderSelectionPanel } from '../src/ui/strategic/map-panel';
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

  it('viewBox 상수가 양의 크기다', () => {
    expect(STRATEGIC_MAP_VIEWBOX.width).toBe(400);
    expect(STRATEGIC_MAP_VIEWBOX.height).toBe(320);
    expect(STRATEGIC_MAP_VIEWBOX.attr).toBe('0 0 400 320');
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
    expect(html).toContain('viewBox="0 0 400 320"');
    expect(html).toContain('st-ocean');
    // 카드 그리드 클래스/버튼 패턴 부재
    expect(html).not.toMatch(/grid-template-columns:\s*repeat\(4/);
    expect(html).not.toContain('strategic-links');
    // 12 territory fill paths (class starts with strategic-region space or quote)
    const regionMatches = html.match(/class="strategic-region(?:\s|")/g) ?? [];
    expect(regionMatches.length).toBe(12);
    // 6 armies
    const armyMatches = html.match(/class="strategic-army/g) ?? [];
    expect(armyMatches.length).toBe(6);
    // no card meta dump always-visible pattern (income·defense always on card)
    expect(html).not.toMatch(/class="meta"/);
  });

  it('소유 세력별 fill/stroke 클래스와 중립 클래스를 적용한다', () => {
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
    expect(ownerFillUrl('azure')).toContain('st-pat-azure');
    expect(ownerFillUrl(null)).toContain('st-pat-neutral');
    expect(ownerStroke('crimson')).toMatch(/#/);
  });

  it('군단 선택·이동 대상·행동 완료·손상 상태를 표시한다', () => {
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
    expect(html).toContain('st-hp-fg');
    for (const tid of targets) {
      expect(html).toContain(`data-region="${tid}"`);
      expect(html).toMatch(new RegExp(`move-target[^"]*"[^>]*data-region="${tid}"|data-region="${tid}"[^>]*move-target`));
    }
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

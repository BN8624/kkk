// 한 줄 목적: 12지역 고정 SVG 영토 path·앵커 정본을 제공한다
import {
  STRATEGIC_REGION_IDS,
  type StrategicRegionId,
  createStrategicRegions,
} from '../../strategic/map';

export const STRATEGIC_MAP_VIEWBOX = {
  width: 400,
  height: 320,
  /** SVG viewBox 문자열 */
  attr: '0 0 400 320',
} as const;

export interface Point2D {
  x: number;
  y: number;
}

export interface StrategicRegionGeometry {
  regionId: StrategicRegionId;
  /** SVG path `d` (절대 좌표, viewBox 기준) */
  path: string;
  labelAnchor: Point2D;
  structureAnchor: Point2D;
  armyAnchors: Point2D[];
  /** 인접 지역 경계 중심(이동 경로 보간용, regionId → point) */
  edgeMidpoints: Partial<Record<StrategicRegionId, Point2D>>;
}

/**
 * 4×3 인접 그래프와 일치하는 고정 섬 영토.
 * 행: r00–r03(북) / r04–r07 / r08–r11(남)
 * 열: 서→동. 대각 이웃은 모서리만 접하고 변은 공유하지 않는다.
 */
export const STRATEGIC_REGION_GEOMETRY: readonly StrategicRegionGeometry[] = [
  {
    regionId: 'r00',
    path: 'M 28,52 C 42,38 70,34 98,38 L 118,42 L 122,108 L 100,118 L 48,112 C 32,100 26,78 28,52 Z',
    labelAnchor: { x: 72, y: 72 },
    structureAnchor: { x: 78, y: 58 },
    armyAnchors: [
      { x: 58, y: 88 },
      { x: 88, y: 92 },
    ],
    edgeMidpoints: {
      r01: { x: 120, y: 75 },
      r04: { x: 85, y: 115 },
    },
  },
  {
    regionId: 'r01',
    path: 'M 118,42 L 148,36 C 170,32 188,38 202,48 L 206,110 L 168,118 L 122,108 Z',
    labelAnchor: { x: 162, y: 74 },
    structureAnchor: { x: 165, y: 58 },
    armyAnchors: [
      { x: 145, y: 92 },
      { x: 175, y: 96 },
    ],
    edgeMidpoints: {
      r00: { x: 120, y: 75 },
      r02: { x: 204, y: 78 },
      r05: { x: 164, y: 114 },
    },
  },
  {
    regionId: 'r02',
    path: 'M 202,48 C 220,36 248,34 278,42 L 286,50 L 288,108 L 248,116 L 206,110 Z',
    labelAnchor: { x: 246, y: 76 },
    structureAnchor: { x: 250, y: 58 },
    armyAnchors: [
      { x: 228, y: 92 },
      { x: 262, y: 94 },
    ],
    edgeMidpoints: {
      r01: { x: 204, y: 78 },
      r03: { x: 287, y: 78 },
      r06: { x: 248, y: 112 },
    },
  },
  {
    regionId: 'r03',
    path: 'M 286,50 C 308,38 338,36 372,48 C 378,70 376,96 368,112 L 328,120 L 288,108 Z',
    labelAnchor: { x: 330, y: 78 },
    structureAnchor: { x: 336, y: 60 },
    armyAnchors: [
      { x: 312, y: 94 },
      { x: 348, y: 96 },
    ],
    edgeMidpoints: {
      r02: { x: 287, y: 78 },
      r07: { x: 330, y: 114 },
    },
  },
  {
    regionId: 'r04',
    path: 'M 48,112 L 100,118 L 108,188 L 92,198 L 40,186 C 28,168 30,136 48,112 Z',
    labelAnchor: { x: 72, y: 152 },
    structureAnchor: { x: 74, y: 138 },
    armyAnchors: [
      { x: 58, y: 168 },
      { x: 88, y: 172 },
    ],
    edgeMidpoints: {
      r00: { x: 85, y: 115 },
      r05: { x: 104, y: 154 },
      r08: { x: 72, y: 192 },
    },
  },
  {
    regionId: 'r05',
    path: 'M 100,118 L 168,118 L 176,188 L 108,188 Z',
    labelAnchor: { x: 138, y: 152 },
    structureAnchor: { x: 140, y: 140 },
    armyAnchors: [
      { x: 120, y: 168 },
      { x: 152, y: 172 },
    ],
    edgeMidpoints: {
      r01: { x: 164, y: 114 },
      r04: { x: 104, y: 154 },
      r06: { x: 172, y: 154 },
      r09: { x: 142, y: 188 },
    },
  },
  {
    regionId: 'r06',
    path: 'M 168,118 L 248,116 L 256,120 L 260,186 L 248,194 L 176,188 Z',
    labelAnchor: { x: 216, y: 154 },
    structureAnchor: { x: 218, y: 140 },
    armyAnchors: [
      { x: 196, y: 170 },
      { x: 232, y: 174 },
    ],
    edgeMidpoints: {
      r02: { x: 248, y: 112 },
      r05: { x: 172, y: 154 },
      r07: { x: 258, y: 154 },
      r10: { x: 218, y: 190 },
    },
  },
  {
    regionId: 'r07',
    path: 'M 256,120 L 288,108 L 328,120 L 352,128 L 358,186 L 330,198 L 260,186 Z',
    labelAnchor: { x: 308, y: 156 },
    structureAnchor: { x: 312, y: 142 },
    armyAnchors: [
      { x: 288, y: 172 },
      { x: 330, y: 176 },
    ],
    edgeMidpoints: {
      r03: { x: 330, y: 114 },
      r06: { x: 258, y: 154 },
      r11: { x: 320, y: 192 },
    },
  },
  {
    regionId: 'r08',
    path: 'M 40,186 L 92,198 L 108,204 L 112,268 C 96,282 64,286 42,272 C 28,250 28,214 40,186 Z',
    labelAnchor: { x: 74, y: 232 },
    structureAnchor: { x: 76, y: 218 },
    armyAnchors: [
      { x: 58, y: 248 },
      { x: 92, y: 252 },
    ],
    edgeMidpoints: {
      r04: { x: 72, y: 192 },
      r09: { x: 110, y: 236 },
    },
  },
  {
    regionId: 'r09',
    path: 'M 108,204 L 176,188 L 192,196 L 198,264 L 168,276 L 112,268 Z',
    labelAnchor: { x: 152, y: 232 },
    structureAnchor: { x: 154, y: 218 },
    armyAnchors: [
      { x: 132, y: 248 },
      { x: 172, y: 252 },
    ],
    edgeMidpoints: {
      r05: { x: 142, y: 188 },
      r08: { x: 110, y: 236 },
      r10: { x: 195, y: 230 },
    },
  },
  {
    regionId: 'r10',
    path: 'M 176,188 L 248,194 L 268,202 L 274,262 L 248,278 L 198,264 L 192,196 Z',
    labelAnchor: { x: 226, y: 234 },
    structureAnchor: { x: 228, y: 218 },
    armyAnchors: [
      { x: 206, y: 250 },
      { x: 248, y: 254 },
    ],
    edgeMidpoints: {
      r06: { x: 218, y: 190 },
      r09: { x: 195, y: 230 },
      r11: { x: 271, y: 232 },
    },
  },
  {
    regionId: 'r11',
    path: 'M 260,186 L 330,198 L 358,186 C 372,210 374,246 362,268 C 340,286 300,286 274,262 L 268,202 Z',
    labelAnchor: { x: 316, y: 232 },
    structureAnchor: { x: 320, y: 218 },
    armyAnchors: [
      { x: 292, y: 250 },
      { x: 338, y: 252 },
    ],
    edgeMidpoints: {
      r07: { x: 320, y: 192 },
      r10: { x: 271, y: 232 },
    },
  },
];

const GEOMETRY_BY_ID = new Map(
  STRATEGIC_REGION_GEOMETRY.map((g) => [g.regionId, g] as const),
);

/** 지역 ID로 geometry를 조회한다. */
export function getRegionGeometry(regionId: string): StrategicRegionGeometry | undefined {
  return GEOMETRY_BY_ID.get(regionId as StrategicRegionId);
}

/** viewBox 안 여부. */
export function isPointInViewBox(p: Point2D, pad = 0): boolean {
  return (
    p.x >= -pad &&
    p.y >= -pad &&
    p.x <= STRATEGIC_MAP_VIEWBOX.width + pad &&
    p.y <= STRATEGIC_MAP_VIEWBOX.height + pad
  );
}

/** 단순 path 토큰 유효성(M/L/C/Z와 숫자). */
export function isValidSvgPath(d: string): boolean {
  if (!d || d.length < 8) return false;
  // 허용: M L C Z 와 숫자 콤마 공백
  return /^[MLCZmlcz0-9.,\s-]+$/.test(d) && /[Mm]/.test(d) && /[Zz]/.test(d);
}

/** 섬 외곽 실루엣(바다 위 섬 강조용, 장식). */
export const ISLAND_OUTLINE_PATH =
  'M 28,52 C 42,38 70,34 98,38 L 148,36 C 170,32 188,38 202,48 C 220,36 248,34 278,42 L 286,50 C 308,38 338,36 372,48 C 378,70 376,96 368,112 L 358,186 C 372,210 374,246 362,268 C 340,286 300,286 274,262 L 248,278 L 168,276 C 140,284 96,286 42,272 C 28,250 28,214 40,186 C 28,168 26,100 28,52 Z';

/**
 * geometry 인접(edgeMidpoints 키)과 정본 이웃 그래프가 일치하는지 검사.
 * 시각적으로 변을 공유한다고 선언한 쌍만 이웃이어야 한다.
 */
export function geometryAdjacencyMatchesCanon(): {
  ok: boolean;
  missing: string[];
  extra: string[];
} {
  const regions = createStrategicRegions();
  const canon = new Set<string>();
  for (const r of regions) {
    for (const n of r.neighbors) {
      const key = r.id < n ? `${r.id}|${n}` : `${n}|${r.id}`;
      canon.add(key);
    }
  }
  const visual = new Set<string>();
  for (const g of STRATEGIC_REGION_GEOMETRY) {
    for (const n of Object.keys(g.edgeMidpoints) as StrategicRegionId[]) {
      const key = g.regionId < n ? `${g.regionId}|${n}` : `${n}|${g.regionId}`;
      visual.add(key);
    }
  }
  const missing: string[] = [];
  const extra: string[] = [];
  for (const k of canon) if (!visual.has(k)) missing.push(k);
  for (const k of visual) if (!canon.has(k)) extra.push(k);
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

/** 모든 지역 ID가 geometry에 정확히 한 번씩 있는지. */
export function assertGeometryCoverage(): {
  ok: boolean;
  missing: string[];
  duplicate: string[];
} {
  const seen = new Map<string, number>();
  for (const g of STRATEGIC_REGION_GEOMETRY) {
    seen.set(g.regionId, (seen.get(g.regionId) ?? 0) + 1);
  }
  const missing = STRATEGIC_REGION_IDS.filter((id) => !seen.has(id));
  const duplicate = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  return { ok: missing.length === 0 && duplicate.length === 0, missing, duplicate };
}

/** 출발·도착 앵커를 잇는 이동 경로 점열(직선 + 경계 중점 보간). */
export function buildMovePathPoints(
  fromRegionId: string,
  toRegionId: string,
): Point2D[] {
  const from = getRegionGeometry(fromRegionId);
  const to = getRegionGeometry(toRegionId);
  if (!from || !to) return [];
  const start = from.armyAnchors[0] ?? from.labelAnchor;
  const end = to.armyAnchors[0] ?? to.labelAnchor;
  const mid =
    from.edgeMidpoints[toRegionId as StrategicRegionId] ??
    to.edgeMidpoints[fromRegionId as StrategicRegionId] ?? {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    };
  return [start, mid, end];
}

/** SVG polyline points 속성 문자열. */
export function pointsToSvg(points: Point2D[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

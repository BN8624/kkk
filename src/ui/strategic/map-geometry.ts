// 한 줄 목적: 12지역 자연 섬 SVG 영토 path·해안·앵커 정본을 제공한다
import {
  STRATEGIC_REGION_IDS,
  type StrategicRegionId,
  createStrategicRegions,
} from '../../strategic/map';

/** 모바일 세로 우선 viewBox — 섬이 화면 대부분을 채운다. */
export const STRATEGIC_MAP_VIEWBOX = {
  width: 360,
  height: 480,
  attr: '0 0 360 480',
} as const;

export interface Point2D {
  x: number;
  y: number;
}

export interface StrategicRegionGeometry {
  regionId: StrategicRegionId;
  path: string;
  labelAnchor: Point2D;
  structureAnchor: Point2D;
  armyAnchors: Point2D[];
  edgeMidpoints: Partial<Record<StrategicRegionId, Point2D>>;
  coastal: boolean;
}

/**
 * 세로형 자연 섬 위 12영토. 인접 그래프(4×3)는 정본과 일치.
 * 퍼즐 격자·동일 크기 조각이 아닌 유기 해안·내륙 형태.
 */
export const STRATEGIC_REGION_GEOMETRY: readonly StrategicRegionGeometry[] = [
  {
    regionId: 'r00',
    path: 'M 28,70 C 24,40 48,18 88,14 C 120,12 148,28 158,52 L 164,118 C 148,138 112,148 78,140 C 48,132 30,104 28,70 Z',
    labelAnchor: { x: 96, y: 78 },
    structureAnchor: { x: 100, y: 52 },
    armyAnchors: [
      { x: 72, y: 100 },
      { x: 118, y: 108 },
    ],
    edgeMidpoints: {
      r01: { x: 160, y: 84 },
      r04: { x: 100, y: 142 },
    },
    coastal: true,
  },
  {
    regionId: 'r01',
    path: 'M 158,52 C 172,28 204,18 236,28 C 256,36 268,54 270,78 L 266,132 C 246,148 206,152 176,140 L 164,118 Z',
    labelAnchor: { x: 214, y: 88 },
    structureAnchor: { x: 218, y: 58 },
    armyAnchors: [
      { x: 192, y: 112 },
      { x: 236, y: 118 },
    ],
    edgeMidpoints: {
      r00: { x: 160, y: 84 },
      r02: { x: 268, y: 104 },
      r05: { x: 214, y: 144 },
    },
    coastal: true,
  },
  {
    regionId: 'r02',
    path: 'M 270,78 C 280,48 310,36 336,48 C 348,56 352,76 348,100 L 340,140 C 320,152 288,148 270,138 L 266,132 Z',
    labelAnchor: { x: 304, y: 100 },
    structureAnchor: { x: 308, y: 70 },
    armyAnchors: [
      { x: 286, y: 118 },
      { x: 322, y: 124 },
    ],
    edgeMidpoints: {
      r01: { x: 268, y: 104 },
      r03: { x: 340, y: 138 },
      r06: { x: 300, y: 146 },
    },
    coastal: true,
  },
  {
    regionId: 'r03',
    path: 'M 340,140 C 348,116 356,108 358,128 C 360,152 358,172 350,188 C 344,198 338,194 336,182 L 340,154 Z',
    labelAnchor: { x: 346, y: 152 },
    structureAnchor: { x: 348, y: 126 },
    armyAnchors: [
      { x: 334, y: 168 },
      { x: 350, y: 172 },
    ],
    edgeMidpoints: {
      r02: { x: 340, y: 138 },
      r07: { x: 342, y: 186 },
    },
    coastal: true,
  },
  {
    regionId: 'r04',
    path: 'M 24,148 C 20,124 40,112 72,108 C 100,104 128,116 138,140 L 144,220 C 124,242 80,250 48,236 C 28,224 22,182 24,148 Z',
    labelAnchor: { x: 82, y: 176 },
    structureAnchor: { x: 86, y: 146 },
    armyAnchors: [
      { x: 58, y: 200 },
      { x: 108, y: 206 },
    ],
    edgeMidpoints: {
      r00: { x: 100, y: 142 },
      r05: { x: 140, y: 178 },
      r08: { x: 86, y: 236 },
    },
    coastal: true,
  },
  {
    regionId: 'r05',
    path: 'M 138,140 C 158,120 196,116 228,130 C 246,140 256,158 258,180 L 252,236 C 228,256 180,258 150,242 L 144,220 Z',
    labelAnchor: { x: 196, y: 188 },
    structureAnchor: { x: 200, y: 156 },
    armyAnchors: [
      { x: 170, y: 210 },
      { x: 220, y: 216 },
    ],
    edgeMidpoints: {
      r01: { x: 214, y: 144 },
      r04: { x: 140, y: 178 },
      r06: { x: 256, y: 206 },
      r09: { x: 198, y: 246 },
    },
    coastal: false,
  },
  {
    regionId: 'r06',
    path: 'M 258,180 C 272,148 308,140 336,154 C 348,164 354,184 352,206 L 346,250 C 320,268 276,268 254,250 L 252,236 Z',
    labelAnchor: { x: 300, y: 200 },
    structureAnchor: { x: 304, y: 168 },
    armyAnchors: [
      { x: 274, y: 224 },
      { x: 324, y: 230 },
    ],
    edgeMidpoints: {
      r02: { x: 300, y: 146 },
      r05: { x: 256, y: 206 },
      r07: { x: 348, y: 224 },
      r10: { x: 298, y: 258 },
    },
    coastal: false,
  },
  {
    regionId: 'r07',
    path: 'M 336,154 C 348,138 356,144 358,166 C 360,192 356,216 348,236 L 336,252 C 324,258 316,248 318,232 L 346,250 L 352,206 Z',
    labelAnchor: { x: 340, y: 196 },
    structureAnchor: { x: 342, y: 168 },
    armyAnchors: [
      { x: 324, y: 218 },
      { x: 348, y: 222 },
    ],
    edgeMidpoints: {
      r03: { x: 342, y: 186 },
      r06: { x: 348, y: 224 },
      r11: { x: 340, y: 252 },
    },
    coastal: true,
  },
  {
    regionId: 'r08',
    path: 'M 28,248 C 22,224 42,210 76,206 C 108,202 132,214 142,236 L 148,320 C 128,348 78,360 42,344 C 22,330 20,280 28,248 Z',
    labelAnchor: { x: 86, y: 280 },
    structureAnchor: { x: 90, y: 244 },
    armyAnchors: [
      { x: 60, y: 304 },
      { x: 112, y: 310 },
    ],
    edgeMidpoints: {
      r04: { x: 86, y: 236 },
      r09: { x: 144, y: 276 },
    },
    coastal: true,
  },
  {
    regionId: 'r09',
    path: 'M 142,236 C 164,216 204,212 240,228 C 256,238 264,256 266,278 L 258,348 C 230,372 176,374 148,354 L 148,320 Z',
    labelAnchor: { x: 200, y: 290 },
    structureAnchor: { x: 204, y: 252 },
    armyAnchors: [
      { x: 172, y: 316 },
      { x: 228, y: 322 },
    ],
    edgeMidpoints: {
      r05: { x: 198, y: 246 },
      r08: { x: 144, y: 276 },
      r10: { x: 262, y: 310 },
    },
    coastal: true,
  },
  {
    regionId: 'r10',
    path: 'M 266,278 C 280,250 318,242 348,258 C 358,268 360,290 356,312 L 348,368 C 320,392 274,390 254,366 L 258,348 Z',
    labelAnchor: { x: 304, y: 312 },
    structureAnchor: { x: 308, y: 274 },
    armyAnchors: [
      { x: 280, y: 338 },
      { x: 330, y: 344 },
    ],
    edgeMidpoints: {
      r06: { x: 298, y: 258 },
      r09: { x: 262, y: 310 },
      r11: { x: 348, y: 336 },
    },
    coastal: true,
  },
  {
    regionId: 'r11',
    path: 'M 336,252 C 348,232 358,242 358,270 C 358,310 350,348 334,372 C 318,390 294,388 278,370 L 348,368 L 356,312 Z',
    labelAnchor: { x: 328, y: 318 },
    structureAnchor: { x: 330, y: 284 },
    armyAnchors: [
      { x: 304, y: 348 },
      { x: 340, y: 352 },
    ],
    edgeMidpoints: {
      r07: { x: 340, y: 252 },
      r10: { x: 348, y: 336 },
    },
    coastal: true,
  },
];

const GEOMETRY_BY_ID = new Map(
  STRATEGIC_REGION_GEOMETRY.map((g) => [g.regionId, g] as const),
);

export function getRegionGeometry(regionId: string): StrategicRegionGeometry | undefined {
  return GEOMETRY_BY_ID.get(regionId as StrategicRegionId);
}

export function isPointInViewBox(p: Point2D, pad = 0): boolean {
  return (
    p.x >= -pad &&
    p.y >= -pad &&
    p.x <= STRATEGIC_MAP_VIEWBOX.width + pad &&
    p.y <= STRATEGIC_MAP_VIEWBOX.height + pad
  );
}

export function isValidSvgPath(d: string): boolean {
  if (!d || d.length < 8) return false;
  return /^[MLCZmlcz0-9.,\s-]+$/.test(d) && /[Mm]/.test(d) && /[Zz]/.test(d);
}

export const ISLAND_OUTLINE_PATH =
  'M 28,70 C 24,40 48,18 88,14 C 130,10 170,22 200,36 C 240,22 290,24 330,42 C 348,54 356,80 348,110 C 356,140 360,180 354,220 C 360,260 360,310 348,350 C 358,380 348,420 318,438 C 278,458 220,466 160,456 C 110,466 60,448 36,408 C 18,368 16,320 24,280 C 14,240 16,190 24,150 C 16,120 18,95 28,70 Z';

export const ISLAND_SHOAL_PATH =
  'M 36,78 C 34,50 56,28 92,24 C 132,20 170,32 198,46 C 236,34 284,36 322,52 C 340,64 348,88 340,116 C 348,146 352,186 346,224 C 352,264 352,312 340,350 C 348,376 338,412 312,428 C 274,446 218,454 164,444 C 116,454 70,436 48,398 C 32,360 30,312 38,274 C 28,236 30,190 38,152 C 30,124 30,100 36,78 Z';

export const RIVER_PATH =
  'M 190,48 C 200,90 206,130 212,170 C 220,220 228,270 232,320 C 234,360 236,400 230,430';

export const ROAD_PATHS: readonly string[] = [
  'M 100,56 C 92,110 86,160 82,210 C 78,260 88,300 92,340',
  'M 348,128 C 344,180 342,230 340,280 C 338,330 334,370 330,400',
  'M 90,176 C 140,188 190,194 240,200 C 280,204 320,210 340,216',
  'M 90,284 C 140,298 190,306 240,312 C 280,316 320,324 340,332',
];

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
  const ctrl: Point2D = {
    x: mid.x + (mid.y - start.y) * 0.06,
    y: mid.y - (mid.x - start.x) * 0.06,
  };
  return [start, ctrl, end];
}

export function pointsToSvg(points: Point2D[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

export function listSharedEdges(): Array<{
  a: StrategicRegionId;
  b: StrategicRegionId;
  mid: Point2D;
  aCenter: Point2D;
  bCenter: Point2D;
}> {
  const edges: Array<{
    a: StrategicRegionId;
    b: StrategicRegionId;
    mid: Point2D;
    aCenter: Point2D;
    bCenter: Point2D;
  }> = [];
  const seen = new Set<string>();
  for (const g of STRATEGIC_REGION_GEOMETRY) {
    for (const [nid, mid] of Object.entries(g.edgeMidpoints) as [
      StrategicRegionId,
      Point2D,
    ][]) {
      const key = g.regionId < nid ? `${g.regionId}|${nid}` : `${nid}|${g.regionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const other = getRegionGeometry(nid);
      if (!other || !mid) continue;
      edges.push({
        a: g.regionId,
        b: nid,
        mid,
        aCenter: g.labelAnchor,
        bCenter: other.labelAnchor,
      });
    }
  }
  return edges;
}

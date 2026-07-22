// 한 줄 목적: 12지역 자연 섬 SVG 영토 path·공유 경계·해안·앵커 정본을 제공한다
import {
  STRATEGIC_REGION_IDS,
  type StrategicRegionId,
  createStrategicRegions,
} from '../../strategic/map';

/**
 * 모바일 세로 비율(≈0.53)에 맞춘 viewBox.
 * meet 사용 시 레터박스 없이 지도 래퍼를 채운다.
 */
export const STRATEGIC_MAP_VIEWBOX = {
  width: 280,
  height: 530,
  attr: '0 0 280 530',
} as const;

export interface Point2D {
  x: number;
  y: number;
}

export interface SharedEdgeGeometry {
  a: StrategicRegionId;
  b: StrategicRegionId;
  /** 공유 경계 path (a→b 방향, 열린 path). */
  path: string;
  mid: Point2D;
  aCenter: Point2D;
  bCenter: Point2D;
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

type Pt = Point2D;

function pt(x: number, y: number): Pt {
  return { x, y };
}

function mid(a: Pt, b: Pt): Pt {
  return pt((a.x + b.x) / 2, (a.y + b.y) / 2);
}

function avg(points: Pt[]): Pt {
  const n = points.length || 1;
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return pt(x / n, y / n);
}

function fmt(p: Pt): string {
  return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
}

/** 이차 곡선 한 변: start → end, 제어점 control. */
function qEdge(start: Pt, control: Pt, end: Pt): string {
  return `M ${fmt(start)} Q ${fmt(control)} ${fmt(end)}`;
}

/**
 * 4×3 격자 코너 정점(행 0..3, 열 0..4).
 * 바깥 해안은 유기적으로, 내부는 약간 흔들리게 배치해 퍼즐 조각 느낌을 피한다.
 *
 * 격자:
 * r00 r01 r02 r03
 * r04 r05 r06 r07
 * r08 r09 r10 r11
 */
const CORNERS: Pt[][] = [
  // row 0 — 북 해안
  [pt(38, 52), pt(92, 36), pt(148, 30), pt(204, 40), pt(248, 62)],
  // row 1
  [pt(24, 175), pt(88, 168), pt(145, 160), pt(205, 168), pt(262, 182)],
  // row 2
  [pt(28, 320), pt(90, 312), pt(148, 308), pt(208, 316), pt(258, 328)],
  // row 3 — 남 해안
  [pt(46, 468), pt(100, 488), pt(155, 500), pt(210, 486), pt(248, 458)],
];

/** 가로 변 제어점 H[row][col]: CORNERS[row][col] → CORNERS[row][col+1] */
const H_CTRL: Pt[][] = [
  [pt(62, 28), pt(118, 22), pt(176, 26), pt(230, 42)],
  [pt(54, 158), pt(116, 152), pt(174, 154), pt(236, 170)],
  [pt(56, 300), pt(118, 296), pt(178, 302), pt(236, 318)],
  [pt(70, 492), pt(128, 508), pt(184, 504), pt(232, 468)],
];

/** 세로 변 제어점 V[row][col]: CORNERS[row][col] → CORNERS[row+1][col] */
const V_CTRL: Pt[][] = [
  [pt(18, 110), pt(78, 98), pt(140, 92), pt(210, 100), pt(268, 118)],
  [pt(16, 245), pt(80, 238), pt(142, 232), pt(212, 240), pt(266, 252)],
  [pt(26, 392), pt(86, 400), pt(148, 408), pt(214, 400), pt(260, 390)],
];

function hEdge(row: number, col: number): { start: Pt; ctrl: Pt; end: Pt } {
  return {
    start: CORNERS[row]![col]!,
    ctrl: H_CTRL[row]![col]!,
    end: CORNERS[row]![col + 1]!,
  };
}

function vEdge(row: number, col: number): { start: Pt; ctrl: Pt; end: Pt } {
  return {
    start: CORNERS[row]![col]!,
    ctrl: V_CTRL[row]![col]!,
    end: CORNERS[row + 1]![col]!,
  };
}

/** 사각형 영역 path: 상→우→하(역)→좌(역). 인접 영토와 동일 제어점 공유. */
function regionPath(row: number, col: number): string {
  const top = hEdge(row, col);
  const right = vEdge(row, col + 1);
  const bot = hEdge(row + 1, col);
  const left = vEdge(row, col);
  // 시계방향: NW → NE → SE → SW → NW
  return [
    `M ${fmt(top.start)}`,
    `Q ${fmt(top.ctrl)} ${fmt(top.end)}`,
    `Q ${fmt(right.ctrl)} ${fmt(right.end)}`,
    `Q ${fmt(bot.ctrl)} ${fmt(bot.start)}`,
    `Q ${fmt(left.ctrl)} ${fmt(left.start)}`,
    'Z',
  ].join(' ');
}

function regionCenter(row: number, col: number): Pt {
  return avg([
    CORNERS[row]![col]!,
    CORNERS[row]![col + 1]!,
    CORNERS[row + 1]![col]!,
    CORNERS[row + 1]![col + 1]!,
  ]);
}

function edgeMidFrom(start: Pt, ctrl: Pt, end: Pt): Pt {
  // 이차 베지어 t=0.5: 0.25P0 + 0.5C + 0.25P1
  return pt(
    0.25 * start.x + 0.5 * ctrl.x + 0.25 * end.x,
    0.25 * start.y + 0.5 * ctrl.y + 0.25 * end.y,
  );
}

function isCoastalCell(row: number, col: number): boolean {
  return row === 0 || row === 2 || col === 0 || col === 3;
}

function buildGeometry(): {
  regions: StrategicRegionGeometry[];
  sharedEdges: SharedEdgeGeometry[];
  islandOutline: string;
  islandShoal: string;
} {
  const regions: StrategicRegionGeometry[] = [];
  const idAt = (row: number, col: number): StrategicRegionId =>
    STRATEGIC_REGION_IDS[row * 4 + col]!;

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const regionId = idAt(row, col);
      const c = regionCenter(row, col);
      const edgeMidpoints: Partial<Record<StrategicRegionId, Point2D>> = {};

      // east
      if (col < 3) {
        const e = vEdge(row, col + 1);
        edgeMidpoints[idAt(row, col + 1)] = edgeMidFrom(e.start, e.ctrl, e.end);
      }
      // west
      if (col > 0) {
        const e = vEdge(row, col);
        edgeMidpoints[idAt(row, col - 1)] = edgeMidFrom(e.start, e.ctrl, e.end);
      }
      // south
      if (row < 2) {
        const e = hEdge(row + 1, col);
        edgeMidpoints[idAt(row + 1, col)] = edgeMidFrom(e.start, e.ctrl, e.end);
      }
      // north
      if (row > 0) {
        const e = hEdge(row, col);
        edgeMidpoints[idAt(row - 1, col)] = edgeMidFrom(e.start, e.ctrl, e.end);
      }

      // 구조·군단 앵커를 중심 안쪽에 배치 (해안 잘림 방지)
      const structureAnchor = pt(c.x, c.y - 14);
      const armyAnchors = [
        pt(c.x - 16, c.y + 18),
        pt(c.x + 14, c.y + 22),
      ];

      regions.push({
        regionId,
        path: regionPath(row, col),
        labelAnchor: c,
        structureAnchor,
        armyAnchors,
        edgeMidpoints,
        coastal: isCoastalCell(row, col),
      });
    }
  }

  const sharedEdges: SharedEdgeGeometry[] = [];
  // 가로 내부 경계 (row 1..2의 가로선 = 남북 인접)
  for (let row = 1; row <= 2; row++) {
    for (let col = 0; col < 4; col++) {
      const north = idAt(row - 1, col);
      const south = idAt(row, col);
      const e = hEdge(row, col);
      const a = north < south ? north : south;
      const b = north < south ? south : north;
      sharedEdges.push({
        a,
        b,
        path: qEdge(e.start, e.ctrl, e.end),
        mid: edgeMidFrom(e.start, e.ctrl, e.end),
        aCenter: regionCenter(Math.floor(STRATEGIC_REGION_IDS.indexOf(a) / 4), STRATEGIC_REGION_IDS.indexOf(a) % 4),
        bCenter: regionCenter(Math.floor(STRATEGIC_REGION_IDS.indexOf(b) / 4), STRATEGIC_REGION_IDS.indexOf(b) % 4),
      });
    }
  }
  // 세로 내부 경계 (col 1..3의 세로선 = 동서 인접)
  for (let row = 0; row < 3; row++) {
    for (let col = 1; col <= 3; col++) {
      const west = idAt(row, col - 1);
      const east = idAt(row, col);
      const e = vEdge(row, col);
      const a = west < east ? west : east;
      const b = west < east ? east : west;
      sharedEdges.push({
        a,
        b,
        path: qEdge(e.start, e.ctrl, e.end),
        mid: edgeMidFrom(e.start, e.ctrl, e.end),
        aCenter: regionCenter(Math.floor(STRATEGIC_REGION_IDS.indexOf(a) / 4), STRATEGIC_REGION_IDS.indexOf(a) % 4),
        bCenter: regionCenter(Math.floor(STRATEGIC_REGION_IDS.indexOf(b) / 4), STRATEGIC_REGION_IDS.indexOf(b) % 4),
      });
    }
  }

  // 섬 외곽: 북→동→남→서 시계방향 (외곽 변 연결)
  const outlineParts: string[] = [];
  // north coast left→right
  {
    const first = hEdge(0, 0);
    outlineParts.push(`M ${fmt(first.start)}`);
    for (let col = 0; col < 4; col++) {
      const e = hEdge(0, col);
      outlineParts.push(`Q ${fmt(e.ctrl)} ${fmt(e.end)}`);
    }
  }
  // east coast top→bottom (col=4 verticals)
  for (let row = 0; row < 3; row++) {
    const e = vEdge(row, 4);
    outlineParts.push(`Q ${fmt(e.ctrl)} ${fmt(e.end)}`);
  }
  // south coast right→left
  for (let col = 3; col >= 0; col--) {
    const e = hEdge(3, col);
    outlineParts.push(`Q ${fmt(e.ctrl)} ${fmt(e.start)}`);
  }
  // west coast bottom→top (col=0 verticals reversed)
  for (let row = 2; row >= 0; row--) {
    const e = vEdge(row, 0);
    outlineParts.push(`Q ${fmt(e.ctrl)} ${fmt(e.start)}`);
  }
  outlineParts.push('Z');
  const islandOutline = outlineParts.join(' ');

  // 얕은 여울: 외곽을 약간 바깥으로 확장한 근사
  const islandShoal =
    'M 30,60 C 28,28 70,12 110,18 C 150,8 190,14 230,32 C 255,48 272,80 270,120 ' +
    'C 276,170 278,220 272,270 C 278,320 276,370 268,410 C 272,450 250,490 210,505 ' +
    'C 170,520 120,518 80,498 C 45,480 22,440 20,390 C 14,340 12,280 18,230 ' +
    'C 12,180 14,120 22,90 C 24,72 26,65 30,60 Z';

  return { regions, sharedEdges, islandOutline, islandShoal };
}

const BUILT = buildGeometry();

/**
 * 세로형 자연 섬 위 12영토. 인접 그래프(4×3)는 정본과 일치.
 * 모든 인접 쌍이 동일 경계 제어점을 공유해 중복·공백 없이 섬을 덮는다.
 */
export const STRATEGIC_REGION_GEOMETRY: readonly StrategicRegionGeometry[] = BUILT.regions;

/** 인접 영토 공유 경계(전선·동맹 경계 렌더용). */
export const STRATEGIC_SHARED_EDGES: readonly SharedEdgeGeometry[] = BUILT.sharedEdges;

export const ISLAND_OUTLINE_PATH = BUILT.islandOutline;

export const ISLAND_SHOAL_PATH = BUILT.islandShoal;

export const RIVER_PATH =
  'M 148,42 C 155,110 158,180 152,250 C 146,320 150,390 155,470';

export const ROAD_PATHS: readonly string[] = [
  'M 92,50 C 78,140 70,230 72,320 C 74,390 88,450 100,480',
  'M 248,70 C 255,150 258,240 252,330 C 246,400 238,450 230,475',
  'M 50,175 C 100,168 150,162 200,168 C 230,172 250,178 260,182',
  'M 45,320 C 95,312 150,308 200,316 C 230,320 250,325 255,328',
];

const GEOMETRY_BY_ID = new Map(
  STRATEGIC_REGION_GEOMETRY.map((g) => [g.regionId, g] as const),
);

const SHARED_EDGE_BY_KEY = new Map<string, SharedEdgeGeometry>();
for (const e of STRATEGIC_SHARED_EDGES) {
  SHARED_EDGE_BY_KEY.set(`${e.a}|${e.b}`, e);
  SHARED_EDGE_BY_KEY.set(`${e.b}|${e.a}`, e);
}

export function getRegionGeometry(regionId: string): StrategicRegionGeometry | undefined {
  return GEOMETRY_BY_ID.get(regionId as StrategicRegionId);
}

export function getSharedEdge(
  a: string,
  b: string,
): SharedEdgeGeometry | undefined {
  return SHARED_EDGE_BY_KEY.get(`${a}|${b}`);
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
  return /^[MLCZmlcz0-9.,\s-Qq]+$/.test(d) && /[Mm]/.test(d) && /[Zz]/.test(d);
}

/**
 * 앵커가 해당 영토 bounding box 안에 있는지 대략 검증.
 * (path 내부 정밀 검사는 브라우저 isPointInFill에 위임)
 */
export function anchorsInsideRegionBounds(g: StrategicRegionGeometry): boolean {
  // path 좌표에서 min/max 추출
  const nums = g.path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (nums.length < 4) return false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i]!;
    const y = nums[i + 1]!;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  // 경계에서 약간 안쪽 여유
  const pad = 2;
  const inside = (p: Point2D) =>
    p.x >= minX + pad &&
    p.x <= maxX - pad &&
    p.y >= minY + pad &&
    p.y <= maxY - pad;
  if (!inside(g.labelAnchor) || !inside(g.structureAnchor)) return false;
  for (const a of g.armyAnchors) {
    if (!inside(a)) return false;
  }
  return true;
}

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
  const midPt =
    from.edgeMidpoints[toRegionId as StrategicRegionId] ??
    to.edgeMidpoints[fromRegionId as StrategicRegionId] ?? {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    };
  const ctrl: Point2D = {
    x: midPt.x + (midPt.y - start.y) * 0.06,
    y: midPt.y - (midPt.x - start.x) * 0.06,
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
  path: string;
}> {
  return STRATEGIC_SHARED_EDGES.map((e) => ({
    a: e.a,
    b: e.b,
    mid: e.mid,
    aCenter: e.aCenter,
    bCenter: e.bCenter,
    path: e.path,
  }));
}

/** 공유 경계 수가 정본 인접 수와 같은지. */
export function sharedEdgesMatchCanonCount(): boolean {
  const adj = geometryAdjacencyMatchesCanon();
  if (!adj.ok) return false;
  const regions = createStrategicRegions();
  let undirected = 0;
  const seen = new Set<string>();
  for (const r of regions) {
    for (const n of r.neighbors) {
      const key = r.id < n ? `${r.id}|${n}` : `${n}|${r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      undirected++;
    }
  }
  return STRATEGIC_SHARED_EDGES.length === undirected;
}

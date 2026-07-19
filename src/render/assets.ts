// 한 줄 목적: 중앙 에셋 레지스트리와 코드 생성 벡터 텍스처(외부 에셋으로 교체 가능)를 제공한다
import Phaser from 'phaser';
import type { FactionId, TerrainId, UnitTypeId } from '../core/types';
import { EXTERNAL_ASSETS } from './external-assets';

/** 공용 병종 — 전 세력 토큰 생성 */
const SHARED_UNIT_TYPES: UnitTypeId[] = ['infantry', 'archer', 'cavalry'];
/** 고유 병종 — 소속 세력만 토큰 생성(units.ts 진영과 일치, 순환 import 회피) */
const UNIQUE_UNIT_HOME: Partial<Record<UnitTypeId, FactionId>> = {
  guardian: 'azure',
  raider: 'crimson',
  crossbow: 'violet',
};

export type AssetId =
  | `terrain.${TerrainId}`
  | `building.capital.${FactionId}`
  | `building.village.${FactionId | 'neutral'}`
  | `building.crown.${FactionId | 'neutral'}`
  | `unit.${UnitTypeId}.${FactionId}`
  | 'ui.highlight.move'
  | 'ui.highlight.attack'
  | 'ui.ring.select';

/** 육각 타일 논리 반지름(px). 렌더 좌표 계산의 기준이 된다. */
export const HEX_SIZE = 44;
/** 레티나 대응을 위한 텍스처 생성 배율 */
const TEX_SCALE = 2;

export const FACTION_COLORS: Record<FactionId, { main: string; dark: string; light: string }> = {
  azure: { main: '#31558f', dark: '#1d345c', light: '#5b7fb5' },
  crimson: { main: '#93313c', dark: '#5f1e26', light: '#b95c66' },
  violet: { main: '#5f3d75', dark: '#3d264c', light: '#87639d' },
};

export const NEUTRAL_COLOR = { main: '#7a7468', dark: '#4f4b43', light: '#a29c8e' };

const IVORY = '#f2ead8';
const GOLD = '#c9a227';

export function allAssetIds(): AssetId[] {
  const ids: AssetId[] = [];
  const terrains: TerrainId[] = ['plains', 'forest', 'mountain', 'water'];
  const factions: FactionId[] = ['azure', 'crimson', 'violet'];
  for (const t of terrains) ids.push(`terrain.${t}`);
  for (const f of factions) ids.push(`building.capital.${f}`);
  ids.push('building.village.neutral');
  for (const f of factions) ids.push(`building.village.${f}`);
  ids.push('building.crown.neutral');
  for (const f of factions) ids.push(`building.crown.${f}`);
  // 공용 3종은 전 세력, 고유 3종은 소속 세력만(불필요한 조합 텍스처 생성 금지)
  for (const u of SHARED_UNIT_TYPES) {
    for (const f of factions) ids.push(`unit.${u}.${f}`);
  }
  for (const [u, home] of Object.entries(UNIQUE_UNIT_HOME) as [UnitTypeId, FactionId][]) {
    ids.push(`unit.${u}.${home}`);
  }
  ids.push('ui.highlight.move', 'ui.highlight.attack', 'ui.ring.select');
  return ids;
}

export function textureKey(id: AssetId): string {
  return `asset:${id}`;
}

/** 외부 에셋이 등록된 ID는 Phaser 로더 큐에 추가한다(BootScene preload에서 호출). */
export function queueExternalAssets(scene: Phaser.Scene): void {
  for (const [id, url] of Object.entries(EXTERNAL_ASSETS)) {
    scene.load.image(textureKey(id as AssetId), url);
  }
}

/** 외부 에셋이 없는 모든 ID의 텍스처를 코드로 생성한다(BootScene create에서 호출). */
export function ensureGeneratedTextures(scene: Phaser.Scene): void {
  for (const id of allAssetIds()) {
    const key = textureKey(id);
    if (scene.textures.exists(key)) continue;
    const canvas = generateAsset(id);
    scene.textures.addCanvas(key, canvas);
  }
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w * TEX_SCALE;
  canvas.height = h * TEX_SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(TEX_SCALE, TEX_SCALE);
  return [canvas, ctx];
}

function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    const x = cx + size * Math.cos(angle);
    const y = cy + size * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function hexTextureSize(): { w: number; h: number } {
  return { w: Math.ceil(Math.sqrt(3) * HEX_SIZE) + 4, h: HEX_SIZE * 2 + 4 };
}

function generateAsset(id: AssetId): HTMLCanvasElement {
  if (id.startsWith('terrain.')) return generateTerrain(id.slice(8) as TerrainId);
  if (id.startsWith('building.capital.')) return generateCapital(id.slice(17) as FactionId);
  if (id.startsWith('building.crown.'))
    return generateCrownFort(id.slice(15) as FactionId | 'neutral');
  if (id.startsWith('building.village.'))
    return generateVillage(id.slice(17) as FactionId | 'neutral');
  if (id.startsWith('unit.')) {
    const [, type, faction] = id.split('.');
    return generateUnitToken(type as UnitTypeId, faction as FactionId);
  }
  if (id === 'ui.highlight.move') return generateHighlight('rgba(213, 176, 66, 0.38)', GOLD);
  if (id === 'ui.highlight.attack')
    return generateHighlight('rgba(163, 54, 54, 0.38)', '#a33636');
  return generateSelectRing();
}

// ---------------- 지형 ----------------

function generateTerrain(terrain: TerrainId): HTMLCanvasElement {
  const { w, h } = hexTextureSize();
  const [canvas, ctx] = makeCanvas(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const size = HEX_SIZE;

  const base: Record<TerrainId, { fill: string; edge: string }> = {
    plains: { fill: '#cfc196', edge: '#a8975f' },
    forest: { fill: '#a9b183', edge: '#7c8a55' },
    mountain: { fill: '#b3a893', edge: '#8b7f68' },
    water: { fill: '#38567e', edge: '#243c5e' },
  };
  const { fill, edge } = base[terrain];

  hexPath(ctx, cx, cy, size - 1);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = edge;
  ctx.stroke();
  // 안쪽 밝은 테두리로 보드게임 타일 느낌
  hexPath(ctx, cx, cy, size - 5);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.stroke();

  if (terrain === 'plains') {
    ctx.strokeStyle = '#a8975f';
    ctx.lineWidth = 1.4;
    const tufts = [
      [-14, 6],
      [10, -12],
      [16, 14],
      [-20, -10],
      [2, 20],
    ];
    for (const [tx, ty] of tufts) {
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + tx + i * 3, cy + ty + 4);
        ctx.quadraticCurveTo(cx + tx + i * 3.6, cy + ty - 1, cx + tx + i * 4.4, cy + ty - 4);
        ctx.stroke();
      }
    }
  } else if (terrain === 'forest') {
    const trees = [
      [-13, 4, 1],
      [11, -8, 0.9],
      [7, 15, 0.8],
    ] as const;
    for (const [tx, ty, s] of trees) {
      const x = cx + tx;
      const y = cy + ty;
      ctx.fillStyle = '#5b4a33';
      ctx.fillRect(x - 1.6 * s, y + 5 * s, 3.2 * s, 5 * s);
      ctx.fillStyle = '#4f6b3a';
      for (let layer = 0; layer < 3; layer++) {
        const ly = y + 4 * s - layer * 6 * s;
        const lw = (12 - layer * 3) * s;
        ctx.beginPath();
        ctx.moveTo(x - lw / 2, ly);
        ctx.lineTo(x + lw / 2, ly);
        ctx.lineTo(x, ly - 8 * s);
        ctx.closePath();
        ctx.fill();
      }
    }
  } else if (terrain === 'mountain') {
    const peaks = [
      [-8, 8, 1.15],
      [12, 10, 0.85],
    ] as const;
    for (const [px, py, s] of peaks) {
      const x = cx + px;
      const y = cy + py;
      ctx.fillStyle = '#8a7d67';
      ctx.beginPath();
      ctx.moveTo(x - 17 * s, y);
      ctx.lineTo(x, y - 26 * s);
      ctx.lineTo(x + 17 * s, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#6f6455';
      ctx.beginPath();
      ctx.moveTo(x, y - 26 * s);
      ctx.lineTo(x + 17 * s, y);
      ctx.lineTo(x + 4 * s, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = IVORY;
      ctx.beginPath();
      ctx.moveTo(x - 4.5 * s, y - 19 * s);
      ctx.lineTo(x, y - 26 * s);
      ctx.lineTo(x + 4.5 * s, y - 19 * s);
      ctx.lineTo(x + 2 * s, y - 16.5 * s);
      ctx.lineTo(x, y - 19 * s);
      ctx.lineTo(x - 2 * s, y - 16.5 * s);
      ctx.closePath();
      ctx.fill();
    }
  } else if (terrain === 'water') {
    ctx.strokeStyle = 'rgba(240, 245, 255, 0.5)';
    ctx.lineWidth = 1.6;
    const waves = [
      [-14, -10],
      [6, 2],
      [-8, 16],
    ];
    for (const [wx, wy] of waves) {
      ctx.beginPath();
      ctx.moveTo(cx + wx - 8, cy + wy);
      ctx.quadraticCurveTo(cx + wx - 4, cy + wy - 4, cx + wx, cy + wy);
      ctx.quadraticCurveTo(cx + wx + 4, cy + wy + 4, cx + wx + 8, cy + wy);
      ctx.stroke();
    }
  }
  return canvas;
}

// ---------------- 건물 ----------------

function factionPalette(owner: FactionId | 'neutral') {
  return owner === 'neutral' ? NEUTRAL_COLOR : FACTION_COLORS[owner];
}

function generateVillage(owner: FactionId | 'neutral'): HTMLCanvasElement {
  const w = 60;
  const h = 60;
  const [canvas, ctx] = makeCanvas(w, h);
  const pal = factionPalette(owner);
  const cx = w / 2;
  const base = h / 2 + 14;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1.5;
  // 본채
  ctx.fillStyle = IVORY;
  ctx.fillRect(cx - 13, base - 16, 26, 16);
  ctx.restore();
  ctx.strokeStyle = '#6b5b41';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(cx - 13, base - 16, 26, 16);
  // 지붕
  ctx.fillStyle = '#9a5b3c';
  ctx.beginPath();
  ctx.moveTo(cx - 16, base - 16);
  ctx.lineTo(cx, base - 28);
  ctx.lineTo(cx + 16, base - 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 문
  ctx.fillStyle = '#6b5b41';
  ctx.fillRect(cx - 3, base - 9, 6, 9);
  // 깃대와 깃발
  ctx.strokeStyle = '#4a4237';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx + 12, base - 16);
  ctx.lineTo(cx + 12, base - 34);
  ctx.stroke();
  ctx.fillStyle = pal.main;
  ctx.beginPath();
  ctx.moveTo(cx + 12, base - 34);
  ctx.lineTo(cx + 24, base - 31);
  ctx.lineTo(cx + 12, base - 27);
  ctx.closePath();
  ctx.fill();
  return canvas;
}

function generateCapital(owner: FactionId): HTMLCanvasElement {
  const w = 68;
  const h = 68;
  const [canvas, ctx] = makeCanvas(w, h);
  const pal = FACTION_COLORS[owner];
  const cx = w / 2;
  const base = h / 2 + 18;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 2;
  // 성벽
  ctx.fillStyle = '#d8d0bc';
  ctx.fillRect(cx - 18, base - 20, 36, 20);
  ctx.restore();
  ctx.strokeStyle = '#5c5443';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(cx - 18, base - 20, 36, 20);
  // 성문
  ctx.fillStyle = '#5c5443';
  ctx.beginPath();
  ctx.moveTo(cx - 5, base);
  ctx.lineTo(cx - 5, base - 10);
  ctx.arc(cx, base - 10, 5, Math.PI, 0);
  ctx.lineTo(cx + 5, base);
  ctx.closePath();
  ctx.fill();
  // 좌우 탑
  for (const side of [-1, 1]) {
    const tx = cx + side * 18;
    ctx.fillStyle = '#cbc2ab';
    ctx.fillRect(tx - 6, base - 34, 12, 34);
    ctx.strokeRect(tx - 6, base - 34, 12, 34);
    // 총안
    ctx.fillStyle = '#cbc2ab';
    for (let i = -1; i <= 1; i++) {
      ctx.fillRect(tx + i * 4 - 1.5, base - 38, 3, 4);
      ctx.strokeRect(tx + i * 4 - 1.5, base - 38, 3, 4);
    }
  }
  // 중앙 본성
  ctx.fillStyle = '#d8d0bc';
  ctx.fillRect(cx - 8, base - 30, 16, 12);
  ctx.strokeRect(cx - 8, base - 30, 16, 12);
  // 중앙 깃발
  ctx.strokeStyle = '#4a4237';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(cx, base - 30);
  ctx.lineTo(cx, base - 46);
  ctx.stroke();
  ctx.fillStyle = pal.main;
  ctx.beginPath();
  ctx.moveTo(cx, base - 46);
  ctx.lineTo(cx + 14, base - 42.5);
  ctx.lineTo(cx, base - 39);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = pal.dark;
  ctx.lineWidth = 1;
  ctx.stroke();
  // 금색 왕관 점
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(cx, base - 46, 2.2, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

/** 왕관 요새: 팔각 석탑 위 금색 왕관. 소유 세력 색 깃발 2개. */
function generateCrownFort(owner: FactionId | 'neutral'): HTMLCanvasElement {
  const w = 68;
  const h = 68;
  const [canvas, ctx] = makeCanvas(w, h);
  const pal = factionPalette(owner);
  const cx = w / 2;
  const base = h / 2 + 18;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 2;
  // 원형 성곽
  ctx.fillStyle = '#cbc2ab';
  ctx.beginPath();
  ctx.ellipse(cx, base - 6, 22, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#5c5443';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // 중앙 탑
  ctx.fillStyle = '#d8d0bc';
  ctx.fillRect(cx - 10, base - 36, 20, 30);
  ctx.strokeRect(cx - 10, base - 36, 20, 30);
  // 총안
  for (let i = -1; i <= 1; i++) {
    ctx.fillRect(cx + i * 7 - 1.8, base - 40, 3.6, 4.5);
    ctx.strokeRect(cx + i * 7 - 1.8, base - 40, 3.6, 4.5);
  }
  // 성문
  ctx.fillStyle = '#5c5443';
  ctx.beginPath();
  ctx.moveTo(cx - 4, base - 6);
  ctx.lineTo(cx - 4, base - 15);
  ctx.arc(cx, base - 15, 4, Math.PI, 0);
  ctx.lineTo(cx + 4, base - 6);
  ctx.closePath();
  ctx.fill();
  // 좌우 깃발
  for (const side of [-1, 1]) {
    const fx = cx + side * 14;
    ctx.strokeStyle = '#4a4237';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(fx, base - 36);
    ctx.lineTo(fx, base - 48);
    ctx.stroke();
    ctx.fillStyle = pal.main;
    ctx.beginPath();
    ctx.moveTo(fx, base - 48);
    ctx.lineTo(fx + side * 9, base - 45.5);
    ctx.lineTo(fx, base - 43);
    ctx.closePath();
    ctx.fill();
  }
  // 큰 금색 왕관
  ctx.fillStyle = GOLD;
  ctx.strokeStyle = '#8a6d14';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - 9, base - 44);
  ctx.lineTo(cx - 7.5, base - 54);
  ctx.lineTo(cx - 3.5, base - 48);
  ctx.lineTo(cx, base - 56);
  ctx.lineTo(cx + 3.5, base - 48);
  ctx.lineTo(cx + 7.5, base - 54);
  ctx.lineTo(cx + 9, base - 44);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillRect(cx - 9, base - 44, 18, 3.4);
  ctx.strokeRect(cx - 9, base - 44, 18, 3.4);
  return canvas;
}

// ---------------- 유닛 토큰 ----------------

export const FACTION_EMBLEMS: Record<FactionId, 'cross' | 'chevron' | 'star'> = {
  azure: 'cross',
  crimson: 'chevron',
  violet: 'star',
};

function drawEmblem(
  ctx: CanvasRenderingContext2D,
  emblem: 'cross' | 'chevron' | 'star',
  cx: number,
  cy: number,
  s: number,
): void {
  ctx.fillStyle = IVORY;
  if (emblem === 'cross') {
    ctx.fillRect(cx - s * 0.18, cy - s * 0.55, s * 0.36, s * 1.1);
    ctx.fillRect(cx - s * 0.55, cy - s * 0.18, s * 1.1, s * 0.36);
  } else if (emblem === 'chevron') {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.6, cy + s * 0.4);
    ctx.lineTo(cx, cy - s * 0.45);
    ctx.lineTo(cx + s * 0.6, cy + s * 0.4);
    ctx.lineTo(cx + s * 0.32, cy + s * 0.4);
    ctx.lineTo(cx, cy - s * 0.02);
    ctx.lineTo(cx - s * 0.32, cy + s * 0.4);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const outer = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const inner = outer + Math.PI / 5;
      const ox = cx + Math.cos(outer) * s * 0.62;
      const oy = cy + Math.sin(outer) * s * 0.62;
      const ix = cx + Math.cos(inner) * s * 0.26;
      const iy = cy + Math.sin(inner) * s * 0.26;
      if (i === 0) ctx.moveTo(ox, oy);
      else ctx.lineTo(ox, oy);
      ctx.lineTo(ix, iy);
    }
    ctx.closePath();
    ctx.fill();
  }
}

function drawClassIcon(
  ctx: CanvasRenderingContext2D,
  type: UnitTypeId,
  cx: number,
  cy: number,
  s: number,
): void {
  ctx.strokeStyle = IVORY;
  ctx.fillStyle = IVORY;
  ctx.lineWidth = s * 0.14;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (type === 'infantry') {
    // 검: 칼날 + 코등이 + 손잡이
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.62);
    ctx.lineTo(cx, cy + s * 0.34);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.34, cy + s * 0.1);
    ctx.lineTo(cx + s * 0.34, cy + s * 0.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.34);
    ctx.lineTo(cx, cy + s * 0.58);
    ctx.stroke();
    // 칼끝
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.11, cy - s * 0.5);
    ctx.lineTo(cx, cy - s * 0.72);
    ctx.lineTo(cx + s * 0.11, cy - s * 0.5);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'archer') {
    // 활과 화살
    ctx.beginPath();
    ctx.arc(cx - s * 0.05, cy, s * 0.55, -Math.PI / 2.6, Math.PI / 2.6);
    ctx.stroke();
    ctx.lineWidth = s * 0.09;
    ctx.beginPath();
    const bx = cx - s * 0.05 + Math.cos(-Math.PI / 2.6) * s * 0.55;
    const by = cy + Math.sin(-Math.PI / 2.6) * s * 0.55;
    const bx2 = cx - s * 0.05 + Math.cos(Math.PI / 2.6) * s * 0.55;
    const by2 = cy + Math.sin(Math.PI / 2.6) * s * 0.55;
    ctx.moveTo(bx, by);
    ctx.lineTo(bx2, by2);
    ctx.stroke();
    ctx.lineWidth = s * 0.12;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.5, cy);
    ctx.lineTo(cx + s * 0.52, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.32, cy - s * 0.14);
    ctx.lineTo(cx + s * 0.56, cy);
    ctx.lineTo(cx + s * 0.32, cy + s * 0.14);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'cavalry') {
    // 기병: 말 머리 실루엣
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.42, cy + s * 0.55);
    ctx.lineTo(cx - s * 0.18, cy - s * 0.05);
    ctx.lineTo(cx - s * 0.05, cy - s * 0.42);
    ctx.lineTo(cx + s * 0.06, cy - s * 0.62);
    ctx.lineTo(cx + s * 0.18, cy - s * 0.34);
    ctx.lineTo(cx + s * 0.5, cy - s * 0.12);
    ctx.lineTo(cx + s * 0.46, cy + s * 0.06);
    ctx.lineTo(cx + s * 0.16, cy - s * 0.02);
    ctx.lineTo(cx + s * 0.2, cy + s * 0.55);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'guardian') {
    // 수호대: 세로 타워 방패 + 짧은 창(보병 검과 구분)
    ctx.fillStyle = IVORY;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.42, cy - s * 0.55);
    ctx.lineTo(cx + s * 0.42, cy - s * 0.55);
    ctx.lineTo(cx + s * 0.42, cy + s * 0.12);
    ctx.quadraticCurveTo(cx + s * 0.42, cy + s * 0.48, cx, cy + s * 0.62);
    ctx.quadraticCurveTo(cx - s * 0.42, cy + s * 0.48, cx - s * 0.42, cy + s * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(43,36,22,0.35)';
    ctx.lineWidth = s * 0.08;
    ctx.stroke();
    // 짧은 창이 방패 위로
    ctx.strokeStyle = IVORY;
    ctx.lineWidth = s * 0.16;
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.28, cy + s * 0.35);
    ctx.lineTo(cx + s * 0.28, cy - s * 0.72);
    ctx.stroke();
    ctx.fillStyle = IVORY;
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.28, cy - s * 0.78);
    ctx.lineTo(cx + s * 0.4, cy - s * 0.55);
    ctx.lineTo(cx + s * 0.16, cy - s * 0.55);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'raider') {
    // 약탈대: 경장 횃불 + 단검(기병 말머리와 구분)
    ctx.lineWidth = s * 0.14;
    // 횃불 자루
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.22, cy + s * 0.55);
    ctx.lineTo(cx - s * 0.08, cy - s * 0.05);
    ctx.stroke();
    // 불꽃
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.28, cy - s * 0.05);
    ctx.quadraticCurveTo(cx - s * 0.02, cy - s * 0.55, cx + s * 0.12, cy - s * 0.08);
    ctx.quadraticCurveTo(cx + s * 0.02, cy - s * 0.28, cx - s * 0.08, cy - s * 0.02);
    ctx.quadraticCurveTo(cx - s * 0.18, cy - s * 0.32, cx - s * 0.28, cy - s * 0.05);
    ctx.closePath();
    ctx.fill();
    // 단검
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.08, cy + s * 0.42);
    ctx.lineTo(cx + s * 0.42, cy - s * 0.28);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.02, cy + s * 0.18);
    ctx.lineTo(cx + s * 0.22, cy + s * 0.32);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.32, cy - s * 0.38);
    ctx.lineTo(cx + s * 0.5, cy - s * 0.22);
    ctx.lineTo(cx + s * 0.36, cy - s * 0.12);
    ctx.closePath();
    ctx.fill();
    // 약탈 자루(작은 주머니)
    ctx.beginPath();
    ctx.ellipse(cx + s * 0.08, cy + s * 0.48, s * 0.18, s * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 쇠뇌대: 수평 활대 + 개머리판(궁병 활과 구분)
    ctx.lineWidth = s * 0.16;
    // 총신/개머리판
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.55, cy + s * 0.08);
    ctx.lineTo(cx + s * 0.42, cy + s * 0.08);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.55, cy + s * 0.08);
    ctx.lineTo(cx - s * 0.62, cy + s * 0.38);
    ctx.stroke();
    // 수평 활대(prod)
    ctx.lineWidth = s * 0.12;
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.05, cy - s * 0.42);
    ctx.lineTo(cx + s * 0.05, cy + s * 0.55);
    ctx.stroke();
    // 현
    ctx.lineWidth = s * 0.08;
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.05, cy - s * 0.38);
    ctx.lineTo(cx - s * 0.12, cy + s * 0.08);
    ctx.lineTo(cx + s * 0.05, cy + s * 0.5);
    ctx.stroke();
    // 볼트 촉
    ctx.lineWidth = s * 0.12;
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.2, cy + s * 0.08);
    ctx.lineTo(cx + s * 0.58, cy + s * 0.08);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.48, cy - s * 0.12);
    ctx.lineTo(cx + s * 0.68, cy + s * 0.08);
    ctx.lineTo(cx + s * 0.48, cy + s * 0.28);
    ctx.closePath();
    ctx.fill();
  }
}

function generateUnitToken(type: UnitTypeId, faction: FactionId): HTMLCanvasElement {
  const w = 56;
  const h = 62;
  const [canvas, ctx] = makeCanvas(w, h);
  const pal = FACTION_COLORS[faction];
  const cx = w / 2;
  const cy = h / 2;

  // 방패 형태
  const shield = (inset: number) => {
    const top = 6 + inset;
    const side = 22 - inset;
    ctx.beginPath();
    ctx.moveTo(cx - side, top);
    ctx.lineTo(cx + side, top);
    ctx.lineTo(cx + side, cy + 4);
    ctx.quadraticCurveTo(cx + side, cy + 18, cx, h - 4 - inset);
    ctx.quadraticCurveTo(cx - side, cy + 18, cx - side, cy + 4);
    ctx.closePath();
  };

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  shield(0);
  ctx.fillStyle = IVORY;
  ctx.fill();
  ctx.restore();

  shield(3);
  ctx.fillStyle = pal.main;
  ctx.fill();
  shield(3);
  ctx.strokeStyle = pal.dark;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 상단 문장 밴드
  ctx.fillStyle = pal.dark;
  ctx.fillRect(cx - 19, 9, 38, 15);
  drawEmblem(ctx, FACTION_EMBLEMS[faction], cx, 16.5, 11);

  // 병과 아이콘
  drawClassIcon(ctx, type, cx, cy + 12, 13);

  return canvas;
}

// ---------------- 하이라이트 ----------------

function generateHighlight(fill: string, border: string): HTMLCanvasElement {
  const { w, h } = hexTextureSize();
  const [canvas, ctx] = makeCanvas(w, h);
  hexPath(ctx, w / 2, h / 2, HEX_SIZE - 4);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 2.4;
  ctx.stroke();
  return canvas;
}

function generateSelectRing(): HTMLCanvasElement {
  const { w, h } = hexTextureSize();
  const [canvas, ctx] = makeCanvas(w, h);
  hexPath(ctx, w / 2, h / 2, HEX_SIZE - 3);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3.4;
  ctx.stroke();
  hexPath(ctx, w / 2, h / 2, HEX_SIZE - 7);
  ctx.strokeStyle = 'rgba(255, 240, 190, 0.8)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  return canvas;
}

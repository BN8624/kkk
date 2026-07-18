// 한 줄 목적: 축 좌표 기반 육각 타일 좌표 계산(이웃·거리·직선·픽셀 변환)을 제공한다
import type { Axial } from './types';

export const HEX_DIRS: Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function neighbors(h: Axial): Axial[] {
  return HEX_DIRS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));
}

export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** odd-r 오프셋 좌표(col,row)를 축 좌표로 변환한다. */
export function offsetToAxial(col: number, row: number): Axial {
  return { q: col - ((row - (row & 1)) >> 1), r: row };
}

/** 축 좌표를 pointy-top 픽셀 좌표로 변환한다(size는 육각 반지름). */
export function axialToPixel(h: Axial, size: number): { x: number; y: number } {
  return {
    x: size * Math.sqrt(3) * (h.q + h.r / 2),
    y: size * 1.5 * h.r,
  };
}

function cubeLerp(a: Axial, b: Axial, t: number): { q: number; r: number; s: number } {
  const as = -a.q - a.r;
  const bs = -b.q - b.r;
  return {
    q: a.q + (b.q - a.q) * t,
    r: a.r + (b.r - a.r) * t,
    s: as + (bs - as) * t,
  };
}

function cubeRound(f: { q: number; r: number; s: number }): Axial {
  let q = Math.round(f.q);
  let r = Math.round(f.r);
  const s = Math.round(f.s);
  const dq = Math.abs(q - f.q);
  const dr = Math.abs(r - f.r);
  const ds = Math.abs(s - f.s);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

/** 두 육각 사이 직선 경로의 타일 목록을 반환한다(양 끝 포함). */
export function hexLine(a: Axial, b: Axial): Axial[] {
  const n = hexDistance(a, b);
  if (n === 0) return [{ q: a.q, r: a.r }];
  const out: Axial[] = [];
  for (let i = 0; i <= n; i++) {
    out.push(cubeRound(cubeLerp(a, b, i / n)));
  }
  return out;
}

/** 중심에서 radius 이내의 모든 육각 좌표를 반환한다. */
export function hexesInRange(center: Axial, radius: number): Axial[] {
  const out: Axial[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      out.push({ q: center.q + q, r: center.r + r });
    }
  }
  return out;
}

// 한 줄 목적: 군단 이동 경로 애니메이션과 점령·전투 플래시 효과를 처리한다
import {
  buildMovePathPoints,
  pointsToSvg,
  type Point2D,
} from './map-geometry';

const DEFAULT_MS = 480;
const MIN_MS = 300;
const MAX_MS = 700;

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function durationMs(): number {
  if (prefersReducedMotion()) return 0;
  return Math.min(MAX_MS, Math.max(MIN_MS, DEFAULT_MS));
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function lerp(a: Point2D, b: Point2D, t: number): Point2D {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** 점열을 따라 t∈[0,1] 위치. */
export function pointAlongPath(points: Point2D[], t: number): Point2D {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1 || t <= 0) return points[0]!;
  if (t >= 1) return points[points.length - 1]!;
  const segs = points.length - 1;
  const ft = t * segs;
  const i = Math.min(segs - 1, Math.floor(ft));
  const local = ft - i;
  return lerp(points[i]!, points[i + 1]!, local);
}

export interface MoveAnimationOpts {
  svgRoot: SVGSVGElement;
  armyEl: SVGGElement | null;
  fromRegionId: string;
  toRegionId: string;
  /** 미리보기 경로만 표시할 때 true (토큰 이동 없음) */
  previewOnly?: boolean;
}

/** 이동 예정 점선 경로를 그린다. 반환 함수로 제거. */
export function showMovePreviewPath(
  svgRoot: SVGSVGElement,
  fromRegionId: string,
  toRegionId: string,
): () => void {
  const points = buildMovePathPoints(fromRegionId, toRegionId);
  if (points.length < 2) return () => undefined;
  const layer =
    svgRoot.querySelector<SVGGElement>('#st-path-layer') ??
    (() => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.id = 'st-path-layer';
      svgRoot.appendChild(g);
      return g;
    })();
  layer.innerHTML = '';
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  poly.setAttribute('points', pointsToSvg(points));
  poly.setAttribute('class', 'st-move-path preview');
  poly.setAttribute('fill', 'none');
  layer.appendChild(poly);
  return () => {
    layer.innerHTML = '';
  };
}

/**
 * 군단 토큰을 경로를 따라 이동시킨다.
 * reduced-motion이면 즉시 완료.
 */
export function animateArmyMove(opts: MoveAnimationOpts): Promise<void> {
  const points = buildMovePathPoints(opts.fromRegionId, opts.toRegionId);
  const ms = durationMs();
  const layer =
    opts.svgRoot.querySelector<SVGGElement>('#st-path-layer') ??
    (() => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.id = 'st-path-layer';
      opts.svgRoot.appendChild(g);
      return g;
    })();

  layer.innerHTML = '';
  if (points.length >= 2) {
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', pointsToSvg(points));
    poly.setAttribute('class', 'st-move-path active');
    poly.setAttribute('fill', 'none');
    layer.appendChild(poly);
  }

  if (opts.previewOnly || !opts.armyEl || points.length < 2 || ms === 0) {
    return new Promise((resolve) => {
      if (ms === 0) {
        layer.innerHTML = '';
        resolve();
        return;
      }
      window.setTimeout(() => {
        layer.innerHTML = '';
        resolve();
      }, ms || 0);
    });
  }

  const el = opts.armyEl;
  const origin = points[0]!;
  el.classList.add('st-army-moving');
  // data-ox/oy: 원래 translate 기준
  const baseX = Number(el.getAttribute('data-x') ?? origin.x);
  const baseY = Number(el.getAttribute('data-y') ?? origin.y);

  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = (now: number) => {
      const raw = Math.min(1, (now - t0) / ms);
      const t = easeInOut(raw);
      const p = pointAlongPath(points, t);
      const dx = p.x - baseX;
      const dy = p.y - baseY;
      el.setAttribute('transform', `translate(${baseX + dx},${baseY + dy})`);
      if (raw < 1) {
        requestAnimationFrame(step);
      } else {
        el.classList.remove('st-army-moving');
        layer.innerHTML = '';
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

/** 점령 플래시(짧은 광채). */
export function flashRegionCapture(svgRoot: SVGSVGElement, regionId: string): void {
  const path = svgRoot.querySelector<SVGPathElement>(
    `.strategic-region[data-region="${CSS.escape(regionId)}"]`,
  );
  if (!path) return;
  path.classList.add('st-capture-flash');
  window.setTimeout(() => path.classList.remove('st-capture-flash'), 520);
}

/** 전투 진입 전 충돌 강조. */
export function flashBattleClash(
  svgRoot: SVGSVGElement,
  regionId: string,
  armyIds: string[],
): void {
  const path = svgRoot.querySelector<SVGPathElement>(
    `.strategic-region[data-region="${CSS.escape(regionId)}"]`,
  );
  path?.classList.add('st-battle-flash');
  for (const id of armyIds) {
    svgRoot
      .querySelector(`.strategic-army[data-army="${CSS.escape(id)}"]`)
      ?.classList.add('st-battle-army');
  }
  window.setTimeout(() => {
    path?.classList.remove('st-battle-flash');
    svgRoot.querySelectorAll('.st-battle-army').forEach((el) => {
      el.classList.remove('st-battle-army');
    });
  }, 600);
}

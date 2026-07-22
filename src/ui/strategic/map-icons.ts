// 한 줄 목적: 전략 지도용 SVG 정착지·지형·세력 문양 아이콘을 생성한다
import type { FactionId } from '../../core/types';
import type { StrategicRegionTerrain, StrategicSettlement } from '../../strategic/types';

/** SVG 패턴 정의(세력 채움 + 지형 힌트). 한 번만 defs에 삽입. */
export function strategicMapPatternDefs(): string {
  return `
    <defs>
      <pattern id="st-pat-azure" width="10" height="10" patternUnits="userSpaceOnUse">
        <rect width="10" height="10" fill="#2a5f9e"/>
        <path d="M0 10 L10 0 M-2 2 L2 -2 M8 12 L12 8" stroke="rgba(180,220,255,.35)" stroke-width="1.2"/>
      </pattern>
      <pattern id="st-pat-crimson" width="10" height="10" patternUnits="userSpaceOnUse">
        <rect width="10" height="10" fill="#8b2e2e"/>
        <path d="M5 0 L5 10 M0 5 L10 5" stroke="rgba(255,180,160,.3)" stroke-width="1.1"/>
        <circle cx="5" cy="5" r="1.2" fill="rgba(255,200,180,.4)"/>
      </pattern>
      <pattern id="st-pat-violet" width="12" height="12" patternUnits="userSpaceOnUse">
        <rect width="12" height="12" fill="#5a3a8a"/>
        <path d="M2 10 Q6 2 10 10" fill="none" stroke="rgba(220,190,255,.4)" stroke-width="1.2"/>
      </pattern>
      <pattern id="st-pat-neutral" width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill="#5c584e"/>
        <path d="M0 8 L8 0" stroke="rgba(200,190,170,.2)" stroke-width="1"/>
      </pattern>
      <pattern id="st-pat-plains" width="14" height="8" patternUnits="userSpaceOnUse">
        <path d="M0 6 Q3.5 2 7 6 T14 6" fill="none" stroke="rgba(180,200,120,.25)" stroke-width="1"/>
      </pattern>
      <pattern id="st-pat-forest" width="12" height="12" patternUnits="userSpaceOnUse">
        <circle cx="4" cy="5" r="2.2" fill="rgba(40,90,50,.35)"/>
        <circle cx="9" cy="8" r="1.8" fill="rgba(40,90,50,.3)"/>
      </pattern>
      <pattern id="st-pat-mountain" width="16" height="12" patternUnits="userSpaceOnUse">
        <path d="M0 12 L4 4 L8 12 Z M6 12 L10 3 L14 12 Z" fill="rgba(90,95,110,.3)"/>
      </pattern>
      <filter id="st-soft-glow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="1.6" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>`;
}

export function ownerFillUrl(owner: FactionId | null): string {
  if (owner === 'azure') return 'url(#st-pat-azure)';
  if (owner === 'crimson') return 'url(#st-pat-crimson)';
  if (owner === 'violet') return 'url(#st-pat-violet)';
  return 'url(#st-pat-neutral)';
}

export function ownerStroke(owner: FactionId | null): string {
  if (owner === 'azure') return '#7ec8ff';
  if (owner === 'crimson') return '#ff8a8a';
  if (owner === 'violet') return '#d0a8ff';
  return '#cfc8b8';
}

export function terrainOverlayUrl(terrain: StrategicRegionTerrain): string {
  if (terrain === 'forest') return 'url(#st-pat-forest)';
  if (terrain === 'mountain') return 'url(#st-pat-mountain)';
  return 'url(#st-pat-plains)';
}

/** 정착지 아이콘(구조 앵커 중심). */
export function settlementIconSvg(
  settlement: StrategicSettlement,
  x: number,
  y: number,
): string {
  if (settlement === 'capital') {
    // multi-tower crown capital
    return `<g class="st-structure st-capital" transform="translate(${x},${y})" aria-hidden="true">
      <rect x="-7" y="-2" width="14" height="9" rx="1" fill="#e8d5a3" stroke="#5a4a20" stroke-width="0.8"/>
      <rect x="-9" y="-8" width="5" height="8" fill="#d4c090" stroke="#5a4a20" stroke-width="0.7"/>
      <rect x="-2" y="-12" width="5" height="12" fill="#f0e0b0" stroke="#5a4a20" stroke-width="0.7"/>
      <rect x="5" y="-8" width="5" height="8" fill="#d4c090" stroke="#5a4a20" stroke-width="0.7"/>
      <circle cx="0.5" cy="-14" r="1.6" fill="#c9a227"/>
    </g>`;
  }
  if (settlement === 'town') {
    return `<g class="st-structure st-town" transform="translate(${x},${y})" aria-hidden="true">
      <rect x="-8" y="-1" width="7" height="7" fill="#c4b896" stroke="#4a4030" stroke-width="0.7"/>
      <polygon points="-8,-1 -4.5,-6 -1,-1" fill="#8b4518" stroke="#4a4030" stroke-width="0.6"/>
      <rect x="1" y="0" width="7" height="6" fill="#b8a888" stroke="#4a4030" stroke-width="0.7"/>
      <polygon points="1,0 4.5,-5 8,0" fill="#6b5344" stroke="#4a4030" stroke-width="0.6"/>
    </g>`;
  }
  // fort
  return `<g class="st-structure st-fort" transform="translate(${x},${y})" aria-hidden="true">
    <path d="M-9 4 L-9 -4 L-5 -4 L-5 -8 L-1 -8 L-1 -4 L1 -4 L1 -8 L5 -8 L5 -4 L9 -4 L9 4 Z"
      fill="#9a9aaa" stroke="#3a3a48" stroke-width="0.8"/>
    <rect x="-3" y="0" width="6" height="4" fill="#4a4050"/>
  </g>`;
}

/** 지형 소형 아이콘(구조 옆 또는 라벨 아래). */
export function terrainIconSvg(
  terrain: StrategicRegionTerrain,
  x: number,
  y: number,
): string {
  if (terrain === 'plains') {
    return `<g class="st-terrain-icon" transform="translate(${x},${y})" aria-hidden="true">
      <path d="M-6 2 Q-3 -2 0 2 T6 2" fill="none" stroke="#c8d878" stroke-width="1.3"/>
      <path d="M-5 4 Q-2 1 1 4 T7 4" fill="none" stroke="#a8c050" stroke-width="1"/>
    </g>`;
  }
  if (terrain === 'forest') {
    return `<g class="st-terrain-icon" transform="translate(${x},${y})" aria-hidden="true">
      <polygon points="0,-6 -4,2 4,2" fill="#3d8b4a" stroke="#1e4a28" stroke-width="0.6"/>
      <polygon points="-3,-3 -6,3 0,3" fill="#2f7a3c" stroke="#1e4a28" stroke-width="0.5"/>
      <rect x="-0.8" y="2" width="1.6" height="3" fill="#5a3a20"/>
    </g>`;
  }
  return `<g class="st-terrain-icon" transform="translate(${x},${y})" aria-hidden="true">
    <polygon points="0,-7 -5,3 5,3" fill="#8a909a" stroke="#3a4048" stroke-width="0.7"/>
    <polygon points="3,-3 0,3 7,3" fill="#6a7078" stroke="#3a4048" stroke-width="0.5"/>
  </g>`;
}

/** 세력 문양(군단 토큰·라벨용). */
export function factionEmblemSvg(faction: FactionId, size = 10): string {
  const s = size;
  if (faction === 'azure') {
    return `<g class="st-emblem azure" aria-hidden="true">
      <circle r="${s / 2}" fill="#2a5f9e" stroke="#a8d4ff" stroke-width="1"/>
      <path d="M0 ${-s * 0.28} L${s * 0.22} ${s * 0.18} L${-s * 0.22} ${s * 0.18} Z" fill="#dcefff"/>
    </g>`;
  }
  if (faction === 'crimson') {
    return `<g class="st-emblem crimson" aria-hidden="true">
      <rect x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}" rx="2" fill="#8b2e2e" stroke="#ffb0b0" stroke-width="1"/>
      <path d="M0 ${-s * 0.3} L0 ${s * 0.3} M${-s * 0.22} ${-s * 0.05} L${s * 0.22} ${-s * 0.05}" stroke="#ffd0d0" stroke-width="1.4"/>
    </g>`;
  }
  return `<g class="st-emblem violet" aria-hidden="true">
    <polygon points="0,${-s / 2} ${s / 2},0 0,${s / 2} ${-s / 2},0" fill="#5a3a8a" stroke="#e0c8ff" stroke-width="1"/>
    <circle r="${s * 0.18}" fill="#f0e8ff"/>
  </g>`;
}

export function factionLetter(faction: FactionId): string {
  if (faction === 'azure') return 'A';
  if (faction === 'crimson') return 'C';
  return 'V';
}

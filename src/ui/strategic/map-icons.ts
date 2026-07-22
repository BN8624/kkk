// 한 줄 목적: 전략 지도용 지형·거점·세력 문양·군단 깃발 SVG를 생성한다
import type { FactionId } from '../../core/types';
import type { StrategicRegionTerrain, StrategicSettlement } from '../../strategic/types';

/** SVG 그라데이션·연한 지형 패턴 정의(강한 격자/사선 소유 패턴 없음). */
export function strategicMapPatternDefs(): string {
  return `
    <defs>
      <radialGradient id="st-ocean-grad" cx="50%" cy="48%" r="62%">
        <stop offset="0%" stop-color="#1a4a62"/>
        <stop offset="55%" stop-color="#0d2a3c"/>
        <stop offset="100%" stop-color="#061018"/>
      </radialGradient>
      <linearGradient id="st-island-base-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#4a6a3a"/>
        <stop offset="45%" stop-color="#3d5a32"/>
        <stop offset="100%" stop-color="#2e4830"/>
      </linearGradient>
      <radialGradient id="st-shoal-grad" cx="50%" cy="50%" r="50%">
        <stop offset="70%" stop-color="rgba(90,160,170,0)"/>
        <stop offset="100%" stop-color="rgba(70,150,160,.35)"/>
      </radialGradient>
      <pattern id="st-tex-plains" width="20" height="12" patternUnits="userSpaceOnUse">
        <path d="M0 8 Q5 4 10 8 T20 8" fill="none" stroke="rgba(200,210,120,.18)" stroke-width="1.2"/>
      </pattern>
      <pattern id="st-tex-forest" width="16" height="16" patternUnits="userSpaceOnUse">
        <circle cx="5" cy="7" r="3" fill="rgba(20,70,30,.22)"/>
        <circle cx="12" cy="10" r="2.5" fill="rgba(25,80,35,.18)"/>
      </pattern>
      <pattern id="st-tex-mountain" width="22" height="14" patternUnits="userSpaceOnUse">
        <path d="M2 14 L8 4 L14 14 Z M10 14 L16 5 L22 14 Z" fill="rgba(60,55,50,.2)"/>
      </pattern>
      <filter id="st-soft-glow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="1.4" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="st-banner-shadow" x="-30%" y="-20%" width="160%" height="160%">
        <feDropShadow dx="0.8" dy="1.2" stdDeviation="1.2" flood-opacity="0.45"/>
      </filter>
    </defs>`;
}

/** 소유 영토 기본 지형색(세력 틴트 아래). */
export function terrainBaseFill(terrain: StrategicRegionTerrain): string {
  if (terrain === 'forest') return '#2d5a32';
  if (terrain === 'mountain') return '#5a564e';
  return '#4a6b38';
}

/**
 * 세력 소유 틴트 — 강한 사선/격자 패턴 없이 반투명 단색.
 * 지형이 먼저 보이게 한다.
 */
export function ownerTintFill(owner: FactionId | null): string {
  if (owner === 'azure') return 'rgba(42,110,180,0.42)';
  if (owner === 'crimson') return 'rgba(160,48,42,0.40)';
  if (owner === 'violet') return 'rgba(100,55,150,0.40)';
  return 'rgba(70,80,55,0.18)';
}

/** 세력 경계 스트로크. */
export function ownerStroke(owner: FactionId | null): string {
  if (owner === 'azure') return '#6eb4e8';
  if (owner === 'crimson') return '#e87870';
  if (owner === 'violet') return '#c49aef';
  return '#a8a090';
}

/** @deprecated 패턴 URL — 테스트 호환용 약한 지형 텍스처만. */
export function ownerFillUrl(owner: FactionId | null): string {
  // 강한 소유 패턴 제거: 단색 틴트 사용을 권장. 호환을 위해 틴트 색 문자열 반환.
  return ownerTintFill(owner);
}

export function terrainOverlayUrl(terrain: StrategicRegionTerrain): string {
  if (terrain === 'forest') return 'url(#st-tex-forest)';
  if (terrain === 'mountain') return 'url(#st-tex-mountain)';
  return 'url(#st-tex-plains)';
}

/** 거점 랜드마크(구조 앵커 중심, 수도>도시>요새 크기). */
export function settlementIconSvg(
  settlement: StrategicSettlement,
  x: number,
  y: number,
): string {
  if (settlement === 'capital') {
    // 다탑 성채 — 지도에서 즉시 식별
    return `<g class="st-structure st-capital" transform="translate(${x},${y})" aria-hidden="true">
      <ellipse cx="0" cy="10" rx="14" ry="3.5" fill="rgba(0,0,0,.28)"/>
      <path d="M-12 8 L-12 -2 L-7 -2 L-7 -10 L-2 -10 L-2 -2 L2 -2 L2 -14 L7 -14 L7 -2 L12 -2 L12 8 Z"
        fill="#d8c9a0" stroke="#3a3020" stroke-width="0.9"/>
      <rect x="-11" y="-1" width="22" height="9" fill="#c4b080" stroke="#3a3020" stroke-width="0.7"/>
      <rect x="-3" y="1" width="6" height="6" fill="#2a2420"/>
      <circle cx="2" cy="-16" r="2.2" fill="#c9a227" stroke="#5a4010" stroke-width="0.5"/>
      <path d="M-10 -10 L-10 -14 M5 -14 L5 -18" stroke="#8a7040" stroke-width="1"/>
      <path d="M-10 -14 L-6 -12 M5 -18 L9 -15" fill="#4a7ab8" stroke="#2a4060" stroke-width="0.4"/>
    </g>`;
  }
  if (settlement === 'town') {
    return `<g class="st-structure st-town" transform="translate(${x},${y})" aria-hidden="true">
      <ellipse cx="0" cy="7" rx="11" ry="2.8" fill="rgba(0,0,0,.22)"/>
      <rect x="-10" y="-1" width="9" height="8" rx="0.5" fill="#c8b898" stroke="#3a3020" stroke-width="0.7"/>
      <path d="M-10 -1 L-5.5 -7 L-1 -1 Z" fill="#8b4a28" stroke="#3a3020" stroke-width="0.6"/>
      <rect x="1" y="0" width="9" height="7" rx="0.5" fill="#b8a888" stroke="#3a3020" stroke-width="0.7"/>
      <path d="M1 0 L5.5 -6 L10 0 Z" fill="#6b4030" stroke="#3a3020" stroke-width="0.6"/>
      <rect x="-7" y="2" width="2.5" height="3" fill="#3a3028"/>
      <rect x="4" y="2" width="2.5" height="3" fill="#3a3028"/>
    </g>`;
  }
  // fort
  return `<g class="st-structure st-fort" transform="translate(${x},${y})" aria-hidden="true">
    <ellipse cx="0" cy="7" rx="11" ry="2.6" fill="rgba(0,0,0,.22)"/>
    <path d="M-11 6 L-11 -4 L-6 -4 L-6 -9 L-2 -9 L-2 -4 L2 -4 L2 -9 L6 -9 L6 -4 L11 -4 L11 6 Z"
      fill="#9a9aaa" stroke="#2a2a38" stroke-width="0.85"/>
    <rect x="-4" y="0" width="8" height="5" fill="#3a3548"/>
    <path d="M-8 -4 L-8 -7 M0 -9 L0 -12 M8 -4 L8 -7" stroke="#6a6a78" stroke-width="1.2"/>
  </g>`;
}

/** 지형 장식 클러스터(아이콘 뱃지가 아닌 지형 자체). */
export function terrainDecorSvg(
  terrain: StrategicRegionTerrain,
  x: number,
  y: number,
): string {
  if (terrain === 'plains') {
    return `<g class="st-terrain-decor st-plains" transform="translate(${x},${y})" aria-hidden="true" pointer-events="none">
      <path d="M-10 4 Q-5 0 0 4 T10 4" fill="none" stroke="rgba(200,210,100,.45)" stroke-width="1.4"/>
      <path d="M-8 7 Q-3 4 2 7 T12 7" fill="none" stroke="rgba(160,180,70,.35)" stroke-width="1.1"/>
      <ellipse cx="-4" cy="2" rx="2" ry="1" fill="rgba(220,200,80,.25)"/>
    </g>`;
  }
  if (terrain === 'forest') {
    return `<g class="st-terrain-decor st-forest" transform="translate(${x},${y})" aria-hidden="true" pointer-events="none">
      <ellipse cx="-5" cy="2" rx="5" ry="4.5" fill="#1e5a28" opacity="0.85"/>
      <ellipse cx="4" cy="3" rx="4.5" ry="4" fill="#246830" opacity="0.8"/>
      <ellipse cx="0" cy="-2" rx="4" ry="4.2" fill="#2a7838" opacity="0.9"/>
      <rect x="-1" y="4" width="2" height="4" fill="#4a3020"/>
      <ellipse cx="8" cy="5" rx="3" ry="2.8" fill="#1a5024" opacity="0.7"/>
    </g>`;
  }
  return `<g class="st-terrain-decor st-mountain" transform="translate(${x},${y})" aria-hidden="true" pointer-events="none">
    <path d="M-12 8 L-2 -6 L8 8 Z" fill="#6a6560" stroke="#3a3834" stroke-width="0.7"/>
    <path d="M-2 8 L6 -4 L14 8 Z" fill="#7a756e" stroke="#3a3834" stroke-width="0.6"/>
    <path d="M-2 -6 L0 -2 L2 -5 L4 -1 L6 -4" fill="none" stroke="rgba(240,240,245,.55)" stroke-width="1"/>
  </g>`;
}

/** @deprecated 소형 지형 아이콘 — decor로 대체. 호환 유지. */
export function terrainIconSvg(
  terrain: StrategicRegionTerrain,
  x: number,
  y: number,
): string {
  return terrainDecorSvg(terrain, x, y);
}

/** 세력 문양(군단 깃발·HUD용). */
export function factionEmblemSvg(faction: FactionId, size = 10): string {
  const s = size;
  if (faction === 'azure') {
    return `<g class="st-emblem azure" aria-hidden="true">
      <circle r="${s / 2}" fill="#1e4a8a" stroke="#a8d4ff" stroke-width="1"/>
      <path d="M0 ${-s * 0.32} L${s * 0.26} ${s * 0.2} L${-s * 0.26} ${s * 0.2} Z" fill="#e8f4ff"/>
      <path d="M${-s * 0.18} ${s * 0.05} Q0 ${s * 0.22} ${s * 0.18} ${s * 0.05}" fill="none" stroke="#7ec8ff" stroke-width="0.9"/>
    </g>`;
  }
  if (faction === 'crimson') {
    return `<g class="st-emblem crimson" aria-hidden="true">
      <circle r="${s / 2}" fill="#7a2020" stroke="#ffb0b0" stroke-width="1"/>
      <path d="M0 ${-s * 0.28} L${s * 0.12} ${-s * 0.05} L0 ${s * 0.3} L${-s * 0.12} ${-s * 0.05} Z" fill="#ffd0d0"/>
      <circle r="${s * 0.12}" fill="#ff6060"/>
    </g>`;
  }
  return `<g class="st-emblem violet" aria-hidden="true">
    <circle r="${s / 2}" fill="#4a2a78" stroke="#e0c8ff" stroke-width="1"/>
    <polygon points="0,${-s * 0.32} ${s * 0.28},0 0,${s * 0.32} ${-s * 0.28},0" fill="#f0e8ff"/>
    <circle r="${s * 0.14}" fill="#c49aef"/>
  </g>`;
}

/** 세력 깃발 색. */
export function factionBannerFill(faction: FactionId): string {
  if (faction === 'azure') return '#2a5f9e';
  if (faction === 'crimson') return '#8b2e2e';
  return '#5a3a8a';
}

export function factionBannerStroke(faction: FactionId): string {
  if (faction === 'azure') return '#a8d4ff';
  if (faction === 'crimson') return '#ffb0b0';
  return '#e0c8ff';
}

/**
 * 군단 전투 토큰(깃발+문양+병력). 문자 A/C/V를 기본 시각 요소로 쓰지 않음.
 * viewBox 기준 ~14–16 단위 ≈ 모바일 38–50 CSS px.
 */
export function armyBannerTokenSvg(opts: {
  faction: FactionId;
  unitCount: number;
  selected: boolean;
  acted: boolean;
  damaged: boolean;
  hpRatio: number;
  enemy: boolean;
}): string {
  const fill = factionBannerFill(opts.faction);
  const stroke = factionBannerStroke(opts.faction);
  const hpW = Math.max(0, Math.min(1, opts.hpRatio)) * 24;
  const hpColor = opts.hpRatio < 0.35 ? '#e04040' : opts.hpRatio < 0.7 ? '#e0a040' : '#50c060';
  const actedMark = opts.acted
    ? `<circle class="st-acted-dot" cx="11" cy="-15" r="3.4" fill="#1a1a14" stroke="#f4cf55" stroke-width="1.1"/>
       <path class="st-acted-mark" d="M9.2,-15.2 L10.7,-13.5 L13.4,-16.4" fill="none" stroke="#f4cf55" stroke-width="1.4"/>`
    : '';
  const hpBar = opts.damaged
    ? `<rect class="st-hp-bg" x="-12" y="14" width="24" height="3.4" rx="1.2" />
       <rect class="st-hp-fg" x="-12" y="14" width="${hpW}" height="3.4" rx="1.2" fill="${hpColor}" />`
    : '';
  return `
      <ellipse class="st-army-shadow" cx="1" cy="13" rx="11" ry="3.2" fill="rgba(0,0,0,.32)"/>
      <rect x="-1.4" y="-18" width="2.8" height="30" rx="1" fill="#4a3a24" stroke="#1a1408" stroke-width="0.5"/>
      <path class="st-army-banner" d="M1.2 -17 L16 -12.5 L16 0 L1.2 4.5 Z"
        fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
      <g transform="translate(8.5,-6.5)">${factionEmblemSvg(opts.faction, 10)}</g>
      <circle class="st-army-disc" cx="0" cy="2" r="11" fill="rgba(14,12,10,.94)" stroke="${stroke}" stroke-width="2"/>
      <g transform="translate(0,-1)">${factionEmblemSvg(opts.faction, 11)}</g>
      <text class="st-army-count" y="8" text-anchor="middle" dominant-baseline="central">${opts.unitCount}</text>
      ${hpBar}
      ${actedMark}
      <!-- 모바일 배율에서 ≥48×48 CSS px 터치 영역 (viewBox 단위 r≈26) -->
      <circle class="st-army-hit" r="26" fill="transparent"/>
      <rect class="st-army-hit-box" x="-26" y="-28" width="52" height="52" fill="transparent"/>`;
}

/** aria 등 접근성용 짧은 세력 표기(시각 토큰에는 사용하지 않음). */
export function factionLetter(faction: FactionId): string {
  if (faction === 'azure') return 'A';
  if (faction === 'crimson') return 'C';
  return 'V';
}

// 한 줄 목적: 전략 섬 지도·compact HUD·게임형 하단 패널 CSS를 한 번만 주입한다
let injected = false;

export function injectStrategicStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = `
.strategic-root {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  background: #061018;
  color: #f2ead8; overflow: hidden; z-index: 5;
  pointer-events: auto;
  padding: env(safe-area-inset-top, 0) env(safe-area-inset-right, 0) env(safe-area-inset-bottom, 0) env(safe-area-inset-left, 0);
}
.strategic-root[hidden] { display: none !important; }

/* Compact top HUD */
.strategic-hud {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px 10px;
  padding: 4px 8px 4px 10px;
  background: linear-gradient(180deg, rgba(12,18,26,.96) 0%, rgba(10,16,24,.92) 100%);
  border-bottom: 1px solid rgba(201,162,39,.4);
  flex-shrink: 0;
  max-height: 10%;
  min-height: 36px;
  box-shadow: 0 2px 10px rgba(0,0,0,.35);
}
.strategic-hud .hud-crest {
  width: 28px; height: 28px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.strategic-hud .hud-crest svg { width: 26px; height: 26px; overflow: visible; }
.strategic-hud .hud-main {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px;
  min-width: 0; flex: 1 1 auto;
  font-size: 12.5px; line-height: 1.25;
}
.strategic-hud .hud-kingdom {
  font-weight: 700; color: #f4ead0; white-space: nowrap;
}
.strategic-hud .hud-meta {
  color: rgba(242,234,216,.82); white-space: nowrap; font-size: 12px;
}
.strategic-hud .hud-meta .sep { opacity: .45; margin: 0 3px; }
.strategic-hud .hud-actions {
  display: flex; gap: 6px; flex-shrink: 0; align-items: center;
}
.strategic-hud button {
  min-height: 36px; min-width: 40px; padding: 5px 11px; border-radius: 9px;
  border: 1px solid #c9a227; background: linear-gradient(#d9b544, #c9a227);
  color: #2b2416; font-weight: bold; font-size: 12px;
}
.strategic-hud button.secondary {
  background: rgba(242,234,216,.1); color: #f2ead8;
  border-color: rgba(201,162,39,.45);
  min-width: 36px; padding: 5px 8px; font-size: 14px;
}
.strategic-hud button:disabled { opacity: .45; }
.strategic-hud .chip { display: none; }

.strategic-body {
  flex: 1; display: flex; flex-direction: column; min-height: 0; gap: 0; padding: 0;
  overflow: hidden; position: relative;
}

/* Island map fills body */
.strategic-map-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  width: 100%;
  background:
    radial-gradient(ellipse at 50% 42%, #143848 0%, #0a1c28 50%, #050e14 100%);
}
.strategic-map-svg {
  width: 100%;
  height: 100%;
  max-height: 100%;
  display: block;
  touch-action: manipulation;
  flex: 1 1 auto;
  /* Match the portrait-mobile viewBox aspect so it fills the wrapper without letterboxing */
  object-fit: contain;
}
.strategic-map-svg .st-army-hit,
.strategic-map-svg .st-army-hit-box {
  pointer-events: all;
}
.st-ocean { cursor: default; }
.st-island-base { pointer-events: none; }
.strategic-region {
  cursor: pointer;
  transition: filter .15s ease, stroke-width .15s ease, opacity .15s ease;
  outline: none;
}
.strategic-region:focus-visible {
  filter: drop-shadow(0 0 3px #fff) drop-shadow(0 0 6px #f4cf55);
  stroke: #fff !important;
  stroke-width: 2.4px;
}
.strategic-region.move-target {
  stroke: #f4cf55 !important;
  stroke-width: 2.8px !important;
  filter: drop-shadow(0 0 5px rgba(244,207,85,.9));
  fill: rgba(244,207,85,.22) !important;
  cursor: pointer;
}
.strategic-region.selected {
  stroke: #ffffff !important;
  stroke-width: 2.5px !important;
  filter: drop-shadow(0 0 5px rgba(255,255,255,.65));
}
.strategic-region.move-blocked {
  opacity: 0.55;
}
.strategic-region-hit { cursor: pointer; }
.st-capture-flash {
  animation: st-capture 0.5s ease-out;
}
.st-battle-flash {
  animation: st-battle 0.55s ease-out;
}
@keyframes st-capture {
  0% { filter: brightness(1); }
  40% { filter: brightness(1.7) drop-shadow(0 0 8px #f4cf55); }
  100% { filter: brightness(1); }
}
@keyframes st-battle {
  0%, 100% { filter: brightness(1); }
  30% { filter: brightness(1.4) drop-shadow(0 0 6px #ff6060); }
  60% { filter: brightness(0.9); }
}
.st-front-line { opacity: 0.95; }
.st-capital-threat { animation: st-threat-pulse 1.6s ease-in-out infinite; }
@keyframes st-threat-pulse {
  0%, 100% { opacity: 0.75; }
  50% { opacity: 1; }
}

/* Army battle tokens */
.strategic-army {
  cursor: pointer;
  outline: none;
}
.strategic-army .st-army-count {
  font-size: 9.5px; font-weight: bold; fill: #f8f0dc;
  pointer-events: none;
  paint-order: stroke;
  stroke: rgba(0,0,0,.75);
  stroke-width: 2.2px;
}
.strategic-army.selected .st-army-disc,
.strategic-army.selected .st-army-banner {
  stroke: #fff !important;
  stroke-width: 2.2px;
  filter: drop-shadow(0 0 4px #f4cf55);
}
.strategic-army.selected {
  filter: drop-shadow(0 0 5px rgba(244,207,85,.85));
}
.strategic-army.enemy .st-army-disc {
  stroke-dasharray: 3 2;
}
.strategic-army.acted { opacity: 0.82; }
.strategic-army.acted .st-army-banner { opacity: 0.85; }
.strategic-army.st-army-moving { pointer-events: none; }
.strategic-army:focus-visible .st-army-disc {
  stroke: #fff !important;
  filter: drop-shadow(0 0 5px #f4cf55);
}
.st-hp-bg { fill: rgba(0,0,0,.55); }
.st-hp-fg { /* fill set inline by hp ratio */ }
.st-battle-army .st-army-disc,
.st-battle-army .st-army-banner {
  stroke: #ff6060 !important;
  filter: drop-shadow(0 0 5px #ff4040);
}

/* Move path */
.st-move-path {
  stroke: #f4cf55;
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 6 4;
  pointer-events: none;
  filter: drop-shadow(0 0 2px rgba(244,207,85,.65));
  marker-end: none;
}
.st-move-path.preview { opacity: 0.9; }
.st-move-path.active {
  stroke-dasharray: none;
  stroke-width: 2.8;
  opacity: 1;
}

/* Bottom sheet */
.strategic-panel {
  flex-shrink: 0;
  max-height: 32%;
  overflow: auto;
  background: linear-gradient(180deg, rgba(28,32,40,.97) 0%, rgba(18,22,28,.98) 100%);
  color: #f0e8d4;
  border-top: 1.5px solid rgba(201,162,39,.55);
  border-radius: 14px 14px 0 0;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0));
  box-shadow: 0 -6px 20px rgba(0,0,0,.45);
}
.strategic-panel--hint {
  max-height: 7%;
  min-height: 36px;
  padding: 6px 12px calc(6px + env(safe-area-inset-bottom, 0));
  background: linear-gradient(180deg, rgba(22,28,36,.94) 0%, rgba(14,18,24,.96) 100%);
  border-top: 1px solid rgba(201,162,39,.3);
}
.strategic-panel .panel-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-bottom: 4px;
}
.strategic-panel h3 { font-size: 14.5px; margin: 0; color: #f4ead0; }
.strategic-panel .panel-close {
  min-width: 44px; min-height: 44px; border: none; background: transparent;
  font-size: 22px; line-height: 1; color: #c8b88a; cursor: pointer; border-radius: 8px;
}
.strategic-panel .panel-close:focus-visible { outline: 2px solid #c9a227; }
.strategic-panel .row { font-size: 12.5px; margin: 2px 0; color: rgba(240,232,212,.9); }
.strategic-panel .hint {
  opacity: .78; margin: 0; text-align: center; font-size: 12.5px;
  color: rgba(230,220,190,.8);
}
.strategic-panel .unit-line { font-size: 12px; opacity: .9; }
.strategic-panel .btn-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.strategic-panel button:not(.panel-close) {
  min-height: 44px; padding: 8px 12px; border-radius: 10px;
  border: 1px solid #8a6d14; background: linear-gradient(#d9b544, #c9a227);
  color: #2b2416; font-weight: bold; font-size: 13px;
}
.strategic-panel button:disabled { opacity: .45; }
.strategic-panel .panel-stat-row {
  display: flex; flex-wrap: wrap; gap: 8px 14px; margin: 4px 0 6px;
  font-size: 12px;
}
.strategic-panel .panel-stat {
  display: inline-flex; align-items: center; gap: 4px;
  background: rgba(242,234,216,.06);
  border: 1px solid rgba(201,162,39,.22);
  border-radius: 8px; padding: 3px 8px;
}

.strategic-log { display: none; }
.strategic-log-inline {
  position: absolute; left: 8px; right: 8px; bottom: 4px;
  font-size: 10.5px; opacity: .7; max-height: 28px; overflow: auto;
  pointer-events: none; text-align: center;
  color: rgba(240,232,212,.75);
}

.strategic-busy-banner {
  position: absolute; left: 50%; top: 42%; transform: translate(-50%,-50%);
  background: rgba(18,22,28,.94); border: 1px solid #c9a227; border-radius: 12px;
  padding: 14px 18px; z-index: 10; font-size: 14px;
  pointer-events: none;
}

/* Landscape */
@media (orientation: landscape) and (max-height: 500px) {
  .strategic-root { flex-direction: row; flex-wrap: wrap; }
  .strategic-hud {
    width: 100%; max-height: none; min-height: 36px;
    padding: 3px 8px;
  }
  .strategic-body {
    flex-direction: row; flex: 1; width: 100%; min-height: 0;
  }
  .strategic-map-wrap { flex: 1 1 64%; }
  .strategic-panel {
    width: min(280px, 36%); max-height: 100%;
    border-radius: 0; border-top: none; border-left: 1.5px solid rgba(201,162,39,.45);
    padding-bottom: 10px;
  }
  .strategic-panel--hint { max-height: 100%; }
}

@media (min-width: 900px) {
  .strategic-body { flex-direction: row; }
  .strategic-map-wrap { flex: 1 1 auto; }
  .strategic-panel {
    width: 300px; max-height: 100%;
    border-radius: 0; border-top: none; border-left: 1.5px solid rgba(201,162,39,.45);
  }
  .strategic-hud { padding: 6px 14px; }
  .strategic-hud .hud-main { font-size: 13.5px; }
}

@media (prefers-reduced-motion: reduce) {
  .strategic-region { transition: none; }
  .st-capture-flash, .st-battle-flash, .st-capital-threat { animation: none; }
}
`;
  document.head.appendChild(style);
}

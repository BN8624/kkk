// 한 줄 목적: 전략 섬 지도·HUD·패널 전용 CSS를 한 번만 주입한다
let injected = false;

export function injectStrategicStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = `
.strategic-root {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  background: #0c141c;
  color: #f2ead8; overflow: hidden; z-index: 5;
  pointer-events: auto;
  padding: env(safe-area-inset-top, 0) env(safe-area-inset-right, 0) env(safe-area-inset-bottom, 0) env(safe-area-inset-left, 0);
}
.strategic-root[hidden] { display: none !important; }

/* Compact top HUD */
.strategic-hud {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 8px;
  padding: 6px 10px;
  align-items: center;
  background: rgba(16,20,28,.94);
  border-bottom: 1px solid rgba(201,162,39,.55);
  flex-shrink: 0;
  max-height: 18%;
}
.strategic-hud .chip {
  background: rgba(242,234,216,.08);
  border: 1px solid rgba(201,162,39,.35);
  border-radius: 8px; padding: 4px 8px; font-size: 12px; min-height: 28px;
  display: flex; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.strategic-hud .actions {
  grid-column: 1 / -1;
  display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap;
}
.strategic-hud button {
  min-height: 40px; min-width: 44px; padding: 6px 12px; border-radius: 10px;
  border: 1px solid #c9a227; background: linear-gradient(#d9b544, #c9a227);
  color: #2b2416; font-weight: bold; font-size: 12.5px;
}
.strategic-hud button.secondary {
  background: rgba(242,234,216,.12); color: #f2ead8;
}
.strategic-hud button:disabled { opacity: .45; }

.strategic-body {
  flex: 1; display: flex; flex-direction: column; min-height: 0; gap: 0; padding: 0;
  overflow: hidden;
}

/* Island map — fills remaining space, no page scroll */
.strategic-map-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(ellipse at 50% 45%, #1a3a4a 0%, #0c1822 55%, #081018 100%);
}
.strategic-map-svg {
  width: 100%;
  height: 100%;
  max-height: 100%;
  display: block;
  touch-action: manipulation;
}
.st-ocean { fill: #0a2030; cursor: default; }
.st-island-base { pointer-events: none; }
.strategic-region {
  cursor: pointer;
  transition: filter .15s ease, stroke-width .15s ease;
  outline: none;
}
.strategic-region:focus-visible {
  filter: drop-shadow(0 0 3px #fff) drop-shadow(0 0 6px #f4cf55);
  stroke: #fff !important;
  stroke-width: 2.4px;
}
.strategic-region.owner-azure { /* pattern fill set inline */ }
.strategic-region.owner-crimson {}
.strategic-region.owner-violet {}
.strategic-region.owner-neutral {}
.strategic-region.move-target {
  stroke: #f4cf55 !important;
  stroke-width: 2.8px !important;
  filter: drop-shadow(0 0 4px rgba(244,207,85,.85));
  cursor: pointer;
}
.strategic-region.selected {
  stroke: #ffffff !important;
  stroke-width: 2.6px !important;
  filter: drop-shadow(0 0 5px rgba(255,255,255,.7));
}
.strategic-region.move-blocked {
  opacity: 0.72;
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

/* Army tokens */
.strategic-army {
  cursor: pointer;
  outline: none;
}
.strategic-army .st-army-count {
  font-size: 9px; font-weight: bold; fill: #f2ead8;
  pointer-events: none;
  paint-order: stroke;
  stroke: rgba(0,0,0,.7);
  stroke-width: 2px;
}
.strategic-army.selected .st-army-disc {
  stroke: #fff !important;
  stroke-width: 2.8px;
  filter: drop-shadow(0 0 4px #f4cf55);
}
.strategic-army.enemy .st-army-disc {
  stroke-dasharray: 3 2;
}
.strategic-army.acted { opacity: 0.78; }
.strategic-army.st-army-moving { pointer-events: none; }
.strategic-army:focus-visible .st-army-disc {
  stroke: #fff !important;
  filter: drop-shadow(0 0 5px #f4cf55);
}
.st-hp-bg { fill: rgba(0,0,0,.55); }
.st-hp-fg { fill: #e05454; }
.st-battle-army .st-army-disc {
  stroke: #ff6060 !important;
  filter: drop-shadow(0 0 5px #ff4040);
}

/* Move path */
.st-move-path {
  stroke: #f4cf55;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 6 4;
  pointer-events: none;
  filter: drop-shadow(0 0 2px rgba(244,207,85,.6));
}
.st-move-path.preview { opacity: 0.85; }
.st-move-path.active {
  stroke-dasharray: none;
  stroke-width: 2.6;
  opacity: 1;
}

/* Bottom panel */
.strategic-panel {
  flex-shrink: 0;
  max-height: 34%;
  overflow: auto;
  background: rgba(242,234,216,.97);
  color: #2b2416;
  border-top: 1.5px solid #8a6d14;
  border-radius: 14px 14px 0 0;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0));
  box-shadow: 0 -4px 16px rgba(0,0,0,.35);
}
.strategic-panel--hint {
  max-height: 12%;
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0));
}
.strategic-panel .panel-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-bottom: 4px;
}
.strategic-panel h3 { font-size: 15px; margin: 0; }
.strategic-panel .panel-close {
  min-width: 44px; min-height: 44px; border: none; background: transparent;
  font-size: 22px; line-height: 1; color: #5a4a20; cursor: pointer; border-radius: 8px;
}
.strategic-panel .panel-close:focus-visible { outline: 2px solid #c9a227; }
.strategic-panel .row { font-size: 12.5px; margin: 2px 0; }
.strategic-panel .hint { opacity: .85; margin: 0; text-align: center; }
.strategic-panel .unit-line { font-size: 12px; opacity: .9; }
.strategic-panel .btn-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.strategic-panel button:not(.panel-close) {
  min-height: 44px; padding: 8px 12px; border-radius: 10px;
  border: 1px solid #8a6d14; background: linear-gradient(#d9b544, #c9a227);
  color: #2b2416; font-weight: bold; font-size: 13px;
}
.strategic-panel button:disabled { opacity: .45; }

.strategic-log {
  display: none; /* log folded into panel area economy; toast still used */
}
.strategic-log-inline {
  font-size: 11px; opacity: .75; margin-top: 6px; max-height: 36px; overflow: auto;
}

.strategic-busy-banner {
  position: absolute; left: 50%; top: 42%; transform: translate(-50%,-50%);
  background: rgba(29,26,20,.92); border: 1px solid #c9a227; border-radius: 12px;
  padding: 14px 18px; z-index: 10; font-size: 14px;
  pointer-events: none;
}

/* Landscape / wider */
@media (orientation: landscape) and (max-height: 500px) {
  .strategic-root { flex-direction: row; flex-wrap: wrap; }
  .strategic-hud {
    width: 100%; max-height: none;
    grid-template-columns: repeat(4, minmax(0,1fr));
    padding: 4px 8px;
  }
  .strategic-hud .actions { grid-column: auto; }
  .strategic-body {
    flex-direction: row; flex: 1; width: 100%; min-height: 0;
  }
  .strategic-map-wrap { flex: 1 1 62%; }
  .strategic-panel {
    width: min(280px, 38%); max-height: 100%;
    border-radius: 0; border-top: none; border-left: 1.5px solid #8a6d14;
    padding-bottom: 10px;
  }
}

@media (min-width: 900px) {
  .strategic-body { flex-direction: row; }
  .strategic-map-wrap { flex: 1 1 auto; }
  .strategic-panel {
    width: 300px; max-height: 100%;
    border-radius: 0; border-top: none; border-left: 1.5px solid #8a6d14;
  }
  .strategic-hud {
    grid-template-columns: repeat(4, minmax(0, auto)) 1fr;
  }
  .strategic-hud .actions { grid-column: auto; margin-left: auto; }
}

@media (prefers-reduced-motion: reduce) {
  .strategic-region { transition: none; }
  .st-capture-flash, .st-battle-flash { animation: none; }
}
`;
  document.head.appendChild(style);
}

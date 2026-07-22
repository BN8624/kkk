// 한 줄 목적: 전략 지도·HUD 전용 CSS를 한 번만 주입한다
let injected = false;

export function injectStrategicStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = `
.strategic-root {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  background: linear-gradient(180deg, #1a2438 0%, #121a28 100%);
  color: #f2ead8; overflow: hidden; z-index: 5;
  /* #hud 가 pointer-events:none 이므로 전략 루트에서 입력 허용 */
  pointer-events: auto;
  padding: env(safe-area-inset-top, 0) env(safe-area-inset-right, 0) env(safe-area-inset-bottom, 0) env(safe-area-inset-left, 0);
}
.strategic-root[hidden] { display: none !important; }
.strategic-hud {
  display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px; align-items: center;
  background: rgba(29,26,20,.9); border-bottom: 1px solid #c9a227; flex-shrink: 0;
}
.strategic-hud .chip {
  background: rgba(242,234,216,.1); border: 1px solid rgba(201,162,39,.5);
  border-radius: 8px; padding: 6px 8px; font-size: 12px; min-height: 32px;
  display: flex; align-items: center;
}
.strategic-hud .actions { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
.strategic-hud button {
  min-height: 44px; min-width: 44px; padding: 8px 12px; border-radius: 10px;
  border: 1px solid #c9a227; background: linear-gradient(#d9b544, #c9a227);
  color: #2b2416; font-weight: bold; font-size: 13px;
}
.strategic-hud button.secondary {
  background: rgba(242,234,216,.12); color: #f2ead8;
}
.strategic-hud button:disabled { opacity: .45; }
.strategic-body {
  flex: 1; display: flex; flex-direction: column; min-height: 0; gap: 8px; padding: 8px;
}
.strategic-map-wrap {
  flex: 1; min-height: 0; overflow: auto; border: 1px solid rgba(201,162,39,.4);
  border-radius: 12px; background: rgba(0,0,0,.25); position: relative;
}
.strategic-map {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: repeat(3, minmax(72px, 1fr));
  gap: 6px; padding: 8px; width: 100%; height: 100%; min-height: 240px;
  position: relative;
}
.strategic-links {
  position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0;
}
.strategic-region {
  position: relative; z-index: 1; min-height: 72px; min-width: 0;
  border-radius: 10px; border: 2px solid rgba(242,234,216,.35);
  padding: 6px; display: flex; flex-direction: column; gap: 2px;
  background: rgba(40,48,64,.92); text-align: left; color: #f2ead8;
  font-size: 11px; line-height: 1.25; cursor: pointer; touch-action: manipulation;
}
.strategic-region .name { font-weight: bold; font-size: 12px; }
.strategic-region .meta { opacity: .9; }
.strategic-region.owner-azure { border-color: #4aa3ff; box-shadow: inset 0 0 0 1px rgba(74,163,255,.35); }
.strategic-region.owner-crimson { border-color: #e05454; box-shadow: inset 0 0 0 1px rgba(224,84,84,.35); }
.strategic-region.owner-violet { border-color: #b07cff; box-shadow: inset 0 0 0 1px rgba(176,124,255,.35); }
.strategic-region.owner-neutral { border-color: #8a8578; }
.strategic-region.move-target {
  outline: 3px solid #f4cf55; outline-offset: 1px; background: rgba(244,207,85,.18);
}
.strategic-region.selected-army {
  box-shadow: 0 0 0 2px #f4cf55, inset 0 0 0 1px rgba(244,207,85,.4);
}
.strategic-faction-mark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 4px; font-size: 10px; font-weight: bold;
  background: rgba(0,0,0,.35); flex-shrink: 0;
}
.strategic-faction-mark.azure { color: #7ec8ff; }
.strategic-faction-mark.crimson { color: #ff8a8a; }
.strategic-faction-mark.violet { color: #d0a8ff; }
.strategic-faction-mark.neutral { color: #cfc8b8; }
.strategic-panel {
  flex-shrink: 0; max-height: 42%; overflow: auto;
  background: rgba(242,234,216,.95); color: #2b2416;
  border: 1.5px solid #8a6d14; border-radius: 12px; padding: 10px 12px;
}
.strategic-panel h3 { font-size: 15px; margin-bottom: 4px; }
.strategic-panel .row { font-size: 12.5px; margin: 2px 0; }
.strategic-panel .unit-line { font-size: 12px; opacity: .9; }
.strategic-panel .btn-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.strategic-panel button {
  min-height: 44px; padding: 8px 12px; border-radius: 10px;
  border: 1px solid #8a6d14; background: linear-gradient(#d9b544, #c9a227);
  color: #2b2416; font-weight: bold; font-size: 13px;
}
.strategic-panel button.secondary { background: #e8dfc8; }
.strategic-panel button:disabled { opacity: .45; }
.strategic-log {
  font-size: 11.5px; opacity: .85; margin-top: 6px; max-height: 48px; overflow: auto;
}
.strategic-busy-banner {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
  background: rgba(29,26,20,.92); border: 1px solid #c9a227; border-radius: 12px;
  padding: 14px 18px; z-index: 10; font-size: 14px;
}
@media (max-width: 420px) {
  .strategic-region { font-size: 10px; min-height: 64px; padding: 4px; }
  .strategic-region .name { font-size: 11px; }
  .strategic-map { gap: 4px; padding: 6px; }
}
`;
  document.head.appendChild(style);
}

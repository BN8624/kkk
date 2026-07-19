// 한 줄 목적: HUD·오버레이 화면 공용 CSS를 한 번만 주입한다(고급 보드게임 스타일 유지)
let injected = false;

export function injectSharedStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = `
#hud * { box-sizing: border-box; margin: 0; font-family: Georgia, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; }
#hud button { cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.hud-top {
  position: absolute; left: 0; right: 0; top: 0;
  padding: calc(env(safe-area-inset-top, 0px) + 8px) 10px 8px;
  display: flex; align-items: center; gap: 8px; justify-content: space-between;
  pointer-events: none;
}
.hud-chip {
  background: rgba(29, 26, 20, 0.82); color: #f2ead8;
  border: 1px solid #c9a227; border-radius: 10px;
  padding: 6px 10px; font-size: 14px; line-height: 1.2;
  display: flex; align-items: center; gap: 6px; pointer-events: auto;
  white-space: nowrap;
}
.hud-chip svg { width: 16px; height: 16px; display: block; }
.hud-scores { display: flex; gap: 5px; }
.score-chip { display: flex; align-items: center; gap: 4px; padding: 5px 7px; border-radius: 9px;
  border: 1px solid rgba(242,234,216,.35); font-size: 13px; color: #f2ead8; }
.score-chip .crest { width: 17px; height: 17px; border-radius: 5px; display: flex; align-items: center; justify-content: center; }
.score-chip .crest svg { width: 12px; height: 12px; }
.icon-btn {
  width: 42px; height: 42px; border-radius: 12px; border: 1px solid #c9a227;
  background: rgba(29, 26, 20, 0.82); color: #e8d9a0;
  display: flex; align-items: center; justify-content: center; pointer-events: auto;
}
.icon-btn svg { width: 22px; height: 22px; }
.zoom-col {
  position: absolute; right: 10px; top: 50%; transform: translateY(-70%);
  display: flex; flex-direction: column; gap: 8px; pointer-events: none;
}
.zoom-col .icon-btn { font-size: 24px; font-weight: bold; }
.ai-chip {
  position: absolute; top: calc(env(safe-area-inset-top, 0px) + 58px); left: 50%;
  transform: translateX(-50%);
  background: rgba(29,26,20,.88); color: #f2ead8; border: 1px solid #c9a227;
  padding: 7px 14px; border-radius: 20px; font-size: 14px; display: none;
  pointer-events: none;
}
.ai-chip.show { display: block; }
.hud-bottom {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 8px 10px calc(env(safe-area-inset-bottom, 0px) + 10px);
  display: flex; align-items: flex-end; gap: 10px; pointer-events: none;
}
.unit-panel {
  flex: 1; background: rgba(242, 234, 216, 0.95); border: 1.5px solid #8a6d14;
  border-radius: 14px; padding: 10px 12px; color: #2b2416; display: none;
  pointer-events: auto; box-shadow: 0 4px 14px rgba(0,0,0,.35);
}
.unit-panel.show { display: block; }
.unit-panel h3 { font-size: 16px; display: flex; align-items: center; gap: 7px; }
.unit-panel .dot { width: 13px; height: 13px; border-radius: 4px; display: inline-block; }
.unit-panel .stats { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 5px; font-size: 13px; color: #4f4636; }
.unit-panel .hint { margin-top: 6px; font-size: 13px; color: #6b5b2a; font-weight: bold; }
.end-turn {
  min-width: 96px; height: 56px; border-radius: 16px; border: 2px solid #8a6d14;
  background: linear-gradient(#d9b544, #c9a227); color: #2b2416;
  font-size: 17px; font-weight: bold; pointer-events: auto;
  box-shadow: 0 4px 12px rgba(0,0,0,.4);
}
.end-turn:disabled { filter: grayscale(.7) brightness(.75); }
.sheet {
  position: absolute; left: 0; right: 0; bottom: 0;
  background: #f2ead8; border-top: 2px solid #8a6d14; border-radius: 18px 18px 0 0;
  padding: 14px 14px calc(env(safe-area-inset-bottom, 0px) + 14px);
  transform: translateY(110%); transition: transform .22s ease; pointer-events: auto;
  box-shadow: 0 -6px 20px rgba(0,0,0,.4); color: #2b2416;
}
.sheet.show { transform: translateY(0); }
.sheet h3 { font-size: 17px; margin-bottom: 4px; display:flex; justify-content: space-between; align-items:center; }
.sheet .gold { font-size: 14px; display: flex; align-items: center; gap: 5px; }
.sheet .gold svg { width: 15px; height: 15px; }
.prod-cards { display: flex; gap: 8px; margin-top: 10px; }
.prod-card {
  flex: 1; border: 1.5px solid #8a6d14; border-radius: 12px; background: #faf5e8;
  padding: 10px 6px; text-align: center; font-size: 13px; color: #2b2416;
}
.prod-card b { font-size: 15px; display: block; }
.prod-card .cost { color: #8a6d14; font-weight: bold; margin: 3px 0; display: flex; align-items: center; justify-content: center; gap: 3px; }
.prod-card .cost svg { width: 13px; height: 13px; }
.prod-card .mini { color: #6b6250; font-size: 11.5px; line-height: 1.5; }
.prod-card:disabled { opacity: .45; }
.sheet .close-btn {
  margin-top: 10px; width: 100%; height: 44px; border-radius: 12px;
  border: 1.5px solid #8a6d14; background: #e5dbc2; font-size: 15px; color: #2b2416;
}
.overlay {
  position: absolute; inset: 0; background: #151b2b;
  display: none; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; pointer-events: auto; padding: 24px;
  padding-top: calc(env(safe-area-inset-top, 0px) + 24px);
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 24px);
  overflow-y: auto;
}
.overlay.show { display: flex; }
.overlay .crown { width: 84px; }
.overlay h1 { color: #f2ead8; font-size: 34px; letter-spacing: 2px; text-align: center; }
.overlay .subtitle { color: #a9b4cc; font-size: 15px; text-align: center; line-height: 1.6; }
.overlay .big-btn {
  width: min(300px, 82vw); height: 56px; border-radius: 16px; font-size: 18px; font-weight: bold;
  border: 2px solid #8a6d14; background: linear-gradient(#d9b544, #c9a227); color: #2b2416;
}
.overlay .sub-btn {
  width: min(300px, 82vw); height: 52px; border-radius: 16px; font-size: 16px;
  border: 1.5px solid #6b7894; background: rgba(242,234,216,.08); color: #d8deeb;
}
.overlay .result-word { font-size: 44px; }
.overlay .result-word.win { color: #e8c95a; }
.overlay .result-word.lose { color: #b95c66; }
.result-table {
  background: rgba(242,234,216,.06); border: 1px solid rgba(201,162,39,.5);
  border-radius: 14px; padding: 12px 20px; min-width: min(300px, 82vw);
}
.result-table div { display: flex; justify-content: space-between; gap: 24px; color: #c6cede;
  font-size: 15px; padding: 4px 0; }
.result-table div b { color: #f2ead8; }
.tutorial-bar {
  position: absolute; left: 50%; transform: translateX(-50%);
  top: calc(env(safe-area-inset-top, 0px) + 58px);
  width: min(430px, calc(100vw - 24px));
  background: rgba(242, 234, 216, 0.97); border: 1.5px solid #8a6d14; border-radius: 14px;
  padding: 10px 14px; color: #2b2416; display: none; pointer-events: auto;
  box-shadow: 0 4px 14px rgba(0,0,0,.4);
}
.tutorial-bar.show { display: block; }
.tutorial-bar .step-label { font-size: 12px; color: #8a6d14; font-weight: bold; }
.tutorial-bar p { font-size: 15px; margin-top: 2px; line-height: 1.45; }
.tutorial-bar button {
  margin-top: 8px; height: 40px; padding: 0 18px; border-radius: 10px;
  border: 1.5px solid #8a6d14; background: #c9a227; font-size: 14px; font-weight: bold; color: #2b2416;
}
.toast {
  position: absolute; left: 50%; bottom: calc(env(safe-area-inset-bottom, 0px) + 96px);
  transform: translateX(-50%);
  background: rgba(29,26,20,.9); color: #f2ead8; border: 1px solid #c9a227;
  padding: 9px 16px; border-radius: 20px; font-size: 14px; opacity: 0;
  transition: opacity .25s; pointer-events: none; white-space: nowrap;
}
.toast.show { opacity: 1; }
.fac-cards { display: flex; gap: 10px; width: min(430px, 92vw); }
.fac-card {
  flex: 1; border: 2px solid rgba(242,234,216,.25); border-radius: 14px;
  background: rgba(242,234,216,.05); color: #d8deeb; padding: 12px 8px;
  display: flex; flex-direction: column; align-items: center; gap: 6px; font-size: 13px;
}
.fac-card .crest { width: 40px; height: 40px; border-radius: 10px; display:flex; align-items:center; justify-content:center; }
.fac-card .crest svg { width: 26px; height: 26px; }
.fac-card b { font-size: 15px; color: #f2ead8; }
.fac-card.selected { border-color: #c9a227; background: rgba(201,162,39,.14); }
.fac-desc {
  width: min(430px, 92vw); min-height: 66px; background: rgba(242,234,216,.06);
  border: 1px solid rgba(201,162,39,.5); border-radius: 12px; padding: 10px 14px;
  color: #c6cede; font-size: 13.5px; line-height: 1.55;
}
.fac-desc b { color: #f2ead8; }
.opt-row { display: flex; gap: 8px; width: min(430px, 92vw); }
.opt-chip {
  flex: 1; height: 40px; border-radius: 11px; border: 1.5px solid rgba(242,234,216,.25);
  background: rgba(242,234,216,.05); color: #d8deeb; font-size: 14px;
}
.opt-chip.selected { border-color: #c9a227; background: rgba(201,162,39,.14); color: #f2ead8; }
.opt-desc { width: min(430px, 92vw); color: #a9b4cc; font-size: 12.5px; line-height: 1.45; min-height: 18px; }
.rp-list { width: min(430px, 92vw); display: flex; flex-direction: column; gap: 10px; max-height: 52vh; overflow-y: auto; }
.rp-item {
  display: flex; gap: 8px; align-items: stretch;
  background: rgba(242,234,216,.06); border: 1px solid rgba(201,162,39,.5);
  border-radius: 12px; padding: 8px;
}
.rp-main { flex: 1; text-align: left; background: none; border: none; color: #d8deeb;
  display: flex; flex-direction: column; gap: 3px; padding: 2px 4px; }
.rp-title { font-size: 15px; color: #f2ead8; display: flex; gap: 8px; align-items: center; }
.rp-outcome { font-size: 12.5px; border: 1px solid rgba(242,234,216,.35); border-radius: 8px; padding: 1px 7px; }
.rp-outcome.win { color: #e8c95a; border-color: #e8c95a; }
.rp-outcome.lose { color: #b95c66; border-color: #b95c66; }
.rp-sub { font-size: 12px; color: #a9b4cc; }
.rp-compat { color: #7fae7a; }
.rp-compat.warn { color: #d9a441; }
.rp-actions { display: flex; flex-direction: column; gap: 4px; justify-content: center; }
.rp-actions button {
  width: 34px; height: 26px; border-radius: 8px; font-size: 14px;
  border: 1px solid #6b7894; background: rgba(242,234,216,.08); color: #d8deeb;
}
.rp-topbar {
  position: absolute; left: 0; right: 0; top: 0;
  padding: calc(env(safe-area-inset-top, 0px) + 8px) 10px 8px;
  display: flex; align-items: center; gap: 8px; pointer-events: none;
}
.rp-topbar .hud-chip { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; }
.rp-exit {
  height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid #c9a227;
  background: rgba(29,26,20,.82); color: #e8d9a0; font-size: 14px; pointer-events: auto;
}
.rp-bar {
  position: absolute; left: 50%; transform: translateX(-50%); bottom: 0;
  width: min(560px, 100vw);
  padding: 8px 10px calc(env(safe-area-inset-bottom, 0px) + 10px);
  display: flex; flex-direction: column; gap: 7px; pointer-events: none;
}
.rp-desc {
  min-height: 20px; text-align: center; font-size: 13.5px; color: #f2ead8;
  background: rgba(29,26,20,.82); border: 1px solid rgba(201,162,39,.6);
  border-radius: 10px; padding: 4px 10px; pointer-events: none;
}
.rp-desc:empty { visibility: hidden; }
.rp-desc.final { color: #e8c95a; font-weight: bold; }
.rp-controls { display: flex; gap: 6px; justify-content: center; }
.rp-controls button {
  min-width: 44px; height: 44px; border-radius: 12px; border: 1px solid #c9a227;
  background: rgba(29,26,20,.85); color: #e8d9a0; font-size: 15px; pointer-events: auto;
}
.rp-controls .rp-play { min-width: 54px; background: linear-gradient(#d9b544, #c9a227); color: #2b2416; font-weight: bold; }
.ed-topbar {
  position: absolute; left: 0; right: 0; top: 0;
  padding: calc(env(safe-area-inset-top, 0px) + 8px) 10px 8px;
  display: flex; align-items: center; gap: 6px; pointer-events: none;
}
.ed-topbar .rp-exit { pointer-events: auto; }
.ed-topbar .hud-chip { max-width: 34vw; overflow: hidden; text-overflow: ellipsis; }
.ed-topbar button:disabled { opacity: .4; }
.ed-palette {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 6px 8px calc(env(safe-area-inset-bottom, 0px) + 8px);
  display: flex; flex-direction: column; gap: 6px; pointer-events: none;
}
.ed-tool-row { display: flex; gap: 6px; overflow-x: auto; pointer-events: auto; padding-bottom: 2px; }
.ed-sub-row { align-items: center; }
.ed-sub-label { color: #a9b4cc; font-size: 12.5px; flex: none; align-self: center; }
.ed-chip {
  flex: none; height: 40px; padding: 0 13px; border-radius: 11px;
  border: 1px solid #6b7894; background: rgba(29,26,20,.85); color: #d8deeb; font-size: 14px;
}
.ed-chip.on { border-color: #c9a227; background: rgba(201,162,39,.25); color: #f2ead8; font-weight: bold; }
.ed-sheet { z-index: 5; max-height: 72vh; overflow-y: auto; }
.ed-menu-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 8px; }
.ed-menu-grid button {
  height: 46px; border-radius: 11px; border: 1.5px solid #8a6d14;
  background: #faf5e8; font-size: 14.5px; color: #2b2416;
}
.ed-field { display: flex; flex-direction: column; gap: 4px; font-size: 13.5px; color: #4f4636; margin-top: 8px; flex: 1; }
.ed-field input, .ed-field select, .ed-field textarea {
  border: 1.5px solid #8a6d14; border-radius: 9px; padding: 8px 10px; font-size: 15px;
  background: #faf5e8; color: #2b2416; width: 100%;
}
.ed-row { display: flex; gap: 8px; }
.ed-row .close-btn { flex: 1; }
.ed-hint { font-size: 12.5px; color: #6b6250; margin-top: 4px; line-height: 1.5; }
.ed-fac-row { display: flex; gap: 6px; align-items: center; margin-top: 8px; }
.ed-fac-row b { min-width: 74px; font-size: 14px; }
.ed-fac-row select, .ed-fac-row input {
  border: 1.5px solid #8a6d14; border-radius: 8px; padding: 6px; font-size: 13.5px; background: #faf5e8; color: #2b2416;
}
.ed-cond-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.ed-cond-list b { font-size: 13.5px; margin-top: 6px; color: #4f4636; }
.ed-cond {
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  border: 1px solid #c8b98e; border-radius: 9px; padding: 7px 10px; font-size: 13.5px; background: #faf5e8;
}
.ed-cond button { width: 28px; height: 28px; border-radius: 8px; border: 1px solid #8a6d14; background: #e5dbc2; }
.ed-add { height: 38px; border-radius: 9px; border: 1.5px dashed #8a6d14; background: none; font-size: 13.5px; color: #6b5b2a; }
.ed-issue { border-left: 3px solid #a33636; padding: 6px 9px; margin-top: 6px; font-size: 13px; background: #faf5e8; border-radius: 0 8px 8px 0; }
.ed-issue.warning { border-left-color: #c9a227; }
.ed-issue.info { border-left-color: #6b7894; }
.ed-issue .ed-repair { color: #6b5b2a; margin-top: 2px; font-size: 12.5px; }
.ed-issue-list { max-height: 44vh; overflow-y: auto; }
.ed-pick-banner {
  position: absolute; top: calc(env(safe-area-inset-top, 0px) + 58px); left: 50%; transform: translateX(-50%);
  background: rgba(201,162,39,.95); color: #2b2416; border-radius: 12px; padding: 8px 16px;
  font-size: 14px; font-weight: bold; pointer-events: auto; display: flex; gap: 10px; align-items: center;
}
.ed-pick-banner button { border: 1px solid #8a6d14; border-radius: 8px; background: #f2ead8; height: 30px; padding: 0 10px; }
.tp-bar { top: calc(env(safe-area-inset-top, 0px) + 100px); }
.tp-line { font-size: 13.5px; padding: 3px 2px; color: #2b2416; }
.cp-kingdom { font-size: 13.5px; margin-bottom: -6px; display: flex; gap: 8px; align-items: baseline; }
.cp-stars { color: #8a6d14; font-weight: bold; }
.cp-locked { opacity: .55; }
.cp-locked .rp-main { display: flex; flex-direction: column; align-items: flex-start; padding: 10px 12px; }
.cp-intro { max-width: min(320px, 84vw); line-height: 1.55; }
.cp-star-list { display: flex; flex-direction: column; gap: 4px; }
.cp-star-line { font-size: 13px; color: #4f4636; }
.ed-import-text {
  width: min(300px, 82vw); border: 1.5px solid #8a6d14; border-radius: 11px; padding: 9px 11px;
  font-size: 13px; font-family: ui-monospace, monospace; background: #faf5e8; color: #2b2416; resize: vertical;
}
@media (orientation: landscape) {
  .hud-bottom { max-width: 640px; left: 50%; transform: translateX(-50%); right: auto; width: 100%; }
  .sheet { max-width: 560px; left: 50%; transform: translate(-50%, 110%); border-radius: 18px 18px 0 0; }
  .sheet.show { transform: translate(-50%, 0); }
}
`;
  document.head.appendChild(style);
}

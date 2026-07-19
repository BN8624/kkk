// 한 줄 목적: 타이틀·일일 도전 안내·기록 화면을 렌더링한다(오버레이 호스트 기반)
import { CROWN_SVG, escapeHtml, resultTableHtml } from '../shared/dom';
import type { OverlayHost } from '../shared/overlay';

export interface TitleMenuHandlers {
  onContinue: () => void;
  onNewGame: () => void;
  onDaily: () => void;
  onCampaign: () => void;
  onScenarios: () => void;
  onEditor: () => void;
  onReplays: () => void;
  onRecords: () => void;
}

/** 타이틀 화면. 제작·보관함 메뉴는 준비된 단계에서만 표시한다(모바일 밀집 방지 계층화). */
export function showTitleScreen(
  overlay: OverlayHost,
  opts: {
    hasSave: boolean;
    saveSummary?: string;
    /** 아직 열리지 않은 메뉴는 렌더링하지 않는다(단계별 수직 완성 원칙) */
    features: { campaign: boolean; scenarios: boolean; editor: boolean; replays: boolean };
    handlers: TitleMenuHandlers;
  },
): void {
  const { hasSave, saveSummary, features, handlers } = opts;
  overlay.show(`
      <div class="crown">${CROWN_SVG}</div>
      <h1>세 왕관의 섬</h1>
      <p class="subtitle">하나의 섬, 세 개의 왕관.<br>가장 강한 왕국을 세우십시오.</p>
      ${
        hasSave
          ? `<button class="big-btn" id="btn-continue">이어하기</button>
             ${saveSummary ? `<p class="subtitle" style="margin-top:-8px;font-size:12.5px;">${escapeHtml(saveSummary)}</p>` : ''}`
          : ''
      }
      <button class="${hasSave ? 'sub-btn' : 'big-btn'}" id="btn-new">빠른 전투</button>
      ${features.campaign ? '<button class="sub-btn" id="btn-campaign">캠페인</button>' : ''}
      <button class="sub-btn" id="btn-daily">일일 도전</button>
      ${features.scenarios ? '<button class="sub-btn" id="btn-scenarios">커스텀 시나리오</button>' : ''}
      ${features.editor ? '<button class="sub-btn" id="btn-editor">시나리오 제작</button>' : ''}
      ${features.replays ? '<button class="sub-btn" id="btn-replays">리플레이</button>' : ''}
      <button class="sub-btn" id="btn-records">기록</button>`);
  overlay.bind({
    'btn-continue': handlers.onContinue,
    'btn-new': handlers.onNewGame,
    'btn-campaign': handlers.onCampaign,
    'btn-daily': handlers.onDaily,
    'btn-scenarios': handlers.onScenarios,
    'btn-editor': handlers.onEditor,
    'btn-replays': handlers.onReplays,
    'btn-records': handlers.onRecords,
  });
}

/** 일일 도전 안내 화면 */
export function showDailyScreen(
  overlay: OverlayHost,
  opts: {
    title: string;
    lines: { label: string; value: string }[];
    note: string;
    startLabel: string;
    onStart: () => void;
    onBack: () => void;
  },
): void {
  overlay.show(`
      <h1 style="font-size:24px;">일일 도전</h1>
      <p class="subtitle">${escapeHtml(opts.title)}</p>
      ${resultTableHtml(opts.lines)}
      <p class="subtitle" style="font-size:12.5px;">${escapeHtml(opts.note)}</p>
      <button class="big-btn" id="btn-daily-start">${escapeHtml(opts.startLabel)}</button>
      <button class="sub-btn" id="btn-back">뒤로</button>`);
  overlay.bind({ 'btn-daily-start': opts.onStart, 'btn-back': opts.onBack });
}

/** 로컬 기록 화면 */
export function showRecordsScreen(
  overlay: OverlayHost,
  lines: { label: string; value: string }[],
  onBack: () => void,
): void {
  overlay.show(`
      <h1 style="font-size:24px;">기록</h1>
      <p class="subtitle" style="font-size:12.5px;">이 브라우저에만 저장되는 로컬 기록입니다</p>
      ${resultTableHtml(lines)}
      <button class="sub-btn" id="btn-back">뒤로</button>`);
  overlay.bind({ 'btn-back': onBack });
}

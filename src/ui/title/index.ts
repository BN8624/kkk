// 한 줄 목적: 타이틀·일일 도전 안내·기록 화면을 렌더링한다(오버레이 호스트 기반)
import { t } from '../../i18n';
import { CROWN_SVG, escapeHtml, resultTableHtml } from '../shared/dom';
import type { OverlayHost } from '../shared/overlay';

export interface TitleMenuHandlers {
  onContinue: () => void;
  onNewGame: () => void;
  onDaily: () => void;
  onCampaign: () => void;
  onStrategicStart: () => void;
  onStrategicContinue: () => void;
  onStrategicNew: () => void;
  onScenarios: () => void;
  onEditor: () => void;
  onReplays: () => void;
  onAnalysis: () => void;
  onRecords: () => void;
  onDataManagement: () => void;
  onUpdate: () => void;
}

/** 타이틀 화면. 제작·보관함 메뉴는 준비된 단계에서만 표시한다(모바일 밀집 방지 계층화). */
export function showTitleScreen(
  overlay: OverlayHost,
  opts: {
    hasSave: boolean;
    saveSummary?: string;
    updateAvailable: boolean;
    /** 전략 저장·전투 임시 저장 존재 여부(빠른 전투 이어하기와 분리). */
    hasStrategicSave: boolean;
    hasStrategicBattleSave: boolean;
    /** 아직 열리지 않은 메뉴는 렌더링하지 않는다(단계별 수직 완성 원칙) */
    features: {
      campaign: boolean;
      scenarios: boolean;
      editor: boolean;
      replays: boolean;
      analysis: boolean;
      strategic: boolean;
    };
    handlers: TitleMenuHandlers;
  },
): void {
  const {
    hasSave,
    saveSummary,
    updateAvailable,
    hasStrategicSave,
    hasStrategicBattleSave,
    features,
    handlers,
  } = opts;
  const strategicBlock = features.strategic
    ? hasStrategicSave || hasStrategicBattleSave
      ? `<button class="sub-btn" id="btn-strategic-continue">${escapeHtml(
          hasStrategicBattleSave ? t('title.strategicBattleContinue') : t('title.strategicContinue'),
        )}</button>
         <button class="sub-btn" id="btn-strategic-new">${escapeHtml(t('title.strategicNew'))}</button>`
      : `<button class="sub-btn" id="btn-strategic-start">${escapeHtml(t('title.strategicStart'))}</button>`
    : '';
  overlay.show(`
      <div class="crown">${CROWN_SVG}</div>
      <h1>${escapeHtml(t('title.appName'))}</h1>
      <p class="subtitle">${escapeHtml(t('title.tagline')).replace('\n', '<br>')}</p>
      ${updateAvailable ? `<p class="subtitle">${escapeHtml(t('title.updateReady'))}</p><button class="big-btn" id="btn-update">${escapeHtml(t('title.updateNow'))}</button>` : ''}
      ${
        hasSave
          ? `<button class="big-btn" id="btn-continue">${escapeHtml(t('title.continue'))}</button>
             ${saveSummary ? `<p class="subtitle" style="margin-top:-8px;font-size:12.5px;">${escapeHtml(saveSummary)}</p>` : ''}`
          : ''
      }
      <button class="${hasSave ? 'sub-btn' : 'big-btn'}" id="btn-new">${escapeHtml(t('title.quickBattle'))}</button>
      ${strategicBlock}
      ${features.campaign ? `<button class="sub-btn" id="btn-campaign">${escapeHtml(t('title.campaign'))}</button>` : ''}
      <button class="sub-btn" id="btn-daily">${escapeHtml(t('title.daily'))}</button>
      ${features.scenarios ? `<button class="sub-btn" id="btn-scenarios">${escapeHtml(t('title.customScenarios'))}</button>` : ''}
      ${features.editor ? `<button class="sub-btn" id="btn-editor">${escapeHtml(t('title.editor'))}</button>` : ''}
      ${features.replays ? `<button class="sub-btn" id="btn-replays">${escapeHtml(t('title.replays'))}</button>` : ''}
      ${features.analysis ? `<button class="sub-btn" id="btn-analysis">${escapeHtml(t('title.analysis'))}</button>` : ''}
      <button class="sub-btn" id="btn-records">${escapeHtml(t('title.records'))}</button>
      <button class="sub-btn" id="btn-data">${escapeHtml(t('pause.dataManagement'))}</button>`);
  overlay.bind({
    'btn-continue': handlers.onContinue,
    'btn-new': handlers.onNewGame,
    'btn-strategic-start': handlers.onStrategicStart,
    'btn-strategic-continue': handlers.onStrategicContinue,
    'btn-strategic-new': handlers.onStrategicNew,
    'btn-campaign': handlers.onCampaign,
    'btn-daily': handlers.onDaily,
    'btn-scenarios': handlers.onScenarios,
    'btn-editor': handlers.onEditor,
    'btn-replays': handlers.onReplays,
    'btn-analysis': handlers.onAnalysis,
    'btn-records': handlers.onRecords,
    'btn-data': handlers.onDataManagement,
    'btn-update': handlers.onUpdate,
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
      <h1 style="font-size:24px;">${escapeHtml(t('daily.title'))}</h1>
      <p class="subtitle">${escapeHtml(opts.title)}</p>
      ${resultTableHtml(opts.lines)}
      <p class="subtitle" style="font-size:12.5px;">${escapeHtml(opts.note)}</p>
      <button class="big-btn" id="btn-daily-start">${escapeHtml(opts.startLabel)}</button>
      <button class="sub-btn" id="btn-back">${escapeHtml(t('common.back'))}</button>`);
  overlay.bind({ 'btn-daily-start': opts.onStart, 'btn-back': opts.onBack });
}

/** 로컬 기록 화면 */
export function showRecordsScreen(
  overlay: OverlayHost,
  lines: { label: string; value: string }[],
  onBack: () => void,
): void {
  overlay.show(`
      <h1 style="font-size:24px;">${escapeHtml(t('records.title'))}</h1>
      <p class="subtitle" style="font-size:12.5px;">${escapeHtml(t('records.localOnly'))}</p>
      ${resultTableHtml(lines)}
      <button class="sub-btn" id="btn-back">${escapeHtml(t('common.back'))}</button>`);
  overlay.bind({ 'btn-back': onBack });
}

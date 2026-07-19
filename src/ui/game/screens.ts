// 한 줄 목적: 플레이 중 오버레이 화면(일시정지·결과)을 렌더링한다
import { factionScore } from '../../core/game';
import type { GameState } from '../../core/types';
import { factionName, t } from '../../i18n';
import { CROWN_SVG, escapeHtml } from '../shared/dom';
import type { OverlayHost } from '../shared/overlay';

export function showPauseScreen(
  overlay: OverlayHost,
  opts: {
    soundOn: boolean;
    aiSpeedLabel: string;
    onResume: () => void;
    onToggleSound: () => boolean;
    onCycleAiSpeed: () => string;
    onReplayTutorial: () => void;
    onNewGame: () => void;
    onToTitle: () => void;
  },
): void {
  const soundLabel = (on: boolean) => t('pause.sound', { state: on ? t('pause.on') : t('pause.off') });
  const root = overlay.show(`
      <h1 style="font-size:26px;">${escapeHtml(t('pause.title'))}</h1>
      <button class="big-btn" id="btn-resume">${escapeHtml(t('pause.resume'))}</button>
      <button class="sub-btn" id="btn-sound">${escapeHtml(soundLabel(opts.soundOn))}</button>
      <button class="sub-btn" id="btn-ai-speed">${escapeHtml(t('pause.aiSpeed', { label: opts.aiSpeedLabel }))}</button>
      <button class="sub-btn" id="btn-tutorial">${escapeHtml(t('pause.tutorial'))}</button>
      <button class="sub-btn" id="btn-restart">${escapeHtml(t('pause.newGame'))}</button>
      <button class="sub-btn" id="btn-title">${escapeHtml(t('pause.toTitle'))}</button>`);
  root.querySelector('#btn-sound')!.addEventListener('click', (e) => {
    const on = opts.onToggleSound();
    (e.currentTarget as HTMLElement).textContent = soundLabel(on);
  });
  root.querySelector('#btn-ai-speed')!.addEventListener('click', (e) => {
    const label = opts.onCycleAiSpeed();
    (e.currentTarget as HTMLElement).textContent = t('pause.aiSpeed', { label });
  });
  overlay.bind({
    'btn-resume': opts.onResume,
    'btn-tutorial': opts.onReplayTutorial,
    'btn-restart': opts.onNewGame,
    'btn-title': opts.onToTitle,
  });
}

export interface ResultScreenOptions {
  scenarioName: string;
  difficultyName: string;
  modifierName?: string;
  prevBest: number | null;
  isNewBest: boolean;
  onShare: () => void;
  /** 같은 설정으로 새 게임(일일 도전은 같은 시드 재도전) */
  onReplaySameSetup: () => void;
  onChangeSetup: () => void;
  onDaily: () => void;
  onToTitle: () => void;
  /** 이 판의 리플레이 보기(저장 실패 시 undefined — 버튼 미표시) */
  onOpenReplay?: () => void;
}

export function showResultScreen(
  overlay: OverlayHost,
  state: GameState,
  opts: ResultScreenOptions,
): void {
  const me = state.config.humanFaction;
  const won = state.winner === me;
  const draw = state.winner === 'draw';
  const word = draw ? t('result.draw') : won ? t('result.win') : t('result.lose');
  const cls = won ? 'win' : 'lose';
  const stats = state.stats[me];
  const score = factionScore(state, me);
  const bestLine = opts.isNewBest
    ? `<div><span>${escapeHtml(t('result.bestScore'))}</span><b style="color:#e8c95a">${escapeHtml(t('result.newBest'))}</b></div>`
    : opts.prevBest !== null
      ? `<div><span>${escapeHtml(t('result.bestScore'))}</span><b>${escapeHtml(t('result.scorePoints', { n: opts.prevBest }))}</b></div>`
      : '';
  const againLabel = state.config.mode === 'daily' ? t('result.againDaily') : t('result.againSame');
  overlay.show(`
      ${won ? `<div class="crown">${CROWN_SVG}</div>` : ''}
      <h1 class="result-word ${cls}">${escapeHtml(word)}</h1>
      <p class="subtitle">${escapeHtml(factionName(me))} · ${escapeHtml(opts.scenarioName)} · ${escapeHtml(opts.difficultyName)}${
        state.config.mode === 'daily' ? ` · ${escapeHtml(t('result.dailyTag'))}` : ''
      }${opts.modifierName ? `<br>${escapeHtml(t('result.modifier', { name: opts.modifierName }))}` : ''}</p>
      <div class="result-table">
        <div><span>${escapeHtml(t('result.totalTurns'))}</span><b>${escapeHtml(t('result.turnCount', { n: Math.min(state.turn, state.maxTurns) }))}</b></div>
        <div><span>${escapeHtml(t('result.finalScore'))}</span><b>${escapeHtml(t('result.scorePoints', { n: score }))}</b></div>
        ${bestLine}
        <div><span>${escapeHtml(t('result.captured'))}</span><b>${escapeHtml(t('result.capturedCount', { n: stats.captured }))}</b></div>
        <div><span>${escapeHtml(t('result.kills'))}</span><b>${escapeHtml(t('result.unitCount', { n: stats.kills }))}</b></div>
        <div><span>${escapeHtml(t('result.produced'))}</span><b>${escapeHtml(t('result.unitCount', { n: stats.produced }))}</b></div>
        <div><span>${escapeHtml(t('result.seed'))}</span><b>${state.seed}</b></div>
      </div>
      <button class="big-btn" id="btn-again">${escapeHtml(againLabel)}</button>
      <div style="display:flex; gap:8px; width:min(300px,82vw);">
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-share">${escapeHtml(t('result.share'))}</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-setup">${escapeHtml(t('result.otherKingdom'))}</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-daily">${escapeHtml(t('title.daily'))}</button>
      </div>
      ${opts.onOpenReplay ? `<button class="sub-btn" id="btn-replay">${escapeHtml(t('result.openReplay'))}</button>` : ''}
      <button class="sub-btn" id="btn-title">${escapeHtml(t('pause.toTitle'))}</button>`);
  overlay.bind({
    'btn-again': opts.onReplaySameSetup,
    'btn-share': opts.onShare,
    'btn-setup': opts.onChangeSetup,
    'btn-daily': opts.onDaily,
    'btn-title': opts.onToTitle,
    ...(opts.onOpenReplay ? { 'btn-replay': opts.onOpenReplay } : {}),
  });
}

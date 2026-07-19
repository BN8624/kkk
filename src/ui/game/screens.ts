// 한 줄 목적: 플레이 중 오버레이 화면(일시정지·결과)을 렌더링한다
import { factionScore } from '../../core/game';
import { FACTION_NAMES } from '../../core/data';
import type { GameState } from '../../core/types';
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
  const root = overlay.show(`
      <h1 style="font-size:26px;">일시정지</h1>
      <button class="big-btn" id="btn-resume">계속하기</button>
      <button class="sub-btn" id="btn-sound">사운드: ${opts.soundOn ? '켜짐' : '꺼짐'}</button>
      <button class="sub-btn" id="btn-ai-speed">AI 속도: ${escapeHtml(opts.aiSpeedLabel)}</button>
      <button class="sub-btn" id="btn-tutorial">튜토리얼 다시 보기</button>
      <button class="sub-btn" id="btn-restart">새 게임 (저장 초기화)</button>
      <button class="sub-btn" id="btn-title">타이틀로</button>`);
  root.querySelector('#btn-sound')!.addEventListener('click', (e) => {
    const on = opts.onToggleSound();
    (e.currentTarget as HTMLElement).textContent = `사운드: ${on ? '켜짐' : '꺼짐'}`;
  });
  root.querySelector('#btn-ai-speed')!.addEventListener('click', (e) => {
    const label = opts.onCycleAiSpeed();
    (e.currentTarget as HTMLElement).textContent = `AI 속도: ${label}`;
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
  const word = draw ? '무승부' : won ? '승리' : '패배';
  const cls = won ? 'win' : 'lose';
  const stats = state.stats[me];
  const score = factionScore(state, me);
  const bestLine = opts.isNewBest
    ? `<div><span>시나리오 최고 기록</span><b style="color:#e8c95a">신기록!</b></div>`
    : opts.prevBest !== null
      ? `<div><span>시나리오 최고 기록</span><b>${opts.prevBest}점</b></div>`
      : '';
  const againLabel = state.config.mode === 'daily' ? '같은 시드로 재도전' : '같은 설정으로 새 게임';
  overlay.show(`
      ${won ? `<div class="crown">${CROWN_SVG}</div>` : ''}
      <h1 class="result-word ${cls}">${word}</h1>
      <p class="subtitle">${FACTION_NAMES[me]} · ${escapeHtml(opts.scenarioName)} · ${escapeHtml(opts.difficultyName)}${
        state.config.mode === 'daily' ? ' · 일일 도전' : ''
      }${opts.modifierName ? `<br>수정자: ${escapeHtml(opts.modifierName)}` : ''}</p>
      <div class="result-table">
        <div><span>총 턴</span><b>${Math.min(state.turn, state.maxTurns)}턴</b></div>
        <div><span>최종 지배 점수</span><b>${score}점</b></div>
        ${bestLine}
        <div><span>점령한 거점</span><b>${stats.captured}곳</b></div>
        <div><span>처치한 적</span><b>${stats.kills}기</b></div>
        <div><span>생산한 유닛</span><b>${stats.produced}기</b></div>
        <div><span>시드</span><b>${state.seed}</b></div>
      </div>
      <button class="big-btn" id="btn-again">${againLabel}</button>
      <div style="display:flex; gap:8px; width:min(300px,82vw);">
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-share">공유</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-setup">다른 왕국</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-daily">일일 도전</button>
      </div>
      ${opts.onOpenReplay ? '<button class="sub-btn" id="btn-replay">리플레이 보기</button>' : ''}
      <button class="sub-btn" id="btn-title">타이틀로</button>`);
  overlay.bind({
    'btn-again': opts.onReplaySameSetup,
    'btn-share': opts.onShare,
    'btn-setup': opts.onChangeSetup,
    'btn-daily': opts.onDaily,
    'btn-title': opts.onToTitle,
    ...(opts.onOpenReplay ? { 'btn-replay': opts.onOpenReplay } : {}),
  });
}

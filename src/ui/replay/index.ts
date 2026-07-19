// 한 줄 목적: 리플레이 보관함 화면과 재생 컨트롤 바를 렌더링한다
import { FACTION_NAMES, UNIT_NAMES } from '../../core/data';
import type { GameEvent } from '../../core/command';
import type { FactionId } from '../../core/types';
import { escapeHtml } from '../shared/dom';
import type { OverlayHost } from '../shared/overlay';

export interface ReplayListItem {
  id: string;
  createdAt: string;
  scenarioTitle: string;
  factionName: string;
  difficultyName: string;
  daily: boolean;
  outcome: '승리' | '패배' | '무승부';
  turns: number;
  score: number;
  favorite: boolean;
  sizeBytes: number;
  /** 게임 버전 호환 배지(예: 검증됨·재생만 가능). 없으면 표시하지 않는다. */
  compatLabel?: string;
  /** exact 계열이 아니면 true — 배지를 경고색으로 표시한다. */
  compatWarn?: boolean;
}

export interface ReplayArchiveHandlers {
  onOpen: (id: string) => void;
  onExport: (id: string) => void;
  onShare: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => void;
  onImport: (file: File) => void;
  onBack: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatSize(bytes: number): string {
  return bytes >= 1024 ? `${Math.round(bytes / 1024)}KB` : `${bytes}B`;
}

/** 리플레이 보관함 화면. 항목의 제목 등 문서 유래 텍스트는 항상 이스케이프한다. */
export function showReplayArchiveScreen(
  overlay: OverlayHost,
  items: ReplayListItem[],
  handlers: ReplayArchiveHandlers,
): void {
  const rows = items
    .map((it) => {
      const cls = it.outcome === '승리' ? 'win' : it.outcome === '패배' ? 'lose' : '';
      return `
      <div class="rp-item" data-id="${escapeHtml(it.id)}">
        <button class="rp-main" data-act="open">
          <span class="rp-title"><b>${escapeHtml(it.scenarioTitle)}</b>
            <span class="rp-outcome ${cls}">${it.outcome}</span></span>
          <span class="rp-sub">${formatDate(it.createdAt)} · ${escapeHtml(it.factionName)} · ${escapeHtml(
            it.difficultyName,
          )}${it.daily ? ' · 일일 도전' : ''}</span>
          <span class="rp-sub">${it.turns}턴 · ${it.score}점 · ${formatSize(it.sizeBytes)}${
            it.compatLabel
              ? ` · <span class="rp-compat${it.compatWarn ? ' warn' : ''}">${escapeHtml(it.compatLabel)}</span>`
              : ''
          }</span>
        </button>
        <div class="rp-actions">
          <button data-act="fav" aria-label="즐겨찾기">${it.favorite ? '★' : '☆'}</button>
          <button data-act="export" aria-label="내보내기">⭳</button>
          <button data-act="share" aria-label="공유">↗</button>
          <button data-act="del" aria-label="삭제">✕</button>
        </div>
      </div>`;
    })
    .join('');
  const root = overlay.show(`
      <h1 style="font-size:24px;">리플레이</h1>
      <p class="subtitle" style="font-size:12.5px;">끝난 게임의 명령 기록으로 한 수씩 다시 봅니다 (이 브라우저에만 저장)</p>
      <div class="rp-list">${rows || '<p class="subtitle">저장된 리플레이가 없습니다.<br>게임을 끝까지 플레이하면 자동으로 기록됩니다.</p>'}</div>
      <input type="file" id="rp-import-file" accept=".json,application/json" style="display:none">
      <div style="display:flex; gap:8px; width:min(300px,82vw);">
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-import">가져오기</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-back">뒤로</button>
      </div>`);
  for (const row of root.querySelectorAll<HTMLElement>('.rp-item')) {
    const id = row.dataset.id!;
    row.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'open') handlers.onOpen(id);
        else if (act === 'fav') handlers.onToggleFavorite(id);
        else if (act === 'export') handlers.onExport(id);
        else if (act === 'share') handlers.onShare(id);
        else if (act === 'del') handlers.onDelete(id);
      });
    });
  }
  const fileInput = root.querySelector<HTMLInputElement>('#rp-import-file')!;
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) handlers.onImport(f);
    fileInput.value = '';
  });
  overlay.bind({
    'btn-import': () => fileInput.click(),
    'btn-back': handlers.onBack,
  });
}

// ---------------- 재생 컨트롤 ----------------

export interface ReplayControlsHandlers {
  onPlayPause: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onPrevTurn: () => void;
  onNextTurn: () => void;
  onFirst: () => void;
  onLast: () => void;
  onCycleSpeed: () => void;
  onExit: () => void;
}

export interface ReplayControlsView {
  playing: boolean;
  speed: number;
  turn: number;
  maxTurns: number;
  index: number;
  length: number;
  factionName: string;
  gold: number;
  score: number;
  description: string;
  resultText?: string;
}

/** 재생 화면 하단 컨트롤 바(모바일 우선). 지도 줌·팬은 기존 보드 입력을 그대로 쓴다. */
export class ReplayControls {
  private bar: HTMLElement;
  private top: HTMLElement;

  constructor(root: HTMLElement, handlers: ReplayControlsHandlers) {
    this.top = document.createElement('div');
    this.top.className = 'rp-topbar';
    this.top.innerHTML = `
      <button class="rp-exit" id="rp-exit">✕ 닫기</button>
      <span class="hud-chip" id="rp-status"></span>`;
    root.appendChild(this.top);

    this.bar = document.createElement('div');
    this.bar.className = 'rp-bar';
    this.bar.innerHTML = `
      <div class="rp-desc" id="rp-desc"></div>
      <div class="rp-controls">
        <button id="rp-first" aria-label="처음">⏮</button>
        <button id="rp-prev-turn" aria-label="이전 턴">«턴</button>
        <button id="rp-back" aria-label="한 명령 뒤로">◀</button>
        <button id="rp-play" class="rp-play" aria-label="재생">▶</button>
        <button id="rp-fwd" aria-label="한 명령 앞으로">▶︎|</button>
        <button id="rp-next-turn" aria-label="다음 턴">턴»</button>
        <button id="rp-last" aria-label="마지막">⏭</button>
        <button id="rp-speed" aria-label="배속">1×</button>
      </div>`;
    root.appendChild(this.bar);

    const on = (id: string, fn: () => void) =>
      this.bar.querySelector(`#${id}`)?.addEventListener('click', fn);
    on('rp-first', handlers.onFirst);
    on('rp-prev-turn', handlers.onPrevTurn);
    on('rp-back', handlers.onStepBack);
    on('rp-play', handlers.onPlayPause);
    on('rp-fwd', handlers.onStepForward);
    on('rp-next-turn', handlers.onNextTurn);
    on('rp-last', handlers.onLast);
    on('rp-speed', handlers.onCycleSpeed);
    this.top.querySelector('#rp-exit')!.addEventListener('click', handlers.onExit);
  }

  update(v: ReplayControlsView): void {
    const status = this.top.querySelector('#rp-status')!;
    status.textContent = `${v.turn}/${v.maxTurns}턴 · ${v.factionName} · 금 ${v.gold} · ${v.score}점 · ${v.index}/${v.length}`;
    const desc = this.bar.querySelector('#rp-desc')!;
    desc.textContent = v.resultText ?? v.description;
    (desc as HTMLElement).classList.toggle('final', v.resultText !== undefined);
    const play = this.bar.querySelector('#rp-play')!;
    play.textContent = v.playing ? '⏸' : '▶';
    this.bar.querySelector('#rp-speed')!.textContent = `${v.speed}×`;
  }

  destroy(): void {
    this.top.remove();
    this.bar.remove();
  }
}

/** 마지막으로 실행된 명령의 이벤트를 한 줄 한국어 설명으로 만든다. */
export function describeStep(events: GameEvent[]): string {
  for (const ev of events) {
    switch (ev.type) {
      case 'unit-attacked': {
        const a = `${FACTION_NAMES[ev.attackerFaction]} ${UNIT_NAMES[ev.attackerType]}`;
        const d = `${FACTION_NAMES[ev.defenderFaction]} ${UNIT_NAMES[ev.defenderType]}`;
        const died = events.some((e) => e.type === 'unit-died' && e.unitId === ev.defenderId);
        return `${a} → ${d} 공격 (피해 ${ev.damage}${died ? ' · 처치' : ''})`;
      }
      case 'unit-produced':
        return `${FACTION_NAMES[ev.faction]} ${UNIT_NAMES[ev.unitType]} 생산`;
      case 'building-captured':
        return `${FACTION_NAMES[ev.newOwner]} 거점 점령`;
      case 'unit-moved':
        return `${FACTION_NAMES[ev.faction]} ${UNIT_NAMES[ev.unitType]} 이동`;
      case 'phase-ended': {
        const ts = events.find(
          (e): e is Extract<GameEvent, { type: 'turn-started' }> => e.type === 'turn-started',
        );
        return ts ? `${ts.turn}턴 시작` : `${FACTION_NAMES[ev.faction]} 페이즈 종료`;
      }
      default:
        break;
    }
  }
  return '';
}

/** 재생 종료 시 결과 요약 문구. */
export function describeResult(winner: FactionId | 'draw', turns: number): string {
  return winner === 'draw' ? `무승부 · ${turns}턴` : `${FACTION_NAMES[winner]} 승리 · ${turns}턴`;
}

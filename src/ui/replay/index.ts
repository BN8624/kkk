// 한 줄 목적: 리플레이 보관함 화면과 재생 컨트롤 바를 렌더링한다
import type { GameEvent } from '../../core/command';
import {
  EVAL_DEFECT_TAGS,
  EVAL_ENJOYMENT,
  EVAL_LENGTH,
  EVAL_NOTE_MAX,
  sanitizeEvaluation,
  type PlaytestEvaluation,
} from '../../core/replay';
import type { FactionId } from '../../core/types';
import { factionName, t, unitName } from '../../i18n';
import { escapeHtml } from '../shared/dom';
import type { OverlayHost } from '../shared/overlay';

export interface ReplayListItem {
  id: string;
  createdAt: string;
  scenarioTitle: string;
  factionName: string;
  difficultyName: string;
  daily: boolean;
  outcome: 'win' | 'lose' | 'draw';
  turns: number;
  score: number;
  favorite: boolean;
  sizeBytes: number;
  /** 게임 버전 호환 배지(예: 검증됨·재생만 가능). 없으면 표시하지 않는다. */
  compatLabel?: string;
  /** exact 계열이 아니면 true — 배지를 경고색으로 표시한다. */
  compatWarn?: boolean;
  /** 플레이테스트 분류 라벨(있으면 목록에 표시) */
  defectLabel?: string;
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
      const cls = it.outcome === 'win' ? 'win' : it.outcome === 'lose' ? 'lose' : '';
      const outcome =
        it.outcome === 'win'
          ? t('result.win')
          : it.outcome === 'draw'
            ? t('result.draw')
            : t('result.lose');
      return `
      <div class="rp-item" data-id="${escapeHtml(it.id)}">
        <button class="rp-main" data-act="open">
          <span class="rp-title"><b>${escapeHtml(it.scenarioTitle)}</b>
            <span class="rp-outcome ${cls}">${escapeHtml(outcome)}</span></span>
          <span class="rp-sub">${formatDate(it.createdAt)} · ${escapeHtml(it.factionName)} · ${escapeHtml(
            it.difficultyName,
          )}${it.daily ? ` · ${escapeHtml(t('replay.dailyTag'))}` : ''}</span>
          <span class="rp-sub">${escapeHtml(t('replay.listStats', { turns: it.turns, score: it.score, size: formatSize(it.sizeBytes) }))}${
            it.compatLabel
              ? ` · <span class="rp-compat${it.compatWarn ? ' warn' : ''}">${escapeHtml(it.compatLabel)}</span>`
              : ''
          }${it.defectLabel ? ` · <span class="rp-defect">${escapeHtml(it.defectLabel)}</span>` : ''}</span>
        </button>
        <div class="rp-actions">
          <button data-act="fav" aria-label="${escapeHtml(t('replay.favorite'))}">${it.favorite ? '★' : '☆'}</button>
          <button data-act="export" aria-label="${escapeHtml(t('replay.export'))}">⭳</button>
          <button data-act="share" aria-label="${escapeHtml(t('replay.share'))}">↗</button>
          <button data-act="del" aria-label="${escapeHtml(t('replay.delete'))}">✕</button>
        </div>
      </div>`;
    })
    .join('');
  const root = overlay.show(`
      <h1 style="font-size:24px;">${escapeHtml(t('replay.title'))}</h1>
      <p class="subtitle" style="font-size:12.5px;">${escapeHtml(t('replay.subtitle'))}</p>
      <div class="rp-list">${rows || `<p class="subtitle">${escapeHtml(t('replay.empty'))}<br>${escapeHtml(t('replay.emptyHint'))}</p>`}</div>
      <input type="file" id="rp-import-file" accept=".json,application/json" style="display:none">
      <div style="display:flex; gap:8px; width:min(300px,82vw);">
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-import">${escapeHtml(t('replay.import'))}</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-back">${escapeHtml(t('common.back'))}</button>
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
      <button class="rp-exit" id="rp-exit">${escapeHtml(t('replay.close'))}</button>
      <span class="hud-chip" id="rp-status" role="status" aria-live="polite"></span>`;
    root.appendChild(this.top);

    this.bar = document.createElement('div');
    this.bar.className = 'rp-bar';
    this.bar.innerHTML = `
      <div class="rp-desc" id="rp-desc"></div>
      <div class="rp-controls">
        <button id="rp-first" aria-label="${escapeHtml(t('replay.first'))}">⏮</button>
        <button id="rp-prev-turn" aria-label="${escapeHtml(t('replay.prevTurn'))}">«${escapeHtml(t('replay.turnShort'))}</button>
        <button id="rp-back" aria-label="${escapeHtml(t('replay.stepBack'))}">◀</button>
        <button id="rp-play" class="rp-play" aria-label="${escapeHtml(t('replay.play'))}">▶</button>
        <button id="rp-fwd" aria-label="${escapeHtml(t('replay.stepForward'))}">▶︎|</button>
        <button id="rp-next-turn" aria-label="${escapeHtml(t('replay.nextTurn'))}">${escapeHtml(t('replay.turnShort'))}»</button>
        <button id="rp-last" aria-label="${escapeHtml(t('replay.last'))}">⏭</button>
        <button id="rp-speed" aria-label="${escapeHtml(t('replay.speed'))}">1×</button>
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
    status.textContent = t('replay.status', {
      turn: v.turn,
      max: v.maxTurns,
      faction: v.factionName,
      gold: v.gold,
      score: v.score,
      index: v.index,
      length: v.length,
    });
    const desc = this.bar.querySelector('#rp-desc')!;
    desc.textContent = v.resultText ?? v.description;
    (desc as HTMLElement).classList.toggle('final', v.resultText !== undefined);
    const play = this.bar.querySelector('#rp-play')!;
    play.textContent = v.playing ? '⏸' : '▶';
    play.setAttribute('aria-label', t(v.playing ? 'replay.pause' : 'replay.play'));
    this.bar.querySelector('#rp-speed')!.textContent = `${v.speed}×`;
  }

  destroy(): void {
    this.top.remove();
    this.bar.remove();
  }
}

/** 마지막으로 실행된 명령의 이벤트를 현재 언어의 한 줄 설명으로 만든다. */
export function describeStep(events: GameEvent[]): string {
  for (const ev of events) {
    switch (ev.type) {
      case 'unit-attacked': {
        const a = `${factionName(ev.attackerFaction)} ${unitName(ev.attackerType)}`;
        const d = `${factionName(ev.defenderFaction)} ${unitName(ev.defenderType)}`;
        const died = events.some((e) => e.type === 'unit-died' && e.unitId === ev.defenderId);
        return t('replay.step.attack', {
          attacker: a,
          defender: d,
          damage: ev.damage,
          defeated: died ? t('replay.step.defeated') : '',
        });
      }
      case 'unit-produced':
        return t('replay.step.produced', {
          faction: factionName(ev.faction),
          unit: unitName(ev.unitType),
        });
      case 'building-captured':
        return t('replay.step.captured', { faction: factionName(ev.newOwner) });
      case 'unit-moved':
        return t('replay.step.moved', {
          faction: factionName(ev.faction),
          unit: unitName(ev.unitType),
        });
      case 'phase-ended': {
        const ts = events.find(
          (e): e is Extract<GameEvent, { type: 'turn-started' }> => e.type === 'turn-started',
        );
        return ts
          ? t('replay.step.turnStarted', { turn: ts.turn })
          : t('replay.step.phaseEnded', { faction: factionName(ev.faction) });
      }
      default:
        break;
    }
  }
  return '';
}

/** 재생 종료 시 결과 요약 문구. */
export function describeResult(winner: FactionId | 'draw', turns: number): string {
  return winner === 'draw'
    ? t('replay.result.draw', { turns })
    : t('replay.result.win', { faction: factionName(winner), turns });
}

/** 분류 태그 라벨(한/영 i18n). */
export function defectTagLabel(tag: NonNullable<PlaytestEvaluation['defectTag']>): string {
  return t(`eval.tag.${tag}`);
}

/**
 * 내보내기 직전 선택적 플레이 평가 시트.
 * 건너뛰기·모두 비움 → undefined. 입력값은 로컬 문서에만 담기며 외부 전송 없음.
 */
export function promptPlaytestEvaluation(host: HTMLElement): Promise<PlaytestEvaluation | undefined> {
  return new Promise((resolve) => {
    const sheet = document.createElement('div');
    sheet.className = 'sheet rp-eval-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', t('eval.title'));

    const chipRow = (
      name: string,
      options: readonly { value: string; label: string }[],
    ): string =>
      `<div class="rp-eval-row" data-group="${escapeHtml(name)}">${options
        .map(
          (o) =>
            `<button type="button" class="rp-eval-chip" data-group="${escapeHtml(name)}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</button>`,
        )
        .join('')}</div>`;

    sheet.innerHTML = `
      <h3>${escapeHtml(t('eval.title'))}</h3>
      ${chipRow(
        'enjoyment',
        EVAL_ENJOYMENT.map((v) => ({ value: v, label: t(`eval.enjoyment.${v}`) })),
      )}
      ${chipRow(
        'length',
        EVAL_LENGTH.map((v) => ({ value: v, label: t(`eval.length.${v}`) })),
      )}
      ${chipRow('understood', [
        { value: 'yes', label: t('eval.understood.yes') },
        { value: 'no', label: t('eval.understood.no') },
      ])}
      ${chipRow(
        'defectTag',
        EVAL_DEFECT_TAGS.map((v) => ({ value: v, label: t(`eval.tag.${v}`) })),
      )}
      <label class="rp-eval-note">
        <span>${escapeHtml(t('eval.note'))}</span>
        <textarea id="rp-eval-note" maxlength="${EVAL_NOTE_MAX}" rows="2"></textarea>
      </label>
      <div class="rp-eval-actions">
        <button type="button" class="close-btn" id="rp-eval-skip">${escapeHtml(t('eval.skip'))}</button>
        <button type="button" class="close-btn rp-eval-attach" id="rp-eval-attach">${escapeHtml(t('eval.attach'))}</button>
      </div>`;
    host.appendChild(sheet);
    // 다음 프레임에 슬라이드 인
    requestAnimationFrame(() => sheet.classList.add('show'));

    const selected: Record<string, string | undefined> = {};
    sheet.querySelectorAll<HTMLButtonElement>('.rp-eval-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const group = btn.dataset.group!;
        const value = btn.dataset.value!;
        // 같은 값 재탭 시 해제
        if (selected[group] === value) {
          selected[group] = undefined;
          btn.classList.remove('on');
          return;
        }
        selected[group] = value;
        sheet.querySelectorAll<HTMLButtonElement>(`.rp-eval-chip[data-group="${group}"]`).forEach((b) => {
          b.classList.toggle('on', b === btn);
        });
      });
    });

    const finish = (value: PlaytestEvaluation | undefined) => {
      sheet.classList.remove('show');
      window.setTimeout(() => sheet.remove(), 220);
      resolve(value);
    };

    sheet.querySelector('#rp-eval-skip')!.addEventListener('click', () => finish(undefined));
    sheet.querySelector('#rp-eval-attach')!.addEventListener('click', () => {
      const noteEl = sheet.querySelector<HTMLTextAreaElement>('#rp-eval-note');
      const draft: PlaytestEvaluation = {};
      if (selected.enjoyment === 'fun' || selected.enjoyment === 'ok' || selected.enjoyment === 'boring') {
        draft.enjoyment = selected.enjoyment;
      }
      if (selected.length === 'short' || selected.length === 'right' || selected.length === 'long') {
        draft.length = selected.length;
      }
      if (selected.understood === 'yes') draft.understoodLoss = true;
      else if (selected.understood === 'no') draft.understoodLoss = false;
      if (
        selected.defectTag === 'early-objective' ||
        selected.defectTag === 'lost-before-acting' ||
        selected.defectTag === 'unclear-objective' ||
        selected.defectTag === 'no-retake-chance'
      ) {
        draft.defectTag = selected.defectTag;
      }
      const note = noteEl?.value.trim() ?? '';
      if (note) draft.note = note.slice(0, EVAL_NOTE_MAX);
      finish(sanitizeEvaluation(draft));
    });
  });
}

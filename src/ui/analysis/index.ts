// 한 줄 목적: 플레이 분석(기록실) 화면 — 대상 선택·단일 분석·다중 통계를 보드게임 기록실 풍으로 렌더링한다
import { UNIT_NAMES } from '../../core/data';
import type { UnitTypeId } from '../../core/types';
import type { AggregateAnalysis } from '../../core/analysis/aggregate';
import type { CoachingNote } from '../../core/analysis/coaching';
import type { ReplayAnalysis, TurnEventNote } from '../../core/analysis/replay-metrics';
import { escapeHtml, resultTableHtml } from '../shared/dom';
import type { OverlayHost } from '../shared/overlay';

const UNIT_TYPES: UnitTypeId[] = ['infantry', 'archer', 'cavalry'];

// ---------------- 대상 선택 화면 ----------------

export interface AnalysisListItem {
  id: string;
  title: string;
  sub: string;
  outcome: '승리' | '패배' | '무승부';
  selected: boolean;
}

export interface AnalysisFilterState {
  mode: 'all' | 'campaign' | 'quick' | 'daily' | 'custom';
  faction: 'all' | 'azure' | 'crimson' | 'violet';
  difficulty: 'all' | 'easy' | 'normal' | 'hard';
  scenario: string; // 'all' 또는 시나리오 ID
}

export interface AnalysisListHandlers {
  onToggle: (id: string) => void;
  onOpenSingle: (id: string) => void;
  onAnalyzeSelected: () => void;
  onFilterChange: (patch: Partial<AnalysisFilterState>) => void;
  onImport: (file: File) => void;
  onBack: () => void;
}

export function showAnalysisListScreen(
  overlay: OverlayHost,
  items: AnalysisListItem[],
  filters: AnalysisFilterState,
  scenarioOptions: { id: string; name: string }[],
  handlers: AnalysisListHandlers,
): void {
  const selectedCount = items.filter((i) => i.selected).length;
  const rows = items
    .map((it) => {
      const cls = it.outcome === '승리' ? 'win' : it.outcome === '패배' ? 'lose' : '';
      return `
      <div class="rp-item" data-id="${escapeHtml(it.id)}">
        <label class="an-check"><input type="checkbox" data-act="sel" ${it.selected ? 'checked' : ''} aria-label="분석 대상 선택"></label>
        <button class="rp-main" data-act="open">
          <span class="rp-title"><b>${escapeHtml(it.title)}</b>
            <span class="rp-outcome ${cls}">${it.outcome}</span></span>
          <span class="rp-sub">${escapeHtml(it.sub)}</span>
        </button>
      </div>`;
    })
    .join('');
  const sel = (name: string, value: string, options: [string, string][]): string =>
    `<select data-filter="${name}" aria-label="${name} 필터">${options
      .map(([v, label]) => `<option value="${escapeHtml(v)}"${v === value ? ' selected' : ''}>${escapeHtml(label)}</option>`)
      .join('')}</select>`;
  const root = overlay.show(`
      <h1 style="font-size:24px;">플레이 분석</h1>
      <p class="subtitle" style="font-size:12.5px;">내 리플레이에서 승패의 이유를 찾습니다 (이 브라우저 안에서만 분석)</p>
      <div class="an-filters">
        ${sel('mode', filters.mode, [
          ['all', '모든 모드'],
          ['quick', '빠른 전투'],
          ['campaign', '캠페인'],
          ['daily', '일일 도전'],
          ['custom', '커스텀'],
        ])}
        ${sel('faction', filters.faction, [
          ['all', '모든 왕국'],
          ['azure', '남색'],
          ['crimson', '진홍'],
          ['violet', '보라'],
        ])}
        ${sel('difficulty', filters.difficulty, [
          ['all', '모든 난이도'],
          ['easy', '쉬움'],
          ['normal', '보통'],
          ['hard', '어려움'],
        ])}
        ${sel('scenario', filters.scenario, [
          ['all', '모든 시나리오'],
          ...scenarioOptions.map((s): [string, string] => [s.id, s.name]),
        ])}
      </div>
      <div class="rp-list">${rows || '<p class="subtitle">조건에 맞는 리플레이가 없습니다.<br>게임을 끝까지 플레이하면 자동으로 기록됩니다.</p>'}</div>
      <input type="file" id="an-import-file" accept=".json,application/json" style="display:none">
      <div style="display:flex; gap:8px; width:min(300px,82vw);">
        <button class="big-btn" style="width:auto;flex:2;" id="btn-analyze" ${items.length === 0 ? 'disabled' : ''}>
          ${selectedCount > 0 ? `선택한 ${selectedCount}판 분석` : '전체 분석'}</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-an-import">가져오기</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-back">뒤로</button>
      </div>`);
  for (const row of root.querySelectorAll<HTMLElement>('.rp-item')) {
    const id = row.dataset.id!;
    row.querySelector<HTMLInputElement>('[data-act="sel"]')?.addEventListener('change', () => handlers.onToggle(id));
    row.querySelector<HTMLButtonElement>('[data-act="open"]')?.addEventListener('click', () => handlers.onOpenSingle(id));
  }
  for (const select of root.querySelectorAll<HTMLSelectElement>('[data-filter]')) {
    select.addEventListener('change', () =>
      handlers.onFilterChange({ [select.dataset.filter!]: select.value } as Partial<AnalysisFilterState>),
    );
  }
  const fileInput = root.querySelector<HTMLInputElement>('#an-import-file')!;
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) handlers.onImport(f);
    fileInput.value = '';
  });
  overlay.bind({
    'btn-analyze': handlers.onAnalyzeSelected,
    'btn-an-import': () => fileInput.click(),
    'btn-back': handlers.onBack,
  });
}

/** 분석 진행 화면(취소 가능). */
export function showAnalysisProgressScreen(
  overlay: OverlayHost,
  done: number,
  total: number,
  onCancel: () => void,
): void {
  overlay.show(`
      <h1 style="font-size:22px;">분석 중…</h1>
      <p class="subtitle">${done}/${total} 리플레이</p>
      <button class="sub-btn" id="btn-cancel">취소</button>`);
  overlay.bind({ 'btn-cancel': onCancel });
}

// ---------------- 단일 게임 분석 ----------------

export interface SingleAnalysisHandlers {
  onOpenTurn: (turn: number) => void;
  onExport: (format: 'json' | 'md' | 'csv') => void;
  onBack: () => void;
}

function noteIcon(kind: CoachingNote['kind']): string {
  return kind === 'praise' ? '✦' : kind === 'missed' ? '✧' : '➤';
}

function timelineRow(ev: TurnEventNote): string {
  return `
    <div class="an-ev">
      <span class="an-ev-turn">${ev.turn}턴</span>
      <span class="an-ev-text">${escapeHtml(ev.text)}</span>
      <button class="an-ev-open" data-turn="${ev.turn}" aria-label="${ev.turn}턴 리플레이 보기">보기</button>
    </div>`;
}

export function showSingleAnalysisScreen(
  overlay: OverlayHost,
  a: ReplayAnalysis,
  coaching: CoachingNote[],
  campaignNote: string | null,
  handlers: SingleAnalysisHandlers,
): void {
  const word = a.outcome === 'win' ? '승리' : a.outcome === 'lose' ? '패배' : '무승부';
  const summary = resultTableHtml([
    { label: '결과', value: `${word} · ${a.turns}턴 · ${a.score}점` },
    ...(a.starTotal > 0 ? [{ label: '별점', value: `${'★'.repeat(a.stars)}${'☆'.repeat(Math.max(0, a.starTotal - a.stars))}` }] : []),
    { label: '행동', value: `이동 ${a.moves} · 공격 ${a.attacks} · 생산 ${a.productions}` },
    { label: '전투', value: `처치 ${a.kills} · 손실 ${a.lostUnits} · 피해 ${a.damageDealt}/${a.damageTaken}` },
    { label: '경제', value: `수입 ${a.totalIncome} · 지출 ${a.productionSpend} · 종료 금 ${a.goldAtEnd}` },
    { label: '이동 거리', value: `${a.moveDistance}칸` },
  ]);
  const stars =
    a.starReviews.length > 0
      ? `<div class="an-block"><h2>별점 검토</h2>${a.starReviews
          .map((s) => `<p class="an-line">${s.earned ? '★' : '☆'} ${escapeHtml(s.note)}</p>`)
          .join('')}</div>`
      : '';
  const notes =
    coaching.length > 0
      ? `<div class="an-block"><h2>기록관의 조언</h2>${coaching
          .map((c) => `<p class="an-line">${noteIcon(c.kind)} ${escapeHtml(c.text)}</p>`)
          .join('')}</div>`
      : '';
  const timeline =
    a.timeline.length > 0
      ? `<div class="an-block"><h2>턴별 주요 사건</h2>${a.timeline.map(timelineRow).join('')}</div>`
      : '';
  const root = overlay.show(`
      <h1 style="font-size:22px;">${escapeHtml(a.scenarioTitle)}</h1>
      <p class="subtitle" style="font-size:12.5px;">${escapeHtml(a.replayId)}</p>
      ${summary}
      ${campaignNote ? `<p class="subtitle">${escapeHtml(campaignNote)}</p>` : ''}
      ${stars}
      ${notes}
      ${timeline}
      <div style="display:flex; gap:8px; width:min(300px,82vw);">
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-ex-json">JSON</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-ex-md">Markdown</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-ex-csv">CSV</button>
      </div>
      <button class="sub-btn" id="btn-back">뒤로</button>`);
  for (const btn of root.querySelectorAll<HTMLButtonElement>('.an-ev-open')) {
    btn.addEventListener('click', () => handlers.onOpenTurn(Number(btn.dataset.turn)));
  }
  overlay.bind({
    'btn-ex-json': () => handlers.onExport('json'),
    'btn-ex-md': () => handlers.onExport('md'),
    'btn-ex-csv': () => handlers.onExport('csv'),
    'btn-back': handlers.onBack,
  });
}

// ---------------- 다중 게임 분석 ----------------

export interface MultiAnalysisHandlers {
  onExport: (format: 'json' | 'md' | 'csv') => void;
  onBack: () => void;
}

export function showMultiAnalysisScreen(
  overlay: OverlayHost,
  agg: AggregateAnalysis,
  coaching: CoachingNote[],
  handlers: MultiAnalysisHandlers,
): void {
  const summary = resultTableHtml([
    { label: '분석 판 수', value: `${agg.games}판` },
    { label: '승 / 패 / 무', value: `${agg.wins} / ${agg.losses} / ${agg.draws} (승률 ${agg.winRate}%)` },
    { label: '평균 종료 턴', value: `${agg.avgTurns}턴` },
    { label: '평균 점수', value: `${agg.avgScore}점` },
    ...(agg.starTotal > 0 ? [{ label: '별 획득', value: `${agg.totalStars}/${agg.starTotal}` }] : []),
    {
      label: '병과 생산 비율',
      value: UNIT_TYPES.map((t) => `${UNIT_NAMES[t]} ${agg.productionShare[t]}%`).join(' · '),
    },
  ]);
  const groups = (title: string, rows: { label: string; games: number; wins: number; avgTurns: number }[]): string =>
    rows.length > 0
      ? `<div class="an-block"><h2>${title}</h2>${rows
          .map(
            (g) =>
              `<p class="an-line">${escapeHtml(g.label)} — ${g.games}판 · ${g.wins}승 · 평균 ${g.avgTurns}턴</p>`,
          )
          .join('')}</div>`
      : '';
  const lossReasons =
    agg.commonLossReasons.length > 0
      ? `<div class="an-block"><h2>반복되는 패배 원인</h2>${agg.commonLossReasons
          .map((r) => `<p class="an-line">✧ ${escapeHtml(r.reason)} · ${r.count}회</p>`)
          .join('')}</div>`
      : '';
  const trend = agg.trend
    ? `<div class="an-block"><h2>최근 5판 vs 이전 5판</h2>
        <p class="an-line">승률 ${agg.trend.previousWinRate}% → ${agg.trend.recentWinRate}%</p>
        <p class="an-line">평균 턴 ${agg.trend.previousAvgTurns} → ${agg.trend.recentAvgTurns}</p></div>`
    : '';
  const notes =
    coaching.length > 0
      ? `<div class="an-block"><h2>기록관의 조언</h2>${coaching
          .map((c) => `<p class="an-line">${noteIcon(c.kind)} ${escapeHtml(c.text)}</p>`)
          .join('')}</div>`
      : '';
  overlay.show(`
      <h1 style="font-size:22px;">전적 분석</h1>
      ${summary}
      ${groups('왕국별 기록', agg.byFaction)}
      ${groups('시나리오별 기록', agg.byScenario)}
      ${groups('난이도별 기록', agg.byDifficulty)}
      ${lossReasons}
      ${trend}
      ${notes}
      <div style="display:flex; gap:8px; width:min(300px,82vw);">
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-ex-json">JSON</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-ex-md">Markdown</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-ex-csv">CSV</button>
      </div>
      <button class="sub-btn" id="btn-back">뒤로</button>`);
  overlay.bind({
    'btn-ex-json': () => handlers.onExport('json'),
    'btn-ex-md': () => handlers.onExport('md'),
    'btn-ex-csv': () => handlers.onExport('csv'),
    'btn-back': handlers.onBack,
  });
}

// 한 줄 목적: 플레이 분석(기록실) 화면 — 대상 선택·단일 분석·다중 통계를 보드게임 기록실 풍으로 렌더링한다
import type { UnitTypeId } from '../../core/types';
import type { AggregateAnalysis } from '../../core/analysis/aggregate';
import type { CoachingNote } from '../../core/analysis/coaching';
import type { ReplayAnalysis, TurnEventNote } from '../../core/analysis/replay-metrics';
import { UNIT_TYPE_IDS } from '../../core/units';
import { factionName, t, unitName } from '../../i18n';
import { escapeHtml, resultTableHtml } from '../shared/dom';
import type { OverlayHost } from '../shared/overlay';

const UNIT_TYPES: UnitTypeId[] = [...UNIT_TYPE_IDS];

// ---------------- 대상 선택 화면 ----------------

export interface AnalysisListItem {
  id: string;
  title: string;
  sub: string;
  outcome: 'win' | 'lose' | 'draw';
  selected: boolean;
  /** 플레이테스트 분류 라벨(있으면 목록에 표시) */
  defectLabel?: string;
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
      const cls = it.outcome === 'win' ? 'win' : it.outcome === 'lose' ? 'lose' : '';
      const outcome =
        it.outcome === 'win'
          ? t('result.win')
          : it.outcome === 'draw'
            ? t('result.draw')
            : t('result.lose');
      return `
      <div class="rp-item" data-id="${escapeHtml(it.id)}">
        <label class="an-check"><input type="checkbox" data-act="sel" ${it.selected ? 'checked' : ''} aria-label="${escapeHtml(t('analysis.selectTarget'))}"></label>
        <button class="rp-main" data-act="open">
          <span class="rp-title"><b>${escapeHtml(it.title)}</b>
            <span class="rp-outcome ${cls}">${escapeHtml(outcome)}</span></span>
          <span class="rp-sub">${escapeHtml(it.sub)}</span>
          ${it.defectLabel ? `<span class="rp-sub rp-defect">${escapeHtml(it.defectLabel)}</span>` : ''}
        </button>
      </div>`;
    })
    .join('');
  const sel = (name: string, value: string, options: [string, string][]): string =>
    `<select data-filter="${name}" aria-label="${escapeHtml(t('analysis.filterAria', { name: t(`analysis.filter.${name as 'mode' | 'faction' | 'difficulty' | 'scenario'}`) }))}">${options
      .map(([v, label]) => `<option value="${escapeHtml(v)}"${v === value ? ' selected' : ''}>${escapeHtml(label)}</option>`)
      .join('')}</select>`;
  const root = overlay.show(`
      <h1 style="font-size:24px;">${escapeHtml(t('analysis.title'))}</h1>
      <p class="subtitle" style="font-size:12.5px;">${escapeHtml(t('analysis.subtitle'))}</p>
      <div class="an-filters">
        ${sel('mode', filters.mode, [
          ['all', t('analysis.allModes')],
          ['quick', t('analysis.mode.quick')],
          ['campaign', t('analysis.mode.campaign')],
          ['daily', t('analysis.mode.daily')],
          ['custom', t('analysis.mode.custom')],
        ])}
        ${sel('faction', filters.faction, [
          ['all', t('analysis.allFactions')],
          ['azure', factionName('azure')],
          ['crimson', factionName('crimson')],
          ['violet', factionName('violet')],
        ])}
        ${sel('difficulty', filters.difficulty, [
          ['all', t('analysis.allDifficulties')],
          ['easy', t('difficulty.easy')],
          ['normal', t('difficulty.normal')],
          ['hard', t('difficulty.hard')],
        ])}
        ${sel('scenario', filters.scenario, [
          ['all', t('analysis.allScenarios')],
          ...scenarioOptions.map((s): [string, string] => [s.id, s.name]),
        ])}
      </div>
      <div class="rp-list">${rows || `<p class="subtitle">${escapeHtml(t('analysis.empty'))}<br>${escapeHtml(t('analysis.emptyHint'))}</p>`}</div>
      <input type="file" id="an-import-file" accept=".json,application/json" style="display:none">
      <div style="display:flex; gap:8px; width:min(300px,82vw);">
        <button class="big-btn" style="width:auto;flex:2;" id="btn-analyze" ${items.length === 0 ? 'disabled' : ''}>
          ${escapeHtml(selectedCount > 0 ? t('analysis.selected', { n: selectedCount }) : t('analysis.allGames'))}</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-an-import">${escapeHtml(t('replay.import'))}</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-back">${escapeHtml(t('common.back'))}</button>
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
      <h1 style="font-size:22px;">${escapeHtml(t('analysis.analyzing'))}</h1>
      <p class="subtitle">${escapeHtml(t('analysis.progress', { done, total }))}</p>
      <button class="sub-btn" id="btn-cancel">${escapeHtml(t('common.cancel'))}</button>`);
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
      <span class="an-ev-turn">${escapeHtml(t('analysis.turn', { n: ev.turn }))}</span>
      <span class="an-ev-text">${escapeHtml(ev.text)}</span>
      <button class="an-ev-open" data-turn="${ev.turn}" aria-label="${escapeHtml(t('analysis.openTurnAria', { n: ev.turn }))}">${escapeHtml(t('analysis.view'))}</button>
    </div>`;
}

export function showSingleAnalysisScreen(
  overlay: OverlayHost,
  a: ReplayAnalysis,
  coaching: CoachingNote[],
  campaignNote: string | null,
  handlers: SingleAnalysisHandlers,
  defectLabel?: string | null,
): void {
  const word = a.outcome === 'win' ? t('result.win') : a.outcome === 'lose' ? t('result.lose') : t('result.draw');
  const summary = resultTableHtml([
    { label: t('analysis.result'), value: t('analysis.resultValue', { outcome: word, turns: a.turns, score: a.score }) },
    ...(a.starTotal > 0 ? [{ label: t('analysis.stars'), value: `${'★'.repeat(a.stars)}${'☆'.repeat(Math.max(0, a.starTotal - a.stars))}` }] : []),
    { label: t('analysis.actions'), value: t('analysis.actionsValue', { moves: a.moves, attacks: a.attacks, productions: a.productions }) },
    { label: t('analysis.combat'), value: t('analysis.combatValue', { kills: a.kills, losses: a.lostUnits, dealt: a.damageDealt, taken: a.damageTaken }) },
    { label: t('analysis.economy'), value: t('analysis.economyValue', { income: a.totalIncome, spend: a.productionSpend, gold: a.goldAtEnd }) },
    { label: t('analysis.moveDistance'), value: t('analysis.tiles', { n: a.moveDistance }) },
  ]);
  const defect =
    defectLabel || a.defectTag
      ? `<p class="an-defect">${escapeHtml(defectLabel ?? t(`eval.tag.${a.defectTag!}`))}</p>`
      : '';
  const stars =
    a.starReviews.length > 0
      ? `<div class="an-block"><h2>${escapeHtml(t('analysis.starReview'))}</h2>${a.starReviews
          .map((s) => `<p class="an-line">${s.earned ? '★' : '☆'} ${escapeHtml(s.note)}</p>`)
          .join('')}</div>`
      : '';
  const notes =
    coaching.length > 0
      ? `<div class="an-block"><h2>${escapeHtml(t('analysis.advice'))}</h2>${coaching
          .map((c) => `<p class="an-line">${noteIcon(c.kind)} ${escapeHtml(c.text)}</p>`)
          .join('')}</div>`
      : '';
  const timeline =
    a.timeline.length > 0
      ? `<div class="an-block"><h2>${escapeHtml(t('analysis.timeline'))}</h2>${a.timeline.map(timelineRow).join('')}</div>`
      : '';
  const root = overlay.show(`
      <h1 style="font-size:22px;">${escapeHtml(a.scenarioTitle)}</h1>
      <p class="subtitle" style="font-size:12.5px;">${escapeHtml(a.replayId)}</p>
      ${defect}
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
      <button class="sub-btn" id="btn-back">${escapeHtml(t('common.back'))}</button>`);
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
    { label: t('analysis.gamesAnalyzed'), value: t('format.games', { n: agg.games }) },
    { label: t('analysis.record'), value: t('analysis.recordValue', { wins: agg.wins, losses: agg.losses, draws: agg.draws, rate: agg.winRate }) },
    { label: t('analysis.avgTurns'), value: t('format.turns', { n: agg.avgTurns }) },
    { label: t('analysis.avgScore'), value: t('format.points', { n: agg.avgScore }) },
    ...(agg.starTotal > 0 ? [{ label: t('analysis.starsEarned'), value: `${agg.totalStars}/${agg.starTotal}` }] : []),
    {
      label: t('analysis.productionShare'),
      value: UNIT_TYPES.map((type) => `${unitName(type)} ${agg.productionShare[type] ?? 0}%`).join(' · '),
    },
    {
      label: t('analysis.uniqueTraits'),
      value: t('analysis.uniqueTraitsValue', {
        brace: agg.braceActivations,
        plunder: agg.plunderGold,
        pierce: agg.armorPiercingAttacks,
      }),
    },
  ]);
  const groups = (title: string, rows: { label: string; games: number; wins: number; avgTurns: number }[]): string =>
    rows.length > 0
      ? `<div class="an-block"><h2>${escapeHtml(title)}</h2>${rows
          .map(
            (g) =>
              `<p class="an-line">${escapeHtml(g.label)} — ${escapeHtml(t('analysis.groupRow', { games: g.games, wins: g.wins, turns: g.avgTurns }))}</p>`,
          )
          .join('')}</div>`
      : '';
  const lossReasons =
    agg.commonLossReasons.length > 0
      ? `<div class="an-block"><h2>${escapeHtml(t('analysis.commonLosses'))}</h2>${agg.commonLossReasons
          .map((r) => `<p class="an-line">✧ ${escapeHtml(r.reason)} · ${escapeHtml(t('analysis.count', { n: r.count }))}</p>`)
          .join('')}</div>`
      : '';
  const trend = agg.trend
    ? `<div class="an-block"><h2>${escapeHtml(t('analysis.trend'))}</h2>
        <p class="an-line">${escapeHtml(t('analysis.winRateTrend', { before: agg.trend.previousWinRate, after: agg.trend.recentWinRate }))}</p>
        <p class="an-line">${escapeHtml(t('analysis.turnTrend', { before: agg.trend.previousAvgTurns, after: agg.trend.recentAvgTurns }))}</p></div>`
    : '';
  const notes =
    coaching.length > 0
      ? `<div class="an-block"><h2>${escapeHtml(t('analysis.advice'))}</h2>${coaching
          .map((c) => `<p class="an-line">${noteIcon(c.kind)} ${escapeHtml(c.text)}</p>`)
          .join('')}</div>`
      : '';
  overlay.show(`
      <h1 style="font-size:22px;">${escapeHtml(t('analysis.recordAnalysis'))}</h1>
      ${summary}
      ${groups(t('analysis.byFaction'), agg.byFaction)}
      ${groups(t('analysis.byScenario'), agg.byScenario)}
      ${groups(t('analysis.byDifficulty'), agg.byDifficulty)}
      ${lossReasons}
      ${trend}
      ${notes}
      <div style="display:flex; gap:8px; width:min(300px,82vw);">
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-ex-json">JSON</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-ex-md">Markdown</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-ex-csv">CSV</button>
      </div>
      <button class="sub-btn" id="btn-back">${escapeHtml(t('common.back'))}</button>`);
  overlay.bind({
    'btn-ex-json': () => handlers.onExport('json'),
    'btn-ex-md': () => handlers.onExport('md'),
    'btn-ex-csv': () => handlers.onExport('csv'),
    'btn-back': handlers.onBack,
  });
}

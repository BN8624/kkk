// 한 줄 목적: 전략 왕국 선택·전투 요약·캠페인 결과 오버레이 화면을 렌더링한다
import { FACTION_IDS } from '../../core/data';
import type { FactionId } from '../../core/types';
import type { StrategicGameState, TacticalBattleReport } from '../../strategic/types';
import { computeStrategicScores } from '../../strategic/turn';
import { factionName, t } from '../../i18n';
import { escapeHtml, resultTableHtml } from '../shared/dom';
import type { OverlayHost } from '../shared/overlay';
import { strategicRegionName } from './map-view';

/** 왕국 선택(새 전략 전쟁). */
export function showStrategicFactionPick(
  overlay: OverlayHost,
  opts: {
    onStart: (faction: FactionId) => void;
    onBack: () => void;
  },
): void {
  let selected: FactionId = 'azure';
  const factionBtns = FACTION_IDS.map(
    (f) =>
      `<button class="sub-btn faction-pick" data-faction="${f}" id="sf-${f}" aria-pressed="${f === selected}">${escapeHtml(factionName(f))}</button>`,
  ).join('');
  overlay.show(`
    <h1 style="font-size:24px;">${escapeHtml(t('strategic.pickTitle'))}</h1>
    <p class="subtitle">${escapeHtml(t('title.tagline')).replace('\n', '<br>')}</p>
    ${factionBtns}
    <button class="big-btn" id="sf-start">${escapeHtml(t('strategic.pickStart'))}</button>
    <button class="sub-btn" id="sf-back">${escapeHtml(t('common.back'))}</button>`);
  const root = overlay.element;
  const refreshPressed = () => {
    for (const f of FACTION_IDS) {
      const btn = root.querySelector(`#sf-${f}`);
      if (btn) btn.setAttribute('aria-pressed', f === selected ? 'true' : 'false');
    }
  };
  for (const f of FACTION_IDS) {
    root.querySelector(`#sf-${f}`)?.addEventListener('click', () => {
      selected = f;
      refreshPressed();
    });
  }
  overlay.bind({
    'sf-start': () => opts.onStart(selected),
    'sf-back': opts.onBack,
  });
}

/** 전술 전투 후 전략 요약. */
export function showStrategicBattleSummary(
  overlay: OverlayHost,
  opts: {
    state: StrategicGameState;
    report: TacticalBattleReport;
    regionId: string;
    attackerArmyId: string;
    defenderArmyId: string;
    previousOwner: FactionId | null;
    onReturn: () => void;
  },
): void {
  const me = opts.state.humanFaction;
  const resultWord =
    opts.report.winner === 'draw'
      ? t('strategic.result.draw')
      : opts.report.winner === me
        ? t('strategic.result.win')
        : t('strategic.result.lose');
  const atkLoss = opts.report.losses.filter((l) => l.armyId === opts.attackerArmyId).length;
  const defLoss = opts.report.losses.filter((l) => l.armyId === opts.defenderArmyId).length;
  const atkSurv = opts.report.survivingUnits.filter((s) => s.armyId === opts.attackerArmyId).length;
  const defSurv = opts.report.survivingUnits.filter((s) => s.armyId === opts.defenderArmyId).length;
  const region = opts.state.regions.find((r) => r.id === opts.regionId);
  const ownerNow = region?.owner ?? null;
  const ownerText =
    ownerNow === null ? t('strategic.region.neutral') : factionName(ownerNow);
  const hpLines = opts.report.survivingUnits
    .map(
      (s) =>
        `<div class="row">${escapeHtml(s.strategicUnitId)} · ${escapeHtml(factionName(s.faction))} · HP ${s.hp}</div>`,
    )
    .join('');
  const retreat =
    opts.report.retreatingArmyIds.length > 0
      ? opts.report.retreatingArmyIds.join(', ')
      : '—';
  overlay.show(`
    <h1 style="font-size:24px;">${escapeHtml(t('strategic.battle.summary'))}</h1>
    <p class="subtitle">${escapeHtml(t('strategic.battle.winner', { result: resultWord }))}</p>
    ${resultTableHtml([
      { label: t('strategic.battle.region', { region: '' }).replace(/\s*$/, ''), value: strategicRegionName(opts.regionId) },
      { label: t('strategic.battle.attacker', { army: '' }).replace(/\s*$/, ''), value: opts.attackerArmyId },
      { label: t('strategic.battle.defender', { army: '' }).replace(/\s*$/, ''), value: opts.defenderArmyId },
      { label: t('strategic.battle.losses', { a: atkLoss, d: defLoss }), value: '' },
      { label: t('strategic.battle.survivors', { a: atkSurv, d: defSurv }), value: '' },
      { label: t('strategic.battle.ownerChange', { owner: ownerText }), value: '' },
      { label: t('strategic.battle.retreat', { armies: retreat }), value: '' },
    ])}
    <div style="max-height:120px;overflow:auto;margin:8px 0;text-align:left;font-size:12px;">${hpLines}</div>
    <button class="big-btn" id="sb-return">${escapeHtml(t('strategic.battle.return'))}</button>`);
  void opts.previousOwner;
  overlay.bind({ 'sb-return': opts.onReturn });
}

/** 전략 캠페인 종료 결과. */
export function showStrategicCampaignResult(
  overlay: OverlayHost,
  state: StrategicGameState,
  opts: {
    onNew: () => void;
    onTitle: () => void;
  },
): void {
  const me = state.humanFaction;
  const word =
    state.winner === 'draw'
      ? t('strategic.result.draw')
      : state.winner === me
        ? t('strategic.result.win')
        : t('strategic.result.lose');
  const scores = computeStrategicScores(state);
  const scoreLines = FACTION_IDS.map((f) => ({
    label: t('strategic.result.score', { faction: factionName(f), score: scores[f] }),
    value: `${state.regions.filter((r) => r.owner === f).length} / ${state.armies.filter((a) => a.faction === f).length}`,
  }));
  overlay.show(`
    <h1 class="result-word ${state.winner === me ? 'win' : 'lose'}" style="font-size:32px;">${escapeHtml(word)}</h1>
    <p class="subtitle">${escapeHtml(t('strategic.result.title'))}</p>
    <p class="subtitle">${escapeHtml(factionName(me))} · ${escapeHtml(t('strategic.result.turn', { turn: state.turn }))}</p>
    ${resultTableHtml(scoreLines)}
    <button class="big-btn" id="sr-new">${escapeHtml(t('strategic.result.new'))}</button>
    <button class="sub-btn" id="sr-title">${escapeHtml(t('strategic.result.toTitle'))}</button>`);
  overlay.bind({
    'sr-new': opts.onNew,
    'sr-title': opts.onTitle,
  });
}

// 한 줄 목적: 캠페인 선택 화면과 미션 도입 화면(짧은 도입·별 조건·기록)을 렌더링한다
import { isLegacyMissionProgress } from '../../core/campaign/progress';
import type { CampaignDocument, CampaignMission, MissionProgress } from '../../core/campaign/types';
import { campaignText, factionName, missionText, t } from '../../i18n';
import { describeStar } from '../editor';
import { escapeHtml } from '../shared/dom';
import type { OverlayHost } from '../shared/overlay';

export interface CampaignMissionView {
  mission: CampaignMission;
  unlocked: boolean;
  progress: MissionProgress | null;
}

export interface CampaignView {
  campaign: CampaignDocument;
  missions: CampaignMissionView[];
  /** 이 캠페인에서 얻은 별 합계 */
  stars: number;
}

function starsHtml(earned: number, total = 3): string {
  return '★'.repeat(earned) + '☆'.repeat(Math.max(0, total - earned));
}

/** 캠페인 선택 화면: 왕국별 미션 목록·해금 상태·최고 별. */
export function showCampaignScreen(
  overlay: OverlayHost,
  views: CampaignView[],
  handlers: { onMission: (mission: CampaignMission) => void; onBack: () => void },
): void {
  const sections = views
    .map((v) => {
      const rows = v.missions
        .map((mv, i) => {
          const p = mv.progress;
          if (!mv.unlocked) {
            return `
            <div class="rp-item cp-locked">
              <div class="rp-main"><span class="rp-title">🔒 ${i + 1}. ${escapeHtml(missionText(mv.mission.id, 'title', mv.mission.title))}</span>
              <span class="rp-sub">${escapeHtml(t('campaign.locked'))}</span></div>
            </div>`;
          }
          const legacy = isLegacyMissionProgress(p ?? undefined)
            ? ` · ${t('campaign.legacyRecord')}`
            : '';
          const sub = p?.won
            ? `${starsHtml(p.bestStars)} · ${t('campaign.best', { score: p.bestScore, turns: p.bestTurns ?? 0 })}${legacy}`
            : (p ? t('campaign.inProgress') : t('campaign.notStarted'));
          return `
          <div class="rp-item" data-m="${escapeHtml(mv.mission.id)}">
            <button class="rp-main" data-act="open">
              <span class="rp-title"><b>${i + 1}. ${escapeHtml(missionText(mv.mission.id, 'title', mv.mission.title))}</b></span>
              <span class="rp-sub">${escapeHtml(sub)}</span>
            </button>
          </div>`;
        })
        .join('');
      return `
      <p class="subtitle cp-kingdom">${escapeHtml(factionName(v.campaign.faction))} — ${escapeHtml(campaignText(v.campaign.id, 'title', v.campaign.title))}
        <span class="cp-stars">${v.stars}★</span></p>
      <div class="rp-list">${rows}</div>`;
    })
    .join('');
  const root = overlay.show(`
      <h1 style="font-size:24px;">${escapeHtml(t('campaign.title'))}</h1>
      <p class="subtitle" style="font-size:12.5px;">${escapeHtml(t('campaign.subtitle'))}</p>
      ${sections}
      <button class="sub-btn" id="btn-back">${escapeHtml(t('common.back'))}</button>`);
  const byId = new Map(views.flatMap((v) => v.missions.map((m) => [m.mission.id, m.mission])));
  for (const row of root.querySelectorAll<HTMLElement>('.rp-item[data-m]')) {
    row.querySelector('[data-act="open"]')!.addEventListener('click', () => {
      const m = byId.get(row.dataset.m!);
      if (m) handlers.onMission(m);
    });
  }
  overlay.bind({ 'btn-back': handlers.onBack });
}

/** 미션 도입 화면: 짧은 도입 문구·별 조건·최고 기록·시작. */
export function showMissionIntroScreen(
  overlay: OverlayHost,
  mission: CampaignMission,
  progress: MissionProgress | null,
  handlers: { onStart: () => void; onBack: () => void },
): void {
  const stars = (mission.scenario.starConditions ?? [])
    .map((c) => `<div class="cp-star-line">☆ ${escapeHtml(describeStar(c))}</div>`)
    .join('');
  overlay.show(`
      <h1 style="font-size:24px;">${escapeHtml(missionText(mission.id, 'title', mission.title))}</h1>
      <p class="subtitle cp-intro">${escapeHtml(missionText(mission.id, 'intro', mission.intro))}</p>
      ${stars ? `<div class="cp-star-list">${stars}</div>` : ''}
      ${
        progress?.won
          ? `<p class="subtitle" style="font-size:12.5px;">${escapeHtml(t('campaign.bestRecord', { stars: starsHtml(progress.bestStars), score: progress.bestScore, turns: progress.bestTurns ?? 0 }))}</p>`
          : ''
      }
      <button class="big-btn" id="btn-start">${escapeHtml(t('campaign.deploy'))}</button>
      <button class="sub-btn" id="btn-back">${escapeHtml(t('common.back'))}</button>`);
  overlay.bind({ 'btn-start': handlers.onStart, 'btn-back': handlers.onBack });
}

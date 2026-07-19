// 한 줄 목적: 캠페인 목록·미션 소개·미션 시작·진행 저장·별점·캠페인 결과 화면을 담당한다
import { CAMPAIGNS, missionByScenarioId } from '../core/campaign/missions';
import {
  earnedStars,
  isMissionUnlocked,
  loadCampaignProgress,
  nextMission,
  recordMissionResult,
  saveCampaignProgress,
} from '../core/campaign/progress';
import type { CampaignDocument, CampaignMission } from '../core/campaign/types';
import { factionScore, newGameFromScenario } from '../core/game';
import { normalizeScenario } from '../core/scenario/normalize';
import { starsEarned } from '../core/scenario/objectives';
import type { GameState } from '../core/types';
import { showCampaignScreen, showMissionIntroScreen, type CampaignView } from '../ui/campaign';
import { escapeHtml } from '../ui/shared/dom';
import type { AppContext } from '../app/app-shell';
import type { AppController } from '../app/lifecycle';
import type { CampaignFlow } from '../app/navigation';

export class CampaignController implements AppController, CampaignFlow {
  constructor(private ctx: AppContext) {}

  show(): void {
    this.ctx.enterMode('campaign');
    const progress = loadCampaignProgress();
    const views: CampaignView[] = CAMPAIGNS.map((campaign) => ({
      campaign,
      stars: earnedStars(campaign, progress),
      missions: campaign.missions.map((mission) => ({
        mission,
        unlocked: isMissionUnlocked(campaign, progress, mission.id),
        progress: progress.missions[mission.id] ?? null,
      })),
    }));
    showCampaignScreen(this.ctx.overlay, views, {
      onMission: (m) => this.showMissionIntro(m),
      onBack: () => this.ctx.nav.toTitle(),
    });
  }

  showMissionIntro(mission: CampaignMission): void {
    const progress = loadCampaignProgress();
    showMissionIntroScreen(this.ctx.overlay, mission, progress.missions[mission.id] ?? null, {
      onStart: () => this.startMission(mission),
      onBack: () => this.show(),
    });
  }

  startMission(mission: CampaignMission): void {
    let state: GameState;
    try {
      state = newGameFromScenario(Date.now() >>> 0, normalizeScenario(mission.scenario), {
        mode: 'campaign',
        difficulty: 'normal',
      });
    } catch {
      this.ctx.hud.toast('미션을 시작할 수 없습니다');
      return;
    }
    this.ctx.nav.launch(state);
  }

  /** 캠페인 미션 종료면 진행을 반영하고 결과 화면을 예약한다. 처리했으면 true. */
  handleGameEnd(state: GameState): boolean {
    if (state.config.mode !== 'campaign') return false;
    const found = missionByScenarioId(state.config.scenario);
    if (!found) return false;
    const me = state.config.humanFaction;
    const won = state.winner === me;
    const stars = starsEarned(state).filter(Boolean).length;
    saveCampaignProgress(
      recordMissionResult(loadCampaignProgress(), found.mission.id, {
        won,
        stars,
        score: factionScore(state, me),
        turns: Math.min(state.turn, state.maxTurns),
        survivors: state.units.filter((u) => u.faction === me).length,
        playedAt: new Date().toISOString(),
      }),
    );
    const token = this.ctx.currentToken();
    window.setTimeout(() => {
      if (token.alive) this.showResult(state, found.campaign, found.mission, won ? stars : 0);
    }, 700);
    return true;
  }

  /** 캠페인 결과: 진행 저장 반영 후 완료 문구·별·다음 미션을 보여 준다. */
  private showResult(
    state: GameState,
    campaign: CampaignDocument,
    mission: CampaignMission,
    stars: number,
  ): void {
    const me = state.config.humanFaction;
    const won = state.winner === me;
    const word = won ? '승리' : state.winner === 'draw' ? '무승부' : '패배';
    const starTotal = mission.scenario.starConditions?.length ?? 3;
    const next = nextMission(campaign, mission.id);
    const nextUnlocked = next
      ? isMissionUnlocked(campaign, loadCampaignProgress(), next.id)
      : false;
    const overlay = this.ctx.overlay;
    overlay.show(`
      <h1 class="result-word ${won ? 'win' : 'lose'}" style="font-size:34px;">${word}</h1>
      <p class="subtitle cp-intro">${escapeHtml(won ? mission.completionText : mission.intro)}</p>
      <p class="subtitle">${'★'.repeat(stars)}${'☆'.repeat(Math.max(0, starTotal - stars))} · ${Math.min(state.turn, state.maxTurns)}턴 · ${factionScore(state, me)}점</p>
      ${won && next && nextUnlocked ? '<button class="big-btn" id="cp-next">다음 미션</button>' : ''}
      <button class="${won && next && nextUnlocked ? 'sub-btn' : 'big-btn'}" id="cp-retry">다시 도전</button>
      ${this.ctx.replays.hasLastReplay ? '<button class="sub-btn" id="cp-replay">리플레이 보기</button>' : ''}
      <button class="sub-btn" id="cp-campaign">캠페인 목록</button>
      <button class="sub-btn" id="cp-title">타이틀로</button>`);
    overlay.bind({
      'cp-next': () => {
        if (next) this.showMissionIntro(next);
      },
      'cp-retry': () => this.startMission(mission),
      'cp-replay': () => this.ctx.replays.openLastReplay(),
      'cp-campaign': () => this.show(),
      'cp-title': () => this.ctx.nav.toTitle(),
    });
  }

  dispose(): void {}
}

// 한 줄 목적: 전략 모드 흐름(시작·명령·AI·자동전투·전술 진입·결과)을 소유한다
import { FACTION_IDS } from '../core/data';
import { newGameFromScenario } from '../core/game';
import { normalizeScenario } from '../core/scenario/normalize';
import { isPlayable, validateScenario } from '../core/scenario/validate';
import type { FactionId, GameState } from '../core/types';
import { runStrategicAiFaction } from '../strategic/ai';
import { autoResolveAndApply } from '../strategic/auto-resolve';
import {
  applyTacticalBattleReport,
  buildTacticalBattleReport,
  prepareStrategicBattle,
  validateTacticalBattleReport,
} from '../strategic/battle-bridge';
import {
  clearStrategicBattleStorage,
  loadStrategicBattleFromStorage,
  saveStrategicBattleToStorage,
  validateStrategicBattleSaveMatch,
} from '../strategic/battle-session-save';
import { strategicStateDigest } from '../strategic/digest';
import { applyStrategicOrder, validateStrategicOrder } from '../strategic/orders';
import {
  clearStrategicStorage,
  loadStrategicFromStorage,
  saveStrategicToStorage,
} from '../strategic/save';
import { createStrategicState } from '../strategic/state';
import {
  advanceStrategicFaction,
  applyWinnerIfAny,
  computeStrategicScores,
} from '../strategic/turn';
import type { StrategicGameState } from '../strategic/types';
import { factionName, t } from '../i18n';
import type { AppContext } from '../app/app-shell';
import type { AppController } from '../app/lifecycle';
import type { StrategicFlow } from '../app/navigation';
import {
  ensureStrategicHost,
  hideStrategicScreen,
  renderStrategicScreen,
  showStrategicBattleSummary,
  showStrategicCampaignResult,
  showStrategicFactionPick,
  strategicRegionName,
} from '../ui/strategic';

function seedFromUrlOrNow(): number {
  try {
    const q = new URLSearchParams(window.location.search).get('seed');
    if (q !== null && q !== '') {
      const n = Number(q);
      if (Number.isFinite(n) && Number.isInteger(n)) return n >>> 0;
    }
  } catch {
    // ignore
  }
  return Date.now() >>> 0;
}

export class StrategicController implements AppController, StrategicFlow {
  private _state: StrategicGameState | null = null;
  private selectedArmyId: string | null = null;
  private moveTargets: string[] = [];
  private busy = false;
  private log: string[] = [];
  private host: HTMLElement | null = null;
  constructor(private ctx: AppContext) {}

  dispose(): void {
    this.hideUi();
  }

  get state(): StrategicGameState | null {
    return this._state;
  }

  /** 타이틀에서 전략 진입(저장 없으면 왕국 선택). */
  show(): void {
    this.ctx.enterMode('strategic');
    this.ctx.sleepBoard();
    this.ctx.hud.setPlayControlsVisible(false);
    this.host = ensureStrategicHost(this.ctx.hudRoot);
    if (this._state) {
      this.refresh();
      return;
    }
    const saved = loadStrategicFromStorage();
    if (saved) {
      this._state = saved;
      this.refresh();
      void this.resumeAfterLoad();
      return;
    }
    this.showFactionPick();
  }

  /** 확인 후 기존 저장 삭제·왕국 선택(새 전략 전쟁). */
  beginNewCampaign(): void {
    clearStrategicBattleStorage();
    clearStrategicStorage();
    this._state = null;
    this.selectedArmyId = null;
    this.moveTargets = [];
    this.log = [];
    this.ctx.enterMode('strategic');
    this.ctx.sleepBoard();
    this.ctx.hud.setPlayControlsVisible(false);
    this.host = ensureStrategicHost(this.ctx.hudRoot);
    if (this.host) hideStrategicScreen(this.host);
    this.showFactionPick();
  }

  startNew(faction: FactionId, seed: number): void {
    clearStrategicBattleStorage();
    clearStrategicStorage();
    try {
      this._state = createStrategicState(seed, faction);
    } catch {
      this.ctx.hud.toast(t('strategic.error.start'));
      return;
    }
    this.selectedArmyId = null;
    this.moveTargets = [];
    this.log = [];
    this.persist();
    this.ctx.enterMode('strategic');
    this.ctx.sleepBoard();
    this.ctx.hud.setPlayControlsVisible(false);
    this.ctx.overlay.hide();
    this.host = ensureStrategicHost(this.ctx.hudRoot);
    this.refresh();
  }

  continueSaved(): void {
    const battle = loadStrategicBattleFromStorage();
    const saved = loadStrategicFromStorage();
    if (!saved) {
      this.ctx.hud.toast(t('strategic.error.load'));
      return;
    }
    this._state = saved;
    this.ctx.enterMode('strategic');
    this.ctx.sleepBoard();
    this.ctx.hud.setPlayControlsVisible(false);
    this.ctx.overlay.hide();
    this.host = ensureStrategicHost(this.ctx.hudRoot);

    if (battle && saved.pendingBattle) {
      const match = validateStrategicBattleSaveMatch(saved, battle);
      if (match.ok) {
        this.launchTacticalFromSave(battle.state);
        return;
      }
      // 손상 전투 저장만 폐기
      clearStrategicBattleStorage();
    }
    this.refresh();
    void this.resumeAfterLoad();
  }

  /** 전술 전투 종료 → report 반영 → 요약 → 지도 복귀 */
  handleTacticalGameEnd(gameState: GameState): void {
    const strategic = this._state;
    if (!strategic?.pendingBattle) {
      this.ctx.hud.toast(t('strategic.battle.failClosed'));
      this.returnToMap();
      return;
    }
    const ctx = strategic.pendingBattle;
    if (!gameState.over) {
      // 미종료면 임시 저장만 유지하고 지도로
      saveStrategicBattleToStorage(strategic, ctx.battleId, gameState);
      this.returnToMap();
      return;
    }

    const report = buildTacticalBattleReport(ctx, gameState);
    if (!report.ok) {
      this.ctx.hud.toast(t('strategic.battle.failClosed'));
      // 전투 저장 삭제 금지
      this.returnToMap();
      return;
    }
    const validated = validateTacticalBattleReport(strategic, report.value);
    if (!validated.ok) {
      this.ctx.hud.toast(t('strategic.battle.failClosed'));
      this.returnToMap();
      return;
    }

    const prevOwner =
      strategic.regions.find((r) => r.id === ctx.regionId)?.owner ?? null;
    const applied = applyTacticalBattleReport(strategic, report.value);
    if (!applied.ok) {
      this.ctx.hud.toast(t('strategic.battle.failClosed'));
      this.returnToMap();
      return;
    }

    let next = applied.value;
    const win = applyWinnerIfAny(next);
    if (win.ok) next = win.value;
    this._state = next;
    clearStrategicBattleStorage();
    this.persist();

    this.ctx.play.clearTestPlayUi();
    // play state 정리는 PlayController가 abandon/clear 경로로 처리
    this.ctx.sleepBoard();
    this.ctx.hud.setPlayControlsVisible(false);
    this.ctx.enterMode('strategic');
    this.host = ensureStrategicHost(this.ctx.hudRoot);
    hideStrategicScreen(this.host);

    showStrategicBattleSummary(this.ctx.overlay, {
      state: next,
      report: report.value,
      regionId: ctx.regionId,
      attackerArmyId: ctx.attackerArmyId,
      defenderArmyId: ctx.defenderArmyId,
      previousOwner: prevOwner,
      onReturn: () => {
        this.ctx.overlay.hide();
        void this.afterBattleResume();
      },
    });
  }

  persistOnExit(): void {
    if (this._state && this._state.phase !== 'ended') {
      saveStrategicToStorage(this._state);
    }
  }

  /** 타이틀로 나갈 때 루트만 숨김(저장 유지). */
  hideUi(): void {
    if (this.host) hideStrategicScreen(this.host);
  }

  private showFactionPick(): void {
    this.ctx.enterMode('strategic');
    showStrategicFactionPick(this.ctx.overlay, {
      onStart: (faction) => this.startNew(faction, seedFromUrlOrNow()),
      onBack: () => this.ctx.nav.toTitle(),
    });
  }

  private persist(): void {
    if (this._state) saveStrategicToStorage(this._state);
  }

  private refresh(): void {
    if (!this._state || !this.host) return;
    if (this._state.phase === 'ended' || this._state.winner !== undefined) {
      this.showCampaignResult();
      return;
    }
    renderStrategicScreen({
      state: this._state,
      selectedArmyId: this.selectedArmyId,
      moveTargets: this.moveTargets,
      busy: this.busy,
      log: this.log.slice(-5),
      host: this.host,
      handlers: {
        onRegion: (id) => this.onRegionTap(id),
        onSelectArmy: (id) => this.selectArmy(id),
        onHold: () => this.issueHold(),
        onReplenish: () => this.issueReplenish(),
        onEndTurn: () => void this.endHumanTurn(),
        onTitle: () => {
          this.persist();
          this.hideUi();
          this.ctx.nav.toTitle();
        },
      },
    });
  }

  private selectArmy(armyId: string): void {
    const state = this._state;
    if (!state || this.busy) return;
    const army = state.armies.find((a) => a.id === armyId);
    if (!army) return;
    this.selectedArmyId = armyId;
    this.moveTargets = [];
    if (
      army.faction === state.humanFaction &&
      !army.moved &&
      state.currentFaction === state.humanFaction &&
      state.phase === 'orders'
    ) {
      const region = state.regions.find((r) => r.id === army.regionId);
      if (region) {
        this.moveTargets = region.neighbors.filter((nid) =>
          validateStrategicOrder(
            state,
            { type: 'move-army', armyId, toRegionId: nid },
            state.humanFaction,
          ).ok,
        );
      }
    }
    this.refresh();
  }

  private onRegionTap(regionId: string): void {
    const state = this._state;
    if (!state || this.busy) return;

    // 이동 대상이면 이동 확인
    if (
      this.selectedArmyId &&
      this.moveTargets.includes(regionId) &&
      state.currentFaction === state.humanFaction
    ) {
      void this.tryMove(this.selectedArmyId, regionId);
      return;
    }

    // 해당 지역 아군 군단 선택
    const mine = state.armies.find(
      (a) => a.regionId === regionId && a.faction === state.humanFaction,
    );
    if (mine) {
      this.selectArmy(mine.id);
      return;
    }
    // 선택 해제
    this.selectedArmyId = null;
    this.moveTargets = [];
    this.refresh();
  }

  private async tryMove(armyId: string, toRegionId: string): Promise<void> {
    const state = this._state;
    if (!state) return;
    const regionName = strategicRegionName(toRegionId);
    const occupants = state.armies.filter((a) => a.regionId === toRegionId);
    const enemies = occupants.filter((a) => a.faction !== state.humanFaction);
    const msg =
      enemies.length > 0
        ? t('strategic.battleConfirm', { region: regionName })
        : t('strategic.moveConfirm', { region: regionName });
    if (!window.confirm(msg)) return;

    const applied = applyStrategicOrder(
      state,
      { type: 'move-army', armyId, toRegionId },
      state.humanFaction,
    );
    if (!applied.ok) {
      this.ctx.hud.toast(t('strategic.error.order', { reason: applied.reason }));
      return;
    }
    this._state = applied.value;
    this.selectedArmyId = null;
    this.moveTargets = [];
    this.persist();
    await this.handlePendingOrContinue();
  }

  private issueHold(): void {
    const state = this._state;
    if (!state || !this.selectedArmyId || this.busy) return;
    const applied = applyStrategicOrder(
      state,
      { type: 'hold-army', armyId: this.selectedArmyId },
      state.humanFaction,
    );
    if (!applied.ok) {
      this.ctx.hud.toast(t('strategic.error.order', { reason: applied.reason }));
      return;
    }
    this._state = applied.value;
    this.moveTargets = [];
    this.persist();
    this.refresh();
  }

  private issueReplenish(): void {
    const state = this._state;
    if (!state || !this.selectedArmyId || this.busy) return;
    const applied = applyStrategicOrder(
      state,
      { type: 'replenish-army', armyId: this.selectedArmyId },
      state.humanFaction,
    );
    if (!applied.ok) {
      this.ctx.hud.toast(t('strategic.error.order', { reason: applied.reason }));
      return;
    }
    this._state = applied.value;
    this.moveTargets = [];
    this.persist();
    this.refresh();
  }

  private async endHumanTurn(): Promise<void> {
    const state = this._state;
    if (!state || this.busy) return;
    if (state.currentFaction !== state.humanFaction || state.phase !== 'orders') return;

    const unmoved = state.armies.filter(
      (a) => a.faction === state.humanFaction && !a.moved,
    );
    if (unmoved.length > 0) {
      if (!window.confirm(t('strategic.endTurnConfirm'))) return;
    }

    this.busy = true;
    this.refresh();
    const advanced = advanceStrategicFaction(state);
    if (!advanced.ok) {
      this.busy = false;
      this.ctx.hud.toast(t('strategic.error.order', { reason: advanced.reason }));
      this.refresh();
      return;
    }
    this._state = advanced.value;
    this.persist();
    await this.runAiUntilHumanOrEnd();
    this.busy = false;
    this.refresh();
  }

  private async resumeAfterLoad(): Promise<void> {
    if (!this._state) return;
    if (this._state.pendingBattle) {
      await this.handlePendingOrContinue();
      return;
    }
    if (
      this._state.phase === 'orders' &&
      this._state.currentFaction !== this._state.humanFaction &&
      this._state.winner === undefined
    ) {
      this.busy = true;
      this.refresh();
      await this.runAiUntilHumanOrEnd();
      this.busy = false;
      this.refresh();
    }
  }

  private async afterBattleResume(): Promise<void> {
    if (!this._state) return;
    if (this._state.winner !== undefined || this._state.phase === 'ended') {
      this.showCampaignResult();
      return;
    }
    // 남은 AI 페이즈 계속
    if (this._state.currentFaction !== this._state.humanFaction) {
      this.busy = true;
      this.refresh();
      await this.runAiUntilHumanOrEnd();
      this.busy = false;
    }
    this.refresh();
  }

  private async runAiUntilHumanOrEnd(): Promise<void> {
    let guard = 0;
    while (this._state && guard++ < 40) {
      const s = this._state;
      if (s.winner !== undefined || s.phase === 'ended') break;
      if (s.pendingBattle) {
        await this.resolveOrLaunchBattle();
        if (this._state?.pendingBattle) break; // human tactical launched
        continue;
      }
      if (s.phase !== 'orders') break;
      if (s.currentFaction === s.humanFaction) break;

      const ai = runStrategicAiFaction(s);
      if (!ai.ok) break;
      this._state = ai.value;
      this.pushLog(t('strategic.log.aiActed', { faction: factionName(s.currentFaction) }));
      this.persist();

      if (this._state.pendingBattle) {
        await this.resolveOrLaunchBattle();
        if (this._state?.pendingBattle) break;
        continue;
      }

      const adv = advanceStrategicFaction(this._state);
      if (!adv.ok) break;
      this._state = adv.value;
      this.persist();
    }
  }

  private async handlePendingOrContinue(): Promise<void> {
    if (!this._state?.pendingBattle) {
      this.refresh();
      return;
    }
    await this.resolveOrLaunchBattle();
    if (!this._state?.pendingBattle && this._state) {
      // 자동 해결 후 인간 턴이 아니면 AI 계속
      if (
        this._state.currentFaction !== this._state.humanFaction &&
        this._state.winner === undefined
      ) {
        this.busy = true;
        this.refresh();
        await this.runAiUntilHumanOrEnd();
        this.busy = false;
      }
    }
    this.refresh();
  }

  private async resolveOrLaunchBattle(): Promise<void> {
    const state = this._state;
    if (!state?.pendingBattle) return;

    const prep = prepareStrategicBattle(state);
    if (!prep.ok) {
      this.ctx.hud.toast(t('strategic.error.order', { reason: prep.reason }));
      return;
    }

    if (prep.value.kind === 'auto-resolve-required') {
      const regionId = state.pendingBattle.regionId;
      const applied = autoResolveAndApply(state);
      if (!applied.ok) {
        this.ctx.hud.toast(t('strategic.error.order', { reason: applied.reason }));
        return;
      }
      let next = applied.value;
      const win = applyWinnerIfAny(next);
      if (win.ok) next = win.value;
      this._state = next;
      this.pushLog(
        t('strategic.log.autoBattle', {
          region: strategicRegionName(regionId),
          result:
            next.winner !== undefined
              ? String(next.winner)
              : 'ok',
        }),
      );
      this.persist();
      return;
    }

    // human-tactical
    const { scenario, context } = prep.value;
    if (!isPlayable(validateScenario(scenario))) {
      this.ctx.hud.toast(t('strategic.battle.failClosed'));
      return;
    }
    this.ctx.hud.toast(t('strategic.battle.loading'));
    let game: GameState;
    try {
      game = newGameFromScenario(context.battleSeed, normalizeScenario(scenario), {
        mode: 'custom',
        difficulty: 'normal',
        humanFaction: state.humanFaction,
      });
    } catch {
      this.ctx.hud.toast(t('strategic.error.start'));
      return;
    }
    this.persist();
    saveStrategicBattleToStorage(state, context.battleId, game);
    if (this.host) hideStrategicScreen(this.host);
    this.ctx.nav.launch(game, {
      strategicBattle: { battleId: context.battleId },
    });
  }

  private launchTacticalFromSave(game: GameState): void {
    if (!this._state?.pendingBattle) return;
    if (this.host) hideStrategicScreen(this.host);
    this.ctx.nav.launch(game, {
      strategicBattle: { battleId: this._state.pendingBattle.battleId },
    });
  }

  private returnToMap(): void {
    this.ctx.sleepBoard();
    this.ctx.hud.setPlayControlsVisible(false);
    this.ctx.enterMode('strategic');
    this.host = ensureStrategicHost(this.ctx.hudRoot);
    this.refresh();
  }

  private showCampaignResult(): void {
    if (!this._state) return;
    if (this.host) hideStrategicScreen(this.host);
    // 결과 확정 시 저장은 유지(즉시 삭제 금지)
    this.persist();
    showStrategicCampaignResult(this.ctx.overlay, this._state, {
      onNew: () => {
        if (!window.confirm(t('title.strategicNewConfirm'))) return;
        this.showFactionPick();
      },
      onTitle: () => {
        this.hideUi();
        this.ctx.nav.toTitle();
      },
    });
    void computeStrategicScores;
    void FACTION_IDS;
  }

  private pushLog(line: string): void {
    this.log.push(line);
    if (this.log.length > 20) this.log.shift();
  }

  /** 테스트 브리지용 */
  testSelectedArmy(): string | null {
    return this.selectedArmyId;
  }

  testDigest(): string | null {
    return this._state ? strategicStateDigest(this._state) : null;
  }
}

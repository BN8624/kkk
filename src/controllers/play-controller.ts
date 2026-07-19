// 한 줄 목적: 일반 플레이(빠른 전투·일일 도전·캠페인·테스트 플레이)의 상태·입력·턴 진행·결과를 담당한다
import { runAiTurn } from '../core/ai';
import { humanFaction, isHumanTurn, tileAt, unitAt, unitById } from '../core/board';
import { findEvent, issueCommand } from '../core/command';
import { BUILDING_NAMES, DIFFICULTY_NAMES, FACTION_NAMES, UNIT_NAMES } from '../core/data';
import { MODIFIERS, shareText, todayKey, type ModifierId } from '../core/daily';
import { DOCTRINES } from '../core/doctrines';
import { attackTargets, forecastAttack, newGame, unitCost } from '../core/game';
import { reachableDestinations } from '../core/pathfind';
import { loadRecords, recordGame, saveRecords, type RecordOutcome } from '../core/records';
import { clearSave, loadGame, saveGame, saveSettings } from '../core/save';
import { SCENARIO_IDS, SCENARIOS, scenarioDisplayName } from '../core/scenarios';
import type { Axial, FactionId, GameState, ScenarioId, Tile, Unit, UnitTypeId } from '../core/types';
import { playEvents } from '../render/event-player';
import { setSoundEnabled, sfx } from '../render/sound';
import { ObservationTracker } from '../replay/observation';
import { TestPlayBar } from '../ui/editor/testplay';
import { showPauseScreen, showResultScreen } from '../ui/game/screens';
import { showSetupScreen, type GameSetup } from '../ui/setup';
import type { AppContext } from '../app/app-shell';
import type { AppController } from '../app/lifecycle';
import type { LaunchOptions, PlaySession } from '../app/navigation';

const FACTION_TOKEN_DESC: Record<FactionId, string> = {
  azure: '남색',
  crimson: '진홍색',
  violet: '보라색',
};

function aiSpeedLabel(speed: number): string {
  return speed === 2 ? '2배속' : speed === 0 ? '건너뛰기' : '기본';
}

function describeFaction(f: FactionId): string {
  const d = DOCTRINES[f];
  return (
    `<b>${d.title}</b> — ${d.style}<br>` +
    `⚔ <b>${d.abilityName}</b> · ${d.abilityDesc}<br>` +
    `✦ ${d.bonusDesc} · ${d.startDesc}<br>` +
    `<span style="opacity:.75">${d.recommended}</span>`
  );
}

export class PlayController implements AppController, PlaySession {
  private _state: GameState | null = null;
  private selectedUnitId: number | null = null;
  private moveDests: Axial[] = [];
  private attackIds = new Set<number>();
  private productionTile: Tile | null = null;
  private _busy = false;
  private tutorialStep = 0; // 0 = 비활성
  private lastTapPos: { q: number; r: number } | null = null;
  private lastSetup: GameSetup | null = null;
  private pendingAttackId: number | null = null;
  private testPlay = false;
  private spectate = false;
  private testPlayBar: TestPlayBar | null = null;
  private observations = new ObservationTracker();
  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.observations.onHidden();
    else this.observations.onVisible();
  };

  constructor(private ctx: AppContext) {
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get state(): GameState | null {
    return this._state;
  }

  get busy(): boolean {
    return this._busy;
  }

  get lastTap(): { q: number; r: number } | null {
    return this.lastTapPos;
  }

  get destinations(): Axial[] {
    return this.moveDests;
  }

  private get scene() {
    return this.ctx.boardScene;
  }

  private human(): FactionId {
    return humanFaction(this._state!);
  }

  /** 일반 플레이 자동 저장. 테스트 플레이는 실제 저장을 오염시키지 않는다. */
  private persist(state: GameState): void {
    if (!this.testPlay) saveGame(state);
  }

  persistOnExit(): void {
    if (this._state && !this._state.over && !this.testPlay) saveGame(this._state);
  }

  /** 보드 씬 생성 직후 HUD를 현재 상태로 맞춘다. */
  refreshHudIfPlaying(): void {
    if (this.ctx.mode === 'play' && this._state) this.ctx.hud.updateTop(this._state);
  }

  // ---------------- 화면 ----------------

  showPause(): void {
    this.ctx.enterMode('settings');
    const settings = this.ctx.settings;
    showPauseScreen(this.ctx.overlay, {
      soundOn: settings.soundOn,
      aiSpeedLabel: aiSpeedLabel(settings.aiSpeed),
      onResume: () => {
        this.ctx.enterMode('play');
        this.ctx.overlay.hide();
      },
      onToggleSound: () => {
        settings.soundOn = !settings.soundOn;
        setSoundEnabled(settings.soundOn);
        saveSettings(settings);
        return settings.soundOn;
      },
      onCycleAiSpeed: () => {
        settings.aiSpeed = settings.aiSpeed === 1 ? 2 : settings.aiSpeed === 2 ? 0 : 1;
        saveSettings(settings);
        return aiSpeedLabel(settings.aiSpeed);
      },
      onReplayTutorial: () => {
        this.ctx.enterMode('play');
        this.ctx.overlay.hide();
        this.startTutorial();
      },
      onNewGame: () => this.showSetup(),
      onToTitle: () => this.ctx.nav.toTitle(),
    });
  }

  showSetup(): void {
    this.ctx.enterMode('setup');
    showSetupScreen(this.ctx.overlay, {
      describeFaction,
      scenarios: SCENARIO_IDS.map((id) => SCENARIOS[id]),
      initial: this.lastSetup ?? undefined,
      onStart: (sel) => {
        this.lastSetup = sel;
        const param = new URLSearchParams(location.search).get('seed');
        const seed = param ? Number(param) >>> 0 : Date.now() >>> 0;
        const state = newGame(seed, {
          humanFaction: sel.faction,
          scenario: sel.scenario as ScenarioId,
          difficulty: sel.difficulty,
        });
        this.launch(state);
        if (!this.ctx.settings.tutorialDone) this.startTutorial();
      },
      onBack: () => this.ctx.nav.toTitle(),
    });
  }

  continueGame(): void {
    const state = loadGame();
    if (!state) {
      this.ctx.hud.toast('저장된 게임이 없습니다');
      this.showSetup();
      return;
    }
    this.launch(state);
  }

  launch(state: GameState, opts: LaunchOptions = {}): void {
    if (opts.testPlay) this.ctx.editorFlow.suspendForTestPlay();
    else this.ctx.editorFlow.closeSession();
    this.testPlay = !!opts.testPlay;
    this.spectate = !!opts.spectate;
    this.testPlayBar?.destroy();
    this.testPlayBar = null;
    this.ctx.enterMode('play');
    this._state = state;
    this.selectedUnitId = null;
    this._busy = false;
    const hud = this.ctx.hud;
    this.ctx.overlay.hide();
    hud.setPlayControlsVisible(true);
    hud.hideProduction();
    hud.hideTutorial();
    hud.showUnitPanel(null, null, '');
    hud.updateTop(state);
    hud.setEndTurnEnabled(!this.spectate);
    this.persist(state);
    if (this.testPlay) {
      this.testPlayBar = new TestPlayBar(
        this.ctx.hudRoot,
        () => this._state,
        { onBackToEditor: () => this.ctx.editorFlow.returnFromTestPlay() },
      );
    }

    const scene = this.ctx.ensureBoard(state);
    scene.clearHighlights();
    scene.showSelection(null);
    this.observations.reset();
    // 끝난 게임이 저장돼 있던 극단적 경우: 즉시 결과 처리
    if (state.over) {
      this.finishGame();
      return;
    }
    // 저장 시점이 AI 차례였다면(또는 관전이면) 남은 AI 턴을 이어서 진행한다
    if (this.spectate || !isHumanTurn(state)) {
      void this.runAiPhases();
    } else {
      this.observations.markPhaseStart();
    }
  }

  /** 타이틀 이동 시 테스트 플레이 UI 요소만 정리한다(게임 상태는 유지). */
  clearTestPlayUi(): void {
    this.testPlay = false;
    this.spectate = false;
    this.testPlayBar?.destroy();
    this.testPlayBar = null;
  }

  /** 테스트 플레이를 결과 없이 중단한다(에디터 복귀 등). */
  abandonTestPlay(): void {
    this.testPlay = false;
    this.spectate = false;
    this.testPlayBar?.destroy();
    this.testPlayBar = null;
    this._state = null;
    this._busy = false;
    this.deselect();
    this.closeProduction();
    this.ctx.hud.setAiThinking(null);
  }

  // ---------------- 튜토리얼 ----------------

  private startTutorial(): void {
    this.tutorialStep = 1;
    this.showTutorial();
  }

  private showTutorial(): void {
    const total = 5;
    const color = FACTION_TOKEN_DESC[this._state ? this.human() : 'azure'];
    const hud = this.ctx.hud;
    switch (this.tutorialStep) {
      case 1:
        hud.showTutorialStep(1, total, `당신의 유닛(${color} 방패 토큰)을 탭하세요.`, null);
        break;
      case 2:
        hud.showTutorialStep(2, total, '금색으로 강조된 타일을 탭해 이동하세요.', null);
        break;
      case 3:
        hud.showTutorialStep(
          3,
          total,
          '사거리 안의 적은 붉게 표시됩니다. 적 토큰을 탭하면 전투 예측이 뜨고, 공격 버튼이나 한 번 더 탭하면 공격합니다.',
          '알겠습니다',
          () => this.advanceTutorial(4),
        );
        break;
      case 4:
        hud.showTutorialStep(
          4,
          total,
          '중립 마을에 유닛을 올리면 점령합니다. 점령한 거점은 매 턴 금을 생산하고, 수도와 마을에서는 새 유닛을 생산할 수 있습니다.',
          '알겠습니다',
          () => this.advanceTutorial(5),
        );
        break;
      case 5:
        hud.showTutorialStep(5, total, "오른쪽 아래 '턴 종료'를 누르면 적 세력들이 움직입니다.", null);
        break;
      default:
        hud.hideTutorial();
    }
  }

  private advanceTutorial(next: number): void {
    if (this.tutorialStep === 0) return;
    this.tutorialStep = next;
    if (next > 5) {
      this.tutorialStep = 0;
      this.ctx.settings.tutorialDone = true;
      saveSettings(this.ctx.settings);
      this.ctx.hud.hideTutorial();
    } else {
      this.showTutorial();
    }
  }

  // ---------------- 입력 처리 ----------------

  onTileTap(q: number, r: number): void {
    this.lastTapPos = { q, r };
    if (this.ctx.mode !== 'play') return; // 리플레이 재생 등에서는 보드 탭이 행동이 되지 않는다
    const state = this._state;
    if (!state || this._busy || state.over || !isHumanTurn(state)) return;
    if (this.productionTile) {
      this.closeProduction();
      return;
    }
    const tile = tileAt(state, q, r);
    if (!tile) {
      this.deselect();
      return;
    }
    const tappedUnit = unitAt(state, q, r);
    const selected = this.selectedUnitId ? unitById(state, this.selectedUnitId) : null;

    // 선택된 유닛의 공격: 첫 탭은 전투 예측, 같은 대상 재탭 또는 공격 버튼으로 확정
    if (selected && tappedUnit && this.attackIds.has(tappedUnit.id)) {
      if (this.pendingAttackId === tappedUnit.id) {
        void this.doAttack(selected.id, tappedUnit.id);
        return;
      }
      this.showForecast(selected, tappedUnit);
      return;
    }
    // 선택된 유닛의 이동
    if (selected && !tappedUnit && this.moveDests.some((d) => d.q === q && d.r === r)) {
      void this.doMove(selected.id, { q, r });
      return;
    }
    // 자기 유닛 선택
    if (tappedUnit && tappedUnit.faction === this.human()) {
      this.select(tappedUnit.id);
      return;
    }
    // 자기 거점(빈 타일) → 생산
    if (!tappedUnit && tile.building && tile.owner === this.human()) {
      this.openProduction(tile);
      return;
    }
    // 적 유닛 정보 보기
    if (tappedUnit) {
      this.deselect();
      this.ctx.hud.showUnitPanel(tappedUnit, null, '');
      return;
    }
    this.deselect();
  }

  private select(unitId: number): void {
    const state = this._state!;
    const unit = unitById(state, unitId)!;
    this.selectedUnitId = unitId;
    this.observations.onSelect();
    sfx.select();

    this.moveDests = unit.moved
      ? []
      : reachableDestinations(state, unit).map((e) => ({ q: e.q, r: e.r }));
    const targets = attackTargets(state, unit);
    this.attackIds = new Set(targets.map((t) => t.id));

    this.scene?.showSelection(unit);
    this.scene?.showHighlights(
      this.moveDests,
      targets.map((t) => ({ q: t.q, r: t.r })),
    );

    let hint: string;
    if (this.moveDests.length > 0 && targets.length > 0)
      hint = '강조된 타일로 이동하거나 붉은 칸의 적을 탭해 공격하세요';
    else if (this.moveDests.length > 0) hint = '강조된 타일을 탭해 이동하세요';
    else if (targets.length > 0) hint = '붉은 칸의 적을 탭해 공격하세요';
    else hint = '이번 턴 행동을 마친 유닛입니다';
    this.ctx.hud.showUnitPanel(unit, null, hint);

    if (this.tutorialStep === 1) this.advanceTutorial(2);
  }

  private deselect(): void {
    if (this.selectedUnitId !== null) this.observations.onDeselect();
    this.selectedUnitId = null;
    this.pendingAttackId = null;
    this.moveDests = [];
    this.attackIds.clear();
    this.scene?.clearHighlights();
    this.scene?.showSelection(null);
    this.ctx.hud.showUnitPanel(null, null, '');
  }

  /** 전투 예측 패널 표시(실제 엔진과 동일한 forecastAttack 사용) */
  private showForecast(attacker: Unit, defender: Unit): void {
    const state = this._state!;
    const fc = forecastAttack(state, attacker, defender);
    this.pendingAttackId = defender.id;
    const notes: string[] = [];
    if (fc.damage.atkBonus > 0) notes.push(`능력·수정자 공격 +${fc.damage.atkBonus}`);
    const defTotal = fc.damage.terrainDef + fc.damage.doctrineDef;
    if (defTotal > 0) notes.push(`상대 지형·거점 방어 +${defTotal}`);
    this.ctx.hud.showForecast({
      attackerName: UNIT_NAMES[attacker.type],
      defenderName: `${FACTION_NAMES[defender.faction]} ${UNIT_NAMES[defender.type]}`,
      damage: fc.damage.total,
      counter: fc.counter?.total ?? null,
      kill: fc.defenderDies,
      die: fc.attackerDies,
      notes,
      onConfirm: () => void this.doAttack(attacker.id, defender.id),
    });
  }

  // ---------------- 플레이어 행동 ----------------

  private async doMove(unitId: number, dest: Axial): Promise<void> {
    const state = this._state!;
    this._busy = true;
    this.scene?.clearHighlights();
    this.scene?.showSelection(null);
    const result = issueCommand(state, { type: 'move-unit', unitId, to: dest }, 'human');
    if (!result.ok) {
      this._busy = false;
      this.deselect();
      return;
    }
    this.observations.record(state, result.command.seq);
    sfx.move();
    const moved = findEvent(result.events, 'unit-moved')!;
    await this.scene?.animateMove(unitId, moved.path);
    const captured = findEvent(result.events, 'building-captured');
    if (captured) {
      sfx.capture();
      await this.scene?.animateCapture(captured.at, captured.building !== 'village');
      const gold = findEvent(result.events, 'gold-changed');
      const bonus = gold && gold.reason === 'capture-bonus' ? ` (+${gold.delta}금)` : '';
      this.ctx.hud.toast(`${BUILDING_NAMES[captured.building]} 점령!${bonus}`);
    }
    this.ctx.hud.updateTop(state);
    this.persist(state);
    this._busy = false;

    if (this.tutorialStep === 2) this.advanceTutorial(3);

    if (state.over) {
      this.finishGame();
      return;
    }
    // 이동 후 공격 가능하면 선택 유지
    const unit = unitById(state, unitId);
    if (unit && attackTargets(state, unit).length > 0) {
      this.select(unitId);
    } else {
      this.deselect();
    }
  }

  private async doAttack(attackerId: number, defenderId: number): Promise<void> {
    const state = this._state!;
    this._busy = true;
    this.scene?.clearHighlights();
    this.scene?.showSelection(null);
    const result = issueCommand(state, { type: 'attack-unit', attackerId, defenderId }, 'human');
    if (!result.ok) {
      this._busy = false;
      this.deselect();
      return;
    }
    this.observations.record(state, result.command.seq);
    sfx.attack();
    // 이벤트가 공격 시점 좌표를 보존하므로 사망 유닛도 정확한 위치에서 연출된다
    const atk = findEvent(result.events, 'unit-attacked')!;
    const counter = findEvent(result.events, 'unit-countered');
    await this.scene?.animateAttack({
      attackerId,
      attackerType: atk.attackerType,
      defenderId,
      defenderPos: atk.at,
      damage: atk.damage,
      counterDamage: counter?.damage,
      attackerPos: atk.from,
    });
    const defenderDied = result.events.some((e) => e.type === 'unit-died' && e.unitId === defenderId);
    const attackerDied = result.events.some((e) => e.type === 'unit-died' && e.unitId === attackerId);
    if (defenderDied || attackerDied) sfx.hit();
    if (defenderDied) this.ctx.hud.toast('적 유닛 처치!');
    this.ctx.hud.updateTop(state);
    this.persist(state);
    this._busy = false;
    this.deselect();
    if (state.over) this.finishGame();
  }

  // ---------------- 생산 ----------------

  private openProduction(tile: Tile): void {
    const state = this._state!;
    this.deselect();
    this.productionTile = tile;
    sfx.select();
    const gold = state.factions[this.human()].gold;
    this.ctx.hud.showProduction(
      BUILDING_NAMES[tile.building!],
      gold,
      (t) => unitCost(this.human(), t),
    );
  }

  closeProduction(): void {
    this.productionTile = null;
    this.ctx.hud.hideProduction();
  }

  produce(type: UnitTypeId): void {
    const state = this._state!;
    const tile = this.productionTile;
    if (!tile || this._busy) return;
    const result = issueCommand(
      state,
      { type: 'produce-unit', at: { q: tile.q, r: tile.r }, unitType: type },
      'human',
    );
    if (!result.ok) {
      this.ctx.hud.toast(
        result.reason === 'no-gold'
          ? '금이 부족합니다'
          : result.reason === 'unit-cap'
            ? '유닛 수가 최대입니다'
            : '지금은 생산할 수 없습니다',
      );
      return;
    }
    this.observations.record(state, result.command.seq);
    this.closeProduction();
    sfx.capture();
    const produced = findEvent(result.events, 'unit-produced')!;
    void this.scene?.animateSpawn(produced.unitId);
    this.ctx.hud.toast(`${UNIT_NAMES[type]} 생산 완료 — 다음 턴부터 행동합니다`);
    this.ctx.hud.updateTop(state);
    this.persist(state);
  }

  // ---------------- 턴 진행 ----------------

  async endTurn(): Promise<void> {
    const state = this._state;
    if (!state || this._busy || state.over || !isHumanTurn(state)) return;
    this.deselect();
    this.closeProduction();
    if (this.tutorialStep === 5) this.advanceTutorial(6);
    const result = issueCommand(state, { type: 'end-phase' }, 'human'); // 인간 페이즈 종료 → 다음 세력
    if (result.ok) this.observations.record(state, result.command.seq);
    await this.runAiPhases();
  }

  /** 현재 차례부터 인간 차례가 될 때까지 AI 페이즈를 연속 실행한다. */
  private async runAiPhases(): Promise<void> {
    const state = this._state!;
    this._busy = true;
    const hud = this.ctx.hud;
    hud.setEndTurnEnabled(false);
    this.scene?.setSpeed(this.ctx.settings.aiSpeed === 2 ? 2 : 1);
    // 관전(AI 대 AI 테스트)에서는 인간 차례도 AI가 대신 진행한다
    // (에디터 복귀 등으로 상태가 바뀌면 즉시 멈춘다)
    while (this._state === state && !state.over && (this.spectate || !isHumanTurn(state))) {
      const fid = state.current;
      hud.setAiThinking(fid);
      // 행동·페이즈 전환(END_PHASE 포함)을 동기적으로 확정한 뒤(페이즈 경계) 저장하고, 연출은 그 후 재생한다.
      // 연출 중 이탈해도 저장본은 항상 "다음 세력이 아직 행동하지 않은" 경계 상태라 중복 실행이 없다.
      const result = runAiTurn(state, fid);
      if (!state.over) this.persist(state);
      await playEvents(this.scene, result.events, this.ctx.settings.aiSpeed === 0);
      hud.updateTop(state);
    }
    hud.setAiThinking(null);
    this.scene?.setSpeed(1);
    if (this._state !== state) {
      // 진행 중 화면이 전환됨(테스트 플레이 → 에디터 복귀 등)
      this._busy = false;
      return;
    }
    this.scene?.refresh();
    hud.updateTop(state);

    if (state.over) {
      this.finishGame();
      this._busy = false;
      hud.setEndTurnEnabled(true);
      return;
    }
    this.persist(state);
    sfx.turn();
    // 카메라를 플레이어 진영으로 되돌린다
    const me = this.human();
    const home =
      state.tiles.find((t) => t.building === 'capital' && t.owner === me) ??
      state.units.find((u) => u.faction === me);
    if (home) this.scene?.panTo({ q: home.q, r: home.r });
    hud.toast(`${state.turn}턴 — 당신의 차례입니다`);
    this.observations.markPhaseStart();
    this._busy = false;
    hud.setEndTurnEnabled(true);
  }

  // ---------------- 종료 ----------------

  private finishGame(): void {
    const state = this._state!;
    this.deselect();
    this.ctx.hud.hideTutorial();
    if (state.winner === this.human()) sfx.win();
    else sfx.lose();

    const token = this.ctx.currentToken();
    // 테스트 플레이: 실제 저장·기록·리플레이 보관함을 건드리지 않는다
    if (this.testPlay) {
      window.setTimeout(() => {
        if (token.alive) this.ctx.editorFlow.handleTestPlayEnd(state);
      }, 500);
      return;
    }
    clearSave();

    // 기록 반영(1회)
    const records = loadRecords();
    const outcome = recordGame(
      records,
      state,
      state.config.mode === 'daily' ? todayKey() : undefined,
    );
    saveRecords(outcome.records);
    this.ctx.replays.captureReplay(state);

    // 캠페인: 진행(별·최고 기록·해금)을 반영하고 전용 결과 화면을 연다
    if (this.ctx.campaign.handleGameEnd(state)) return;

    window.setTimeout(() => {
      if (token.alive) this.showResult(state, outcome);
    }, 700);
  }

  private showResult(state: GameState, outcome: RecordOutcome): void {
    const modifier = state.config.modifier as ModifierId | undefined;
    showResultScreen(this.ctx.overlay, state, {
      scenarioName: scenarioDisplayName(state.config.scenario, state),
      difficultyName: DIFFICULTY_NAMES[state.config.difficulty],
      modifierName: modifier ? MODIFIERS[modifier]?.name : undefined,
      prevBest: outcome.prevBestScore,
      isNewBest: outcome.isNewBest,
      onOpenReplay: this.ctx.replays.hasLastReplay
        ? () => this.ctx.replays.openLastReplay()
        : undefined,
      onShare: () => void this.shareResult(outcome),
      onReplaySameSetup: () => {
        const seed = state.config.mode === 'daily' ? state.seed : Date.now() >>> 0;
        this.launch(newGame(seed, { ...state.config }));
      },
      onChangeSetup: () => this.showSetup(),
      onDaily: () => this.ctx.nav.toDaily(),
      onToTitle: () => this.ctx.nav.toTitle(),
    });
  }

  private async shareResult(outcome: RecordOutcome): Promise<void> {
    const e = outcome.entry;
    const modifier = this._state?.config.modifier as ModifierId | undefined;
    const text = shareText({
      scenarioName: scenarioDisplayName(e.scenario, this._state ?? undefined),
      difficultyName: DIFFICULTY_NAMES[e.difficulty],
      factionName: FACTION_NAMES[e.faction],
      outcome: e.outcome,
      turns: e.turns,
      score: e.score,
      captured: e.captured,
      kills: e.kills,
      seed: e.seed,
      daily: e.mode === 'daily',
      modifierName: modifier ? MODIFIERS[modifier]?.name : undefined,
    });
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch {
      /* 사용자가 공유 시트를 닫은 경우 등 — 클립보드로 폴백 */
    }
    try {
      await navigator.clipboard.writeText(text);
      this.ctx.hud.toast('결과를 클립보드에 복사했습니다');
    } catch {
      this.ctx.hud.toast('공유를 지원하지 않는 환경입니다');
    }
  }

  /** 보드 카메라를 사용자가 드래그·핀치로 움직임(관측 메타데이터용). */
  onCameraDrag(): void {
    if (this.ctx.mode === 'play' && this._state && !this._state.over) this.observations.onCameraMove();
  }

  /** E2E 브리지: 선택 유닛의 공격 가능 대상. */
  targetsOf(id: number): { id: number; q: number; r: number }[] {
    const u = this._state ? unitById(this._state, id) : null;
    return u && this._state
      ? attackTargets(this._state, u).map((t) => ({ id: t.id, q: t.q, r: t.r }))
      : [];
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.testPlayBar?.destroy();
    this.testPlayBar = null;
    this._state = null;
  }
}

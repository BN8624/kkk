// 한 줄 목적: 게임 전체 흐름(타이틀→플레이→AI 턴→승패)과 입력·저장·튜토리얼을 조율하는 진입점
import Phaser from 'phaser';
import { runAiTurn, type AiAction } from './core/ai';
import { humanFaction, isHumanTurn, tileAt, unitAt, unitById } from './core/board';
import { BUILDING_NAMES, DIFFICULTY_NAMES, FACTION_NAMES, UNIT_NAMES } from './core/data';
import { dailyChallenge, MODIFIERS, shareText, todayKey, type ModifierId } from './core/daily';
import { DOCTRINES } from './core/doctrines';
import { loadRecords, recordGame, saveRecords, type RecordOutcome } from './core/records';
import {
  advancePhase,
  attack,
  attackTargets,
  forecastAttack,
  moveUnit,
  newGame,
  produceUnit,
  unitCost,
} from './core/game';
import { reachableDestinations } from './core/pathfind';
import { SCENARIO_IDS, SCENARIOS } from './core/scenarios';
import {
  clearSave,
  loadGame,
  loadSettings,
  saveGame,
  saveSettings,
  type Settings,
} from './core/save';
import type { Axial, FactionId, GameState, Tile, Unit, UnitTypeId } from './core/types';
import { BoardScene } from './render/BoardScene';
import { setSoundEnabled, sfx } from './render/sound';
import { Hud } from './ui/hud';

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

class App {
  private hud: Hud;
  private game: Phaser.Game;
  private scene: BoardScene | null = null;
  private state: GameState | null = null;
  private settings: Settings;
  private selectedUnitId: number | null = null;
  private moveDests: Axial[] = [];
  private attackIds = new Set<number>();
  private productionTile: Tile | null = null;
  private busy = false;
  private boardStarted = false;
  private tutorialStep = 0; // 0 = 비활성
  private lastTap: { q: number; r: number } | null = null;
  private lastSetup: import('./ui/hud').GameSetup | null = null;
  private pendingAttackId: number | null = null;

  constructor() {
    this.settings = loadSettings();
    setSoundEnabled(this.settings.soundOn);

    this.hud = new Hud(document.getElementById('hud')!, {
      onEndTurn: () => void this.endTurn(),
      onZoom: (f) => this.scene?.zoomBy(f),
      onProduce: (t) => this.produce(t),
      onCloseProduction: () => this.closeProduction(),
      onPause: () => this.hud.showPause(this.settings.soundOn, aiSpeedLabel(this.settings.aiSpeed)),
      onResume: () => this.hud.hideOverlay(),
      onToggleSound: () => {
        this.settings.soundOn = !this.settings.soundOn;
        setSoundEnabled(this.settings.soundOn);
        saveSettings(this.settings);
        return this.settings.soundOn;
      },
      onCycleAiSpeed: () => {
        this.settings.aiSpeed = this.settings.aiSpeed === 1 ? 2 : this.settings.aiSpeed === 2 ? 0 : 1;
        saveSettings(this.settings);
        return aiSpeedLabel(this.settings.aiSpeed);
      },
      onNewGame: () => this.startNewGame(),
      onContinue: () => this.continueGame(),
      onDaily: () => this.showDaily(),
      onShowRecords: () => this.showRecords(),
      onToTitle: () => this.toTitle(),
      onReplayTutorial: () => {
        this.hud.hideOverlay();
        this.startTutorial();
      },
    });

    this.game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: 'game',
      backgroundColor: '#1d2a44',
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: '100%',
        height: '100%',
      },
      scene: [],
    });

    window.addEventListener('pagehide', () => {
      if (this.state && !this.state.over) saveGame(this.state);
    });

    this.toTitle();

    // E2E 테스트 브리지: 게임 로직·UI에 영향 없는 읽기 전용 조회 창구
    (window as unknown as { __tc?: unknown }).__tc = {
      state: () => this.state,
      busy: () => this.busy,
      screenPos: (q: number, r: number) => this.scene?.screenPos({ q, r }),
      tap: (q: number, r: number) => this.onTileTap(q, r),
      lastTap: () => this.lastTap,
      game: () => this.game,
      dests: () => this.moveDests,
      human: () => (this.state ? humanFaction(this.state) : null),
      targets: (id: number) => {
        const u = this.state ? unitById(this.state, id) : null;
        return u && this.state
          ? attackTargets(this.state, u).map((t) => ({ id: t.id, q: t.q, r: t.r }))
          : [];
      },
    };
  }

  private human(): FactionId {
    return humanFaction(this.state!);
  }

  // ---------------- 화면 전환 ----------------

  private toTitle(): void {
    const saved = loadGame();
    const summary = saved
      ? `${FACTION_NAMES[saved.config.humanFaction]} · ${SCENARIOS[saved.config.scenario].name} · ${
          DIFFICULTY_NAMES[saved.config.difficulty]
        } · ${Math.min(saved.turn, saved.maxTurns)}턴${saved.config.mode === 'daily' ? ' · 일일 도전' : ''}`
      : undefined;
    this.hud.showTitle(saved !== null, summary);
  }

  private showDaily(): void {
    const ch = dailyChallenge(todayKey());
    const records = loadRecords();
    const today = records.daily?.dateKey === ch.dateKey ? records.daily : null;
    const lines = [
      { label: '시나리오', value: SCENARIOS[ch.scenario].name },
      { label: '왕국', value: FACTION_NAMES[ch.faction] },
      { label: '난이도', value: DIFFICULTY_NAMES[ch.difficulty] },
      {
        label: '수정자',
        value: ch.modifier ? MODIFIERS[ch.modifier].name : '없음',
      },
      ...(ch.modifier ? [{ label: '효과', value: MODIFIERS[ch.modifier].description }] : []),
      ...(today
        ? [
            { label: '오늘 최고 점수', value: `${today.bestScore}점` },
            { label: '오늘 결과', value: today.won ? '승리' : '미승리' },
          ]
        : []),
    ];
    this.hud.showDaily({
      title: `${ch.dateKey.slice(0, 4)}년 ${ch.dateKey.slice(4, 6)}월 ${ch.dateKey.slice(6, 8)}일 — 모두 같은 전장에서 겨룹니다`,
      lines,
      note: '기록은 이 브라우저에만 저장됩니다 (서버 없음)',
      startLabel: today ? '다시 도전' : '도전 시작',
      onStart: () => {
        const state = newGame(ch.seed, {
          mode: 'daily',
          scenario: ch.scenario,
          humanFaction: ch.faction,
          difficulty: ch.difficulty,
          modifier: ch.modifier,
        });
        this.launch(state);
      },
      onBack: () => this.toTitle(),
    });
  }

  private showRecords(): void {
    const r = loadRecords();
    const lines = [
      { label: '전체 플레이', value: `${r.plays}판` },
      {
        label: '왕국별 승리',
        value: `${r.winsByFaction.azure} · ${r.winsByFaction.crimson} · ${r.winsByFaction.violet}`,
      },
      {
        label: '난이도별 승리',
        value: `쉬움 ${r.winsByDifficulty.easy} · 보통 ${r.winsByDifficulty.normal} · 어려움 ${r.winsByDifficulty.hard}`,
      },
      ...SCENARIO_IDS.map((id) => ({
        label: `${SCENARIOS[id].name} 최고`,
        value: r.bestScoreByScenario[id] !== undefined ? `${r.bestScoreByScenario[id]}점` : '-',
      })),
      { label: '최단 승리', value: r.fastestWinTurns !== null ? `${r.fastestWinTurns}턴` : '-' },
      { label: '최다 점령', value: `${r.maxCaptured}곳` },
      { label: '최다 처치', value: `${r.maxKills}기` },
      {
        label: '오늘 일일 도전',
        value:
          r.daily?.dateKey === todayKey() ? `${r.daily.bestScore}점 (완료)` : '미완료',
      },
    ];
    this.hud.showRecords(lines, () => this.toTitle());
  }

  private startNewGame(): void {
    this.hud.showGameSetup({
      describeFaction,
      scenarios: SCENARIO_IDS.map((id) => SCENARIOS[id]),
      initial: this.lastSetup ?? undefined,
      onStart: (sel) => {
        this.lastSetup = sel;
        const param = new URLSearchParams(location.search).get('seed');
        const seed = param ? Number(param) >>> 0 : Date.now() >>> 0;
        const state = newGame(seed, {
          humanFaction: sel.faction,
          scenario: sel.scenario,
          difficulty: sel.difficulty,
        });
        this.launch(state);
        if (!this.settings.tutorialDone) this.startTutorial();
      },
      onBack: () => this.toTitle(),
    });
  }

  private continueGame(): void {
    const state = loadGame();
    if (!state) {
      this.hud.toast('저장된 게임이 없습니다');
      this.startNewGame();
      return;
    }
    this.launch(state);
  }

  private launch(state: GameState): void {
    this.state = state;
    this.selectedUnitId = null;
    this.busy = false;
    this.hud.hideOverlay();
    this.hud.hideProduction();
    this.hud.hideTutorial();
    this.hud.showUnitPanel(null, null, '');
    this.hud.updateTop(state);
    this.hud.setEndTurnEnabled(true);
    saveGame(state);

    const callbacks = {
      onTileTap: (q: number, r: number) => this.onTileTap(q, r),
      onReady: () => {
        this.hud.updateTop(this.state!);
      },
    };
    if (!this.boardStarted) {
      this.game.scene.add('board', BoardScene, true, { state, callbacks });
      this.scene = this.game.scene.getScene('board') as BoardScene;
      this.boardStarted = true;
    } else {
      this.scene!.setState(state);
      this.scene!.clearHighlights();
      this.scene!.showSelection(null);
    }
    // 저장 시점이 AI 차례였다면 남은 AI 턴을 이어서 진행한다
    if (!state.over && !isHumanTurn(state)) {
      void this.runAiPhases();
    }
  }

  // ---------------- 튜토리얼 ----------------

  private startTutorial(): void {
    this.tutorialStep = 1;
    this.showTutorial();
  }

  private showTutorial(): void {
    const total = 5;
    const color = FACTION_TOKEN_DESC[this.state ? this.human() : 'azure'];
    switch (this.tutorialStep) {
      case 1:
        this.hud.showTutorialStep(1, total, `당신의 유닛(${color} 방패 토큰)을 탭하세요.`, null);
        break;
      case 2:
        this.hud.showTutorialStep(2, total, '금색으로 강조된 타일을 탭해 이동하세요.', null);
        break;
      case 3:
        this.hud.showTutorialStep(
          3,
          total,
          '사거리 안의 적은 붉게 표시됩니다. 적 토큰을 탭하면 전투 예측이 뜨고, 공격 버튼이나 한 번 더 탭하면 공격합니다.',
          '알겠습니다',
          () => this.advanceTutorial(4),
        );
        break;
      case 4:
        this.hud.showTutorialStep(
          4,
          total,
          '중립 마을에 유닛을 올리면 점령합니다. 점령한 거점은 매 턴 금을 생산하고, 수도와 마을에서는 새 유닛을 생산할 수 있습니다.',
          '알겠습니다',
          () => this.advanceTutorial(5),
        );
        break;
      case 5:
        this.hud.showTutorialStep(5, total, "오른쪽 아래 '턴 종료'를 누르면 적 세력들이 움직입니다.", null);
        break;
      default:
        this.hud.hideTutorial();
    }
  }

  private advanceTutorial(next: number): void {
    if (this.tutorialStep === 0) return;
    this.tutorialStep = next;
    if (next > 5) {
      this.tutorialStep = 0;
      this.settings.tutorialDone = true;
      saveSettings(this.settings);
      this.hud.hideTutorial();
    } else {
      this.showTutorial();
    }
  }

  // ---------------- 입력 처리 ----------------

  private onTileTap(q: number, r: number): void {
    this.lastTap = { q, r };
    const state = this.state;
    if (!state || this.busy || state.over || !isHumanTurn(state)) return;
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
      this.hud.showUnitPanel(tappedUnit, null, '');
      return;
    }
    this.deselect();
  }

  private select(unitId: number): void {
    const state = this.state!;
    const unit = unitById(state, unitId)!;
    this.selectedUnitId = unitId;
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
    this.hud.showUnitPanel(unit, null, hint);

    if (this.tutorialStep === 1) this.advanceTutorial(2);
  }

  private deselect(): void {
    this.selectedUnitId = null;
    this.pendingAttackId = null;
    this.moveDests = [];
    this.attackIds.clear();
    this.scene?.clearHighlights();
    this.scene?.showSelection(null);
    this.hud.showUnitPanel(null, null, '');
  }

  /** 전투 예측 패널 표시(실제 엔진과 동일한 forecastAttack 사용) */
  private showForecast(attacker: Unit, defender: Unit): void {
    const state = this.state!;
    const fc = forecastAttack(state, attacker, defender);
    this.pendingAttackId = defender.id;
    const notes: string[] = [];
    if (fc.damage.atkBonus > 0) notes.push(`능력·수정자 공격 +${fc.damage.atkBonus}`);
    const defTotal = fc.damage.terrainDef + fc.damage.doctrineDef;
    if (defTotal > 0) notes.push(`상대 지형·거점 방어 +${defTotal}`);
    this.hud.showForecast({
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
    const state = this.state!;
    this.busy = true;
    this.scene?.clearHighlights();
    this.scene?.showSelection(null);
    const result = moveUnit(state, unitId, dest);
    if (!result.ok) {
      this.busy = false;
      this.deselect();
      return;
    }
    sfx.move();
    await this.scene?.animateMove(unitId, result.path!);
    if (result.captured) {
      sfx.capture();
      await this.scene?.animateCapture(dest, result.captured.building !== 'village');
      const bonus = result.bonusGold ? ` (+${result.bonusGold}금)` : '';
      this.hud.toast(`${BUILDING_NAMES[result.captured.building!]} 점령!${bonus}`);
    }
    this.hud.updateTop(state);
    saveGame(state);
    this.busy = false;

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
    const state = this.state!;
    this.busy = true;
    this.scene?.clearHighlights();
    this.scene?.showSelection(null);
    const attacker = unitById(state, attackerId)!;
    const defender = unitById(state, defenderId)!;
    const attackerPos = { q: attacker.q, r: attacker.r };
    const defenderPos = { q: defender.q, r: defender.r };
    const result = attack(state, attackerId, defenderId);
    if (!result.ok) {
      this.busy = false;
      this.deselect();
      return;
    }
    sfx.attack();
    await this.scene?.animateAttack({
      attackerId,
      attackerType: attacker.type,
      defenderId,
      defenderPos,
      damage: result.damage!,
      counterDamage: result.counterDamage,
      attackerPos,
    });
    if (result.defenderDied || result.attackerDied) sfx.hit();
    if (result.defenderDied) this.hud.toast('적 유닛 처치!');
    this.hud.updateTop(state);
    saveGame(state);
    this.busy = false;
    this.deselect();
    if (state.over) this.finishGame();
  }

  // ---------------- 생산 ----------------

  private openProduction(tile: Tile): void {
    const state = this.state!;
    this.deselect();
    this.productionTile = tile;
    sfx.select();
    const gold = state.factions[this.human()].gold;
    this.hud.showProduction(
      BUILDING_NAMES[tile.building!],
      gold,
      (t) => unitCost(this.human(), t),
    );
  }

  private closeProduction(): void {
    this.productionTile = null;
    this.hud.hideProduction();
  }

  private produce(type: UnitTypeId): void {
    const state = this.state!;
    const tile = this.productionTile;
    if (!tile || this.busy) return;
    const result = produceUnit(state, this.human(), tile, type);
    if (!result.ok) {
      this.hud.toast(
        result.reason === 'no-gold'
          ? '금이 부족합니다'
          : result.reason === 'unit-cap'
            ? '유닛 수가 최대입니다'
            : '지금은 생산할 수 없습니다',
      );
      return;
    }
    this.closeProduction();
    sfx.capture();
    void this.scene?.animateSpawn(result.unit!.id);
    this.hud.toast(`${UNIT_NAMES[type]} 생산 완료 — 다음 턴부터 행동합니다`);
    this.hud.updateTop(state);
    saveGame(state);
  }

  // ---------------- 턴 진행 ----------------

  private async endTurn(): Promise<void> {
    const state = this.state;
    if (!state || this.busy || state.over || !isHumanTurn(state)) return;
    this.deselect();
    this.closeProduction();
    if (this.tutorialStep === 5) this.advanceTutorial(6);
    advancePhase(state); // 인간 페이즈 종료 → 다음 세력
    await this.runAiPhases();
  }

  /** 현재 차례부터 인간 차례가 될 때까지 AI 페이즈를 연속 실행한다. */
  private async runAiPhases(): Promise<void> {
    const state = this.state!;
    this.busy = true;
    this.hud.setEndTurnEnabled(false);
    this.scene?.setSpeed(this.settings.aiSpeed === 2 ? 2 : 1);
    while (!state.over && !isHumanTurn(state)) {
      const fid = state.current;
      this.hud.setAiThinking(fid);
      const log = runAiTurn(state, fid);
      await this.playAiLog(log);
      advancePhase(state);
      this.hud.updateTop(state);
    }
    this.hud.setAiThinking(null);
    this.scene?.setSpeed(1);
    this.scene?.refresh();
    this.hud.updateTop(state);

    if (state.over) {
      this.finishGame();
      this.busy = false;
      this.hud.setEndTurnEnabled(true);
      return;
    }
    saveGame(state);
    sfx.turn();
    // 카메라를 플레이어 진영으로 되돌린다
    const me = this.human();
    const home =
      state.tiles.find((t) => t.building === 'capital' && t.owner === me) ??
      state.units.find((u) => u.faction === me);
    if (home) this.scene?.panTo({ q: home.q, r: home.r });
    this.hud.toast(`${state.turn}턴 — 당신의 차례입니다`);
    this.busy = false;
    this.hud.setEndTurnEnabled(true);
  }

  private async playAiLog(log: AiAction[]): Promise<void> {
    if (!this.scene) return;
    // 건너뛰기: 연출 없이 결과만 반영
    if (this.settings.aiSpeed === 0) {
      this.scene.refresh();
      await delay(120);
      return;
    }
    for (const action of log) {
      switch (action.kind) {
        case 'move': {
          const last = action.path[action.path.length - 1];
          this.scene.panTo(last, 200);
          await this.scene.animateMove(action.unitId, action.path);
          break;
        }
        case 'attack': {
          const target = unitById(this.state!, action.targetId);
          const attacker = unitById(this.state!, action.unitId);
          sfx.attack();
          // 사망한 유닛 좌표는 로그 시점 상태로 추정 불가하므로 생존 좌표만 사용
          const defenderPos = target ? { q: target.q, r: target.r } : null;
          if (defenderPos) {
            await this.scene.animateAttack({
              attackerId: action.unitId,
              attackerType: action.attackerType,
              defenderId: action.targetId,
              defenderPos,
              damage: action.damage,
              counterDamage: action.counterDamage,
              attackerPos: attacker ? { q: attacker.q, r: attacker.r } : undefined,
            });
          } else {
            this.scene.refresh();
            await delay(200);
          }
          break;
        }
        case 'capture': {
          sfx.capture();
          const t = tileAt(this.state!, action.at.q, action.at.r);
          await this.scene.animateCapture(action.at, t?.building !== 'village');
          break;
        }
        case 'produce':
          await this.scene.animateSpawn(action.unitId);
          break;
      }
    }
    this.scene.refresh();
  }

  // ---------------- 종료 ----------------

  private finishGame(): void {
    const state = this.state!;
    clearSave();
    this.deselect();
    this.hud.hideTutorial();
    if (state.winner === this.human()) sfx.win();
    else sfx.lose();

    // 기록 반영(1회)
    const records = loadRecords();
    const outcome = recordGame(
      records,
      state,
      state.config.mode === 'daily' ? todayKey() : undefined,
    );
    saveRecords(outcome.records);

    window.setTimeout(() => this.showResultScreen(state, outcome), 700);
  }

  private showResultScreen(state: GameState, outcome: RecordOutcome): void {
    const modifier = state.config.modifier as ModifierId | undefined;
    this.hud.showResult(state, {
      scenarioName: SCENARIOS[state.config.scenario].name,
      difficultyName: DIFFICULTY_NAMES[state.config.difficulty],
      modifierName: modifier ? MODIFIERS[modifier]?.name : undefined,
      prevBest: outcome.prevBestScore,
      isNewBest: outcome.isNewBest,
      onShare: () => void this.shareResult(outcome),
      onReplay: () => {
        const seed =
          state.config.mode === 'daily' ? state.seed : Date.now() >>> 0;
        this.launch(newGame(seed, { ...state.config }));
      },
      onChangeSetup: () => this.startNewGame(),
      onDaily: () => this.showDaily(),
    });
  }

  private async shareResult(outcome: RecordOutcome): Promise<void> {
    const e = outcome.entry;
    const modifier = this.state?.config.modifier as ModifierId | undefined;
    const text = shareText({
      scenarioName: SCENARIOS[e.scenario].name,
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
      this.hud.toast('결과를 클립보드에 복사했습니다');
    } catch {
      this.hud.toast('공유를 지원하지 않는 환경입니다');
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

new App();

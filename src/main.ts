// 한 줄 목적: 게임 전체 흐름(타이틀→플레이→AI 턴→승패)과 입력·저장·튜토리얼을 조율하는 진입점
import Phaser from 'phaser';
import { runAiTurn, type AiAction } from './core/ai';
import { tileAt, unitAt, unitById } from './core/board';
import { BUILDING_NAMES, UNIT_NAMES, UNIT_STATS } from './core/data';
import {
  advancePhase,
  attack,
  attackTargets,
  moveUnit,
  newGame,
  produceUnit,
} from './core/game';
import { reachableDestinations } from './core/pathfind';
import {
  clearSave,
  loadGame,
  loadSettings,
  saveGame,
  saveSettings,
  type Settings,
} from './core/save';
import type { Axial, FactionId, GameState, Tile, UnitTypeId } from './core/types';
import { BoardScene } from './render/BoardScene';
import { setSoundEnabled, sfx } from './render/sound';
import { Hud } from './ui/hud';

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

  constructor() {
    this.settings = loadSettings();
    setSoundEnabled(this.settings.soundOn);

    this.hud = new Hud(document.getElementById('hud')!, {
      onEndTurn: () => void this.endTurn(),
      onZoom: (f) => this.scene?.zoomBy(f),
      onProduce: (t) => this.produce(t),
      onCloseProduction: () => this.closeProduction(),
      onPause: () => this.hud.showPause(this.settings.soundOn),
      onResume: () => this.hud.hideOverlay(),
      onToggleSound: () => {
        this.settings.soundOn = !this.settings.soundOn;
        setSoundEnabled(this.settings.soundOn);
        saveSettings(this.settings);
        return this.settings.soundOn;
      },
      onNewGame: () => this.startNewGame(),
      onContinue: () => this.continueGame(),
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
      targets: (id: number) => {
        const u = this.state ? unitById(this.state, id) : null;
        return u && this.state
          ? attackTargets(this.state, u).map((t) => ({ id: t.id, q: t.q, r: t.r }))
          : [];
      },
    };
  }

  // ---------------- 화면 전환 ----------------

  private toTitle(): void {
    this.hud.showTitle(loadGame() !== null);
  }

  private startNewGame(): void {
    const param = new URLSearchParams(location.search).get('seed');
    const seed = param ? Number(param) >>> 0 : Date.now() >>> 0;
    const state = newGame(seed);
    this.launch(state);
    if (!this.settings.tutorialDone) this.startTutorial();
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
  }

  // ---------------- 튜토리얼 ----------------

  private startTutorial(): void {
    this.tutorialStep = 1;
    this.showTutorial();
  }

  private showTutorial(): void {
    const total = 5;
    switch (this.tutorialStep) {
      case 1:
        this.hud.showTutorialStep(1, total, '당신의 유닛(남색 방패 토큰)을 탭하세요.', null);
        break;
      case 2:
        this.hud.showTutorialStep(2, total, '금색으로 강조된 타일을 탭해 이동하세요.', null);
        break;
      case 3:
        this.hud.showTutorialStep(
          3,
          total,
          '사거리 안의 적은 붉게 표시됩니다. 적 토큰을 탭하면 공격합니다.',
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
    if (!state || this.busy || state.over || state.current !== 'player') return;
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

    // 선택된 유닛의 공격
    if (selected && tappedUnit && this.attackIds.has(tappedUnit.id)) {
      void this.doAttack(selected.id, tappedUnit.id);
      return;
    }
    // 선택된 유닛의 이동
    if (selected && !tappedUnit && this.moveDests.some((d) => d.q === q && d.r === r)) {
      void this.doMove(selected.id, { q, r });
      return;
    }
    // 자기 유닛 선택
    if (tappedUnit && tappedUnit.faction === 'player') {
      this.select(tappedUnit.id);
      return;
    }
    // 자기 거점(빈 타일) → 생산
    if (!tappedUnit && tile.building && tile.owner === 'player') {
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
    this.moveDests = [];
    this.attackIds.clear();
    this.scene?.clearHighlights();
    this.scene?.showSelection(null);
    this.hud.showUnitPanel(null, null, '');
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
      await this.scene?.animateCapture(dest);
      this.hud.toast(
        `${BUILDING_NAMES[result.captured.building!]} 점령!`,
      );
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
    await this.scene?.animateAttack(
      attackerId,
      defenderPos,
      result.damage!,
      result.counterDamage,
      attackerPos,
    );
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
    this.hud.showProduction(
      BUILDING_NAMES[tile.building!],
      state.factions.player.gold,
      (t) => state.factions.player.gold >= UNIT_STATS[t].cost,
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
    const result = produceUnit(state, 'player', tile, type);
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
    if (!state || this.busy || state.over || state.current !== 'player') return;
    this.busy = true;
    this.deselect();
    this.closeProduction();
    this.hud.setEndTurnEnabled(false);
    if (this.tutorialStep === 5) this.advanceTutorial(6);

    advancePhase(state); // -> ai1
    for (const fid of ['ai1', 'ai2'] as FactionId[]) {
      if (state.over) break;
      this.hud.setAiThinking(fid);
      const log = runAiTurn(state, fid);
      await this.playAiLog(log);
      advancePhase(state); // ai1 -> ai2, ai2 -> 다음 턴(수입·초기화)
      this.hud.updateTop(state);
    }
    this.hud.setAiThinking(null);
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
    const home =
      state.tiles.find((t) => t.building === 'capital' && t.owner === 'player') ??
      state.units.find((u) => u.faction === 'player');
    if (home) this.scene?.panTo({ q: home.q, r: home.r });
    this.hud.toast(`${state.turn}턴 — 당신의 차례입니다`);
    this.busy = false;
    this.hud.setEndTurnEnabled(true);
  }

  private async playAiLog(log: AiAction[]): Promise<void> {
    if (!this.scene) return;
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
            await this.scene.animateAttack(
              action.unitId,
              defenderPos,
              action.damage,
              action.counterDamage,
              attacker ? { q: attacker.q, r: attacker.r } : undefined,
            );
          } else {
            this.scene.refresh();
            await delay(200);
          }
          break;
        }
        case 'capture':
          sfx.capture();
          await this.scene.animateCapture(action.at);
          break;
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
    if (state.winner === 'player') sfx.win();
    else sfx.lose();
    window.setTimeout(() => this.hud.showResult(state), 700);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

new App();

// 한 줄 목적: Phaser 게임·HUD·오버레이·설정·모드 전환을 소유하고 모드별 컨트롤러를 조립·중재한다
import Phaser from 'phaser';
import { humanFaction } from '../core/board';
import { stateDigest } from '../core/replay';
import { loadGame, loadSettings, type Settings } from '../core/save';
import { scenarioDisplayName } from '../core/scenarios';
import { difficultyName, factionName, localizedScenarioName, t } from '../i18n';
import { decodeShareCode } from '../editor/share';
import type { GameState } from '../core/types';
import { BoardScene } from '../render/BoardScene';
import { setSoundEnabled } from '../render/sound';
import { Hud } from '../ui/game/hud';
import { OverlayHost } from '../ui/shared/overlay';
import { injectSharedStyles } from '../ui/shared/styles';
import { showTitleScreen } from '../ui/title';
import { AnalysisController } from '../controllers/analysis-controller';
import { CampaignController } from '../controllers/campaign-controller';
import { EditorFlowController } from '../controllers/editor-flow-controller';
import { LibraryController } from '../controllers/library-controller';
import { PlayController } from '../controllers/play-controller';
import { ReplayController } from '../controllers/replay-controller';
import { activeCleanupCount, type ModeToken } from './lifecycle';
import type { AppMode } from './mode';
import type {
  AppNavigation,
  CampaignFlow,
  EditorFlow,
  LibraryFlow,
  PlaySession,
  ReplayArchiveFlow,
} from './navigation';

/** 컨트롤러가 받는 공유 문맥. 컨트롤러 간 접근은 여기 노출된 인터페이스로만 한다. */
export interface AppContext {
  readonly game: Phaser.Game;
  readonly hud: Hud;
  readonly overlay: OverlayHost;
  readonly hudRoot: HTMLElement;
  readonly settings: Settings;
  readonly nav: AppNavigation;
  readonly mode: AppMode;
  /** 모드를 전환하고 이 화면 세대의 토큰을 발급한다(이전 세대 토큰은 stale). */
  enterMode(mode: AppMode): ModeToken;
  /** 현재 화면 세대의 토큰(전환 없이 발급). */
  currentToken(): ModeToken;
  /** 보드 씬을 보장하고 상태를 반영해 돌려준다. */
  ensureBoard(state: GameState): BoardScene;
  readonly boardScene: BoardScene | null;
  sleepBoard(): void;
  wakeBoard(): void;
  readonly play: PlaySession;
  readonly campaign: CampaignFlow;
  readonly editorFlow: EditorFlow;
  readonly replays: ReplayArchiveFlow;
  readonly library: LibraryFlow;
}

export class AppShell implements AppContext, AppNavigation {
  readonly game: Phaser.Game;
  readonly hud: Hud;
  readonly overlay: OverlayHost;
  readonly hudRoot: HTMLElement;
  readonly settings: Settings;

  private _mode: AppMode = 'title';
  private epoch = 0;
  private scene: BoardScene | null = null;
  private boardStarted = false;
  private swRegistration: ServiceWorkerRegistration | null = null;
  private updateAvailable = false;
  private reloadForUpdate = false;

  private playCtrl: PlayController;
  private campaignCtrl: CampaignController;
  private editorCtrl: EditorFlowController;
  private replayCtrl: ReplayController;
  private libraryCtrl: LibraryController;
  private analysisCtrl: AnalysisController;

  constructor() {
    this.settings = loadSettings();
    setSoundEnabled(this.settings.soundOn);
    injectSharedStyles();

    this.hudRoot = document.getElementById('hud')!;
    this.hud = new Hud(this.hudRoot, {
      onEndTurn: () => void this.playCtrl.endTurn(),
      onZoom: (f) => this.scene?.zoomBy(f),
      onProduce: (t) => this.playCtrl.produce(t),
      onCloseProduction: () => this.playCtrl.closeProduction(),
      onPause: () => this.playCtrl.showPause(),
    });
    this.overlay = new OverlayHost(this.hudRoot);

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

    this.playCtrl = new PlayController(this);
    this.campaignCtrl = new CampaignController(this);
    this.editorCtrl = new EditorFlowController(this);
    this.replayCtrl = new ReplayController(this);
    this.libraryCtrl = new LibraryController(this);
    this.analysisCtrl = new AnalysisController(this);

    window.addEventListener('pagehide', () => this.playCtrl.persistOnExit());
  }

  /** 부팅: 타이틀 표시 후 공유 URL 진입을 처리한다. */
  boot(): void {
    this.toTitle();
    void this.consumeShareHash();
    void this.registerServiceWorker();
    this.installTestBridge();
  }

  // ---------------- 문맥 ----------------

  get mode(): AppMode {
    return this._mode;
  }

  get nav(): AppNavigation {
    return this;
  }

  enterMode(mode: AppMode): ModeToken {
    this._mode = mode;
    this.epoch++;
    return this.currentToken();
  }

  currentToken(): ModeToken {
    // 화살표 함수 getter가 발급 시점 세대와 현재 세대를 비교한다
    const at = this.epoch;
    return Object.defineProperty({} as { alive: boolean }, 'alive', {
      get: () => at === this.epoch,
    }) as ModeToken;
  }

  get boardScene(): BoardScene | null {
    return this.scene;
  }

  ensureBoard(state: GameState): BoardScene {
    if (!this.boardStarted) {
      this.game.scene.add('board', BoardScene, true, {
        state,
        callbacks: {
          onTileTap: (q: number, r: number) => this.playCtrl.onTileTap(q, r),
          onReady: () => this.playCtrl.refreshHudIfPlaying(),
          onCameraDrag: () => this.playCtrl.onCameraDrag(),
        },
      });
      this.scene = this.game.scene.getScene('board') as BoardScene;
      this.boardStarted = true;
    } else {
      this.scene!.setState(state);
    }
    return this.scene!;
  }

  sleepBoard(): void {
    if (this.boardStarted && !this.game.scene.isSleeping('board')) this.game.scene.sleep('board');
  }

  wakeBoard(): void {
    if (this.boardStarted && this.game.scene.isSleeping('board')) this.game.scene.wake('board');
  }

  get play(): PlaySession {
    return this.playCtrl;
  }

  get campaign(): CampaignFlow {
    return this.campaignCtrl;
  }

  get editorFlow(): EditorFlow {
    return this.editorCtrl;
  }

  get replays(): ReplayArchiveFlow {
    return this.replayCtrl;
  }

  get library(): LibraryFlow {
    return this.libraryCtrl;
  }

  // ---------------- 상위 화면 이동 ----------------

  toTitle(): void {
    this.enterMode('title');
    this.replayCtrl.stopPlaybackUi();
    this.playCtrl.clearTestPlayUi();
    this.editorCtrl.closeSession();
    const saved = loadGame();
    const summary = saved
      ? t('title.saveSummary', {
          faction: factionName(saved.config.humanFaction),
          scenario: localizedScenarioName(
            saved.config.scenario,
            scenarioDisplayName(saved.config.scenario, saved),
          ),
          difficulty: difficultyName(saved.config.difficulty),
          turns: Math.min(saved.turn, saved.maxTurns),
          daily: saved.config.mode === 'daily' ? t('title.dailySuffix') : '',
        })
      : undefined;
    showTitleScreen(this.overlay, {
      hasSave: saved !== null,
      saveSummary: summary,
      updateAvailable: this.updateAvailable,
      features: { campaign: true, scenarios: true, editor: true, replays: true, analysis: true },
      handlers: {
        onContinue: () => this.continueGame(),
        onNewGame: () => this.toSetup(),
        onDaily: () => this.toDaily(),
        onCampaign: () => this.toCampaign(),
        onScenarios: () => this.toCustomScenarios(),
        onEditor: () => this.toEditorHome(),
        onReplays: () => this.toReplayArchive(),
        onAnalysis: () => this.toAnalysis(),
        onRecords: () => this.toRecords(),
        onUpdate: () => this.activateUpdate(),
      },
    });
  }

  private async registerServiceWorker(): Promise<void> {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator) || location.protocol === 'file:') return;
    try {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (this.reloadForUpdate) location.reload();
      });
      const registration = await navigator.serviceWorker.register(
        new URL('sw.js', document.baseURI),
      );
      this.swRegistration = registration;
      if (registration.waiting && navigator.serviceWorker.controller) this.markUpdateAvailable();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            this.markUpdateAvailable();
          }
        });
      });
    } catch {
      // 서비스 워커 실패는 일반 웹 실행을 막지 않는다
    }
  }

  private markUpdateAvailable(): void {
    this.updateAvailable = true;
    if (this.mode === 'title') this.toTitle();
  }

  private activateUpdate(): void {
    const waiting = this.swRegistration?.waiting;
    if (!waiting) return;
    this.reloadForUpdate = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  toSetup(): void {
    this.playCtrl.showSetup();
  }

  continueGame(): void {
    this.playCtrl.continueGame();
  }

  toDaily(): void {
    this.libraryCtrl.showDaily();
  }

  toRecords(): void {
    this.libraryCtrl.showRecords();
  }

  toCampaign(): void {
    this.campaignCtrl.show();
  }

  toCustomScenarios(): void {
    void this.libraryCtrl.showCustomScenarios();
  }

  toEditorHome(): void {
    void this.editorCtrl.showHome();
  }

  toReplayArchive(): void {
    void this.replayCtrl.showArchive();
  }

  toAnalysis(): void {
    void this.analysisCtrl.showLab();
  }

  launch(state: GameState, opts?: { testPlay?: boolean; spectate?: boolean }): void {
    this.playCtrl.launch(state, opts);
  }

  openPlayback(doc: Parameters<ReplayArchiveFlow['openPlayback']>[0]): void {
    this.replayCtrl.openPlayback(doc);
  }

  // ---------------- 공유 URL 진입 ----------------

  /** 공유 URL(#s=코드)로 진입한 경우 문서를 확인 후 제작실에서 연다. */
  private async consumeShareHash(): Promise<void> {
    const hash = window.location.hash;
    if (!hash.startsWith('#s=')) return;
    // 새로 고침 시 재가져오기를 막기 위해 해시를 즉시 지운다
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const token = this.currentToken();
    const { doc } = await decodeShareCode(hash.slice(3));
    if (!token.alive) return; // 해제 중 다른 화면으로 이동한 경우
    if (!doc) {
      this.hud.toast(t('share.readFailed'));
      return;
    }
    if (!window.confirm(t('share.confirmOpen', { title: doc.title }))) return;
    this.editorCtrl.openImportedDocument(doc);
  }

  // ---------------- E2E 테스트 브리지 ----------------

  private installTestBridge(): void {
    // 개발 모드·테스트 빌드에서만 노출한다(일반 배포판 미노출)
    if (!(import.meta.env.DEV || import.meta.env.VITE_TEST_BRIDGE === '1')) return;
    (window as unknown as { __tc?: unknown }).__tc = {
      state: () => this.playCtrl.state,
      busy: () => this.playCtrl.busy,
      mode: () => this._mode,
      digest: () => (this.playCtrl.state ? stateDigest(this.playCtrl.state) : null),
      screenPos: (q: number, r: number) => this.scene?.screenPos({ q, r }),
      tap: (q: number, r: number) => this.playCtrl.onTileTap(q, r),
      lastTap: () => this.playCtrl.lastTap,
      game: () => this.game,
      dests: () => this.playCtrl.destinations,
      human: () => (this.playCtrl.state ? humanFaction(this.playCtrl.state) : null),
      targets: (id: number) => this.playCtrl.targetsOf(id),
      openEditor: () => this.toEditorHome(),
      editorDoc: () => this.editorCtrl.currentDoc,
      editorTap: (q: number, r: number) => this.editorCtrl.editorTap(q, r),
      // 누수 진단: 화면 전환 반복 후 수치가 증가하지 않아야 한다
      leaks: () => ({
        cleanups: activeCleanupCount(),
        scenes: this.game.scene.scenes.length,
        overlayNodes: this.overlay.element.querySelectorAll('*').length,
        hudNodes: this.hudRoot.querySelectorAll('*').length,
      }),
    };
  }
}

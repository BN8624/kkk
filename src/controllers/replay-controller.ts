// 한 줄 목적: 리플레이 보관함·가져오기/내보내기·재생 세션(배속·턴 이동)·게임 종료 자동 보관을 담당한다
import { factionScore } from '../core/game';
import {
  buildReplayDocument,
  REPLAY_MAX_IMPORT_BYTES,
  upgradeStoredReplay,
  type ReplayDocument,
} from '../core/replay';
import { decodeReplayDocument, safeVerifyReplay } from '../core/replay-decode';
import { checkReplayCompatibility } from '../core/replay-compat';
import type { GameState } from '../core/types';
import { playEvents } from '../render/event-player';
import { ReplayPlayback } from '../replay/playback';
import { newDocId } from '../storage/docstore';
import { documentStore } from '../storage/idb';
import {
  defectTagLabel,
  describeResult,
  describeStep,
  promptPlaytestEvaluation,
  ReplayControls,
  showReplayArchiveScreen,
  type ReplayListItem,
} from '../ui/replay';
import type { AppContext } from '../app/app-shell';
import type { AppController } from '../app/lifecycle';
import type { ReplayArchiveFlow } from '../app/navigation';
import {
  difficultyName,
  factionName,
  localizedScenarioName,
  replayCompatibilityLabel,
  replayCompatibilityReason,
  t,
} from '../i18n';

const FAVORITES_KEY = 'three-crowns-replay-favs';

export class ReplayController implements AppController, ReplayArchiveFlow {
  private playback: ReplayPlayback | null = null;
  private playing = false;
  private speed: 1 | 2 | 4 = 1;
  private stepBusy = false;
  private controls: ReplayControls | null = null;
  private lastReplay: ReplayDocument | null = null;

  constructor(private ctx: AppContext) {}

  get hasLastReplay(): boolean {
    return this.lastReplay !== null;
  }

  openLastReplay(): void {
    if (this.lastReplay) this.openPlayback(this.lastReplay);
  }

  // ---------------- 즐겨찾기 ----------------

  private favorites(): Set<string> {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  }

  private saveFavorites(favs: Set<string>): void {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favs]));
    } catch {
      /* 저장 실패 시 즐겨찾기만 유지되지 않는다 */
    }
  }

  // ---------------- 보관함 ----------------

  async showArchive(): Promise<void> {
    const token = this.ctx.enterMode('replays');
    this.stopPlaybackUi();
    const favs = this.favorites();
    const items: ReplayListItem[] = [];
    try {
      const summaries = await documentStore().list('replays');
      for (const s of summaries) {
        const rec = await documentStore().get<ReplayDocument>('replays', s.id);
        const doc = upgradeStoredReplay(rec?.data);
        if (!doc) continue;
        const me = doc.initialConfig.humanFaction;
        const compat = checkReplayCompatibility(doc);
        const tag = doc.evaluation?.defectTag;
        items.push({
          id: s.id,
          createdAt: doc.createdAt || rec!.updatedAt,
          scenarioTitle: localizedScenarioName(
            doc.initialConfig.scenario,
            doc.scenario.title || doc.initialConfig.scenario,
          ),
          factionName: factionName(me),
          difficultyName: difficultyName(doc.initialConfig.difficulty),
          daily: doc.initialConfig.mode === 'daily',
          outcome:
            doc.result.winner === me ? 'win' : doc.result.winner === 'draw' ? 'draw' : 'lose',
          turns: doc.result.turns,
          score: doc.result.score,
          favorite: favs.has(s.id),
          sizeBytes: s.size,
          compatLabel: replayCompatibilityLabel(compat.compatibility),
          compatWarn: compat.compatibility !== 'exact' && compat.compatibility !== 'migratable',
          ...(tag ? { defectLabel: defectTagLabel(tag) } : {}),
        });
      }
    } catch {
      /* 저장소 접근 실패: 빈 목록으로 표시 */
    }
    items.sort(
      (a, b) => Number(b.favorite) - Number(a.favorite) || (a.createdAt < b.createdAt ? 1 : -1),
    );
    if (!token.alive) return; // 목록 로딩 중 다른 화면으로 이동한 경우
    showReplayArchiveScreen(this.ctx.overlay, items, {
      onOpen: (id) => void this.openReplayById(id),
      onExport: (id) => void this.exportReplay(id),
      onShare: (id) => void this.shareReplay(id),
      onToggleFavorite: (id) => {
        const f = this.favorites();
        if (f.has(id)) f.delete(id);
        else f.add(id);
        this.saveFavorites(f);
        void this.showArchive();
      },
      onDelete: (id) => {
        if (!window.confirm(t('replay.confirmDelete'))) return;
        documentStore()
          .remove('replays', id)
          .then(() => this.showArchive())
          .catch(() => this.ctx.hud.toast(t('replay.deleteFailed')));
      },
      onImport: (file) => void this.importReplay(file),
      onBack: () => this.ctx.nav.toTitle(),
    });
  }

  private async openReplayById(id: string): Promise<void> {
    const token = this.ctx.currentToken();
    const rec = await documentStore()
      .get<ReplayDocument>('replays', id)
      .catch(() => null);
    if (!token.alive) return;
    const doc = upgradeStoredReplay(rec?.data);
    if (!doc) {
      this.ctx.hud.toast(t('replay.loadFailed'));
      return;
    }
    this.playFromDocument(doc);
  }

  /**
   * 호환 판정 후 재생. 보관함 열기·가져오기(재생만) 공통 경로.
   * unsupported 거부, playable-unverified 확인 후 비검증 재생, exact/migratable 검증 재생.
   */
  private playFromDocument(doc: ReplayDocument): void {
    const compat = checkReplayCompatibility(doc);
    if (compat.compatibility === 'unsupported') {
      this.ctx.hud.toast(replayCompatibilityReason(compat));
      return;
    }
    const playDoc = compat.migrated ?? doc;
    if (compat.compatibility === 'playable-unverified') {
      if (
        !window.confirm(
          t('replay.playOnlyConfirm', { reason: replayCompatibilityReason(compat) }),
        )
      ) {
        return;
      }
      this.openPlayback(playDoc, { unverified: true });
      return;
    }
    this.openPlayback(playDoc);
  }

  // ---------------- 재생 ----------------

  /**
   * 리플레이 재생 화면을 연다. exact 계열은 전체 재생 검증으로 재생 가능성을 보장한다.
   * unverified: 다른 규칙 버전의 기록 — 검증 없이 재생만 하며 결과를 정본으로 취급하지 않는다.
   */
  openPlayback(doc: ReplayDocument, opts: { unverified?: boolean } = {}): void {
    if (!opts.unverified && !safeVerifyReplay(doc).ok) {
      this.ctx.hud.toast(t('replay.unplayable'));
      return;
    }
    if (opts.unverified) {
      this.ctx.hud.toast(t('replay.unverifiedWarning'));
    }
    this.ctx.enterMode('replay');
    this.ctx.overlay.hide();
    this.ctx.hud.setPlayControlsVisible(false);
    this.playback = new ReplayPlayback(doc);
    this.playing = false;
    this.speed = 1;
    const scene = this.ctx.ensureBoard(this.playback.state);
    scene.clearHighlights();
    scene.showSelection(null);
    this.controls?.destroy();
    this.controls = new ReplayControls(this.ctx.hudRoot, {
      onPlayPause: () => this.togglePlaying(),
      onStepBack: () => this.jump((pb) => pb.stepBack()),
      onStepForward: () => void this.stepForward(),
      onPrevTurn: () => this.jump((pb) => pb.prevTurn()),
      onNextTurn: () => this.jump((pb) => pb.nextTurn()),
      onFirst: () => this.jump((pb) => pb.toStart()),
      onLast: () => this.jump((pb) => pb.toEnd()),
      onCycleSpeed: () => {
        this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
        if (this.playing) this.ctx.boardScene?.setSpeed(this.speed);
        this.updateControls();
      },
      onExit: () => void this.showArchive(),
    });
    this.updateControls();
  }

  /** 분석 화면에서 특정 턴으로 바로 이동해 재생을 연다. */
  openPlaybackAtTurn(doc: ReplayDocument, turn: number): void {
    this.openPlayback(doc);
    const pb = this.playback;
    if (!pb) return; // 검증 실패로 열리지 않은 경우
    pb.seekTurn(turn);
    this.ctx.boardScene?.setState(pb.state);
    this.updateControls();
  }

  /** 재생 UI를 정리한다(보관함·타이틀로 나갈 때). */
  stopPlaybackUi(): void {
    this.playing = false;
    this.playback = null;
    this.controls?.destroy();
    this.controls = null;
    this.ctx.boardScene?.setSpeed(1);
    this.ctx.hud.setPlayControlsVisible(true);
  }

  private togglePlaying(): void {
    const pb = this.playback;
    if (!pb) return;
    if (this.playing) {
      this.playing = false;
      this.updateControls();
      return;
    }
    if (pb.atEnd) this.jump((p) => p.toStart());
    this.playing = true;
    this.updateControls();
    void this.runLoop();
  }

  private async runLoop(): Promise<void> {
    const pb = this.playback;
    if (!pb || this.stepBusy) return;
    this.stepBusy = true;
    this.ctx.boardScene?.setSpeed(this.speed);
    while (this.playing && this.playback === pb && !pb.atEnd) {
      const events = pb.stepForward();
      if (!events) break;
      await playEvents(this.ctx.boardScene, events);
      this.updateControls();
    }
    this.playing = false;
    this.stepBusy = false;
    this.ctx.boardScene?.setSpeed(1);
    this.updateControls();
  }

  /** 한 명령만 연출과 함께 앞으로 재생한다. */
  private async stepForward(): Promise<void> {
    const pb = this.playback;
    if (!pb || pb.atEnd || this.stepBusy) return;
    this.playing = false;
    const events = pb.stepForward();
    if (!events) return;
    this.stepBusy = true;
    this.ctx.boardScene?.setSpeed(this.speed);
    await playEvents(this.ctx.boardScene, events);
    this.ctx.boardScene?.setSpeed(1);
    this.stepBusy = false;
    this.updateControls();
  }

  /** 위치 이동(뒤로·턴 이동·처음·마지막): 재생을 멈추고 상태를 다시 그린다. */
  private jump(fn: (pb: ReplayPlayback) => void): void {
    const pb = this.playback;
    if (!pb || this.stepBusy) return;
    this.playing = false;
    fn(pb);
    this.ctx.boardScene?.setState(pb.state);
    this.updateControls();
  }

  private updateControls(): void {
    const pb = this.playback;
    if (!pb || !this.controls) return;
    const st = pb.state;
    this.controls.update({
      playing: this.playing,
      speed: this.speed,
      turn: Math.min(st.turn, st.maxTurns),
      maxTurns: st.maxTurns,
      index: pb.index,
      length: pb.length,
      factionName: factionName(st.current),
      gold: st.factions[st.config.humanFaction].gold,
      score: factionScore(st, st.config.humanFaction),
      description: describeStep(pb.lastEvents),
      resultText: pb.atEnd
        ? describeResult(pb.doc.result.winner, pb.doc.result.turns)
        : undefined,
    });
  }

  // ---------------- 가져오기·내보내기 ----------------

  private async exportReplay(id: string): Promise<void> {
    const rec = await documentStore()
      .get<ReplayDocument>('replays', id)
      .catch(() => null);
    if (!rec?.data) {
      this.ctx.hud.toast(t('replay.loadFailed'));
      return;
    }
    // 선택 평가: 비우거나 건너뛰면 evaluation 생략. 로컬 JSON만 내려받고 외부 전송 없음.
    const evaluation = await promptPlaytestEvaluation(this.ctx.hudRoot);
    const base: ReplayDocument = { ...rec.data };
    delete base.evaluation;
    const payload: ReplayDocument = evaluation ? { ...base, evaluation } : base;
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private async shareReplay(id: string): Promise<void> {
    const rec = await documentStore()
      .get<ReplayDocument>('replays', id)
      .catch(() => null);
    if (!rec?.data) {
      this.ctx.hud.toast(t('replay.loadFailed'));
      return;
    }
    const json = JSON.stringify(rec.data);
    try {
      const file = new File([json], `${id}.json`, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch {
      /* 사용자가 공유 시트를 닫은 경우 등 — 클립보드로 폴백 */
    }
    try {
      await navigator.clipboard.writeText(json);
      this.ctx.hud.toast(t('replay.copied'));
    } catch {
      this.ctx.hud.toast(t('play.shareUnavailable'));
    }
  }

  private async importReplay(file: File): Promise<void> {
    if (file.size > REPLAY_MAX_IMPORT_BYTES) {
      this.ctx.hud.toast(t('replay.fileTooLarge'));
      return;
    }
    const token = this.ctx.currentToken();
    const text = await file.text().catch(() => null);
    if (text === null) {
      this.ctx.hud.toast(t('replay.fileReadFailed'));
      return;
    }
    const decoded = decodeReplayDocument(text);
    if (!decoded.ok) {
      this.ctx.hud.toast(t('replay.invalidFormat'));
      return;
    }
    // 게임 버전 호환 판정: exact·migratable만 보관하고, 다른 규칙 버전은 재생만 허용한다
    const compat = checkReplayCompatibility(decoded.value);
    if (compat.compatibility === 'unsupported' || compat.compatibility === 'playable-unverified') {
      if (compat.compatibility === 'playable-unverified' && !token.alive) return;
      this.playFromDocument(decoded.value);
      return;
    }
    const doc = compat.migrated ?? decoded.value;
    if (!safeVerifyReplay(doc).ok) {
      this.ctx.hud.toast(t('replay.verifyFailed'));
      return;
    }
    const id = newDocId('replay');
    try {
      await documentStore().put('replays', id, { ...doc, replayId: id });
    } catch {
      this.ctx.hud.toast(t('replay.storeFailed'));
      return;
    }
    this.ctx.hud.toast(t('replay.imported'));
    if (token.alive) void this.showArchive();
  }

  // ---------------- 게임 종료 보관 ----------------

  /** 게임 종료 시 리플레이를 자동 저장한다. 실패해도 결과 화면에는 영향을 주지 않는다. */
  captureReplay(state: GameState): void {
    this.lastReplay = null;
    try {
      const doc = buildReplayDocument(state, { replayId: newDocId('replay') });
      if (!doc) return; // 구버전 저장 이어하기 등으로 명령 기록이 불완전한 게임
      if (!safeVerifyReplay(doc).ok) return; // 재생 불가능한 기록은 저장하지 않는다
      this.lastReplay = doc;
      void documentStore()
        .put('replays', doc.replayId, doc)
        .then(() => this.pruneReplays())
        .catch(() => {});
    } catch {
      /* 리플레이 생성·저장 실패는 무시하고 결과 화면을 유지한다 */
    }
  }

  /** 요청 시 보관(테스트 플레이 결과 화면 전용). 성공 여부 반환. */
  captureReplayOnDemand(state: GameState): boolean {
    this.captureReplay(state);
    return this.lastReplay !== null;
  }

  /** 즐겨찾기가 아닌 오래된 리플레이를 정리한다(최신 30개 유지). */
  private async pruneReplays(): Promise<void> {
    try {
      const favs = this.favorites();
      const list = await documentStore().list('replays');
      for (const s of list.filter((x) => !favs.has(x.id)).slice(30)) {
        await documentStore().remove('replays', s.id);
      }
    } catch {
      /* 정리 실패는 무시 */
    }
  }

  dispose(): void {
    this.stopPlaybackUi();
  }
}

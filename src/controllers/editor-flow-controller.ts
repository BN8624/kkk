// 한 줄 목적: 제작실 홈·초안·에디터 씬/패널 수명주기·가져오기/내보내기·테스트 플레이 진입·복귀를 담당한다
import { UNIT_STATS, FACTION_NAMES } from '../core/data';
import { factionScore, newGameFromScenario } from '../core/game';
import { decodeScenarioInput } from '../core/decode';
import { normalizeScenario } from '../core/scenario/normalize';
import { isPlayable } from '../core/scenario/validate';
import { SCENARIO_LIMITS, type ScenarioDocumentV1 } from '../core/scenario/types';
import { SCENARIO_IDS, SCENARIOS } from '../core/scenarios';
import type { Axial, GameState } from '../core/types';
import { EditorController, type EditorTool } from '../editor/controller';
import { loadDraftItems } from '../editor/drafts';
import { cloneBuiltinDocument, emptyDocument, randomDocument } from '../editor/new-doc';
import { clone } from '../editor/ops';
import { decodeShareCode, encodeShareCode, shareUrlFromCode } from '../editor/share';
import { EditorScene, type EditorSceneCallbacks } from '../render/EditorScene';
import { newDocId } from '../storage/docstore';
import { documentStore } from '../storage/idb';
import { EditorPanel, showEditorHomeScreen, showImportTextScreen } from '../ui/editor';
import type { AppContext } from '../app/app-shell';
import type { AppController } from '../app/lifecycle';
import type { EditorFlow } from '../app/navigation';

export class EditorFlowController implements AppController, EditorFlow {
  private editor: EditorController | null = null;
  private panel: EditorPanel | null = null;
  private editorScene: EditorScene | null = null;
  private editorSceneStarted = false;
  private tilePickResolve: ((v: Axial | null) => void) | null = null;
  private pickBanner: HTMLElement | null = null;

  constructor(private ctx: AppContext) {}

  /** E2E 브리지: 편집 중 문서. */
  get currentDoc(): ScenarioDocumentV1 | null {
    return this.editor?.doc ?? null;
  }

  private isPaintTool(): boolean {
    const t = this.editor?.tool;
    return t === 'plains' || t === 'forest' || t === 'mountain' || t === 'water' || t === 'erase';
  }

  // ---------------- 홈·초안 ----------------

  async showHome(): Promise<void> {
    const token = this.ctx.enterMode('editor');
    this.closeSession();
    const drafts = await loadDraftItems();
    if (!token.alive) return;
    showEditorHomeScreen(
      this.ctx.overlay,
      drafts,
      SCENARIO_IDS.map((id) => ({ id, name: SCENARIOS[id].name })),
      {
        onNewEmpty: () => this.openEditorSession(emptyDocument(newDocId('custom'))),
        onNewRandom: () =>
          this.openEditorSession(randomDocument(newDocId('custom'), Date.now() >>> 0)),
        onCloneBuiltin: (id) =>
          this.openEditorSession(
            cloneBuiltinDocument(id, newDocId('custom'), Date.now() >>> 0, `${SCENARIOS[id].name} 사본`),
          ),
        onOpenDraft: (id) => void this.openDraft(id),
        onDeleteDraft: (id) => {
          if (!window.confirm('이 초안을 삭제할까요?')) return;
          documentStore()
            .remove('scenario-drafts', id)
            .then(() => documentStore().remove('editor-autosave', id))
            .then(() => this.showHome())
            .catch(() => this.ctx.hud.toast('삭제하지 못했습니다'));
        },
        onImportFile: (file) => void this.importScenarioFile(file),
        onImportText: () =>
          showImportTextScreen(this.ctx.overlay, {
            onSubmit: (text) => void this.importScenarioText(text),
            onBack: () => void this.showHome(),
          }),
        onBack: () => this.ctx.nav.toTitle(),
      },
    );
  }

  private async openDraft(id: string): Promise<void> {
    const token = this.ctx.currentToken();
    // 자동 저장본이 더 최신이면 그것을 제안한다
    const draft = await documentStore().get<ScenarioDocumentV1>('scenario-drafts', id).catch(() => null);
    const auto = await documentStore().get<ScenarioDocumentV1>('editor-autosave', id).catch(() => null);
    if (!token.alive) return;
    let doc = draft?.data ?? null;
    if (auto?.data && (!draft || auto.updatedAt > draft.updatedAt)) {
      if (!doc || window.confirm('저장하지 않은 자동 저장본이 있습니다. 이어서 편집할까요?')) {
        doc = auto.data;
      }
    }
    if (!doc) {
      this.ctx.hud.toast('초안을 불러오지 못했습니다');
      return;
    }
    this.openEditorSession(doc);
  }

  // ---------------- 가져오기 ----------------

  private async importScenarioFile(file: File): Promise<void> {
    if (file.size > SCENARIO_LIMITS.maxImportBytes) {
      this.ctx.hud.toast('파일이 너무 큽니다');
      return;
    }
    const token = this.ctx.currentToken();
    const text = await file.text().catch(() => null);
    if (!token.alive) return;
    const result = decodeScenarioInput(text ?? '');
    if (!result.ok) {
      this.ctx.hud.toast(result.issues[0]?.message ?? '시나리오 형식이 아닙니다');
      return;
    }
    this.openImportedDocument(result.value);
  }

  /** 붙여넣기 가져오기: JSON 텍스트 또는 공유 코드(TCS1)·공유 URL을 판별해 처리한다. */
  private async importScenarioText(text: string): Promise<void> {
    const t = text.trim();
    if (!t) return;
    const token = this.ctx.currentToken();
    let doc: ScenarioDocumentV1 | null = null;
    let firstMessage: string | undefined;
    if (t.startsWith('{')) {
      const result = decodeScenarioInput(t);
      doc = result.ok ? result.value : null;
      if (!result.ok) firstMessage = result.issues[0]?.message;
    } else {
      const result = await decodeShareCode(t);
      doc = result.doc;
      if (!doc) firstMessage = result.issues[0]?.message;
    }
    if (!token.alive) return;
    if (!doc) {
      this.ctx.hud.toast(firstMessage ?? '가져올 수 없습니다');
      return;
    }
    this.openImportedDocument(doc);
  }

  /** 가져온 문서는 새 ID로 초안이 된다(내장·기존 문서를 덮어쓰지 않는다). */
  openImportedDocument(doc: ScenarioDocumentV1): void {
    const imported = clone(doc);
    imported.id = newDocId('custom');
    this.openEditorSession(imported);
    this.ctx.hud.toast('가져온 시나리오를 편집합니다 — 검증을 실행해 보세요');
  }

  // ---------------- 에디터 세션 ----------------

  /** 에디터 세션을 연다(문서의 id가 초안 키가 된다). */
  private openEditorSession(doc: ScenarioDocumentV1): void {
    this.editor?.dispose();
    this.editor = new EditorController(documentStore(), doc, doc.id);
    this.mountEditorUi();
  }

  /** 에디터 씬·패널을 (재)구성한다. 세션(문서·undo 히스토리)은 유지된다. */
  private mountEditorUi(): void {
    if (!this.editor) return;
    this.ctx.enterMode('editor');
    this.ctx.overlay.hide();
    this.ctx.hud.setPlayControlsVisible(false);
    const callbacks: EditorSceneCallbacks = {
      onTap: (q, r) => this.editorTap(q, r),
      onPaint: (q, r) => {
        if (this.editor?.paintAt(q, r)) this.editorScene?.refresh();
      },
      onStrokeStart: () => this.editor?.beginStroke(),
      onStrokeEnd: () => {
        this.editor?.endStroke();
        this.updatePanel();
      },
      isPaintTool: () => this.isPaintTool(),
      onReady: () => {},
    };
    this.ctx.sleepBoard();
    const game = this.ctx.game;
    if (!this.editorSceneStarted) {
      game.scene.add('editor', EditorScene, true, { doc: this.editor.doc, callbacks });
      this.editorSceneStarted = true;
    } else {
      game.scene.start('editor', { doc: this.editor.doc, callbacks });
    }
    this.editorScene = game.scene.getScene('editor') as EditorScene;
    this.panel?.destroy();
    this.panel = new EditorPanel(
      this.ctx.hudRoot,
      () => this.editor!.doc,
      {
        onTool: (tool: EditorTool) => {
          this.editor!.tool = tool;
          this.editorScene?.showSelection(null);
          this.updatePanel();
        },
        onOptions: (patch) => {
          Object.assign(this.editor!.options, patch);
          this.updatePanel();
        },
        onUndo: () => this.historyStep('undo'),
        onRedo: () => this.historyStep('redo'),
        onValidate: () => this.panel!.showValidation(this.editor!.validate()),
        onSave: () => {
          void this.editor!.saveDraft().then((ok) =>
            this.ctx.hud.toast(ok ? '초안을 저장했습니다' : '저장하지 못했습니다'),
          );
        },
        onTestPlay: () => this.startTestPlay(false),
        onSpectate: () => this.startTestPlay(true),
        onExport: () => this.exportScenario(),
        onExit: () => void this.exitEditorSession(),
        onMetaChange: (meta) => {
          const d = this.editor!.doc;
          this.editor!.pushOp({
            type: 'meta',
            before: { title: d.title, description: d.description, ...(d.author ? { author: d.author } : {}) },
            after: meta,
          });
          this.updatePanel();
        },
        onRulesChange: (rules) => {
          this.editor!.pushOp({ type: 'rules', before: clone(this.editor!.doc.rules), after: rules });
          this.updatePanel();
        },
        onFactionChange: (setup) => {
          const before = this.editor!.doc.factions.find((f) => f.id === setup.id)!;
          this.editor!.pushOp({ type: 'faction', id: setup.id, before: clone(before), after: setup });
          this.updatePanel();
        },
        onResize: (cols, rows) => {
          if (this.editor!.resizeBoard(cols, rows)) {
            this.editorScene?.setDoc(this.editor!.doc);
            this.updatePanel();
          } else {
            this.ctx.hud.toast('허용 범위 밖의 크기입니다');
          }
        },
        onConditionsChange: (next) => {
          const d = this.editor!.doc;
          this.editor!.pushOp({
            type: 'conditions',
            before: {
              victory: clone(d.victoryConditions),
              defeat: clone(d.defeatConditions),
              stars: clone(d.starConditions ?? []),
            },
            after: next,
          });
          this.updatePanel();
        },
        onUnitUpdate: (index, setup) => {
          this.editor!.updateUnit(index, setup);
          this.editorScene?.refresh();
          this.updatePanel();
        },
        onUnitRemove: (index) => {
          const u = this.editor!.doc.units[index];
          if (u) this.editor!.removeUnitAt(u.q, u.r);
          this.editorScene?.refresh();
          this.updatePanel();
        },
        requestTilePick: (label) => this.beginTilePick(label),
      },
    );
    this.updatePanel();
  }

  private historyStep(dir: 'undo' | 'redo'): void {
    const ed = this.editor;
    if (!ed) return;
    const tilesBefore = ed.doc.board.tiles.length;
    const ok = dir === 'undo' ? ed.undo() : ed.redo();
    if (!ok) return;
    if (ed.doc.board.tiles.length !== tilesBefore) this.editorScene?.setDoc(ed.doc);
    else this.editorScene?.refresh();
    this.updatePanel();
  }

  editorTap(q: number, r: number): void {
    const ed = this.editor;
    if (!ed) return;
    // 조건 대상 타일 선택 모드
    if (this.tilePickResolve) {
      const exists = ed.doc.board.tiles.some((t) => t.q === q && t.r === r);
      if (!exists) return;
      const resolve = this.tilePickResolve;
      this.endTilePick();
      resolve({ q, r });
      this.panel?.openObjectivesSheet();
      return;
    }
    if (ed.tool === 'unit') {
      const result = ed.placeUnitAt(q, r);
      if (result === 'blocked') this.ctx.hud.toast('여기에는 유닛을 배치할 수 없습니다');
      this.editorScene?.refresh();
      this.updatePanel();
      return;
    }
    if (ed.tool === 'select') {
      const idx = ed.unitIndexAt(q, r);
      if (idx >= 0) {
        const unit = ed.doc.units[idx];
        this.editorScene?.showSelection({ q, r });
        this.panel?.openUnitSheet(idx, unit, UNIT_STATS[unit.type].hp);
      } else {
        this.editorScene?.showSelection(
          ed.doc.board.tiles.some((t) => t.q === q && t.r === r) ? { q, r } : null,
        );
        this.panel?.closeSheet();
      }
      return;
    }
    if (ed.tool === 'erase' && ed.removeUnitAt(q, r)) {
      this.editorScene?.refresh();
      this.updatePanel();
      return;
    }
    // 칠 도구 탭 = 단일 획
    if (ed.paintAt(q, r)) {
      this.editorScene?.refresh();
      this.updatePanel();
    }
  }

  private beginTilePick(label: string): Promise<Axial | null> {
    this.endTilePick();
    const banner = document.createElement('div');
    banner.className = 'ed-pick-banner';
    banner.innerHTML = `<span>${label}</span><button>취소</button>`;
    this.ctx.hudRoot.appendChild(banner);
    this.pickBanner = banner;
    return new Promise<Axial | null>((resolve) => {
      this.tilePickResolve = resolve;
      banner.querySelector('button')!.addEventListener('click', () => {
        this.endTilePick();
        resolve(null);
        this.panel?.openObjectivesSheet();
      });
    });
  }

  private endTilePick(): void {
    this.tilePickResolve = null;
    this.pickBanner?.remove();
    this.pickBanner = null;
  }

  private updatePanel(): void {
    const ed = this.editor;
    if (!ed || !this.panel) return;
    this.panel.update(ed.tool, ed.options, ed.history.canUndo, ed.history.canRedo);
  }

  // ---------------- 내보내기·공유 ----------------

  /** 내보내기·공유 시트: JSON 파일·클립보드·압축 공유 코드·공유 URL. */
  private exportScenario(): void {
    const ed = this.editor;
    if (!ed) return;
    const overlay = this.ctx.overlay;
    overlay.show(`
      <h1 style="font-size:22px;">내보내기·공유</h1>
      <p class="subtitle" style="font-size:12.5px;">받는 사람은 제작실의 "코드 가져오기"나 공유 URL로 엽니다</p>
      <button class="big-btn" id="ex-file">JSON 파일 저장</button>
      <button class="sub-btn" id="ex-copy-json">JSON 텍스트 복사</button>
      <button class="sub-btn" id="ex-copy-code">공유 코드 복사</button>
      <button class="sub-btn" id="ex-copy-url">공유 URL 복사</button>
      <button class="sub-btn" id="ex-close">닫기</button>`);
    overlay.bind({
      'ex-file': () => {
        const blob = new Blob([JSON.stringify(ed.doc, null, 1)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${ed.doc.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
      },
      'ex-copy-json': () =>
        void this.copyShareText(JSON.stringify(ed.doc, null, 1), 'JSON을 복사했습니다'),
      'ex-copy-code': () =>
        void encodeShareCode(ed.doc).then((code) =>
          this.copyShareText(code, '공유 코드를 복사했습니다'),
        ),
      'ex-copy-url': () =>
        void encodeShareCode(ed.doc).then((code) => {
          const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
          const url = shareUrlFromCode(code, base);
          if (!url) {
            this.ctx.hud.toast('문서가 커서 URL 공유가 어렵습니다 — 공유 코드를 사용하세요');
            return;
          }
          return this.copyShareText(url, '공유 URL을 복사했습니다');
        }),
      'ex-close': () => overlay.hide(),
    });
  }

  /** 클립보드 복사. 실패하면 수동 복사용 텍스트 상자를 보여 준다. */
  private async copyShareText(text: string, okMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.ctx.overlay.hide();
      this.ctx.hud.toast(okMessage);
    } catch {
      const root = this.ctx.overlay.show(`
        <h1 style="font-size:20px;">직접 복사하세요</h1>
        <textarea class="ed-import-text" rows="6" readonly></textarea>
        <button class="sub-btn" id="ex-close">닫기</button>`);
      root.querySelector<HTMLTextAreaElement>('textarea')!.value = text;
      this.ctx.overlay.bind({ 'ex-close': () => this.ctx.overlay.hide() });
    }
  }

  /** 에디터에서 나간다(변경이 있으면 초안 저장 여부 확인, 자동 저장은 항상 남긴다). */
  private async exitEditorSession(): Promise<void> {
    const ed = this.editor;
    if (ed?.dirty) {
      await ed.autosaveNow();
      if (window.confirm('저장하지 않은 변경이 있습니다. 초안으로 저장할까요?')) {
        await ed.saveDraft();
      }
    }
    void this.showHome();
  }

  // ---------------- 테스트 플레이 ----------------

  /**
   * 편집 중 문서를 검증→정규화해 실제 게임 엔진으로 테스트한다.
   * 스냅샷을 새로 만들므로 편집 원본은 게임 상태의 영향을 받지 않는다.
   */
  private startTestPlay(spectate: boolean): void {
    const ed = this.editor;
    if (!ed) return;
    const issues = ed.validate();
    if (!isPlayable(issues)) {
      this.panel?.showValidation(issues);
      return;
    }
    let state: GameState;
    try {
      const snapshot = normalizeScenario(ed.doc);
      state = newGameFromScenario(Date.now() >>> 0, snapshot, {
        mode: 'custom',
        difficulty: 'normal',
      });
    } catch {
      this.ctx.hud.toast('시나리오를 시작할 수 없습니다 — 검증을 확인하세요');
      return;
    }
    void ed.autosaveNow();
    this.ctx.nav.launch(state, { testPlay: true, spectate });
    this.ctx.hud.toast(spectate ? 'AI 관전 테스트 — 목표 버튼으로 상태를 확인하세요' : '테스트 플레이 — 에디터로 버튼으로 돌아갑니다');
  }

  /** 테스트 플레이 화면 요소만 걷어낸다(에디터 세션은 유지). */
  suspendForTestPlay(): void {
    this.endTilePick();
    this.panel?.destroy();
    this.panel = null;
    if (this.editorSceneStarted) this.ctx.game.scene.stop('editor');
    this.ctx.wakeBoard();
  }

  /** 테스트 플레이에서 에디터로 복귀한다. 편집 원본과 undo 히스토리는 유지된다. */
  returnFromTestPlay(): void {
    this.ctx.play.abandonTestPlay();
    this.mountEditorUi();
  }

  /** 테스트 플레이 종료 결과: 간단한 요약과 재테스트·에디터 복귀만 제공한다. */
  handleTestPlayEnd(state: GameState): void {
    const me = state.config.humanFaction;
    const word = state.winner === 'draw' ? '무승부' : state.winner === me ? '승리' : '패배';
    const winnerName = state.winner && state.winner !== 'draw' ? FACTION_NAMES[state.winner] : null;
    const overlay = this.ctx.overlay;
    overlay.show(`
      <h1 class="result-word ${state.winner === me ? 'win' : 'lose'}" style="font-size:34px;">${word}</h1>
      <p class="subtitle">테스트 플레이 종료 · ${Math.min(state.turn, state.maxTurns)}턴${
        winnerName ? ` · 승자: ${winnerName}` : ''
      } · 점수 ${factionScore(state, me)}점</p>
      <button class="big-btn" id="tp-again">다시 테스트</button>
      <button class="sub-btn" id="tp-spectate">AI 관전으로 다시</button>
      <button class="sub-btn" id="tp-save-replay">리플레이 저장</button>
      <button class="sub-btn" id="tp-editor">에디터로 돌아가기</button>`);
    overlay.bind({
      'tp-again': () => this.startTestPlay(false),
      'tp-spectate': () => this.startTestPlay(true),
      // 테스트 플레이는 자동 보관하지 않는다 — 원할 때만 보관함에 남긴다
      'tp-save-replay': () => {
        const btn = overlay.element.querySelector<HTMLButtonElement>('#tp-save-replay')!;
        if (btn.disabled) return;
        if (this.ctx.replays.captureReplayOnDemand(state)) {
          btn.disabled = true;
          btn.textContent = '리플레이 저장됨';
          this.ctx.hud.toast('리플레이를 보관함에 저장했습니다');
        } else {
          this.ctx.hud.toast('이 게임은 리플레이로 저장할 수 없습니다');
        }
      },
      'tp-editor': () => this.returnFromTestPlay(),
    });
  }

  /** 에디터 세션·씬·패널을 정리한다(홈·타이틀로 나갈 때). */
  closeSession(): void {
    this.endTilePick();
    this.editor?.dispose();
    this.editor = null;
    this.panel?.destroy();
    this.panel = null;
    if (this.editorSceneStarted && this.editorScene) {
      this.ctx.game.scene.stop('editor');
    }
    this.editorScene = null;
    this.ctx.wakeBoard();
  }

  dispose(): void {
    this.closeSession();
  }
}

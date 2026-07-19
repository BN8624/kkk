// 한 줄 목적: 시나리오 제작실 UI(홈 화면·도구 팔레트·속성 시트·조건 편집·검증 패널)를 렌더링한다
import type { EvalPolicyId } from '../../core/eval/policies';
import type { QualityTrialReport } from '../../core/eval/quality-trial';
import type { QualityReport } from '../../core/scenario/quality';
import type { EditorTool, EditorToolOptions } from '../../editor/controller';
import {
  SCENARIO_LIMITS,
  type DefeatCondition,
  type ScenarioDocumentV1,
  type ScenarioFactionSetup,
  type ScenarioUnitSetup,
  type StarCondition,
  type ValidationIssue,
  type VictoryCondition,
} from '../../core/scenario/types';
import type { Axial, BuildingId, FactionId, UnitTypeId } from '../../core/types';
import { factionName, t, unitName, victoryConditionText } from '../../i18n';
import { escapeHtml } from '../shared/dom';
import type { OverlayHost } from '../shared/overlay';

// ---------------- 제작실 홈 ----------------

export interface EditorDraftItem {
  id: string;
  title: string;
  updatedAt: string;
  sizeBytes: number;
  /** 가져오기(파일·코드·URL)로 만들어진 초안 여부 — 커스텀 목록의 분류에 쓴다 */
  imported?: boolean;
}

export interface EditorHomeHandlers {
  onNewEmpty: () => void;
  onNewRandom: () => void;
  onCloneBuiltin: (id: 'three-crowns' | 'broken-strait' | 'crown-heart') => void;
  onOpenDraft: (id: string) => void;
  onDeleteDraft: (id: string) => void;
  onImportFile: (file: File) => void;
  /** 공유 코드 또는 JSON 텍스트 붙여넣기 가져오기 화면 열기 */
  onImportText: () => void;
  onBack: () => void;
}

/** 제작실 홈: 새 문서 시작·초안 목록·가져오기. */
export function showEditorHomeScreen(
  overlay: OverlayHost,
  drafts: EditorDraftItem[],
  builtins: { id: 'three-crowns' | 'broken-strait' | 'crown-heart'; name: string }[],
  handlers: EditorHomeHandlers,
): void {
  const draftRows = drafts
    .map(
      (d) => `
      <div class="rp-item" data-id="${escapeHtml(d.id)}">
        <button class="rp-main" data-act="open">
          <span class="rp-title"><b>${escapeHtml(d.title || t('scenarios.untitled'))}</b></span>
          <span class="rp-sub">${escapeHtml(d.updatedAt.slice(0, 10))} · ${Math.max(1, Math.round(d.sizeBytes / 1024))}KB</span>
        </button>
        <div class="rp-actions"><button data-act="del" aria-label="${escapeHtml(t('editor.delete'))}">✕</button></div>
      </div>`,
    )
    .join('');
  const root = overlay.show(`
      <h1 style="font-size:24px;">${escapeHtml(t('editor.title'))}</h1>
      <p class="subtitle" style="font-size:12.5px;">${escapeHtml(t('editor.subtitle'))}</p>
      <div style="display:flex; gap:8px; width:min(300px,82vw);">
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-new-empty">${escapeHtml(t('editor.emptyMap'))}</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-new-random">${escapeHtml(t('editor.randomMap'))}</button>
      </div>
      <div style="display:flex; gap:8px; width:min(300px,82vw);">
        ${builtins
          .map(
            (b) =>
              `<button class="sub-btn" style="width:auto;flex:1;font-size:13px;" data-builtin="${b.id}">${escapeHtml(t('editor.clone', { name: b.name }))}</button>`,
          )
          .join('')}
      </div>
      ${drafts.length > 0 ? `<p class="subtitle" style="font-size:13px;margin-bottom:-6px;">${escapeHtml(t('editor.drafts'))}</p><div class="rp-list">${draftRows}</div>` : ''}
      <input type="file" id="ed-import-file" accept=".json,application/json" style="display:none">
      <div style="display:flex; gap:8px; width:min(300px,82vw);">
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-import">${escapeHtml(t('editor.importJson'))}</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-import-text">${escapeHtml(t('editor.importCode'))}</button>
      </div>
      <button class="sub-btn" id="btn-back">${escapeHtml(t('common.back'))}</button>`);
  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-builtin]')) {
    btn.addEventListener('click', () =>
      handlers.onCloneBuiltin(btn.dataset.builtin as 'three-crowns' | 'broken-strait' | 'crown-heart'),
    );
  }
  for (const row of root.querySelectorAll<HTMLElement>('.rp-item')) {
    const id = row.dataset.id!;
    row.querySelector('[data-act="open"]')!.addEventListener('click', () => handlers.onOpenDraft(id));
    row.querySelector('[data-act="del"]')!.addEventListener('click', () => handlers.onDeleteDraft(id));
  }
  const fileInput = root.querySelector<HTMLInputElement>('#ed-import-file')!;
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) handlers.onImportFile(f);
    fileInput.value = '';
  });
  overlay.bind({
    'btn-new-empty': handlers.onNewEmpty,
    'btn-new-random': handlers.onNewRandom,
    'btn-import': () => fileInput.click(),
    'btn-import-text': handlers.onImportText,
    'btn-back': handlers.onBack,
  });
}

/** 공식 전장 목록 항목(불변 콘텐츠 — 플레이·복제만 가능). */
export interface OfficialScenarioItem {
  id: string;
  title: string;
  description: string;
  /** 권장 왕국·난이도·예상 시간 요약 문장 */
  recommended: string;
}

/** 커스텀 시나리오 보관함: 공식 전장·내 전장·가져온 전장을 구분해 표시한다. */
export function showCustomScenarioListScreen(
  overlay: OverlayHost,
  data: { officials: OfficialScenarioItem[]; mine: EditorDraftItem[]; imported: EditorDraftItem[] },
  handlers: {
    onPlay: (id: string) => void;
    onPlayOfficial: (id: string) => void;
    onCloneOfficial: (id: string) => void;
    onBack: () => void;
  },
): void {
  const draftRow = (d: EditorDraftItem) => `
      <div class="rp-item" data-id="${escapeHtml(d.id)}" data-kind="draft">
        <button class="rp-main" data-act="play">
          <span class="rp-title"><b>${escapeHtml(d.title || t('scenarios.untitled'))}</b></span>
          <span class="rp-sub">${escapeHtml(d.updatedAt.slice(0, 10))} · ${escapeHtml(t('scenarios.tapToPlay'))}</span>
        </button>
      </div>`;
  const officialRow = (o: OfficialScenarioItem) => `
      <div class="rp-item" data-id="${escapeHtml(o.id)}" data-kind="official">
        <button class="rp-main" data-act="play-official">
          <span class="rp-title"><b>${escapeHtml(o.title)}</b> <span class="hud-chip" style="font-size:11px;">${escapeHtml(t('scenarios.officialBadge'))}</span></span>
          <span class="rp-sub">${escapeHtml(o.description)}</span>
          <span class="rp-sub">${escapeHtml(o.recommended)}</span>
        </button>
        <button class="rp-exit" data-act="clone" aria-label="${escapeHtml(t('scenarios.cloneAria', { title: o.title }))}">${escapeHtml(t('scenarios.clone'))}</button>
      </div>`;
  const section = (title: string, body: string) =>
    `<h2 style="font-size:15px;margin:14px 0 6px;">${escapeHtml(title)}</h2>${body}`;
  const root = overlay.show(`
      <h1 style="font-size:24px;">${escapeHtml(t('scenarios.title'))}</h1>
      <p class="subtitle" style="font-size:12.5px;">${escapeHtml(t('scenarios.subtitle'))}</p>
      ${section(t('scenarios.official'), `<div class="rp-list">${data.officials.map(officialRow).join('')}</div>`)}
      ${section(
        t('scenarios.mine'),
        data.mine.length > 0
          ? `<div class="rp-list">${data.mine.map(draftRow).join('')}</div>`
          : `<p class="subtitle" style="font-size:12px;">${escapeHtml(t('scenarios.emptyMine'))}</p>`,
      )}
      ${
        data.imported.length > 0
          ? section(t('scenarios.imported'), `<div class="rp-list">${data.imported.map(draftRow).join('')}</div>`)
          : ''
      }
      <button class="sub-btn" id="btn-back">${escapeHtml(t('common.back'))}</button>`);
  for (const row of root.querySelectorAll<HTMLElement>('.rp-item')) {
    const id = row.dataset.id!;
    row.querySelector('[data-act="play"]')?.addEventListener('click', () => handlers.onPlay(id));
    row
      .querySelector('[data-act="play-official"]')
      ?.addEventListener('click', () => handlers.onPlayOfficial(id));
    row.querySelector('[data-act="clone"]')?.addEventListener('click', () => handlers.onCloneOfficial(id));
  }
  overlay.bind({ 'btn-back': handlers.onBack });
}

/** 공유 코드·JSON 텍스트 붙여넣기 가져오기 화면. */
export function showImportTextScreen(
  overlay: OverlayHost,
  handlers: { onSubmit: (text: string) => void; onBack: () => void },
): void {
  const root = overlay.show(`
      <h1 style="font-size:22px;">${escapeHtml(t('editor.importTitle'))}</h1>
      <p class="subtitle" style="font-size:12.5px;">${escapeHtml(t('editor.importHelp'))}</p>
      <textarea id="ed-import-text" class="ed-import-text" rows="6" spellcheck="false"
        placeholder="${escapeHtml(t('editor.importPlaceholder'))}"></textarea>
      <button class="big-btn" id="btn-import-go">${escapeHtml(t('editor.import'))}</button>
      <button class="sub-btn" id="btn-back">${escapeHtml(t('common.back'))}</button>`);
  const area = root.querySelector<HTMLTextAreaElement>('#ed-import-text')!;
  overlay.bind({
    'btn-import-go': () => handlers.onSubmit(area.value),
    'btn-back': handlers.onBack,
  });
}

// ---------------- 에디터 패널 ----------------

export interface EditorPanelHandlers {
  onTool: (tool: EditorTool) => void;
  onOptions: (patch: Partial<EditorToolOptions>) => void;
  onUndo: () => void;
  onRedo: () => void;
  onValidate: () => void;
  /** 품질 보고서(전력 균형·거리·병목·별점 달성 가능성) */
  onQuality: () => void;
  /** AI 품질 시험(평가 정책 자동 관전) */
  onAiTrial: () => void;
  onSave: () => void;
  onTestPlay: () => void;
  /** AI 대 AI 관전 테스트 */
  onSpectate: () => void;
  onExport: () => void;
  onExit: () => void;
  onMetaChange: (meta: { title: string; description: string; author?: string }) => void;
  onRulesChange: (rules: ScenarioDocumentV1['rules']) => void;
  onFactionChange: (setup: ScenarioFactionSetup) => void;
  onResize: (cols: number, rows: number) => void;
  onConditionsChange: (next: {
    victory: VictoryCondition[];
    defeat: DefeatCondition[];
    stars: StarCondition[];
  }) => void;
  onUnitUpdate: (index: number, setup: ScenarioUnitSetup) => void;
  onUnitRemove: (index: number) => void;
  /** 조건의 대상 타일을 지도 탭으로 고르게 한다. 취소되면 null. */
  requestTilePick: (label: string) => Promise<Axial | null>;
}

const TOOLS: EditorTool[] = [
  'select',
  'plains',
  'forest',
  'mountain',
  'water',
  'capital',
  'village',
  'crown',
  'unit',
  'erase',
];

const FACTIONS: FactionId[] = ['azure', 'crimson', 'violet'];
const UNIT_TYPES: UnitTypeId[] = ['infantry', 'archer', 'cavalry'];

/** 에디터 화면의 DOM 패널(상단 바·도구 팔레트·시트). 문서 데이터는 App이 소유한다. */
export class EditorPanel {
  private handlers: EditorPanelHandlers;
  private top: HTMLElement;
  private palette: HTMLElement;
  private sheet: HTMLElement;
  private sheetReturnFocus: HTMLElement | null = null;
  private getDoc: () => ScenarioDocumentV1;

  constructor(root: HTMLElement, getDoc: () => ScenarioDocumentV1, handlers: EditorPanelHandlers) {
    this.getDoc = getDoc;
    this.handlers = handlers;

    this.top = document.createElement('div');
    this.top.className = 'ed-topbar';
    this.top.innerHTML = `
      <button id="ed-exit" class="rp-exit" aria-label="${escapeHtml(t('editor.exit'))}">✕</button>
      <span class="hud-chip" id="ed-title"></span>
      <span style="flex:1"></span>
      <button id="ed-undo" class="rp-exit" aria-label="${escapeHtml(t('editor.undo'))}">↶</button>
      <button id="ed-redo" class="rp-exit" aria-label="${escapeHtml(t('editor.redo'))}">↷</button>
      <button id="ed-check" class="rp-exit">${escapeHtml(t('editor.validate'))}</button>
      <button id="ed-menu" class="rp-exit" aria-label="${escapeHtml(t('editor.openMenu'))}">⋯</button>`;
    root.appendChild(this.top);

    this.palette = document.createElement('div');
    this.palette.className = 'ed-palette';
    root.appendChild(this.palette);

    this.sheet = document.createElement('div');
    this.sheet.className = 'sheet ed-sheet';
    this.sheet.setAttribute('role', 'dialog');
    this.sheet.setAttribute('aria-modal', 'true');
    this.sheet.setAttribute('aria-hidden', 'true');
    this.sheet.tabIndex = -1;
    this.sheet.addEventListener('keydown', (event) => this.onSheetKeyDown(event));
    root.appendChild(this.sheet);

    this.top.querySelector('#ed-exit')!.addEventListener('click', handlers.onExit);
    this.top.querySelector('#ed-undo')!.addEventListener('click', handlers.onUndo);
    this.top.querySelector('#ed-redo')!.addEventListener('click', handlers.onRedo);
    this.top.querySelector('#ed-check')!.addEventListener('click', handlers.onValidate);
    this.top.querySelector('#ed-menu')!.addEventListener('click', () => this.openMenu());
  }

  destroy(): void {
    this.top.remove();
    this.palette.remove();
    this.sheet.remove();
  }

  /** 상단 제목·도구 상태를 다시 그린다. */
  update(tool: EditorTool, options: EditorToolOptions, canUndo: boolean, canRedo: boolean): void {
    const doc = this.getDoc();
    this.top.querySelector('#ed-title')!.textContent = doc.title || t('scenarios.untitled');
    (this.top.querySelector('#ed-undo') as HTMLButtonElement).disabled = !canUndo;
    (this.top.querySelector('#ed-redo') as HTMLButtonElement).disabled = !canRedo;

    const chip = (id: string, label: string, on: boolean, data: string) =>
      `<button class="ed-chip ${on ? 'on' : ''}" data-${data}="${id}" aria-pressed="${on}">${escapeHtml(label)}</button>`;
    let sub = '';
    if (['plains', 'forest', 'mountain', 'water', 'erase'].includes(tool)) {
      sub = `<span class="ed-sub-label">${escapeHtml(t('editor.brush'))}</span>
        ${chip('1', t('editor.oneTile'), options.brush === 1, 'brush')}
        ${chip('7', t('editor.sevenTiles'), options.brush === 7, 'brush')}`;
    } else if (['capital', 'village', 'crown'].includes(tool)) {
      sub = `<span class="ed-sub-label">${escapeHtml(t('editor.owner'))}</span>
        ${chip('none', t('editor.neutral'), options.owner === null, 'owner')}
        ${FACTIONS.map((f) => chip(f, factionName(f).split(' ')[0], options.owner === f, 'owner')).join('')}`;
    } else if (tool === 'unit') {
      sub = `${FACTIONS.map((f) => chip(f, factionName(f).split(' ')[0], options.unitFaction === f, 'uf')).join('')}
        <span class="ed-sub-label">·</span>
        ${UNIT_TYPES.map((type) => chip(type, unitName(type), options.unitType === type, 'ut')).join('')}`;
    }
    this.palette.innerHTML = `
      <div class="ed-tool-row">${TOOLS.map((id) => chip(id, t(`editor.tool.${id}`), tool === id, 'tool')).join('')}</div>
      ${sub ? `<div class="ed-tool-row ed-sub-row">${sub}</div>` : ''}`;
    for (const btn of this.palette.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      btn.addEventListener('click', () => this.handlers.onTool(btn.dataset.tool as EditorTool));
    }
    for (const btn of this.palette.querySelectorAll<HTMLButtonElement>('[data-brush]')) {
      btn.addEventListener('click', () =>
        this.handlers.onOptions({ brush: Number(btn.dataset.brush) as 1 | 7 }),
      );
    }
    for (const btn of this.palette.querySelectorAll<HTMLButtonElement>('[data-owner]')) {
      btn.addEventListener('click', () =>
        this.handlers.onOptions({
          owner: btn.dataset.owner === 'none' ? null : (btn.dataset.owner as FactionId),
        }),
      );
    }
    for (const btn of this.palette.querySelectorAll<HTMLButtonElement>('[data-uf]')) {
      btn.addEventListener('click', () =>
        this.handlers.onOptions({ unitFaction: btn.dataset.uf as FactionId }),
      );
    }
    for (const btn of this.palette.querySelectorAll<HTMLButtonElement>('[data-ut]')) {
      btn.addEventListener('click', () =>
        this.handlers.onOptions({ unitType: btn.dataset.ut as UnitTypeId }),
      );
    }
  }

  closeSheet(): void {
    this.sheet.classList.remove('show');
    this.sheet.setAttribute('aria-hidden', 'true');
    if (this.sheetReturnFocus?.isConnected) this.sheetReturnFocus.focus();
    this.sheetReturnFocus = null;
  }

  private openSheet(html: string): HTMLElement {
    if (!this.sheet.classList.contains('show')) {
      this.sheetReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    this.sheet.innerHTML = html;
    this.sheet.classList.add('show');
    this.sheet.setAttribute('aria-hidden', 'false');
    queueMicrotask(() => {
      if (!this.sheet.classList.contains('show')) return;
      (this.sheetFocusable()[0] ?? this.sheet).focus();
    });
    return this.sheet;
  }

  private sheetFocusable(): HTMLElement[] {
    return [...this.sheet.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )];
  }

  private onSheetKeyDown(event: KeyboardEvent): void {
    if (!this.sheet.classList.contains('show')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeSheet();
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = this.sheetFocusable();
    if (nodes.length === 0) {
      event.preventDefault();
      this.sheet.focus();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private openMenu(): void {
    const s = this.openSheet(`
      <h3>${escapeHtml(t('editor.menu'))}</h3>
      <div class="ed-menu-grid">
        <button data-m="save">${escapeHtml(t('editor.saveDraft'))}</button>
        <button data-m="test">${escapeHtml(t('editor.testPlay'))}</button>
        <button data-m="spectate">${escapeHtml(t('editor.aiSpectate'))}</button>
        <button data-m="quality">${escapeHtml(t('editor.qualityReport'))}</button>
        <button data-m="trial">${escapeHtml(t('editor.qualityTrial'))}</button>
        <button data-m="info">${escapeHtml(t('editor.documentInfo'))}</button>
        <button data-m="rules">${escapeHtml(t('editor.rules'))}</button>
        <button data-m="factions">${escapeHtml(t('editor.factions'))}</button>
        <button data-m="objectives">${escapeHtml(t('editor.objectives'))}</button>
        <button data-m="resize">${escapeHtml(t('editor.resize'))}</button>
        <button data-m="export">${escapeHtml(t('editor.export'))}</button>
      </div>
      <button class="close-btn">${escapeHtml(t('common.close'))}</button>`);
    s.querySelector('[data-m="save"]')!.addEventListener('click', () => {
      this.closeSheet();
      this.handlers.onSave();
    });
    s.querySelector('[data-m="test"]')!.addEventListener('click', () => {
      this.closeSheet();
      this.handlers.onTestPlay();
    });
    s.querySelector('[data-m="spectate"]')!.addEventListener('click', () => {
      this.closeSheet();
      this.handlers.onSpectate();
    });
    s.querySelector('[data-m="quality"]')!.addEventListener('click', () => {
      this.closeSheet();
      this.handlers.onQuality();
    });
    s.querySelector('[data-m="trial"]')!.addEventListener('click', () => {
      this.closeSheet();
      this.handlers.onAiTrial();
    });
    s.querySelector('[data-m="info"]')!.addEventListener('click', () => this.openInfoSheet());
    s.querySelector('[data-m="rules"]')!.addEventListener('click', () => this.openRulesSheet());
    s.querySelector('[data-m="factions"]')!.addEventListener('click', () => this.openFactionsSheet());
    s.querySelector('[data-m="objectives"]')!.addEventListener('click', () => this.openObjectivesSheet());
    s.querySelector('[data-m="resize"]')!.addEventListener('click', () => this.openResizeSheet());
    s.querySelector('[data-m="export"]')!.addEventListener('click', () => {
      this.closeSheet();
      this.handlers.onExport();
    });
    s.querySelector('.close-btn')!.addEventListener('click', () => this.closeSheet());
  }

  private openInfoSheet(): void {
    const doc = this.getDoc();
    const s = this.openSheet(`
      <h3>${escapeHtml(t('editor.documentInfo'))}</h3>
      <label class="ed-field">${escapeHtml(t('editor.field.title'))}<input id="f-title" maxlength="${SCENARIO_LIMITS.maxTitleLen}" value="${escapeHtml(doc.title)}"></label>
      <label class="ed-field">${escapeHtml(t('editor.field.description'))}<textarea id="f-desc" maxlength="${SCENARIO_LIMITS.maxDescriptionLen}" rows="3">${escapeHtml(doc.description)}</textarea></label>
      <label class="ed-field">${escapeHtml(t('editor.field.author'))}<input id="f-author" maxlength="${SCENARIO_LIMITS.maxAuthorLen}" value="${escapeHtml(doc.author ?? '')}"></label>
      <div class="ed-row"><button class="close-btn" id="f-ok">${escapeHtml(t('common.apply'))}</button><button class="close-btn" id="f-cancel">${escapeHtml(t('common.cancel'))}</button></div>`);
    s.querySelector('#f-ok')!.addEventListener('click', () => {
      const title = (s.querySelector('#f-title') as HTMLInputElement).value.trim() || t('scenarios.untitled');
      const description = (s.querySelector('#f-desc') as HTMLTextAreaElement).value;
      const author = (s.querySelector('#f-author') as HTMLInputElement).value.trim();
      this.handlers.onMetaChange({ title, description, ...(author ? { author } : {}) });
      this.closeSheet();
    });
    s.querySelector('#f-cancel')!.addEventListener('click', () => this.closeSheet());
  }

  private openRulesSheet(): void {
    const doc = this.getDoc();
    const s = this.openSheet(`
      <h3>${escapeHtml(t('editor.rules'))}</h3>
      <label class="ed-field">${escapeHtml(t('editor.field.maxTurns', { min: SCENARIO_LIMITS.maxTurnsMin, max: SCENARIO_LIMITS.maxTurnsMax }))}
        <input id="f-turns" type="number" min="${SCENARIO_LIMITS.maxTurnsMin}" max="${SCENARIO_LIMITS.maxTurnsMax}" value="${doc.rules.maxTurns}"></label>
      <label class="ed-field">${escapeHtml(t('editor.field.turnLimit'))}
        <select id="f-tl">
          <option value="score" ${doc.rules.turnLimit === 'score' ? 'selected' : ''}>${escapeHtml(t('editor.turnLimit.score'))}</option>
          <option value="defeat" ${doc.rules.turnLimit === 'defeat' ? 'selected' : ''}>${escapeHtml(t('editor.turnLimit.defeat'))}</option>
        </select></label>
      <label class="ed-field">${escapeHtml(t('editor.field.doctrines'))}
        <select id="f-doc">
          <option value="on" ${doc.rules.doctrines !== false ? 'selected' : ''}>${escapeHtml(t('editor.enabled'))}</option>
          <option value="off" ${doc.rules.doctrines === false ? 'selected' : ''}>${escapeHtml(t('editor.disabled'))}</option>
        </select></label>
      <div class="ed-row"><button class="close-btn" id="f-ok">${escapeHtml(t('common.apply'))}</button><button class="close-btn" id="f-cancel">${escapeHtml(t('common.cancel'))}</button></div>`);
    s.querySelector('#f-ok')!.addEventListener('click', () => {
      const maxTurns = Number((s.querySelector('#f-turns') as HTMLInputElement).value);
      const turnLimit = (s.querySelector('#f-tl') as HTMLSelectElement).value as 'score' | 'defeat';
      const doctrines = (s.querySelector('#f-doc') as HTMLSelectElement).value === 'on';
      this.handlers.onRulesChange({ ...doc.rules, maxTurns, turnLimit, doctrines });
      this.closeSheet();
    });
    s.querySelector('#f-cancel')!.addEventListener('click', () => this.closeSheet());
  }

  private openFactionsSheet(): void {
    const doc = this.getDoc();
    const row = (f: ScenarioFactionSetup) => `
      <div class="ed-fac-row" data-f="${f.id}">
        <b>${escapeHtml(factionName(f.id))}</b>
        <select data-k="active">
          <option value="on" ${f.active ? 'selected' : ''}>${escapeHtml(t('editor.faction.active'))}</option>
          <option value="off" ${f.active ? '' : 'selected'}>${escapeHtml(t('editor.faction.inactive'))}</option>
        </select>
        <select data-k="controller">
          <option value="human" ${f.controller === 'human' ? 'selected' : ''}>${escapeHtml(t('editor.faction.human'))}</option>
          <option value="ai" ${f.controller === 'ai' ? 'selected' : ''}>${escapeHtml(t('editor.faction.ai'))}</option>
        </select>
        <input data-k="gold" type="number" min="0" max="500" placeholder="${escapeHtml(t('editor.faction.defaultGold'))}" value="${f.startGold ?? ''}" style="width:70px">
      </div>`;
    const s = this.openSheet(`
      <h3>${escapeHtml(t('editor.factions'))}</h3>
      <p class="ed-hint">${escapeHtml(t('editor.faction.hint'))}</p>
      ${doc.factions.map(row).join('')}
      <button class="close-btn" id="f-close">${escapeHtml(t('common.close'))}</button>`);
    for (const rowEl of s.querySelectorAll<HTMLElement>('.ed-fac-row')) {
      const fid = rowEl.dataset.f as FactionId;
      const commit = () => {
        const setup = doc.factions.find((x) => x.id === fid)!;
        const active = (rowEl.querySelector('[data-k="active"]') as HTMLSelectElement).value === 'on';
        const controller = (rowEl.querySelector('[data-k="controller"]') as HTMLSelectElement)
          .value as 'human' | 'ai';
        const goldRaw = (rowEl.querySelector('[data-k="gold"]') as HTMLInputElement).value;
        const next: ScenarioFactionSetup = { ...setup, active, controller };
        if (goldRaw === '') delete next.startGold;
        else next.startGold = Math.max(0, Math.floor(Number(goldRaw)));
        this.handlers.onFactionChange(next);
      };
      for (const el of rowEl.querySelectorAll('select,input')) el.addEventListener('change', commit);
    }
    s.querySelector('#f-close')!.addEventListener('click', () => this.closeSheet());
  }

  private openResizeSheet(): void {
    const doc = this.getDoc();
    const s = this.openSheet(`
      <h3>${escapeHtml(t('editor.resize'))}</h3>
      <p class="ed-hint">${escapeHtml(t('editor.resizeHint', { minCols: SCENARIO_LIMITS.minCols, minRows: SCENARIO_LIMITS.minRows, maxCols: SCENARIO_LIMITS.maxCols, maxRows: SCENARIO_LIMITS.maxRows }))}</p>
      <div class="ed-row">
        <label class="ed-field">${escapeHtml(t('editor.columns'))}<input id="f-cols" type="number" min="${SCENARIO_LIMITS.minCols}" max="${SCENARIO_LIMITS.maxCols}" value="${doc.board.cols}"></label>
        <label class="ed-field">${escapeHtml(t('editor.rows'))}<input id="f-rows" type="number" min="${SCENARIO_LIMITS.minRows}" max="${SCENARIO_LIMITS.maxRows}" value="${doc.board.rows}"></label>
      </div>
      <div class="ed-row"><button class="close-btn" id="f-ok">${escapeHtml(t('common.apply'))}</button><button class="close-btn" id="f-cancel">${escapeHtml(t('common.cancel'))}</button></div>`);
    s.querySelector('#f-ok')!.addEventListener('click', () => {
      const cols = Number((s.querySelector('#f-cols') as HTMLInputElement).value);
      const rows = Number((s.querySelector('#f-rows') as HTMLInputElement).value);
      this.handlers.onResize(cols, rows);
      this.closeSheet();
    });
    s.querySelector('#f-cancel')!.addEventListener('click', () => this.closeSheet());
  }

  // ---------------- 목표(조건) 편집 ----------------

  openObjectivesSheet(): void {
    const doc = this.getDoc();
    const current = {
      victory: doc.victoryConditions,
      defeat: doc.defeatConditions,
      stars: doc.starConditions ?? [],
    };
    const item = (kind: string, i: number, text: string) => `
      <div class="ed-cond" data-kind="${kind}" data-i="${i}">
        <span>${escapeHtml(text)}</span><button data-act="del" aria-label="${escapeHtml(t('editor.removeCondition'))}">✕</button>
      </div>`;
    const s = this.openSheet(`
      <h3>${escapeHtml(t('editor.objectives'))}</h3>
      <div class="ed-cond-list">
        <b>${escapeHtml(t('editor.victoryConditions'))}</b>
        ${current.victory.map((c, i) => item('victory', i, describeVictory(c))).join('')}
        <button class="ed-add" data-add="victory">${escapeHtml(t('editor.addVictory'))}</button>
        <b>${escapeHtml(t('editor.defeatConditions'))}</b>
        ${current.defeat.map((c, i) => item('defeat', i, describeDefeat(c))).join('')}
        <button class="ed-add" data-add="defeat">${escapeHtml(t('editor.addDefeat'))}</button>
        <b>${escapeHtml(t('editor.starConditions'))}</b>
        ${current.stars.map((c, i) => item('stars', i, describeStar(c))).join('')}
        <button class="ed-add" data-add="stars">${escapeHtml(t('editor.addStar'))}</button>
      </div>
      <button class="close-btn" id="f-close">${escapeHtml(t('common.close'))}</button>`);
    for (const el of s.querySelectorAll<HTMLElement>('.ed-cond [data-act="del"]')) {
      el.addEventListener('click', () => {
        const cond = el.parentElement as HTMLElement;
        const kind = cond.dataset.kind as 'victory' | 'defeat' | 'stars';
        const i = Number(cond.dataset.i);
        const next = {
          victory: [...current.victory],
          defeat: [...current.defeat],
          stars: [...current.stars],
        };
        next[kind].splice(i, 1);
        this.handlers.onConditionsChange(next);
        this.openObjectivesSheet();
      });
    }
    for (const btn of s.querySelectorAll<HTMLButtonElement>('[data-add]')) {
      btn.addEventListener('click', () =>
        this.openAddConditionSheet(btn.dataset.add as 'victory' | 'defeat' | 'stars'),
      );
    }
    s.querySelector('#f-close')!.addEventListener('click', () => this.closeSheet());
  }

  private openAddConditionSheet(kind: 'victory' | 'defeat' | 'stars'): void {
    const types =
      kind === 'victory'
        ? [
            ['conquest', t('editor.condition.conquest')],
            ['capture-building', t('editor.condition.captureBuilding')],
            ['hold-building', t('editor.condition.holdBuilding')],
            ['capture-count', t('editor.condition.captureCount')],
            ['eliminate-faction', t('editor.condition.eliminateFaction')],
            ['survive-turns', t('editor.condition.surviveTurns')],
            ['reach-score', t('editor.condition.reachScore')],
            ['unit-alive', t('editor.condition.unitAlive')],
          ]
        : kind === 'defeat'
          ? [
              ['human-eliminated', t('editor.condition.humanEliminated')],
              ['lose-building', t('editor.condition.loseBuilding')],
              ['enemy-captures', t('editor.condition.enemyCaptures')],
              ['unit-dies', t('editor.condition.unitDies')],
              ['turn-limit', t('editor.condition.turnLimit')],
            ]
          : [
              ['win', t('editor.condition.win')],
              ['win-within-turns', t('editor.condition.winWithinTurns')],
              ['units-alive-at-least', t('editor.condition.unitsAlive')],
              ['units-lost-at-most', t('editor.condition.unitsLost')],
              ['buildings-captured-at-least', t('editor.condition.buildingsCaptured')],
              ['kills-at-least', t('editor.condition.kills')],
              ['unit-alive', t('editor.condition.unitAlive')],
              ['gold-at-least', t('editor.condition.gold')],
            ];
    const s = this.openSheet(`
      <h3>${escapeHtml(t('editor.addCondition'))}</h3>
      <div class="ed-menu-grid">
        ${types.map(([type, label]) => `<button data-t="${type}">${escapeHtml(label)}</button>`).join('')}
      </div>
      <button class="close-btn" id="f-back">${escapeHtml(t('common.back'))}</button>`);
    for (const btn of s.querySelectorAll<HTMLButtonElement>('[data-t]')) {
      btn.addEventListener('click', () => void this.buildCondition(kind, btn.dataset.t!));
    }
    s.querySelector('#f-back')!.addEventListener('click', () => this.openObjectivesSheet());
  }

  /** 파라미터를 물어 조건을 완성한다. 타일 좌표는 지도 탭으로 고른다. */
  private async buildCondition(kind: 'victory' | 'defeat' | 'stars', type: string): Promise<void> {
    const doc = this.getDoc();
    const needAt = ['capture-building', 'hold-building', 'lose-building', 'enemy-captures'];
    const needCount: Record<string, [string, number]> = {
      'hold-building': [t('editor.prompt.holdTurns'), 3],
      'capture-count': [t('editor.prompt.buildingCount'), 2],
      'survive-turns': [t('editor.prompt.surviveTurns'), 10],
      'reach-score': [t('editor.prompt.targetScore'), 60],
      'win-within-turns': [t('editor.prompt.turns'), 8],
      'units-alive-at-least': [t('editor.prompt.unitCount'), 3],
      'units-lost-at-most': [t('editor.prompt.lossLimit'), 2],
      'buildings-captured-at-least': [t('editor.prompt.buildingCount'), 2],
      'kills-at-least': [t('editor.prompt.killCount'), 5],
      'gold-at-least': [t('editor.prompt.gold'), 100],
    };
    let at: Axial | null = null;
    if (needAt.includes(type)) {
      this.closeSheet();
      at = await this.handlers.requestTilePick(t('editor.prompt.pickBuilding'));
      if (!at) return;
    }
    let count: number | undefined;
    if (type in needCount) {
      const [label, def] = needCount[type];
      const raw = window.prompt(label, String(def));
      if (raw === null) return;
      count = Math.max(1, Math.floor(Number(raw) || def));
    }
    let faction: FactionId | undefined;
    if (type === 'eliminate-faction') {
      const raw = window.prompt(t('editor.prompt.faction'), 'crimson');
      if (raw === null) return;
      if (!FACTIONS.includes(raw as FactionId)) return;
      faction = raw as FactionId;
    }
    let tag: string | undefined;
    if (type === 'unit-alive' || type === 'unit-dies') {
      const raw = window.prompt(t('editor.prompt.unitTag'), 'hero');
      if (!raw) return;
      tag = raw.trim();
    }
    let building: BuildingId | undefined;
    if (type === 'capture-count') {
      const raw = window.prompt(t('editor.prompt.building'), 'village');
      if (raw === null || !['capital', 'village', 'crown'].includes(raw)) return;
      building = raw as BuildingId;
    }
    const cond = buildConditionObject(type, { at, count, faction, tag, building });
    if (!cond) return;
    const next = {
      victory: [...doc.victoryConditions],
      defeat: [...doc.defeatConditions],
      stars: [...(doc.starConditions ?? [])],
    };
    if (kind === 'victory') next.victory.push(cond as VictoryCondition);
    else if (kind === 'defeat') next.defeat.push(cond as DefeatCondition);
    else next.stars.push(cond as StarCondition);
    this.handlers.onConditionsChange(next);
    this.openObjectivesSheet();
  }

  /** 선택 도구로 유닛을 탭했을 때의 속성 시트. */
  openUnitSheet(index: number, unit: ScenarioUnitSetup, maxHp: number): void {
    const s = this.openSheet(`
      <h3>${escapeHtml(t('editor.unitTitle', { faction: factionName(unit.faction), unit: unitName(unit.type), q: unit.q, r: unit.r }))}</h3>
      <div class="ed-row">
        <label class="ed-field">HP (1–${maxHp})<input id="u-hp" type="number" min="1" max="${maxHp}" value="${unit.hp ?? maxHp}"></label>
        <label class="ed-field">${escapeHtml(t('editor.unitFirstTurn'))}
          <select id="u-act">
            <option value="on" ${unit.canAct !== false ? 'selected' : ''}>${escapeHtml(t('editor.available'))}</option>
            <option value="off" ${unit.canAct === false ? 'selected' : ''}>${escapeHtml(t('editor.unavailable'))}</option>
          </select></label>
      </div>
      <label class="ed-field">${escapeHtml(t('editor.unitTag'))}<input id="u-tag" maxlength="16" value="${escapeHtml(unit.tag ?? '')}"></label>
      <div class="ed-row">
        <button class="close-btn" id="u-ok">${escapeHtml(t('common.apply'))}</button>
        <button class="close-btn" id="u-del" style="color:#a33636">${escapeHtml(t('editor.remove'))}</button>
        <button class="close-btn" id="u-cancel">${escapeHtml(t('common.close'))}</button>
      </div>`);
    s.querySelector('#u-ok')!.addEventListener('click', () => {
      const hp = Math.min(maxHp, Math.max(1, Math.floor(Number((s.querySelector('#u-hp') as HTMLInputElement).value) || maxHp)));
      const canAct = (s.querySelector('#u-act') as HTMLSelectElement).value === 'on';
      const tag = (s.querySelector('#u-tag') as HTMLInputElement).value.trim();
      const next: ScenarioUnitSetup = { ...unit };
      if (hp === maxHp) delete next.hp;
      else next.hp = hp;
      if (canAct) delete next.canAct;
      else next.canAct = false;
      if (tag) next.tag = tag;
      else delete next.tag;
      this.handlers.onUnitUpdate(index, next);
      this.closeSheet();
    });
    s.querySelector('#u-del')!.addEventListener('click', () => {
      this.handlers.onUnitRemove(index);
      this.closeSheet();
    });
    s.querySelector('#u-cancel')!.addEventListener('click', () => this.closeSheet());
  }

  /** 검증 결과 패널. */
  showValidation(issues: ValidationIssue[]): void {
    const sev = {
      error: t('editor.severity.error'),
      warning: t('editor.severity.warning'),
      info: t('editor.severity.info'),
    } as const;
    const rows = issues
      .slice(0, 30)
      .map(
        (i) => `
        <div class="ed-issue ${i.severity}">
          <b>[${sev[i.severity]}]</b> ${escapeHtml(i.message)}
          ${i.repair ? `<div class="ed-repair">→ ${escapeHtml(i.repair)}</div>` : ''}
        </div>`,
      )
      .join('');
    const s = this.openSheet(`
      <h3>${escapeHtml(t('editor.validationTitle', { summary: issues.length === 0 ? t('editor.validationClean') : t('editor.issueCount', { count: issues.length }) }))}</h3>
      <div class="ed-issue-list">${rows || `<p class="ed-hint">${escapeHtml(t('editor.playable'))}</p>`}</div>
      <button class="close-btn" id="v-close">${escapeHtml(t('common.close'))}</button>`);
    s.querySelector('#v-close')!.addEventListener('click', () => this.closeSheet());
  }

  /** 품질 보고서 패널: 전력 요약 지표와 품질 이슈를 보여 준다. */
  showQuality(report: QualityReport): void {
    const sev = {
      error: t('editor.severity.error'),
      warning: t('editor.severity.warning'),
      info: t('editor.severity.info'),
    } as const;
    const m = report.metrics;
    const strengthRows = m.factionStrengths
      .map(
        (s) =>
          `<div class="ed-issue info">${escapeHtml(t('editor.strength', { faction: factionName(s.faction), units: s.unitCount, value: s.unitValue, gold: s.startGold, capital: s.hasCapital ? t('editor.yes') : t('editor.no') }))}</div>`,
      )
      .join('');
    const facts = [
      m.objectiveDistance !== null ? t('editor.metric.objectiveDistance', { n: m.objectiveDistance }) : null,
      m.estimatedFirstCombatTurn !== null ? t('editor.metric.firstCombat', { n: m.estimatedFirstCombatTurn }) : null,
      t('editor.metric.water', { n: (m.waterRatio * 100).toFixed(0) }),
      t('editor.metric.bottlenecks', { n: m.bottleneckCount }),
      m.unusedLandTiles > 0 ? t('editor.metric.unusedLand', { n: m.unusedLandTiles }) : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const rows = report.issues
      .slice(0, 30)
      .map(
        (i) => `
        <div class="ed-issue ${i.severity}">
          <b>[${sev[i.severity]}]</b> ${escapeHtml(i.message)}
        </div>`,
      )
      .join('');
    const s = this.openSheet(`
      <h3>${escapeHtml(t('editor.qualityTitle', { summary: report.issues.length === 0 ? t('editor.qualityClean') : t('editor.issueCount', { count: report.issues.length }) }))}</h3>
      <p class="ed-hint">${escapeHtml(facts)}</p>
      ${strengthRows}
      <div class="ed-issue-list">${rows}</div>
      <button class="close-btn" id="q-close">${escapeHtml(t('common.close'))}</button>`);
    s.querySelector('#q-close')!.addEventListener('click', () => this.closeSheet());
  }

  /** AI 품질 시험 진행 패널을 열고, 진행 갱신 함수를 반환한다. */
  showTrialRunning(onCancel: () => void): (done: number, total: number) => void {
    const s = this.openSheet(`
      <h3>${escapeHtml(t('editor.trialTitle'))}</h3>
      <p class="ed-hint" id="t-progress">${escapeHtml(t('editor.trialStarting'))}</p>
      <button class="close-btn" id="t-cancel">${escapeHtml(t('editor.stop'))}</button>`);
    s.querySelector('#t-cancel')!.addEventListener('click', () => {
      onCancel();
      this.closeSheet();
    });
    const label = s.querySelector('#t-progress')!;
    return (done, total) => {
      label.textContent = t('editor.trialProgress', { done, total });
    };
  }

  /** AI 품질 시험 결과 패널. */
  showTrialResult(report: QualityTrialReport): void {
    const winnerRows = Object.entries(report.winners)
      .map(
        ([w, n]) =>
          `<div class="ed-issue info">${escapeHtml(t('editor.trialWinner', { winner: w === 'draw' ? t('result.draw') : factionName(w as FactionId), count: n }))}</div>`,
      )
      .join('');
    const policyRows = Object.entries(report.policyWins)
      .map(([p, n]) => `<div class="ed-issue info">${escapeHtml(t('editor.trialPolicy', { policy: t(`evalPolicy.${p as EvalPolicyId}`), count: n }))}</div>`)
      .join('');
    const problems: string[] = [];
    if (report.unfinished > 0) problems.push(t('editor.trialUnfinished', { count: report.unfinished }));
    if (report.invalidStates > 0) problems.push(t('editor.trialInvalid', { count: report.invalidStates }));
    if (report.rejectedCommands > 0) problems.push(t('editor.trialRejected', { count: report.rejectedCommands }));
    if (report.stalledFactions.length > 0)
      problems.push(t('editor.trialStalled', { factions: report.stalledFactions.map(factionName).join(' · ') }));
    const s = this.openSheet(`
      <h3>${escapeHtml(t('editor.trialResult', { count: report.games }))}</h3>
      <p class="ed-hint">${escapeHtml(t('editor.trialSummary', { turns: report.avgEndTurn, stars: report.starHistogram.join('/') }))}</p>
      ${problems.length > 0 ? `<div class="ed-issue warning"><b>[${escapeHtml(t('editor.severity.warning'))}]</b> ${escapeHtml(problems.join(' · '))}</div>` : `<div class="ed-issue info">${escapeHtml(t('editor.trialClean'))}</div>`}
      ${winnerRows}
      ${policyRows}
      <button class="close-btn" id="t-close">${escapeHtml(t('common.close'))}</button>`);
    s.querySelector('#t-close')!.addEventListener('click', () => this.closeSheet());
  }
}

function buildConditionObject(
  type: string,
  p: {
    at: Axial | null;
    count?: number;
    faction?: FactionId;
    tag?: string;
    building?: BuildingId;
  },
): VictoryCondition | DefeatCondition | StarCondition | null {
  switch (type) {
    case 'conquest':
      return { type: 'conquest' };
    case 'capture-building':
      return p.at ? { type: 'capture-building', at: p.at } : null;
    case 'hold-building':
      return p.at && p.count ? { type: 'hold-building', at: p.at, turns: p.count } : null;
    case 'capture-count':
      return p.building && p.count
        ? { type: 'capture-count', building: p.building, count: p.count }
        : null;
    case 'eliminate-faction':
      return p.faction ? { type: 'eliminate-faction', faction: p.faction } : null;
    case 'survive-turns':
      return p.count ? { type: 'survive-turns', turns: p.count } : null;
    case 'reach-score':
      return p.count ? { type: 'reach-score', score: p.count } : null;
    case 'unit-alive':
      return p.tag ? { type: 'unit-alive', tag: p.tag } : null;
    case 'human-eliminated':
      return { type: 'human-eliminated' };
    case 'lose-building':
      return p.at ? { type: 'lose-building', at: p.at } : null;
    case 'enemy-captures':
      return p.at ? { type: 'enemy-captures', at: p.at } : null;
    case 'unit-dies':
      return p.tag ? { type: 'unit-dies', tag: p.tag } : null;
    case 'turn-limit':
      return { type: 'turn-limit' };
    case 'win':
      return { type: 'win' };
    case 'win-within-turns':
      return p.count ? { type: 'win-within-turns', turns: p.count } : null;
    case 'units-alive-at-least':
      return p.count ? { type: 'units-alive-at-least', count: p.count } : null;
    case 'units-lost-at-most':
      return p.count !== undefined ? { type: 'units-lost-at-most', count: p.count } : null;
    case 'buildings-captured-at-least':
      return p.count ? { type: 'buildings-captured-at-least', count: p.count } : null;
    case 'kills-at-least':
      return p.count ? { type: 'kills-at-least', count: p.count } : null;
    case 'gold-at-least':
      return p.count ? { type: 'gold-at-least', amount: p.count } : null;
    default:
      return null;
  }
}

export function describeVictory(c: VictoryCondition): string {
  return victoryConditionText(c);
}

export function describeDefeat(c: DefeatCondition): string {
  switch (c.type) {
    case 'human-eliminated':
      return t('condition.defeat.humanEliminated');
    case 'lose-building':
      return t('condition.defeat.loseBuilding', { q: c.at.q, r: c.at.r });
    case 'unit-dies':
      return t('condition.defeat.unitDies', { tag: c.tag });
    case 'enemy-captures':
      return t('condition.defeat.enemyCaptures', { q: c.at.q, r: c.at.r });
    case 'turn-limit':
      return t('condition.defeat.turnLimit');
  }
}

export function describeStar(c: StarCondition): string {
  switch (c.type) {
    case 'win':
      return t('condition.star.win');
    case 'win-within-turns':
      return t('condition.star.winWithinTurns', { n: c.turns });
    case 'units-alive-at-least':
      return t('condition.star.unitsAlive', { n: c.count });
    case 'units-lost-at-most':
      return t('condition.star.unitsLost', { n: c.count });
    case 'buildings-captured-at-least':
      return t('condition.star.buildingsCaptured', { n: c.count });
    case 'kills-at-least':
      return t('condition.star.kills', { n: c.count });
    case 'unit-alive':
      return t('condition.star.unitAlive', { tag: c.tag });
    case 'gold-at-least':
      return t('condition.star.gold', { n: c.amount });
  }
}

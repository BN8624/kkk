// 한 줄 목적: 시나리오 제작실 UI(홈 화면·도구 팔레트·속성 시트·조건 편집·검증 패널)를 렌더링한다
import { FACTION_NAMES, UNIT_NAMES } from '../../core/data';
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
import { escapeHtml } from '../shared/dom';
import type { OverlayHost } from '../shared/overlay';

// ---------------- 제작실 홈 ----------------

export interface EditorDraftItem {
  id: string;
  title: string;
  updatedAt: string;
  sizeBytes: number;
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
          <span class="rp-title"><b>${escapeHtml(d.title || '제목 없음')}</b></span>
          <span class="rp-sub">${escapeHtml(d.updatedAt.slice(0, 10))} · ${Math.max(1, Math.round(d.sizeBytes / 1024))}KB</span>
        </button>
        <div class="rp-actions"><button data-act="del" aria-label="삭제">✕</button></div>
      </div>`,
    )
    .join('');
  const root = overlay.show(`
      <h1 style="font-size:24px;">시나리오 제작</h1>
      <p class="subtitle" style="font-size:12.5px;">나만의 전장을 만들고 검증하고 플레이합니다</p>
      <div style="display:flex; gap:8px; width:min(300px,82vw);">
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-new-empty">빈 지도</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-new-random">랜덤 지도</button>
      </div>
      <div style="display:flex; gap:8px; width:min(300px,82vw);">
        ${builtins
          .map(
            (b) =>
              `<button class="sub-btn" style="width:auto;flex:1;font-size:13px;" data-builtin="${b.id}">${escapeHtml(b.name)} 복제</button>`,
          )
          .join('')}
      </div>
      ${drafts.length > 0 ? `<p class="subtitle" style="font-size:13px;margin-bottom:-6px;">초안</p><div class="rp-list">${draftRows}</div>` : ''}
      <input type="file" id="ed-import-file" accept=".json,application/json" style="display:none">
      <div style="display:flex; gap:8px; width:min(300px,82vw);">
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-import">JSON 가져오기</button>
        <button class="sub-btn" style="width:auto;flex:1;" id="btn-import-text">코드 가져오기</button>
      </div>
      <button class="sub-btn" id="btn-back">뒤로</button>`);
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

/** 공유 코드·JSON 텍스트 붙여넣기 가져오기 화면. */
export function showImportTextScreen(
  overlay: OverlayHost,
  handlers: { onSubmit: (text: string) => void; onBack: () => void },
): void {
  const root = overlay.show(`
      <h1 style="font-size:22px;">코드로 가져오기</h1>
      <p class="subtitle" style="font-size:12.5px;">공유 코드(TCS1…)나 공유 URL, 시나리오 JSON을 붙여 넣으세요</p>
      <textarea id="ed-import-text" class="ed-import-text" rows="6" spellcheck="false"
        placeholder="TCS1.… 또는 { &quot;schemaVersion&quot;: 1, … }"></textarea>
      <button class="big-btn" id="btn-import-go">가져오기</button>
      <button class="sub-btn" id="btn-back">뒤로</button>`);
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

const TOOLS: { id: EditorTool; label: string }[] = [
  { id: 'select', label: '선택' },
  { id: 'plains', label: '평원' },
  { id: 'forest', label: '숲' },
  { id: 'mountain', label: '산' },
  { id: 'water', label: '물' },
  { id: 'capital', label: '수도' },
  { id: 'village', label: '마을' },
  { id: 'crown', label: '왕관' },
  { id: 'unit', label: '유닛' },
  { id: 'erase', label: '지우개' },
];

const FACTIONS: FactionId[] = ['azure', 'crimson', 'violet'];
const UNIT_TYPES: UnitTypeId[] = ['infantry', 'archer', 'cavalry'];

/** 에디터 화면의 DOM 패널(상단 바·도구 팔레트·시트). 문서 데이터는 App이 소유한다. */
export class EditorPanel {
  private handlers: EditorPanelHandlers;
  private top: HTMLElement;
  private palette: HTMLElement;
  private sheet: HTMLElement;
  private getDoc: () => ScenarioDocumentV1;

  constructor(root: HTMLElement, getDoc: () => ScenarioDocumentV1, handlers: EditorPanelHandlers) {
    this.getDoc = getDoc;
    this.handlers = handlers;

    this.top = document.createElement('div');
    this.top.className = 'ed-topbar';
    this.top.innerHTML = `
      <button id="ed-exit" class="rp-exit">✕</button>
      <span class="hud-chip" id="ed-title"></span>
      <span style="flex:1"></span>
      <button id="ed-undo" class="rp-exit" aria-label="실행 취소">↶</button>
      <button id="ed-redo" class="rp-exit" aria-label="다시 실행">↷</button>
      <button id="ed-check" class="rp-exit">검증</button>
      <button id="ed-menu" class="rp-exit">⋯</button>`;
    root.appendChild(this.top);

    this.palette = document.createElement('div');
    this.palette.className = 'ed-palette';
    root.appendChild(this.palette);

    this.sheet = document.createElement('div');
    this.sheet.className = 'sheet ed-sheet';
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
    this.top.querySelector('#ed-title')!.textContent = doc.title || '제목 없음';
    (this.top.querySelector('#ed-undo') as HTMLButtonElement).disabled = !canUndo;
    (this.top.querySelector('#ed-redo') as HTMLButtonElement).disabled = !canRedo;

    const chip = (id: string, label: string, on: boolean, data: string) =>
      `<button class="ed-chip ${on ? 'on' : ''}" data-${data}="${id}">${label}</button>`;
    let sub = '';
    if (['plains', 'forest', 'mountain', 'water', 'erase'].includes(tool)) {
      sub = `<span class="ed-sub-label">브러시</span>
        ${chip('1', '1칸', options.brush === 1, 'brush')}
        ${chip('7', '7칸', options.brush === 7, 'brush')}`;
    } else if (['capital', 'village', 'crown'].includes(tool)) {
      sub = `<span class="ed-sub-label">소유</span>
        ${chip('none', '중립', options.owner === null, 'owner')}
        ${FACTIONS.map((f) => chip(f, FACTION_NAMES[f].slice(0, 2), options.owner === f, 'owner')).join('')}`;
    } else if (tool === 'unit') {
      sub = `${FACTIONS.map((f) => chip(f, FACTION_NAMES[f].slice(0, 2), options.unitFaction === f, 'uf')).join('')}
        <span class="ed-sub-label">·</span>
        ${UNIT_TYPES.map((t) => chip(t, UNIT_NAMES[t], options.unitType === t, 'ut')).join('')}`;
    }
    this.palette.innerHTML = `
      <div class="ed-tool-row">${TOOLS.map((t) => chip(t.id, t.label, tool === t.id, 'tool')).join('')}</div>
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
  }

  private openSheet(html: string): HTMLElement {
    this.sheet.innerHTML = html;
    this.sheet.classList.add('show');
    return this.sheet;
  }

  private openMenu(): void {
    const s = this.openSheet(`
      <h3>메뉴</h3>
      <div class="ed-menu-grid">
        <button data-m="save">초안 저장</button>
        <button data-m="test">테스트 플레이</button>
        <button data-m="spectate">AI 관전 테스트</button>
        <button data-m="info">문서 정보</button>
        <button data-m="rules">규칙</button>
        <button data-m="factions">세력</button>
        <button data-m="objectives">목표</button>
        <button data-m="resize">지도 크기</button>
        <button data-m="export">내보내기</button>
      </div>
      <button class="close-btn">닫기</button>`);
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
      <h3>문서 정보</h3>
      <label class="ed-field">제목<input id="f-title" maxlength="${SCENARIO_LIMITS.maxTitleLen}" value="${escapeHtml(doc.title)}"></label>
      <label class="ed-field">설명<textarea id="f-desc" maxlength="${SCENARIO_LIMITS.maxDescriptionLen}" rows="3">${escapeHtml(doc.description)}</textarea></label>
      <label class="ed-field">제작자<input id="f-author" maxlength="${SCENARIO_LIMITS.maxAuthorLen}" value="${escapeHtml(doc.author ?? '')}"></label>
      <div class="ed-row"><button class="close-btn" id="f-ok">적용</button><button class="close-btn" id="f-cancel">취소</button></div>`);
    s.querySelector('#f-ok')!.addEventListener('click', () => {
      const title = (s.querySelector('#f-title') as HTMLInputElement).value.trim() || '제목 없음';
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
      <h3>규칙</h3>
      <label class="ed-field">최대 턴 (${SCENARIO_LIMITS.maxTurnsMin}–${SCENARIO_LIMITS.maxTurnsMax})
        <input id="f-turns" type="number" min="${SCENARIO_LIMITS.maxTurnsMin}" max="${SCENARIO_LIMITS.maxTurnsMax}" value="${doc.rules.maxTurns}"></label>
      <label class="ed-field">제한 턴 판정
        <select id="f-tl">
          <option value="score" ${doc.rules.turnLimit === 'score' ? 'selected' : ''}>최고 점수 승리</option>
          <option value="defeat" ${doc.rules.turnLimit === 'defeat' ? 'selected' : ''}>목표 미달성 시 패배</option>
        </select></label>
      <label class="ed-field">왕국 교리
        <select id="f-doc">
          <option value="on" ${doc.rules.doctrines !== false ? 'selected' : ''}>사용</option>
          <option value="off" ${doc.rules.doctrines === false ? 'selected' : ''}>사용 안 함</option>
        </select></label>
      <div class="ed-row"><button class="close-btn" id="f-ok">적용</button><button class="close-btn" id="f-cancel">취소</button></div>`);
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
        <b>${FACTION_NAMES[f.id]}</b>
        <select data-k="active">
          <option value="on" ${f.active ? 'selected' : ''}>참여</option>
          <option value="off" ${f.active ? '' : 'selected'}>비활성</option>
        </select>
        <select data-k="controller">
          <option value="human" ${f.controller === 'human' ? 'selected' : ''}>인간</option>
          <option value="ai" ${f.controller === 'ai' ? 'selected' : ''}>AI</option>
        </select>
        <input data-k="gold" type="number" min="0" max="500" placeholder="기본 금" value="${f.startGold ?? ''}" style="width:70px">
      </div>`;
    const s = this.openSheet(`
      <h3>세력</h3>
      <p class="ed-hint">인간은 정확히 하나여야 합니다. 시작 금을 비우면 왕국 기본값입니다.</p>
      ${doc.factions.map(row).join('')}
      <button class="close-btn" id="f-close">닫기</button>`);
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
      <h3>지도 크기</h3>
      <p class="ed-hint">${SCENARIO_LIMITS.minCols}×${SCENARIO_LIMITS.minRows} ~ ${SCENARIO_LIMITS.maxCols}×${SCENARIO_LIMITS.maxRows}. 줄이면 범위 밖 배치는 제거됩니다.</p>
      <div class="ed-row">
        <label class="ed-field">가로<input id="f-cols" type="number" min="${SCENARIO_LIMITS.minCols}" max="${SCENARIO_LIMITS.maxCols}" value="${doc.board.cols}"></label>
        <label class="ed-field">세로<input id="f-rows" type="number" min="${SCENARIO_LIMITS.minRows}" max="${SCENARIO_LIMITS.maxRows}" value="${doc.board.rows}"></label>
      </div>
      <div class="ed-row"><button class="close-btn" id="f-ok">적용</button><button class="close-btn" id="f-cancel">취소</button></div>`);
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
        <span>${escapeHtml(text)}</span><button data-act="del">✕</button>
      </div>`;
    const s = this.openSheet(`
      <h3>목표</h3>
      <div class="ed-cond-list">
        <b>승리 조건</b>
        ${current.victory.map((c, i) => item('victory', i, describeVictory(c))).join('')}
        <button class="ed-add" data-add="victory">+ 승리 조건 추가</button>
        <b>패배 조건</b>
        ${current.defeat.map((c, i) => item('defeat', i, describeDefeat(c))).join('')}
        <button class="ed-add" data-add="defeat">+ 패배 조건 추가</button>
        <b>별점 조건 (최대 3)</b>
        ${current.stars.map((c, i) => item('stars', i, describeStar(c))).join('')}
        <button class="ed-add" data-add="stars">+ 별점 조건 추가</button>
      </div>
      <button class="close-btn" id="f-close">닫기</button>`);
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
            ['conquest', '모든 수도 점령'],
            ['capture-building', '지정 거점 점령'],
            ['hold-building', '지정 거점 N턴 연속 보유'],
            ['capture-count', '거점 종류 N개 보유'],
            ['eliminate-faction', '지정 세력 제거'],
            ['survive-turns', 'N턴까지 생존'],
            ['reach-score', 'N점 달성'],
            ['unit-alive', '태그 유닛 생존'],
          ]
        : kind === 'defeat'
          ? [
              ['human-eliminated', '내 세력 전멸'],
              ['lose-building', '지정 거점 상실'],
              ['enemy-captures', '적이 지정 거점 점령'],
              ['unit-dies', '태그 유닛 사망'],
              ['turn-limit', '제한 턴 초과'],
            ]
          : [
              ['win', '승리'],
              ['win-within-turns', 'N턴 이내 승리'],
              ['units-alive-at-least', '아군 N기 이상 생존'],
              ['units-lost-at-most', '유닛 손실 N기 이하'],
              ['buildings-captured-at-least', '거점 N개 이상 점령'],
              ['kills-at-least', '적 N기 이상 처치'],
              ['unit-alive', '태그 유닛 생존'],
              ['gold-at-least', 'N금 이상 보유'],
            ];
    const s = this.openSheet(`
      <h3>조건 추가</h3>
      <div class="ed-menu-grid">
        ${types.map(([t, label]) => `<button data-t="${t}">${label}</button>`).join('')}
      </div>
      <button class="close-btn" id="f-back">뒤로</button>`);
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
      'hold-building': ['연속 보유 턴', 3],
      'capture-count': ['거점 수', 2],
      'survive-turns': ['생존 턴', 10],
      'reach-score': ['목표 점수', 60],
      'win-within-turns': ['턴 수', 8],
      'units-alive-at-least': ['유닛 수', 3],
      'units-lost-at-most': ['손실 상한', 2],
      'buildings-captured-at-least': ['거점 수', 2],
      'kills-at-least': ['처치 수', 5],
      'gold-at-least': ['금액', 100],
    };
    let at: Axial | null = null;
    if (needAt.includes(type)) {
      this.closeSheet();
      at = await this.handlers.requestTilePick('지도에서 대상 거점을 탭하세요');
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
      const raw = window.prompt('제거할 세력 (azure/crimson/violet)', 'crimson');
      if (raw === null) return;
      if (!FACTIONS.includes(raw as FactionId)) return;
      faction = raw as FactionId;
    }
    let tag: string | undefined;
    if (type === 'unit-alive' || type === 'unit-dies') {
      const raw = window.prompt('유닛 태그(선택 도구로 유닛에 태그를 지정하세요)', 'hero');
      if (!raw) return;
      tag = raw.trim();
    }
    let building: BuildingId | undefined;
    if (type === 'capture-count') {
      const raw = window.prompt('거점 종류 (capital/village/crown)', 'village');
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
      <h3>${FACTION_NAMES[unit.faction]} ${UNIT_NAMES[unit.type]} (${unit.q}, ${unit.r})</h3>
      <div class="ed-row">
        <label class="ed-field">HP (1–${maxHp})<input id="u-hp" type="number" min="1" max="${maxHp}" value="${unit.hp ?? maxHp}"></label>
        <label class="ed-field">첫 턴 행동
          <select id="u-act">
            <option value="on" ${unit.canAct !== false ? 'selected' : ''}>가능</option>
            <option value="off" ${unit.canAct === false ? 'selected' : ''}>불가</option>
          </select></label>
      </div>
      <label class="ed-field">태그(조건 연결용, 비우면 없음)<input id="u-tag" maxlength="16" value="${escapeHtml(unit.tag ?? '')}"></label>
      <div class="ed-row">
        <button class="close-btn" id="u-ok">적용</button>
        <button class="close-btn" id="u-del" style="color:#a33636">삭제</button>
        <button class="close-btn" id="u-cancel">닫기</button>
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
    const sev = { error: '오류', warning: '경고', info: '정보' } as const;
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
      <h3>검증 결과 ${issues.length === 0 ? '— 문제 없음 ✓' : `(${issues.length}건)`}</h3>
      <div class="ed-issue-list">${rows || '<p class="ed-hint">플레이 가능한 시나리오입니다.</p>'}</div>
      <button class="close-btn" id="v-close">닫기</button>`);
    s.querySelector('#v-close')!.addEventListener('click', () => this.closeSheet());
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
  switch (c.type) {
    case 'conquest':
      return '모든 수도 점령';
    case 'hold-building':
      return `(${c.at.q},${c.at.r}) 거점 ${c.turns}턴 연속 보유`;
    case 'capture-building':
      return `(${c.at.q},${c.at.r}) 거점 점령`;
    case 'capture-count':
      return `${c.building === 'capital' ? '수도' : c.building === 'village' ? '마을' : '왕관'} ${c.count}개 보유`;
    case 'eliminate-faction':
      return `${FACTION_NAMES[c.faction]} 제거`;
    case 'survive-turns':
      return `${c.turns}턴까지 생존`;
    case 'reach-score':
      return `${c.score}점 달성`;
    case 'unit-alive':
      return `'${c.tag}' 유닛 생존`;
    case 'all-of':
      return `복수 목표 모두 (${c.conditions.length}개)`;
    case 'any-of':
      return `복수 목표 중 하나 (${c.conditions.length}개)`;
  }
}

export function describeDefeat(c: DefeatCondition): string {
  switch (c.type) {
    case 'human-eliminated':
      return '내 세력 전멸';
    case 'lose-building':
      return `(${c.at.q},${c.at.r}) 거점 상실`;
    case 'unit-dies':
      return `'${c.tag}' 유닛 사망`;
    case 'enemy-captures':
      return `적이 (${c.at.q},${c.at.r}) 점령`;
    case 'turn-limit':
      return '제한 턴 초과';
  }
}

export function describeStar(c: StarCondition): string {
  switch (c.type) {
    case 'win':
      return '승리';
    case 'win-within-turns':
      return `${c.turns}턴 이내 승리`;
    case 'units-alive-at-least':
      return `아군 ${c.count}기 이상 생존`;
    case 'units-lost-at-most':
      return `손실 ${c.count}기 이하`;
    case 'buildings-captured-at-least':
      return `거점 ${c.count}개 이상 점령`;
    case 'kills-at-least':
      return `${c.count}기 이상 처치`;
    case 'unit-alive':
      return `'${c.tag}' 유닛 생존`;
    case 'gold-at-least':
      return `${c.amount}금 이상 보유`;
  }
}

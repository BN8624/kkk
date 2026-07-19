// 한 줄 목적: 시나리오 제작실의 편집 세션(도구·획 적용·undo/redo·자동 저장·초안 관리)을 관리한다
import { hexKey, neighbors, offsetToAxial } from '../core/hex';
import { isPlayable, validateScenario } from '../core/scenario/validate';
import { SCENARIO_LIMITS, type ScenarioDocumentV1, type ScenarioTile, type ScenarioUnitSetup, type ValidationIssue } from '../core/scenario/types';
import type { BuildingId, FactionId, TerrainId, UnitTypeId } from '../core/types';
import { canFactionUseUnit, isUniqueUnit } from '../core/units';
import type { DocumentStore } from '../storage/docstore';
import { applyOp, clone, EditorHistory, type EditorOp, type TileChange } from './ops';

export type EditorTool =
  | 'select'
  | 'plains'
  | 'forest'
  | 'mountain'
  | 'water'
  | 'capital'
  | 'village'
  | 'crown'
  | 'unit'
  | 'erase';

export interface EditorToolOptions {
  /** 브러시 크기: 1칸 또는 주변 포함 7칸 */
  brush: 1 | 7;
  /** 거점 소유 세력(null = 중립) */
  owner: FactionId | null;
  unitFaction: FactionId;
  unitType: UnitTypeId;
}

const TERRAIN_TOOLS: Partial<Record<EditorTool, TerrainId>> = {
  plains: 'plains',
  forest: 'forest',
  mountain: 'mountain',
  water: 'water',
};

const BUILDING_TOOLS: Partial<Record<EditorTool, BuildingId>> = {
  capital: 'capital',
  village: 'village',
  crown: 'crown',
};

/** 시나리오 제작실 편집 세션. 렌더·DOM과 분리되어 단위 테스트가 가능하다. */
export class EditorController {
  doc: ScenarioDocumentV1;
  readonly draftId: string;
  readonly history = new EditorHistory();
  tool: EditorTool = 'select';
  options: EditorToolOptions = {
    brush: 1,
    owner: null,
    unitFaction: 'azure',
    unitType: 'infantry',
  };
  dirty = false;

  private store: DocumentStore;
  private stroke: Map<string, TileChange> | null = null;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(store: DocumentStore, doc: ScenarioDocumentV1, draftId: string) {
    this.store = store;
    this.doc = doc;
    this.draftId = draftId;
  }

  private tileAt(q: number, r: number): ScenarioTile | undefined {
    return this.doc.board.tiles.find((t) => t.q === q && t.r === r);
  }

  unitIndexAt(q: number, r: number): number {
    return this.doc.units.findIndex((u) => u.q === q && u.r === r);
  }

  // ---------------- 칠하기(획 단위 undo) ----------------

  beginStroke(): void {
    this.stroke = new Map();
  }

  /** 현재 도구를 (q,r)에 적용한다. 바뀐 것이 있으면 true. 획 밖 호출은 단일 획으로 처리한다. */
  paintAt(q: number, r: number): boolean {
    const single = this.stroke === null;
    if (single) this.beginStroke();
    let changed = false;
    const targets = this.options.brush === 7 ? [{ q, r }, ...neighbors({ q, r })] : [{ q, r }];
    for (const pos of targets) {
      if (this.paintOne(pos.q, pos.r)) changed = true;
    }
    if (single) this.endStroke();
    return changed;
  }

  private paintOne(q: number, r: number): boolean {
    const tile = this.tileAt(q, r);
    if (!tile) return false;
    const after: ScenarioTile = { ...tile };
    const terrain = TERRAIN_TOOLS[this.tool];
    const building = BUILDING_TOOLS[this.tool];
    if (terrain !== undefined) {
      after.terrain = terrain;
      if (terrain === 'water') {
        delete after.building;
        delete after.owner;
      }
    } else if (building !== undefined) {
      after.building = building;
      if (after.terrain === 'water') after.terrain = 'plains';
      if (this.options.owner) after.owner = this.options.owner;
      else delete after.owner;
    } else if (this.tool === 'erase') {
      delete after.building;
      delete after.owner;
    } else {
      return false;
    }
    if (JSON.stringify(after) === JSON.stringify(tile)) return false;
    const key = hexKey(q, r);
    const existing = this.stroke!.get(key);
    if (existing) existing.after = after;
    else this.stroke!.set(key, { q, r, before: { ...tile }, after });
    tile.terrain = after.terrain;
    if (after.building !== undefined) tile.building = after.building;
    else delete tile.building;
    if (after.owner !== undefined) tile.owner = after.owner;
    else delete tile.owner;
    return true;
  }

  endStroke(): void {
    if (!this.stroke) return;
    const changes = [...this.stroke.values()];
    this.stroke = null;
    if (changes.length === 0) return;
    this.history.push({ type: 'tiles', changes });
    this.markDirty();
  }

  // ---------------- 유닛 배치 ----------------

  /** 유닛 도구 탭: 빈 지상 타일이면 배치, 같은 병과·세력이면 제거, 다르면 교체. */
  placeUnitAt(q: number, r: number): 'placed' | 'removed' | 'replaced' | 'blocked' {
    const tile = this.tileAt(q, r);
    if (!tile || tile.terrain === 'water') return 'blocked';
    const idx = this.unitIndexAt(q, r);
    const { unitFaction, unitType } = this.options;
    // 세력·로스터 제한(고유 병종) — UI 흐림과 동일한 규칙
    if (!this.canPlaceUnitType(unitFaction, unitType)) return 'blocked';
    if (idx >= 0) {
      const existing = this.doc.units[idx];
      if (existing.faction === unitFaction && existing.type === unitType) {
        this.pushOp({ type: 'unit-remove', index: idx, unit: clone(existing) });
        return 'removed';
      }
      const after: ScenarioUnitSetup = { ...existing, faction: unitFaction, type: unitType };
      delete after.hp; // 병과가 바뀌면 최대 HP 기본값으로 되돌린다
      this.pushOp({ type: 'unit-update', index: idx, before: clone(existing), after });
      return 'replaced';
    }
    if (this.doc.units.length >= SCENARIO_LIMITS.maxUnits) return 'blocked';
    this.pushOp({
      type: 'unit-add',
      index: this.doc.units.length,
      unit: { faction: unitFaction, type: unitType, q, r },
    });
    return 'placed';
  }

  /** 선택 세력·문서 규칙 기준으로 해당 병종 배치 가능 여부. */
  canPlaceUnitType(faction: FactionId, type: UnitTypeId): boolean {
    if (!canFactionUseUnit(faction, type)) return false;
    if (isUniqueUnit(type) && this.doc.rules.uniqueUnits !== true) return false;
    return true;
  }

  removeUnitAt(q: number, r: number): boolean {
    const idx = this.unitIndexAt(q, r);
    if (idx < 0) return false;
    this.pushOp({ type: 'unit-remove', index: idx, unit: clone(this.doc.units[idx]) });
    return true;
  }

  updateUnit(index: number, after: ScenarioUnitSetup): void {
    const before = this.doc.units[index];
    if (!before) return;
    this.pushOp({ type: 'unit-update', index, before: clone(before), after: clone(after) });
  }

  // ---------------- 문서 속성 편집 ----------------

  /** 임의 연산 적용 + 히스토리 기록(세력·규칙·조건·메타·크기 변경용). */
  pushOp(op: EditorOp): void {
    applyOp(this.doc, op);
    this.history.push(op);
    this.markDirty();
  }

  /** 지도 크기 변경: 기존 타일 유지, 새 칸은 평원, 범위 밖 타일·유닛 제거. */
  resizeBoard(cols: number, rows: number): boolean {
    const { minCols, maxCols, minRows, maxRows } = SCENARIO_LIMITS;
    if (cols < minCols || cols > maxCols || rows < minRows || rows > maxRows) return false;
    if (cols === this.doc.board.cols && rows === this.doc.board.rows) return false;
    const before = {
      cols: this.doc.board.cols,
      rows: this.doc.board.rows,
      tiles: clone(this.doc.board.tiles),
      units: clone(this.doc.units),
    };
    const byKey = new Map(this.doc.board.tiles.map((t) => [hexKey(t.q, t.r), t]));
    const tiles: ScenarioTile[] = [];
    const inRange = new Set<string>();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const { q, r } = offsetToAxial(col, row);
        const key = hexKey(q, r);
        inRange.add(key);
        tiles.push(byKey.get(key) ? clone(byKey.get(key)!) : { q, r, terrain: 'plains' });
      }
    }
    const units = this.doc.units.filter((u) => inRange.has(hexKey(u.q, u.r))).map((u) => clone(u));
    this.pushOp({ type: 'board-resize', before, after: { cols, rows, tiles, units } });
    return true;
  }

  // ---------------- undo·redo ----------------

  undo(): boolean {
    const ok = this.history.undo(this.doc);
    if (ok) this.markDirty();
    return ok;
  }

  redo(): boolean {
    const ok = this.history.redo(this.doc);
    if (ok) this.markDirty();
    return ok;
  }

  // ---------------- 검증·저장 ----------------

  validate(): ValidationIssue[] {
    return validateScenario(this.doc);
  }

  isPlayable(): boolean {
    return isPlayable(this.validate());
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => void this.autosaveNow(), 1500);
  }

  /** 에디터 자동 저장(원본 초안과 분리된 store). 실패는 무시한다. */
  async autosaveNow(): Promise<void> {
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    try {
      await this.store.put('editor-autosave', this.draftId, this.doc);
    } catch {
      /* 자동 저장 실패는 편집을 막지 않는다 */
    }
  }

  /** 명시적 초안 저장. 성공하면 dirty가 풀리고 자동 저장본은 정리된다. */
  async saveDraft(): Promise<boolean> {
    try {
      await this.store.put('scenario-drafts', this.draftId, this.doc);
      this.dirty = false;
      await this.store.remove('editor-autosave', this.draftId).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  /** 세션 종료 시 타이머 정리. */
  dispose(): void {
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
  }
}

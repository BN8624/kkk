// 한 줄 목적: 에디터 편집 연산(패치)과 undo·redo 히스토리를 정의한다(전체 깊은 복사 없는 명령 기반)
import type {
  DefeatCondition,
  ScenarioDocumentV1,
  ScenarioFactionSetup,
  ScenarioRules,
  ScenarioTile,
  ScenarioUnitSetup,
  StarCondition,
  VictoryCondition,
} from '../core/scenario/types';
import type { FactionId } from '../core/types';

/** 타일 한 칸의 편집 전/후 스냅샷(작은 객체라 통째로 기록한다). */
export interface TileChange {
  q: number;
  r: number;
  before: ScenarioTile;
  after: ScenarioTile;
}

export interface ConditionsSnapshot {
  victory: VictoryCondition[];
  defeat: DefeatCondition[];
  stars: StarCondition[];
}

export interface MetaSnapshot {
  title: string;
  description: string;
  author?: string;
}

export interface BoardSnapshot {
  cols: number;
  rows: number;
  tiles: ScenarioTile[];
  units: ScenarioUnitSetup[];
}

/** 한 번의 의미 단위 편집(한 획·유닛 배치·설정 변경 등). */
export type EditorOp =
  | { type: 'tiles'; changes: TileChange[] }
  | { type: 'unit-add'; index: number; unit: ScenarioUnitSetup }
  | { type: 'unit-remove'; index: number; unit: ScenarioUnitSetup }
  | { type: 'unit-update'; index: number; before: ScenarioUnitSetup; after: ScenarioUnitSetup }
  | { type: 'faction'; id: FactionId; before: ScenarioFactionSetup; after: ScenarioFactionSetup }
  | { type: 'rules'; before: ScenarioRules; after: ScenarioRules }
  | { type: 'meta'; before: MetaSnapshot; after: MetaSnapshot }
  | { type: 'conditions'; before: ConditionsSnapshot; after: ConditionsSnapshot }
  | { type: 'board-resize'; before: BoardSnapshot; after: BoardSnapshot };

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function setTile(doc: ScenarioDocumentV1, next: ScenarioTile): void {
  const idx = doc.board.tiles.findIndex((t) => t.q === next.q && t.r === next.r);
  if (idx >= 0) doc.board.tiles[idx] = clone(next);
}

/** 연산을 문서에 적용한다(항상 after 방향). undo는 invertOp 결과를 적용한다. */
export function applyOp(doc: ScenarioDocumentV1, op: EditorOp): void {
  switch (op.type) {
    case 'tiles':
      for (const c of op.changes) setTile(doc, c.after);
      break;
    case 'unit-add':
      doc.units.splice(op.index, 0, clone(op.unit));
      break;
    case 'unit-remove':
      doc.units.splice(op.index, 1);
      break;
    case 'unit-update':
      doc.units[op.index] = clone(op.after);
      break;
    case 'faction': {
      const idx = doc.factions.findIndex((f) => f.id === op.id);
      if (idx >= 0) doc.factions[idx] = clone(op.after);
      break;
    }
    case 'rules':
      doc.rules = clone(op.after);
      break;
    case 'meta':
      doc.title = op.after.title;
      doc.description = op.after.description;
      if (op.after.author !== undefined) doc.author = op.after.author;
      else delete doc.author;
      break;
    case 'conditions':
      doc.victoryConditions = clone(op.after.victory);
      doc.defeatConditions = clone(op.after.defeat);
      doc.starConditions = clone(op.after.stars);
      break;
    case 'board-resize':
      doc.board.cols = op.after.cols;
      doc.board.rows = op.after.rows;
      doc.board.tiles = clone(op.after.tiles);
      doc.units = clone(op.after.units);
      break;
  }
}

/** 연산의 역연산을 만든다(before/after 교환). */
export function invertOp(op: EditorOp): EditorOp {
  switch (op.type) {
    case 'tiles':
      return {
        type: 'tiles',
        changes: op.changes.map((c) => ({ q: c.q, r: c.r, before: c.after, after: c.before })),
      };
    case 'unit-add':
      return { type: 'unit-remove', index: op.index, unit: op.unit };
    case 'unit-remove':
      return { type: 'unit-add', index: op.index, unit: op.unit };
    case 'unit-update':
      return { type: 'unit-update', index: op.index, before: op.after, after: op.before };
    case 'faction':
      return { type: 'faction', id: op.id, before: op.after, after: op.before };
    case 'rules':
      return { type: 'rules', before: op.after, after: op.before };
    case 'meta':
      return { type: 'meta', before: op.after, after: op.before };
    case 'conditions':
      return { type: 'conditions', before: op.after, after: op.before };
    case 'board-resize':
      return { type: 'board-resize', before: op.after, after: op.before };
  }
}

export const HISTORY_LIMIT = 200;

/** undo·redo 히스토리(최소 100단계 요구 — 200단계 유지). */
export class EditorHistory {
  private past: EditorOp[] = [];
  private future: EditorOp[] = [];

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** 새 편집을 기록한다(redo 스택은 비워진다). */
  push(op: EditorOp): void {
    this.past.push(op);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
  }

  undo(doc: ScenarioDocumentV1): boolean {
    const op = this.past.pop();
    if (!op) return false;
    applyOp(doc, invertOp(op));
    this.future.push(op);
    return true;
  }

  redo(doc: ScenarioDocumentV1): boolean {
    const op = this.future.pop();
    if (!op) return false;
    applyOp(doc, op);
    this.past.push(op);
    return true;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}

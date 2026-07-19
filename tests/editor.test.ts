// 한 줄 목적: 에디터 편집 연산·undo/redo·도구 적용·크기 변경·초안 저장의 정확성을 검증한다
import { describe, expect, it } from 'vitest';
import { EditorController } from '../src/editor/controller';
import { cloneBuiltinDocument, emptyDocument, randomDocument } from '../src/editor/new-doc';
import { HISTORY_LIMIT } from '../src/editor/ops';
import { normalizeScenario } from '../src/core/scenario/normalize';
import { newGameFromScenario } from '../src/core/game';
import { MemoryDocumentStore } from '../src/storage/docstore';

function makeController(doc = emptyDocument('test-empty')): EditorController {
  return new EditorController(new MemoryDocumentStore(), doc, 'draft-test');
}

describe('에디터 문서 생성', () => {
  it('빈 지도는 전부 평원이고 기본 규칙·조건을 가진다', () => {
    const doc = emptyDocument('doc-a', 9, 12);
    expect(doc.board.tiles).toHaveLength(9 * 12);
    expect(doc.board.tiles.every((t) => t.terrain === 'plains')).toBe(true);
    expect(doc.victoryConditions[0].type).toBe('conquest');
    // 새 제작실 문서는 고유 병종 허용 기본값
    expect(doc.rules.uniqueUnits).toBe(true);
  });

  it('고유 병종은 해당 세력만 배치하고 다른 세력·비허용 로스터는 차단한다', () => {
    const c = makeController();
    c.tool = 'unit';
    c.options.unitFaction = 'azure';
    c.options.unitType = 'guardian';
    expect(c.canPlaceUnitType('azure', 'guardian')).toBe(true);
    expect(c.placeUnitAt(2, 2)).toBe('placed');
    expect(c.doc.units.some((u) => u.type === 'guardian' && u.faction === 'azure')).toBe(true);

    c.options.unitFaction = 'crimson';
    c.options.unitType = 'guardian';
    expect(c.canPlaceUnitType('crimson', 'guardian')).toBe(false);
    expect(c.placeUnitAt(3, 3)).toBe('blocked');

    c.doc.rules.uniqueUnits = false;
    c.options.unitFaction = 'azure';
    c.options.unitType = 'guardian';
    expect(c.canPlaceUnitType('azure', 'guardian')).toBe(false);
  });

  it('랜덤 지도는 수도 3개를 포함하고, 내장 복제는 즉시 플레이 가능하다', () => {
    const rand = randomDocument('doc-r', 42);
    expect(rand.board.tiles.filter((t) => t.building === 'capital')).toHaveLength(3);

    const cloned = cloneBuiltinDocument('three-crowns', 'doc-c', 7, '사본');
    const snapshot = normalizeScenario(cloned); // 검증 실패 시 예외
    const state = newGameFromScenario(7, snapshot);
    expect(state.units.length).toBeGreaterThan(0);
    expect(state.config.scenario).toBe('doc-c');
  });
});

describe('칠하기와 undo/redo', () => {
  it('한 획의 여러 타일 변경이 한 번의 undo로 되돌아간다', () => {
    const c = makeController();
    c.tool = 'forest';
    c.beginStroke();
    c.paintAt(0, 0);
    c.paintAt(1, 0);
    c.paintAt(2, 0);
    c.endStroke();
    expect(c.doc.board.tiles.filter((t) => t.terrain === 'forest')).toHaveLength(3);
    expect(c.undo()).toBe(true);
    expect(c.doc.board.tiles.filter((t) => t.terrain === 'forest')).toHaveLength(0);
    expect(c.redo()).toBe(true);
    expect(c.doc.board.tiles.filter((t) => t.terrain === 'forest')).toHaveLength(3);
  });

  it('7칸 브러시는 중심과 이웃을 함께 칠한다', () => {
    const c = makeController();
    c.tool = 'mountain';
    c.options.brush = 7;
    c.paintAt(3, 5);
    expect(c.doc.board.tiles.filter((t) => t.terrain === 'mountain').length).toBe(7);
  });

  it('물을 칠하면 거점이 제거되고 undo로 복원된다', () => {
    const c = makeController();
    c.tool = 'capital';
    c.options.owner = 'azure';
    c.paintAt(2, 2);
    expect(c.doc.board.tiles.find((t) => t.q === 2 && t.r === 2)?.building).toBe('capital');
    c.tool = 'water';
    c.paintAt(2, 2);
    const tile = c.doc.board.tiles.find((t) => t.q === 2 && t.r === 2)!;
    expect(tile.terrain).toBe('water');
    expect(tile.building).toBeUndefined();
    c.undo();
    const restored = c.doc.board.tiles.find((t) => t.q === 2 && t.r === 2)!;
    expect(restored.building).toBe('capital');
    expect(restored.owner).toBe('azure');
  });

  it('히스토리는 상한을 넘으면 가장 오래된 단계를 버린다', () => {
    const c = makeController();
    c.tool = 'forest';
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      c.tool = i % 2 === 0 ? 'forest' : 'plains';
      c.paintAt(0, 0);
    }
    let undos = 0;
    while (c.undo()) undos++;
    expect(undos).toBe(HISTORY_LIMIT);
  });
});

describe('유닛 배치', () => {
  it('배치→교체→제거가 순서대로 동작하고 undo로 복원된다', () => {
    const c = makeController();
    c.tool = 'unit';
    expect(c.placeUnitAt(1, 1)).toBe('placed');
    expect(c.doc.units).toHaveLength(1);
    c.options.unitType = 'archer';
    expect(c.placeUnitAt(1, 1)).toBe('replaced');
    expect(c.doc.units[0].type).toBe('archer');
    expect(c.placeUnitAt(1, 1)).toBe('removed');
    expect(c.doc.units).toHaveLength(0);
    c.undo(); // 제거 취소
    expect(c.doc.units).toHaveLength(1);
    c.undo(); // 교체 취소
    expect(c.doc.units[0].type).toBe('infantry');
  });

  it('물 위에는 유닛을 배치할 수 없다', () => {
    const c = makeController();
    c.tool = 'water';
    c.paintAt(0, 0);
    c.tool = 'unit';
    expect(c.placeUnitAt(0, 0)).toBe('blocked');
  });
});

describe('지도 크기 변경', () => {
  it('축소 시 범위 밖 유닛이 제거되고 undo로 복원된다', () => {
    const c = makeController(emptyDocument('resize-test', 9, 12));
    c.placeUnitAt(0, 11); // 마지막 행 유닛 — placeUnitAt은 도구와 무관하게 동작
    expect(c.doc.units).toHaveLength(1);
    expect(c.resizeBoard(6, 6)).toBe(true);
    expect(c.doc.board.tiles).toHaveLength(36);
    expect(c.doc.units).toHaveLength(0);
    c.undo();
    expect(c.doc.board.tiles).toHaveLength(108);
    expect(c.doc.units).toHaveLength(1);
  });

  it('제한 밖 크기는 거부한다', () => {
    const c = makeController();
    expect(c.resizeBoard(5, 6)).toBe(false);
    expect(c.resizeBoard(21, 12)).toBe(false);
  });
});

describe('초안 저장', () => {
  it('자동 저장과 명시적 저장이 각각의 store에 기록된다', async () => {
    const store = new MemoryDocumentStore();
    const c = new EditorController(store, emptyDocument('save-test'), 'draft-1');
    c.tool = 'forest';
    c.paintAt(0, 0);
    await c.autosaveNow();
    expect(await store.get('editor-autosave', 'draft-1')).not.toBeNull();
    expect(await c.saveDraft()).toBe(true);
    expect(await store.get('scenario-drafts', 'draft-1')).not.toBeNull();
    // 저장 후 자동 저장본은 정리된다
    expect(await store.get('editor-autosave', 'draft-1')).toBeNull();
    expect(c.dirty).toBe(false);
    c.dispose();
  });
});

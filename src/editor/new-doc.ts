// 한 줄 목적: 제작실의 새 문서 시작(빈 지도·랜덤 지도·내장 복제·스냅샷 복제)을 생성한다
import { FACTION_IDS } from '../core/data';
import { offsetToAxial } from '../core/hex';
import { generateMap } from '../core/map';
import { builtinScenarioSnapshot } from '../core/scenario/builtin';
import type {
  ScenarioDocumentV1,
  ScenarioFactionSetup,
  ScenarioRuntimeSnapshot,
  ScenarioTile,
} from '../core/scenario/types';
import type { BuiltinScenarioId } from '../core/types';

function defaultFactions(): ScenarioFactionSetup[] {
  return FACTION_IDS.map((id, i) => ({
    id,
    active: true,
    controller: i === 0 ? 'human' : 'ai',
  }));
}

function baseDocument(id: string, title: string): Omit<ScenarioDocumentV1, 'board'> {
  return {
    schemaVersion: 1,
    id,
    title,
    description: '',
    factions: defaultFactions(),
    units: [],
    rules: { maxTurns: 12, turnLimit: 'score' },
    victoryConditions: [{ type: 'conquest' }],
    defeatConditions: [{ type: 'human-eliminated' }],
    starConditions: [],
  };
}

/** 전부 평원인 빈 지도 문서. 수도·유닛은 사용자가 배치한다. */
export function emptyDocument(id: string, cols = 9, rows = 12): ScenarioDocumentV1 {
  const tiles: ScenarioTile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const { q, r } = offsetToAxial(col, row);
      tiles.push({ q, r, terrain: 'plains' });
    }
  }
  return {
    ...baseDocument(id, '새 시나리오'),
    board: { cols, rows, tiles, source: { kind: 'fixed' } },
  };
}

/** 내장 생성기의 랜덤 섬 지도로 시작하는 문서(수도 포함, 유닛은 비어 있음). */
export function randomDocument(id: string, seed: number): ScenarioDocumentV1 {
  const map = generateMap(seed);
  return {
    ...baseDocument(id, '랜덤 전장'),
    board: { cols: 9, rows: 12, tiles: map.tiles.map((t) => ({ ...t })), source: { kind: 'fixed' } },
  };
}

/** 런타임 스냅샷을 편집 가능한 고정 지도 문서로 복제한다(내장 원본은 덮어쓰지 않는다). */
export function documentFromSnapshot(
  snapshot: ScenarioRuntimeSnapshot,
  id: string,
  title: string,
): ScenarioDocumentV1 {
  return {
    schemaVersion: 1,
    id,
    title,
    description: '',
    board: {
      cols: snapshot.board.cols,
      rows: snapshot.board.rows,
      tiles: snapshot.board.tiles.map((t) => ({ ...t })),
      source: { kind: 'fixed' },
    },
    factions: snapshot.factions.map((f) => ({
      id: f.id,
      active: f.active,
      controller: f.controller,
      startGold: f.startGold,
      useDoctrine: f.useDoctrine,
    })),
    units: snapshot.units.map((u) => ({
      faction: u.faction,
      type: u.type,
      q: u.q,
      r: u.r,
      hp: u.hp,
      canAct: u.canAct,
      ...(u.tag !== undefined ? { tag: u.tag } : {}),
    })),
    rules: { ...snapshot.rules },
    victoryConditions: JSON.parse(JSON.stringify(snapshot.victoryConditions)),
    defeatConditions: JSON.parse(JSON.stringify(snapshot.defeatConditions)),
    starConditions: JSON.parse(JSON.stringify(snapshot.starConditions)),
  };
}

/** 내장 시나리오를 복제해 시작하는 문서. */
export function cloneBuiltinDocument(
  builtin: BuiltinScenarioId,
  id: string,
  seed: number,
  title: string,
): ScenarioDocumentV1 {
  const snapshot = builtinScenarioSnapshot(builtin, seed, 'azure');
  return documentFromSnapshot(snapshot, id, title);
}

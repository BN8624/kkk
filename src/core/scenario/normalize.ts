// 한 줄 목적: 검증된 시나리오 문서를 기본값이 채워진 결정론적 런타임 스냅샷으로 정규화한다
import { UNIT_STATS } from '../data';
import { DOCTRINES } from '../doctrines';
import { isPlayable, validateScenario } from './validate';
import type { ScenarioDocumentV1, ScenarioRuntimeSnapshot, SnapshotUnit } from './types';

/** 좌표순 정렬 키(행 우선). 스냅샷은 항상 같은 순서를 갖는다. */
function tileOrder(a: { q: number; r: number }, b: { q: number; r: number }): number {
  return a.r - b.r || a.q - b.q;
}

const FACTION_ORDER = ['azure', 'crimson', 'violet'] as const;

/**
 * 문서를 런타임 스냅샷으로 정규화한다. 검증 error가 있으면 예외를 던진다.
 * 타일은 좌표순, 유닛은 세력 정본 순서 → 좌표순으로 정렬해 순서 결정론을 보장한다.
 */
export function normalizeScenario(doc: ScenarioDocumentV1): ScenarioRuntimeSnapshot {
  const issues = validateScenario(doc);
  if (!isPlayable(issues)) {
    const first = issues.find((i) => i.severity === 'error')!;
    throw new Error(`시나리오 검증 실패: [${first.code}] ${first.message}`);
  }
  const tiles = doc.board.tiles
    .map((t) => ({
      q: t.q,
      r: t.r,
      terrain: t.terrain,
      ...(t.building !== undefined ? { building: t.building } : {}),
      ...(t.owner !== undefined && t.building !== undefined ? { owner: t.owner } : {}),
    }))
    .sort(tileOrder);

  const units: SnapshotUnit[] = doc.units
    .map((u) => ({
      faction: u.faction,
      type: u.type,
      q: u.q,
      r: u.r,
      hp: u.hp ?? UNIT_STATS[u.type].hp,
      canAct: u.canAct ?? true,
      ...(u.tag !== undefined ? { tag: u.tag } : {}),
    }))
    .sort(
      (a, b) =>
        FACTION_ORDER.indexOf(a.faction) - FACTION_ORDER.indexOf(b.faction) || tileOrder(a, b),
    );

  return {
    schemaVersion: 1,
    id: doc.id,
    title: doc.title,
    board: { cols: doc.board.cols, rows: doc.board.rows, tiles },
    factions: FACTION_ORDER.map((fid) => {
      const f = doc.factions.find((x) => x.id === fid);
      return {
        id: fid,
        active: f?.active ?? false,
        controller: f?.controller ?? 'ai',
        startGold: f?.startGold ?? DOCTRINES[fid].startGold,
        useDoctrine: (doc.rules.doctrines ?? true) && (f?.useDoctrine ?? true),
      };
    }),
    units,
    rules: {
      maxTurns: doc.rules.maxTurns,
      turnLimit: doc.rules.turnLimit,
      ...(doc.rules.modifier !== undefined ? { modifier: doc.rules.modifier } : {}),
      doctrines: doc.rules.doctrines ?? true,
      ...(doc.rules.uniqueUnits !== undefined ? { uniqueUnits: doc.rules.uniqueUnits } : {}),
    },
    victoryConditions: doc.victoryConditions,
    defeatConditions: doc.defeatConditions,
    starConditions: doc.starConditions ?? [],
  };
}

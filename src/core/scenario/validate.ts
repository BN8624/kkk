// 한 줄 목적: 시나리오 문서의 구조·플레이 가능성 검증(error/warning/info)을 수행한다
import { BUILDING_INCOME, FACTION_IDS, TERRAIN_RULES, UNIT_STATS } from '../data';
import { hexKey } from '../hex';
import { MODIFIERS } from '../daily';
import { t } from '../../i18n';
import type { Axial, FactionId } from '../types';
import { canFactionUseUnit, isKnownUnitType, isUniqueUnit } from '../units';
import {
  SCENARIO_LIMITS as L,
  isValidScenarioId,
  type ScenarioDocumentV1,
  type ScenarioTile,
  type StarCondition,
  type ValidationIssue,
  type VictoryCondition,
} from './types';

function issue(
  code: string,
  severity: ValidationIssue['severity'],
  message: string,
  extra?: Partial<ValidationIssue>,
): ValidationIssue {
  return { code, severity, message, ...extra };
}

/** 축 좌표가 보드 범위(odd-r 오프셋 기준) 안인지 검사한다. */
function inBounds(t: Axial, cols: number, rows: number): boolean {
  if (t.r < 0 || t.r >= rows) return false;
  const col = t.q + ((t.r - (t.r & 1)) >> 1);
  return col >= 0 && col < cols;
}

const HEX_DIRS: Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function landReachable(tiles: Map<string, ScenarioTile>, from: Axial, to: Axial): boolean {
  const target = hexKey(to.q, to.r);
  if (!tiles.has(target)) return false;
  const visited = new Set<string>([hexKey(from.q, from.r)]);
  const queue: Axial[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (hexKey(cur.q, cur.r) === target) return true;
    for (const d of HEX_DIRS) {
      const n = { q: cur.q + d.q, r: cur.r + d.r };
      const nk = hexKey(n.q, n.r);
      if (visited.has(nk)) continue;
      const t = tiles.get(nk);
      if (!t || t.terrain === 'water') continue;
      visited.add(nk);
      queue.push(n);
    }
  }
  return false;
}

/** 조건 트리를 평탄화한다(all-of/any-of 내부 포함). */
function flattenVictory(conds: VictoryCondition[], depth = 0): VictoryCondition[] {
  if (depth > 3) return conds;
  const out: VictoryCondition[] = [];
  for (const c of conds) {
    out.push(c);
    if (c.type === 'all-of' || c.type === 'any-of')
      out.push(...flattenVictory(c.conditions, depth + 1));
  }
  return out;
}

/**
 * 정형화된 시나리오 문서를 검증한다. error가 하나라도 있으면 플레이 불가로 본다.
 * 구조 검증 → 참조 검증 → 플레이 가능성 검증 순서로 진행한다.
 */
export function validateScenario(doc: ScenarioDocumentV1): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // ---------- 구조: 기본 필드 ----------
  if (doc.schemaVersion !== 1)
    issues.push(issue('schema-version', 'error', t('validation.schemaVersion', { version: String(doc.schemaVersion) }), { path: 'schemaVersion' }));
  if (!isValidScenarioId(doc.id))
    issues.push(issue('bad-id', 'error', t('validation.badId'), { path: 'id' }));
  if (typeof doc.title !== 'string' || doc.title.trim().length === 0)
    issues.push(issue('no-title', 'error', t('validation.noTitle'), { path: 'title' }));
  else if (doc.title.length > L.maxTitleLen)
    issues.push(issue('title-too-long', 'error', t('validation.titleTooLong', { max: L.maxTitleLen }), { path: 'title' }));
  if (typeof doc.description !== 'string')
    issues.push(issue('no-description', 'error', t('validation.noDescription'), { path: 'description' }));
  else if (doc.description.length > L.maxDescriptionLen)
    issues.push(issue('description-too-long', 'error', t('validation.descriptionTooLong', { max: L.maxDescriptionLen }), { path: 'description' }));

  // ---------- 구조: 보드 ----------
  const { cols, rows } = doc.board ?? { cols: 0, rows: 0 };
  if (
    !Number.isInteger(cols) || !Number.isInteger(rows) ||
    cols < L.minCols || rows < L.minRows || cols > L.maxCols || rows > L.maxRows
  ) {
    issues.push(
      issue('bad-board-size', 'error', t('validation.badBoardSize', { minCols: L.minCols, minRows: L.minRows, maxCols: L.maxCols, maxRows: L.maxRows }), { path: 'board' }),
    );
    return issues; // 보드가 무너지면 이후 검증 무의미
  }
  const tileMap = new Map<string, ScenarioTile>();
  doc.board.tiles.forEach((tile, i) => {
    const path = `board.tiles[${i}]`;
    if (!(tile.terrain in TERRAIN_RULES)) {
      issues.push(issue('bad-terrain', 'error', t('validation.badTerrain', { value: String(tile.terrain) }), { path, at: tile }));
      return;
    }
    if (tile.building !== undefined && !(tile.building in BUILDING_INCOME))
      issues.push(issue('bad-building', 'error', t('validation.badBuilding', { value: String(tile.building) }), { path, at: tile }));
    if (tile.owner !== undefined && !FACTION_IDS.includes(tile.owner))
      issues.push(issue('bad-owner', 'error', t('validation.badOwner', { value: String(tile.owner) }), { path, at: tile }));
    if (!inBounds(tile, cols, rows)) {
      issues.push(issue('tile-out-of-bounds', 'error', t('validation.tileOutOfBounds'), { path, at: tile }));
      return;
    }
    const key = hexKey(tile.q, tile.r);
    if (tileMap.has(key)) issues.push(issue('duplicate-tile', 'error', t('validation.duplicateTile', { q: tile.q, r: tile.r }), { path, at: tile, repair: t('validation.repairDuplicateTile') }));
    else tileMap.set(key, tile);
    if (tile.building && tile.terrain === 'water')
      issues.push(issue('building-on-water', 'error', t('validation.buildingOnWater'), { path, at: tile, repair: t('validation.repairBuildingOnWater') }));
    if (tile.owner !== undefined && !tile.building)
      issues.push(issue('owner-without-building', 'warning', t('validation.ownerWithoutBuilding'), { path, at: tile }));
  });

  // ---------- 구조: 세력 ----------
  const factionIds = doc.factions.map((f) => f.id);
  if (new Set(factionIds).size !== factionIds.length)
    issues.push(issue('duplicate-faction', 'error', t('validation.duplicateFaction'), { path: 'factions' }));
  for (const fid of FACTION_IDS) {
    if (!factionIds.includes(fid))
      issues.push(issue('missing-faction', 'error', t('validation.missingFaction', { faction: fid }), { path: 'factions' }));
  }
  doc.factions.forEach((f, i) => {
    const path = `factions[${i}]`;
    if (!FACTION_IDS.includes(f.id))
      issues.push(issue('bad-faction-id', 'error', t('validation.badFactionId', { value: String(f.id) }), { path }));
    if (f.controller !== 'human' && f.controller !== 'ai')
      issues.push(issue('bad-controller', 'error', t('validation.badController'), { path }));
    if (f.startGold !== undefined && (!Number.isFinite(f.startGold) || f.startGold < 0 || f.startGold > 999))
      issues.push(issue('bad-start-gold', 'error', t('validation.badStartGold'), { path }));
  });
  const active = doc.factions.filter((f) => f.active && FACTION_IDS.includes(f.id));
  const humans = active.filter((f) => f.controller === 'human');
  if (active.length < 2)
    issues.push(issue('not-enough-factions', 'error', t('validation.notEnoughFactions'), { path: 'factions' }));
  if (humans.length !== 1)
    issues.push(issue('human-count', 'error', t('validation.humanCount'), { path: 'factions', repair: t('validation.repairHumanCount') }));
  const humanId: FactionId | null = humans[0]?.id ?? null;
  const activeIds = new Set(active.map((f) => f.id));
  // 비활성 세력이 거점·유닛을 갖고 있으면 오류
  for (const tile of doc.board.tiles) {
    if (tile.owner && !activeIds.has(tile.owner))
      issues.push(issue('inactive-owner', 'error', t('validation.inactiveOwner', { faction: tile.owner }), { at: tile }));
  }

  // ---------- 구조: 유닛 ----------
  if (doc.units.length > L.maxUnits)
    issues.push(issue('too-many-units', 'error', t('validation.tooManyUnits', { max: L.maxUnits }), { path: 'units' }));
  const unitKeys = new Set<string>();
  const tags = new Set<string>();
  doc.units.forEach((u, i) => {
    const path = `units[${i}]`;
    if (!FACTION_IDS.includes(u.faction)) {
      issues.push(issue('bad-unit-faction', 'error', t('validation.badUnitFaction', { value: String(u.faction) }), { path, unitIndex: i }));
      return;
    }
    if (!activeIds.has(u.faction))
      issues.push(issue('unit-inactive-faction', 'error', t('validation.unitInactiveFaction', { faction: u.faction }), { path, unitIndex: i }));
    if (!isKnownUnitType(u.type)) {
      issues.push(issue('bad-unit-type', 'error', t('validation.badUnitType', { value: String(u.type) }), { path, unitIndex: i }));
      return;
    }
    if (!canFactionUseUnit(u.faction, u.type)) {
      issues.push(
        issue(
          'unit-faction-mismatch',
          'error',
          t('validation.unitFactionMismatch', { unit: u.type, faction: u.faction }),
          { path, unitIndex: i },
        ),
      );
    }
    // uniqueUnits 미설정(false) 문서에 고유 병종 배치 금지 — 기존 문서 의미 유지
    if (isUniqueUnit(u.type) && doc.rules?.uniqueUnits !== true) {
      issues.push(
        issue(
          'unique-unit-disallowed',
          'error',
          t('validation.uniqueUnitDisallowed', { unit: u.type }),
          { path, unitIndex: i },
        ),
      );
    }
    if (u.hp !== undefined && (!Number.isInteger(u.hp) || u.hp < 1 || u.hp > UNIT_STATS[u.type].hp))
      issues.push(issue('bad-unit-hp', 'error', t('validation.badUnitHp', { max: UNIT_STATS[u.type].hp }), { path, unitIndex: i }));
    const key = hexKey(u.q, u.r);
    const tile = tileMap.get(key);
    if (!tile) issues.push(issue('unit-off-map', 'error', t('validation.unitOffMap'), { path, unitIndex: i, at: u, repair: t('validation.repairUnitOffMap') }));
    else if (tile.terrain === 'water')
      issues.push(issue('unit-on-water', 'error', t('validation.unitOnWater'), { path, unitIndex: i, at: u, repair: t('validation.repairUnitOnWater') }));
    if (unitKeys.has(key))
      issues.push(issue('duplicate-unit-pos', 'error', t('validation.duplicateUnitPos', { q: u.q, r: u.r }), { path, unitIndex: i, at: u }));
    unitKeys.add(key);
    if (u.tag !== undefined) {
      if (typeof u.tag !== 'string' || u.tag.length === 0 || u.tag.length > L.maxTagLen)
        issues.push(issue('bad-unit-tag', 'error', t('validation.badUnitTag', { max: L.maxTagLen }), { path, unitIndex: i }));
      else if (tags.has(u.tag))
        issues.push(issue('duplicate-unit-tag', 'error', t('validation.duplicateUnitTag', { tag: u.tag }), { path, unitIndex: i }));
      else tags.add(u.tag);
    }
  });

  // ---------- 구조: 규칙 ----------
  if (
    !Number.isInteger(doc.rules?.maxTurns) ||
    doc.rules.maxTurns < L.maxTurnsMin ||
    doc.rules.maxTurns > L.maxTurnsMax
  )
    issues.push(issue('bad-max-turns', 'error', t('validation.badMaxTurns', { min: L.maxTurnsMin, max: L.maxTurnsMax }), { path: 'rules.maxTurns' }));
  if (doc.rules?.turnLimit !== 'score' && doc.rules?.turnLimit !== 'defeat')
    issues.push(issue('bad-turn-limit', 'error', t('validation.badTurnLimit'), { path: 'rules.turnLimit' }));
  if (doc.rules?.modifier !== undefined && !(doc.rules.modifier in MODIFIERS))
    issues.push(issue('bad-modifier', 'error', t('validation.badModifier', { value: String(doc.rules.modifier) }), { path: 'rules.modifier' }));

  // ---------- 조건 ----------
  const victory = doc.victoryConditions ?? [];
  const defeat = doc.defeatConditions ?? [];
  const stars = doc.starConditions ?? [];
  if (victory.length === 0)
    issues.push(issue('no-victory', 'error', t('validation.noVictory'), { path: 'victoryConditions' }));
  if (victory.length > L.maxConditions || defeat.length > L.maxConditions || stars.length > L.maxConditions)
    issues.push(issue('too-many-conditions', 'error', t('validation.tooManyConditions', { max: L.maxConditions })));

  const flatV = flattenVictory(victory);
  const checkTarget = (at: Axial, code: string, path: string) => {
    const tile = tileMap.get(hexKey(at.q, at.r));
    if (!tile) issues.push(issue(code, 'error', t('validation.targetTileMissing', { q: at.q, r: at.r }), { path, at }));
    else if (!tile.building)
      issues.push(issue(code, 'error', t('validation.targetBuildingMissing', { q: at.q, r: at.r }), { path, at, repair: t('validation.repairTargetBuilding') }));
    return tile;
  };
  flatV.forEach((c, i) => {
    const path = `victoryConditions[${i}]`;
    switch (c.type) {
      case 'hold-building':
        if (!Number.isInteger(c.turns) || c.turns < 1 || c.turns > L.maxTurnsMax)
          issues.push(issue('bad-hold-turns', 'error', t('validation.badHoldTurns'), { path }));
        checkTarget(c.at, 'victory-target-missing', path);
        break;
      case 'capture-building': {
        const targetTile = checkTarget(c.at, 'victory-target-missing', path);
        if (targetTile && humanId && targetTile.owner === humanId)
          issues.push(issue('immediate-win', 'error', t('validation.immediateWin'), { path, at: c.at }));
        break;
      }
      case 'capture-count':
        if (!(c.building in BUILDING_INCOME) || !Number.isInteger(c.count) || c.count < 1)
          issues.push(issue('bad-capture-count', 'error', t('validation.badCaptureCount'), { path }));
        else if (doc.board.tiles.filter((t) => t.building === c.building).length < c.count)
          issues.push(issue('unreachable-count', 'error', t('validation.unreachableCount', { building: c.building, count: c.count }), { path }));
        break;
      case 'eliminate-faction':
        if (!FACTION_IDS.includes(c.faction)) issues.push(issue('bad-target-faction', 'error', t('validation.badTargetFaction'), { path }));
        else if (!activeIds.has(c.faction))
          issues.push(issue('eliminate-inactive', 'error', t('validation.eliminateInactive'), { path }));
        else if (c.faction === humanId)
          issues.push(issue('eliminate-self', 'error', t('validation.eliminateSelf'), { path }));
        break;
      case 'survive-turns':
        if (!Number.isInteger(c.turns) || c.turns < 1)
          issues.push(issue('bad-survive-turns', 'error', t('validation.badSurviveTurns'), { path }));
        else if (c.turns > doc.rules.maxTurns)
          issues.push(issue('survive-beyond-limit', 'error', t('validation.surviveBeyondLimit'), { path, repair: t('validation.repairSurviveTurns') }));
        break;
      case 'reach-score':
        if (!Number.isInteger(c.score) || c.score < 1)
          issues.push(issue('bad-score', 'error', t('validation.badScore'), { path }));
        break;
      case 'unit-alive':
        if (!tags.has(c.tag))
          issues.push(issue('unknown-tag', 'error', t('validation.unknownTag', { tag: c.tag }), { path }));
        break;
      case 'conquest': {
        const capitals = doc.board.tiles.filter((t) => t.building === 'capital');
        if (capitals.length === 0)
          issues.push(issue('conquest-no-capitals', 'error', t('validation.conquestNoCapitals'), { path }));
        break;
      }
      case 'all-of':
      case 'any-of':
        if (!Array.isArray(c.conditions) || c.conditions.length === 0)
          issues.push(issue('empty-composite', 'error', t('validation.emptyComposite'), { path }));
        break;
    }
  });
  defeat.forEach((c, i) => {
    const path = `defeatConditions[${i}]`;
    switch (c.type) {
      case 'lose-building': {
        const targetTile = checkTarget(c.at, 'defeat-target-missing', path);
        if (targetTile && humanId && targetTile.owner !== humanId)
          issues.push(issue('immediate-defeat', 'error', t('validation.immediateDefeatNotOwned'), { path, at: c.at }));
        break;
      }
      case 'enemy-captures': {
        const targetTile = checkTarget(c.at, 'defeat-target-missing', path);
        if (targetTile && targetTile.owner && targetTile.owner !== humanId)
          issues.push(issue('immediate-defeat', 'error', t('validation.immediateDefeatEnemy'), { path, at: c.at }));
        break;
      }
      case 'unit-dies':
        if (!tags.has(c.tag))
          issues.push(issue('unknown-tag', 'error', t('validation.unknownTag', { tag: c.tag }), { path }));
        break;
      case 'human-eliminated':
      case 'turn-limit':
        break;
    }
  });
  stars.forEach((c: StarCondition, i) => {
    const path = `starConditions[${i}]`;
    if (c.type === 'unit-alive' && !tags.has(c.tag))
      issues.push(issue('unknown-tag', 'error', t('validation.unknownTag', { tag: c.tag }), { path }));
    if ('count' in c && (!Number.isInteger(c.count) || c.count < 0))
      issues.push(issue('bad-star-count', 'error', t('validation.badStarCount'), { path }));
    if (c.type === 'win-within-turns' && (!Number.isInteger(c.turns) || c.turns < 1))
      issues.push(issue('bad-star-count', 'error', t('validation.badStarCount'), { path }));
    if (c.type === 'gold-at-least' && (!Number.isInteger(c.amount) || c.amount < 0))
      issues.push(issue('bad-star-count', 'error', t('validation.badStarCount'), { path }));
  });
  // 모순 조건: 생존 승리 턴과 turn-limit 패배가 같은 턴에 겹치는 경우는 생존 우선으로 처리되므로 정보만 남긴다
  if (flatV.some((c) => c.type === 'survive-turns') && defeat.some((c) => c.type === 'turn-limit'))
    issues.push(issue('survive-vs-turn-limit', 'info', t('validation.surviveVsTurnLimit')));

  // ---------- 플레이 가능성 ----------
  if (humanId && issues.every((i) => i.severity !== 'error')) {
    const humanUnits = doc.units.filter((u) => u.faction === humanId);
    const humanCapital = doc.board.tiles.find((t) => t.building === 'capital' && t.owner === humanId);
    if (humanUnits.length === 0 && !humanCapital)
      issues.push(issue('human-nothing', 'error', t('validation.humanNothing'), { repair: t('validation.repairHumanNothing') }));
    for (const f of active) {
      const cap = doc.board.tiles.find((t) => t.building === 'capital' && t.owner === f.id);
      const units = doc.units.filter((u) => u.faction === f.id);
      if (!cap && units.length === 0)
        issues.push(issue('faction-nothing', 'error', t('validation.factionNothing', { faction: f.id })));
      else if (!cap) issues.push(issue('faction-no-capital', 'warning', t('validation.factionNoCapital', { faction: f.id })));
      else if (units.length === 0)
        issues.push(issue('faction-no-units', 'info', t('validation.factionNoUnits', { faction: f.id })));
    }
    // 필수 목표까지 지상 경로 존재(인간 시작 지점 기준)
    const start: Axial | null = humanCapital ?? humanUnits[0] ?? null;
    if (start) {
      const targets: { at: Axial; label: string }[] = [];
      for (const c of flatV) {
        if (c.type === 'capture-building' || c.type === 'hold-building') targets.push({ at: c.at, label: c.type });
        if (c.type === 'eliminate-faction' || c.type === 'conquest') {
          for (const t of doc.board.tiles) {
            if (t.building === 'capital' && t.owner && t.owner !== humanId && activeIds.has(t.owner)) {
              if (c.type === 'eliminate-faction' && t.owner !== c.faction) continue;
              targets.push({ at: t, label: `${c.type}:${t.owner}` });
            }
          }
        }
      }
      for (const target of targets) {
        if (!landReachable(tileMap, start, target.at))
          issues.push(
            issue('objective-unreachable', 'error', t('validation.objectiveUnreachable', { target: target.label }), { at: target.at, repair: t('validation.repairObjectiveUnreachable') }),
          );
      }
    }
  }
  return issues;
}

/** error 심각도가 하나도 없으면 플레이 가능으로 본다. */
export function isPlayable(issues: ValidationIssue[]): boolean {
  return issues.every((i) => i.severity !== 'error');
}

/**
 * 신뢰할 수 없는 입력(가져오기)을 문서로 파싱한다.
 * 미래 스키마 버전은 안전하게 거부하고, 구조가 크게 어긋나면 즉시 오류를 반환한다.
 */
export function parseScenarioDocument(raw: unknown): {
  doc: ScenarioDocumentV1 | null;
  issues: ValidationIssue[];
} {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { doc: null, issues: [issue('not-object', 'error', t('validation.notObject'))] };
  }
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 1) {
    return {
      doc: null,
      issues: [issue('schema-version', 'error', t('validation.schemaVersion', { version: String(o.schemaVersion) }))],
    };
  }
  const board = o.board as Record<string, unknown> | undefined;
  if (!board || !Array.isArray(board.tiles) || !Array.isArray(o.factions) || !Array.isArray(o.units)) {
    return { doc: null, issues: [issue('bad-shape', 'error', t('validation.badShapeArrays'))] };
  }
  if (!o.rules || typeof o.rules !== 'object') {
    return { doc: null, issues: [issue('bad-shape', 'error', t('validation.badShapeRules'), { path: 'rules' })] };
  }
  if (!Array.isArray(o.victoryConditions) || !Array.isArray(o.defeatConditions)) {
    return { doc: null, issues: [issue('bad-shape', 'error', t('validation.badShapeConditions'))] };
  }
  if (board.tiles.length > L.maxCols * L.maxRows)
    return { doc: null, issues: [issue('too-many-tiles', 'error', t('validation.tooManyTiles'))] };
  if ((o.units as unknown[]).length > L.maxUnits)
    return { doc: null, issues: [issue('too-many-units', 'error', t('validation.tooManyUnitsImport'))] };
  const doc = raw as ScenarioDocumentV1;
  return { doc, issues: validateScenario(doc) };
}

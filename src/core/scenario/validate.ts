// 한 줄 목적: 시나리오 문서의 구조·플레이 가능성 검증(error/warning/info)을 수행한다
import { BUILDING_INCOME, FACTION_IDS, TERRAIN_RULES, UNIT_STATS } from '../data';
import { hexKey } from '../hex';
import { MODIFIERS } from '../daily';
import type { Axial, FactionId } from '../types';
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
    issues.push(issue('schema-version', 'error', `지원하지 않는 스키마 버전: ${String(doc.schemaVersion)}`, { path: 'schemaVersion' }));
  if (!isValidScenarioId(doc.id))
    issues.push(issue('bad-id', 'error', 'ID는 소문자·숫자·하이픈 1~64자여야 합니다', { path: 'id' }));
  if (typeof doc.title !== 'string' || doc.title.trim().length === 0)
    issues.push(issue('no-title', 'error', '제목이 필요합니다', { path: 'title' }));
  else if (doc.title.length > L.maxTitleLen)
    issues.push(issue('title-too-long', 'error', `제목은 ${L.maxTitleLen}자 이하여야 합니다`, { path: 'title' }));
  if (typeof doc.description !== 'string')
    issues.push(issue('no-description', 'error', '설명 필드가 필요합니다', { path: 'description' }));
  else if (doc.description.length > L.maxDescriptionLen)
    issues.push(issue('description-too-long', 'error', `설명은 ${L.maxDescriptionLen}자 이하여야 합니다`, { path: 'description' }));

  // ---------- 구조: 보드 ----------
  const { cols, rows } = doc.board ?? { cols: 0, rows: 0 };
  if (
    !Number.isInteger(cols) || !Number.isInteger(rows) ||
    cols < L.minCols || rows < L.minRows || cols > L.maxCols || rows > L.maxRows
  ) {
    issues.push(
      issue('bad-board-size', 'error', `지도 크기는 ${L.minCols}×${L.minRows}~${L.maxCols}×${L.maxRows}이어야 합니다`, { path: 'board' }),
    );
    return issues; // 보드가 무너지면 이후 검증 무의미
  }
  const tileMap = new Map<string, ScenarioTile>();
  doc.board.tiles.forEach((t, i) => {
    const path = `board.tiles[${i}]`;
    if (!(t.terrain in TERRAIN_RULES)) {
      issues.push(issue('bad-terrain', 'error', `잘못된 지형: ${String(t.terrain)}`, { path, at: t }));
      return;
    }
    if (t.building !== undefined && !(t.building in BUILDING_INCOME))
      issues.push(issue('bad-building', 'error', `잘못된 건물: ${String(t.building)}`, { path, at: t }));
    if (t.owner !== undefined && !FACTION_IDS.includes(t.owner))
      issues.push(issue('bad-owner', 'error', `잘못된 소유 세력: ${String(t.owner)}`, { path, at: t }));
    if (!inBounds(t, cols, rows)) {
      issues.push(issue('tile-out-of-bounds', 'error', '지도 범위 밖 타일', { path, at: t }));
      return;
    }
    const key = hexKey(t.q, t.r);
    if (tileMap.has(key)) issues.push(issue('duplicate-tile', 'error', `중복 타일 (${t.q},${t.r})`, { path, at: t, repair: '중복 타일 중 하나를 제거하세요' }));
    else tileMap.set(key, t);
    if (t.building && t.terrain === 'water')
      issues.push(issue('building-on-water', 'error', '물 위에 건물이 있습니다', { path, at: t, repair: '지형을 평원으로 바꾸세요' }));
    if (t.owner !== undefined && !t.building)
      issues.push(issue('owner-without-building', 'warning', '건물 없는 타일에 소유자가 있습니다', { path, at: t }));
  });

  // ---------- 구조: 세력 ----------
  const factionIds = doc.factions.map((f) => f.id);
  if (new Set(factionIds).size !== factionIds.length)
    issues.push(issue('duplicate-faction', 'error', '세력 정의가 중복되었습니다', { path: 'factions' }));
  for (const fid of FACTION_IDS) {
    if (!factionIds.includes(fid))
      issues.push(issue('missing-faction', 'error', `세력 정의 누락: ${fid}`, { path: 'factions' }));
  }
  doc.factions.forEach((f, i) => {
    const path = `factions[${i}]`;
    if (!FACTION_IDS.includes(f.id))
      issues.push(issue('bad-faction-id', 'error', `잘못된 세력 ID: ${String(f.id)}`, { path }));
    if (f.controller !== 'human' && f.controller !== 'ai')
      issues.push(issue('bad-controller', 'error', '세력 controller는 human 또는 ai여야 합니다', { path }));
    if (f.startGold !== undefined && (!Number.isFinite(f.startGold) || f.startGold < 0 || f.startGold > 999))
      issues.push(issue('bad-start-gold', 'error', '시작 금은 0~999여야 합니다', { path }));
  });
  const active = doc.factions.filter((f) => f.active && FACTION_IDS.includes(f.id));
  const humans = active.filter((f) => f.controller === 'human');
  if (active.length < 2)
    issues.push(issue('not-enough-factions', 'error', '활성 세력이 2개 이상이어야 합니다', { path: 'factions' }));
  if (humans.length !== 1)
    issues.push(issue('human-count', 'error', '활성 인간 세력이 정확히 하나여야 합니다', { path: 'factions', repair: '한 세력만 human으로 설정하세요' }));
  const humanId: FactionId | null = humans[0]?.id ?? null;
  const activeIds = new Set(active.map((f) => f.id));
  // 비활성 세력이 거점·유닛을 갖고 있으면 오류
  for (const t of doc.board.tiles) {
    if (t.owner && !activeIds.has(t.owner))
      issues.push(issue('inactive-owner', 'error', `비활성 세력 ${t.owner}이(가) 거점을 소유합니다`, { at: t }));
  }

  // ---------- 구조: 유닛 ----------
  if (doc.units.length > L.maxUnits)
    issues.push(issue('too-many-units', 'error', `유닛은 최대 ${L.maxUnits}기입니다`, { path: 'units' }));
  const unitKeys = new Set<string>();
  const tags = new Set<string>();
  doc.units.forEach((u, i) => {
    const path = `units[${i}]`;
    if (!FACTION_IDS.includes(u.faction)) {
      issues.push(issue('bad-unit-faction', 'error', `잘못된 유닛 세력: ${String(u.faction)}`, { path, unitIndex: i }));
      return;
    }
    if (!activeIds.has(u.faction))
      issues.push(issue('unit-inactive-faction', 'error', `비활성 세력의 유닛: ${u.faction}`, { path, unitIndex: i }));
    if (!(u.type in UNIT_STATS)) {
      issues.push(issue('bad-unit-type', 'error', `잘못된 병과: ${String(u.type)}`, { path, unitIndex: i }));
      return;
    }
    if (u.hp !== undefined && (!Number.isInteger(u.hp) || u.hp < 1 || u.hp > UNIT_STATS[u.type].hp))
      issues.push(issue('bad-unit-hp', 'error', `HP는 1~${UNIT_STATS[u.type].hp}이어야 합니다`, { path, unitIndex: i }));
    const key = hexKey(u.q, u.r);
    const tile = tileMap.get(key);
    if (!tile) issues.push(issue('unit-off-map', 'error', '존재하지 않는 타일 위 유닛', { path, unitIndex: i, at: u, repair: '유닛을 지도 안 지상 타일로 옮기세요' }));
    else if (tile.terrain === 'water')
      issues.push(issue('unit-on-water', 'error', '물 위 유닛', { path, unitIndex: i, at: u, repair: '유닛을 지상 타일로 옮기세요' }));
    if (unitKeys.has(key))
      issues.push(issue('duplicate-unit-pos', 'error', `유닛 좌표 중복 (${u.q},${u.r})`, { path, unitIndex: i, at: u }));
    unitKeys.add(key);
    if (u.tag !== undefined) {
      if (typeof u.tag !== 'string' || u.tag.length === 0 || u.tag.length > L.maxTagLen)
        issues.push(issue('bad-unit-tag', 'error', `유닛 태그는 1~${L.maxTagLen}자여야 합니다`, { path, unitIndex: i }));
      else if (tags.has(u.tag))
        issues.push(issue('duplicate-unit-tag', 'error', `유닛 태그 중복: ${u.tag}`, { path, unitIndex: i }));
      else tags.add(u.tag);
    }
  });

  // ---------- 구조: 규칙 ----------
  if (
    !Number.isInteger(doc.rules?.maxTurns) ||
    doc.rules.maxTurns < L.maxTurnsMin ||
    doc.rules.maxTurns > L.maxTurnsMax
  )
    issues.push(issue('bad-max-turns', 'error', `최대 턴은 ${L.maxTurnsMin}~${L.maxTurnsMax}이어야 합니다`, { path: 'rules.maxTurns' }));
  if (doc.rules?.turnLimit !== 'score' && doc.rules?.turnLimit !== 'defeat')
    issues.push(issue('bad-turn-limit', 'error', 'turnLimit은 score 또는 defeat여야 합니다', { path: 'rules.turnLimit' }));
  if (doc.rules?.modifier !== undefined && !(doc.rules.modifier in MODIFIERS))
    issues.push(issue('bad-modifier', 'error', `알 수 없는 수정자: ${String(doc.rules.modifier)}`, { path: 'rules.modifier' }));

  // ---------- 조건 ----------
  const victory = doc.victoryConditions ?? [];
  const defeat = doc.defeatConditions ?? [];
  const stars = doc.starConditions ?? [];
  if (victory.length === 0)
    issues.push(issue('no-victory', 'error', '승리 조건이 최소 1개 필요합니다', { path: 'victoryConditions' }));
  if (victory.length > L.maxConditions || defeat.length > L.maxConditions || stars.length > L.maxConditions)
    issues.push(issue('too-many-conditions', 'error', `조건은 종류별 최대 ${L.maxConditions}개입니다`));

  const flatV = flattenVictory(victory);
  const checkTarget = (at: Axial, code: string, path: string) => {
    const t = tileMap.get(hexKey(at.q, at.r));
    if (!t) issues.push(issue(code, 'error', `조건 대상 타일 (${at.q},${at.r})이 없습니다`, { path, at }));
    else if (!t.building)
      issues.push(issue(code, 'error', `조건 대상 (${at.q},${at.r})에 건물이 없습니다`, { path, at, repair: '해당 타일에 거점을 배치하세요' }));
    return t;
  };
  flatV.forEach((c, i) => {
    const path = `victoryConditions[${i}]`;
    switch (c.type) {
      case 'hold-building':
        if (!Number.isInteger(c.turns) || c.turns < 1 || c.turns > L.maxTurnsMax)
          issues.push(issue('bad-hold-turns', 'error', '보유 턴 수가 잘못되었습니다', { path }));
        checkTarget(c.at, 'victory-target-missing', path);
        break;
      case 'capture-building': {
        const t = checkTarget(c.at, 'victory-target-missing', path);
        if (t && humanId && t.owner === humanId)
          issues.push(issue('immediate-win', 'error', '시작부터 인간 세력이 목표 거점을 소유해 즉시 승리합니다', { path, at: c.at }));
        break;
      }
      case 'capture-count':
        if (!(c.building in BUILDING_INCOME) || !Number.isInteger(c.count) || c.count < 1)
          issues.push(issue('bad-capture-count', 'error', '거점 수 조건이 잘못되었습니다', { path }));
        else if (doc.board.tiles.filter((t) => t.building === c.building).length < c.count)
          issues.push(issue('unreachable-count', 'error', `지도에 ${c.building} 거점이 ${c.count}개보다 적습니다`, { path }));
        break;
      case 'eliminate-faction':
        if (!FACTION_IDS.includes(c.faction)) issues.push(issue('bad-target-faction', 'error', '잘못된 대상 세력', { path }));
        else if (!activeIds.has(c.faction))
          issues.push(issue('eliminate-inactive', 'error', '비활성 세력 제거 조건은 시작 즉시 달성됩니다', { path }));
        else if (c.faction === humanId)
          issues.push(issue('eliminate-self', 'error', '인간 세력 제거는 승리 조건이 될 수 없습니다', { path }));
        break;
      case 'survive-turns':
        if (!Number.isInteger(c.turns) || c.turns < 1)
          issues.push(issue('bad-survive-turns', 'error', '생존 턴 수가 잘못되었습니다', { path }));
        else if (c.turns > doc.rules.maxTurns)
          issues.push(issue('survive-beyond-limit', 'error', '생존 목표 턴이 최대 턴보다 깁니다(달성 불가)', { path, repair: '최대 턴 이하로 줄이세요' }));
        break;
      case 'reach-score':
        if (!Number.isInteger(c.score) || c.score < 1)
          issues.push(issue('bad-score', 'error', '목표 점수가 잘못되었습니다', { path }));
        break;
      case 'unit-alive':
        if (!tags.has(c.tag))
          issues.push(issue('unknown-tag', 'error', `존재하지 않는 유닛 태그: ${c.tag}`, { path }));
        break;
      case 'conquest': {
        const capitals = doc.board.tiles.filter((t) => t.building === 'capital');
        if (capitals.length === 0)
          issues.push(issue('conquest-no-capitals', 'error', '정복 조건인데 수도가 없습니다', { path }));
        break;
      }
      case 'all-of':
      case 'any-of':
        if (!Array.isArray(c.conditions) || c.conditions.length === 0)
          issues.push(issue('empty-composite', 'error', '복합 조건이 비어 있습니다', { path }));
        break;
    }
  });
  defeat.forEach((c, i) => {
    const path = `defeatConditions[${i}]`;
    switch (c.type) {
      case 'lose-building': {
        const t = checkTarget(c.at, 'defeat-target-missing', path);
        if (t && humanId && t.owner !== humanId)
          issues.push(issue('immediate-defeat', 'error', '시작부터 인간 세력이 해당 거점을 소유하지 않아 즉시 패배합니다', { path, at: c.at }));
        break;
      }
      case 'enemy-captures': {
        const t = checkTarget(c.at, 'defeat-target-missing', path);
        if (t && t.owner && t.owner !== humanId)
          issues.push(issue('immediate-defeat', 'error', '시작부터 적이 해당 거점을 소유해 즉시 패배합니다', { path, at: c.at }));
        break;
      }
      case 'unit-dies':
        if (!tags.has(c.tag))
          issues.push(issue('unknown-tag', 'error', `존재하지 않는 유닛 태그: ${c.tag}`, { path }));
        break;
      case 'human-eliminated':
      case 'turn-limit':
        break;
    }
  });
  stars.forEach((c: StarCondition, i) => {
    const path = `starConditions[${i}]`;
    if (c.type === 'unit-alive' && !tags.has(c.tag))
      issues.push(issue('unknown-tag', 'error', `존재하지 않는 유닛 태그: ${c.tag}`, { path }));
    if ('count' in c && (!Number.isInteger(c.count) || c.count < 0))
      issues.push(issue('bad-star-count', 'error', '별점 조건 수치가 잘못되었습니다', { path }));
    if (c.type === 'win-within-turns' && (!Number.isInteger(c.turns) || c.turns < 1))
      issues.push(issue('bad-star-count', 'error', '별점 조건 수치가 잘못되었습니다', { path }));
    if (c.type === 'gold-at-least' && (!Number.isInteger(c.amount) || c.amount < 0))
      issues.push(issue('bad-star-count', 'error', '별점 조건 수치가 잘못되었습니다', { path }));
  });
  // 모순 조건: 생존 승리 턴과 turn-limit 패배가 같은 턴에 겹치는 경우는 생존 우선으로 처리되므로 정보만 남긴다
  if (flatV.some((c) => c.type === 'survive-turns') && defeat.some((c) => c.type === 'turn-limit'))
    issues.push(issue('survive-vs-turn-limit', 'info', '생존 승리와 제한 턴 패배가 함께 있습니다. 생존 조건이 먼저 평가됩니다'));

  // ---------- 플레이 가능성 ----------
  if (humanId && issues.every((i) => i.severity !== 'error')) {
    const humanUnits = doc.units.filter((u) => u.faction === humanId);
    const humanCapital = doc.board.tiles.find((t) => t.building === 'capital' && t.owner === humanId);
    if (humanUnits.length === 0 && !humanCapital)
      issues.push(issue('human-nothing', 'error', '인간 세력에 유닛도 수도도 없습니다', { repair: '유닛이나 수도를 배치하세요' }));
    for (const f of active) {
      const cap = doc.board.tiles.find((t) => t.building === 'capital' && t.owner === f.id);
      const units = doc.units.filter((u) => u.faction === f.id);
      if (!cap && units.length === 0)
        issues.push(issue('faction-nothing', 'error', `${f.id} 세력에 유닛도 수도도 없습니다`));
      else if (!cap) issues.push(issue('faction-no-capital', 'warning', `${f.id} 세력에 수도가 없습니다(유닛 전멸 시 즉시 탈락)`));
      else if (units.length === 0)
        issues.push(issue('faction-no-units', 'info', `${f.id} 세력이 유닛 없이 시작합니다(생산으로 시작)`));
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
            issue('objective-unreachable', 'error', `목표(${target.label})까지 지상 경로가 없습니다`, { at: target.at, repair: '물·산으로 막힌 경로를 개통하세요' }),
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
    return { doc: null, issues: [issue('not-object', 'error', '시나리오 문서 형식이 아닙니다')] };
  }
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 1) {
    return {
      doc: null,
      issues: [issue('schema-version', 'error', `지원하지 않는 스키마 버전입니다: ${String(o.schemaVersion)}`)],
    };
  }
  const board = o.board as Record<string, unknown> | undefined;
  if (!board || !Array.isArray(board.tiles) || !Array.isArray(o.factions) || !Array.isArray(o.units)) {
    return { doc: null, issues: [issue('bad-shape', 'error', 'board.tiles / factions / units 배열이 필요합니다')] };
  }
  if (!o.rules || typeof o.rules !== 'object') {
    return { doc: null, issues: [issue('bad-shape', 'error', 'rules가 필요합니다', { path: 'rules' })] };
  }
  if (!Array.isArray(o.victoryConditions) || !Array.isArray(o.defeatConditions)) {
    return { doc: null, issues: [issue('bad-shape', 'error', '승리·패배 조건 배열이 필요합니다')] };
  }
  if (board.tiles.length > L.maxCols * L.maxRows)
    return { doc: null, issues: [issue('too-many-tiles', 'error', '타일 수가 한도를 초과합니다')] };
  if ((o.units as unknown[]).length > L.maxUnits)
    return { doc: null, issues: [issue('too-many-units', 'error', '유닛 수가 한도를 초과합니다')] };
  const doc = raw as ScenarioDocumentV1;
  return { doc, issues: validateScenario(doc) };
}

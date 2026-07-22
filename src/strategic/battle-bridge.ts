// 한 줄 목적: 전략 군단 충돌을 전술 ScenarioDocument·전투 보고서로 연결하는 순수 브리지를 구현한다
import { FACTION_IDS, UNIT_STATS } from '../core/data';
import { factionScore } from '../core/game';
import { digestString, canonicalJson } from '../core/replay';
import type { ScenarioDocumentV1, ScenarioTile } from '../core/scenario/types';
import type { FactionId, GameState } from '../core/types';
import { isKnownUnitType } from '../core/units';
import { cloneStrategicState } from './state';
import type {
  StrategicArmy,
  StrategicBattleContext,
  StrategicGameState,
  StrategicRegionTerrain,
  StrategicResult,
  TacticalBattleReport,
  TacticalUnitBinding,
} from './types';
import { validateStrategicState } from './validate';

function fail<T>(reason: string): StrategicResult<T> {
  return { ok: false, reason };
}

function fnv(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function armyById(state: StrategicGameState, id: string): StrategicArmy | undefined {
  return state.armies.find((a) => a.id === id);
}

export interface BattleContextRequest {
  attackerArmyId: string;
  defenderArmyId: string;
  regionId: string;
  attackerOriginRegionId: string;
}

/**
 * 군단 충돌 시 전술 전투 context를 결정론적으로 만든다.
 * battleId·battleSeed는 동일 상태+충돌에서 항상 같다.
 */
export function buildBattleContext(
  state: StrategicGameState,
  req: BattleContextRequest,
): StrategicResult<StrategicBattleContext> {
  const region = state.regions.find((r) => r.id === req.regionId);
  if (!region) return fail('region-missing');
  if (!state.regions.some((r) => r.id === req.attackerOriginRegionId))
    return fail('origin-missing');

  const attacker = armyById(state, req.attackerArmyId);
  const defender = armyById(state, req.defenderArmyId);
  if (!attacker) return fail('attacker-missing');
  if (!defender) return fail('defender-missing');
  if (attacker.id === defender.id) return fail('same-army');
  if (attacker.faction === defender.faction) return fail('same-faction');
  if (attacker.units.length === 0 || defender.units.length === 0) return fail('empty-army');
  if (defender.regionId !== req.regionId) return fail('defender-not-in-region');

  // 전략 유닛 ID 전역 유일·1:1 매핑
  const seenUnits = new Set<string>();
  const bindings: TacticalUnitBinding[] = [];
  for (const army of [attacker, defender]) {
    for (const u of army.units) {
      if (seenUnits.has(u.id)) return fail('duplicate-strategic-unit');
      seenUnits.add(u.id);
      if (!isKnownUnitType(u.type)) return fail('bad-unit-type');
      const maxHp = UNIT_STATS[u.type].hp;
      if (!Number.isInteger(u.hp) || u.hp < 1 || u.hp > maxHp) return fail('bad-unit-hp');
      const tag = `su-${u.id}`;
      bindings.push({
        strategicUnitId: u.id,
        tacticalTag: tag,
        armyId: army.id,
        faction: army.faction,
        type: u.type,
        startingHp: u.hp,
      });
    }
  }
  bindings.sort((a, b) => a.strategicUnitId.localeCompare(b.strategicUnitId));

  const idPayload = {
    seed: state.seed,
    turn: state.turn,
    regionId: req.regionId,
    attackerArmyId: req.attackerArmyId,
    defenderArmyId: req.defenderArmyId,
    origin: req.attackerOriginRegionId,
    units: bindings.map((b) => [b.strategicUnitId, b.type, b.startingHp]),
  };
  const battleId = digestString(canonicalJson(idPayload));
  const battleSeed = fnv(`${state.seed}|${battleId}|${state.turn}`) >>> 0;

  const ctx: StrategicBattleContext = {
    schemaVersion: 1,
    battleId,
    strategicTurn: state.turn,
    battleSeed,
    regionId: req.regionId,
    attackerArmyId: attacker.id,
    defenderArmyId: defender.id,
    attackerOriginRegionId: req.attackerOriginRegionId,
    humanFaction: state.humanFaction,
    unitBindings: bindings,
  };
  return { ok: true, value: ctx };
}

function terrainWeights(terrain: StrategicRegionTerrain): {
  plains: number;
  forest: number;
  mountain: number;
} {
  if (terrain === 'forest') return { plains: 4, forest: 10, mountain: 2 };
  if (terrain === 'mountain') return { plains: 3, forest: 4, mountain: 9 };
  return { plains: 10, forest: 3, mountain: 1 };
}

function pickTerrain(
  weights: { plains: number; forest: number; mountain: number },
  roll: number,
): 'plains' | 'forest' | 'mountain' {
  const total = weights.plains + weights.forest + weights.mountain;
  const x = ((roll % total) + total) % total;
  if (x < weights.plains) return 'plains';
  if (x < weights.plains + weights.forest) return 'forest';
  return 'mountain';
}

function oddRKey(col: number, row: number): { q: number; r: number } {
  const q = col - ((row - (row & 1)) >> 1);
  return { q, r: row };
}

/**
 * 전투 context → ScenarioDocumentV1.
 * 8×8 고정 보드, 생산 거점 없음, uniqueUnits·doctrines 활성, 턴 10, 적 섬멸 승리.
 */
export function buildTacticalScenario(
  context: StrategicBattleContext,
  strategicState: StrategicGameState,
): StrategicResult<ScenarioDocumentV1> {
  if (context.schemaVersion !== 1) return fail('bad-context-schema');
  const region = strategicState.regions.find((r) => r.id === context.regionId);
  if (!region) return fail('region-missing');

  const attacker = armyById(strategicState, context.attackerArmyId);
  const defender = armyById(strategicState, context.defenderArmyId);
  if (!attacker || !defender) return fail('army-missing');

  // 바인딩 완전성·1:1
  const expectedIds = new Set<string>();
  for (const army of [attacker, defender]) {
    for (const u of army.units) expectedIds.add(u.id);
  }
  if (context.unitBindings.length !== expectedIds.size) return fail('binding-count');
  const tagSet = new Set<string>();
  const boundIds = new Set<string>();
  for (const b of context.unitBindings) {
    if (boundIds.has(b.strategicUnitId)) return fail('dup-binding');
    boundIds.add(b.strategicUnitId);
    if (tagSet.has(b.tacticalTag)) return fail('dup-tag');
    tagSet.add(b.tacticalTag);
    if (!expectedIds.has(b.strategicUnitId)) return fail('unknown-binding-unit');
    const army = b.armyId === attacker.id ? attacker : b.armyId === defender.id ? defender : null;
    if (!army) return fail('binding-army');
    const unit = army.units.find((u) => u.id === b.strategicUnitId);
    if (!unit) return fail('binding-unit-missing');
    if (unit.type !== b.type || unit.hp !== b.startingHp || army.faction !== b.faction)
      return fail('binding-mismatch');
  }
  for (const id of expectedIds) {
    if (!boundIds.has(id)) return fail('missing-binding');
  }

  const cols = 8;
  const rows = 8;
  const weights = terrainWeights(region.terrain);
  const tiles: ScenarioTile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const { q, r } = oddRKey(col, row);
      const roll = fnv(`${context.battleSeed}|${col}|${row}`);
      tiles.push({ q, r, terrain: pickTerrain(weights, roll) });
    }
  }

  // 배치: 공격군 왼쪽(col 1), 방어군 오른쪽(col 6), 행을 유닛 순으로
  const attackerBindings = context.unitBindings
    .filter((b) => b.armyId === attacker.id)
    .sort((a, b) => a.strategicUnitId.localeCompare(b.strategicUnitId));
  const defenderBindings = context.unitBindings
    .filter((b) => b.armyId === defender.id)
    .sort((a, b) => a.strategicUnitId.localeCompare(b.strategicUnitId));

  const units: ScenarioDocumentV1['units'] = [];
  const place = (list: TacticalUnitBinding[], col: number) => {
    list.forEach((b, i) => {
      const row = Math.min(1 + i, rows - 2);
      const { q, r } = oddRKey(col, row);
      units.push({
        faction: b.faction,
        type: b.type,
        q,
        r,
        hp: b.startingHp,
        tag: b.tacticalTag,
        canAct: true,
      });
    });
  };
  place(attackerBindings, 1);
  place(defenderBindings, 6);

  const activeFactions = new Set<FactionId>([attacker.faction, defender.faction]);
  const humanInBattle = activeFactions.has(context.humanFaction)
    ? context.humanFaction
    : attacker.faction;

  const factions: ScenarioDocumentV1['factions'] = FACTION_IDS.map((id) => ({
    id,
    active: activeFactions.has(id),
    controller: id === humanInBattle ? ('human' as const) : ('ai' as const),
    startGold: 0,
    useDoctrine: true,
  }));

  // 시나리오 ID: battleId hex 앞부분(슬러그 제약 충족)
  const shortId = `sb-${context.battleId.slice(0, 20)}`;

  // 승리: 인간 참여 시 상대 섬멸. 제한 턴 종료 시 점수 규칙으로 승자·무승부.
  const enemyOfHuman =
    humanInBattle === attacker.faction ? defender.faction : attacker.faction;

  const doc: ScenarioDocumentV1 = {
    schemaVersion: 1,
    id: shortId,
    title: 'Strategic Battle',
    description: `V0 strategic battle at ${context.regionId}`,
    board: {
      cols,
      rows,
      tiles,
      source: { kind: 'fixed' },
    },
    factions,
    units,
    rules: {
      maxTurns: 10,
      turnLimit: 'score',
      doctrines: true,
      uniqueUnits: true,
    },
    victoryConditions: [{ type: 'eliminate-faction', faction: enemyOfHuman }],
    defeatConditions: [{ type: 'human-eliminated' }],
  };

  return { ok: true, value: doc };
}

/**
 * 종료된 전술 GameState + context → 전투 보고서.
 * 미종료·태그 불명·중복·HP 범위 위반은 fail-closed.
 */
export function buildTacticalBattleReport(
  context: StrategicBattleContext,
  finishedGameState: GameState,
): StrategicResult<TacticalBattleReport> {
  if (!finishedGameState.over) return fail('battle-not-finished');
  if (finishedGameState.winner === undefined) return fail('no-winner');

  const bindingByTag = new Map(context.unitBindings.map((b) => [b.tacticalTag, b]));
  const bindingByUnit = new Map(context.unitBindings.map((b) => [b.strategicUnitId, b]));

  // 전술 유닛에 등장한 태그 수집
  const seenTags = new Set<string>();
  const survivors: TacticalBattleReport['survivingUnits'] = [];
  for (const u of finishedGameState.units) {
    if (!u.tag) continue;
    if (!bindingByTag.has(u.tag)) return fail('unknown-tactical-tag');
    if (seenTags.has(u.tag)) return fail('duplicate-tag-in-state');
    seenTags.add(u.tag);
    const b = bindingByTag.get(u.tag)!;
    if (!isKnownUnitType(u.type) || u.type !== b.type) return fail('type-mismatch');
    if (u.faction !== b.faction) return fail('faction-mismatch');
    const maxHp = UNIT_STATS[u.type].hp;
    if (!Number.isInteger(u.hp) || u.hp < 1 || u.hp > maxHp) return fail('bad-survivor-hp');
    survivors.push({
      strategicUnitId: b.strategicUnitId,
      armyId: b.armyId,
      faction: b.faction,
      type: b.type,
      hp: u.hp,
    });
  }

  const survivorIds = new Set(survivors.map((s) => s.strategicUnitId));
  if (survivorIds.size !== survivors.length) return fail('duplicate-survivor-id');

  const losses: TacticalBattleReport['losses'] = [];
  for (const b of context.unitBindings) {
    if (survivorIds.has(b.strategicUnitId)) continue;
    losses.push({
      strategicUnitId: b.strategicUnitId,
      armyId: b.armyId,
      faction: b.faction,
      type: b.type,
    });
  }

  // 모든 바인딩이 survivor 또는 loss 중 정확히 하나
  if (survivors.length + losses.length !== context.unitBindings.length)
    return fail('partition-incomplete');
  for (const b of context.unitBindings) {
    const inS = survivorIds.has(b.strategicUnitId);
    const inL = losses.some((l) => l.strategicUnitId === b.strategicUnitId);
    if (inS === inL) return fail('partition-overlap');
  }

  // 승자 일치: 전술 winner와 보고서 winner
  const winner: FactionId | 'draw' = finishedGameState.winner;
  if (winner !== 'draw' && !FACTION_IDS.includes(winner)) return fail('bad-winner');

  // 참여 세력만 승자 가능(draw 제외)
  const participating = new Set(context.unitBindings.map((b) => b.faction));
  if (winner !== 'draw' && !participating.has(winner)) return fail('winner-not-participant');

  // 퇴각 군단: 패배 측 생존 시 퇴각. draw면 공격군 퇴각.
  const attackerFaction = context.unitBindings.find(
    (b) => b.armyId === context.attackerArmyId,
  )?.faction;
  const defenderFaction = context.unitBindings.find(
    (b) => b.armyId === context.defenderArmyId,
  )?.faction;
  if (!attackerFaction || !defenderFaction) return fail('faction-lookup');

  const retreatingArmyIds: string[] = [];
  const attackerAlive = survivors.some((s) => s.armyId === context.attackerArmyId);
  const defenderAlive = survivors.some((s) => s.armyId === context.defenderArmyId);

  if (winner === 'draw') {
    if (attackerAlive) retreatingArmyIds.push(context.attackerArmyId);
  } else if (winner === attackerFaction) {
    if (defenderAlive) retreatingArmyIds.push(context.defenderArmyId);
  } else if (winner === defenderFaction) {
    if (attackerAlive) retreatingArmyIds.push(context.attackerArmyId);
  } else {
    return fail('winner-faction');
  }

  const scoreByFaction = {} as Record<FactionId, number>;
  for (const fid of FACTION_IDS) {
    scoreByFaction[fid] = factionScore(finishedGameState, fid);
  }

  // battleId는 context 기준(보고서가 다른 id를 주장할 수 없음 — 생성 시 context 사용)
  const report: TacticalBattleReport = {
    schemaVersion: 1,
    battleId: context.battleId,
    winner,
    survivingUnits: survivors.sort((a, b) =>
      a.strategicUnitId.localeCompare(b.strategicUnitId),
    ),
    losses: losses.sort((a, b) => a.strategicUnitId.localeCompare(b.strategicUnitId)),
    retreatingArmyIds: [...retreatingArmyIds].sort(),
    turns: finishedGameState.turn,
    scoreByFaction,
  };

  // 미사용 변수 정리용 — bindingByUnit 존재 검증
  if (bindingByUnit.size !== context.unitBindings.length) return fail('internal');

  return { ok: true, value: report };
}

function pickRetreatRegion(
  state: StrategicGameState,
  army: StrategicArmy,
  fromRegionId: string,
  forbiddenRegionIds: Set<string>,
): string | null {
  const from = state.regions.find((r) => r.id === fromRegionId);
  if (!from) return null;
  const candidates = from.neighbors
    .filter((nid) => {
      if (forbiddenRegionIds.has(nid)) return false;
      const reg = state.regions.find((r) => r.id === nid);
      if (!reg) return false;
      // 우호: 자군 소유
      if (reg.owner !== army.faction) return false;
      // 다른 군단 없음
      if (state.armies.some((a) => a.id !== army.id && a.regionId === nid)) return false;
      return true;
    })
    .sort();
  return candidates[0] ?? null;
}

/**
 * 전투 보고서를 전략 상태에 결정론적으로 반영한다.
 * pendingBattle과 battleId가 일치해야 하며 동일 보고 재적용은 거절.
 */
export function applyTacticalBattleReport(
  state: StrategicGameState,
  report: TacticalBattleReport,
): StrategicResult<StrategicGameState> {
  if (report.schemaVersion !== 1) return fail('bad-report-schema');
  if (!state.pendingBattle) return fail('no-pending-battle');
  if (state.pendingBattle.battleId !== report.battleId) return fail('battle-id-mismatch');
  if (state.phase !== 'battle') return fail('not-battle-phase');

  const ctx = state.pendingBattle;
  const next = cloneStrategicState(state);

  // 보고서 유닛 집합이 context 바인딩과 일치하는지
  const boundIds = new Set(ctx.unitBindings.map((b) => b.strategicUnitId));
  const reportIds = new Set<string>();
  for (const s of report.survivingUnits) {
    if (reportIds.has(s.strategicUnitId)) return fail('dup-survivor');
    reportIds.add(s.strategicUnitId);
    if (!boundIds.has(s.strategicUnitId)) return fail('unknown-survivor');
    const maxHp = UNIT_STATS[s.type].hp;
    if (!Number.isInteger(s.hp) || s.hp < 1 || s.hp > maxHp) return fail('bad-hp');
  }
  for (const l of report.losses) {
    if (reportIds.has(l.strategicUnitId)) return fail('overlap-loss');
    reportIds.add(l.strategicUnitId);
    if (!boundIds.has(l.strategicUnitId)) return fail('unknown-loss');
  }
  if (reportIds.size !== boundIds.size) return fail('incomplete-units');

  const survivorMap = new Map(report.survivingUnits.map((s) => [s.strategicUnitId, s]));
  const lossSet = new Set(report.losses.map((l) => l.strategicUnitId));

  // 군단 유닛 갱신
  for (const army of next.armies) {
    if (army.id !== ctx.attackerArmyId && army.id !== ctx.defenderArmyId) continue;
    const kept = [];
    for (const u of army.units) {
      if (lossSet.has(u.id)) continue;
      const surv = survivorMap.get(u.id);
      if (!surv) return fail('unit-not-in-report');
      if (surv.armyId !== army.id) return fail('army-mismatch');
      kept.push({ id: u.id, type: surv.type, hp: surv.hp });
    }
    army.units = kept;
  }

  const attacker = next.armies.find((a) => a.id === ctx.attackerArmyId);
  const defender = next.armies.find((a) => a.id === ctx.defenderArmyId);
  if (!attacker || !defender) return fail('army-missing-after');

  const battleRegion = next.regions.find((r) => r.id === ctx.regionId);
  if (!battleRegion) return fail('region-missing');

  const removeArmy = (id: string) => {
    next.armies = next.armies.filter((a) => a.id !== id);
  };

  // 빈 군단 제거 헬퍼
  const ensureArmyOrRemove = (army: StrategicArmy): StrategicArmy | null => {
    if (army.units.length === 0) {
      removeArmy(army.id);
      return null;
    }
    return army;
  };

  let att = ensureArmyOrRemove(attacker);
  let def = ensureArmyOrRemove(defender);

  if (report.winner === 'draw') {
    // 방어군 유지, 공격 생존은 원래 지역
    if (att) att.regionId = ctx.attackerOriginRegionId;
  } else if (report.winner === attacker.faction) {
    // 공격 승리: 공격군 전투 지역 진입·점령, 방어 생존 퇴각
    if (att) {
      att.regionId = ctx.regionId;
      battleRegion.owner = att.faction;
    }
    if (def) {
      const forbidden = new Set<string>([ctx.regionId]);
      if (att) forbidden.add(att.regionId);
      const retreat = pickRetreatRegion(next, def, ctx.regionId, forbidden);
      if (retreat) def.regionId = retreat;
      else removeArmy(def.id);
    }
  } else if (report.winner === defender.faction) {
    // 방어 승리: 방어 유지, 공격 생존 복귀
    if (att) att.regionId = ctx.attackerOriginRegionId;
  } else {
    return fail('bad-winner');
  }

  // 재조회(제거 반영)
  att = next.armies.find((a) => a.id === ctx.attackerArmyId) ?? null;
  def = next.armies.find((a) => a.id === ctx.defenderArmyId) ?? null;

  // retreatingArmyIds 검증(보고서와 실제 이동 일치 — 정보 필드, 위치는 위 규칙이 정본)
  for (const id of report.retreatingArmyIds) {
    if (id !== ctx.attackerArmyId && id !== ctx.defenderArmyId) return fail('bad-retreat-id');
  }

  delete next.pendingBattle;
  next.phase = 'orders';

  const check = validateStrategicState(next);
  if (!check.ok) return fail(check.reason);

  return { ok: true, value: next };
}

/** 시나리오 문서 정본 digest(동일 context → 동일 digest 검증용). */
export function tacticalScenarioDigest(doc: ScenarioDocumentV1): string {
  return digestString(canonicalJson(doc));
}

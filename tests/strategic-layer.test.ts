// 한 줄 목적: Strategic Layer V0 상태·명령·전투 브리지·저장·digest 계약을 검증한다
import { describe, expect, it } from 'vitest';
import { FACTION_IDS, UNIT_STATS } from '../src/core/data';
import { deserialize, SAVE_VERSION, serialize } from '../src/core/save';
import { newGame } from '../src/core/game';
import { isPlayable, validateScenario } from '../src/core/scenario/validate';
import { stateDigest } from '../src/core/replay';
import type { FactionId, GameState, Unit, UnitTypeId } from '../src/core/types';
import {
  applyTacticalBattleReport,
  buildBattleContext,
  buildTacticalBattleReport,
  buildTacticalScenario,
  prepareStrategicBattle,
  tacticalScenarioDigest,
  validateTacticalBattleReport,
} from '../src/strategic/battle-bridge';
import { strategicStateDigest } from '../src/strategic/digest';
import {
  assertSymmetricNeighbors,
  createStrategicRegions,
  isRegionGraphConnected,
  STRATEGIC_REGION_IDS,
} from '../src/strategic/map';
import { applyStrategicOrder, validateStrategicOrder } from '../src/strategic/orders';
import {
  deserializeStrategic,
  serializeStrategic,
  STRATEGIC_SAVE_KEY,
  STRATEGIC_SAVE_VERSION,
} from '../src/strategic/save';
import { cloneStrategicState, createStrategicState } from '../src/strategic/state';
import type {
  StrategicBattleContext,
  StrategicGameState,
  TacticalBattleReport,
} from '../src/strategic/types';
import { validateStrategicState } from '../src/strategic/validate';

function forceArmyAt(state: StrategicGameState, armyId: string, regionId: string): void {
  const army = state.armies.find((a) => a.id === armyId);
  if (!army) throw new Error('army missing');
  army.regionId = regionId;
}

/** 인접한 적 군단 충돌을 만들기 위해 방어군 지역으로 공격군을 명령한다. */
function startPendingBattle(
  seed = 42,
  human: FactionId = 'azure',
): { state: StrategicGameState; attackerId: string; defenderId: string; toRegion: string } {
  let state = createStrategicState(seed, human);
  const attacker = state.armies.find((a) => a.faction === 'azure' && a.regionId === 'r00')!;
  const defender = state.armies.find((a) => a.faction === 'crimson' && a.regionId === 'r03')!;
  // r01(azure)과 r02(중립)을 거쳐 r03으로 가려면 여러 턴 — 테스트를 위해 방어군을 r01로 이동
  forceArmyAt(state, defender.id, 'r01');
  const moved = applyStrategicOrder(state, {
    type: 'move-army',
    armyId: attacker.id,
    toRegionId: 'r01',
  });
  expect(moved.ok).toBe(true);
  if (!moved.ok) throw new Error(moved.reason);
  state = moved.value;
  expect(state.pendingBattle).toBeDefined();
  return {
    state,
    attackerId: attacker.id,
    defenderId: defender.id,
    toRegion: 'r01',
  };
}

function finishedStateFromContext(
  ctx: StrategicBattleContext,
  opts: {
    winner: FactionId | 'draw';
    /** strategicUnitId → remaining hp; 없으면 손실 */
    survivors: Record<string, number>;
    turn?: number;
  },
): GameState {
  const base = newGame(1, { humanFaction: ctx.humanFaction });
  base.over = true;
  base.winner = opts.winner;
  base.turn = opts.turn ?? 3;
  base.units = [];
  let nextId = 1;
  for (const b of ctx.unitBindings) {
    const hp = opts.survivors[b.strategicUnitId];
    if (hp === undefined) continue;
    const u: Unit = {
      id: nextId++,
      type: b.type,
      faction: b.faction,
      q: 0,
      r: 0,
      hp,
      moved: false,
      attacked: false,
      tag: b.tacticalTag,
    };
    base.units.push(u);
  }
  base.nextUnitId = nextId;
  return base;
}

/** 인간 미참여 AI 대 AI pendingBattle 상태. */
function startAiVsAiBattle(
  seed = 77,
  human: FactionId = 'azure',
): { state: StrategicGameState; ctx: StrategicBattleContext } {
  let state = createStrategicState(seed, human);
  // crimson 공격 → violet 방어 (인간 azure 미참여)
  const attacker = state.armies.find((a) => a.faction === 'crimson' && a.regionId === 'r03')!;
  const defender = state.armies.find((a) => a.faction === 'violet' && a.regionId === 'r08')!;
  // r07(crimson)과 r10(violet) 인접 여부: r03 neighbors — use force positions
  // r02-r06-r10 path; force defender to r07 neighbor of crimson capital side
  // r03 neighbors: r02,r07 (from map)
  forceArmyAt(state, defender.id, 'r07');
  // attacker at r03, move to r07
  forceArmyAt(state, attacker.id, 'r03');
  state.currentFaction = 'crimson';
  const moved = applyStrategicOrder(
    state,
    { type: 'move-army', armyId: attacker.id, toRegionId: 'r07' },
    'crimson',
  );
  expect(moved.ok).toBe(true);
  if (!moved.ok) throw new Error(moved.reason);
  state = moved.value;
  expect(state.pendingBattle).toBeDefined();
  return { state, ctx: state.pendingBattle! };
}

function allSurviveHp(ctx: StrategicBattleContext): Record<string, number> {
  const survivors: Record<string, number> = {};
  for (const b of ctx.unitBindings) survivors[b.strategicUnitId] = b.startingHp;
  return survivors;
}

function makeValidReport(
  state: StrategicGameState,
  winner: FactionId | 'draw',
  survivors?: Record<string, number>,
): TacticalBattleReport {
  const ctx = state.pendingBattle!;
  const surv = survivors ?? allSurviveHp(ctx);
  const fin = finishedStateFromContext(ctx, { winner, survivors: surv });
  const report = buildTacticalBattleReport(ctx, fin);
  if (!report.ok) throw new Error(report.reason);
  return report.value;
}

describe('Strategic Layer V0 — 지도', () => {
  it('12지역 연결·대칭·중복·자기루프 없음', () => {
    const regions = createStrategicRegions();
    expect(regions).toHaveLength(12);
    expect(STRATEGIC_REGION_IDS).toHaveLength(12);
    expect(isRegionGraphConnected(regions)).toBe(true);
    expect(assertSymmetricNeighbors(regions)).toBe(true);
    for (const r of regions) {
      expect(r.neighbors.includes(r.id)).toBe(false);
      expect(new Set(r.neighbors).size).toBe(r.neighbors.length);
    }
  });

  it('수도 3·초기 소유 9·중립 3', () => {
    const regions = createStrategicRegions();
    const capitals = regions.filter((r) => r.settlement === 'capital');
    expect(capitals).toHaveLength(3);
    const owners = { azure: 0, crimson: 0, violet: 0, neutral: 0 };
    for (const r of regions) {
      if (r.owner === null) owners.neutral++;
      else owners[r.owner]++;
    }
    expect(owners.azure).toBe(3);
    expect(owners.crimson).toBe(3);
    expect(owners.violet).toBe(3);
    expect(owners.neutral).toBe(3);
    expect(new Set(capitals.map((c) => c.owner))).toEqual(
      new Set(['azure', 'crimson', 'violet']),
    );
  });
});

describe('Strategic Layer V0 — 초기 상태', () => {
  it('시작 군단 6·유닛 ID 중복 0·군단당 4~6', () => {
    const state = createStrategicState(7, 'azure');
    expect(state.armies).toHaveLength(6);
    const unitIds = state.armies.flatMap((a) => a.units.map((u) => u.id));
    expect(new Set(unitIds).size).toBe(unitIds.length);
    for (const a of state.armies) {
      expect(a.units.length).toBeGreaterThanOrEqual(4);
      expect(a.units.length).toBeLessThanOrEqual(6);
    }
    expect(validateStrategicState(state).ok).toBe(true);
  });

  it('동일 seed 상태 결정론', () => {
    const a = createStrategicState(99, 'crimson');
    const b = createStrategicState(99, 'crimson');
    expect(strategicStateDigest(a)).toBe(strategicStateDigest(b));
    expect(serializeStrategic(a)).toBe(serializeStrategic(b));
  });

  it('다른 seed에서 battle seed 또는 digest 변함', () => {
    const a = createStrategicState(1, 'azure');
    const b = createStrategicState(2, 'azure');
    const digestsDiffer = strategicStateDigest(a) !== strategicStateDigest(b);
    // 충돌 context의 battleSeed도 seed에 의존
    forceArmyAt(a, 'army-crimson-0', 'r01');
    forceArmyAt(b, 'army-crimson-0', 'r01');
    const ca = buildBattleContext(a, {
      attackerArmyId: 'army-azure-0',
      defenderArmyId: 'army-crimson-0',
      regionId: 'r01',
      attackerOriginRegionId: 'r00',
    });
    const cb = buildBattleContext(b, {
      attackerArmyId: 'army-azure-0',
      defenderArmyId: 'army-crimson-0',
      regionId: 'r01',
      attackerOriginRegionId: 'r00',
    });
    expect(ca.ok && cb.ok).toBe(true);
    if (!ca.ok || !cb.ok) return;
    expect(digestsDiffer || ca.value.battleSeed !== cb.value.battleSeed).toBe(true);
  });
});

describe('Strategic Layer V0 — 명령', () => {
  it('비인접 이동 거절', () => {
    const state = createStrategicState(1, 'azure');
    const army = state.armies.find((a) => a.faction === 'azure')!;
    const r = validateStrategicOrder(state, {
      type: 'move-army',
      armyId: army.id,
      toRegionId: 'r11',
    });
    expect(r.ok).toBe(false);
  });

  it('다른 세력 군단 명령 거절', () => {
    const state = createStrategicState(1, 'azure');
    const enemy = state.armies.find((a) => a.faction === 'crimson')!;
    const r = validateStrategicOrder(state, { type: 'hold-army', armyId: enemy.id }, 'azure');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('not-own-army');
  });

  it('동일 군단 중복 명령 거절', () => {
    let state = createStrategicState(1, 'azure');
    const army = state.armies.find((a) => a.id === 'army-azure-0')!;
    const first = applyStrategicOrder(state, { type: 'hold-army', armyId: army.id });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.value;
    const second = applyStrategicOrder(state, { type: 'hold-army', armyId: army.id });
    expect(second.ok).toBe(false);
  });

  it('적 군단 충돌 시 pending battle 생성', () => {
    const { state, attackerId, defenderId } = startPendingBattle();
    expect(state.phase).toBe('battle');
    expect(state.pendingBattle?.attackerArmyId).toBe(attackerId);
    expect(state.pendingBattle?.defenderArmyId).toBe(defenderId);
    // 전투 중 추가 명령 거절
    const blocked = applyStrategicOrder(state, {
      type: 'hold-army',
      armyId: 'army-azure-1',
    });
    expect(blocked.ok).toBe(false);
  });

  it('빈 지역 진입 시 즉시 점령', () => {
    const state = createStrategicState(1, 'azure');
    const army = state.armies.find((a) => a.id === 'army-azure-0')!;
    // r00 → r01은 자군 지역. r01의 군단을 치우고 r00에서 r01... actually r00 neighbors r01,r04
    // r01 is azure owned. Move azure-0 to r01 (empty of armies if army only at r00 and r04)
    expect(state.armies.filter((a) => a.regionId === 'r01')).toHaveLength(0);
    const next = applyStrategicOrder(state, {
      type: 'move-army',
      armyId: army.id,
      toRegionId: 'r01',
    });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.value.pendingBattle).toBeUndefined();
    expect(next.value.armies.find((a) => a.id === army.id)?.regionId).toBe('r01');
    // 중립 r02로
    const reset = cloneStrategicState(next.value);
    for (const a of reset.armies) a.moved = false;
    const toNeutral = applyStrategicOrder(reset, {
      type: 'move-army',
      armyId: army.id,
      toRegionId: 'r02',
    });
    expect(toNeutral.ok).toBe(true);
    if (!toNeutral.ok) return;
    expect(toNeutral.value.regions.find((r) => r.id === 'r02')?.owner).toBe('azure');
  });
});

describe('Strategic Layer V0 — 전투 브리지', () => {
  it('context unit binding 1:1·시작 HP 보존·battleId 결정론', () => {
    const { state } = startPendingBattle(11);
    const ctx = state.pendingBattle!;
    const unitCount =
      state.armies.find((a) => a.id === ctx.attackerArmyId)!.units.length +
      state.armies.find((a) => a.id === ctx.defenderArmyId)!.units.length;
    expect(ctx.unitBindings).toHaveLength(unitCount);
    const ids = ctx.unitBindings.map((b) => b.strategicUnitId);
    expect(new Set(ids).size).toBe(ids.length);
    const tags = ctx.unitBindings.map((b) => b.tacticalTag);
    expect(new Set(tags).size).toBe(tags.length);

    for (const b of ctx.unitBindings) {
      const army = state.armies.find((a) => a.id === b.armyId)!;
      const u = army.units.find((x) => x.id === b.strategicUnitId)!;
      expect(b.startingHp).toBe(u.hp);
      expect(b.type).toBe(u.type);
    }

    const again = buildBattleContext(state, {
      attackerArmyId: ctx.attackerArmyId,
      defenderArmyId: ctx.defenderArmyId,
      regionId: ctx.regionId,
      attackerOriginRegionId: ctx.attackerOriginRegionId,
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.battleId).toBe(ctx.battleId);
    expect(again.value.battleSeed).toBe(ctx.battleSeed);
  });

  it('생성 전술 시나리오 기존 validator PASS·HP 보존·동일 digest', () => {
    const { state } = startPendingBattle(21);
    const ctx = state.pendingBattle!;
    const doc1 = buildTacticalScenario(ctx, state);
    const doc2 = buildTacticalScenario(ctx, state);
    expect(doc1.ok && doc2.ok).toBe(true);
    if (!doc1.ok || !doc2.ok) return;
    const issues = validateScenario(doc1.value);
    expect(isPlayable(issues)).toBe(true);
    expect(doc1.value.board.cols).toBe(8);
    expect(doc1.value.board.rows).toBe(8);
    expect(doc1.value.rules.uniqueUnits).toBe(true);
    expect(doc1.value.rules.doctrines).toBe(true);
    expect(doc1.value.rules.maxTurns).toBe(10);
    expect(doc1.value.board.tiles.some((t) => t.building)).toBe(false);

    for (const b of ctx.unitBindings) {
      const u = doc1.value.units.find((x) => x.tag === b.tacticalTag);
      expect(u).toBeDefined();
      expect(u!.hp).toBe(b.startingHp);
      expect(u!.type).toBe(b.type);
    }
    expect(tacticalScenarioDigest(doc1.value)).toBe(tacticalScenarioDigest(doc2.value));
  });

  it('미종료 전투 report 거절', () => {
    const { state } = startPendingBattle(3);
    const ctx = state.pendingBattle!;
    const live = newGame(1);
    live.over = false;
    const r = buildTacticalBattleReport(ctx, live);
    expect(r.ok).toBe(false);
  });

  it('survivor/loss 완전 분할·변조 거절', () => {
    const { state } = startPendingBattle(5);
    const ctx = state.pendingBattle!;
    const allIds = ctx.unitBindings.map((b) => b.strategicUnitId);
    const survivors: Record<string, number> = {};
    for (const id of allIds.slice(0, Math.ceil(allIds.length / 2))) {
      const b = ctx.unitBindings.find((x) => x.strategicUnitId === id)!;
      survivors[id] = Math.max(1, b.startingHp - 1);
    }
    const fin = finishedStateFromContext(ctx, {
      winner: ctx.unitBindings[0].faction,
      survivors,
    });
    const report = buildTacticalBattleReport(ctx, fin);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.survivingUnits.length + report.value.losses.length).toBe(
      ctx.unitBindings.length,
    );

    // 알 수 없는 tag
    const badTag = finishedStateFromContext(ctx, { winner: 'draw', survivors: {} });
    badTag.units.push({
      id: 999,
      type: 'infantry',
      faction: 'azure',
      q: 0,
      r: 0,
      hp: 5,
      moved: false,
      attacked: false,
      tag: 'not-a-real-tag',
    });
    badTag.over = true;
    badTag.winner = 'draw';
    expect(buildTacticalBattleReport(ctx, badTag).ok).toBe(false);

    // HP 초과
    const overHp: Record<string, number> = {};
    const b0 = ctx.unitBindings[0];
    overHp[b0.strategicUnitId] = UNIT_STATS[b0.type].hp + 5;
    const finOver = finishedStateFromContext(ctx, { winner: b0.faction, survivors: overHp });
    // 나머지 전부 손실로 두고 승자 세력
    expect(buildTacticalBattleReport(ctx, finOver).ok).toBe(false);
  });

  it('공격 승리 반영·퇴각 결정론', () => {
    const { state } = startPendingBattle(8);
    const ctx = state.pendingBattle!;
    const attFaction = state.armies.find((a) => a.id === ctx.attackerArmyId)!.faction;
    const survivors: Record<string, number> = {};
    for (const b of ctx.unitBindings) {
      if (b.faction === attFaction) survivors[b.strategicUnitId] = b.startingHp;
      // 방어 1기만 생존
    }
    const defBinding = ctx.unitBindings.find((b) => b.faction !== attFaction)!;
    survivors[defBinding.strategicUnitId] = 3;

    const fin = finishedStateFromContext(ctx, { winner: attFaction, survivors });
    const report = buildTacticalBattleReport(ctx, fin);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    const applied = applyTacticalBattleReport(state, report.value);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.pendingBattle).toBeUndefined();
    expect(applied.value.phase).toBe('orders');
    const att = applied.value.armies.find((a) => a.id === ctx.attackerArmyId)!;
    expect(att.regionId).toBe(ctx.regionId);
    expect(applied.value.regions.find((r) => r.id === ctx.regionId)?.owner).toBe(attFaction);
    const def = applied.value.armies.find((a) => a.id === ctx.defenderArmyId);
    if (def) {
      expect(def.regionId).not.toBe(ctx.regionId);
      // 동일 보고 재적용 → 결정론적 퇴각 위치 고정
      const again = applyTacticalBattleReport(applied.value, report.value);
      expect(again.ok).toBe(false);
    }
    // 동일 초기 상태에서 두 번 적용하면 같은 digest
    const applied2 = applyTacticalBattleReport(state, report.value);
    expect(applied2.ok).toBe(true);
    if (!applied2.ok) return;
    expect(strategicStateDigest(applied.value)).toBe(strategicStateDigest(applied2.value));
  });

  it('방어 승리 반영', () => {
    const { state } = startPendingBattle(9);
    const ctx = state.pendingBattle!;
    const defFaction = state.armies.find((a) => a.id === ctx.defenderArmyId)!.faction;
    const survivors: Record<string, number> = {};
    for (const b of ctx.unitBindings) {
      if (b.faction === defFaction) survivors[b.strategicUnitId] = b.startingHp;
    }
    const fin = finishedStateFromContext(ctx, { winner: defFaction, survivors });
    const report = buildTacticalBattleReport(ctx, fin);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    const applied = applyTacticalBattleReport(state, report.value);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const att = applied.value.armies.find((a) => a.id === ctx.attackerArmyId);
    if (att) expect(att.regionId).toBe(ctx.attackerOriginRegionId);
    const def = applied.value.armies.find((a) => a.id === ctx.defenderArmyId)!;
    expect(def.regionId).toBe(ctx.regionId);
    // 방어 승리 시 지역 소유는 전투 전 값을 유지
    expect(applied.value.regions.find((r) => r.id === ctx.regionId)?.owner).toBe(
      state.regions.find((r) => r.id === ctx.regionId)?.owner,
    );
  });

  it('draw 반영', () => {
    const { state } = startPendingBattle(10);
    const ctx = state.pendingBattle!;
    const survivors: Record<string, number> = {};
    for (const b of ctx.unitBindings) survivors[b.strategicUnitId] = Math.max(1, b.startingHp - 2);
    const fin = finishedStateFromContext(ctx, { winner: 'draw', survivors });
    const report = buildTacticalBattleReport(ctx, fin);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.winner).toBe('draw');
    const applied = applyTacticalBattleReport(state, report.value);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const att = applied.value.armies.find((a) => a.id === ctx.attackerArmyId)!;
    expect(att.regionId).toBe(ctx.attackerOriginRegionId);
  });

  it('다른 battleId 보고서 적용 거절', () => {
    const { state } = startPendingBattle(12);
    const ctx = state.pendingBattle!;
    const survivors: Record<string, number> = {};
    for (const b of ctx.unitBindings) survivors[b.strategicUnitId] = b.startingHp;
    const fin = finishedStateFromContext(ctx, { winner: 'draw', survivors });
    const report = buildTacticalBattleReport(ctx, fin);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    const bad: TacticalBattleReport = { ...report.value, battleId: 'deadbeefdeadbeef' };
    expect(applyTacticalBattleReport(state, bad).ok).toBe(false);
  });
});

describe('Strategic Layer V0 — 저장·digest', () => {
  it('전략 저장 왕복·digest 동일', () => {
    const state = createStrategicState(33, 'violet');
    const raw = serializeStrategic(state);
    const back = deserializeStrategic(raw);
    expect(back).not.toBeNull();
    expect(strategicStateDigest(state)).toBe(strategicStateDigest(back!));
    expect(STRATEGIC_SAVE_VERSION).toBe(1);
    expect(STRATEGIC_SAVE_KEY).toBe('three-crowns-strategy-save');
  });

  it('손상 전략 저장 거절', () => {
    expect(deserializeStrategic('not-json')).toBeNull();
    expect(deserializeStrategic(JSON.stringify({ version: 99, state: {} }))).toBeNull();
    const state = createStrategicState(1, 'azure');
    const broken = JSON.parse(serializeStrategic(state));
    broken.state.regions[0].owner = 'nope';
    expect(deserializeStrategic(JSON.stringify(broken))).toBeNull();
    broken.state = JSON.parse(serializeStrategic(state)).state;
    broken.state.armies[0].units[0].hp = 9999;
    expect(deserializeStrategic(JSON.stringify(broken))).toBeNull();
  });

  it('기존 전술 저장 회귀 PASS', () => {
    const g = newGame(123, { humanFaction: 'azure' });
    const raw = serialize(g);
    const back = deserialize(raw);
    expect(back).not.toBeNull();
    expect(SAVE_VERSION).toBe(4);
    expect(stateDigest(g)).toBe(stateDigest(back!));
  });

  it('strategic digest 규칙', () => {
    const s1 = createStrategicState(50, 'azure');
    const s2 = createStrategicState(50, 'azure');
    expect(strategicStateDigest(s1)).toBe(strategicStateDigest(s2));

    // 배열 순서 섞어도 정본 정렬로 동일
    const shuffled = cloneStrategicState(s1);
    shuffled.armies = [...shuffled.armies].reverse();
    shuffled.regions = [...shuffled.regions].reverse();
    expect(strategicStateDigest(s1)).toBe(strategicStateDigest(shuffled));

    // 유닛 HP 1 변경
    const hp = cloneStrategicState(s1);
    hp.armies[0].units[0].hp = Math.max(1, hp.armies[0].units[0].hp - 1);
    if (hp.armies[0].units[0].hp === s1.armies[0].units[0].hp) {
      hp.armies[0].units[0].hp = Math.min(
        UNIT_STATS[hp.armies[0].units[0].type].hp,
        hp.armies[0].units[0].hp + 1,
      );
    }
    expect(strategicStateDigest(hp)).not.toBe(strategicStateDigest(s1));

    // 지역 owner 변경
    const own = cloneStrategicState(s1);
    const neutral = own.regions.find((r) => r.owner === null)!;
    neutral.owner = 'azure';
    expect(strategicStateDigest(own)).not.toBe(strategicStateDigest(s1));

    // pending battle 변경
    const { state: battling } = startPendingBattle(50);
    expect(strategicStateDigest(battling)).not.toBe(strategicStateDigest(s1));
  });
});

// ---------------------------------------------------------------------------
// Phase 8-0 fail-closed 정합 수리
// ---------------------------------------------------------------------------

describe('Strategic Layer V0 — 전투 분류 (A)', () => {
  it('인간 공격군 전투 → human-tactical', () => {
    const { state } = startPendingBattle(101, 'azure');
    const prep = prepareStrategicBattle(state);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    expect(prep.value.kind).toBe('human-tactical');
    if (prep.value.kind !== 'human-tactical') return;
    const humanF = prep.value.scenario.factions.find((f) => f.id === 'azure')!;
    expect(humanF.controller).toBe('human');
    expect(humanF.active).toBe(true);
    for (const f of prep.value.scenario.factions) {
      if (f.id === 'azure') continue;
      if (f.active) expect(f.controller).toBe('ai');
      else expect(f.active).toBe(false);
    }
  });

  it('인간 방어군 전투 → human-tactical·인간만 human controller', () => {
    let state = createStrategicState(102, 'azure');
    const defender = state.armies.find((a) => a.id === 'army-azure-0')!;
    const attacker = state.armies.find((a) => a.id === 'army-crimson-0')!;
    forceArmyAt(state, defender.id, 'r01');
    forceArmyAt(state, attacker.id, 'r02');
    // r02→r01 인접, 인간이 방어
    state.currentFaction = 'crimson';
    const moved = applyStrategicOrder(
      state,
      { type: 'move-army', armyId: attacker.id, toRegionId: 'r01' },
      'crimson',
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    state = moved.value;
    const prep = prepareStrategicBattle(state);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    expect(prep.value.kind).toBe('human-tactical');
    if (prep.value.kind !== 'human-tactical') return;
    const azure = prep.value.scenario.factions.find((f) => f.id === 'azure')!;
    const crimson = prep.value.scenario.factions.find((f) => f.id === 'crimson')!;
    expect(azure.controller).toBe('human');
    expect(crimson.controller).toBe('ai');
    expect(prep.value.scenario.factions.find((f) => f.id === 'violet')!.active).toBe(false);
  });

  it('AI 대 AI 충돌 → auto-resolve-required', () => {
    const { state, ctx } = startAiVsAiBattle(103, 'azure');
    expect(ctx.humanFaction).toBe('azure');
    const att = state.armies.find((a) => a.id === ctx.attackerArmyId)!;
    const def = state.armies.find((a) => a.id === ctx.defenderArmyId)!;
    expect(att.faction).not.toBe('azure');
    expect(def.faction).not.toBe('azure');

    const prep = prepareStrategicBattle(state);
    expect(prep.ok).toBe(true);
    if (!prep.ok) return;
    expect(prep.value.kind).toBe('auto-resolve-required');
    if (prep.value.kind !== 'auto-resolve-required') return;
    expect(prep.value.context.battleId).toBe(ctx.battleId);
  });

  it('AI 대 AI에서 ScenarioDocument 직접 생성 거절·임시 human 부여 없음', () => {
    const { state, ctx } = startAiVsAiBattle(104, 'azure');
    const doc = buildTacticalScenario(ctx, state);
    expect(doc.ok).toBe(false);
    if (doc.ok) return;
    expect(doc.reason).toBe('human-not-participant');
  });
});

describe('Strategic Layer V0 — 예상치 못한 전술 유닛 (B)', () => {
  it('무태그 살아 있는 유닛 → report 거절', () => {
    const { state } = startPendingBattle(201);
    const ctx = state.pendingBattle!;
    const fin = finishedStateFromContext(ctx, {
      winner: 'draw',
      survivors: allSurviveHp(ctx),
    });
    fin.units.push({
      id: 9990,
      type: 'infantry',
      faction: 'azure',
      q: 1,
      r: 1,
      hp: 5,
      moved: false,
      attacked: false,
      // tag 없음
    });
    const r = buildTacticalBattleReport(ctx, fin);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unexpected-untagged-unit');
  });

  it('알 수 없는 tag → report 거절', () => {
    const { state } = startPendingBattle(202);
    const ctx = state.pendingBattle!;
    const fin = finishedStateFromContext(ctx, {
      winner: 'draw',
      survivors: allSurviveHp(ctx),
    });
    fin.units[0].tag = 'forged-tag';
    expect(buildTacticalBattleReport(ctx, fin).ok).toBe(false);
  });

  it('중복 tag → report 거절', () => {
    const { state } = startPendingBattle(203);
    const ctx = state.pendingBattle!;
    const fin = finishedStateFromContext(ctx, {
      winner: 'draw',
      survivors: allSurviveHp(ctx),
    });
    if (fin.units.length < 2) return;
    fin.units[1].tag = fin.units[0].tag;
    expect(buildTacticalBattleReport(ctx, fin).ok).toBe(false);
  });

  it('binding과 병종·세력이 다른 유닛 → 거절', () => {
    const { state } = startPendingBattle(204);
    const ctx = state.pendingBattle!;
    const fin = finishedStateFromContext(ctx, {
      winner: 'draw',
      survivors: allSurviveHp(ctx),
    });
    const otherType = (['infantry', 'archer', 'cavalry'] as UnitTypeId[]).find(
      (t) => t !== fin.units[0].type,
    )!;
    fin.units[0].type = otherType;
    expect(buildTacticalBattleReport(ctx, fin).ok).toBe(false);

    const fin2 = finishedStateFromContext(ctx, {
      winner: 'draw',
      survivors: allSurviveHp(ctx),
    });
    fin2.units[0].faction = fin2.units[0].faction === 'azure' ? 'crimson' : 'azure';
    expect(buildTacticalBattleReport(ctx, fin2).ok).toBe(false);
  });

  it('정상 binding 유닛만 있는 전투 → report 성공', () => {
    const { state } = startPendingBattle(205);
    const ctx = state.pendingBattle!;
    const report = buildTacticalBattleReport(
      ctx,
      finishedStateFromContext(ctx, { winner: 'draw', survivors: allSurviveHp(ctx) }),
    );
    expect(report.ok).toBe(true);
  });
});

describe('Strategic Layer V0 — 변조 보고서 (C)', () => {
  function baseApplyCase(seed: number) {
    const { state } = startPendingBattle(seed);
    const ctx = state.pendingBattle!;
    const attFaction = state.armies.find((a) => a.id === ctx.attackerArmyId)!.faction;
    const report = makeValidReport(state, attFaction);
    return { state, ctx, report, attFaction };
  }

  it('survivor type/faction/armyId 변조 → apply 거절', () => {
    const { state, report } = baseApplyCase(301);
    const badType = {
      ...report,
      survivingUnits: report.survivingUnits.map((s, i) =>
        i === 0
          ? {
              ...s,
              type: (s.type === 'infantry' ? 'archer' : 'infantry') as UnitTypeId,
            }
          : s,
      ),
    };
    expect(validateTacticalBattleReport(state, badType).ok).toBe(false);
    expect(applyTacticalBattleReport(state, badType).ok).toBe(false);

    const badFac = {
      ...report,
      survivingUnits: report.survivingUnits.map((s, i) =>
        i === 0
          ? { ...s, faction: (s.faction === 'azure' ? 'crimson' : 'azure') as FactionId }
          : s,
      ),
    };
    expect(applyTacticalBattleReport(state, badFac).ok).toBe(false);

    const badArmy = {
      ...report,
      survivingUnits: report.survivingUnits.map((s, i) =>
        i === 0 ? { ...s, armyId: 'forged-army' } : s,
      ),
    };
    expect(applyTacticalBattleReport(state, badArmy).ok).toBe(false);
  });

  it('loss type/faction/armyId 변조 → apply 거절', () => {
    const { state } = startPendingBattle(302);
    const ctx = state.pendingBattle!;
    const attFaction = state.armies.find((a) => a.id === ctx.attackerArmyId)!.faction;
    // 절반만 생존 → loss 존재
    const survivors: Record<string, number> = {};
    for (const b of ctx.unitBindings) {
      if (b.faction === attFaction) survivors[b.strategicUnitId] = b.startingHp;
    }
    const report = makeValidReport(state, attFaction, survivors);
    expect(report.losses.length).toBeGreaterThan(0);

    const badType = {
      ...report,
      losses: report.losses.map((l, i) =>
        i === 0
          ? {
              ...l,
              type: (l.type === 'infantry' ? 'archer' : 'infantry') as UnitTypeId,
            }
          : l,
      ),
    };
    expect(applyTacticalBattleReport(state, badType).ok).toBe(false);

    const badFac = {
      ...report,
      losses: report.losses.map((l, i) =>
        i === 0
          ? { ...l, faction: (l.faction === 'azure' ? 'crimson' : 'azure') as FactionId }
          : l,
      ),
    };
    expect(applyTacticalBattleReport(state, badFac).ok).toBe(false);

    const badArmy = {
      ...report,
      losses: report.losses.map((l, i) => (i === 0 ? { ...l, armyId: 'x' } : l)),
    };
    expect(applyTacticalBattleReport(state, badArmy).ok).toBe(false);
  });

  it('survivor HP 최대치·startingHp 초과 거절', () => {
    const { state } = startPendingBattle(303);
    const ctx = state.pendingBattle!;
    const b0 = ctx.unitBindings[0];
    const overMax: Record<string, number> = { [b0.strategicUnitId]: UNIT_STATS[b0.type].hp + 1 };
    expect(
      buildTacticalBattleReport(
        ctx,
        finishedStateFromContext(ctx, { winner: b0.faction, survivors: overMax }),
      ).ok,
    ).toBe(false);

    // startingHp 초과: 유닛 HP를 낮춘 뒤 context를 재구축하고 보고서만 회복 주장
    const stateLow = cloneStrategicState(state);
    const lowArmy = stateLow.armies.find((a) => a.id === b0.armyId)!;
    const lowUnit = lowArmy.units.find((u) => u.id === b0.strategicUnitId)!;
    const lowered = Math.max(1, lowUnit.hp - 2);
    lowUnit.hp = lowered;
    const pb = stateLow.pendingBattle!;
    const rebuilt = buildBattleContext(stateLow, {
      attackerArmyId: pb.attackerArmyId,
      defenderArmyId: pb.defenderArmyId,
      regionId: pb.regionId,
      attackerOriginRegionId: pb.attackerOriginRegionId,
    });
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    stateLow.pendingBattle = rebuilt.value;
    expect(validateStrategicState(stateLow).ok).toBe(true);

    const lowBind = rebuilt.value.unitBindings.find((b) => b.strategicUnitId === b0.strategicUnitId)!;
    const forged: TacticalBattleReport = {
      schemaVersion: 1,
      battleId: rebuilt.value.battleId,
      winner: lowBind.faction,
      survivingUnits: [
        {
          strategicUnitId: lowBind.strategicUnitId,
          armyId: lowBind.armyId,
          faction: lowBind.faction,
          type: lowBind.type,
          hp: lowBind.startingHp + 1,
        },
      ],
      losses: rebuilt.value.unitBindings
        .filter((b) => b.strategicUnitId !== lowBind.strategicUnitId)
        .map((b) => ({
          strategicUnitId: b.strategicUnitId,
          armyId: b.armyId,
          faction: b.faction,
          type: b.type,
        })),
      retreatingArmyIds: [],
      turns: 3,
      scoreByFaction: { azure: 0, crimson: 0, violet: 0 },
    };
    // maxHp 이내이면서 startingHp 초과 → fail-closed
    if (forged.survivingUnits[0].hp <= UNIT_STATS[lowBind.type].hp) {
      expect(validateTacticalBattleReport(stateLow, forged).ok).toBe(false);
      expect(applyTacticalBattleReport(stateLow, forged).ok).toBe(false);
    }
  });

  it('survivor/loss 중복·binding 누락·context 외 유닛 거절', () => {
    const { state, report } = baseApplyCase(304);
    const dup = {
      ...report,
      survivingUnits: [...report.survivingUnits, report.survivingUnits[0]],
    };
    expect(applyTacticalBattleReport(state, dup).ok).toBe(false);

    const missing = {
      ...report,
      survivingUnits: report.survivingUnits.slice(1),
      losses: report.losses,
    };
    expect(applyTacticalBattleReport(state, missing).ok).toBe(false);

    const extra = {
      ...report,
      survivingUnits: [
        ...report.survivingUnits,
        {
          strategicUnitId: 'ghost-unit',
          armyId: report.survivingUnits[0].armyId,
          faction: report.survivingUnits[0].faction,
          type: report.survivingUnits[0].type,
          hp: 1,
        },
      ],
    };
    expect(applyTacticalBattleReport(state, extra).ok).toBe(false);
  });

  it('turns·scoreByFaction·retreatingArmyIds 검증', () => {
    const { state, report, ctx } = (() => {
      const x = baseApplyCase(305);
      return { state: x.state, report: x.report, ctx: x.ctx };
    })();

    expect(
      validateTacticalBattleReport(state, { ...report, turns: 0 }).ok,
    ).toBe(false);
    expect(
      validateTacticalBattleReport(state, { ...report, turns: 1.5 }).ok,
    ).toBe(false);
    expect(
      validateTacticalBattleReport(state, { ...report, turns: '3' as unknown as number }).ok,
    ).toBe(false);

    const noScore = {
      ...report,
      scoreByFaction: { azure: 1, crimson: 1 } as Record<FactionId, number>,
    };
    expect(validateTacticalBattleReport(state, noScore).ok).toBe(false);

    const nanScore = {
      ...report,
      scoreByFaction: { azure: NaN, crimson: 0, violet: 0 },
    };
    expect(validateTacticalBattleReport(state, nanScore).ok).toBe(false);

    const negScore = {
      ...report,
      scoreByFaction: { azure: -1, crimson: 0, violet: 0 },
    };
    expect(validateTacticalBattleReport(state, negScore).ok).toBe(false);

    // retreatingArmyIds 누락: 공격 승리+방어 생존 시 방어 퇴각 필수
    const defSurv: Record<string, number> = {};
    const attFaction = state.armies.find((a) => a.id === ctx.attackerArmyId)!.faction;
    for (const b of ctx.unitBindings) {
      if (b.faction === attFaction) defSurv[b.strategicUnitId] = b.startingHp;
    }
    const defB = ctx.unitBindings.find((b) => b.faction !== attFaction)!;
    defSurv[defB.strategicUnitId] = 2;
    const withRetreat = makeValidReport(state, attFaction, defSurv);
    expect(withRetreat.retreatingArmyIds).toContain(ctx.defenderArmyId);
    expect(
      validateTacticalBattleReport(state, { ...withRetreat, retreatingArmyIds: [] }).ok,
    ).toBe(false);
    expect(
      validateTacticalBattleReport(state, {
        ...withRetreat,
        retreatingArmyIds: [ctx.defenderArmyId, ctx.attackerArmyId],
      }).ok,
    ).toBe(false);
    expect(
      validateTacticalBattleReport(state, {
        ...withRetreat,
        retreatingArmyIds: [ctx.defenderArmyId, ctx.defenderArmyId],
      }).ok,
    ).toBe(false);
  });

  it('정상 보고서 적용 시 병종 정본 유지·survivor HP만 변경', () => {
    const { state } = startPendingBattle(306);
    const ctx = state.pendingBattle!;
    const attFaction = state.armies.find((a) => a.id === ctx.attackerArmyId)!.faction;
    const survivors: Record<string, number> = {};
    const originals = new Map<string, UnitTypeId>();
    for (const b of ctx.unitBindings) {
      originals.set(b.strategicUnitId, b.type);
      if (b.faction === attFaction) {
        survivors[b.strategicUnitId] = Math.max(1, b.startingHp - 1);
      }
    }
    const report = makeValidReport(state, attFaction, survivors);
    // 보고서 type을 변조해도 apply가 원본 type을 쓰는지 — 먼저 정상 report
    const applied = applyTacticalBattleReport(state, report);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    for (const army of applied.value.armies) {
      for (const u of army.units) {
        if (originals.has(u.id)) {
          expect(u.type).toBe(originals.get(u.id));
          if (survivors[u.id] !== undefined) expect(u.hp).toBe(survivors[u.id]);
        }
      }
    }
  });
});

describe('Strategic Layer V0 — pendingBattle 무결성 (D)', () => {
  function battlingClone(seed = 401) {
    const { state } = startPendingBattle(seed);
    return cloneStrategicState(state);
  }

  it('strategicTurn·humanFaction 불일치 → validator 실패·deserialize null', () => {
    const s = battlingClone();
    s.pendingBattle!.strategicTurn = s.turn + 1;
    expect(validateStrategicState(s).ok).toBe(false);
    expect(deserializeStrategic(serializeStrategic(s))).toBeNull();

    const s2 = battlingClone(402);
    s2.pendingBattle!.humanFaction = s2.humanFaction === 'azure' ? 'crimson' : 'azure';
    // humanFaction mismatch with state — also battleId may still match
    expect(validateStrategicState(s2).ok).toBe(false);
    expect(deserializeStrategic(JSON.stringify({ version: 1, state: s2 }))).toBeNull();
  });

  it('공격군 origin·방어군 region 위치 불일치 → 실패', () => {
    const s = battlingClone(403);
    const att = s.armies.find((a) => a.id === s.pendingBattle!.attackerArmyId)!;
    att.regionId = s.pendingBattle!.regionId; // 잘못된 위치
    expect(validateStrategicState(s).ok).toBe(false);

    const s2 = battlingClone(404);
    const def = s2.armies.find((a) => a.id === s2.pendingBattle!.defenderArmyId)!;
    def.regionId = s2.pendingBattle!.attackerOriginRegionId;
    expect(validateStrategicState(s2).ok).toBe(false);
  });

  it('비인접 origin/region·동일 세력 → 실패', () => {
    const s = battlingClone(405);
    s.pendingBattle!.attackerOriginRegionId = 'r11'; // r01과 비인접
    // 공격군도 r11으로 맞춤
    const att = s.armies.find((a) => a.id === s.pendingBattle!.attackerArmyId)!;
    att.regionId = 'r11';
    expect(validateStrategicState(s).ok).toBe(false);

    const s2 = battlingClone(406);
    const def = s2.armies.find((a) => a.id === s2.pendingBattle!.defenderArmyId)!;
    const att2 = s2.armies.find((a) => a.id === s2.pendingBattle!.attackerArmyId)!;
    def.faction = att2.faction;
    // bindings도 맞추면 same faction 검사에 걸림
    expect(validateStrategicState(s2).ok).toBe(false);
  });

  it('battleId·battleSeed 변조 → 실패', () => {
    const s = battlingClone(407);
    s.pendingBattle!.battleId = '0'.repeat(64);
    expect(validateStrategicState(s).ok).toBe(false);
    expect(deserializeStrategic(JSON.stringify({ version: 1, state: s }))).toBeNull();

    const s2 = battlingClone(408);
    s2.pendingBattle!.battleSeed = (s2.pendingBattle!.battleSeed + 1) >>> 0;
    expect(validateStrategicState(s2).ok).toBe(false);
    expect(deserializeStrategic(JSON.stringify({ version: 1, state: s2 }))).toBeNull();
  });

  it('binding armyId/faction/type/startingHp 변조 → 실패', () => {
    const s = battlingClone(409);
    s.pendingBattle!.unitBindings[0].armyId = 'forged';
    expect(validateStrategicState(s).ok).toBe(false);

    const s2 = battlingClone(410);
    s2.pendingBattle!.unitBindings[0].faction =
      s2.pendingBattle!.unitBindings[0].faction === 'azure' ? 'violet' : 'azure';
    expect(validateStrategicState(s2).ok).toBe(false);

    const s3 = battlingClone(411);
    const t = s3.pendingBattle!.unitBindings[0].type;
    s3.pendingBattle!.unitBindings[0].type = t === 'infantry' ? 'archer' : 'infantry';
    expect(validateStrategicState(s3).ok).toBe(false);

    const s4 = battlingClone(412);
    s4.pendingBattle!.unitBindings[0].startingHp = 1;
    // 실제 유닛 HP와 불일치
    expect(validateStrategicState(s4).ok).toBe(false);
    expect(deserializeStrategic(JSON.stringify({ version: 1, state: s4 }))).toBeNull();
  });

  it('전투 지역에 제3 군단 추가 → 실패', () => {
    const s = battlingClone(413);
    const third = s.armies.find(
      (a) =>
        a.id !== s.pendingBattle!.attackerArmyId && a.id !== s.pendingBattle!.defenderArmyId,
    )!;
    third.regionId = s.pendingBattle!.regionId;
    expect(validateStrategicState(s).ok).toBe(false);
    expect(deserializeStrategic(JSON.stringify({ version: 1, state: s }))).toBeNull();
  });
});

describe('Strategic Layer V0 — 정상 회귀 (E)', () => {
  it('12지역 그래프·전략 명령·인간 전술 시나리오 validator PASS', () => {
    const regions = createStrategicRegions();
    expect(regions).toHaveLength(12);
    expect(isRegionGraphConnected(regions)).toBe(true);

    const { state } = startPendingBattle(501);
    const prep = prepareStrategicBattle(state);
    expect(prep.ok).toBe(true);
    if (!prep.ok || prep.value.kind !== 'human-tactical') return;
    expect(isPlayable(validateScenario(prep.value.scenario))).toBe(true);
  });

  it('공격·방어·draw 반영 PASS', () => {
    for (const [seed, mode] of [
      [511, 'att'],
      [512, 'def'],
      [513, 'draw'],
    ] as const) {
      const { state } = startPendingBattle(seed);
      const ctx = state.pendingBattle!;
      const attF = state.armies.find((a) => a.id === ctx.attackerArmyId)!.faction;
      const defF = state.armies.find((a) => a.id === ctx.defenderArmyId)!.faction;
      const winner = mode === 'att' ? attF : mode === 'def' ? defF : 'draw';
      const survivors: Record<string, number> = {};
      for (const b of ctx.unitBindings) {
        if (mode === 'draw' || b.faction === winner) survivors[b.strategicUnitId] = b.startingHp;
      }
      if (mode === 'att') {
        const oneDef = ctx.unitBindings.find((b) => b.faction === defF);
        if (oneDef) survivors[oneDef.strategicUnitId] = 1;
      }
      const report = makeValidReport(state, winner as FactionId | 'draw', survivors);
      const applied = applyTacticalBattleReport(state, report);
      expect(applied.ok).toBe(true);
    }
  });

  it('전략 저장 왕복 digest·전술 SAVE_VERSION=4·리플레이 회귀', () => {
    const { state } = startPendingBattle(520);
    const raw = serializeStrategic(state);
    const back = deserializeStrategic(raw);
    expect(back).not.toBeNull();
    expect(strategicStateDigest(state)).toBe(strategicStateDigest(back!));
    expect(STRATEGIC_SAVE_VERSION).toBe(1);

    const g = newGame(999, { humanFaction: 'crimson' });
    expect(SAVE_VERSION).toBe(4);
    expect(stateDigest(g)).toBe(stateDigest(deserialize(serialize(g))!));
  });

  it('FACTION_IDS score 키 완전성', () => {
    const { state } = startPendingBattle(521);
    const report = makeValidReport(state, 'draw');
    for (const fid of FACTION_IDS) {
      expect(typeof report.scoreByFaction[fid]).toBe('number');
    }
  });
});


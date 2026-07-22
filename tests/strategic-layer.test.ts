// 한 줄 목적: Strategic Layer V0 상태·명령·전투 브리지·저장·digest 계약을 검증한다
import { describe, expect, it } from 'vitest';
import { UNIT_STATS } from '../src/core/data';
import { deserialize, SAVE_VERSION, serialize } from '../src/core/save';
import { newGame } from '../src/core/game';
import { isPlayable, validateScenario } from '../src/core/scenario/validate';
import { stateDigest } from '../src/core/replay';
import type { FactionId, GameState, Unit } from '../src/core/types';
import {
  applyTacticalBattleReport,
  buildBattleContext,
  buildTacticalBattleReport,
  buildTacticalScenario,
  tacticalScenarioDigest,
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

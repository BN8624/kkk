// 한 줄 목적: AI 대 AI 전략 전투를 결정론적으로 자동 해결하는 V0 시뮬레이터
import { FACTION_IDS, UNIT_STATS } from '../core/data';
import type { FactionId } from '../core/types';
import {
  applyTacticalBattleReport,
  prepareStrategicBattle,
  validateTacticalBattleReport,
} from './battle-bridge';
import { battleFnv } from './battle-identity';
import type {
  StrategicArmy,
  StrategicBattleContext,
  StrategicGameState,
  StrategicResult,
  StrategicUnit,
  TacticalBattleReport,
} from './types';

function fail<T>(reason: string): StrategicResult<T> {
  return { ok: false, reason };
}

function armyById(state: StrategicGameState, id: string): StrategicArmy | undefined {
  return state.armies.find((a) => a.id === id);
}

/** 유닛 전투력(결정론). 전술 엔진과 동일하다고 주장하지 않는다. */
function unitPower(
  u: { type: StrategicUnit['type']; hp: number },
  sideBonus: number,
): number {
  const st = UNIT_STATS[u.type];
  return Math.max(1, st.atk * 3 + st.def + u.hp + sideBonus);
}

interface SimUnit {
  strategicUnitId: string;
  armyId: string;
  faction: FactionId;
  type: StrategicUnit['type'];
  hp: number;
  startingHp: number;
  side: 'attacker' | 'defender';
}

const MAX_ROUNDS = 12;

/**
 * pendingBattle context만으로 TacticalBattleReport를 생성한다.
 * Math.random 금지. 인간 여부 미사용. 동일 상태 → 동일 report.
 */
export function simulateAutoResolveReport(
  state: StrategicGameState,
  context: StrategicBattleContext,
): StrategicResult<TacticalBattleReport> {
  const attacker = armyById(state, context.attackerArmyId);
  const defender = armyById(state, context.defenderArmyId);
  if (!attacker || !defender) return fail('army-missing');
  if (attacker.units.length === 0 || defender.units.length === 0) return fail('empty-army');

  const region = state.regions.find((r) => r.id === context.regionId);
  const defenseBonus = region ? Math.max(0, Math.floor(region.defense)) : 0;

  const units: SimUnit[] = [];
  for (const b of context.unitBindings) {
    const army = b.armyId === attacker.id ? attacker : b.armyId === defender.id ? defender : null;
    if (!army) return fail('binding-army');
    const live = army.units.find((u) => u.id === b.strategicUnitId);
    if (!live) return fail('binding-unit-missing');
    units.push({
      strategicUnitId: b.strategicUnitId,
      armyId: b.armyId,
      faction: b.faction,
      type: b.type,
      hp: live.hp,
      startingHp: b.startingHp,
      side: b.armyId === attacker.id ? 'attacker' : 'defender',
    });
  }

  // 라운드 교환: 양측 생존 유닛을 id 정렬 후 1:1에 가깝게 상호 타격
  let round = 0;
  while (round < MAX_ROUNDS) {
    const atkAlive = units.filter((u) => u.side === 'attacker' && u.hp > 0);
    const defAlive = units.filter((u) => u.side === 'defender' && u.hp > 0);
    if (atkAlive.length === 0 || defAlive.length === 0) break;
    round++;

    atkAlive.sort((a, b) => a.strategicUnitId.localeCompare(b.strategicUnitId));
    defAlive.sort((a, b) => a.strategicUnitId.localeCompare(b.strategicUnitId));

    const pairs = Math.max(atkAlive.length, defAlive.length);
    for (let i = 0; i < pairs; i++) {
      const a = atkAlive[i % atkAlive.length];
      const d = defAlive[i % defAlive.length];
      if (a.hp <= 0 || d.hp <= 0) continue;

      const roll = battleFnv(`${context.battleSeed}|r${round}|${a.strategicUnitId}|${d.strategicUnitId}`);
      const aPow = unitPower(a, 0);
      const dPow = unitPower(d, defenseBonus);
      // 공격→방어 피해
      const dmgToDef = Math.max(1, Math.floor((aPow * (8 + (roll % 5))) / (12 + dPow)));
      d.hp = Math.max(0, d.hp - dmgToDef);
      // 방어→공격 반격(약함)
      if (d.hp > 0) {
        const roll2 = battleFnv(`${context.battleSeed}|c${round}|${d.strategicUnitId}|${a.strategicUnitId}`);
        const dmgToAtk = Math.max(
          0,
          Math.floor((dPow * (5 + (roll2 % 4))) / (14 + aPow)),
        );
        a.hp = Math.max(0, a.hp - dmgToAtk);
      }
    }
  }

  // HP 상한: startingHp 초과 금지
  for (const u of units) {
    if (u.hp > u.startingHp) u.hp = u.startingHp;
  }

  const atkAlive = units.filter((u) => u.side === 'attacker' && u.hp > 0);
  const defAlive = units.filter((u) => u.side === 'defender' && u.hp > 0);

  let winner: FactionId | 'draw';
  if (atkAlive.length > 0 && defAlive.length === 0) winner = attacker.faction;
  else if (defAlive.length > 0 && atkAlive.length === 0) winner = defender.faction;
  else if (atkAlive.length === 0 && defAlive.length === 0) {
    // 전멸 동점 — battleSeed로 타이브레이크 없이 draw
    winner = 'draw';
  } else {
    // 라운드 상한 후 생존: 총 전력 비교, 동점이면 draw
    const sumPow = (list: SimUnit[]) =>
      list.reduce((s, u) => s + unitPower(u, u.side === 'defender' ? defenseBonus : 0), 0);
    const ap = sumPow(atkAlive);
    const dp = sumPow(defAlive);
    if (ap > dp) winner = attacker.faction;
    else if (dp > ap) winner = defender.faction;
    else winner = 'draw';
  }

  const survivingUnits: TacticalBattleReport['survivingUnits'] = units
    .filter((u) => u.hp > 0)
    .map((u) => ({
      strategicUnitId: u.strategicUnitId,
      armyId: u.armyId,
      faction: u.faction,
      type: u.type,
      hp: u.hp,
    }))
    .sort((a, b) => a.strategicUnitId.localeCompare(b.strategicUnitId));

  const survivorIds = new Set(survivingUnits.map((s) => s.strategicUnitId));
  const losses: TacticalBattleReport['losses'] = context.unitBindings
    .filter((b) => !survivorIds.has(b.strategicUnitId))
    .map((b) => ({
      strategicUnitId: b.strategicUnitId,
      armyId: b.armyId,
      faction: b.faction,
      type: b.type,
    }))
    .sort((a, b) => a.strategicUnitId.localeCompare(b.strategicUnitId));

  const retreatingArmyIds: string[] = [];
  const attackerAlive = survivingUnits.some((s) => s.armyId === context.attackerArmyId);
  const defenderAlive = survivingUnits.some((s) => s.armyId === context.defenderArmyId);
  if (winner === 'draw') {
    if (attackerAlive) retreatingArmyIds.push(context.attackerArmyId);
  } else if (winner === attacker.faction) {
    if (defenderAlive) retreatingArmyIds.push(context.defenderArmyId);
  } else if (winner === defender.faction) {
    if (attackerAlive) retreatingArmyIds.push(context.attackerArmyId);
  }
  retreatingArmyIds.sort();

  const scoreByFaction = {} as Record<FactionId, number>;
  for (const fid of FACTION_IDS) {
    scoreByFaction[fid] = survivingUnits
      .filter((s) => s.faction === fid)
      .reduce((s, u) => s + u.hp + 5, 0);
  }

  const report: TacticalBattleReport = {
    schemaVersion: 1,
    battleId: context.battleId,
    winner,
    survivingUnits,
    losses,
    retreatingArmyIds,
    turns: Math.max(1, round),
    scoreByFaction,
  };

  return { ok: true, value: report };
}

/**
 * AI 대 AI pending battle을 자동 해결하고 상태를 반영한다.
 * prepare → simulate → validate → apply. validator 우회 금지.
 */
export function autoResolveStrategicBattle(
  state: StrategicGameState,
): StrategicResult<TacticalBattleReport> {
  const prep = prepareStrategicBattle(state);
  if (!prep.ok) return fail(prep.reason);
  if (prep.value.kind !== 'auto-resolve-required') {
    return fail('not-auto-resolve');
  }
  const context = prep.value.context;
  const sim = simulateAutoResolveReport(state, context);
  if (!sim.ok) return fail(sim.reason);

  const validated = validateTacticalBattleReport(state, sim.value);
  if (!validated.ok) return fail(validated.reason);

  return { ok: true, value: sim.value };
}

/**
 * auto-resolve report를 생성·검증·적용까지 한 번에 수행한다.
 */
export function autoResolveAndApply(
  state: StrategicGameState,
): StrategicResult<StrategicGameState> {
  const report = autoResolveStrategicBattle(state);
  if (!report.ok) return fail(report.reason);
  return applyTacticalBattleReport(state, report.value);
}

// 한 줄 목적: 리플레이 한 판을 재실행하며 전체·전투·지도·경제·별점 지표와 턴별 주요 사건을 계산한다
import { executeCommand } from '../command';
import { unitAt, unitById, unitsOf } from '../board';
import { MAX_UNITS_PER_FACTION, UNIT_STATS } from '../data';
import { attackTargets, forecastAttack, unitCost } from '../game';
import { hexDistance } from '../hex';
import { replayInitialState, type PlaytestEvaluation, type ReplayDocument } from '../replay';
import { starsEarned } from '../scenario/objectives';
import type { StarCondition } from '../scenario/types';
import type { Axial, FactionId, GameConfig, GameState, UnitTypeId } from '../types';
import { producibleUnits, UNIT_TYPE_IDS, unitArmorPiercing, unitTrait } from '../units';
import { buildingName, factionName, localizedScenarioName, t, unitName } from '../../i18n';

// ---------------- 결과 타입 ----------------

export interface TurnEventNote {
  turn: number;
  kind: 'kill' | 'loss' | 'capture' | 'crown' | 'capital-threat' | 'objective' | 'end';
  text: string;
}

export interface MissedKillNote {
  turn: number;
  attackerType: UnitTypeId;
  defenderType: UnitTypeId;
}

export interface UnitClassStats {
  damageDealt: number;
  kills: number;
  losses: number;
  produced: number;
  actions: number;
}

export interface StarReview {
  condition: StarCondition;
  earned: boolean;
  /** 달성/미달성 설명(미달성 시 필요한 차이 포함) */
  note: string;
}

export interface ReplayAnalysis {
  replayId: string;
  gameVersion: string;
  createdAt: string;
  config: GameConfig;
  scenarioTitle: string;
  /** 리플레이 문서의 선택 평가 분류(결정론·다이제스트와 무관) */
  defectTag?: PlaytestEvaluation['defectTag'];

  // 전체
  outcome: 'win' | 'lose' | 'draw';
  winner: FactionId | 'draw';
  turns: number;
  score: number;
  stars: number;
  starTotal: number;
  starReviews: StarReview[];
  commandCount: number;
  moves: number;
  attacks: number;
  productions: number;
  /** 인간 페이즈 종료 시 이동·공격을 모두 안 한 유닛 수의 합 */
  idleUnitTurns: number;
  /** 공격 가능 대상이 있었지만 공격하지 않고 페이즈를 끝낸 기회 수 */
  missedAttackChances: number;
  /** 이번 공격으로 처치가 예측되는 적을 두고 페이즈를 끝낸 횟수 */
  missedKills: MissedKillNote[];

  // 전투(인간 세력 기준)
  kills: number;
  lostUnits: number;
  damageDealt: number;
  damageTaken: number;
  counterDamageTaken: number;
  /** 공격자가 죽고 방어자가 살아남은 교전 수 */
  unfavorableTrades: number;
  byClass: Record<UnitTypeId, UnitClassStats>;

  // 지도
  captures: { turn: number; building: string }[];
  buildingHoldTurns: number;
  capitalThreatTurn: number | null;
  crownChanges: { turn: number; owner: FactionId | null }[];
  moveDistance: number;
  /** 3턴 이상 연속 미이동 유닛 수(최대 기준) */
  stagnantUnits: number;
  /** 시작 대비 종료 시 가장 가까운 적 수도까지의 평균 거리 변화(음수 = 전진) */
  advanceDelta: number | null;

  // 경제
  totalIncome: number;
  productionSpend: number;
  goldAtEnd: number;
  avgGoldAtTurnEnd: number;
  /** 생산 가능(자금·자리·정원)이었지만 생산하지 않은 인간 페이즈 수 */
  idleProductionTurns: number;
  /** 위 페이즈들에서 놀린 금의 합 */
  idleProductionGold: number;
  productionByClass: Record<UnitTypeId, number>;

  // 고유 병종 지표(2.2)
  /** 수호 태세 상태에서 피격·방어 판정이 적용된 횟수 */
  braceActivations: number;
  /** 약탈로 획득한 금 */
  plunderGold: number;
  /** 방어 관통 공격 횟수 */
  armorPiercingAttacks: number;
  /** 관통으로 무시된 기본 방어 합 */
  armorPiercingIgnored: number;

  // 사건
  timeline: TurnEventNote[];
}

export type AnalyzeResult =
  | { ok: true; analysis: ReplayAnalysis }
  | { ok: false; reason: string };

const UNIT_TYPES: UnitTypeId[] = [...UNIT_TYPE_IDS];

function emptyClassStats(): Record<UnitTypeId, UnitClassStats> {
  const out = {} as Record<UnitTypeId, UnitClassStats>;
  for (const t of UNIT_TYPES) out[t] = { damageDealt: 0, kills: 0, losses: 0, produced: 0, actions: 0 };
  return out;
}

function emptyProduction(): Record<UnitTypeId, number> {
  const out = {} as Record<UnitTypeId, number>;
  for (const t of UNIT_TYPES) out[t] = 0;
  return out;
}

/** 최소 병과 비용(생산 기회 판단용) — 현재 로스터 기준. */
function minUnitCost(state: GameState, faction: FactionId): number {
  const roster = producibleUnits(state, faction);
  return Math.min(...roster.map((t) => unitCost(faction, t, state.config.modifier)));
}

/** 인간 소유 생산 가능 거점(빈 타일) 수. */
function freeProductionSpots(state: GameState, faction: FactionId): number {
  let n = 0;
  for (const t of state.tiles) {
    if (t.building && t.owner === faction && !unitAt(state, t.q, t.r)) n++;
  }
  return n;
}

function enemyCapitals(state: GameState, me: FactionId): Axial[] {
  return state.tiles
    .filter((t) => t.building === 'capital' && t.owner && t.owner !== me)
    .map((t) => ({ q: t.q, r: t.r }));
}

function avgDistanceToNearestEnemyCapital(state: GameState, me: FactionId): number | null {
  const caps = enemyCapitals(state, me);
  const units = unitsOf(state, me);
  if (caps.length === 0 || units.length === 0) return null;
  let sum = 0;
  for (const u of units) {
    sum += Math.min(...caps.map((c) => hexDistance(u, c)));
  }
  return sum / units.length;
}

/** 별점 조건 하나를 최종 상태 기준으로 평가·설명한다. */
function reviewStar(state: GameState, c: StarCondition, earned: boolean): StarReview {
  const me = state.config.humanFaction;
  const stats = state.stats[me];
  const turns = Math.min(state.turn, state.maxTurns);
  const alive = unitsOf(state, me).length;
  const gold = state.factions[me].gold;
  let note: string;
  switch (c.type) {
    case 'win':
      note = t(earned ? 'analysis.star.winEarned' : 'analysis.star.winMissed');
      break;
    case 'win-within-turns':
      note = earned
        ? t('analysis.star.turnsEarned', { target: c.turns, actual: turns })
        : state.winner === me
          ? t('analysis.star.turnsLate', { actual: turns, late: turns - c.turns })
          : t('analysis.star.turnsMissed', { target: c.turns });
      break;
    case 'units-alive-at-least':
      note = earned
        ? t('analysis.star.aliveEarned', { actual: alive, target: c.count })
        : t('analysis.star.aliveMissed', { actual: alive, gap: c.count - alive });
      break;
    case 'units-lost-at-most':
      note = earned
        ? t('analysis.star.lostEarned', { actual: stats.lost, target: c.count })
        : t('analysis.star.lostMissed', { actual: stats.lost, gap: stats.lost - c.count });
      break;
    case 'buildings-captured-at-least':
      note = earned
        ? t('analysis.star.capturedEarned', { actual: stats.captured, target: c.count })
        : t('analysis.star.capturedMissed', { actual: stats.captured, gap: c.count - stats.captured });
      break;
    case 'kills-at-least':
      note = earned
        ? t('analysis.star.killsEarned', { actual: stats.kills, target: c.count })
        : t('analysis.star.killsMissed', { actual: stats.kills, gap: c.count - stats.kills });
      break;
    case 'unit-alive':
      note = t(earned ? 'analysis.star.unitEarned' : 'analysis.star.unitMissed', { tag: c.tag });
      break;
    case 'gold-at-least':
      note = earned
        ? t('analysis.star.goldEarned', { actual: gold, target: c.amount })
        : t('analysis.star.goldMissed', { actual: gold, gap: c.amount - gold });
      break;
  }
  return { condition: c, earned, note };
}

/**
 * 리플레이를 처음부터 재실행하며 지표를 수집한다. 예외를 던지지 않는다.
 * 명령 실행이 실패하면(규칙 불일치 기록) 분석 불가로 안전하게 반환한다.
 */
export function analyzeReplay(doc: ReplayDocument): AnalyzeResult {
  try {
    const state = replayInitialState(doc);
    const me = doc.initialConfig.humanFaction;

    const byClass = emptyClassStats();
    const productionByClass = emptyProduction();
    const timeline: TurnEventNote[] = [];
    const missedKills: MissedKillNote[] = [];
    const captures: { turn: number; building: string }[] = [];
    const crownChanges: { turn: number; owner: FactionId | null }[] = [];
    const goldAtTurnEnd: number[] = [];
    const unitTypeById = new Map<number, UnitTypeId>();
    const unitFactionById = new Map<number, FactionId>();
    const lastMovedTurn = new Map<number, number>();
    let braceActivations = 0;
    let plunderGold = 0;
    let armorPiercingAttacks = 0;
    let armorPiercingIgnored = 0;

    for (const u of state.units) {
      unitTypeById.set(u.id, u.type);
      unitFactionById.set(u.id, u.faction);
      lastMovedTurn.set(u.id, 1);
    }

    let moves = 0;
    let attacks = 0;
    let productions = 0;
    let idleUnitTurns = 0;
    let missedAttackChances = 0;
    let kills = 0;
    let lostUnits = 0;
    let damageDealt = 0;
    let damageTaken = 0;
    let counterDamageTaken = 0;
    let unfavorableTrades = 0;
    let buildingHoldTurns = 0;
    let capitalThreatTurn: number | null = null;
    let moveDistance = 0;
    let totalIncome = 0;
    let productionSpend = 0;
    let idleProductionTurns = 0;
    let idleProductionGold = 0;
    let stagnantMax = 0;

    const startAdvance = avgDistanceToNearestEnemyCapital(state, me);
    const humanCapital = state.tiles.find((t) => t.building === 'capital' && t.owner === me);

    /** 인간 페이즈 종료 직전: 미사용 기회·놓친 처치·생산 미활용을 집계한다. */
    const collectPhaseEnd = (): void => {
      const producedThisPhase = phaseProduced;
      const units = unitsOf(state, me);
      let idle = 0;
      for (const u of units) {
        if (!u.moved && !u.attacked) idle++;
        if (!u.attacked) {
          const targets = attackTargets(state, u);
          if (targets.length > 0) {
            missedAttackChances++;
            for (const t of targets) {
              const fc = forecastAttack(state, u, t);
              if (fc.defenderDies && !fc.attackerDies) {
                missedKills.push({ turn: state.turn, attackerType: u.type, defenderType: t.type });
                break;
              }
            }
          }
        }
      }
      idleUnitTurns += idle;
      goldAtTurnEnd.push(state.factions[me].gold);
      // 생산 기회: 자리·정원·자금이 모두 있는데 이번 페이즈에 생산이 없었다
      if (!producedThisPhase) {
        const spots = freeProductionSpots(state, me);
        const gold = state.factions[me].gold;
        if (
          spots > 0 &&
          units.length < MAX_UNITS_PER_FACTION &&
          gold >= minUnitCost(state, me)
        ) {
          idleProductionTurns++;
          idleProductionGold += gold;
        }
      }
    };

    let phaseProduced = false;
    let attackContext: { attackerId: number; defenderId: number } | null = null;

    for (const command of doc.commands) {
      const isHumanCmd = command.faction === me;
      if (command.type === 'end-phase' && isHumanCmd) collectPhaseEnd();
      if (command.type === 'attack-unit' && isHumanCmd) {
        attackContext = { attackerId: command.attackerId, defenderId: command.defenderId };
        // 고유 능력 지표: 명령 실행 전 상태 기준
        const attacker = unitById(state, command.attackerId);
        const defender = unitById(state, command.defenderId);
        if (attacker && defender) {
          const pierce = unitArmorPiercing(attacker.type);
          if (pierce > 0) {
            armorPiercingAttacks++;
            armorPiercingIgnored += Math.min(pierce, UNIT_STATS[defender.type].def);
          }
          if (unitTrait(defender.type, 'brace') && !defender.movedThisTurn) {
            braceActivations++;
          }
        }
      } else {
        attackContext = null;
      }

      const r = executeCommand(state, command);
      if (!r.ok) {
        return {
          ok: false,
          reason: t('analysis.error.command', { seq: command.seq, reason: r.reason ?? 'invalid' }),
        };
      }

      if (isHumanCmd) {
        if (command.type === 'move-unit') moves++;
        else if (command.type === 'attack-unit') attacks++;
        else if (command.type === 'produce-unit') productions++;
      }

      let attackerDied = false;
      let defenderDied = false;
      for (const ev of r.events) {
        switch (ev.type) {
          case 'unit-produced':
            unitTypeById.set(ev.unitId, ev.unitType);
            unitFactionById.set(ev.unitId, ev.faction);
            lastMovedTurn.set(ev.unitId, state.turn);
            if (ev.faction === me) {
              productionByClass[ev.unitType]++;
              byClass[ev.unitType].produced++;
              productionSpend += ev.cost;
              phaseProduced = true;
            }
            break;
          case 'unit-moved':
            lastMovedTurn.set(ev.unitId, state.turn);
            if (ev.faction === me) {
              moveDistance += Math.max(0, ev.path.length - 1);
              byClass[ev.unitType].actions++;
            }
            break;
          case 'unit-attacked':
            if (ev.attackerFaction === me) {
              damageDealt += ev.damage;
              byClass[ev.attackerType].damageDealt += ev.damage;
              byClass[ev.attackerType].actions++;
            }
            if (ev.defenderFaction === me) damageTaken += ev.damage;
            break;
          case 'unit-countered': {
            const targetFaction = unitFactionById.get(ev.targetId);
            if (targetFaction === me) {
              counterDamageTaken += ev.damage;
              damageTaken += ev.damage;
            }
            break;
          }
          case 'unit-died': {
            const type = ev.unitType;
            if (ev.faction === me) {
              lostUnits++;
              byClass[type].losses++;
              timeline.push({
                turn: state.turn,
                kind: 'loss',
                text: t('analysis.event.unitLost', { unit: unitName(type) }),
              });
            } else if (isHumanCmd) {
              kills++;
              const attackerType = attackContext ? unitTypeById.get(attackContext.attackerId) : undefined;
              if (attackerType) byClass[attackerType].kills++;
              timeline.push({
                turn: state.turn,
                kind: 'kill',
                text: t('analysis.event.unitDefeated', {
                  faction: factionName(ev.faction),
                  unit: unitName(type),
                }),
              });
            }
            if (attackContext) {
              if (ev.unitId === attackContext.attackerId) attackerDied = true;
              if (ev.unitId === attackContext.defenderId) defenderDied = true;
            }
            break;
          }
          case 'building-captured':
            if (ev.newOwner === me) {
              captures.push({ turn: state.turn, building: buildingName(ev.building) });
              timeline.push({
                turn: state.turn,
                kind: 'capture',
                text: t('analysis.event.captured', { building: buildingName(ev.building) }),
              });
            } else if (ev.prevOwner === me) {
              timeline.push({
                turn: state.turn,
                kind: 'capture',
                text: t('analysis.event.buildingLost', {
                  building: buildingName(ev.building),
                  faction: factionName(ev.newOwner),
                }),
              });
            }
            break;
          case 'income-granted':
            if (ev.faction === me) totalIncome += ev.amount;
            break;
          case 'gold-changed':
            if (ev.faction === me && ev.reason === 'plunder') plunderGold += ev.delta;
            break;
          case 'crown-hold-changed':
            crownChanges.push({ turn: state.turn, owner: ev.owner ?? null });
            if (ev.owner) {
              timeline.push({
                turn: state.turn,
                kind: 'crown',
                text: t('analysis.event.crownHeld', {
                  faction: factionName(ev.owner),
                  turns: ev.turns,
                  required: ev.required,
                }),
              });
            }
            break;
          case 'turn-started': {
            // 턴 시작 표본: 거점 보유·수도 위협·정체 유닛
            for (const t of state.tiles) {
              if (t.building && t.owner === me) buildingHoldTurns++;
            }
            if (capitalThreatTurn === null && humanCapital) {
              const threat = state.units.some(
                (u) => u.faction !== me && hexDistance(u, humanCapital) <= 2,
              );
              if (threat) {
                capitalThreatTurn = ev.turn;
                timeline.push({
                  turn: ev.turn,
                  kind: 'capital-threat',
                  text: t('analysis.event.capitalThreat'),
                });
              }
            }
            let stagnant = 0;
            for (const u of unitsOf(state, me)) {
              const last = lastMovedTurn.get(u.id) ?? ev.turn;
              if (ev.turn - last >= 3) stagnant++;
            }
            stagnantMax = Math.max(stagnantMax, stagnant);
            break;
          }
          case 'objective-completed':
            timeline.push({
              turn: state.turn,
              kind: 'objective',
              text: t('analysis.event.objective'),
            });
            break;
          case 'game-ended':
            timeline.push({
              turn: ev.turn,
              kind: 'end',
              text:
                ev.winner === 'draw'
                  ? t('analysis.event.draw')
                  : ev.winner === me
                    ? t('analysis.event.humanWin')
                    : t('analysis.event.factionWin', { faction: factionName(ev.winner) }),
            });
            break;
          default:
            break;
        }
      }
      if (attackContext && attackerDied && !defenderDied) unfavorableTrades++;
      if (command.type === 'end-phase' && isHumanCmd) phaseProduced = false;
    }

    const flags = starsEarned(state);
    const starConds = state.objectives?.stars ?? [];
    const starReviews = starConds.map((c, i) => reviewStar(state, c, flags[i] ?? false));
    const endAdvance = avgDistanceToNearestEnemyCapital(state, me);
    const turns = Math.min(state.turn, state.maxTurns);

    const analysis: ReplayAnalysis = {
      replayId: doc.replayId,
      gameVersion: doc.gameVersion,
      createdAt: doc.createdAt,
      config: { ...doc.initialConfig },
      scenarioTitle: localizedScenarioName(doc.initialConfig.scenario, doc.scenario.title),
      ...(doc.evaluation?.defectTag ? { defectTag: doc.evaluation.defectTag } : {}),
      outcome: doc.result.winner === 'draw' ? 'draw' : doc.result.winner === me ? 'win' : 'lose',
      winner: doc.result.winner,
      turns,
      score: doc.result.score,
      stars: doc.result.stars,
      starTotal: starConds.length,
      starReviews,
      commandCount: doc.commands.length,
      moves,
      attacks,
      productions,
      idleUnitTurns,
      missedAttackChances,
      missedKills,
      kills,
      lostUnits,
      damageDealt,
      damageTaken,
      counterDamageTaken,
      unfavorableTrades,
      byClass,
      captures,
      buildingHoldTurns,
      capitalThreatTurn,
      crownChanges,
      moveDistance,
      stagnantUnits: stagnantMax,
      advanceDelta:
        startAdvance !== null && endAdvance !== null ? endAdvance - startAdvance : null,
      totalIncome,
      productionSpend,
      goldAtEnd: state.factions[me].gold,
      avgGoldAtTurnEnd:
        goldAtTurnEnd.length > 0
          ? Math.round((goldAtTurnEnd.reduce((a, b) => a + b, 0) / goldAtTurnEnd.length) * 10) / 10
          : 0,
      idleProductionTurns,
      idleProductionGold,
      productionByClass,
      braceActivations,
      plunderGold,
      armorPiercingAttacks,
      armorPiercingIgnored,
      timeline,
    };
    return { ok: true, analysis };
  } catch {
    return { ok: false, reason: t('analysis.error.internal') };
  }
}

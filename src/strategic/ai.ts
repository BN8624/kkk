// 한 줄 목적: 전략 V0 AI — 결정론적 이동·점령·보충·대기 선택
import { UNIT_STATS } from '../core/data';
import type { FactionId } from '../core/types';
import { applyStrategicOrder, armyHasDamagedUnits, isStrategicSettlement, REPLENISH_COST } from './orders';
import type {
  StrategicArmy,
  StrategicGameState,
  StrategicOrder,
  StrategicRegion,
  StrategicResult,
} from './types';
import { validateStrategicOrder } from './orders';

function armyPower(army: StrategicArmy): number {
  let p = 0;
  for (const u of army.units) {
    const st = UNIT_STATS[u.type];
    p += st.atk * 2 + st.def + u.hp;
  }
  return p;
}

function damageRatio(army: StrategicArmy): number {
  let cur = 0;
  let max = 0;
  for (const u of army.units) {
    cur += u.hp;
    max += UNIT_STATS[u.type].hp;
  }
  if (max <= 0) return 0;
  return 1 - cur / max;
}

function regionById(state: StrategicGameState, id: string): StrategicRegion | undefined {
  return state.regions.find((r) => r.id === id);
}

function armiesInRegion(state: StrategicGameState, regionId: string): StrategicArmy[] {
  return state.armies.filter((a) => a.regionId === regionId);
}

function ownsCapital(state: StrategicGameState, faction: FactionId, regionId: string): boolean {
  const r = regionById(state, regionId);
  return !!r && r.settlement === 'capital' && r.owner === faction;
}

/**
 * 인접 후보 점수. 인간 세력 여부는 점수에 넣지 않는다.
 * 동일 상태 → 동일 점수 → 동일 명령.
 */
function scoreCandidate(
  state: StrategicGameState,
  army: StrategicArmy,
  toRegionId: string,
): number {
  const region = regionById(state, toRegionId);
  if (!region) return -1e9;
  let score = 0;

  // 적 수도
  if (region.settlement === 'capital' && region.owner !== null && region.owner !== army.faction) {
    score += 100;
  }
  // 중립
  if (region.owner === null) score += 40;
  // 적 소유
  if (region.owner !== null && region.owner !== army.faction) score += 30;

  const occupants = armiesInRegion(state, toRegionId);
  const enemies = occupants.filter((a) => a.faction !== army.faction);
  if (enemies.length > 0) {
    score += 25;
    const enemyPower = enemies.reduce((s, a) => s + armyPower(a), 0);
    const selfPower = armyPower(army);
    score += Math.max(-40, Math.min(40, selfPower - enemyPower));
  }

  score += region.income * 2;
  score -= region.defense * 3;

  // 자기 수도 위협 방어: 수도 인접 적 지역 우선
  for (const r of state.regions) {
    if (r.settlement !== 'capital' || r.owner !== army.faction) continue;
    if (r.neighbors.includes(toRegionId)) {
      const threat = armiesInRegion(state, toRegionId).some((a) => a.faction !== army.faction);
      if (threat) score += 50;
      else if (region.owner !== army.faction) score += 15;
    }
  }

  // 자기 수도에 머물며 방어 가치(이동 점수에서는 목적지 기준)
  if (ownsCapital(state, army.faction, army.regionId) && enemies.length > 0) {
    // 수도에서 나가는 전투도 허용하되 과도한 모험 억제는 점수만
    score -= 5;
  }

  // 짧은 이동 선호 — 그래프 거리는 인접 1이므로 고정 소감
  score -= 1;

  // 동점 깨기: 지역 id 사전순 가산(결정론)
  score += (100 - toRegionId.charCodeAt(1) * 3 - toRegionId.charCodeAt(2)) * 0.001;

  return score;
}

/**
 * 단일 미행동 군단의 결정론 명령.
 * 1) 심한 손상 + 정착지 + 국고 → 보충
 * 2) 최고 점수 인접 이동
 * 3) 대기
 */
export function chooseStrategicAiOrder(
  state: StrategicGameState,
  armyId: string,
): StrategicOrder {
  const army = state.armies.find((a) => a.id === armyId);
  if (!army || army.moved || army.units.length === 0) {
    return { type: 'hold-army', armyId };
  }

  const region = regionById(state, army.regionId);
  if (
    damageRatio(army) >= 0.35 &&
    region &&
    isStrategicSettlement(region) &&
    region.owner === army.faction &&
    state.treasury[army.faction] >= REPLENISH_COST &&
    armyHasDamagedUnits(army)
  ) {
    const order: StrategicOrder = { type: 'replenish-army', armyId };
    if (validateStrategicOrder(state, order, army.faction).ok) return order;
  }

  if (!region) return { type: 'hold-army', armyId };

  let best: { regionId: string; score: number } | null = null;
  const neighbors = [...region.neighbors].sort();
  for (const nid of neighbors) {
    const order: StrategicOrder = { type: 'move-army', armyId, toRegionId: nid };
    if (!validateStrategicOrder(state, order, army.faction).ok) continue;
    const sc = scoreCandidate(state, army, nid);
    if (!best || sc > best.score || (sc === best.score && nid < best.regionId)) {
      best = { regionId: nid, score: sc };
    }
  }

  if (best) return { type: 'move-army', armyId, toRegionId: best.regionId };
  return { type: 'hold-army', armyId };
}

/**
 * 현재 세력의 모든 미행동 군단을 ID 정렬 순으로 1회씩 명령한다.
 * pending battle이 생기면 즉시 중단한다.
 * Math.random 금지. 동일 상태 → 동일 결과.
 */
export function runStrategicAiFaction(
  state: StrategicGameState,
  faction?: FactionId,
): StrategicResult<StrategicGameState> {
  const acting = faction ?? state.currentFaction;
  if (state.phase !== 'orders') return { ok: false, reason: 'not-orders-phase' };
  if (state.pendingBattle) return { ok: false, reason: 'battle-pending' };
  if (state.winner !== undefined) return { ok: false, reason: 'game-ended' };
  if (state.currentFaction !== acting) return { ok: false, reason: 'not-current-faction' };

  let cur = state;
  // 루프 방어: 군단 수 + 여유
  const maxSteps = Math.max(8, cur.armies.length * 2 + 4);
  let steps = 0;

  while (steps < maxSteps) {
    steps++;
    if (cur.pendingBattle || cur.phase !== 'orders' || cur.winner !== undefined) break;
    const pending = cur.armies
      .filter((a) => a.faction === acting && !a.moved && a.units.length > 0)
      .map((a) => a.id)
      .sort();
    if (pending.length === 0) break;

    const armyId = pending[0];
    const order = chooseStrategicAiOrder(cur, armyId);
    const applied = applyStrategicOrder(cur, order, acting);
    if (!applied.ok) {
      // 실패 명령 무한 재시도 금지 — hold로 강제 완료
      const hold = applyStrategicOrder(cur, { type: 'hold-army', armyId }, acting);
      if (!hold.ok) return { ok: false, reason: hold.reason };
      cur = hold.value;
      continue;
    }
    cur = applied.value;
  }

  // 남은 미행동(안전) hold
  const leftover = cur.armies
    .filter((a) => a.faction === acting && !a.moved)
    .map((a) => a.id)
    .sort();
  for (const id of leftover) {
    if (cur.pendingBattle) break;
    const hold = applyStrategicOrder(cur, { type: 'hold-army', armyId: id }, acting);
    if (!hold.ok) return { ok: false, reason: hold.reason };
    cur = hold.value;
  }

  return { ok: true, value: cur };
}

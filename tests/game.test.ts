// 한 줄 목적: 이동·전투·점령·생산·턴 진행·승패 판정 규칙을 검증한다
import { describe, expect, it } from 'vitest';
import { tileAt, unitAt, unitsOf } from '../src/core/board';
import { BUILDING_INCOME, SCORE_WEIGHTS, START_GOLD, UNIT_STATS } from '../src/core/data';
import {
  advancePhase,
  attack,
  attackTargets,
  damageBreakdown,
  evaluateTurnLimit,
  evaluateVictory,
  factionScore,
  moveUnit,
  newGame,
  produceUnit,
  unitCost,
} from '../src/core/game';
import { movementRange, reachableDestinations } from '../src/core/pathfind';
import { addUnit, makeState } from './helpers';

describe('이동', () => {
  it('이동력 안의 타일만 도달 가능하다', () => {
    const state = makeState();
    const u = addUnit(state, { faction: 'azure', q: 0, r: 2 }); // move 3
    const reach = movementRange(state, u);
    for (const e of reach.values()) {
      expect(e.cost).toBeLessThanOrEqual(3);
    }
    expect(reach.size).toBeGreaterThan(10);
  });

  it('숲은 이동 비용 2를 소모한다', () => {
    const state = makeState();
    tileAt(state, 1, 2)!.terrain = 'forest';
    const u = addUnit(state, { faction: 'azure', q: 0, r: 2 });
    const reach = movementRange(state, u);
    expect(reach.get('1,2')!.cost).toBe(2);
  });

  it('물 타일에는 진입할 수 없다', () => {
    const state = makeState();
    tileAt(state, 1, 2)!.terrain = 'water';
    const u = addUnit(state, { faction: 'azure', q: 0, r: 2 });
    const reach = movementRange(state, u);
    expect(reach.has('1,2')).toBe(false);
  });

  it('적 유닛이 있는 타일은 통과·정지 불가', () => {
    const state = makeState();
    const u = addUnit(state, { faction: 'azure', q: 0, r: 2 });
    addUnit(state, { faction: 'crimson', q: 1, r: 2 });
    const dests = reachableDestinations(state, u);
    expect(dests.some((d) => d.q === 1 && d.r === 2)).toBe(false);
  });

  it('이동 후 moved 플래그가 설정되고 재이동이 거부된다', () => {
    const state = makeState();
    const u = addUnit(state, { faction: 'azure', q: 0, r: 2 });
    const r1 = moveUnit(state, u.id, { q: 1, r: 2 });
    expect(r1.ok).toBe(true);
    expect(u.moved).toBe(true);
    const r2 = moveUnit(state, u.id, { q: 2, r: 2 });
    expect(r2.ok).toBe(false);
  });
});

describe('전투', () => {
  it('피해 공식이 결정론적이며 최소 1이다', () => {
    const state = makeState();
    const a = addUnit(state, { faction: 'azure', q: 0, r: 0 });
    const d = addUnit(state, { faction: 'crimson', q: 1, r: 0 });
    const tile = tileAt(state, 1, 0)!;
    expect(damageBreakdown(state, a, d).total).toBe(5 - 2); // 보병 대 보병 평원
    tile.terrain = 'mountain';
    expect(damageBreakdown(state, a, d).total).toBe(1); // 5 - 2 - 2 = 1
  });

  it('공격하면 반격을 받고 체력이 감소한다', () => {
    const state = makeState();
    const a = addUnit(state, { faction: 'azure', q: 0, r: 0 });
    const d = addUnit(state, { faction: 'crimson', q: 1, r: 0 });
    const result = attack(state, a.id, d.id);
    expect(result.ok).toBe(true);
    expect(d.hp).toBe(12 - 3);
    expect(result.counterDamage).toBe(3);
    expect(a.hp).toBe(12 - 3);
  });

  it('궁병은 2칸 공격 시 반격받지 않는다', () => {
    const state = makeState();
    const archer = addUnit(state, { faction: 'azure', q: 0, r: 0, type: 'archer' });
    const inf = addUnit(state, { faction: 'crimson', q: 2, r: 0 });
    const result = attack(state, archer.id, inf.id);
    expect(result.ok).toBe(true);
    expect(result.counterDamage).toBeUndefined();
    expect(archer.hp).toBe(UNIT_STATS.archer.hp);
  });

  it('체력이 0 이하가 되면 유닛이 제거되고 처치 통계가 오른다', () => {
    const state = makeState();
    const a = addUnit(state, { faction: 'azure', q: 0, r: 0 });
    const d = addUnit(state, { faction: 'crimson', q: 1, r: 0, hp: 2 });
    const result = attack(state, a.id, d.id);
    expect(result.defenderDied).toBe(true);
    expect(state.units.find((u) => u.id === d.id)).toBeUndefined();
    expect(state.stats.azure.kills).toBe(1);
  });

  it('AI 세력의 처치도 해당 세력 통계에 기록된다', () => {
    const state = makeState();
    const a = addUnit(state, { faction: 'crimson', q: 0, r: 0 });
    const d = addUnit(state, { faction: 'violet', q: 1, r: 0, hp: 1 });
    attack(state, a.id, d.id);
    expect(state.stats.crimson.kills).toBe(1);
    expect(state.stats.azure.kills).toBe(0);
  });

  it('사거리 밖 공격은 거부된다', () => {
    const state = makeState();
    const a = addUnit(state, { faction: 'azure', q: 0, r: 0 });
    const d = addUnit(state, { faction: 'crimson', q: 3, r: 0 });
    expect(attack(state, a.id, d.id).ok).toBe(false);
    expect(attackTargets(state, a)).toHaveLength(0);
  });
});

describe('점령', () => {
  it('중립 마을에 진입하면 점령된다', () => {
    const state = makeState();
    const t = tileAt(state, 1, 2)!;
    t.building = 'village';
    const u = addUnit(state, { faction: 'azure', q: 0, r: 2 });
    const result = moveUnit(state, u.id, { q: 1, r: 2 });
    expect(result.captured).toBeDefined();
    expect(t.owner).toBe('azure');
    expect(state.stats.azure.captured).toBe(1);
  });

  it('적 수도를 모두 점령하면 승리한다', () => {
    const state = makeState();
    const c1 = tileAt(state, 0, 0)!;
    const c2 = tileAt(state, 2, 0)!;
    const c3 = tileAt(state, 4, 0)!;
    c1.building = 'capital';
    c1.owner = 'azure';
    c2.building = 'capital';
    c2.owner = 'crimson';
    c3.building = 'capital';
    c3.owner = 'violet';
    const u = addUnit(state, { faction: 'azure', q: 2, r: 1 });
    moveUnit(state, u.id, { q: 2, r: 0 });
    expect(state.over).toBe(false);
    const u2 = addUnit(state, { faction: 'azure', q: 4, r: 1 });
    moveUnit(state, u2.id, { q: 4, r: 0 });
    expect(state.over).toBe(true);
    expect(state.winner).toBe('azure');
  });

  it('AI 세력도 모든 수도를 점령하면 승리한다', () => {
    const state = makeState();
    for (const [q, owner] of [
      [0, 'crimson'],
      [2, 'crimson'],
    ] as const) {
      const t = tileAt(state, q, 0)!;
      t.building = 'capital';
      t.owner = owner;
    }
    const c3 = tileAt(state, 4, 0)!;
    c3.building = 'capital';
    c3.owner = 'azure';
    addUnit(state, { faction: 'azure', q: 4, r: 2 }); // 인간은 유닛이 남아 탈락 아님
    const u = addUnit(state, { faction: 'crimson', q: 4, r: 1 });
    moveUnit(state, u.id, { q: 4, r: 0 });
    expect(state.over).toBe(true);
    expect(state.winner).toBe('crimson');
  });

  it('인간 세력 수도 상실 + 전멸이면 게임이 끝난다', () => {
    const state = makeState();
    const cap = tileAt(state, 0, 0)!;
    cap.building = 'capital';
    cap.owner = 'crimson';
    // 인간(azure) 유닛 없음, 수도 없음
    evaluateVictory(state);
    expect(state.factions.azure.eliminated).toBe(true);
    expect(state.over).toBe(true);
    expect(state.winner).not.toBe('azure');
  });

  it('인간이 진홍 공국일 때도 승패 판정이 인간 기준으로 동작한다', () => {
    const state = makeState({ humanFaction: 'crimson' });
    const cap = tileAt(state, 0, 0)!;
    cap.building = 'capital';
    cap.owner = 'azure';
    addUnit(state, { faction: 'violet', q: 3, r: 3 });
    // 인간(crimson) 수도·유닛 없음 → 탈락 → 게임 종료
    evaluateVictory(state);
    expect(state.factions.crimson.eliminated).toBe(true);
    expect(state.over).toBe(true);
    expect(state.winner).not.toBe('crimson');
  });

  it('crown-heart 4턴 이하에서는 정복 승리가 즉시 확정되지 않는다', () => {
    const state = makeState({ scenario: 'crown-heart' });
    state.turn = 3;
    // 모든 수도를 crimson이 점령한 상태(유닛은 각 세력 생존)
    for (const [q, r] of [
      [0, 0],
      [2, 2],
      [4, 4],
    ] as const) {
      const t = tileAt(state, q, r)!;
      t.building = 'capital';
      t.owner = 'crimson';
    }
    addUnit(state, { faction: 'azure', q: 1, r: 0 });
    addUnit(state, { faction: 'crimson', q: 2, r: 1 });
    addUnit(state, { faction: 'violet', q: 3, r: 3 });
    evaluateVictory(state);
    expect(state.over).toBe(false);
    expect(state.winner).toBeUndefined();
  });

  it('crown-heart 5턴부터는 정복 승리가 즉시 확정된다', () => {
    const state = makeState({ scenario: 'crown-heart' });
    state.turn = 5;
    for (const [q, r] of [
      [0, 0],
      [2, 2],
      [4, 4],
    ] as const) {
      const t = tileAt(state, q, r)!;
      t.building = 'capital';
      t.owner = 'crimson';
    }
    addUnit(state, { faction: 'azure', q: 1, r: 0 });
    addUnit(state, { faction: 'crimson', q: 2, r: 1 });
    addUnit(state, { faction: 'violet', q: 3, r: 3 });
    evaluateVictory(state);
    expect(state.over).toBe(true);
    expect(state.winner).toBe('crimson');
  });

  it('crown-heart 4턴 이하에서도 인간 탈락은 즉시 종료한다', () => {
    const state = makeState({ scenario: 'crown-heart' });
    state.turn = 2;
    // 인간(azure) 수도·유닛 없음 → 탈락 확정, 유예 없이 종료
    const cap = tileAt(state, 0, 0)!;
    cap.building = 'capital';
    cap.owner = 'crimson';
    addUnit(state, { faction: 'crimson', q: 1, r: 0 });
    addUnit(state, { faction: 'violet', q: 3, r: 3 });
    evaluateVictory(state);
    expect(state.factions.azure.eliminated).toBe(true);
    expect(state.over).toBe(true);
    expect(state.winner).not.toBe('azure');
  });
});

describe('생산과 자원', () => {
  it('소유 거점에서 금을 소모해 유닛을 생산한다', () => {
    const state = makeState();
    const t = tileAt(state, 0, 0)!;
    t.building = 'capital';
    t.owner = 'azure';
    const result = produceUnit(state, 'azure', { q: 0, r: 0 }, 'infantry');
    expect(result.ok).toBe(true);
    expect(state.factions.azure.gold).toBe(100 - unitCost('azure', 'infantry'));
    expect(unitAt(state, 0, 0)).toBeDefined();
    expect(result.unit!.moved).toBe(true);
    expect(state.stats.azure.produced).toBe(1);
  });

  it('금이 부족하면 생산이 거부된다', () => {
    const state = makeState();
    state.factions.azure.gold = 10;
    const t = tileAt(state, 0, 0)!;
    t.building = 'capital';
    t.owner = 'azure';
    expect(produceUnit(state, 'azure', { q: 0, r: 0 }, 'cavalry').ok).toBe(false);
  });

  it('점유된 타일·비소유 거점에서는 생산 불가', () => {
    const state = makeState();
    const t = tileAt(state, 0, 0)!;
    t.building = 'capital';
    t.owner = 'crimson';
    expect(produceUnit(state, 'azure', { q: 0, r: 0 }, 'infantry').ok).toBe(false);
    t.owner = 'azure';
    addUnit(state, { faction: 'azure', q: 0, r: 0 });
    expect(produceUnit(state, 'azure', { q: 0, r: 0 }, 'infantry').ok).toBe(false);
  });

  it('턴 종료 시 거점 수입이 지급되고 유닛 행동이 초기화된다', () => {
    const state = makeState();
    const t = tileAt(state, 0, 0)!;
    t.building = 'capital';
    t.owner = 'azure';
    const u = addUnit(state, { faction: 'azure', q: 1, r: 1, moved: true, attacked: true });
    state.current = 'violet';
    advancePhase(state);
    expect(state.turn).toBe(2);
    expect(state.current).toBe('azure');
    expect(state.factions.azure.gold).toBe(100 + BUILDING_INCOME.capital);
    expect(u.moved).toBe(false);
    expect(u.attacked).toBe(false);
  });
});

describe('턴 제한과 점수', () => {
  it('페이즈가 order 순서대로 진행된다', () => {
    const state = makeState();
    expect(state.current).toBe('azure');
    advancePhase(state);
    expect(state.current).toBe('crimson');
    advancePhase(state);
    expect(state.current).toBe('violet');
  });

  it('제한 턴 초과 시 최고 점수 세력이 승리한다', () => {
    const state = makeState();
    const t = tileAt(state, 0, 0)!;
    t.building = 'capital';
    t.owner = 'azure';
    addUnit(state, { faction: 'crimson', q: 3, r: 3 });
    state.turn = 13;
    evaluateTurnLimit(state);
    expect(state.over).toBe(true);
    expect(state.winner).toBe('azure'); // 수도 30 > 유닛 2
  });

  it('인간 세력이 동점 최고점이면 무승부다', () => {
    const state = makeState();
    // azure(인간)와 crimson 모두 유닛 1기 = 2점
    addUnit(state, { faction: 'azure', q: 0, r: 0 });
    addUnit(state, { faction: 'crimson', q: 3, r: 3 });
    state.turn = 13;
    evaluateTurnLimit(state);
    expect(state.over).toBe(true);
    expect(state.winner).toBe('draw');
  });

  it('지배 점수가 거점·유닛 가중치를 반영한다', () => {
    const state = makeState();
    const cap = tileAt(state, 0, 0)!;
    cap.building = 'capital';
    cap.owner = 'azure';
    const vil = tileAt(state, 2, 2)!;
    vil.building = 'village';
    vil.owner = 'azure';
    addUnit(state, { faction: 'azure', q: 1, r: 1 });
    state.stats.azure.kills = 2;
    expect(factionScore(state, 'azure')).toBe(
      SCORE_WEIGHTS.capital + SCORE_WEIGHTS.village + SCORE_WEIGHTS.unit + 2 * SCORE_WEIGHTS.kill,
    );
  });
});

describe('실제 새 게임', () => {
  it('newGame이 세 세력과 시작 유닛을 만든다', () => {
    const state = newGame(20260719);
    expect(unitsOf(state, 'azure').length).toBe(2);
    expect(unitsOf(state, 'crimson').length).toBe(2);
    expect(unitsOf(state, 'violet').length).toBe(2);
    expect(state.factions.azure.gold).toBe(START_GOLD);
    expect(state.over).toBe(false);
    // 모든 유닛이 지상 위에 있다
    for (const u of state.units) {
      const t = tileAt(state, u.q, u.r);
      expect(t).toBeDefined();
      expect(t!.terrain).not.toBe('water');
    }
  });

  it('어느 왕국을 선택해도 컨트롤러가 올바르게 배정된다', () => {
    for (const fid of ['azure', 'crimson', 'violet'] as const) {
      const state = newGame(7, { humanFaction: fid });
      expect(state.config.humanFaction).toBe(fid);
      expect(state.controllers[fid]).toBe('human');
      const aiCount = state.order.filter((f) => state.controllers[f] === 'ai').length;
      expect(aiCount).toBe(2);
      expect(state.current).toBe(state.order[0]);
    }
  });
});

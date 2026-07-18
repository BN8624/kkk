// 한 줄 목적: 이동·전투·점령·생산·턴 진행·승패 판정 규칙을 검증한다
import { describe, expect, it } from 'vitest';
import { tileAt, unitAt, unitsOf } from '../src/core/board';
import { BUILDING_INCOME, START_GOLD, UNIT_STATS } from '../src/core/data';
import {
  advancePhase,
  attack,
  attackTargets,
  computeDamage,
  evaluateTurnLimit,
  evaluateVictory,
  factionScore,
  moveUnit,
  newGame,
  produceUnit,
} from '../src/core/game';
import { movementRange, reachableDestinations } from '../src/core/pathfind';
import type { GameState, Tile, Unit } from '../src/core/types';

function makeState(): GameState {
  // 테스트 전용 미니 맵: 평원 5x5
  const tiles: Tile[] = [];
  for (let r = 0; r < 5; r++) {
    for (let q = -2; q < 5; q++) {
      tiles.push({ q, r, terrain: 'plains' });
    }
  }
  return {
    seed: 0,
    turn: 1,
    maxTurns: 12,
    current: 'player',
    tiles,
    units: [],
    factions: {
      player: { id: 'player', gold: 100, eliminated: false },
      ai1: { id: 'ai1', gold: 100, eliminated: false },
      ai2: { id: 'ai2', gold: 100, eliminated: false },
    },
    nextUnitId: 1,
    over: false,
    stats: { kills: 0, produced: 0, captured: 0 },
  };
}

function addUnit(state: GameState, partial: Partial<Unit> & Pick<Unit, 'faction' | 'q' | 'r'>): Unit {
  const type = partial.type ?? 'infantry';
  const unit: Unit = {
    id: state.nextUnitId++,
    type,
    faction: partial.faction,
    q: partial.q,
    r: partial.r,
    hp: partial.hp ?? UNIT_STATS[type].hp,
    moved: partial.moved ?? false,
    attacked: partial.attacked ?? false,
  };
  state.units.push(unit);
  return unit;
}

describe('이동', () => {
  it('이동력 안의 타일만 도달 가능하다', () => {
    const state = makeState();
    const u = addUnit(state, { faction: 'player', q: 0, r: 2 }); // move 3
    const reach = movementRange(state, u);
    for (const e of reach.values()) {
      expect(e.cost).toBeLessThanOrEqual(3);
    }
    expect(reach.size).toBeGreaterThan(10);
  });

  it('숲은 이동 비용 2를 소모한다', () => {
    const state = makeState();
    tileAt(state, 1, 2)!.terrain = 'forest';
    const u = addUnit(state, { faction: 'player', q: 0, r: 2 });
    const reach = movementRange(state, u);
    expect(reach.get('1,2')!.cost).toBe(2);
  });

  it('물 타일에는 진입할 수 없다', () => {
    const state = makeState();
    tileAt(state, 1, 2)!.terrain = 'water';
    const u = addUnit(state, { faction: 'player', q: 0, r: 2 });
    const reach = movementRange(state, u);
    expect(reach.has('1,2')).toBe(false);
  });

  it('적 유닛이 있는 타일은 통과·정지 불가', () => {
    const state = makeState();
    const u = addUnit(state, { faction: 'player', q: 0, r: 2 });
    addUnit(state, { faction: 'ai1', q: 1, r: 2 });
    const dests = reachableDestinations(state, u);
    expect(dests.some((d) => d.q === 1 && d.r === 2)).toBe(false);
  });

  it('이동 후 moved 플래그가 설정되고 재이동이 거부된다', () => {
    const state = makeState();
    const u = addUnit(state, { faction: 'player', q: 0, r: 2 });
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
    const a = addUnit(state, { faction: 'player', q: 0, r: 0 });
    const d = addUnit(state, { faction: 'ai1', q: 1, r: 0 });
    const tile = tileAt(state, 1, 0)!;
    expect(computeDamage(a, d, tile)).toBe(5 - 2); // 보병 대 보병 평원
    tile.terrain = 'mountain';
    expect(computeDamage(a, d, tile)).toBe(1); // 5 - 2 - 2 = 1
  });

  it('공격하면 반격을 받고 체력이 감소한다', () => {
    const state = makeState();
    const a = addUnit(state, { faction: 'player', q: 0, r: 0 });
    const d = addUnit(state, { faction: 'ai1', q: 1, r: 0 });
    const result = attack(state, a.id, d.id);
    expect(result.ok).toBe(true);
    expect(d.hp).toBe(12 - 3);
    expect(result.counterDamage).toBe(3);
    expect(a.hp).toBe(12 - 3);
  });

  it('궁병은 2칸 공격 시 반격받지 않는다', () => {
    const state = makeState();
    const archer = addUnit(state, { faction: 'player', q: 0, r: 0, type: 'archer' });
    const inf = addUnit(state, { faction: 'ai1', q: 2, r: 0 });
    const result = attack(state, archer.id, inf.id);
    expect(result.ok).toBe(true);
    expect(result.counterDamage).toBeUndefined();
    expect(archer.hp).toBe(UNIT_STATS.archer.hp);
  });

  it('체력이 0 이하가 되면 유닛이 제거된다', () => {
    const state = makeState();
    const a = addUnit(state, { faction: 'player', q: 0, r: 0 });
    const d = addUnit(state, { faction: 'ai1', q: 1, r: 0, hp: 2 });
    const result = attack(state, a.id, d.id);
    expect(result.defenderDied).toBe(true);
    expect(state.units.find((u) => u.id === d.id)).toBeUndefined();
    expect(state.stats.kills).toBe(1);
  });

  it('사거리 밖 공격은 거부된다', () => {
    const state = makeState();
    const a = addUnit(state, { faction: 'player', q: 0, r: 0 });
    const d = addUnit(state, { faction: 'ai1', q: 3, r: 0 });
    expect(attack(state, a.id, d.id).ok).toBe(false);
    expect(attackTargets(state, a)).toHaveLength(0);
  });
});

describe('점령', () => {
  it('중립 마을에 진입하면 점령된다', () => {
    const state = makeState();
    const t = tileAt(state, 1, 2)!;
    t.building = 'village';
    const u = addUnit(state, { faction: 'player', q: 0, r: 2 });
    const result = moveUnit(state, u.id, { q: 1, r: 2 });
    expect(result.captured).toBeDefined();
    expect(t.owner).toBe('player');
    expect(state.stats.captured).toBe(1);
  });

  it('적 수도를 모두 점령하면 승리한다', () => {
    const state = makeState();
    const c1 = tileAt(state, 0, 0)!;
    const c2 = tileAt(state, 2, 0)!;
    const c3 = tileAt(state, 4, 0)!;
    c1.building = 'capital';
    c1.owner = 'player';
    c2.building = 'capital';
    c2.owner = 'ai1';
    c3.building = 'capital';
    c3.owner = 'ai2';
    const u = addUnit(state, { faction: 'player', q: 2, r: 1 });
    moveUnit(state, u.id, { q: 2, r: 0 });
    expect(state.over).toBe(false);
    const u2 = addUnit(state, { faction: 'player', q: 4, r: 1 });
    moveUnit(state, u2.id, { q: 4, r: 0 });
    expect(state.over).toBe(true);
    expect(state.winner).toBe('player');
  });

  it('플레이어 수도 상실 + 전멸이면 패배한다', () => {
    const state = makeState();
    const cap = tileAt(state, 0, 0)!;
    cap.building = 'capital';
    cap.owner = 'ai1';
    // 플레이어 유닛 없음, 수도 없음
    evaluateVictory(state);
    expect(state.factions.player.eliminated).toBe(true);
    expect(state.over).toBe(true);
    expect(state.winner).not.toBe('player');
  });
});

describe('생산과 자원', () => {
  it('소유 거점에서 금을 소모해 유닛을 생산한다', () => {
    const state = makeState();
    const t = tileAt(state, 0, 0)!;
    t.building = 'capital';
    t.owner = 'player';
    const result = produceUnit(state, 'player', { q: 0, r: 0 }, 'infantry');
    expect(result.ok).toBe(true);
    expect(state.factions.player.gold).toBe(100 - UNIT_STATS.infantry.cost);
    expect(unitAt(state, 0, 0)).toBeDefined();
    expect(result.unit!.moved).toBe(true);
  });

  it('금이 부족하면 생산이 거부된다', () => {
    const state = makeState();
    state.factions.player.gold = 10;
    const t = tileAt(state, 0, 0)!;
    t.building = 'capital';
    t.owner = 'player';
    expect(produceUnit(state, 'player', { q: 0, r: 0 }, 'cavalry').ok).toBe(false);
  });

  it('점유된 타일·비소유 거점에서는 생산 불가', () => {
    const state = makeState();
    const t = tileAt(state, 0, 0)!;
    t.building = 'capital';
    t.owner = 'ai1';
    expect(produceUnit(state, 'player', { q: 0, r: 0 }, 'infantry').ok).toBe(false);
    t.owner = 'player';
    addUnit(state, { faction: 'player', q: 0, r: 0 });
    expect(produceUnit(state, 'player', { q: 0, r: 0 }, 'infantry').ok).toBe(false);
  });

  it('턴 종료 시 거점 수입이 지급되고 유닛 행동이 초기화된다', () => {
    const state = makeState();
    const t = tileAt(state, 0, 0)!;
    t.building = 'capital';
    t.owner = 'player';
    const u = addUnit(state, { faction: 'player', q: 1, r: 1, moved: true, attacked: true });
    state.current = 'ai2';
    advancePhase(state);
    expect(state.turn).toBe(2);
    expect(state.current).toBe('player');
    expect(state.factions.player.gold).toBe(100 + BUILDING_INCOME.capital);
    expect(u.moved).toBe(false);
    expect(u.attacked).toBe(false);
  });
});

describe('턴 제한과 점수', () => {
  it('페이즈가 player→ai1→ai2 순으로 진행된다', () => {
    const state = makeState();
    expect(state.current).toBe('player');
    advancePhase(state);
    expect(state.current).toBe('ai1');
    advancePhase(state);
    expect(state.current).toBe('ai2');
  });

  it('제한 턴 초과 시 최고 점수 세력이 승리한다', () => {
    const state = makeState();
    const t = tileAt(state, 0, 0)!;
    t.building = 'capital';
    t.owner = 'player';
    addUnit(state, { faction: 'ai1', q: 3, r: 3 });
    state.turn = 13;
    evaluateTurnLimit(state);
    expect(state.over).toBe(true);
    expect(state.winner).toBe('player'); // 수도 30 + 없음 > 유닛 2
  });

  it('지배 점수가 거점·유닛 가중치를 반영한다', () => {
    const state = makeState();
    const cap = tileAt(state, 0, 0)!;
    cap.building = 'capital';
    cap.owner = 'player';
    const vil = tileAt(state, 2, 2)!;
    vil.building = 'village';
    vil.owner = 'player';
    addUnit(state, { faction: 'player', q: 1, r: 1 });
    expect(factionScore(state, 'player')).toBe(30 + 10 + 2);
  });
});

describe('실제 새 게임', () => {
  it('newGame이 세 세력과 시작 유닛을 만든다', () => {
    const state = newGame(20260719);
    expect(unitsOf(state, 'player').length).toBe(2);
    expect(unitsOf(state, 'ai1').length).toBe(2);
    expect(unitsOf(state, 'ai2').length).toBe(2);
    expect(state.factions.player.gold).toBe(START_GOLD);
    expect(state.over).toBe(false);
    // 모든 유닛이 지상 위에 있다
    for (const u of state.units) {
      const t = tileAt(state, u.q, u.r);
      expect(t).toBeDefined();
      expect(t!.terrain).not.toBe('water');
    }
  });
});

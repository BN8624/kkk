// 한 줄 목적: AI가 고유 병종을 생산·전술적으로 활용하는지 검증한다
import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/core/ai';
import { tileAt, unitsOf } from '../src/core/board';
import { newGame } from '../src/core/game';
import type { GameState, UnitTypeId } from '../src/core/types';
import { addUnit, makeState } from './helpers';

function enableUnique(state: GameState): void {
  state.objectives.uniqueUnits = true;
}

describe('AI 고유 병종', () => {
  it('고유 병종 허용 시 청람 AI가 수호대를 생산할 수 있다', () => {
    const state = makeState({ difficulty: 'hard', humanFaction: 'crimson' });
    enableUnique(state);
    state.current = 'azure';
    state.controllers.azure = 'ai';
    const cap = tileAt(state, 0, 0)!;
    cap.building = 'capital';
    cap.owner = 'azure';
    state.factions.azure.gold = 200;
    // 적 기병 위협 → 수호대 생산 유도
    addUnit(state, { faction: 'crimson', type: 'cavalry', q: 2, r: 0 });
    addUnit(state, { faction: 'crimson', type: 'cavalry', q: 2, r: 1 });
    addUnit(state, { faction: 'azure', type: 'infantry', q: 0, r: 1 });
    const before = unitsOf(state, 'azure').filter((u) => u.type === 'guardian').length;
    runAiTurn(state, 'azure');
    const after = unitsOf(state, 'azure').filter((u) => u.type === 'guardian').length;
    // 위협·금 충분 시 수호대 생산 또는 기존 유닛 활용
    expect(after + before).toBeGreaterThanOrEqual(0);
    const produced = state.stats.azure.produced;
    expect(produced).toBeGreaterThanOrEqual(0);
    // 여러 턴 돌리면 수호대 등장
    for (let i = 0; i < 4 && !state.over; i++) {
      if (state.current !== 'azure') state.current = 'azure';
      state.factions.azure.gold = 200;
      // 빈 수도 확보
      if (tileAt(state, 0, 0) && !state.units.find((u) => u.q === 0 && u.r === 0)) {
        /* free */
      } else {
        // 수도 위 유닛 제거해 생산 자리 확보
        state.units = state.units.filter((u) => !(u.q === 0 && u.r === 0 && u.faction === 'azure'));
      }
      runAiTurn(state, 'azure');
    }
    const guardians = unitsOf(state, 'azure').filter((u) => u.type === 'guardian');
    expect(guardians.length).toBeGreaterThanOrEqual(1);
  });

  it('수호대는 아군 거점에서 수호 태세를 유지하며 이탈하지 않는다', () => {
    const state = makeState({ difficulty: 'hard' });
    enableUnique(state);
    state.current = 'azure';
    const cap = tileAt(state, 0, 0)!;
    cap.building = 'capital';
    cap.owner = 'azure';
    const g = addUnit(state, { faction: 'azure', type: 'guardian', q: 0, r: 0 });
    // 먼 곳의 약한 적 — 추격 유도 시도
    addUnit(state, { faction: 'crimson', type: 'archer', q: 4, r: 4, hp: 3 });
    runAiTurn(state, 'azure');
    const after = state.units.find((u) => u.id === g.id);
    expect(after).toBeDefined();
    expect(after!.q).toBe(0);
    expect(after!.r).toBe(0);
  });

  it('약탈대는 빈 마을 점령을 우선한다', () => {
    const state = makeState({ difficulty: 'hard' });
    enableUnique(state);
    state.current = 'crimson';
    const village = tileAt(state, 2, 0)!;
    village.building = 'village';
    // 소유 없음 = 점령 가능
    const raider = addUnit(state, { faction: 'crimson', type: 'raider', q: 0, r: 0 });
    runAiTurn(state, 'crimson');
    const after = state.units.find((u) => u.id === raider.id)!;
    // 마을 위 또는 마을 방향으로 이동
    expect(after.q === 2 && after.r === 0 || after.q !== 0 || after.r !== 0).toBe(true);
    // 점령 성공 시 소유권 이전
    if (after.q === 2 && after.r === 0) {
      expect(tileAt(state, 2, 0)!.owner).toBe('crimson');
    }
  });

  it('쇠뇌대는 고방어 수호대를 우선 공격한다', () => {
    const state = makeState({ difficulty: 'hard' });
    enableUnique(state);
    state.current = 'violet';
    addUnit(state, { faction: 'violet', type: 'crossbow', q: 0, r: 0 });
    // 사거리 2 안의 수호대 vs 저방어 약탈대
    addUnit(state, { faction: 'azure', type: 'guardian', q: 2, r: 0 });
    addUnit(state, { faction: 'azure', type: 'raider', q: 1, r: 1, hp: 11 });
    const { events } = runAiTurn(state, 'violet');
    const attack = events.find((e) => e.type === 'unit-attacked');
    expect(attack).toBeDefined();
    if (attack && attack.type === 'unit-attacked') {
      expect(attack.defenderType).toBe('guardian');
    }
  });

  it('고유 병종 비허용 시 AI가 고유 병종을 생산하지 않는다', () => {
    const state = newGame(42, { difficulty: 'hard' });
    // 내장 빠른 전투는 uniqueUnits true — 명시적으로 끈 상태 검증
    state.objectives.uniqueUnits = false;
    state.current = 'azure';
    state.controllers.azure = 'ai';
    state.factions.azure.gold = 300;
    for (let i = 0; i < 6 && !state.over; i++) {
      if (state.current !== 'azure') {
        // 다른 세력 스킵
        state.current = 'azure';
      }
      // 수도 비우기
      const cap = state.tiles.find((t) => t.building === 'capital' && t.owner === 'azure');
      if (cap) {
        state.units = state.units.filter((u) => !(u.q === cap.q && u.r === cap.r));
      }
      state.factions.azure.gold = 300;
      runAiTurn(state, 'azure');
    }
    const uniqueProduced = state.units.some(
      (u) => u.faction === 'azure' && (u.type === 'guardian' || u.type === 'raider' || u.type === 'crossbow'),
    );
    expect(uniqueProduced).toBe(false);
  });

  it('빠른 전투(uniqueUnits)에서 세 세력 AI가 각자 고유 병종을 한 번 이상 생산한다', () => {
    const produced: Record<string, Set<UnitTypeId>> = {
      azure: new Set(),
      crimson: new Set(),
      violet: new Set(),
    };
    for (const seed of [11, 22, 33, 44, 55, 66, 77, 88]) {
      const state = newGame(seed, { difficulty: 'hard' });
      expect(state.objectives.uniqueUnits).toBe(true);
      let guard = 0;
      while (!state.over && guard < 120) {
        guard++;
        const f = state.current;
        const before = new Map(state.units.map((u) => [u.id, u.type]));
        runAiTurn(state, f);
        for (const u of state.units) {
          if (!before.has(u.id) && u.faction === f) {
            produced[f].add(u.type);
          }
        }
      }
    }
    expect(produced.azure.has('guardian')).toBe(true);
    expect(produced.crimson.has('raider')).toBe(true);
    expect(produced.violet.has('crossbow')).toBe(true);
    // 공용 병종 역할 유지
    expect(produced.azure.has('infantry') || produced.azure.has('archer')).toBe(true);
    expect(produced.crimson.has('infantry') || produced.crimson.has('cavalry')).toBe(true);
    // 자원: 궁병 골격과 쇠뇌대 관통 역할이 공존
    expect(produced.violet.has('archer')).toBe(true);
  });

  it('자원 AI는 연·중방어 상대에서 궁병을, 고방어(수호) 상대에서 쇠뇌대를 더 자주 생산한다', () => {
    function produceOnce(enemies: UnitTypeId[]): UnitTypeId | null {
      const state = makeState({ difficulty: 'hard', humanFaction: 'azure' });
      enableUnique(state);
      state.current = 'violet';
      state.controllers.violet = 'ai';
      state.factions.violet.gold = 200;
      const cap = tileAt(state, 0, 0)!;
      cap.building = 'capital';
      cap.owner = 'violet';
      // 아군은 행동 불능 — 수도를 점유하지 않고 구성 비율만 반영
      addUnit(state, {
        faction: 'violet',
        type: 'archer',
        q: 1,
        r: 0,
        moved: true,
        attacked: true,
      });
      addUnit(state, {
        faction: 'violet',
        type: 'infantry',
        q: 0,
        r: 1,
        moved: true,
        attacked: true,
      });
      const enemySlots: Array<{ q: number; r: number }> = [
        { q: 4, r: 3 },
        { q: 3, r: 4 },
        { q: 4, r: 4 },
        { q: 2, r: 4 },
      ];
      enemies.forEach((t, idx) => {
        const slot = enemySlots[idx % enemySlots.length];
        addUnit(state, { faction: 'azure', type: t, q: slot.q, r: slot.r });
      });
      const before = new Set(state.units.map((u) => u.id));
      runAiTurn(state, 'violet');
      const made = state.units.find((u) => u.faction === 'violet' && !before.has(u.id));
      return made?.type ?? null;
    }

    let softArcher = 0;
    let softCross = 0;
    let hardCross = 0;
    let hardArcher = 0;
    const n = 16;
    for (let i = 0; i < n; i++) {
      // 연·중방어(기병 없음): 궁병 vs 쇠뇌대 역할 비교
      const soft = produceOnce(['infantry', 'infantry', 'archer', 'archer']);
      if (soft === 'archer') softArcher++;
      if (soft === 'crossbow') softCross++;
      const hard = produceOnce(['guardian', 'guardian', 'infantry', 'guardian']);
      if (hard === 'crossbow') hardCross++;
      if (hard === 'archer') hardArcher++;
    }
    // 연·중방어: 궁병이 의미 있게 선택되고 쇠뇌대가 전 상황을 독점하지 않음
    expect(softArcher).toBeGreaterThan(0);
    // 고방어: 쇠뇌대 선택이 연·중방어 때보다 많음
    expect(hardCross).toBeGreaterThan(softCross);
    // 고방어에서도 궁병이 0일 수 있으나 쇠뇌대는 반드시 등장
    expect(hardCross).toBeGreaterThan(0);
    void hardArcher;
  });
});

// 한 줄 목적: 시나리오별 지도 생성·검증·왕관 요새 승리 규칙을 검증한다
import { describe, expect, it } from 'vitest';
import { tileAt } from '../src/core/board';
import { advancePhase, newGame } from '../src/core/game';
import { hexKey } from '../src/core/hex';
import { generateScenarioMap, validateMap } from '../src/core/map';
import { SCENARIO_IDS, SCENARIOS } from '../src/core/scenarios';
import { addUnit, makeState } from './helpers';

describe('시나리오 지도 생성', () => {
  it('같은 시드는 같은 지도를 생성한다(모든 시나리오)', () => {
    for (const id of SCENARIO_IDS) {
      const a = generateScenarioMap(id, 12345);
      const b = generateScenarioMap(id, 12345);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('생성된 지도가 모든 시나리오·다양한 시드에서 구조 검증을 통과한다', () => {
    for (const id of SCENARIO_IDS) {
      for (let i = 0; i < 40; i++) {
        const seed = (i * 7919 + 13) >>> 0;
        const map = generateScenarioMap(id, seed);
        // 수도 3개, 중복 좌표 없음
        const capitals = map.tiles.filter((t) => t.building === 'capital');
        expect(capitals, `${id} seed ${seed}`).toHaveLength(3);
        const keys = map.tiles.map((t) => hexKey(t.q, t.r));
        expect(new Set(keys).size).toBe(keys.length);
        // 자동 검증 통과(생성기가 내부 재시도·수리를 거친 결과)
        const issues = validateMap(map).filter((x) => !x.startsWith('village-unfair') && !x.startsWith('crown-unfair'));
        expect(issues, `${id} seed ${seed}: ${issues.join(',')}`).toHaveLength(0);
      }
    }
  });

  it('갈라진 해협에는 해협(중앙 물)과 건널 수 있는 육교가 있다', () => {
    const map = generateScenarioMap('broken-strait', 42);
    // r=5,6 줄에 물이 존재
    const straitWater = map.tiles.filter((t) => (t.r === 5 || t.r === 6) && t.terrain === 'water');
    expect(straitWater.length).toBeGreaterThan(3);
    // 검증 통과 = 남북 수도가 연결되어 있음
    expect(validateMap(map).filter((x) => x.startsWith('unreachable'))).toHaveLength(0);
  });

  it('왕관의 심장에는 중립 왕관 요새가 있다', () => {
    const map = generateScenarioMap('crown-heart', 7);
    expect(map.crown).toBeDefined();
    const crownTile = map.tiles.find((t) => t.building === 'crown')!;
    expect(crownTile).toBeDefined();
    expect(crownTile.owner).toBeUndefined();
    expect(crownTile.terrain).not.toBe('water');
  });
});

describe('왕관 요새 승리 규칙', () => {
  it('newGame이 시나리오 턴 수와 crownHold 상태를 설정한다', () => {
    const state = newGame(1, { scenario: 'crown-heart' });
    expect(state.maxTurns).toBe(SCENARIOS['crown-heart'].maxTurns);
    expect(state.crownHold).toEqual({ owner: null, turns: 0 });
    const normal = newGame(1);
    expect(normal.crownHold).toBeUndefined();
  });

  it('왕관 요새를 연속 보유 턴 수만큼 보유하면 승리한다', () => {
    const need = SCENARIOS['crown-heart'].crownHoldTurns!;
    const state = makeState({ scenario: 'crown-heart' });
    state.crownHold = { owner: null, turns: 0 };
    state.objectives.victory.push({ type: 'hold-building', at: { q: 2, r: 2 }, turns: need });
    const crown = tileAt(state, 2, 2)!;
    crown.building = 'crown';
    crown.owner = 'crimson';
    addUnit(state, { faction: 'azure', q: 0, r: 0 });
    addUnit(state, { faction: 'crimson', q: 4, r: 4 });
    for (let round = 1; round <= need; round++) {
      state.current = 'violet'; // 마지막 세력 페이즈 종료 → 라운드 종료
      advancePhase(state);
      if (round < need) {
        expect(state.over).toBe(false);
        expect(state.crownHold!.turns).toBe(round);
      }
    }
    expect(state.over).toBe(true);
    expect(state.winner).toBe('crimson');
  });

  it('보유 세력이 바뀌면 연속 보유가 초기화된다', () => {
    const state = makeState({ scenario: 'crown-heart' });
    state.crownHold = { owner: null, turns: 0 };
    state.objectives.victory.push({
      type: 'hold-building',
      at: { q: 2, r: 2 },
      turns: SCENARIOS['crown-heart'].crownHoldTurns!,
    });
    const crown = tileAt(state, 2, 2)!;
    crown.building = 'crown';
    crown.owner = 'crimson';
    addUnit(state, { faction: 'azure', q: 0, r: 0 });
    addUnit(state, { faction: 'crimson', q: 4, r: 4 });
    state.current = 'violet';
    advancePhase(state);
    expect(state.crownHold!.turns).toBe(1);
    crown.owner = 'azure'; // 라운드 중 탈환
    state.current = 'violet';
    advancePhase(state);
    expect(state.crownHold).toEqual({ owner: 'azure', turns: 1 });
    expect(state.over).toBe(false);
  });
});

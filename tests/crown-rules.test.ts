// 한 줄 목적: 왕관 활성화 지연·경합 정지·주둔 우선·지도 공정성 게이트를 검증한다
import { describe, expect, it } from 'vitest';
import { FACTION_IDS } from '../src/core/data';
import { advancePhase, newGame } from '../src/core/game';
import { generateScenarioMap } from '../src/core/map';
import { analyzeObjectiveArrival } from '../src/core/scenario/arrival';
import type { GameState } from '../src/core/types';
import { addUnit, makeState } from './helpers';

/** 세 세력 페이즈를 모두 넘겨 라운드(턴) 종료 보유 판정을 유발한다. */
function endRound(state: GameState): void {
  advancePhase(state);
  advancePhase(state);
  advancePhase(state);
}

describe('왕관 활성화 지연', () => {
  it('crown-heart에서 turn < 3 동안 소유해도 crownHold.turns 가 0 이다', () => {
    const state = newGame(7, { scenario: 'crown-heart' });
    const crown = state.tiles.find((t) => t.building === 'crown')!;
    crown.owner = 'azure';

    expect(state.turn).toBe(1);
    endRound(state); // turn 1 종료 → 2
    expect(state.turn).toBe(2);
    expect(state.crownHold?.owner).toBe('azure');
    expect(state.crownHold?.turns).toBe(0);
    expect(state.over).toBe(false);

    endRound(state); // turn 2 종료 → 3
    expect(state.turn).toBe(3);
    expect(state.crownHold?.turns).toBe(0);
    expect(state.over).toBe(false);

    // 활성화 턴(3) 종료 시 카운트 시작
    endRound(state);
    expect(state.turn).toBe(4);
    expect(state.crownHold?.turns).toBe(1);
  });
});

describe('왕관 경합·주둔', () => {
  it('인접 적만 있고 주둔이 없으면 라운드 종료 시 turns 가 정지한다', () => {
    const state = makeState();
    const crown = state.tiles.find((t) => t.q === 0 && t.r === 0)!;
    crown.building = 'crown';
    crown.owner = 'azure';
    state.objectives.victory = [{ type: 'hold-building', at: { q: 0, r: 0 }, turns: 4 }];
    state.crownHold = { owner: 'azure', turns: 2 };
    // 탈락 방지용 후방 유닛 + 왕관 인접 적(주둔 없음)
    addUnit(state, { faction: 'azure', q: 2, r: 2 });
    addUnit(state, { faction: 'crimson', q: 1, r: 0 });
    addUnit(state, { faction: 'violet', q: 3, r: 3 });

    state.current = 'violet';
    advancePhase(state);

    expect(state.crownHold?.turns).toBe(2);
    expect(state.over).toBe(false);
  });

  it('왕관 위 주둔이 있으면 인접 적이 있어도 turns 가 증가한다', () => {
    const state = makeState();
    const crown = state.tiles.find((t) => t.q === 0 && t.r === 0)!;
    crown.building = 'crown';
    crown.owner = 'azure';
    state.objectives.victory = [{ type: 'hold-building', at: { q: 0, r: 0 }, turns: 4 }];
    state.crownHold = { owner: 'azure', turns: 2 };
    addUnit(state, { faction: 'azure', q: 0, r: 0 });
    addUnit(state, { faction: 'crimson', q: 1, r: 0 });
    addUnit(state, { faction: 'violet', q: 3, r: 3 });

    state.current = 'violet';
    advancePhase(state);

    expect(state.crownHold?.turns).toBe(3);
    expect(state.over).toBe(false);
  });
});

describe('왕관 지도 공정성 게이트', () => {
  it('여러 시드의 crown-heart 지도가 min>=2·maxGap<=1 을 만족한다', () => {
    for (const seed of [1, 2, 3, 7, 42]) {
      const map = generateScenarioMap('crown-heart', seed);
      expect(map.crown).toBeDefined();
      const rep = analyzeObjectiveArrival(map, map.crown!);
      const earliest = FACTION_IDS.map((f) => rep.earliestByFaction[f]);
      for (const n of earliest) {
        expect(Number.isFinite(n), `seed ${seed} 도달 불가`).toBe(true);
        expect(n, `seed ${seed} 1턴 점령`).toBeGreaterThanOrEqual(2);
      }
      expect(rep.maxGap, `seed ${seed} gap`).toBeLessThanOrEqual(1);
    }
  });
});

describe('activationTurn 없는 조건 회귀', () => {
  it('activationTurn 이 없으면 turn 1 부터 카운트한다', () => {
    const state = makeState();
    const crown = state.tiles.find((t) => t.q === 0 && t.r === 0)!;
    crown.building = 'crown';
    crown.owner = 'azure';
    state.objectives.victory = [{ type: 'hold-building', at: { q: 0, r: 0 }, turns: 4 }];
    state.crownHold = { owner: 'azure', turns: 0 };
    state.turn = 1;
    // 탈락 방지(수도 없는 미니 맵)
    addUnit(state, { faction: 'azure', q: 2, r: 2 });
    addUnit(state, { faction: 'crimson', q: 3, r: 2 });
    addUnit(state, { faction: 'violet', q: 3, r: 3 });

    state.current = 'violet';
    advancePhase(state);

    expect(state.crownHold?.turns).toBe(1);
    expect(state.over).toBe(false);
  });
});

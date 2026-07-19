// 한 줄 목적: 평가 정책(기존 5종+신규 3종)이 결정론적이고 불법 행동 없이 게임을 끝까지 진행하는지 검증한다
import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/core/ai';
import { unitsOf } from '../src/core/board';
import { CAMPAIGNS } from '../src/core/campaign/missions';
import {
  EVAL_POLICY_IDS,
  runEvalPolicyTurn,
  type EvalPolicyId,
} from '../src/core/eval/policies';
import { newGame, newGameFromScenario } from '../src/core/game';
import { hexDistance } from '../src/core/hex';
import { canonicalJson, digestString } from '../src/core/replay';
import { validateState } from '../src/core/save';
import { crownStatus } from '../src/core/scenario/crown-status';
import { normalizeScenario } from '../src/core/scenario/normalize';
import type { FactionId, GameState } from '../src/core/types';
import { addUnit, makeState } from './helpers';

const SNAPSHOT = normalizeScenario(CAMPAIGNS[0].missions[0].scenario);

const NEW_POLICIES: EvalPolicyId[] = [
  'objective-denial',
  'human-like-cautious',
  'human-like-direct',
];

function playMission(policy: EvalPolicyId, seed: number): GameState {
  const state = newGameFromScenario(seed, SNAPSHOT, { mode: 'campaign', difficulty: 'normal' });
  const human = state.config.humanFaction;
  let guard = 0;
  const maxPhases = (state.maxTurns + 2) * state.order.length;
  while (!state.over && guard < maxPhases) {
    guard++;
    if (state.current === human) runEvalPolicyTurn(state, state.current, policy, seed);
    else runAiTurn(state, state.current);
  }
  return state;
}

/** crown-heart에서 인간 세력을 해당 정책으로, 나머지를 보통 AI로 진행한다. */
function playCrownHeart(policy: EvalPolicyId, seed: number, human: FactionId = 'azure'): GameState {
  const state = newGame(seed, {
    scenario: 'crown-heart',
    difficulty: 'normal',
    humanFaction: human,
  });
  let guard = 0;
  const maxPhases = (state.maxTurns + 2) * state.order.length;
  while (!state.over && guard < maxPhases) {
    guard++;
    const f = state.current;
    if (f === human) runEvalPolicyTurn(state, f, policy, seed);
    else runAiTurn(state, f);
  }
  return state;
}

function commandDigest(state: GameState): string {
  return digestString(canonicalJson(state.commandLog ?? []));
}

describe('평가 정책 5종', () => {
  it.each(EVAL_POLICY_IDS)('%s 정책은 게임을 종료까지 진행하고 상태가 유효하다', (policy) => {
    const state = playMission(policy, 7);
    expect(state.over).toBe(true);
    expect(validateState(state)).toBe(true);
    // 모든 명령이 정본 실행기를 통과해 기록되었다(순번 연속)
    expect(state.commandLog!.length).toBe(state.cmdSeq);
    state.commandLog!.forEach((c, i) => expect(c.seq).toBe(i));
  });

  it('같은 정책·시드는 항상 같은 명령 궤적을 낸다(결정론)', () => {
    for (const policy of EVAL_POLICY_IDS) {
      expect(commandDigest(playMission(policy, 3))).toBe(commandDigest(playMission(policy, 3)));
    }
  });

  it('정책들이 같은 미션·시드에서 서로 다른 궤적을 만든다', () => {
    const digests = new Set(EVAL_POLICY_IDS.map((p) => commandDigest(playMission(p, 5))));
    // 8개 정책 중 최소 3개 이상은 서로 다른 궤적이어야 의미 있는 다양성이다
    expect(digests.size).toBeGreaterThanOrEqual(3);
  });

  it('noisy 정책은 시드가 다르면 다른 궤적을 낼 수 있다', () => {
    const digests = new Set([11, 12, 13, 14, 15].map((s) => commandDigest(playMission('noisy', s))));
    expect(digests.size).toBeGreaterThanOrEqual(2);
  });
});

describe('신규 평가 정책 3종 (테스트 전용 대체)', () => {
  it.each(NEW_POLICIES)(
    '%s 는 crown-heart 여러 시드에서 종료·유효 상태를 유지한다',
    (policy) => {
      for (const seed of [1, 7, 42]) {
        const state = playCrownHeart(policy, seed);
        expect(state.over).toBe(true);
        expect(validateState(state)).toBe(true);
        expect(state.commandLog!.length).toBe(state.cmdSeq);
      }
    },
  );

  it('objective-denial: 적이 활성 왕관 보유 시 유닛이 왕관/인접으로 접근한다(스모크)', () => {
    const state = makeState({
      difficulty: 'normal',
      scenario: 'crown-heart',
      humanFaction: 'azure',
    });
    state.turn = 5;
    state.maxTurns = 14;
    state.current = 'azure';
    // 왕관 좌표 (2,2), 적이 활성 보유
    const crown = state.tiles.find((t) => t.q === 2 && t.r === 2)!;
    crown.building = 'crown';
    crown.owner = 'crimson';
    state.objectives.victory = [
      { type: 'hold-building', at: { q: 2, r: 2 }, turns: 4, activationTurn: 3 },
    ];
    state.crownHold = { owner: 'crimson', turns: 2 };
    addUnit(state, { faction: 'crimson', q: 2, r: 2 }); // 주둔
    addUnit(state, { faction: 'violet', q: -3, r: 5 });
    // 아군 유닛을 왕관에서 떨어진 곳에 배치
    const mine = addUnit(state, { faction: 'azure', q: 0, r: 0, type: 'cavalry' });
    const before = hexDistance(mine, { q: 2, r: 2 });
    expect(before).toBeGreaterThan(1);

    const cs = crownStatus(state)!;
    expect(cs.active).toBe(true);
    expect(cs.owner).toBe('crimson');

    runEvalPolicyTurn(state, 'azure', 'objective-denial', 0);
    const afterUnit = unitsOf(state, 'azure').find((u) => u.id === mine.id) ?? mine;
    const after = hexDistance(afterUnit, { q: 2, r: 2 });
    // 왕관 위·인접이거나 이전보다 가까워져야 한다
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeLessThanOrEqual(Math.max(1, before - 1));
  });

  it('같은 (state,policy,seed) 재실행 시 동일 명령열(결정론)', () => {
    for (const policy of NEW_POLICIES) {
      const a = playCrownHeart(policy, 11, 'crimson');
      const b = playCrownHeart(policy, 11, 'crimson');
      expect(commandDigest(a)).toBe(commandDigest(b));
    }
  });
});

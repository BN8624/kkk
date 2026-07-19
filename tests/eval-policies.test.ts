// 한 줄 목적: 평가 정책 5종이 결정론적이고 불법 행동 없이 게임을 끝까지 진행하며 서로 다른 궤적을 내는지 검증한다
import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/core/ai';
import { CAMPAIGNS } from '../src/core/campaign/missions';
import {
  EVAL_POLICY_IDS,
  runEvalPolicyTurn,
  type EvalPolicyId,
} from '../src/core/eval/policies';
import { newGameFromScenario } from '../src/core/game';
import { canonicalJson, digestString } from '../src/core/replay';
import { validateState } from '../src/core/save';
import { normalizeScenario } from '../src/core/scenario/normalize';
import type { GameState } from '../src/core/types';

const SNAPSHOT = normalizeScenario(CAMPAIGNS[0].missions[0].scenario);

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
    // 5개 정책 중 최소 3개 이상은 서로 다른 궤적이어야 의미 있는 다양성이다
    expect(digests.size).toBeGreaterThanOrEqual(3);
  });

  it('noisy 정책은 시드가 다르면 다른 궤적을 낼 수 있다', () => {
    const digests = new Set([11, 12, 13, 14, 15].map((s) => commandDigest(playMission('noisy', s))));
    expect(digests.size).toBeGreaterThanOrEqual(2);
  });
});

// 한 줄 목적: 내장 시나리오 정의(이름·설명·턴 수·승리 규칙)를 데이터로 제공한다
import type { BuiltinScenarioId, GameState } from './types';

export interface ScenarioDefinition {
  id: BuiltinScenarioId;
  name: string;
  /** 한 줄 설명(설정 화면·결과 화면 표시용) */
  description: string;
  maxTurns: number;
  victory: 'conquest' | 'crown-hold';
  /** crown-hold: 왕관 요새를 이 턴 수만큼 연속 보유하면 승리 */
  crownHoldTurns?: number;
  /** crown-hold: 이 라운드부터 연속 보유 카운트가 시작된다(활성화 지연). */
  crownActivationTurn?: number;
}

export const SCENARIOS: Record<BuiltinScenarioId, ScenarioDefinition> = {
  'three-crowns': {
    id: 'three-crowns',
    name: '세 왕관 전쟁',
    description: '표준 전장. 적 수도를 모두 점령하거나 12턴 뒤 최고 점수로 승리',
    maxTurns: 12,
    victory: 'conquest',
  },
  'broken-strait': {
    id: 'broken-strait',
    name: '갈라진 해협',
    description: '해협이 섬을 가른다. 좁은 육교의 병목을 장악하라',
    maxTurns: 12,
    victory: 'conquest',
  },
  'crown-heart': {
    id: 'crown-heart',
    name: '왕관의 심장',
    description: '중앙 왕관 요새를 4턴 연속 보유하면 즉시 승리',
    maxTurns: 14,
    victory: 'crown-hold',
    crownHoldTurns: 4,
    crownActivationTurn: 3,
  },
};

export const SCENARIO_IDS: BuiltinScenarioId[] = ['three-crowns', 'broken-strait', 'crown-heart'];

export function isBuiltinScenarioId(id: string): id is BuiltinScenarioId {
  return (SCENARIO_IDS as string[]).includes(id);
}

/** 내장·커스텀을 아우르는 시나리오 표시 이름. 커스텀은 스냅샷 제목을 쓴다. */
export function scenarioDisplayName(id: string, state?: Pick<GameState, 'customScenario'>): string {
  if (isBuiltinScenarioId(id)) return SCENARIOS[id].name;
  return state?.customScenario?.title ?? id;
}

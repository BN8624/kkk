// 한 줄 목적: 캠페인 미션 문서의 유효성·승리 가능성과 진행 저장(해금·최고 기록)을 검증한다
import { beforeEach, describe, expect, it } from 'vitest';

import { runAiTurn } from '../src/core/ai';
import { unitsOf } from '../src/core/board';
import { CAMPAIGNS, missionByScenarioId } from '../src/core/campaign/missions';
import {
  CAMPAIGN_PROGRESS_KEY,
  earnedStars,
  isMissionUnlocked,
  loadCampaignProgress,
  nextMission,
  recordMissionResult,
  saveCampaignProgress,
} from '../src/core/campaign/progress';
import type { CampaignDocument } from '../src/core/campaign/types';
import { FACTION_IDS } from '../src/core/data';
import { newGameFromScenario } from '../src/core/game';
import { normalizeScenario } from '../src/core/scenario/normalize';
import { starsEarned } from '../src/core/scenario/objectives';
import { isPlayable, validateScenario } from '../src/core/scenario/validate';
import type { GameState } from '../src/core/types';

const ALL_MISSIONS = CAMPAIGNS.flatMap((c) => c.missions);

/** 인간 자리를 보통 AI가 대신 플레이해 게임을 끝까지 진행한다. */
function playFullGame(state: GameState): void {
  let guard = 0;
  const maxPhases = (state.maxTurns + 2) * FACTION_IDS.length;
  while (!state.over && guard < maxPhases) {
    guard++;
    const f = state.current;
    runAiTurn(state, f, state.controllers[f] === 'human' ? 'normal' : undefined);
    if (!state.over && state.current === f) throw new Error('페이즈가 진행되지 않습니다');
  }
  if (!state.over) throw new Error('게임이 제한 페이즈 안에 끝나지 않았습니다');
}

describe('캠페인 미션 문서', () => {
  it('왕국별 3개씩 총 9개 미션이 선행 미션 사슬로 이어진다', () => {
    expect(CAMPAIGNS).toHaveLength(3);
    for (const c of CAMPAIGNS) {
      expect(c.missions).toHaveLength(3);
      expect(c.missions[0].requires).toBeNull();
      expect(c.missions[1].requires).toBe(c.missions[0].id);
      expect(c.missions[2].requires).toBe(c.missions[1].id);
      for (const m of c.missions) {
        expect(m.intro.length).toBeGreaterThan(0);
        expect(m.completionText.length).toBeGreaterThan(0);
      }
    }
  });

  it('모든 미션이 검증을 통과하고 정규화된다', () => {
    expect(ALL_MISSIONS.length).toBe(9);
    for (const m of ALL_MISSIONS) {
      const issues = validateScenario(m.scenario);
      expect(
        issues.filter((i) => i.severity === 'error').map((i) => `${m.id}:${i.code}:${i.message}`),
      ).toEqual([]);
      expect(isPlayable(issues)).toBe(true);
      expect(() => normalizeScenario(m.scenario)).not.toThrow();
    }
  });

  it('미션 id·시나리오 id가 중복되지 않고 승리 조건 구성이 서로 다르다', () => {
    const ids = ALL_MISSIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const scenarioIds = ALL_MISSIONS.map((m) => m.scenario.id);
    expect(new Set(scenarioIds).size).toBe(scenarioIds.length);
    const victoryShapes = ALL_MISSIONS.map((m) => JSON.stringify(m.scenario.victoryConditions));
    expect(new Set(victoryShapes).size).toBe(victoryShapes.length);
    for (const m of ALL_MISSIONS) {
      expect(missionByScenarioId(m.scenario.id)?.mission.id).toBe(m.id);
    }
  });

  it('모든 미션이 AI 대체 플레이로 종료 가능하고 여러 시드 중 승리가 존재한다', () => {
    for (const m of ALL_MISSIONS) {
      const snapshot = normalizeScenario(m.scenario);
      let wins = 0;
      let starsOnWin = 0;
      for (let i = 0; i < 4; i++) {
        const state = newGameFromScenario(90_000 + i * 977, snapshot, {
          mode: 'campaign',
          difficulty: 'normal',
        });
        const human = state.config.humanFaction;
        playFullGame(state);
        expect(state.over).toBe(true);
        if (state.winner === human) {
          wins++;
          starsOnWin = Math.max(
            starsOnWin,
            starsEarned(state).filter(Boolean).length,
          );
        }
      }
      // 승리 가능성: 보통 AI가 4시드 중 최소 1승, 승리 시 별 1개 이상
      expect(wins, `${m.id} 승리 불가`).toBeGreaterThanOrEqual(1);
      expect(starsOnWin, `${m.id} 별 없음`).toBeGreaterThanOrEqual(1);
    }
  });

  it('시작 즉시 승패가 나지 않는다', () => {
    for (const m of ALL_MISSIONS) {
      const state = newGameFromScenario(7, normalizeScenario(m.scenario), { mode: 'campaign' });
      expect(state.over).toBe(false);
      expect(unitsOf(state, state.config.humanFaction).length).toBeGreaterThan(0);
    }
  });
});

describe('캠페인 진행 저장', () => {
  beforeEach(() => {
    // node 환경에는 localStorage가 없으므로 메모리 구현을 주입한다
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    };
    localStorage.removeItem(CAMPAIGN_PROGRESS_KEY);
  });

  const fakeCampaign: CampaignDocument = {
    schemaVersion: 1,
    id: 'campaign-test',
    faction: 'azure',
    title: 't',
    description: '',
    missions: [
      { id: 'm1', title: '1', intro: '', scenario: ALL_MISSIONS[0].scenario, requires: null, completionText: '' },
      { id: 'm2', title: '2', intro: '', scenario: ALL_MISSIONS[1].scenario, requires: 'm1', completionText: '' },
    ],
  };

  it('선행 미션 승리로 다음 미션이 해금된다', () => {
    let p = loadCampaignProgress();
    expect(isMissionUnlocked(fakeCampaign, p, 'm1')).toBe(true);
    expect(isMissionUnlocked(fakeCampaign, p, 'm2')).toBe(false);
    p = recordMissionResult(p, 'm1', {
      won: false, stars: 0, score: 10, turns: 8, survivors: 2, playedAt: '2026-07-19T00:00:00Z',
    });
    expect(isMissionUnlocked(fakeCampaign, p, 'm2')).toBe(false); // 패배로는 해금되지 않는다
    p = recordMissionResult(p, 'm1', {
      won: true, stars: 2, score: 30, turns: 9, survivors: 3, playedAt: '2026-07-19T01:00:00Z',
    });
    expect(isMissionUnlocked(fakeCampaign, p, 'm2')).toBe(true);
    expect(nextMission(fakeCampaign, 'm1')?.id).toBe('m2');
    expect(nextMission(fakeCampaign, 'm2')).toBeNull();
  });

  it('최고 기록은 단조 갱신되고 최단 턴은 승리 기준이다', () => {
    let p = loadCampaignProgress();
    p = recordMissionResult(p, 'm1', {
      won: true, stars: 2, score: 30, turns: 10, survivors: 3, playedAt: 'a',
    });
    p = recordMissionResult(p, 'm1', {
      won: false, stars: 3, score: 50, turns: 4, survivors: 5, playedAt: 'b',
    });
    const m = p.missions.m1;
    expect(m.won).toBe(true);
    expect(m.bestStars).toBe(2); // 패배 판의 별은 세지 않는다
    expect(m.bestScore).toBe(50);
    expect(m.bestTurns).toBe(10); // 패배 판의 턴은 최단 기록이 아니다
    expect(m.bestSurvivors).toBe(5);
    expect(m.lastPlayed).toBe('b');
    expect(earnedStars(fakeCampaign, p)).toBe(2);
  });

  it('저장 왕복·손상 데이터 안전 처리', () => {
    let p = loadCampaignProgress();
    p = recordMissionResult(p, 'm1', {
      won: true, stars: 3, score: 99, turns: 6, survivors: 4, playedAt: 'x',
    });
    saveCampaignProgress(p);
    expect(loadCampaignProgress()).toEqual(p);
    localStorage.setItem(CAMPAIGN_PROGRESS_KEY, '{broken');
    expect(loadCampaignProgress()).toEqual({ version: 1, missions: {} });
    localStorage.setItem(CAMPAIGN_PROGRESS_KEY, JSON.stringify({ version: 99, missions: {} }));
    expect(loadCampaignProgress()).toEqual({ version: 1, missions: {} });
  });
});

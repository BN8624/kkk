// 한 줄 목적: 왕관 상태 헬퍼·적 왕관 임박 저지 AI·비왕관 시나리오 회귀를 검증한다
import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/core/ai';
import { tileAt, unitsOf } from '../src/core/board';
import { advancePhase, newGame } from '../src/core/game';
import { hexDistance, neighbors } from '../src/core/hex';
import { crownStatus } from '../src/core/scenario/crown-status';
import type { GameState } from '../src/core/types';
import { addUnit, makeState } from './helpers';

/** 세 세력 페이즈를 모두 넘겨 라운드 종료 보유 판정을 유발한다. */
function endRound(state: GameState): void {
  advancePhase(state);
  advancePhase(state);
  advancePhase(state);
}

/** hold-building 왕관 미니 상태를 조립한다. */
function makeCrownState(opts: {
  turn?: number;
  activationTurn?: number;
  need?: number;
  owner?: 'azure' | 'crimson' | 'violet' | null;
  held?: number;
  difficulty?: 'easy' | 'normal' | 'hard';
}): GameState {
  const need = opts.need ?? 4;
  const state = makeState({
    difficulty: opts.difficulty ?? 'normal',
    scenario: 'crown-heart',
    humanFaction: 'azure',
  });
  state.turn = opts.turn ?? 5;
  state.maxTurns = 14;
  const crown = tileAt(state, 2, 2)!;
  crown.building = 'crown';
  if (opts.owner) crown.owner = opts.owner;
  else delete crown.owner;
  state.objectives.victory = [
    {
      type: 'hold-building',
      at: { q: 2, r: 2 },
      turns: need,
      ...(opts.activationTurn !== undefined ? { activationTurn: opts.activationTurn } : {}),
    },
  ];
  state.crownHold = { owner: opts.owner ?? null, turns: opts.held ?? 0 };
  // 탈락 방지용 원거리 유닛
  addUnit(state, { faction: 'violet', q: -2, r: 4 });
  return state;
}

describe('crownStatus 순수 함수', () => {
  it('활성화 전에는 active=false 이고 turnsToActivate·예상 턴을 계산한다', () => {
    const state = makeCrownState({
      turn: 1,
      activationTurn: 3,
      need: 4,
      owner: 'azure',
      held: 0,
    });
    const cs = crownStatus(state)!;
    expect(cs.active).toBe(false);
    expect(cs.turnsToActivate).toBe(2);
    expect(cs.owner).toBe('azure');
    expect(cs.heldTurns).toBe(0);
    expect(cs.needTurns).toBe(4);
    expect(cs.contested).toBe(false);
    expect(cs.earliestWinTurn).toBe(3 + 4 - 1);
  });

  it('활성화 후 소유·비경합이면 earliestWinTurn = turn + need - held - 1', () => {
    const state = makeCrownState({
      turn: 6,
      activationTurn: 3,
      need: 4,
      owner: 'crimson',
      held: 2,
    });
    addUnit(state, { faction: 'crimson', q: 2, r: 2 }); // 주둔
    const cs = crownStatus(state)!;
    expect(cs.active).toBe(true);
    expect(cs.turnsToActivate).toBe(0);
    expect(cs.garrisoned).toBe(true);
    expect(cs.contested).toBe(false);
    // turn=6 held=2 need=4 → 6라운드 종료 3, 7라운드 종료 4 → 7턴 승리
    expect(cs.earliestWinTurn).toBe(6 + 4 - 2 - 1);
  });

  it('earliestWinTurn 예측이 엔진 실제 승리 턴과 일치한다', () => {
    const state = makeCrownState({
      turn: 6,
      activationTurn: 3,
      need: 4,
      owner: 'crimson',
      held: 2,
    });
    addUnit(state, { faction: 'crimson', q: 2, r: 2 }); // 주둔·비경합 유지
    const predicted = crownStatus(state)!.earliestWinTurn;
    expect(predicted).not.toBeNull();

    // 소유·비경합을 유지한 채 라운드를 진행해 엔진 winner 확정 턴과 비교
    let guard = 0;
    while (!state.over && guard < 20) {
      endRound(state);
      guard++;
    }
    expect(state.over).toBe(true);
    expect(state.winner).toBe('crimson');
    // 승리 시 advancePhase는 turn++ 전에 return → state.turn 이 확정 턴
    expect(state.turn).toBe(predicted);
  });

  it('인접 적 + 비주둔이면 contested=true 이고 예측은 null', () => {
    const state = makeCrownState({
      turn: 6,
      activationTurn: 3,
      need: 4,
      owner: 'azure',
      held: 2,
    });
    // 주둔 없음, 인접 적
    addUnit(state, { faction: 'crimson', q: 3, r: 2 });
    const cs = crownStatus(state)!;
    expect(cs.garrisoned).toBe(false);
    expect(cs.contested).toBe(true);
    expect(cs.earliestWinTurn).toBeNull();
  });

  it('주둔이 있으면 인접 적이 있어도 비경합', () => {
    const state = makeCrownState({
      turn: 6,
      activationTurn: 3,
      need: 4,
      owner: 'azure',
      held: 1,
    });
    addUnit(state, { faction: 'azure', q: 2, r: 2 });
    addUnit(state, { faction: 'crimson', q: 3, r: 2 });
    const cs = crownStatus(state)!;
    expect(cs.garrisoned).toBe(true);
    expect(cs.contested).toBe(false);
  });

  it('hold-building 이 없으면 null', () => {
    const state = makeState({ scenario: 'three-crowns' });
    expect(crownStatus(state)).toBeNull();
  });
});

describe('적 왕관 임박 저지 AI', () => {
  it('적이 need-1 턴 보유 시 방어 세력 유닛이 왕관 위 또는 인접으로 이동한다', () => {
    const need = 4;
    const state = makeCrownState({
      turn: 8,
      activationTurn: 3,
      need,
      owner: 'crimson',
      held: need - 1,
      difficulty: 'normal',
    });
    // 적 왕관 점령(주둔 없음) — 카운트 임박
    // 방어 세력(azure) 유닛을 왕관 2칸 거리에 배치(한 턴에 인접/점령 가능)
    const defender = addUnit(state, { faction: 'azure', q: 2, r: 4, type: 'infantry' });
    // 적 유닛은 왕관에서 멀리 — 저지 경로를 막지 않음
    addUnit(state, { faction: 'crimson', q: -2, r: 0 });

    state.current = 'azure';
    state.controllers.azure = 'ai';
    runAiTurn(state, 'azure');

    const after = unitsOf(state, 'azure').find((u) => u.id === defender.id)!;
    const onCrown = after.q === 2 && after.r === 2;
    const adjacent = neighbors({ q: 2, r: 2 }).some((n) => n.q === after.q && n.r === after.r);
    expect(onCrown || adjacent, `unit ended at (${after.q},${after.r})`).toBe(true);
  });

  it('hard 에서도 임박 저지를 수행한다', () => {
    const need = 4;
    const state = makeCrownState({
      turn: 8,
      activationTurn: 3,
      need,
      owner: 'crimson',
      held: need - 1,
      difficulty: 'hard',
    });
    const defender = addUnit(state, { faction: 'azure', q: 4, r: 2, type: 'cavalry' });
    addUnit(state, { faction: 'crimson', q: -2, r: 0 });
    state.current = 'azure';
    runAiTurn(state, 'azure', 'hard');
    const after = unitsOf(state, 'azure').find((u) => u.id === defender.id)!;
    const dist = hexDistance(after, { q: 2, r: 2 });
    expect(dist, `unit ended at (${after.q},${after.r}) dist=${dist}`).toBeLessThanOrEqual(1);
  });
});

describe('비왕관 시나리오 회귀', () => {
  it('three-crowns 에서 왕관 저지 로직이 AI 턴을 깨지 않는다', () => {
    const state = newGame(42, {
      scenario: 'three-crowns',
      difficulty: 'normal',
      humanFaction: 'azure',
    });
    // 인간 턴 스킵 → AI
    state.current = 'crimson';
    const before = unitsOf(state, 'crimson').map((u) => ({ id: u.id, q: u.q, r: u.r }));
    expect(crownStatus(state)).toBeNull();
    const result = runAiTurn(state, 'crimson');
    expect(result.commands.some((c) => c.type === 'end-phase')).toBe(true);
    expect(result.commands.length).toBeGreaterThan(0);
    // 유닛 좌표가 여전히 유효
    for (const u of unitsOf(state, 'crimson')) {
      expect(tileAt(state, u.q, u.r)).toBeTruthy();
    }
    // 스모크: 시작 유닛이 있었고 턴이 깨지지 않음
    expect(before.length).toBeGreaterThan(0);
    expect(state.factions.crimson.eliminated).toBe(false);
  });
});

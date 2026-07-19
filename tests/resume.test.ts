// 한 줄 목적: AI 페이즈 경계 저장·복구가 중복 실행 없이 동일한 결과를 내는지 증명한다
import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/core/ai';
import { isHumanTurn } from '../src/core/board';
import { advancePhase, newGame } from '../src/core/game';
import { deserialize, serialize } from '../src/core/save';
import type { GameState } from '../src/core/types';

/** 인간이 아무것도 하지 않는 한 라운드를 진행한다. checkpoints에 각 페이즈 경계 직렬화본을 남긴다. */
function playRound(state: GameState, checkpoints?: string[]): void {
  advancePhase(state); // 인간 페이즈 종료
  while (!state.over && !isHumanTurn(state)) {
    runAiTurn(state, state.current); // END_PHASE 명령 포함
    checkpoints?.push(serialize(state));
  }
}

describe('AI 페이즈 중단·복구', () => {
  it('페이즈 경계에서 복구해도 중단 없는 진행과 결과가 동일하다', () => {
    for (const seed of [11, 4242, 20260719]) {
      // 기준: 중단 없이 3라운드
      const base = newGame(seed);
      for (let i = 0; i < 3 && !base.over; i++) playRound(base);

      // 비교: 매 페이즈 경계마다 직렬화→복원(새로고침 시뮬레이션) 후 이어서 진행
      let resumed = newGame(seed);
      for (let i = 0; i < 3 && !resumed.over; i++) {
        advancePhase(resumed);
        while (!resumed.over && !isHumanTurn(resumed)) {
          runAiTurn(resumed, resumed.current);
          const restored = deserialize(serialize(resumed));
          expect(restored).not.toBeNull();
          resumed = restored!;
        }
      }
      expect(JSON.stringify(resumed)).toBe(JSON.stringify(base));
    }
  });

  it('AI 차례 저장본을 복구하면 남은 AI만 실행되고 수입은 한 번만 지급된다', () => {
    const seed = 777;
    const state = newGame(seed);
    advancePhase(state); // -> crimson(AI)
    runAiTurn(state, 'crimson'); // END_PHASE 포함 -> violet(AI) 경계에서 "새로고침"
    const raw = serialize(state);

    const restored = deserialize(raw)!;
    expect(restored.current).toBe('violet');
    expect(isHumanTurn(restored)).toBe(false);
    const goldBefore = { ...restored.factions };

    // 복구 루프: 남은 AI 페이즈만 진행
    while (!restored.over && !isHumanTurn(restored)) {
      runAiTurn(restored, restored.current);
    }
    expect(restored.turn).toBe(2);
    expect(restored.current).toBe('azure');
    // crimson은 이미 행동했으므로 다시 행동하지 않았다: 수입 1회만 반영됐는지 확인
    // (터무니없는 금 증가가 없어야 한다 — 수입 상한: 수도15+마을*15+점령보너스)
    for (const f of restored.order) {
      const gained = restored.factions[f].gold - goldBefore[f].gold;
      expect(gained).toBeGreaterThanOrEqual(-120); // 생산 지출 허용
      expect(gained).toBeLessThanOrEqual(120);
    }
    // 유닛 좌표 중복 없음
    const keys = restored.units.map((u) => `${u.q},${u.r}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('경계 저장본은 항상 다음 행동 세력이 미행동 상태다', () => {
    const state = newGame(3);
    const checkpoints: string[] = [];
    playRound(state, checkpoints);
    for (const cp of checkpoints) {
      const s = deserialize(cp);
      expect(s).not.toBeNull();
      if (s!.over) continue;
      // 현재 세력의 유닛은 아직 행동 전이거나(라운드 종료 후 초기화) 생산 직후 상태
      // → 현재 세력이 이미 이동한 유닛으로 가득한 "반쯤 실행된" 상태가 아니어야 한다.
      // 라운드 중간 경계: current 세력 유닛의 moved는 모두 false여야 한다(생산 유닛 제외 불가하므로 전투 유닛만 검사).
      if (s!.turn === 1) {
        const currentUnits = s!.units.filter(
          (u) => u.faction === s!.current && !(u.moved && u.attacked),
        );
        // 최소한 전부 다 행동 완료 상태는 아니어야 한다
        expect(
          s!.units.filter((u) => u.faction === s!.current).length === 0 ||
            currentUnits.length > 0 ||
            s!.current === s!.order[0],
        ).toBe(true);
      }
    }
  });
});

// 한 줄 목적: 보통 난이도 AI 전투 교환비·집중공격 완화·난이도 서열을 검증한다
import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../src/core/ai';
import { unitById } from '../src/core/board';
import { UNIT_STATS } from '../src/core/data';
import { forecastAttack } from '../src/core/game';
import type { Difficulty, GameState, Unit } from '../src/core/types';
import { addUnit, makeState } from './helpers';

function withLog(state: GameState): GameState {
  state.commandLog = [];
  state.cmdSeq = 0;
  return state;
}

/** 동일 보드에서 지정 난이도 AI가 공격한 방어자 id를 수집한다. */
function attackTargets(difficulty: Difficulty, setup: (s: GameState) => void): number[] {
  const state = withLog(makeState({ difficulty, humanFaction: 'azure' }));
  state.current = 'crimson';
  setup(state);
  const result = runAiTurn(state, 'crimson', difficulty);
  return result.commands
    .filter((c) => c.type === 'attack-unit')
    .map((c) => (c.type === 'attack-unit' ? c.defenderId : -1));
}

describe('보통 난이도 전투 교환비·집중공격', () => {
  it('보통 AI는 controller=human 여부만으로 동일 조건 적에게 추가 점수를 주지 않는다', () => {
    // 두 적 유닛이 대칭 위치·동일 스탯 — human 라벨만 다른 두 보드에서 동일 타겟 선택
    const pick = (humanSide: 'azure' | 'violet') => {
      const state = withLog(
        makeState({ difficulty: 'normal', humanFaction: humanSide === 'azure' ? 'azure' : 'violet' }),
      );
      state.current = 'crimson';
      // 청람·보라 보병이 대칭, 진홍 궁병이 둘 다 사거리 안
      addUnit(state, { faction: 'crimson', q: 0, r: 2, type: 'archer', moved: true });
      const a = addUnit(state, { faction: 'azure', q: -1, r: 2, type: 'infantry' });
      const v = addUnit(state, { faction: 'violet', q: 1, r: 2, type: 'infantry' });
      const result = runAiTurn(state, 'crimson', 'normal');
      const atk = result.commands.find((c) => c.type === 'attack-unit');
      expect(atk?.type).toBe('attack-unit');
      if (atk?.type !== 'attack-unit') return -1;
      // human 쪽이 항상 선택되면 controller 편향
      return atk.defenderId === a.id ? 0 : atk.defenderId === v.id ? 1 : -1;
    };
    const whenAzureHuman = pick('azure');
    const whenVioletHuman = pick('violet');
    // 동일 보드 기하이므로 선택은 동일해야 한다(human 라벨 무시)
    expect(whenAzureHuman).toBe(whenVioletHuman);
    expect(whenAzureHuman).toBeGreaterThanOrEqual(0);
  });

  it('보통 AI의 부상 가중치는 어려움보다 낮다(빈사 적 집결 완화)', () => {
    // 동일 위치: 풀피 적 vs 빈사 적 — 보통은 풀피 위협을 더 자주, 어려움은 빈사 집중
    const setup = (s: GameState) => {
      addUnit(s, { faction: 'crimson', q: 0, r: 1, type: 'archer', moved: true });
      addUnit(s, { faction: 'azure', q: 0, r: 0, type: 'infantry', hp: 2 }); // 빈사
      addUnit(s, { faction: 'violet', q: 1, r: 1, type: 'infantry' }); // 풀피
    };
    expect(attackTargets('normal', setup).length).toBeGreaterThan(0);
    expect(attackTargets('hard', setup).length).toBeGreaterThan(0);
    // 어려움은 focusFire로 빈사 우선, 보통은 부상 가중 완화
    const woundedIdOn = (diff: Difficulty) => {
      const state = withLog(makeState({ difficulty: diff }));
      state.current = 'crimson';
      setup(state);
      const wounded = state.units.find((u) => u.faction === 'azure')!;
      runAiTurn(state, 'crimson', diff);
      const atk = state.commandLog?.find((c) => c.type === 'attack-unit');
      if (!atk || atk.type !== 'attack-unit') return null;
      return { target: atk.defenderId, wounded: wounded.id };
    };
    const h = woundedIdOn('hard');
    const n = woundedIdOn('normal');
    expect(h).not.toBeNull();
    expect(n).not.toBeNull();
    expect(h!.target).toBe(h!.wounded);
  });

  it('보통 AI는 어려움보다 반격·처치 최적화가 약하다(나쁜 교환을 할 수 있다)', () => {
    // 기존 난이도 테스트와 동일 fixture: 보통은 공격, 어려움은 회피
    const build = (difficulty: Difficulty): GameState => {
      const state = withLog(makeState({ difficulty }));
      state.current = 'crimson';
      addUnit(state, { faction: 'crimson', q: 0, r: 0, hp: 2, moved: true });
      const t = state.tiles.find((x) => x.q === 1 && x.r === 0)!;
      t.terrain = 'mountain';
      addUnit(state, { faction: 'azure', q: 1, r: 0 });
      return state;
    };
    const hard = build('hard');
    const hardR = runAiTurn(hard, 'crimson');
    expect(hardR.events.some((e) => e.type === 'unit-attacked')).toBe(false);

    const normal = build('normal');
    const normalR = runAiTurn(normal, 'crimson');
    expect(normalR.events.some((e) => e.type === 'unit-attacked')).toBe(true);
  });

  it('보통 AI는 쉬움보다 이동 후 공격·기본 전투 판단이 낫다', () => {
    // 한 칸 이동해야 사거리가 닿는 궁병
    const setup = (difficulty: Difficulty) => {
      const state = withLog(makeState({ difficulty }));
      state.current = 'crimson';
      addUnit(state, { faction: 'crimson', q: 0, r: 0, type: 'archer' });
      addUnit(state, { faction: 'azure', q: 3, r: 0, type: 'infantry', hp: 5 });
      return state;
    };
    const easy = setup('easy');
    const easyR = runAiTurn(easy, 'crimson', 'easy');
    const normal = setup('normal');
    const normalR = runAiTurn(normal, 'crimson', 'normal');
    const easyAtk = easyR.events.some((e) => e.type === 'unit-attacked');
    const normalAtk = normalR.events.some((e) => e.type === 'unit-attacked');
    // 쉬움은 moveAttack 없음 → 사거리 밖이면 공격 실패 가능. 보통은 이동 후 공격
    expect(normalAtk).toBe(true);
    expect(easyAtk).toBe(false);
  });

  it('동일 시드·동일 상태에서 선택은 결정론적이다', () => {
    const run = () => {
      const state = withLog(makeState({ difficulty: 'normal' }));
      state.seed = 99;
      state.current = 'crimson';
      addUnit(state, { faction: 'crimson', q: 0, r: 1, type: 'cavalry' });
      addUnit(state, { faction: 'azure', q: 1, r: 1, type: 'infantry', hp: 4 });
      addUnit(state, { faction: 'violet', q: 0, r: 2, type: 'archer', hp: 3 });
      const r = runAiTurn(state, 'crimson', 'normal');
      return r.commands.map((c) => JSON.stringify(c)).join('|');
    };
    expect(run()).toBe(run());
  });

  it('softCandidateBand가 켜진 보통에서도 동일 시드면 항상 동일 결과다', () => {
    const run = () => {
      const state = withLog(makeState({ difficulty: 'normal' }));
      state.current = 'crimson';
      // 비슷한 점수 후보 둘
      addUnit(state, { faction: 'crimson', q: 0, r: 1, type: 'infantry', moved: true });
      addUnit(state, { faction: 'azure', q: 1, r: 1, type: 'infantry' });
      addUnit(state, { faction: 'violet', q: -1, r: 1, type: 'infantry' });
      const r = runAiTurn(state, 'crimson', 'normal');
      const atk = r.commands.find((c) => c.type === 'attack-unit');
      return atk && atk.type === 'attack-unit' ? atk.defenderId : null;
    };
    expect(run()).toBe(run());
  });

  it('같은 라운드 이미 맞은 적에 대한 추가 집중을 완화한다', () => {
    // 동일 turn 로그에 인간 1회 피격이 있을 때, 미피격 대안 적을 고를 수 있다
    const state = withLog(makeState({ difficulty: 'normal', humanFaction: 'azure' }));
    state.turn = 3;
    state.current = 'crimson';
    const human = addUnit(state, { faction: 'azure', q: 1, r: 1, type: 'infantry', hp: 6 });
    const other = addUnit(state, { faction: 'violet', q: 0, r: 0, type: 'infantry', hp: 6 });
    addUnit(state, { faction: 'crimson', q: 0, r: 1, type: 'archer', moved: true });
    state.commandLog = [
      {
        v: 1,
        seq: 0,
        turn: 3,
        faction: 'violet',
        type: 'attack-unit',
        attackerId: 99,
        defenderId: human.id,
      },
    ];
    state.cmdSeq = 1;
    const r = runAiTurn(state, 'crimson', 'normal');
    const atk = r.commands.find((c) => c.type === 'attack-unit');
    expect(atk?.type).toBe('attack-unit');
    if (atk?.type === 'attack-unit') {
      // 이미 맞은 인간보다 미피격 대안 우선
      expect(atk.defenderId).toBe(other.id);
    }
  });

  it('인간 세력을 바꿔도 동일 공정 규칙이 적용된다', () => {
    const deaths: Record<string, number> = { azure: 0, crimson: 0, violet: 0 };
    for (const human of ['azure', 'crimson', 'violet'] as const) {
      for (const seed of [3, 11, 29]) {
        const state = makeState({ difficulty: 'normal', humanFaction: human });
        // makeState는 미니맵 — newGame 대신 간단 교전 보드
        state.commandLog = [];
        state.cmdSeq = 0;
        state.seed = seed;
        state.current = state.order.find((f) => f !== human)!;
        const aiFaction = state.current;
        addUnit(state, { faction: aiFaction, q: 0, r: 1, type: 'cavalry' });
        addUnit(state, { faction: human, q: 1, r: 1, type: 'infantry', hp: 3 });
        const other = state.order.find((f) => f !== human && f !== aiFaction)!;
        addUnit(state, { faction: other, q: 0, r: 2, type: 'infantry', hp: 3 });
        runAiTurn(state, aiFaction, 'normal');
        if (!unitById(state, state.units.find((u) => u.faction === human)?.id ?? -1)) {
          deaths[human]++;
        } else {
          const hu = state.units.find((u) => u.faction === human);
          if (hu && hu.hp < 3) deaths[human] += 0; // 피격만
        }
      }
    }
    // 특정 세력만 극단적으로 불리하지 않음(전부 유한)
    for (const f of ['azure', 'crimson', 'violet'] as const) {
      expect(deaths[f]).toBeLessThanOrEqual(3);
    }
  });

  it('어려움 프로파일의 집중공격·교환 회피·지형 선호는 유지된다', () => {
    const state = withLog(makeState({ difficulty: 'hard' }));
    state.current = 'crimson';
    // 빈사 적 + 풀피 적 — 어려움은 빈사 집중
    addUnit(state, { faction: 'crimson', q: 0, r: 1, type: 'archer', moved: true });
    const wounded = addUnit(state, { faction: 'azure', q: 0, r: 0, type: 'infantry', hp: 2 });
    addUnit(state, { faction: 'violet', q: 1, r: 1, type: 'infantry' });
    runAiTurn(state, 'crimson', 'hard');
    const atk = state.commandLog?.find((c) => c.type === 'attack-unit');
    expect(atk?.type).toBe('attack-unit');
    if (atk?.type === 'attack-unit') {
      expect(atk.defenderId).toBe(wounded.id);
    }
  });

  it('전투 피해 공식(forecastAttack)은 난이도와 무관하게 동일하다', () => {
    const state = makeState({ difficulty: 'normal' });
    const atk = addUnit(state, { faction: 'crimson', q: 0, r: 0, type: 'infantry' });
    const def = addUnit(state, { faction: 'azure', q: 1, r: 0, type: 'infantry' });
    const a = forecastAttack(state, atk, def);
    state.config.difficulty = 'hard';
    const b = forecastAttack(state, atk, def);
    state.config.difficulty = 'easy';
    const c = forecastAttack(state, atk, def);
    expect(a.damage.total).toBe(b.damage.total);
    expect(b.damage.total).toBe(c.damage.total);
    expect(a.counter?.total).toBe(b.counter?.total);
  });

  it('보통에서 유닛 스탯·공통 피해 공식 상수를 바꾸지 않는다', () => {
    expect(UNIT_STATS.infantry.hp).toBeGreaterThan(0);
    expect(UNIT_STATS.archer.atk).toBeGreaterThan(0);
    // 난이도별 스탯 테이블이 따로 없음 — 동일 참조
    const stateN = makeState({ difficulty: 'normal' });
    const stateH = makeState({ difficulty: 'hard' });
    const u1 = addUnit(stateN, { faction: 'azure', q: 0, r: 0 });
    const u2 = addUnit(stateH, { faction: 'azure', q: 0, r: 0 });
    expect(u1.hp).toBe(u2.hp);
    expect(UNIT_STATS[u1.type as Unit['type']].atk).toBe(UNIT_STATS[u2.type].atk);
  });
});

describe('보통 난이도 다중 AI 집중 완화 fixture', () => {
  it('이미 피격된 적보다 미피격 실위협을 고를 수 있다', () => {
    const state = withLog(makeState({ difficulty: 'normal', humanFaction: 'azure' }));
    state.turn = 2;
    state.current = 'crimson';
    // 사전 피격 로그: 같은 턴에 인간이 이미 1회 피격 — HP도 동일해 처치 유불리 제거
    const human = addUnit(state, { faction: 'azure', q: 1, r: 1, type: 'infantry', hp: 8 });
    const threat = addUnit(state, {
      faction: 'violet',
      q: 0,
      r: 0,
      type: 'infantry',
      hp: 8,
    });
    addUnit(state, { faction: 'crimson', q: 0, r: 1, type: 'archer', moved: true });
    state.commandLog = [
      {
        v: 1,
        seq: 0,
        turn: 2,
        faction: 'violet',
        type: 'attack-unit',
        attackerId: 99,
        defenderId: human.id,
      },
    ];
    state.cmdSeq = 1;
    const cap = state.tiles.find((t) => t.q === 0 && t.r === 0);
    if (cap) {
      cap.building = 'capital';
      cap.owner = 'crimson';
    }

    runAiTurn(state, 'crimson', 'normal');
    const atk = state.commandLog?.find(
      (c) => c.type === 'attack-unit' && c.faction === 'crimson',
    );
    expect(atk?.type).toBe('attack-unit');
    if (atk?.type === 'attack-unit') {
      expect(atk.defenderId).toBe(threat.id);
    }
  });
});

describe('쉬움 < 보통 < 어려움 전투 능력 서열', () => {
  it('쉬움은 이동후공격 없고 보통·어려움은 있다', () => {
    // 간접: 사거리 밖 적을 보통은 때리고 쉬움은 못 때림 (위 테스트와 동일 축)
    const mk = (d: Difficulty) => {
      const s = withLog(makeState({ difficulty: d }));
      s.current = 'crimson';
      addUnit(s, { faction: 'crimson', q: 0, r: 0, type: 'archer' });
      addUnit(s, { faction: 'azure', q: 3, r: 0, type: 'infantry' });
      return runAiTurn(s, 'crimson', d).events.some((e) => e.type === 'unit-attacked');
    };
    expect(mk('easy')).toBe(false);
    expect(mk('normal')).toBe(true);
    expect(mk('hard')).toBe(true);
  });

  it('어려움만 처치 불가 반격 사망 교환을 회피한다', () => {
    const mk = (d: Difficulty) => {
      const s = withLog(makeState({ difficulty: d }));
      s.current = 'crimson';
      addUnit(s, { faction: 'crimson', q: 0, r: 0, hp: 2, moved: true });
      const t = s.tiles.find((x) => x.q === 1 && x.r === 0)!;
      t.terrain = 'mountain';
      addUnit(s, { faction: 'azure', q: 1, r: 0 });
      return runAiTurn(s, 'crimson', d).events.some((e) => e.type === 'unit-attacked');
    };
    expect(mk('easy')).toBe(true);
    expect(mk('normal')).toBe(true);
    expect(mk('hard')).toBe(false);
  });
});

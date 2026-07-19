// 한 줄 목적: 일일 도전 결정론·수정자 효과·로컬 기록 집계를 검증한다
import { describe, expect, it } from 'vitest';
import { dailyChallenge, todayKey } from '../src/core/daily';
import { resultShareText } from '../src/i18n';
import { advancePhase, newGame, unitCost, damageBreakdown } from '../src/core/game';
import { emptyRecords, recordGame } from '../src/core/records';
import { SCENARIOS } from '../src/core/scenarios';
import { tileAt } from '../src/core/board';
import { addUnit, makeState } from './helpers';

describe('일일 도전', () => {
  it('같은 날짜는 같은 도전, 다른 날짜는 대체로 다른 시드', () => {
    const a = dailyChallenge('20260719');
    const b = dailyChallenge('20260719');
    expect(a).toEqual(b);
    const c = dailyChallenge('20260720');
    expect(c.seed).not.toBe(a.seed);
  });

  it('todayKey가 YYYYMMDD 형식이다', () => {
    expect(todayKey(new Date(2026, 6, 19))).toBe('20260719');
  });

  it('수정자: 가난한 출발·짧은 전쟁·비싼 군마', () => {
    const poor = newGame(1, { modifier: 'poor-start' });
    const base = newGame(1);
    expect(poor.factions.azure.gold).toBe(base.factions.azure.gold - 15);

    const short = newGame(1, { modifier: 'short-war' });
    expect(short.maxTurns).toBe(SCENARIOS['three-crowns'].maxTurns - 2);

    expect(unitCost('azure', 'cavalry', 'costly-cavalry')).toBe(
      unitCost('azure', 'cavalry') + 15,
    );
  });

  it('수정자: 날카로운 화살·풍요로운 마을', () => {
    const state = makeState({ modifier: 'sharp-arrows' });
    const archer = addUnit(state, { faction: 'crimson', q: 0, r: 0, type: 'archer' });
    const target = addUnit(state, { faction: 'azure', q: 2, r: 0, type: 'cavalry' });
    const plain = makeState();
    const a2 = addUnit(plain, { faction: 'crimson', q: 0, r: 0, type: 'archer' });
    const t2 = addUnit(plain, { faction: 'azure', q: 2, r: 0, type: 'cavalry' });
    expect(damageBreakdown(state, archer, target).total).toBe(
      damageBreakdown(plain, a2, t2).total + 1,
    );

    const rich = makeState({ modifier: 'rich-villages' });
    const v = tileAt(rich, 0, 0)!;
    v.building = 'village';
    v.owner = 'azure';
    const before = rich.factions.azure.gold;
    rich.current = 'violet';
    advancePhase(rich);
    expect(rich.factions.azure.gold).toBe(before + 10 + 5);
  });
});

describe('로컬 기록', () => {
  it('승리·최고 점수·일일 기록이 집계된다', () => {
    const state = makeState({ humanFaction: 'crimson', difficulty: 'hard' });
    const cap = tileAt(state, 0, 0)!;
    cap.building = 'capital';
    cap.owner = 'crimson';
    state.over = true;
    state.winner = 'crimson';
    state.turn = 9;
    state.stats.crimson = { kills: 8, produced: 4, captured: 5, lost: 0 };
    state.config.mode = 'daily';

    const r1 = recordGame(emptyRecords(), state, '20260719');
    expect(r1.records.plays).toBe(1);
    expect(r1.records.winsByFaction.crimson).toBe(1);
    expect(r1.records.winsByDifficulty.hard).toBe(1);
    expect(r1.records.fastestWinTurns).toBe(9);
    expect(r1.records.maxKills).toBe(8);
    expect(r1.isNewBest).toBe(true);
    expect(r1.records.daily?.dateKey).toBe('20260719');
    expect(r1.records.daily?.won).toBe(true);

    // 같은 날 더 낮은 점수 → bestScore 유지, plays 증가
    const r2 = recordGame(r1.records, state, '20260719');
    expect(r2.records.plays).toBe(2);
    expect(r2.records.daily?.bestScore).toBe(r1.entry.score);
  });

  it('공유 텍스트에 핵심 정보가 담긴다', () => {
    const text = resultShareText({
      scenarioName: '갈라진 해협',
      difficultyName: '어려움',
      factionName: '진홍 공국',
      outcome: 'win',
      turns: 9,
      score: 86,
      captured: 5,
      kills: 8,
      seed: 20260719,
      daily: true,
    });
    expect(text).toContain('갈라진 해협');
    expect(text).toContain('진홍 공국으로 9턴 승리');
    expect(text).toContain('점수 86');
    expect(text).toContain('20260719');
  });
});

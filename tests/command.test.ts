// 한 줄 목적: 정본 명령 실행기의 검증·무변경 실패·이벤트 생성·순번 규칙을 검증한다
import { describe, expect, it } from 'vitest';
import { unitAt, unitById } from '../src/core/board';
import {
  buildCommand,
  executeCommand,
  findEvent,
  issueCommand,
} from '../src/core/command';
import { advancePhase } from '../src/core/game';
import { addUnit, makeState } from './helpers';

describe('명령 실행기', () => {
  it('성공한 이동 명령은 순번을 올리고 unit-moved 이벤트를 만든다', () => {
    const state = makeState();
    const u = addUnit(state, { faction: 'azure', q: 0, r: 0 });
    const r = issueCommand(state, { type: 'move-unit', unitId: u.id, to: { q: 1, r: 0 } });
    expect(r.ok).toBe(true);
    expect(state.cmdSeq).toBe(1);
    expect(r.command.seq).toBe(0);
    const moved = findEvent(r.events, 'unit-moved')!;
    expect(moved.from).toEqual({ q: 0, r: 0 });
    expect(moved.to).toEqual({ q: 1, r: 0 });
    expect(moved.path.length).toBeGreaterThanOrEqual(2);
  });

  it('실패한 명령은 상태를 변경하지 않는다', () => {
    const state = makeState();
    const u = addUnit(state, { faction: 'azure', q: 0, r: 0 });
    const before = JSON.stringify(state);
    // 이동력 밖 좌표
    const r = issueCommand(state, { type: 'move-unit', unitId: u.id, to: { q: 4, r: 4 } });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('out-of-range');
    expect(r.events).toHaveLength(0);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('턴·세력·순번이 맞지 않는 명령을 거부한다', () => {
    const state = makeState();
    const u = addUnit(state, { faction: 'azure', q: 0, r: 0 });
    const wrongTurn = { ...buildCommand(state, { type: 'move-unit', unitId: u.id, to: { q: 1, r: 0 } }), turn: 99 };
    expect(executeCommand(state, wrongTurn).reason).toBe('wrong-turn');
    const wrongFaction = { ...buildCommand(state, { type: 'end-phase' }), faction: 'crimson' as const };
    expect(executeCommand(state, wrongFaction).reason).toBe('wrong-faction');
    const wrongSeq = { ...buildCommand(state, { type: 'end-phase' }), seq: 5 };
    expect(executeCommand(state, wrongSeq).reason).toBe('wrong-seq');
    const badSchema = { ...buildCommand(state, { type: 'end-phase' }), v: 2 as unknown as 1 };
    expect(executeCommand(state, badSchema).reason).toBe('bad-schema');
    // 남의 유닛 명령
    const enemy = addUnit(state, { faction: 'crimson', q: 3, r: 3 });
    const notMine = issueCommand(state, { type: 'move-unit', unitId: enemy.id, to: { q: 2, r: 3 } });
    expect(notMine.reason).toBe('not-your-unit');
    expect(state.cmdSeq ?? 0).toBe(0);
  });

  it('공격 명령이 공격 시점 좌표·반격·사망 이벤트를 보존한다', () => {
    const state = makeState();
    const a = addUnit(state, { faction: 'azure', q: 0, r: 0 });
    const d = addUnit(state, { faction: 'crimson', q: 1, r: 0, hp: 2 });
    const r = issueCommand(state, { type: 'attack-unit', attackerId: a.id, defenderId: d.id });
    expect(r.ok).toBe(true);
    const atk = findEvent(r.events, 'unit-attacked')!;
    expect(atk.from).toEqual({ q: 0, r: 0 });
    expect(atk.at).toEqual({ q: 1, r: 0 });
    expect(atk.damage).toBeGreaterThanOrEqual(1);
    // 처치: 방어자가 상태에서 사라져도 사망 이벤트에 좌표·병과가 남는다
    const died = findEvent(r.events, 'unit-died');
    expect(died).toBeDefined();
    expect(died!.unitId).toBe(d.id);
    expect(died!.at).toEqual({ q: 1, r: 0 });
    expect(unitById(state, d.id)).toBeUndefined();
  });

  it('반격이 일어나면 unit-countered와 공격자 피해 이벤트가 생성된다', () => {
    const state = makeState();
    const a = addUnit(state, { faction: 'azure', q: 0, r: 0 });
    const d = addUnit(state, { faction: 'crimson', q: 1, r: 0 }); // 만피: 반격한다
    const r = issueCommand(state, { type: 'attack-unit', attackerId: a.id, defenderId: d.id });
    expect(r.ok).toBe(true);
    const counter = findEvent(r.events, 'unit-countered')!;
    expect(counter.unitId).toBe(d.id);
    expect(counter.targetId).toBe(a.id);
    expect(counter.at).toEqual({ q: 0, r: 0 });
    const damaged = r.events.filter((e) => e.type === 'unit-damaged');
    expect(damaged).toHaveLength(2);
  });

  it('생산 명령이 unit-produced·gold-changed 이벤트를 만들고 실패 시 금을 유지한다', () => {
    const state = makeState();
    const tile = state.tiles.find((t) => t.q === 0 && t.r === 0)!;
    tile.building = 'capital';
    tile.owner = 'azure';
    const goldBefore = state.factions.azure.gold;
    const r = issueCommand(state, { type: 'produce-unit', at: { q: 0, r: 0 }, unitType: 'infantry' });
    expect(r.ok).toBe(true);
    const produced = findEvent(r.events, 'unit-produced')!;
    expect(produced.cost).toBeGreaterThan(0);
    expect(state.factions.azure.gold).toBe(goldBefore - produced.cost);
    const gold = findEvent(r.events, 'gold-changed')!;
    expect(gold.reason).toBe('production');
    expect(gold.delta).toBe(-produced.cost);
    expect(unitAt(state, 0, 0)).toBeDefined();
    // 타일 점유 상태에서 재생산 실패: 금 무변경
    const g2 = state.factions.azure.gold;
    const r2 = issueCommand(state, { type: 'produce-unit', at: { q: 0, r: 0 }, unitType: 'infantry' });
    expect(r2.ok).toBe(false);
    expect(state.factions.azure.gold).toBe(g2);
  });

  it('end-phase 명령이 라운드 종료 시 수입·턴 시작 이벤트를 만든다', () => {
    const state = makeState();
    const tile = state.tiles.find((t) => t.q === 0 && t.r === 0)!;
    tile.building = 'capital';
    tile.owner = 'azure';
    // 정복 즉시 승리를 막기 위해 상대 수도도 두고, 세 세력 모두 생존 상태를 유지한다
    const enemyCap = state.tiles.find((t) => t.q === 4 && t.r === 0)!;
    enemyCap.building = 'capital';
    enemyCap.owner = 'crimson';
    addUnit(state, { faction: 'azure', q: 2, r: 2 });
    addUnit(state, { faction: 'crimson', q: 4, r: 4 });
    addUnit(state, { faction: 'violet', q: 4, r: 3 });
    // azure → crimson → violet(라운드 종료)
    expect(issueCommand(state, { type: 'end-phase' }).ok).toBe(true);
    expect(state.current).toBe('crimson');
    expect(issueCommand(state, { type: 'end-phase' }).ok).toBe(true);
    const last = issueCommand(state, { type: 'end-phase' });
    expect(last.ok).toBe(true);
    expect(state.turn).toBe(2);
    expect(findEvent(last.events, 'turn-started')?.turn).toBe(2);
    const income = findEvent(last.events, 'income-granted');
    expect(income?.faction).toBe('azure');
    expect(income?.amount).toBeGreaterThan(0);
    expect(state.cmdSeq).toBe(3);
  });

  it('승리 조건 달성 시 game-ended·objective-completed 이벤트가 붙는다', () => {
    const state = makeState();
    state.objectives.victory = [{ type: 'capture-building', at: { q: 1, r: 0 } }];
    const tile = state.tiles.find((t) => t.q === 1 && t.r === 0)!;
    tile.building = 'village';
    const u = addUnit(state, { faction: 'azure', q: 0, r: 0 });
    const r = issueCommand(state, { type: 'move-unit', unitId: u.id, to: { q: 1, r: 0 } });
    expect(r.ok).toBe(true);
    expect(state.over).toBe(true);
    expect(state.winner).toBe('azure');
    expect(findEvent(r.events, 'building-captured')).toBeDefined();
    const ended = findEvent(r.events, 'game-ended')!;
    expect(ended.winner).toBe('azure');
    expect(findEvent(r.events, 'objective-completed')).toBeDefined();
    // 종료 후 명령은 거부된다
    const after = issueCommand(state, { type: 'end-phase' });
    expect(after.reason).toBe('game-over');
  });

  it('제한 턴 초과 시 end-phase가 게임을 종료하고 game-ended를 만든다', () => {
    const state = makeState();
    state.maxTurns = 1;
    addUnit(state, { faction: 'azure', q: 0, r: 0 });
    addUnit(state, { faction: 'crimson', q: 4, r: 4 });
    let last = issueCommand(state, { type: 'end-phase' });
    let guard = 0;
    while (!state.over && guard < 10) {
      guard++;
      last = issueCommand(state, { type: 'end-phase' });
    }
    expect(state.over).toBe(true);
    expect(findEvent(last.events, 'game-ended')).toBeDefined();
  });

  it('advancePhase를 직접 섞어 써도 순번 검증이 상태 기준으로 일관된다', () => {
    const state = makeState();
    advancePhase(state); // 규칙 함수 직접 호출은 순번을 올리지 않는다
    expect(state.cmdSeq ?? 0).toBe(0);
    expect(state.current).toBe('crimson');
    const r = issueCommand(state, { type: 'end-phase' });
    expect(r.ok).toBe(true);
    expect(state.cmdSeq).toBe(1);
  });
});

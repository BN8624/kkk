// 한 줄 목적: 저장 직렬화·복원·v1 마이그레이션과 손상 데이터 안전 처리를 검증한다
import { afterEach, describe, expect, it } from 'vitest';
import { newGame } from '../src/core/game';
import {
  deserialize,
  isStorageAvailable,
  resetSaveFailureWarning,
  SAVE_VERSION,
  saveGame,
  saveRaw,
  saveSettings,
  serialize,
  shouldWarnSaveFailure,
  DEFAULT_SETTINGS,
} from '../src/core/save';
import { SCENARIOS } from '../src/core/scenarios';

/** 테스트용 메모리 localStorage. */
function installMemoryStorage(opts?: {
  throwOnSet?: Error | null;
  denyAccess?: boolean;
}): { map: Map<string, string> } {
  const map = new Map<string, string>();
  if (opts?.denyAccess) {
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('access denied');
      },
      configurable: true,
    });
    return { map };
  }
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts?.throwOnSet) throw opts.throwOnSet;
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: store,
    configurable: true,
    writable: true,
  });
  return { map };
}

afterEach(() => {
  resetSaveFailureWarning();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).localStorage;
  } catch {
    /* ignore */
  }
});

describe('save', () => {
  it('직렬화 후 복원하면 동일한 상태가 된다', () => {
    const state = newGame(777, { humanFaction: 'crimson' });
    const restored = deserialize(serialize(state));
    expect(restored).toEqual(state);
    expect(restored!.config.humanFaction).toBe('crimson');
  });

  it('새 crown-heart 게임 save→load 시 crownHold 가 보존된다', () => {
    const state = newGame(42, { scenario: 'crown-heart' });
    expect(state.crownHold).toEqual({ owner: null, turns: 0 });
    state.crownHold = { owner: 'azure', turns: 2 };
    const restored = deserialize(serialize(state));
    expect(restored).not.toBeNull();
    expect(restored!.crownHold).toEqual({ owner: 'azure', turns: 2 });
    expect(restored!.config.scenario).toBe('crown-heart');
    const hold = restored!.objectives.victory.find((c) => c.type === 'hold-building');
    expect(hold).toMatchObject({
      type: 'hold-building',
      turns: SCENARIOS['crown-heart'].crownHoldTurns,
      activationTurn: SCENARIOS['crown-heart'].crownActivationTurn,
    });
  });

  it('version<4 진행 중 crown-heart 저장은 로드 시 null(안전 폐기)', () => {
    const state = newGame(7, { scenario: 'crown-heart' });
    expect(state.over).toBe(false);
    state.crownHold = { owner: 'crimson', turns: 1 };
    const raw = JSON.stringify({ version: 3, state });
    expect(deserialize(raw)).toBeNull();
  });

  it('완료된 crown-heart·비-crown v3 저장은 정상 로드된다', () => {
    const finished = newGame(9, { scenario: 'crown-heart' });
    finished.over = true;
    finished.winner = 'azure';
    finished.crownHold = { owner: 'azure', turns: 4 };
    const finishedRestored = deserialize(JSON.stringify({ version: 3, state: finished }));
    expect(finishedRestored).not.toBeNull();
    expect(finishedRestored!.over).toBe(true);
    expect(finishedRestored!.crownHold).toEqual({ owner: 'azure', turns: 4 });

    const nonCrown = newGame(11, { scenario: 'three-crowns' });
    expect(nonCrown.over).toBe(false);
    const nonCrownRestored = deserialize(JSON.stringify({ version: 3, state: nonCrown }));
    expect(nonCrownRestored).not.toBeNull();
    expect(nonCrownRestored!.config.scenario).toBe('three-crowns');
  });


  it('손상된 JSON은 null을 반환한다', () => {
    expect(deserialize('not json')).toBeNull();
    expect(deserialize('{}')).toBeNull();
    expect(deserialize('{"version":2}')).toBeNull();
  });

  it('알 수 없는 버전은 null을 반환한다', () => {
    const state = newGame(1);
    const raw = JSON.stringify({ version: SAVE_VERSION + 1, state });
    expect(deserialize(raw)).toBeNull();
  });

  it('필수 필드가 빠지면 null을 반환한다', () => {
    const state = newGame(1) as unknown as Record<string, unknown>;
    delete state.factions;
    const raw = JSON.stringify({ version: SAVE_VERSION, state });
    expect(deserialize(raw)).toBeNull();
  });

  it('v1 저장(player/ai1/ai2)을 v2로 마이그레이션한다', () => {
    const v1 = {
      version: 1,
      state: {
        seed: 42,
        turn: 3,
        maxTurns: 12,
        current: 'player',
        tiles: [
          { q: 0, r: 0, terrain: 'plains', building: 'capital', owner: 'player' },
          { q: 1, r: 0, terrain: 'plains', building: 'village', owner: 'ai1' },
          { q: 2, r: 0, terrain: 'forest' },
        ],
        units: [
          { id: 1, type: 'infantry', faction: 'player', q: 0, r: 0, hp: 12, moved: false, attacked: false },
          { id: 2, type: 'archer', faction: 'ai2', q: 2, r: 0, hp: 9, moved: true, attacked: true },
        ],
        factions: {
          player: { id: 'player', gold: 55, eliminated: false },
          ai1: { id: 'ai1', gold: 30, eliminated: false },
          ai2: { id: 'ai2', gold: 10, eliminated: true },
        },
        nextUnitId: 3,
        over: false,
        stats: { kills: 2, produced: 1, captured: 3 },
      },
    };
    const state = deserialize(JSON.stringify(v1));
    expect(state).not.toBeNull();
    expect(state!.config.humanFaction).toBe('azure');
    expect(state!.controllers.azure).toBe('human');
    expect(state!.controllers.crimson).toBe('ai');
    expect(state!.current).toBe('azure');
    expect(state!.factions.azure.gold).toBe(55);
    expect(state!.factions.violet.eliminated).toBe(true);
    expect(state!.tiles[0].owner).toBe('azure');
    expect(state!.tiles[1].owner).toBe('crimson');
    expect(state!.units[0].faction).toBe('azure');
    expect(state!.units[1].faction).toBe('violet');
    expect(state!.stats.azure.captured).toBe(3);
    expect(state!.stats.crimson.kills).toBe(0);
    expect(state!.order).toEqual(['azure', 'crimson', 'violet']);
  });

  it('유닛 좌표가 중복된 저장은 거부한다', () => {
    const state = newGame(5);
    state.units[1].q = state.units[0].q;
    state.units[1].r = state.units[0].r;
    expect(deserialize(serialize(state))).toBeNull();
  });

  it('유닛 ID가 중복된 저장은 거부한다', () => {
    const state = newGame(5);
    state.units[1].id = state.units[0].id;
    expect(deserialize(serialize(state))).toBeNull();
  });

  it('물 위 또는 존재하지 않는 타일 위 유닛은 거부한다', () => {
    const onWater = newGame(5);
    const water = onWater.tiles.find((t) => t.terrain === 'water')!;
    onWater.units[0].q = water.q;
    onWater.units[0].r = water.r;
    expect(deserialize(serialize(onWater))).toBeNull();

    const offMap = newGame(5);
    offMap.units[0].q = 999;
    offMap.units[0].r = 999;
    expect(deserialize(serialize(offMap))).toBeNull();
  });

  it('HP가 범위를 벗어난 유닛은 거부한다', () => {
    const zero = newGame(5);
    zero.units[0].hp = 0;
    expect(deserialize(serialize(zero))).toBeNull();
    const over = newGame(5);
    over.units[0].hp = 999;
    expect(deserialize(serialize(over))).toBeNull();
  });

  it('nextUnitId가 기존 유닛 ID 이하이면 거부한다', () => {
    const state = newGame(5);
    state.nextUnitId = state.units[state.units.length - 1].id;
    expect(deserialize(serialize(state))).toBeNull();
  });

  it('음수·NaN 금은 거부한다', () => {
    const neg = newGame(5);
    neg.factions.azure.gold = -1;
    expect(deserialize(serialize(neg))).toBeNull();
    const nan = newGame(5);
    nan.factions.azure.gold = Number.NaN;
    expect(deserialize(serialize(nan))).toBeNull();
  });

  it('winner가 있는데 over가 아니면 거부한다', () => {
    const state = newGame(5);
    state.winner = 'azure';
    state.over = false;
    expect(deserialize(serialize(state))).toBeNull();
  });

  it('세력 순서 중복·인간 controller 위반을 거부한다', () => {
    const dupOrder = newGame(5);
    dupOrder.order = ['azure', 'azure', 'violet'];
    expect(deserialize(serialize(dupOrder))).toBeNull();

    const twoHumans = newGame(5);
    twoHumans.controllers.crimson = 'human';
    expect(deserialize(serialize(twoHumans))).toBeNull();

    const noHuman = newGame(5);
    noHuman.controllers.azure = 'ai';
    expect(deserialize(serialize(noHuman))).toBeNull();
  });

  it('잘못된 모드·난이도·시나리오 ID 형식은 거부한다', () => {
    const badMode = newGame(5);
    (badMode.config as { mode: string }).mode = 'weird';
    expect(deserialize(serialize(badMode))).toBeNull();

    const badScenario = newGame(5);
    (badScenario.config as { scenario: string }).scenario = 'NOT VALID!!';
    expect(deserialize(serialize(badScenario))).toBeNull();
  });

  it('잘못된 지형·건물·병과는 거부한다', () => {
    const badTerrain = newGame(5);
    (badTerrain.tiles[0] as { terrain: string }).terrain = 'lava';
    expect(deserialize(serialize(badTerrain))).toBeNull();

    const badType = newGame(5);
    (badType.units[0] as { type: string }).type = 'dragon';
    expect(deserialize(serialize(badType))).toBeNull();
  });
});

describe('저장 성공·실패 반환과 경고', () => {
  it('정상 저장은 true를 반환한다', () => {
    const { map } = installMemoryStorage();
    const state = newGame(99);
    expect(saveGame(state)).toBe(true);
    expect(saveRaw('{"version":4}')).toBe(true);
    expect(saveSettings(DEFAULT_SETTINGS)).toBe(true);
    expect(map.size).toBeGreaterThan(0);
    expect(isStorageAvailable()).toBe(true);
  });

  it('저장소 접근 예외는 false를 반환한다', () => {
    installMemoryStorage({ denyAccess: true });
    const state = newGame(1);
    expect(saveGame(state)).toBe(false);
    expect(saveRaw('x')).toBe(false);
    expect(saveSettings(DEFAULT_SETTINGS)).toBe(false);
    expect(isStorageAvailable()).toBe(false);
  });

  it('quota 예외는 false를 반환한다', () => {
    installMemoryStorage({
      throwOnSet: new Error('QuotaExceededError'),
    });
    expect(saveGame(newGame(2))).toBe(false);
    expect(saveRaw('payload')).toBe(false);
    expect(saveSettings(DEFAULT_SETTINGS)).toBe(false);
    expect(isStorageAvailable()).toBe(false);
  });

  it('경고는 세션 최초 1회만 표시한다', () => {
    expect(shouldWarnSaveFailure()).toBe(true);
    expect(shouldWarnSaveFailure()).toBe(false);
    expect(shouldWarnSaveFailure()).toBe(false);
    resetSaveFailureWarning();
    expect(shouldWarnSaveFailure()).toBe(true);
  });

  it('저장 실패해도 게임 상태 진행은 유지된다', () => {
    installMemoryStorage({ throwOnSet: new Error('quota') });
    const state = newGame(7);
    const turn = state.turn;
    const gold = state.factions.azure.gold;
    expect(saveGame(state)).toBe(false);
    expect(state.turn).toBe(turn);
    expect(state.factions.azure.gold).toBe(gold);
    expect(state.over).toBe(false);
  });

  it('데이터 관리 화면용 저장 가능 여부를 보고한다', () => {
    installMemoryStorage();
    expect(isStorageAvailable()).toBe(true);
    installMemoryStorage({ denyAccess: true });
    expect(isStorageAvailable()).toBe(false);
  });
});

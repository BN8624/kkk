// 한 줄 목적: 테스트 전용 미니 게임 상태·유닛 생성 헬퍼를 제공한다
import { UNIT_STATS } from '../src/core/data';
import type { FactionId, GameConfig, GameState, Tile, Unit } from '../src/core/types';

export function zeroStats() {
  return { kills: 0, produced: 0, captured: 0, lost: 0 };
}

/** 평원 5x5 미니 맵 기반 테스트 상태를 만든다. */
export function makeState(config: Partial<GameConfig> = {}): GameState {
  const tiles: Tile[] = [];
  for (let r = 0; r < 5; r++) {
    for (let q = -2; q < 5; q++) {
      tiles.push({ q, r, terrain: 'plains' });
    }
  }
  const cfg: GameConfig = {
    mode: 'quick',
    scenario: 'three-crowns',
    difficulty: 'normal',
    humanFaction: 'azure',
    ...config,
  };
  const order: FactionId[] = ['azure', 'crimson', 'violet'];
  return {
    seed: 0,
    config: cfg,
    turn: 1,
    maxTurns: 12,
    order,
    current: 'azure',
    controllers: {
      azure: cfg.humanFaction === 'azure' ? 'human' : 'ai',
      crimson: cfg.humanFaction === 'crimson' ? 'human' : 'ai',
      violet: cfg.humanFaction === 'violet' ? 'human' : 'ai',
    },
    tiles,
    units: [],
    factions: {
      azure: { id: 'azure', gold: 100, eliminated: false },
      crimson: { id: 'crimson', gold: 100, eliminated: false },
      violet: { id: 'violet', gold: 100, eliminated: false },
    },
    nextUnitId: 1,
    over: false,
    stats: { azure: zeroStats(), crimson: zeroStats(), violet: zeroStats() },
    objectives: {
      victory: [{ type: 'conquest' }],
      defeat: [{ type: 'human-eliminated' }],
      stars: [],
      turnLimit: 'score',
    },
  };
}

export function addUnit(
  state: GameState,
  partial: Partial<Unit> & Pick<Unit, 'faction' | 'q' | 'r'>,
): Unit {
  const type = partial.type ?? 'infantry';
  const unit: Unit = {
    id: state.nextUnitId++,
    type,
    faction: partial.faction,
    q: partial.q,
    r: partial.r,
    hp: partial.hp ?? UNIT_STATS[type].hp,
    moved: partial.moved ?? false,
    attacked: partial.attacked ?? false,
  };
  if (partial.movedThisTurn !== undefined) unit.movedThisTurn = partial.movedThisTurn;
  if (partial.tag !== undefined) unit.tag = partial.tag;
  state.units.push(unit);
  return unit;
}

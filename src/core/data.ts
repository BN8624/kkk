// 한 줄 목적: 유닛 능력치·지형 규칙·경제 상수 등 게임 밸런스 데이터를 정의한다
import type { BuildingId, FactionId, TerrainId, TerrainRule, UnitStats, UnitTypeId } from './types';
import { UNIT_DEFS, UNIT_TYPE_IDS } from './units';

function statsFromDef(type: UnitTypeId): UnitStats {
  const d = UNIT_DEFS[type];
  return { hp: d.hp, atk: d.atk, def: d.def, move: d.move, range: d.range, cost: d.cost };
}

/** UNIT_DEFS에서 파생 — 능력치 정본은 units.ts 한곳만 관리한다 */
export const UNIT_STATS: Record<UnitTypeId, UnitStats> = Object.fromEntries(
  UNIT_TYPE_IDS.map((id) => [id, statsFromDef(id)]),
) as Record<UnitTypeId, UnitStats>;

export const TERRAIN_RULES: Record<TerrainId, TerrainRule> = {
  plains: { cost: 1, def: 0 },
  forest: { cost: 2, def: 1 },
  mountain: { cost: 3, def: 2 },
  water: { cost: Infinity, def: 0 },
};

export const BUILDING_DEF_BONUS: Record<BuildingId, number> = {
  // 수도 방어 +2: 4턴 이하 전멸 러시를 줄이되, 마을·왕관은 +1로 정복·경합 과수비를 막는다
  capital: 2,
  village: 1,
  crown: 1,
};

export const BUILDING_INCOME: Record<BuildingId, number> = {
  capital: 15,
  village: 10,
  crown: 10,
};

export const SCORE_WEIGHTS = {
  capital: 30,
  village: 10,
  crown: 20,
  unit: 1,
  /** 처치당 점수: 전투 회피·유닛 스팸만으로 점수전을 이기는 메타를 막는다 */
  kill: 5,
};

export const START_GOLD = 40;
export const DEFAULT_MAX_TURNS = 12;
export const MAX_UNITS_PER_FACTION = 10;

export const FACTION_IDS: FactionId[] = ['azure', 'crimson', 'violet'];

export const FACTION_NAMES: Record<FactionId, string> = {
  azure: '청람 왕국',
  crimson: '진홍 공국',
  violet: '자원 후국',
};

export const UNIT_NAMES: Record<UnitTypeId, string> = {
  infantry: '보병',
  archer: '궁병',
  cavalry: '기병',
  guardian: '수호대',
  raider: '약탈대',
  crossbow: '쇠뇌대',
};

export const TERRAIN_NAMES: Record<TerrainId, string> = {
  plains: '평원',
  forest: '숲',
  mountain: '산',
  water: '바다',
};

export const BUILDING_NAMES: Record<BuildingId, string> = {
  capital: '수도',
  village: '마을',
  crown: '왕관 요새',
};

export const DIFFICULTY_NAMES = {
  easy: '쉬움',
  normal: '보통',
  hard: '어려움',
} as const;

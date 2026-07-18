// 한 줄 목적: 유닛 능력치·지형 규칙·경제 상수 등 게임 밸런스 데이터를 정의한다
import type { BuildingId, FactionId, TerrainId, TerrainRule, UnitStats, UnitTypeId } from './types';

export const UNIT_STATS: Record<UnitTypeId, UnitStats> = {
  infantry: { hp: 12, atk: 5, def: 2, move: 3, range: 1, cost: 30 },
  archer: { hp: 9, atk: 5, def: 0, move: 2, range: 2, cost: 40 },
  cavalry: { hp: 14, atk: 7, def: 1, move: 5, range: 1, cost: 60 },
};

export const TERRAIN_RULES: Record<TerrainId, TerrainRule> = {
  plains: { cost: 1, def: 0 },
  forest: { cost: 2, def: 1 },
  mountain: { cost: 3, def: 2 },
  water: { cost: Infinity, def: 0 },
};

export const BUILDING_DEF_BONUS: Record<BuildingId, number> = {
  capital: 2,
  village: 1,
  crown: 2,
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
  unit: 2,
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

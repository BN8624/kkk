// 한 줄 목적: 로컬 날짜 기반 결정론적 일일 도전(시드·시나리오·왕국·난이도·수정자)을 정의한다
import { mulberry32 } from './rng';
import { SCENARIO_IDS } from './scenarios';
import type { Difficulty, FactionId, ScenarioId } from './types';

export type ModifierId =
  | 'poor-start'
  | 'rich-villages'
  | 'costly-cavalry'
  | 'sharp-arrows'
  | 'short-war';

export interface ModifierInfo {
  name: string;
  description: string;
}

export const MODIFIERS: Record<ModifierId, ModifierInfo> = {
  'poor-start': { name: '가난한 출발', description: '모든 세력의 시작 금 -15' },
  'rich-villages': { name: '풍요로운 마을', description: '모든 마을 수입 +5' },
  'costly-cavalry': { name: '비싼 군마', description: '기병 생산 비용 +15' },
  'sharp-arrows': { name: '날카로운 화살', description: '모든 궁병 공격 +1' },
  'short-war': { name: '짧은 전쟁', description: '최대 턴 -2' },
};

const MODIFIER_IDS: ModifierId[] = [
  'poor-start',
  'rich-villages',
  'costly-cavalry',
  'sharp-arrows',
  'short-war',
];

export interface DailyChallenge {
  dateKey: string;
  seed: number;
  scenario: ScenarioId;
  faction: FactionId;
  difficulty: Difficulty;
  /** 하루 최대 1개. 없을 수도 있다 */
  modifier?: ModifierId;
}

/** 사용자 로컬 날짜의 YYYYMMDD 키 */
export function todayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

const FACTION_POOL: FactionId[] = ['azure', 'crimson', 'violet'];
const DIFFICULTY_POOL: Difficulty[] = ['easy', 'normal', 'normal', 'hard'];

/** 날짜 키로부터 오늘의 도전을 결정론적으로 만든다. 같은 날짜는 항상 같은 도전이다. */
export function dailyChallenge(dateKey: string): DailyChallenge {
  const base = Number(dateKey) >>> 0;
  const rng = mulberry32((base ^ 0x9e3779b9) >>> 0);
  const scenario = SCENARIO_IDS[Math.floor(rng() * SCENARIO_IDS.length)];
  const faction = FACTION_POOL[Math.floor(rng() * FACTION_POOL.length)];
  const difficulty = DIFFICULTY_POOL[Math.floor(rng() * DIFFICULTY_POOL.length)];
  // 40% 확률로 수정자 없음, 아니면 1개
  const roll = rng();
  const modifier =
    roll < 0.4 ? undefined : MODIFIER_IDS[Math.floor(rng() * MODIFIER_IDS.length)];
  const seed = (Math.floor(rng() * 0xffffffff) ^ base) >>> 0;
  return { dateKey, seed, scenario, faction, difficulty, modifier };
}

/** 결과 공유용 텍스트를 만든다. */
export function shareText(opts: {
  scenarioName: string;
  difficultyName: string;
  factionName: string;
  outcome: 'win' | 'lose' | 'draw';
  turns: number;
  score: number;
  captured: number;
  kills: number;
  seed: number;
  daily?: boolean;
  modifierName?: string;
}): string {
  const result =
    opts.outcome === 'win' ? `${opts.turns}턴 승리` : opts.outcome === 'draw' ? '무승부' : '패배';
  const lines = [
    `세 왕관의 섬 — ${opts.scenarioName} / ${opts.difficultyName}${opts.daily ? ' / 일일 도전' : ''}`,
    `${opts.factionName}으로 ${result}`,
    `점수 ${opts.score} · 거점 ${opts.captured} · 처치 ${opts.kills}`,
    `${opts.modifierName ? `수정자: ${opts.modifierName} · ` : ''}도전 시드: ${opts.seed}`,
    'https://bn8624.github.io/kkk/',
  ];
  return lines.join('\n');
}

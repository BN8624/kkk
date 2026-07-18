// 한 줄 목적: 서버 없는 로컬 플레이 기록(승수·최고 점수·일일 도전 기록)을 관리한다
import { humanFaction } from './board';
import { factionScore } from './game';
import type { Difficulty, FactionId, GameMode, GameState, ScenarioId } from './types';

export const RECORDS_KEY = 'three-crowns-records';

export interface GameRecordEntry {
  at: string; // ISO 시각
  mode: GameMode;
  scenario: ScenarioId;
  faction: FactionId;
  difficulty: Difficulty;
  seed: number;
  outcome: 'win' | 'lose' | 'draw';
  turns: number;
  score: number;
  captured: number;
  kills: number;
  produced: number;
}

export interface DailyRecord {
  dateKey: string;
  bestScore: number;
  done: boolean;
  firstOutcome: 'win' | 'lose' | 'draw';
  won: boolean;
}

export interface Records {
  plays: number;
  winsByFaction: Record<FactionId, number>;
  winsByDifficulty: Record<Difficulty, number>;
  bestScoreByScenario: Partial<Record<ScenarioId, number>>;
  fastestWinTurns: number | null;
  maxCaptured: number;
  maxKills: number;
  daily: DailyRecord | null;
  recent: GameRecordEntry[];
}

export function emptyRecords(): Records {
  return {
    plays: 0,
    winsByFaction: { azure: 0, crimson: 0, violet: 0 },
    winsByDifficulty: { easy: 0, normal: 0, hard: 0 },
    bestScoreByScenario: {},
    fastestWinTurns: null,
    maxCaptured: 0,
    maxKills: 0,
    daily: null,
    recent: [],
  };
}

export interface RecordOutcome {
  records: Records;
  entry: GameRecordEntry;
  /** 이번 판 이전의 시나리오 최고 점수(비교 표시용) */
  prevBestScore: number | null;
  isNewBest: boolean;
}

/** 끝난 게임을 기록에 반영한 새 Records를 반환한다(순수 함수). */
export function recordGame(
  records: Records,
  state: GameState,
  dailyDateKey?: string,
  now: Date = new Date(),
): RecordOutcome {
  const me = humanFaction(state);
  const outcome: GameRecordEntry['outcome'] =
    state.winner === me ? 'win' : state.winner === 'draw' ? 'draw' : 'lose';
  const entry: GameRecordEntry = {
    at: now.toISOString(),
    mode: state.config.mode,
    scenario: state.config.scenario,
    faction: me,
    difficulty: state.config.difficulty,
    seed: state.seed,
    outcome,
    turns: Math.min(state.turn, state.maxTurns),
    score: factionScore(state, me),
    captured: state.stats[me].captured,
    kills: state.stats[me].kills,
    produced: state.stats[me].produced,
  };

  const next: Records = JSON.parse(JSON.stringify(records)) as Records;
  next.plays++;
  if (outcome === 'win') {
    next.winsByFaction[me]++;
    next.winsByDifficulty[state.config.difficulty]++;
    if (next.fastestWinTurns === null || entry.turns < next.fastestWinTurns)
      next.fastestWinTurns = entry.turns;
  }
  next.maxCaptured = Math.max(next.maxCaptured, entry.captured);
  next.maxKills = Math.max(next.maxKills, entry.kills);

  const prevBestScore = records.bestScoreByScenario[state.config.scenario] ?? null;
  const isNewBest = prevBestScore === null || entry.score > prevBestScore;
  if (isNewBest) next.bestScoreByScenario[state.config.scenario] = entry.score;

  if (state.config.mode === 'daily' && dailyDateKey) {
    if (!next.daily || next.daily.dateKey !== dailyDateKey) {
      next.daily = {
        dateKey: dailyDateKey,
        bestScore: entry.score,
        done: true,
        firstOutcome: outcome,
        won: outcome === 'win',
      };
    } else {
      next.daily.bestScore = Math.max(next.daily.bestScore, entry.score);
      next.daily.won = next.daily.won || outcome === 'win';
    }
  }

  next.recent = [entry, ...next.recent].slice(0, 10);
  return { records: next, entry, prevBestScore, isNewBest };
}

function storage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* 접근 불가 환경 */
  }
  return null;
}

export function loadRecords(): Records {
  try {
    const raw = storage()?.getItem(RECORDS_KEY);
    if (!raw) return emptyRecords();
    const parsed = JSON.parse(raw) as Partial<Records>;
    return { ...emptyRecords(), ...parsed };
  } catch {
    return emptyRecords();
  }
}

export function saveRecords(records: Records): void {
  try {
    storage()?.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    /* 저장 실패해도 게임은 계속 */
  }
}

// 한 줄 목적: 정본 상태 다이제스트와 리플레이 문서 v1의 기록·결정론 재생 검증을 제공한다
import { executeCommand, type CommandFailureReason, type GameCommand } from './command';
import { factionScore, newGameFromScenario } from './game';
import { FACTION_IDS } from './data';
import { starCount } from './scenario/objectives';
import { builtinScenarioSnapshot } from './scenario/builtin';
import { isBuiltinScenarioId } from './scenarios';
import type { ScenarioRuntimeSnapshot } from './scenario/types';
import type { FactionId, GameConfig, GameState, ReplayObservation } from './types';

export type { ReplayObservation } from './types';

export const REPLAY_SCHEMA_VERSION = 2;
/** 리플레이를 기록한 게임 버전(공개판 마감 시 package.json과 함께 올린다). */
export const GAME_VERSION = '2.1.0';

// ---------------- 정본 직렬화·다이제스트 ----------------

/**
 * 정본 직렬화: 객체 키를 사전순으로 고정하고 undefined 값을 항상 생략한다.
 * 게임 상태의 숫자는 모두 유한 정수이므로 JSON 표기가 곧 고정 표기다.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

function fnv1a(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 문자열의 안정적 64비트(32비트×2) 다이제스트. */
export function digestString(s: string): string {
  const a = fnv1a(s, 0x811c9dc5);
  const b = fnv1a(s, (0x811c9dc5 ^ 0x9e3779b9) >>> 0);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * 게임 상태의 정본 형태: 타일은 좌표순, 유닛은 ID순, 세력은 정본 순서로 정렬하고
 * UI·기록용 정보(commandLog)와 스냅샷(customScenario — scenarioDigest가 담당)은 제외한다.
 */
export function canonicalGameState(state: GameState): unknown {
  return {
    seed: state.seed,
    config: {
      mode: state.config.mode,
      scenario: state.config.scenario,
      difficulty: state.config.difficulty,
      humanFaction: state.config.humanFaction,
      modifier: state.config.modifier,
    },
    turn: state.turn,
    maxTurns: state.maxTurns,
    order: state.order,
    current: state.current,
    controllers: FACTION_IDS.map((f) => ({ id: f, controller: state.controllers[f] })),
    tiles: [...state.tiles]
      .sort((a, b) => a.r - b.r || a.q - b.q)
      .map((t) => ({ q: t.q, r: t.r, terrain: t.terrain, building: t.building, owner: t.owner })),
    units: [...state.units]
      .sort((a, b) => a.id - b.id)
      .map((u) => ({
        id: u.id,
        type: u.type,
        faction: u.faction,
        q: u.q,
        r: u.r,
        hp: u.hp,
        moved: u.moved,
        attacked: u.attacked,
        tag: u.tag,
      })),
    factions: FACTION_IDS.map((f) => ({
      id: f,
      gold: state.factions[f].gold,
      eliminated: state.factions[f].eliminated,
    })),
    stats: FACTION_IDS.map((f) => ({ id: f, ...state.stats[f] })),
    nextUnitId: state.nextUnitId,
    over: state.over,
    winner: state.winner,
    crownHold: state.crownHold
      ? { owner: state.crownHold.owner, turns: state.crownHold.turns }
      : undefined,
    objectives: state.objectives,
    cmdSeq: state.cmdSeq ?? 0,
  };
}

/** 게임 상태의 정본 다이제스트. 같은 상태는 배열 순서와 무관하게 항상 같은 값을 낸다. */
export function stateDigest(state: GameState): string {
  return digestString(canonicalJson(canonicalGameState(state)));
}

/** 시나리오 스냅샷의 정본 다이제스트. */
export function scenarioDigest(snapshot: ScenarioRuntimeSnapshot): string {
  return digestString(canonicalJson(snapshot));
}

// ---------------- ReplayDocument (v2 현행 · v1 역사) ----------------

export interface ReplayResult {
  winner: FactionId | 'draw';
  turns: number;
  /** 인간 세력 최종 점수 */
  score: number;
  /** 획득 별 수(별점 조건 없는 시나리오는 0) */
  stars: number;
}

/** v1·v2가 공유하는 정본 필드. 결정론 검증은 이 필드들만 사용한다. */
interface ReplayDocumentBase {
  gameVersion: string;

  replayId: string;
  createdAt: string;

  scenario: ScenarioRuntimeSnapshot;
  scenarioDigest: string;

  initialConfig: GameConfig;
  seed: number;
  /** 재구성한 초기 상태의 다이제스트(설정·스냅샷 복원 오류를 명령 재생 전에 잡는다) */
  initialStateDigest: string;

  commands: GameCommand[];

  result: ReplayResult;
  finalStateDigest: string;
}

/** 역사적 v1 문서(관측 메타데이터 없음). 가져오기·보관함 로드 시 v2로 마이그레이션한다. */
export interface ReplayDocumentV1 extends ReplayDocumentBase {
  schemaVersion: 1;
}

/** 플레이테스트 평가(선택). 결정론·다이제스트에 관여하지 않는 로컬 전용 메타데이터. */
export interface PlaytestEvaluation {
  enjoyment?: 'fun' | 'ok' | 'boring';
  length?: 'short' | 'right' | 'long';
  /** 패배 원인 이해 여부 */
  understoodLoss?: boolean;
  defectTag?: 'early-objective' | 'lost-before-acting' | 'unclear-objective' | 'no-retake-chance';
  /** 자유 메모(최대 280자) */
  note?: string;
}

export const EVAL_ENJOYMENT = ['fun', 'ok', 'boring'] as const;
export const EVAL_LENGTH = ['short', 'right', 'long'] as const;
export const EVAL_DEFECT_TAGS = [
  'early-objective',
  'lost-before-acting',
  'unclear-objective',
  'no-retake-chance',
] as const;
export const EVAL_NOTE_MAX = 280;

/** 현행 v2 문서. observations·evaluation은 선택적이며 결정론 검증·다이제스트에 관여하지 않는다. */
export interface ReplayDocument extends ReplayDocumentBase {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  /** 인간 행동 관측 메타데이터(없어도 재생·검증 가능) */
  observations?: ReplayObservation[];
  /**
   * 플레이테스트 평가(선택).
   * 결정론·다이제스트에 관여하지 않는 로컬 전용 메타데이터(외부 전송 없음).
   */
  evaluation?: PlaytestEvaluation;
}

/** v1 → v2 마이그레이션: 정본 필드는 그대로 두고 스키마 버전만 올린다(관측 없음). 예외를 던지지 않는다. */
export function migrateReplayV1(doc: ReplayDocumentV1): ReplayDocument {
  return { ...doc, schemaVersion: REPLAY_SCHEMA_VERSION };
}

/**
 * 로컬 보관함(IndexedDB)의 v1·v2 레코드를 현행 형식으로 올린다.
 * 저장 시점에 이미 정밀 검증을 통과한 레코드용이므로 스키마 버전만 판정한다. 예외를 던지지 않는다.
 */
export function upgradeStoredReplay(doc: unknown): ReplayDocument | null {
  if (!doc || typeof doc !== 'object') return null;
  const v = (doc as { schemaVersion?: unknown }).schemaVersion;
  if (v === REPLAY_SCHEMA_VERSION) return doc as ReplayDocument;
  if (v === 1) return migrateReplayV1(doc as ReplayDocumentV1);
  return null;
}

/** 관측 배열 정리: 명령 범위를 벗어나거나 형식이 어긋난 항목을 버리고 순번 오름차순으로 만든다. */
export function sanitizeObservations(
  observations: ReplayObservation[] | undefined,
  commandCount: number,
): ReplayObservation[] | undefined {
  if (!observations || observations.length === 0) return undefined;
  const valid = observations.filter(
    (o) =>
      Number.isInteger(o.commandSeq) &&
      o.commandSeq >= 0 &&
      o.commandSeq < commandCount &&
      (o.elapsedMs === undefined || (Number.isInteger(o.elapsedMs) && o.elapsedMs >= 0)) &&
      (o.hesitationMs === undefined || (Number.isInteger(o.hesitationMs) && o.hesitationMs >= 0)),
  );
  if (valid.length === 0) return undefined;
  return [...valid].sort((a, b) => a.commandSeq - b.commandSeq);
}

/**
 * 플레이테스트 평가 정리: 허용 enum·note 길이만 남기고 나머지는 버린다.
 * 형식 오류가 있어도 예외를 던지지 않으며, 유효 필드가 없으면 undefined를 반환한다.
 */
export function sanitizeEvaluation(raw: unknown): PlaytestEvaluation | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: PlaytestEvaluation = {};
  if (typeof o.enjoyment === 'string' && (EVAL_ENJOYMENT as readonly string[]).includes(o.enjoyment)) {
    out.enjoyment = o.enjoyment as PlaytestEvaluation['enjoyment'];
  }
  if (typeof o.length === 'string' && (EVAL_LENGTH as readonly string[]).includes(o.length)) {
    out.length = o.length as PlaytestEvaluation['length'];
  }
  if (typeof o.understoodLoss === 'boolean') out.understoodLoss = o.understoodLoss;
  if (typeof o.defectTag === 'string' && (EVAL_DEFECT_TAGS as readonly string[]).includes(o.defectTag)) {
    out.defectTag = o.defectTag as PlaytestEvaluation['defectTag'];
  }
  if (typeof o.note === 'string' && o.note.length > 0 && o.note.length <= EVAL_NOTE_MAX) {
    out.note = o.note;
  }
  return out.enjoyment !== undefined ||
    out.length !== undefined ||
    out.understoodLoss !== undefined ||
    out.defectTag !== undefined ||
    out.note !== undefined
    ? out
    : undefined;
}

/** 상태에서 시나리오 스냅샷을 복원한다(내장은 시드로 재생성, 커스텀은 상태에 포함된 스냅샷). */
export function scenarioSnapshotOf(state: GameState): ScenarioRuntimeSnapshot | null {
  if (state.customScenario) return state.customScenario;
  if (isBuiltinScenarioId(state.config.scenario)) {
    return builtinScenarioSnapshot(state.config.scenario, state.seed, state.config.humanFaction);
  }
  return null;
}

/**
 * 종료된 게임에서 리플레이 문서를 만든다.
 * 명령 기록이 불완전하면(이어하기 이전 버전 저장 등) null을 반환한다 — 부분 리플레이는 만들지 않는다.
 */
export function buildReplayDocument(
  state: GameState,
  opts: { replayId?: string; createdAt?: string; evaluation?: PlaytestEvaluation } = {},
): ReplayDocument | null {
  if (!state.over || state.winner === undefined) return null;
  const commands = state.commandLog;
  if (!commands || commands.length !== (state.cmdSeq ?? 0)) return null;
  const scenario = scenarioSnapshotOf(state);
  if (!scenario) return null;
  const initial = newGameFromScenario(state.seed, scenario, { ...state.config });
  const observations = sanitizeObservations(state.observationLog, commands.length);
  const evaluation = sanitizeEvaluation(opts.evaluation);
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    gameVersion: GAME_VERSION,
    replayId: opts.replayId ?? `replay-${state.seed.toString(36)}-${commands.length}`,
    createdAt: opts.createdAt ?? new Date().toISOString(),
    scenario,
    scenarioDigest: scenarioDigest(scenario),
    initialConfig: { ...state.config },
    seed: state.seed,
    initialStateDigest: stateDigest(initial),
    commands,
    result: {
      winner: state.winner,
      turns: Math.min(state.turn, state.maxTurns),
      score: factionScore(state, state.config.humanFaction),
      stars: starCount(state),
    },
    finalStateDigest: stateDigest(state),
    ...(observations ? { observations } : {}),
    ...(evaluation ? { evaluation } : {}),
  };
}

/** 가져오기 파일 크기 제한(바이트). */
export const REPLAY_MAX_IMPORT_BYTES = 2 * 1024 * 1024;

// ---------------- 결정론 재생 검증 ----------------

export interface ReplayVerification {
  ok: boolean;
  reason?:
    | 'unsupported-version'
    | 'initial-mismatch'
    | 'command-failed'
    | 'digest-mismatch'
    | 'internal-error';
  /** 실패한 명령(command-failed 시) */
  failedSeq?: number;
  failedCommand?: GameCommand;
  failureReason?: CommandFailureReason;
  /** 실패 시점 직전 상태의 다이제스트 */
  digestBefore?: string;
  actualDigest?: string;
  expectedDigest?: string;
  /** 재생이 끝난(또는 실패 시점의) 상태 */
  state?: GameState;
}

/** 리플레이 문서의 초기 상태를 재구성한다. */
export function replayInitialState(doc: ReplayDocument): GameState {
  return newGameFromScenario(doc.seed, doc.scenario, { ...doc.initialConfig });
}

/**
 * 명령을 순서대로 재실행해 결정론을 검증한다.
 * 모든 명령이 성공하고 최종 다이제스트가 일치해야 ok다.
 */
export function verifyReplay(doc: ReplayDocument): ReplayVerification {
  if (doc.schemaVersion !== REPLAY_SCHEMA_VERSION) {
    return { ok: false, reason: 'unsupported-version' };
  }
  const state = replayInitialState(doc);
  const initialDigest = stateDigest(state);
  if (initialDigest !== doc.initialStateDigest) {
    return {
      ok: false,
      reason: 'initial-mismatch',
      actualDigest: initialDigest,
      expectedDigest: doc.initialStateDigest,
      state,
    };
  }
  for (const command of doc.commands) {
    const r = executeCommand(state, command);
    if (!r.ok) {
      return {
        ok: false,
        reason: 'command-failed',
        failedSeq: command.seq,
        failedCommand: command,
        failureReason: r.reason,
        digestBefore: stateDigest(state),
        state,
      };
    }
  }
  const actual = stateDigest(state);
  if (actual !== doc.finalStateDigest) {
    return {
      ok: false,
      reason: 'digest-mismatch',
      actualDigest: actual,
      expectedDigest: doc.finalStateDigest,
      state,
    };
  }
  return { ok: true, actualDigest: actual, state };
}

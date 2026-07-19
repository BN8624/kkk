// 한 줄 목적: 외부 리플레이 문서의 정밀 디코더 — 명령별 필드·순번·중첩 시나리오까지 검증하고 예외를 던지지 않는다
import { COMMAND_SCHEMA_VERSION } from './command';
import { FACTION_IDS, UNIT_STATS } from './data';
import { MODIFIERS } from './daily';
import {
  DEFAULT_LIMITS,
  decodeFail,
  decodeOk,
  hasControlChars,
  intInRange,
  isDigestString,
  isFiniteInt,
  isShortString,
  safeJsonParse,
  scanStructure,
  type DecodeIssue,
  type DecodeResult,
  type StructureLimits,
} from './decode';
import {
  migrateReplayV1,
  REPLAY_MAX_IMPORT_BYTES,
  REPLAY_SCHEMA_VERSION,
  sanitizeEvaluation,
  verifyReplay,
  type ReplayDocument,
  type ReplayDocumentV1,
  type ReplayVerification,
} from './replay';
import { validateScenario } from './scenario/validate';
import { isValidScenarioId, type ScenarioDocumentV1, type ScenarioRuntimeSnapshot } from './scenario/types';
import type { Difficulty, FactionId, GameMode } from './types';

export const REPLAY_DECODE_LIMITS: StructureLimits = {
  ...DEFAULT_LIMITS,
  maxBytes: REPLAY_MAX_IMPORT_BYTES,
  maxArrayLen: 100_000,
};

/** 명령 수 상한(기존 parseReplayDocument와 동일). */
export const REPLAY_MAX_COMMANDS = 100_000;

const GAME_MODES: GameMode[] = ['quick', 'daily', 'custom', 'campaign'];
const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
const CLIENTS = new Set(['human', 'ai', 'replay', 'test']);

function err(code: string, message: string, path?: string): DecodeIssue {
  return { code, message, severity: 'error', cause: 'schema', ...(path ? { path } : {}) };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isAxialLike(v: unknown, path: string, issues: DecodeIssue[]): boolean {
  if (!isRecord(v) || !intInRange(v.q, -1000, 1000) || !intInRange(v.r, -1000, 1000)) {
    issues.push(err('bad-coordinate', '좌표 구조가 잘못되었습니다', path));
    return false;
  }
  return true;
}

/** 명령 하나를 정밀 검증한다. 성공 시 이슈를 추가하지 않는다. */
function validateCommand(c: unknown, index: number, issues: DecodeIssue[]): void {
  const path = `commands[${index}]`;
  if (!isRecord(c)) {
    issues.push(err('bad-command', '명령이 객체가 아닙니다', path));
    return;
  }
  if (c.v !== COMMAND_SCHEMA_VERSION) {
    issues.push(err('bad-command-version', `지원하지 않는 명령 스키마 버전입니다: ${String(c.v)}`, `${path}.v`));
    return;
  }
  if (!isFiniteInt(c.seq) || c.seq !== index) {
    issues.push(err('bad-seq', '명령 순번이 0부터 연속이 아닙니다', `${path}.seq`));
  }
  if (!intInRange(c.turn, 1, 10_000)) {
    issues.push(err('bad-turn', '명령의 턴 번호가 잘못되었습니다', `${path}.turn`));
  }
  if (!FACTION_IDS.includes(c.faction as FactionId)) {
    issues.push(err('bad-faction', `알 수 없는 세력입니다: ${String(c.faction)}`, `${path}.faction`));
  }
  if (c.client !== undefined && !CLIENTS.has(c.client as string)) {
    issues.push(err('bad-client', '알 수 없는 명령 주체입니다', `${path}.client`));
  }
  switch (c.type) {
    case 'move-unit':
      if (!intInRange(c.unitId, 0, 10_000_000))
        issues.push(err('bad-unit-id', '유닛 ID가 잘못되었습니다', `${path}.unitId`));
      isAxialLike(c.to, `${path}.to`, issues);
      break;
    case 'attack-unit':
      if (!intInRange(c.attackerId, 0, 10_000_000))
        issues.push(err('bad-unit-id', '공격 유닛 ID가 잘못되었습니다', `${path}.attackerId`));
      if (!intInRange(c.defenderId, 0, 10_000_000))
        issues.push(err('bad-unit-id', '방어 유닛 ID가 잘못되었습니다', `${path}.defenderId`));
      break;
    case 'produce-unit':
      isAxialLike(c.at, `${path}.at`, issues);
      if (!(typeof c.unitType === 'string' && c.unitType in UNIT_STATS))
        issues.push(err('bad-unit-type', `알 수 없는 병과입니다: ${String(c.unitType)}`, `${path}.unitType`));
      break;
    case 'end-phase':
      // 추가 데이터는 안전하게 무시한다(결과에 영향을 주지 않음)
      break;
    default:
      issues.push(err('bad-command-type', `알 수 없는 명령입니다: ${String(c.type)}`, `${path}.type`));
  }
}

/**
 * 중첩 시나리오 스냅샷을 문서 형태로 되돌려 기존 시나리오 검증기를 재사용한다.
 * 스냅샷 필드 형태는 문서와 호환된다(설명·메타데이터만 없음).
 */
function validateSnapshot(s: unknown, issues: DecodeIssue[]): s is ScenarioRuntimeSnapshot {
  if (!isRecord(s)) {
    issues.push(err('bad-scenario', '중첩 시나리오가 객체가 아닙니다', 'scenario'));
    return false;
  }
  if (s.schemaVersion !== 1) {
    issues.push(err('bad-scenario-version', '중첩 시나리오의 스키마 버전이 잘못되었습니다', 'scenario.schemaVersion'));
    return false;
  }
  const board = s.board;
  if (!isRecord(board) || !Array.isArray(board.tiles) || !Array.isArray(s.factions) || !Array.isArray(s.units)) {
    issues.push(err('bad-scenario', '중첩 시나리오 구조가 잘못되었습니다', 'scenario'));
    return false;
  }
  if (!isValidScenarioId(s.id) || !isShortString(s.title, 80)) {
    issues.push(err('bad-scenario', '중첩 시나리오의 ID·제목이 잘못되었습니다', 'scenario'));
    return false;
  }
  if (s.generatedFromSeed !== undefined && !intInRange(s.generatedFromSeed, 0, 0xffffffff)) {
    issues.push(err('bad-scenario', '중첩 시나리오의 생성 시드가 잘못되었습니다', 'scenario.generatedFromSeed'));
    return false;
  }
  const pseudoDoc = {
    schemaVersion: 1,
    id: s.id,
    title: s.title,
    description: '',
    board: s.board,
    factions: s.factions,
    units: s.units,
    rules: s.rules,
    victoryConditions: s.victoryConditions,
    defeatConditions: s.defeatConditions,
    starConditions: s.starConditions,
  } as ScenarioDocumentV1;
  try {
    const scenarioIssues = validateScenario(pseudoDoc);
    const errors = scenarioIssues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      for (const e of errors.slice(0, 5)) {
        issues.push(err(`scenario-${e.code}`, `중첩 시나리오 오류: ${e.message}`, `scenario.${e.path ?? ''}`));
      }
      return false;
    }
  } catch {
    issues.push({ code: 'internal', message: '중첩 시나리오 검증 중 내부 오류', severity: 'error', cause: 'internal', path: 'scenario' });
    return false;
  }
  return true;
}

/**
 * 외부 리플레이 입력(문자열 또는 이미 파싱된 값)을 정밀 검증해 문서로 디코드한다.
 * 어떤 입력에도 예외를 던지지 않는다. 결정론 재생 가능성은 별도로 safeVerifyReplay로 확인한다.
 */
export function decodeReplayDocument(input: string | unknown): DecodeResult<ReplayDocument> {
  let raw: unknown;
  if (typeof input === 'string') {
    const parsed = safeJsonParse(input, REPLAY_DECODE_LIMITS);
    if (!parsed.ok) return parsed as DecodeResult<ReplayDocument>;
    raw = parsed.value;
  } else {
    const violation = scanStructure(input, REPLAY_DECODE_LIMITS);
    if (violation) return { ok: false, issues: [violation] };
    raw = input;
  }
  if (!isRecord(raw)) return decodeFail('not-object', '리플레이 문서 형식이 아닙니다', 'schema');

  // 스키마 버전: v1(마이그레이션)·v2(현행)만 수용하고 미래 버전은 명확한 코드로 거부한다
  const schemaVersion = raw.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== REPLAY_SCHEMA_VERSION) {
    if (intInRange(raw.schemaVersion, REPLAY_SCHEMA_VERSION + 1, 1_000_000)) {
      return decodeFail('future-schema', '이 리플레이는 더 새로운 앱 버전에서 만들어졌습니다', 'schema', 'schemaVersion');
    }
    return decodeFail('bad-schema-version', '지원하지 않는 리플레이 스키마 버전입니다', 'schema', 'schemaVersion');
  }

  const issues: DecodeIssue[] = [];

  if (!isShortString(raw.replayId, 80) || hasControlChars(raw.replayId as string))
    issues.push(err('bad-replay-id', '리플레이 ID가 잘못되었습니다', 'replayId'));
  if (!isShortString(raw.createdAt, 64))
    issues.push(err('bad-created-at', '생성 시각이 잘못되었습니다', 'createdAt'));
  if (!isShortString(raw.gameVersion, 32) || !/^\d+\.\d+\.\d+/.test(raw.gameVersion as string))
    issues.push(err('bad-game-version', '게임 버전 표기가 잘못되었습니다', 'gameVersion'));
  if (!intInRange(raw.seed, 0, 0xffffffff))
    issues.push(err('bad-seed', '시드가 잘못되었습니다', 'seed'));
  if (!isDigestString(raw.scenarioDigest))
    issues.push(err('bad-digest', '시나리오 다이제스트 형식이 잘못되었습니다', 'scenarioDigest'));
  if (!isDigestString(raw.initialStateDigest))
    issues.push(err('bad-digest', '초기 상태 다이제스트 형식이 잘못되었습니다', 'initialStateDigest'));
  if (!isDigestString(raw.finalStateDigest))
    issues.push(err('bad-digest', '최종 상태 다이제스트 형식이 잘못되었습니다', 'finalStateDigest'));

  // initialConfig
  const cfg = raw.initialConfig;
  if (!isRecord(cfg)) {
    issues.push(err('bad-config', '초기 설정이 없습니다', 'initialConfig'));
  } else {
    if (!GAME_MODES.includes(cfg.mode as GameMode))
      issues.push(err('bad-mode', `알 수 없는 게임 모드입니다: ${String(cfg.mode)}`, 'initialConfig.mode'));
    if (!isValidScenarioId(cfg.scenario))
      issues.push(err('bad-scenario-id', '시나리오 ID가 잘못되었습니다', 'initialConfig.scenario'));
    if (!DIFFICULTIES.includes(cfg.difficulty as Difficulty))
      issues.push(err('bad-difficulty', `알 수 없는 난이도입니다: ${String(cfg.difficulty)}`, 'initialConfig.difficulty'));
    if (!FACTION_IDS.includes(cfg.humanFaction as FactionId))
      issues.push(err('bad-human-faction', '인간 세력이 잘못되었습니다', 'initialConfig.humanFaction'));
    if (cfg.modifier !== undefined && !(typeof cfg.modifier === 'string' && cfg.modifier in MODIFIERS))
      issues.push(err('bad-modifier', `알 수 없는 수정자입니다: ${String(cfg.modifier)}`, 'initialConfig.modifier'));
  }

  // result
  const result = raw.result;
  if (!isRecord(result)) {
    issues.push(err('bad-result', '결과 구조가 없습니다', 'result'));
  } else {
    const winnerOk =
      result.winner === 'draw' || FACTION_IDS.includes(result.winner as FactionId);
    if (!winnerOk) issues.push(err('bad-winner', '승자 표기가 잘못되었습니다', 'result.winner'));
    if (!intInRange(result.turns, 0, 10_000))
      issues.push(err('bad-turns', '종료 턴이 잘못되었습니다', 'result.turns'));
    if (!intInRange(result.score, -1_000_000_000, 1_000_000_000))
      issues.push(err('bad-score', '점수가 잘못되었습니다', 'result.score'));
    if (!intInRange(result.stars, 0, 12))
      issues.push(err('bad-stars', '별 수가 잘못되었습니다', 'result.stars'));
  }

  // commands
  const commands = raw.commands;
  if (!Array.isArray(commands)) {
    issues.push(err('bad-commands', '명령 배열이 없습니다', 'commands'));
  } else if (commands.length > REPLAY_MAX_COMMANDS) {
    issues.push({ code: 'too-many-commands', message: '명령 수가 한도를 초과합니다', severity: 'error', cause: 'limit', path: 'commands' });
  } else {
    for (let i = 0; i < commands.length; i++) {
      validateCommand(commands[i], i, issues);
      if (issues.length >= 20) break; // 손상 문서에 과도한 CPU를 쓰지 않는다
    }
  }

  // 관측 메타데이터(v2 전용·선택): 정본 결과에 관여하지 않지만 형식은 정밀 검증한다
  const observations = raw.observations;
  if (observations !== undefined) {
    if (schemaVersion === 1) {
      issues.push(err('bad-observations', 'v1 리플레이에는 관측 메타데이터가 존재할 수 없습니다', 'observations'));
    } else if (!Array.isArray(observations)) {
      issues.push(err('bad-observations', '관측 메타데이터가 배열이 아닙니다', 'observations'));
    } else if (Array.isArray(commands) && observations.length > commands.length) {
      issues.push({ code: 'too-many-observations', message: '관측 항목 수가 명령 수를 초과합니다', severity: 'error', cause: 'limit', path: 'observations' });
    } else {
      const commandCount = Array.isArray(commands) ? commands.length : 0;
      for (let i = 0; i < observations.length; i++) {
        const o: unknown = observations[i];
        const path = `observations[${i}]`;
        if (!isRecord(o)) {
          issues.push(err('bad-observation', '관측 항목이 객체가 아닙니다', path));
        } else {
          if (!intInRange(o.commandSeq, 0, Math.max(0, commandCount - 1)))
            issues.push(err('bad-observation-seq', '관측 항목의 명령 순번이 범위를 벗어납니다', `${path}.commandSeq`));
          if (o.elapsedMs !== undefined && !intInRange(o.elapsedMs, 0, 86_400_000))
            issues.push(err('bad-observation-time', '관측 시간 값이 잘못되었습니다', `${path}.elapsedMs`));
          if (o.hesitationMs !== undefined && !intInRange(o.hesitationMs, 0, 86_400_000))
            issues.push(err('bad-observation-time', '관측 시간 값이 잘못되었습니다', `${path}.hesitationMs`));
          if (o.canceledSelectionCount !== undefined && !intInRange(o.canceledSelectionCount, 0, 100_000))
            issues.push(err('bad-observation-count', '관측 횟수 값이 잘못되었습니다', `${path}.canceledSelectionCount`));
          if (o.cameraMoves !== undefined && !intInRange(o.cameraMoves, 0, 100_000))
            issues.push(err('bad-observation-count', '관측 횟수 값이 잘못되었습니다', `${path}.cameraMoves`));
        }
        if (issues.length >= 20) break;
      }
    }
  }

  // 플레이테스트 평가(선택): 정본·재생에 관여하지 않는다. 형식 오류 시 evaluation만 버린다(재생 차단 금지).
  const cleanedEvaluation = sanitizeEvaluation(raw.evaluation);
  if (raw.evaluation !== undefined) {
    if (cleanedEvaluation) raw.evaluation = cleanedEvaluation;
    else delete raw.evaluation;
  }

  // 중첩 시나리오(기존 검증기 재사용)
  if (issues.length === 0) {
    validateSnapshot(raw.scenario, issues);
  }

  if (issues.length > 0) return { ok: false, issues };
  if (schemaVersion === 1) {
    // v1 마이그레이션 후에도 evaluation이 있으면 보존(이미 위에서 정리됨)
    return decodeOk(migrateReplayV1(raw as unknown as ReplayDocumentV1), [
      { code: 'migrated-v1', message: 'v1 리플레이를 v2 형식으로 변환했습니다', severity: 'warning', cause: 'schema' },
    ]);
  }
  return decodeOk(raw as unknown as ReplayDocument);
}

/**
 * verifyReplay의 비예외 래퍼: 재생 중 내부 오류가 나도 예외를 밖으로 던지지 않는다.
 */
export function safeVerifyReplay(doc: ReplayDocument): ReplayVerification {
  try {
    return verifyReplay(doc);
  } catch {
    return { ok: false, reason: 'internal-error' };
  }
}

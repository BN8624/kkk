// 한 줄 목적: 외부 문서(시나리오·리플레이·공유 코드)의 공용 디코드 파이프라인 — 크기·깊이·노드 제한과 비예외 계약
import { SCENARIO_LIMITS, type ScenarioDocumentV1, type ValidationIssue } from './scenario/types';
import { parseScenarioDocument } from './scenario/validate';

// ---------------- 비예외 계약 타입 ----------------

export type DecodeSeverity = 'error' | 'warning';

/** 내부 원인 분류: input=입력 자체, limit=한도 초과, schema=구조, semantic=의미, internal=코드 결함. */
export type DecodeCause = 'input' | 'limit' | 'schema' | 'semantic' | 'internal';

export interface DecodeIssue {
  /** 안정적 오류 코드(테스트·번역 키로 사용) */
  code: string;
  /** 사용자에게 보여 줄 메시지 */
  message: string;
  /** 문제가 있는 필드 경로(예: commands[3].to.q) */
  path?: string;
  severity: DecodeSeverity;
  cause: DecodeCause;
}

export type DecodeResult<T> =
  | { ok: true; value: T; warnings: DecodeIssue[] }
  | { ok: false; issues: DecodeIssue[] };

export function decodeFail<T>(
  code: string,
  message: string,
  cause: DecodeCause,
  path?: string,
): DecodeResult<T> {
  return { ok: false, issues: [{ code, message, severity: 'error', cause, ...(path ? { path } : {}) }] };
}

export function decodeOk<T>(value: T, warnings: DecodeIssue[] = []): DecodeResult<T> {
  return { ok: true, value, warnings };
}

// ---------------- 공용 구조 제한 ----------------

export interface StructureLimits {
  /** 원문 최대 바이트(UTF-16 문자 기준 근사) */
  maxBytes: number;
  maxStringLen: number;
  maxArrayLen: number;
  maxObjectKeys: number;
  maxDepth: number;
  /** 전체 노드(값) 수 상한 — 거대한 평면 구조 방지 */
  maxNodes: number;
}

export const DEFAULT_LIMITS: StructureLimits = {
  maxBytes: 2 * 1024 * 1024,
  maxStringLen: 40_000,
  maxArrayLen: 120_000,
  maxObjectKeys: 128,
  maxDepth: 24,
  maxNodes: 600_000,
};

export const SCENARIO_DECODE_LIMITS: StructureLimits = {
  ...DEFAULT_LIMITS,
  maxBytes: SCENARIO_LIMITS.maxImportBytes,
  maxArrayLen: 4_000,
  maxNodes: 80_000,
};

/** prototype 오염·특수 키는 어떤 문서에서도 허용하지 않는다. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * 값 트리를 반복(비재귀)으로 훑어 깊이·크기·노드 수·순환 참조를 검사한다.
 * 위반이 있으면 첫 위반을 담은 DecodeIssue를, 없으면 null을 반환한다.
 */
export function scanStructure(root: unknown, limits: StructureLimits): DecodeIssue | null {
  const bad = (code: string, message: string): DecodeIssue => ({
    code,
    message,
    severity: 'error',
    cause: 'limit',
  });
  let nodes = 0;
  const seen = new Set<object>();
  const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    nodes++;
    if (nodes > limits.maxNodes) return bad('too-many-nodes', '문서의 값 수가 한도를 초과합니다');
    if (depth > limits.maxDepth) return bad('too-deep', '문서가 지나치게 깊게 중첩되어 있습니다');
    if (typeof value === 'string') {
      if (value.length > limits.maxStringLen)
        return bad('string-too-long', '문서에 지나치게 긴 문자열이 있습니다');
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value))
        return { code: 'non-finite-number', message: '문서에 유한하지 않은 숫자가 있습니다', severity: 'error', cause: 'schema' };
      continue;
    }
    if (value === null || typeof value !== 'object') continue;
    if (seen.has(value))
      return { code: 'circular', message: '문서에 순환 참조가 있습니다', severity: 'error', cause: 'schema' };
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > limits.maxArrayLen)
        return bad('array-too-long', '문서에 지나치게 긴 배열이 있습니다');
      for (const v of value) stack.push({ value: v, depth: depth + 1 });
      continue;
    }
    const keys = Object.keys(value);
    if (keys.length > limits.maxObjectKeys)
      return bad('too-many-keys', '문서의 객체 키 수가 한도를 초과합니다');
    for (const k of keys) {
      if (FORBIDDEN_KEYS.has(k))
        return { code: 'forbidden-key', message: '허용되지 않는 특수 키가 있습니다', severity: 'error', cause: 'schema' };
      stack.push({ value: (value as Record<string, unknown>)[k], depth: depth + 1 });
    }
  }
  return null;
}

/**
 * 문자열 → JSON 값. 크기 제한과 구조 제한을 통과해야 값을 돌려준다. 예외를 던지지 않는다.
 */
export function safeJsonParse(text: string, limits: StructureLimits): DecodeResult<unknown> {
  if (typeof text !== 'string') return decodeFail('not-text', '텍스트 입력이 아닙니다', 'input');
  if (text.length === 0) return decodeFail('empty', '내용이 비어 있습니다', 'input');
  if (text.length > limits.maxBytes) return decodeFail('too-big', '문서가 너무 큽니다', 'limit');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return decodeFail('bad-json', '올바른 JSON이 아닙니다', 'input');
  }
  const violation = scanStructure(value, limits);
  if (violation) return { ok: false, issues: [violation] };
  return decodeOk(value);
}

// ---------------- 필드 검증 헬퍼 ----------------

export function isFiniteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

export function intInRange(v: unknown, min: number, max: number): v is number {
  return isFiniteInt(v) && v >= min && v <= max;
}

export function isShortString(v: unknown, maxLen: number): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= maxLen;
}

/** 16자리 소문자 16진수 다이제스트 형식. */
export function isDigestString(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
}

/** 제어 문자(0x00~0x1f, 0x7f) 포함 여부 — ID 등 짧은 식별 문자열에 허용하지 않는다. */
export function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

// ---------------- 시나리오 문서 디코드 ----------------

function fromValidationIssue(i: ValidationIssue): DecodeIssue {
  return {
    code: i.code,
    message: i.message,
    severity: i.severity === 'error' ? 'error' : 'warning',
    cause: 'semantic',
    ...(i.path ? { path: i.path } : {}),
  };
}

/**
 * 외부 시나리오 입력(문자열 또는 이미 파싱된 값)을 검증된 문서로 디코드한다.
 * 기존 parseScenarioDocument·validateScenario를 재사용하며, 예외를 던지지 않는다.
 */
export function decodeScenarioInput(input: string | unknown): DecodeResult<ScenarioDocumentV1> {
  let raw: unknown;
  if (typeof input === 'string') {
    const parsed = safeJsonParse(input, SCENARIO_DECODE_LIMITS);
    if (!parsed.ok) return parsed as DecodeResult<ScenarioDocumentV1>;
    raw = parsed.value;
  } else {
    const violation = scanStructure(input, SCENARIO_DECODE_LIMITS);
    if (violation) return { ok: false, issues: [violation] };
    raw = input;
  }
  try {
    const { doc, issues } = parseScenarioDocument(raw);
    if (!doc) return { ok: false, issues: issues.map(fromValidationIssue) };
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) return { ok: false, issues: errors.map(fromValidationIssue) };
    return decodeOk(doc, issues.map(fromValidationIssue));
  } catch {
    return decodeFail('internal', '문서를 해석하는 중 내부 오류가 발생했습니다', 'internal');
  }
}

// 한 줄 목적: 시나리오 문서를 압축 공유 코드(base64url)·공유 URL로 인코딩하고 안전하게 디코딩한다
import {
  SCENARIO_LIMITS,
  type ScenarioDocumentV1,
  type ValidationIssue,
} from '../core/scenario/types';
import { parseScenarioDocument } from '../core/scenario/validate';
import { SCENARIO_DECODE_LIMITS, scanStructure } from '../core/decode';

/** 공유 코드 접두사. D=deflate-raw 압축, R=무압축(CompressionStream 미지원 환경 폴백). */
const PREFIX_DEFLATE = 'TCS1.';
const PREFIX_RAW = 'TCS1R.';

/** URL 해시 공유를 허용하는 최대 코드 길이(문자). 초과 시 코드·파일 공유만 안내한다. */
export const SHARE_URL_MAX_CODE_LEN = 8000;

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** 스트림을 통과시키되 출력이 한도를 넘으면 중단한다(압축 폭탄 방지). */
async function pipeLimited(
  input: Uint8Array<ArrayBuffer>,
  transform: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> } | null,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (!transform) return input.length <= maxBytes ? input : null;
  const writer = transform.writable.getWriter();
  void writer
    .write(input)
    .then(() => writer.close())
    .catch(() => {});
  const reader = transform.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** 문서 → 공유 코드. 압축 지원 환경에서는 deflate-raw, 아니면 무압축 폴백. */
export async function encodeShareCode(doc: ScenarioDocumentV1): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  if (typeof CompressionStream !== 'undefined') {
    const out = await pipeLimited(
      bytes,
      new CompressionStream('deflate-raw'),
      SCENARIO_LIMITS.maxImportBytes,
    );
    if (out) return PREFIX_DEFLATE + toBase64Url(out);
  }
  return PREFIX_RAW + toBase64Url(bytes);
}

/**
 * 공유 코드(또는 공유 URL 전체 텍스트) → 문서.
 * 접두사·크기·구조·스키마 버전을 모두 검증하고, 실패 시 사람이 읽을 오류를 돌려준다.
 */
export async function decodeShareCode(
  input: string,
): Promise<{ doc: ScenarioDocumentV1 | null; issues: ValidationIssue[] }> {
  const fail = (message: string): { doc: null; issues: ValidationIssue[] } => ({
    doc: null,
    issues: [{ code: 'share-code', severity: 'error', message }],
  });
  let text = input.trim();
  // 공유 URL 전체를 붙여 넣어도 해시의 코드만 골라낸다
  const hashAt = text.indexOf('#s=');
  if (hashAt >= 0) text = text.slice(hashAt + 3);
  if (text.length > SCENARIO_LIMITS.maxImportBytes) return fail('공유 코드가 너무 깁니다');

  let compressed: boolean;
  if (text.startsWith(PREFIX_RAW)) {
    compressed = false;
    text = text.slice(PREFIX_RAW.length);
  } else if (text.startsWith(PREFIX_DEFLATE)) {
    compressed = true;
    text = text.slice(PREFIX_DEFLATE.length);
  } else {
    return fail('공유 코드 형식이 아닙니다(TCS1 코드가 필요합니다)');
  }

  const bytes = fromBase64Url(text);
  if (!bytes) return fail('공유 코드가 손상되었습니다');
  let jsonBytes: Uint8Array | null = bytes;
  if (compressed) {
    if (typeof DecompressionStream === 'undefined') {
      return fail('이 브라우저는 압축 공유 코드를 지원하지 않습니다');
    }
    jsonBytes = await pipeLimited(
      bytes,
      new DecompressionStream('deflate-raw'),
      SCENARIO_LIMITS.maxImportBytes,
    );
  } else if (jsonBytes.length > SCENARIO_LIMITS.maxImportBytes) {
    jsonBytes = null;
  }
  if (!jsonBytes) return fail('공유 코드를 풀 수 없거나 너무 큽니다');

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch {
    return fail('공유 코드 내용이 올바른 JSON이 아닙니다');
  }
  // 공용 구조 제한(깊이·노드·문자열 길이)을 공유 코드에도 동일하게 적용한다
  const violation = scanStructure(raw, SCENARIO_DECODE_LIMITS);
  if (violation) return fail(violation.message);
  return parseScenarioDocument(raw);
}

/** 코드가 URL 해시로 공유 가능한 길이면 공유 URL을, 아니면 null을 돌려준다. */
export function shareUrlFromCode(code: string, base: string): string | null {
  if (code.length > SHARE_URL_MAX_CODE_LEN) return null;
  return `${base}#s=${code}`;
}

// 한 줄 목적: 시나리오 공유 코드 인코딩·디코딩의 왕복·안전 거부·URL 규칙을 검증한다
import { describe, expect, it } from 'vitest';

import { cloneBuiltinDocument, emptyDocument } from '../src/editor/new-doc';
import {
  decodeShareCode,
  encodeShareCode,
  SHARE_URL_MAX_CODE_LEN,
  shareUrlFromCode,
} from '../src/editor/share';
import { SCENARIO_LIMITS } from '../src/core/scenario/types';

describe('공유 코드', () => {
  it('내장 복제 문서가 압축 코드로 왕복된다', async () => {
    const doc = cloneBuiltinDocument('three-crowns', 'custom-1', 7, '공유 테스트');
    const code = await encodeShareCode(doc);
    expect(code.startsWith('TCS1.')).toBe(true);
    // 압축 코드는 원문 JSON보다 짧아야 한다
    expect(code.length).toBeLessThan(JSON.stringify(doc).length);
    const { doc: back, issues } = await decodeShareCode(code);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(back).toEqual(doc);
  });

  it('공유 URL 전체를 붙여 넣어도 코드만 추려 해석한다', async () => {
    const doc = emptyDocument('custom-2');
    const code = await encodeShareCode(doc);
    const url = shareUrlFromCode(code, 'https://bn8624.github.io/kkk/');
    expect(url).not.toBeNull();
    const { doc: back } = await decodeShareCode(url!);
    expect(back).toEqual(doc);
  });

  it('무압축 폴백 코드(TCS1R)도 해석한다', async () => {
    const doc = emptyDocument('custom-3');
    const raw = Buffer.from(JSON.stringify(doc), 'utf8').toString('base64url');
    const { doc: back } = await decodeShareCode(`TCS1R.${raw}`);
    expect(back).toEqual(doc);
  });

  it('접두사가 없거나 손상된 코드는 안전하게 거부한다', async () => {
    expect((await decodeShareCode('hello world')).doc).toBeNull();
    expect((await decodeShareCode('TCS1.@@@@')).doc).toBeNull();
    expect((await decodeShareCode('TCS1.aGVsbG8')).doc).toBeNull();
  });

  it('알 수 없는 미래 스키마 버전은 거부한다', async () => {
    const future = { ...emptyDocument('custom-4'), schemaVersion: 2 };
    const raw = Buffer.from(JSON.stringify(future), 'utf8').toString('base64url');
    const { doc, issues } = await decodeShareCode(`TCS1R.${raw}`);
    expect(doc).toBeNull();
    expect(issues.length).toBeGreaterThan(0);
  });

  it('크기 한도를 넘는 입력은 거부한다', async () => {
    const huge = `TCS1R.${'A'.repeat(SCENARIO_LIMITS.maxImportBytes + 10)}`;
    expect((await decodeShareCode(huge)).doc).toBeNull();
  });

  it('너무 긴 코드는 URL 공유 대상에서 제외한다', () => {
    expect(shareUrlFromCode('A'.repeat(SHARE_URL_MAX_CODE_LEN + 1), 'https://x/')).toBeNull();
    expect(shareUrlFromCode('AB', 'https://x/')).toBe('https://x/#s=AB');
  });
});

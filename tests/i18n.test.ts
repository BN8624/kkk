// 한 줄 목적: ko/en 사전의 키 완전성·자리 표시자 정합·언어 전환 동작을 검증한다
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import {
  getLocale,
  onLocaleChange,
  preferredLocale,
  resultShareText,
  setLocale,
  t,
  type MessageKey,
} from '../src/i18n';
import { EN } from '../src/i18n/en';
import { KO } from '../src/i18n/ko';

afterEach(() => setLocale('ko'));

describe('i18n 사전', () => {
  it('영어 사전은 한국어 사전의 모든 키를 비어 있지 않게 구현한다(누락 키 0)', () => {
    const koKeys = Object.keys(KO).sort();
    const enKeys = Object.keys(EN).sort();
    expect(enKeys).toEqual(koKeys);
    for (const k of koKeys) {
      expect(KO[k as MessageKey].length, `ko:${k}`).toBeGreaterThan(0);
      expect(EN[k as MessageKey].length, `en:${k}`).toBeGreaterThan(0);
    }
  });

  it('자리 표시자 {name} 집합이 두 언어에서 일치한다', () => {
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(KO) as MessageKey[]) {
      expect(params(EN[k]), k).toEqual(params(KO[k]));
    }
  });

  it('사용자 문자열에 이스케이프 전 HTML 마크업을 넣지 않는다', () => {
    for (const [k, v] of [...Object.entries(KO), ...Object.entries(EN)]) {
      expect(v.includes('<'), k).toBe(false);
    }
  });

  it('사용자 화면 계층에 한국어 문자열 리터럴을 하드코딩하지 않는다', () => {
    const targets = [
      resolve('src/app'),
      resolve('src/controllers'),
      resolve('src/ui'),
      resolve('src/core/scenario/validate.ts'),
      resolve('src/core/scenario/quality.ts'),
      resolve('src/editor/new-doc.ts'),
    ];
    const files: string[] = [];
    const collect = (target: string) => {
      if (statSync(target).isDirectory()) {
        for (const name of readdirSync(target)) collect(resolve(target, name));
      } else if (target.endsWith('.ts')) {
        files.push(target);
      }
    };
    targets.forEach(collect);

    const violations: string[] = [];
    for (const file of files) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        const text =
          ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
            ? node.text
            : ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
              ? node.text
              : null;
        if (text && /[가-힣]/.test(text)) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          violations.push(`${file}:${line} ${text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
  });
});

describe('언어 전환', () => {
  it('최초 시스템 언어는 한국어면 ko, 그 외에는 en을 선택한다', () => {
    expect(preferredLocale(['ko-KR', 'en-US'])).toBe('ko');
    expect(preferredLocale(['en-US'])).toBe('en');
    expect(preferredLocale(['ja-JP'])).toBe('en');
  });

  it('t()가 현재 언어의 문자열과 파라미터 치환을 돌려준다', () => {
    expect(getLocale()).toBe('ko');
    expect(t('title.quickBattle')).toBe('빠른 전투');
    setLocale('en');
    expect(t('title.quickBattle')).toBe('Quick Battle');
  });

  it('setLocale이 구독자에게 알리고 해제가 동작한다', () => {
    let calls = 0;
    const off = onLocaleChange(() => calls++);
    setLocale('en');
    expect(calls).toBe(1);
    setLocale('en'); // 같은 값은 알리지 않는다
    expect(calls).toBe(1);
    off();
    setLocale('ko');
    expect(calls).toBe(1);
  });

  it('영어 결과 공유 문자열의 동적 값까지 번역한다', () => {
    setLocale('en');
    const text = resultShareText({
      scenarioName: 'Broken Strait',
      difficultyName: 'Hard',
      factionName: 'Crimson Duchy',
      outcome: 'win',
      turns: 9,
      score: 86,
      captured: 5,
      kills: 8,
      seed: 20260719,
      daily: true,
      modifierName: 'Sharp Arrows',
    });
    expect(text).toContain('Victory in 9 turns');
    expect(text).toContain('Daily Challenge');
    expect(text).toContain('Modifier: Sharp Arrows');
    expect(text).not.toMatch(/[가-힣]/);
  });
});

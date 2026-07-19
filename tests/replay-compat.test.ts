// 한 줄 목적: 리플레이 게임 버전 호환 판정(exact·migratable·playable-unverified·unsupported)과 마이그레이션 기제를 검증한다
import { describe, expect, it } from 'vitest';
import { GAME_VERSION, type ReplayDocument } from '../src/core/replay';
import {
  checkReplayCompatibility,
  compatibilityLabel,
  matchVersionRange,
  parseVersion,
  type ReplayRuleVersion,
} from '../src/core/replay-compat';

function docWithVersion(gameVersion: string): Pick<ReplayDocument, 'gameVersion'> {
  return { gameVersion };
}

describe('버전 범위 대조', () => {
  it('패치 와일드카드와 정확 버전을 지원한다', () => {
    expect(matchVersionRange('1.5.0', '1.5.x')).toBe(true);
    expect(matchVersionRange('1.5.9', '1.5.x')).toBe(true);
    expect(matchVersionRange('1.6.0', '1.5.x')).toBe(false);
    expect(matchVersionRange('2.5.0', '1.5.x')).toBe(false);
    expect(matchVersionRange('1.5.2', '1.5.2')).toBe(true);
    expect(matchVersionRange('1.5.3', '1.5.2')).toBe(false);
    expect(matchVersionRange('garbage', '1.5.x')).toBe(false);
    expect(matchVersionRange('1.5.0', 'garbage')).toBe(false);
  });

  it('parseVersion은 형식이 어긋나면 null', () => {
    expect(parseVersion('1.5.0')).toEqual([1, 5, 0]);
    expect(parseVersion('evil')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });
});

describe('호환 판정', () => {
  it('1.5.x 리플레이는 exact', () => {
    expect(checkReplayCompatibility(docWithVersion('1.5.0')).compatibility).toBe('exact');
    expect(checkReplayCompatibility(docWithVersion('1.5.3')).compatibility).toBe('exact');
  });

  it('2.0.x 리플레이는 exact(규칙 동일 계열)', () => {
    expect(checkReplayCompatibility(docWithVersion('2.0.0')).compatibility).toBe('exact');
  });

  it('현재 게임 버전은 항상 exact 계열에 속한다', () => {
    expect(checkReplayCompatibility(docWithVersion(GAME_VERSION)).compatibility).toBe('exact');
  });

  it('리플레이 도입 이전 버전 표기는 unsupported', () => {
    expect(checkReplayCompatibility(docWithVersion('1.0.0')).compatibility).toBe('unsupported');
    expect(checkReplayCompatibility(docWithVersion('0.9.0')).compatibility).toBe('unsupported');
    expect(checkReplayCompatibility(docWithVersion('1.4.9')).compatibility).toBe('unsupported');
  });

  it('레지스트리에 없는 미래·중간 버전은 playable-unverified', () => {
    expect(checkReplayCompatibility(docWithVersion('1.6.0')).compatibility).toBe('playable-unverified');
    expect(checkReplayCompatibility(docWithVersion('3.0.0')).compatibility).toBe('playable-unverified');
  });

  it('해석 불가 버전은 unsupported', () => {
    expect(checkReplayCompatibility(docWithVersion('evil')).compatibility).toBe('unsupported');
    expect(checkReplayCompatibility(docWithVersion('')).compatibility).toBe('unsupported');
  });

  it('판정은 항상 사용자 이유 문자열을 포함하고 예외를 던지지 않는다', () => {
    for (const v of ['1.5.0', '2.0.0', '9.9.9', '0.0.1', 'x', '1.5']) {
      const d = checkReplayCompatibility(docWithVersion(v));
      expect(typeof d.reason).toBe('string');
      expect(d.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('마이그레이션 기제', () => {
  it('migratable 항목은 migrate 결과를 돌려주고, 실패·예외 시 unsupported로 강등된다', () => {
    const migratedDoc = { gameVersion: GAME_VERSION } as ReplayDocument;
    const registry: ReplayRuleVersion[] = [
      { versionRange: '1.4.x', compatibility: 'migratable', migrate: () => migratedDoc },
      { versionRange: '1.3.x', compatibility: 'migratable', migrate: () => null },
      {
        versionRange: '1.2.x',
        compatibility: 'migratable',
        migrate: () => {
          throw new Error('boom');
        },
      },
    ];
    const ok = checkReplayCompatibility(docWithVersion('1.4.0'), registry);
    expect(ok.compatibility).toBe('migratable');
    expect(ok.migrated).toBe(migratedDoc);
    expect(checkReplayCompatibility(docWithVersion('1.3.0'), registry).compatibility).toBe('unsupported');
    expect(checkReplayCompatibility(docWithVersion('1.2.0'), registry).compatibility).toBe('unsupported');
  });
});

describe('배지 표기', () => {
  it('네 등급 모두 한국어 배지를 갖는다', () => {
    expect(compatibilityLabel('exact')).toBe('검증됨');
    expect(compatibilityLabel('migratable')).toBe('변환됨');
    expect(compatibilityLabel('playable-unverified')).toBe('재생만 가능');
    expect(compatibilityLabel('unsupported')).toBe('지원 안 함');
  });
});

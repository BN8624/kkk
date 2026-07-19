// 한 줄 목적: 리플레이의 게임 규칙 버전 호환 판정(exact·migratable·playable-unverified·unsupported)과 마이그레이션
import type { ReplayDocument } from './replay';

/**
 * 호환 등급.
 * - exact: 동일 규칙 계열 — 결정론 검증(digest 일치) 가능
 * - migratable: 명시적 마이그레이션 후 exact 검증 가능
 * - playable-unverified: 화면 재생은 가능하지만 현재 엔진과 결과가 다를 수 있음(정본 아님)
 * - unsupported: 안전 거부
 */
export type ReplayCompatibility = 'exact' | 'migratable' | 'playable-unverified' | 'unsupported';

export interface ReplayRuleVersion {
  /** 버전 범위: 'major.minor.x'(패치 무관) 또는 정확한 'major.minor.patch'. */
  versionRange: string;
  compatibility: ReplayCompatibility;
  /** migratable일 때 필수: 현재 문서 형식으로 변환한다(예외를 던지지 않아야 한다). */
  migrate?: (doc: ReplayDocument) => ReplayDocument | null;
}

export interface CompatibilityDecision {
  compatibility: ReplayCompatibility;
  /** UI가 현재 언어의 설명으로 바꾸는 안정적인 판정 사유 코드. */
  reasonCode:
    | 'invalid-version'
    | 'migration-failed'
    | 'migrated'
    | 'exact'
    | 'unverified'
    | 'rules-changed'
    | 'predates-replay';
  gameVersion: string;
  /** migratable 판정 시 변환된 문서. */
  migrated?: ReplayDocument;
}

/** 'a.b.x' 패턴 또는 정확한 버전과 대조한다. 형식이 어긋나면 false. */
export function matchVersionRange(version: string, range: string): boolean {
  const v = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!v) return false;
  const r = /^(\d+)\.(\d+)\.(\d+|x)$/.exec(range);
  if (!r) return false;
  if (v[1] !== r[1] || v[2] !== r[2]) return false;
  return r[3] === 'x' || v[3] === r[3];
}

/** 버전을 [major, minor, patch] 정수로. 형식이 어긋나면 null. */
export function parseVersion(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * 규칙 버전 레지스트리. 전투 수치·규칙이 실제로 바뀔 때만 항목을 추가한다.
 * 1.5.x·2.0.x 비-crown 은 규칙 동일(exact). 2.0 crown-heart 는 왕관 규칙 변경으로 별도 강등.
 * 2.1.x 가 현재 exact 계열이다.
 */
export const REPLAY_RULE_VERSIONS: ReplayRuleVersion[] = [
  { versionRange: '1.5.x', compatibility: 'exact' },
  { versionRange: '2.0.x', compatibility: 'exact' },
  { versionRange: '2.1.x', compatibility: 'exact' },
];

/** 리플레이가 도입된 최초 버전 — 이보다 낮은 표기는 존재할 수 없는 기록이다. */
const FIRST_REPLAY_VERSION: [number, number, number] = [1, 5, 0];

/** 왕관 규칙이 바뀐 버전 — 이보다 낮은 crown-heart 리플레이는 exact 검증 불가. */
const CROWN_RULES_CHANGED_AT: [number, number, number] = [2, 1, 0];

function cmpVersion(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * 게임 버전 호환 판정. 예외를 던지지 않는다.
 * 레지스트리에 없는 미래·중간 버전은 재생만 가능(playable-unverified)으로 취급한다.
 * 2.1 미만 crown-heart 는 왕관 규칙 변경으로 exact 를 강등한다.
 */
export function checkReplayCompatibility(
  doc: Pick<ReplayDocument, 'gameVersion' | 'scenario'>,
  registry: ReplayRuleVersion[] = REPLAY_RULE_VERSIONS,
): CompatibilityDecision {
  const parsed = parseVersion(doc.gameVersion);
  if (!parsed) {
    return {
      compatibility: 'unsupported',
      reasonCode: 'invalid-version',
      gameVersion: doc.gameVersion,
    };
  }
  for (const entry of registry) {
    if (!matchVersionRange(doc.gameVersion, entry.versionRange)) continue;
    if (entry.compatibility === 'migratable') {
      let migrated: ReplayDocument | null = null;
      try {
        migrated = entry.migrate ? entry.migrate(doc as ReplayDocument) : null;
      } catch {
        migrated = null;
      }
      if (!migrated) {
        return {
          compatibility: 'unsupported',
          reasonCode: 'migration-failed',
          gameVersion: doc.gameVersion,
        };
      }
      return {
        compatibility: 'migratable',
        reasonCode: 'migrated',
        gameVersion: doc.gameVersion,
        migrated,
      };
    }
    // 왕관 규칙 변경 이전 crown-heart 는 exact 검증이 부정직하므로 재생만 허용
    if (
      entry.compatibility === 'exact' &&
      cmpVersion(parsed, CROWN_RULES_CHANGED_AT) < 0 &&
      doc.scenario?.id === 'crown-heart'
    ) {
      return {
        compatibility: 'playable-unverified',
        reasonCode: 'rules-changed',
        gameVersion: doc.gameVersion,
      };
    }
    return {
      compatibility: entry.compatibility,
      reasonCode: entry.compatibility === 'exact' ? 'exact' : 'unverified',
      gameVersion: doc.gameVersion,
    };
  }
  if (cmpVersion(parsed, FIRST_REPLAY_VERSION) < 0) {
    return {
      compatibility: 'unsupported',
      reasonCode: 'predates-replay',
      gameVersion: doc.gameVersion,
    };
  }
  // 레지스트리에 없는 이후·미래 버전: 규칙이 달라졌을 수 있으므로 정본 검증 없이 재생만 허용
  return {
    compatibility: 'playable-unverified',
    reasonCode: 'unverified',
    gameVersion: doc.gameVersion,
  };
}

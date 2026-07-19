// 한 줄 목적: 리플레이의 게임 규칙 버전 호환 판정(exact·migratable·playable-unverified·unsupported)과 마이그레이션
import { GAME_VERSION, type ReplayDocumentV1 } from './replay';

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
  migrate?: (doc: ReplayDocumentV1) => ReplayDocumentV1 | null;
}

export interface CompatibilityDecision {
  compatibility: ReplayCompatibility;
  /** 사용자에게 보여 줄 판정 이유. */
  reason: string;
  /** migratable 판정 시 변환된 문서. */
  migrated?: ReplayDocumentV1;
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
 * 1.5.0에서 리플레이가 도입되었고, 2.0.x까지 전투 규칙은 변하지 않았다(exact 계열).
 */
export const REPLAY_RULE_VERSIONS: ReplayRuleVersion[] = [
  { versionRange: '1.5.x', compatibility: 'exact' },
  { versionRange: '2.0.x', compatibility: 'exact' },
];

/** 리플레이가 도입된 최초 버전 — 이보다 낮은 표기는 존재할 수 없는 기록이다. */
const FIRST_REPLAY_VERSION: [number, number, number] = [1, 5, 0];

function cmpVersion(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * 게임 버전 호환 판정. 예외를 던지지 않는다.
 * 레지스트리에 없는 미래·중간 버전은 재생만 가능(playable-unverified)으로 취급한다.
 */
export function checkReplayCompatibility(
  doc: Pick<ReplayDocumentV1, 'gameVersion'>,
  registry: ReplayRuleVersion[] = REPLAY_RULE_VERSIONS,
): CompatibilityDecision {
  const parsed = parseVersion(doc.gameVersion);
  if (!parsed) {
    return { compatibility: 'unsupported', reason: '게임 버전 표기를 해석할 수 없습니다' };
  }
  for (const entry of registry) {
    if (!matchVersionRange(doc.gameVersion, entry.versionRange)) continue;
    if (entry.compatibility === 'migratable') {
      let migrated: ReplayDocumentV1 | null = null;
      try {
        migrated = entry.migrate ? entry.migrate(doc as ReplayDocumentV1) : null;
      } catch {
        migrated = null;
      }
      if (!migrated) {
        return { compatibility: 'unsupported', reason: '이 버전의 리플레이를 변환하지 못했습니다' };
      }
      return {
        compatibility: 'migratable',
        reason: `게임 버전 ${doc.gameVersion} 리플레이를 현재 형식으로 변환했습니다`,
        migrated,
      };
    }
    return {
      compatibility: entry.compatibility,
      reason:
        entry.compatibility === 'exact'
          ? `현재 게임 규칙(${GAME_VERSION})과 같은 계열입니다`
          : `게임 버전 ${doc.gameVersion} 기록 — 현재 규칙과 결과가 다를 수 있습니다`,
    };
  }
  if (cmpVersion(parsed, FIRST_REPLAY_VERSION) < 0) {
    return {
      compatibility: 'unsupported',
      reason: `게임 버전 ${doc.gameVersion}에는 리플레이 기능이 없었습니다 — 손상되었거나 위조된 기록입니다`,
    };
  }
  // 레지스트리에 없는 이후·미래 버전: 규칙이 달라졌을 수 있으므로 정본 검증 없이 재생만 허용
  return {
    compatibility: 'playable-unverified',
    reason: `게임 버전 ${doc.gameVersion}의 기록입니다 — 현재 버전(${GAME_VERSION})과 결과가 다를 수 있습니다`,
  };
}

/** 보관함 배지 등 짧은 한국어 표기. */
export function compatibilityLabel(c: ReplayCompatibility): string {
  switch (c) {
    case 'exact':
      return '검증됨';
    case 'migratable':
      return '변환됨';
    case 'playable-unverified':
      return '재생만 가능';
    case 'unsupported':
      return '지원 안 함';
  }
}

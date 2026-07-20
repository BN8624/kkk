// 한 줄 목적: 리플레이 게임 버전 호환 판정(exact·migratable·playable-unverified·unsupported)과 마이그레이션 기제를 검증한다
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { executeCommand } from '../src/core/command';
import {
  GAME_VERSION,
  migrateReplayDocumentV220,
  replayInitialState,
  stateDigest,
  stateDigestV220,
  verifyReplay,
  type ReplayDocument,
} from '../src/core/replay';
import {
  checkReplayCompatibility,
  matchVersionRange,
  parseVersion,
  type ReplayRuleVersion,
} from '../src/core/replay-compat';
import { decodeReplayDocument } from '../src/core/replay-decode';
import type { ScenarioRuntimeSnapshot } from '../src/core/scenario/types';

function scenarioStub(id: string): ScenarioRuntimeSnapshot {
  return { id } as ScenarioRuntimeSnapshot;
}

function docWithVersion(
  gameVersion: string,
  scenarioId = 'three-crowns',
): Pick<ReplayDocument, 'gameVersion' | 'scenario'> {
  return { gameVersion, scenario: scenarioStub(scenarioId) };
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
  it('1.5.x 비-crown 리플레이는 exact', () => {
    expect(checkReplayCompatibility(docWithVersion('1.5.0')).compatibility).toBe('exact');
    expect(checkReplayCompatibility(docWithVersion('1.5.3', 'broken-strait')).compatibility).toBe(
      'exact',
    );
  });

  it('2.0.x three-crowns 리플레이는 exact', () => {
    const d = checkReplayCompatibility(docWithVersion('2.0.0', 'three-crowns'));
    expect(d.compatibility).toBe('exact');
    expect(d.reasonCode).toBe('exact');
  });

  it('2.0.x crown-heart 리플레이는 playable-unverified(rules-changed)', () => {
    const d = checkReplayCompatibility(docWithVersion('2.0.0', 'crown-heart'));
    expect(d.compatibility).toBe('playable-unverified');
    expect(d.reasonCode).toBe('rules-changed');
  });

  it('2.0.x broken-strait 리플레이는 exact', () => {
    expect(checkReplayCompatibility(docWithVersion('2.0.1', 'broken-strait')).compatibility).toBe(
      'exact',
    );
  });

  it('2.1.0·2.2.1·현재 게임 버전은 exact', () => {
    expect(checkReplayCompatibility(docWithVersion('2.1.0')).compatibility).toBe('exact');
    expect(checkReplayCompatibility(docWithVersion('2.1.0', 'crown-heart')).compatibility).toBe(
      'exact',
    );
    expect(checkReplayCompatibility(docWithVersion('2.2.1')).compatibility).toBe('exact');
    expect(checkReplayCompatibility(docWithVersion('2.2.1', 'crown-heart')).compatibility).toBe(
      'exact',
    );
    expect(checkReplayCompatibility(docWithVersion(GAME_VERSION)).compatibility).toBe('exact');
    expect(checkReplayCompatibility(docWithVersion(GAME_VERSION, 'crown-heart')).compatibility).toBe(
      'exact',
    );
  });

  it('2.2.0은 migratable(검증 없이 exact로 표시하지 않는다)', () => {
    const d = checkReplayCompatibility(docWithVersion('2.2.0'));
    // stub 문서는 migrate 실패 → unsupported 또는 실제 fixture에서 migratable.
    // 정책 항목 자체는 2.2.0을 exact로 두지 않는다.
    expect(d.compatibility).not.toBe('exact');
    expect(['migratable', 'unsupported']).toContain(d.compatibility);
  });

  /**
   * 보관함 openReplayById → playFromDocument 분기 계약.
   * 저장된 문서도 가져오기와 동일하게 checkReplayCompatibility 결과를 따른다.
   */
  describe('보관함 열기 호환 분기(playFromDocument 계약)', () => {
    /** openPlayback 옵션으로 매핑되는 재생 모드 */
    function archiveOpenMode(
      gameVersion: string,
      scenarioId: string,
    ): 'unverified' | 'verified' | 'reject' {
      const d = checkReplayCompatibility(docWithVersion(gameVersion, scenarioId));
      if (d.compatibility === 'unsupported') return 'reject';
      if (d.compatibility === 'playable-unverified') return 'unverified';
      return 'verified';
    }

    it('보관함 2.0.x crown-heart → playable-unverified(확인 후 unverified 재생)', () => {
      expect(archiveOpenMode('2.0.0', 'crown-heart')).toBe('unverified');
      expect(archiveOpenMode('2.0.5', 'crown-heart')).toBe('unverified');
    });

    it('보관함 exact(2.1.x crown · 2.0.x 비-crown) → 검증 재생', () => {
      expect(archiveOpenMode('2.1.0', 'crown-heart')).toBe('verified');
      expect(archiveOpenMode(GAME_VERSION, 'crown-heart')).toBe('verified');
      expect(archiveOpenMode('2.0.0', 'three-crowns')).toBe('verified');
      expect(archiveOpenMode('2.0.1', 'broken-strait')).toBe('verified');
    });
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

  it('판정은 항상 안정적인 이유 코드를 포함하고 예외를 던지지 않는다', () => {
    for (const v of ['1.5.0', '2.0.0', '2.1.0', '9.9.9', '0.0.1', 'x', '1.5']) {
      const d = checkReplayCompatibility(docWithVersion(v));
      expect(typeof d.reasonCode).toBe('string');
      expect(d.reasonCode.length).toBeGreaterThan(0);
    }
  });
});

describe('마이그레이션 기제', () => {
  it('migratable 항목은 migrate 결과를 돌려주고, 실패·예외 시 unsupported로 강등된다', () => {
    const migratedDoc = {
      gameVersion: GAME_VERSION,
      scenario: scenarioStub('three-crowns'),
    } as ReplayDocument;
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
    expect(checkReplayCompatibility(docWithVersion('1.3.0'), registry).compatibility).toBe(
      'unsupported',
    );
    expect(checkReplayCompatibility(docWithVersion('1.2.0'), registry).compatibility).toBe(
      'unsupported',
    );
  });
});

describe('2.2.0 guardian fixture(5a7bbac 동결) 호환', () => {
  /** 5a7bbac worktree에서 생성·동결한 실제 2.2.0 digest 리플레이 */
  function loadFixture(): ReplayDocument {
    const raw = readFileSync(
      new URL('./fixtures/replay-2.2.0-guardian.json', import.meta.url),
      'utf8',
    );
    const decoded = decodeReplayDocument(raw);
    expect(decoded.ok, decoded.ok ? '' : decoded.issues.map((i) => i.message).join('; ')).toBe(
      true,
    );
    if (!decoded.ok) throw new Error('fixture decode failed');
    return decoded.value;
  }

  it('동결 fixture는 gameVersion 2.2.0·guardian 포함·legacy digest와 일치한다', () => {
    const doc = loadFixture();
    expect(doc.gameVersion).toBe('2.2.0');
    expect(doc.scenario.id).toBe('campaign-azure-2');
    expect(doc.initialStateDigest).toBe('cd9ffc20e7879bb3');
    expect(doc.finalStateDigest).toBe('3b0401e8da1eb195');
    // 시작 배치에 guardian이 있다
    expect(doc.scenario.units?.some((u) => u.type === 'guardian')).toBe(true);
    // legacy(5a7bbac) digest로 초기·최종이 검증된다
    const initial = replayInitialState(doc);
    expect(stateDigestV220(initial)).toBe(doc.initialStateDigest);
    // 현행 digest와는 다르다(guardian movedThisTurn 포함)
    expect(stateDigest(initial)).not.toBe(doc.initialStateDigest);
    const state = replayInitialState(doc);
    for (const command of doc.commands) {
      const r = executeCommand(state, command);
      expect(r.ok).toBe(true);
    }
    expect(stateDigestV220(state)).toBe(doc.finalStateDigest);
    expect(stateDigest(state)).not.toBe(doc.finalStateDigest);
    expect(state.units.some((u) => u.type === 'guardian')).toBe(true);
  });

  it('현행 verifyReplay는 동결 fixture를 거부한다(검증 없이 exact 금지)', () => {
    const doc = loadFixture();
    const v = verifyReplay(doc);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('initial-mismatch');
  });

  it('checkReplayCompatibility는 migratable이고 migration 후 exact 검증이 통과한다', () => {
    const doc = loadFixture();
    const d = checkReplayCompatibility(doc);
    expect(d.compatibility).toBe('migratable');
    expect(d.reasonCode).toBe('migrated');
    expect(d.migrated).toBeDefined();
    const migrated = d.migrated!;
    expect(migrated.gameVersion).toBe(GAME_VERSION);
    expect(verifyReplay(migrated).ok).toBe(true);
    // 마이그레이션 직후 문서는 현행 exact 계열
    expect(checkReplayCompatibility(migrated).compatibility).toBe('exact');
  });

  it('migrateReplayDocumentV220는 손상 digest를 거부한다', () => {
    const doc = loadFixture();
    const bad = { ...doc, finalStateDigest: '0000000000000000' };
    expect(migrateReplayDocumentV220(bad)).toBeNull();
    expect(checkReplayCompatibility(bad).compatibility).toBe('unsupported');
  });

  it('1.5·2.0·2.1 호환 등급은 회귀 없이 보존된다', () => {
    expect(checkReplayCompatibility(docWithVersion('1.5.0')).compatibility).toBe('exact');
    expect(checkReplayCompatibility(docWithVersion('2.0.0', 'three-crowns')).compatibility).toBe(
      'exact',
    );
    expect(checkReplayCompatibility(docWithVersion('2.0.0', 'crown-heart')).compatibility).toBe(
      'playable-unverified',
    );
    expect(checkReplayCompatibility(docWithVersion('2.1.0')).compatibility).toBe('exact');
    expect(checkReplayCompatibility(docWithVersion('2.2.1')).compatibility).toBe('exact');
  });
});

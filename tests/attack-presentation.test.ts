// 한 줄 목적: 쇠뇌대·궁병 원거리 연출 분기와 근접 병종 구분, 규칙 불변을 검증한다
import { describe, expect, it } from 'vitest';
import { UNIT_STATS } from '../src/core/data';
import { UNIT_TYPE_IDS } from '../src/core/units';
import {
  attackAnimKind,
  isRangedAttackAnim,
  projectileStyle,
} from '../src/render/attack-presentation';

describe('attack presentation', () => {
  it('쇠뇌대는 원거리 연출 분기로 들어간다', () => {
    expect(isRangedAttackAnim('crossbow')).toBe(true);
    expect(attackAnimKind('crossbow')).toBe('bolt');
  });

  it('궁병·쇠뇌대와 근접 병종 분기를 구분한다', () => {
    expect(attackAnimKind('archer')).toBe('arrow');
    expect(attackAnimKind('crossbow')).toBe('bolt');
    expect(isRangedAttackAnim('archer')).toBe(true);
    expect(isRangedAttackAnim('crossbow')).toBe(true);

    for (const type of ['infantry', 'guardian', 'raider'] as const) {
      expect(attackAnimKind(type)).toBe('melee');
      expect(isRangedAttackAnim(type)).toBe(false);
    }
    expect(attackAnimKind('cavalry')).toBe('cavalry-charge');
    expect(isRangedAttackAnim('cavalry')).toBe(false);
  });

  it('쇠뇌 볼트는 궁병 화살보다 빠르고 크다', () => {
    const arrow = projectileStyle('arrow');
    const bolt = projectileStyle('bolt');
    expect(bolt.durationMs).toBeLessThan(arrow.durationMs);
    expect(bolt.radius).toBeGreaterThan(arrow.radius);
    expect(bolt.ease).toBe('Linear');
    expect(bolt.impactFlashRadius).toBeGreaterThan(0);
  });

  it('연출 모듈이 게임 규칙·피해량 수치를 바꾸지 않는다', () => {
    // 스냅샷: 연출 판정 호출 전후 UNIT_STATS 불변
    const before = structuredClone(UNIT_STATS);
    for (const type of UNIT_TYPE_IDS) {
      attackAnimKind(type);
      isRangedAttackAnim(type);
    }
    projectileStyle('arrow');
    projectileStyle('bolt');
    expect(UNIT_STATS).toEqual(before);
    expect(UNIT_STATS.crossbow.atk).toBe(before.crossbow.atk);
    expect(UNIT_STATS.crossbow.range).toBe(2);
    expect(UNIT_STATS.archer.range).toBe(2);
  });
});

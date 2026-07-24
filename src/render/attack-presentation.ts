// 한 줄 목적: 병종별 공격 연출 유형(원거리 화살·볼트 / 근접 돌진)을 공용 판정한다
import type { UnitTypeId } from '../core/types';

/** 공격 연출 종류. 게임 규칙·피해량과 무관하다. */
export type AttackAnimKind = 'arrow' | 'bolt' | 'melee' | 'cavalry-charge';

/** 병종 문자열 분기를 연출 코드에 흩뿌리지 않기 위한 정본 판정. */
export function attackAnimKind(type: UnitTypeId): AttackAnimKind {
  if (type === 'archer') return 'arrow';
  if (type === 'crossbow') return 'bolt';
  if (type === 'cavalry') return 'cavalry-charge';
  // infantry, guardian, raider
  return 'melee';
}

export function isRangedAttackAnim(type: UnitTypeId): boolean {
  const kind = attackAnimKind(type);
  return kind === 'arrow' || kind === 'bolt';
}

export interface ProjectileStyle {
  /** 투사체 반지름(px) */
  radius: number;
  /** 채우기 색 */
  color: number;
  /** 비행 시간(ms) — 쇠뇌 볼트는 더 짧다 */
  durationMs: number;
  /** 트윈 ease 이름 */
  ease: string;
  /** 피격 숫자 색 */
  damageTextColor: string;
  /** 피격 플래시 반지름 */
  impactFlashRadius: number;
  /** 피격 플래시 색 */
  impactFlashColor: number;
}

/** 궁병 화살과 쇠뇌대 볼트의 시각 차이를 정의한다. */
export function projectileStyle(kind: 'arrow' | 'bolt'): ProjectileStyle {
  if (kind === 'bolt') {
    return {
      radius: 5,
      color: 0x6b4f1d,
      durationMs: 130,
      ease: 'Linear',
      damageTextColor: '#e8c95a',
      impactFlashRadius: 9,
      impactFlashColor: 0xc9a227,
    };
  }
  return {
    radius: 3.5,
    color: 0xf2ead8,
    durationMs: 220,
    ease: 'Sine.easeIn',
    damageTextColor: '#ffd9d9',
    impactFlashRadius: 0,
    impactFlashColor: 0xf2ead8,
  };
}

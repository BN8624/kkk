// 한 줄 목적: 고유 병종 역할·특성 문구가 특성 수치에서 파생되는지 검증한다
import { afterEach, describe, expect, it } from 'vitest';
// data를 먼저 로드해 units↔data 순환 초기화 순서를 안정화한다
import '../src/core/data';
import type { Unit } from '../src/core/types';
import { unitTrait } from '../src/core/units';
import { setLocale, t } from '../src/i18n';
import {
  traitPanelLines,
  traitProdSummaries,
  unitRoleText,
} from '../src/ui/game/unit-ability-text';

afterEach(() => setLocale('ko'));

function unit(partial: Partial<Unit> & Pick<Unit, 'type' | 'faction'>): Unit {
  return {
    id: 1,
    q: 0,
    r: 0,
    hp: 10,
    moved: false,
    attacked: false,
    ...partial,
  };
}

describe('unit-ability-text', () => {
  it('공용 병종은 역할·요약이 없고 고유 병종만 역할 문구를 가진다', () => {
    expect(unitRoleText('infantry')).toBeNull();
    expect(traitProdSummaries('infantry')).toEqual([]);
    expect(unitRoleText('guardian')).toBe(t('unit.role.guardian'));
    expect(unitRoleText('raider')).toBe(t('unit.role.raider'));
    expect(unitRoleText('crossbow')).toBe(t('unit.role.crossbow'));
  });

  it('수호 태세 문구 수치는 brace 특성에서 읽고 미이동 시 활성 표시', () => {
    const brace = unitTrait('guardian', 'brace')!;
    const idle = unit({ type: 'guardian', faction: 'azure', movedThisTurn: false });
    const moved = unit({ type: 'guardian', faction: 'azure', movedThisTurn: true });

    expect(traitProdSummaries('guardian')).toEqual([
      t('unit.trait.brace.summary', { n: brace.defenseBonus }),
    ]);
    expect(traitPanelLines(idle)).toEqual([
      `${t('unit.trait.brace.name')} — ${t('unit.trait.brace.desc', { n: brace.defenseBonus })}`,
      t('unit.trait.brace.active'),
    ]);
    expect(traitPanelLines(moved)).toEqual([
      `${t('unit.trait.brace.name')} — ${t('unit.trait.brace.desc', { n: brace.defenseBonus })}`,
    ]);
  });

  it('약탈대·쇠뇌대 패널 문구가 특성 수치와 일치한다', () => {
    const mobility = unitTrait('raider', 'terrain-mobility')!;
    const plunder = unitTrait('raider', 'plunder')!;
    const pierce = unitTrait('crossbow', 'armor-piercing')!;

    expect(traitPanelLines(unit({ type: 'raider', faction: 'crimson' }))).toEqual([
      `${t('unit.trait.terrain-mobility.name')} — ${t('unit.trait.terrain-mobility.desc', {
        forest: mobility.forestCost,
        mountain: mobility.mountainCost,
      })}`,
      `${t('unit.trait.plunder.name')} — ${t('unit.trait.plunder.desc', { n: plunder.bonusGold })}`,
    ]);
    expect(traitPanelLines(unit({ type: 'crossbow', faction: 'violet' }))).toEqual([
      `${t('unit.trait.armor-piercing.name')} — ${t('unit.trait.armor-piercing.desc', {
        n: pierce.amount,
      })}`,
    ]);
    expect(traitProdSummaries('raider')).toContain(
      t('unit.trait.plunder.summary', { n: plunder.bonusGold }),
    );
    expect(traitProdSummaries('crossbow')).toEqual([
      t('unit.trait.armor-piercing.summary', { n: pierce.amount }),
    ]);
  });
});

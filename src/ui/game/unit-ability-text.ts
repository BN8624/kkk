// 한 줄 목적: 고유 병종 역할·특성 문구를 특성 데이터와 i18n에서 조합한다
import type { Unit, UnitTrait, UnitTypeId } from '../../core/types';
import { isUniqueUnit, unitTraits } from '../../core/units';
import { t, type MessageKey } from '../../i18n';

/** 고유 병종 역할 한 줄. 공용 병종은 null. */
export function unitRoleText(type: UnitTypeId): string | null {
  if (!isUniqueUnit(type)) return null;
  return t(`unit.role.${type}` as MessageKey);
}

/** 생산 카드용 고유 능력 요약(수치는 특성 데이터에서 파생). */
export function traitProdSummaries(type: UnitTypeId): string[] {
  return unitTraits(type).map(traitSummaryLine);
}

/** 유닛 정보 패널용 능력 설명 줄(이름 — 설명, 수호 태세 활성 포함). */
export function traitPanelLines(unit: Unit): string[] {
  const traits = unitTraits(unit.type);
  if (traits.length === 0) return [];
  const lines: string[] = [];
  for (const trait of traits) {
    lines.push(traitPanelLine(trait));
    if (trait.type === 'brace' && !unit.movedThisTurn) {
      lines.push(t('unit.trait.brace.active'));
    }
  }
  return lines;
}

function traitSummaryLine(trait: UnitTrait): string {
  switch (trait.type) {
    case 'brace':
      return t('unit.trait.brace.summary', { n: trait.defenseBonus });
    case 'terrain-mobility':
      return t('unit.trait.terrain-mobility.summary', {
        forest: trait.forestCost,
        mountain: trait.mountainCost,
      });
    case 'plunder':
      return t('unit.trait.plunder.summary', { n: trait.bonusGold });
    case 'armor-piercing':
      return t('unit.trait.armor-piercing.summary', { n: trait.amount });
  }
}

function traitPanelLine(trait: UnitTrait): string {
  switch (trait.type) {
    case 'brace':
      return `${t('unit.trait.brace.name')} — ${t('unit.trait.brace.desc', { n: trait.defenseBonus })}`;
    case 'terrain-mobility':
      return `${t('unit.trait.terrain-mobility.name')} — ${t('unit.trait.terrain-mobility.desc', {
        forest: trait.forestCost,
        mountain: trait.mountainCost,
      })}`;
    case 'plunder':
      return `${t('unit.trait.plunder.name')} — ${t('unit.trait.plunder.desc', { n: trait.bonusGold })}`;
    case 'armor-piercing':
      return `${t('unit.trait.armor-piercing.name')} — ${t('unit.trait.armor-piercing.desc', {
        n: trait.amount,
      })}`;
  }
}

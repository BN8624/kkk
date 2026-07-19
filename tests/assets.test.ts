// 한 줄 목적: 유닛 토큰 에셋 ID가 공용 전세력·고유 소속만 포함하는지 검증한다
import { describe, expect, it } from 'vitest';
import { allAssetIds } from '../src/render/assets';

describe('allAssetIds 유닛 토큰', () => {
  it('공용 3종은 3세력 전부, 고유 3종은 소속 세력만 생성한다', () => {
    const ids = allAssetIds();
    const unitIds = ids.filter((id) => id.startsWith('unit.'));

    for (const type of ['infantry', 'archer', 'cavalry'] as const) {
      for (const f of ['azure', 'crimson', 'violet'] as const) {
        expect(unitIds).toContain(`unit.${type}.${f}`);
      }
    }

    expect(unitIds).toContain('unit.guardian.azure');
    expect(unitIds).toContain('unit.raider.crimson');
    expect(unitIds).toContain('unit.crossbow.violet');

    expect(unitIds).not.toContain('unit.guardian.crimson');
    expect(unitIds).not.toContain('unit.guardian.violet');
    expect(unitIds).not.toContain('unit.raider.azure');
    expect(unitIds).not.toContain('unit.raider.violet');
    expect(unitIds).not.toContain('unit.crossbow.azure');
    expect(unitIds).not.toContain('unit.crossbow.crimson');

    // 고유 3 + 공용 9 = 12
    expect(unitIds.filter((id) => id.startsWith('unit.')).length).toBe(12);
  });
});

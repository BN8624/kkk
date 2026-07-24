// 한 줄 목적: 외부 보병과 기존 fallback 병종의 표시 크기·체력 막대 위치 계약을 검증한다
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/render/board-view.ts'),
  'utf8',
);

describe('보드 유닛 표시 설정', () => {
  it('보병만 2.5D 스프라이트 크기와 낮은 체력 막대를 사용한다', () => {
    expect(SOURCE).toMatch(
      /UNIT_DISPLAY[\s\S]*?infantry:\s*\{\s*width:\s*56,\s*height:\s*66,\s*hpBarY:\s*33,\s*yOffset:\s*-12,/,
    );
  });

  it('다른 병종은 fallback 규격을 사용하고 갱신마다 표시 설정을 다시 적용한다', () => {
    expect(SOURCE).toMatch(
      /DEFAULT_UNIT_DISPLAY[\s\S]*?width:\s*46,\s*height:\s*51,\s*hpBarY:\s*27,\s*yOffset:\s*UNIT_Y_OFFSET,/,
    );
    expect(SOURCE).toContain('return UNIT_DISPLAY[type] ?? DEFAULT_UNIT_DISPLAY;');
    expect(SOURCE).toContain('view.token.setDisplaySize(display.width, display.height);');
    expect(SOURCE).toContain('view.container.setPosition(x, y + display.yOffset);');
    expect(SOURCE).toContain(
      'this.drawHpBar(view.hpBar, unit.hpRatio, display.hpBarY);',
    );
  });

  it('체력 막대가 없는 에디터 유닛은 계속 그리기를 건너뛴다', () => {
    expect(SOURCE).toMatch(
      /private drawHpBar\([\s\S]*?g\.clear\(\);\s*if \(ratio === null\) return;/,
    );
  });
});

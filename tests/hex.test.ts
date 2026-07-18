// 한 줄 목적: 육각 좌표 계산(이웃·거리·직선·변환)의 정확성을 검증한다
import { describe, expect, it } from 'vitest';
import { hexDistance, hexLine, hexesInRange, neighbors, offsetToAxial } from '../src/core/hex';

describe('hex', () => {
  it('이웃은 항상 6개이며 거리 1이다', () => {
    const c = { q: 2, r: -1 };
    const ns = neighbors(c);
    expect(ns).toHaveLength(6);
    for (const n of ns) expect(hexDistance(c, n)).toBe(1);
    expect(new Set(ns.map((n) => `${n.q},${n.r}`)).size).toBe(6);
  });

  it('거리 계산이 대칭적이고 정확하다', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
    expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: -1 })).toBe(3);
    expect(hexDistance({ q: 3, r: -1 }, { q: 0, r: 0 })).toBe(3);
    expect(hexDistance({ q: -2, r: 1 }, { q: 1, r: 1 })).toBe(3);
  });

  it('직선 경로 양 끝이 시작·끝 좌표이고 연속된 이웃이다', () => {
    const line = hexLine({ q: 0, r: 0 }, { q: 3, r: -2 });
    expect(line[0]).toEqual({ q: 0, r: 0 });
    expect(line[line.length - 1]).toEqual({ q: 3, r: -2 });
    for (let i = 1; i < line.length; i++) {
      expect(hexDistance(line[i - 1], line[i])).toBe(1);
    }
  });

  it('범위 내 육각 개수가 공식과 일치한다', () => {
    expect(hexesInRange({ q: 0, r: 0 }, 0)).toHaveLength(1);
    expect(hexesInRange({ q: 0, r: 0 }, 1)).toHaveLength(7);
    expect(hexesInRange({ q: 0, r: 0 }, 2)).toHaveLength(19);
  });

  it('오프셋-축 좌표 변환이 홀짝 행에서 정확하다', () => {
    expect(offsetToAxial(0, 0)).toEqual({ q: 0, r: 0 });
    expect(offsetToAxial(2, 1)).toEqual({ q: 2, r: 1 });
    expect(offsetToAxial(2, 2)).toEqual({ q: 1, r: 2 });
  });
});

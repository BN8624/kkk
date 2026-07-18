// 한 줄 목적: 지도 생성의 결정론·수도 배치·연결성을 검증한다
import { describe, expect, it } from 'vitest';
import { hexDistance, hexKey } from '../src/core/hex';
import { generateMap } from '../src/core/map';

describe('map generation', () => {
  it('같은 시드는 같은 지도를 생성한다', () => {
    const a = generateMap(12345);
    const b = generateMap(12345);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('다른 시드는 다른 지도를 생성한다', () => {
    const a = generateMap(1);
    const b = generateMap(2);
    expect(JSON.stringify(a.tiles)).not.toBe(JSON.stringify(b.tiles));
  });

  it('수도 3개가 서로 다른 세력 소유로 배치된다', () => {
    const { tiles } = generateMap(777);
    const capitals = tiles.filter((t) => t.building === 'capital');
    expect(capitals).toHaveLength(3);
    expect(new Set(capitals.map((c) => c.owner)).size).toBe(3);
    for (let i = 0; i < capitals.length; i++) {
      for (let j = i + 1; j < capitals.length; j++) {
        expect(hexDistance(capitals[i], capitals[j])).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('중립 마을이 존재하며 땅 위에 있다', () => {
    const { tiles } = generateMap(42);
    const villages = tiles.filter((t) => t.building === 'village');
    expect(villages.length).toBeGreaterThanOrEqual(3);
    for (const v of villages) {
      expect(v.terrain).not.toBe('water');
      expect(v.owner).toBeUndefined();
    }
  });

  it('기준 수도에서 모든 거점까지 지상 경로가 존재한다', () => {
    for (const seed of [1, 7, 42, 999, 20260719]) {
      const { tiles, capitals } = generateMap(seed);
      const land = new Map(
        tiles.filter((t) => t.terrain !== 'water').map((t) => [hexKey(t.q, t.r), t]),
      );
      const visited = new Set<string>();
      const queue = [capitals.azure];
      visited.add(hexKey(capitals.azure.q, capitals.azure.r));
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const d of [
          { q: 1, r: 0 },
          { q: 1, r: -1 },
          { q: 0, r: -1 },
          { q: -1, r: 0 },
          { q: -1, r: 1 },
          { q: 0, r: 1 },
        ]) {
          const nk = hexKey(cur.q + d.q, cur.r + d.r);
          if (visited.has(nk) || !land.has(nk)) continue;
          visited.add(nk);
          queue.push({ q: cur.q + d.q, r: cur.r + d.r });
        }
      }
      for (const t of tiles.filter((t) => t.building)) {
        expect(visited.has(hexKey(t.q, t.r)), `seed ${seed} 거점 ${t.q},${t.r}`).toBe(true);
      }
    }
  });
});

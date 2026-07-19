// 한 줄 목적: 지형 비용·이동력 예산을 반영한 실제 최초 도착 턴 분석기를 검증한다
import { describe, expect, it } from 'vitest';
import { UNIT_STATS } from '../src/core/data';
import { hexKey, offsetToAxial } from '../src/core/hex';
import { generateScenarioMap } from '../src/core/map';
import { analyzeObjectiveArrival, earliestArrival } from '../src/core/scenario/arrival';
import type { TerrainId, Tile } from '../src/core/types';

/** offset(col,row) 격자로 지형 타일 맵을 만든다. 기본은 전부 평원. */
function grid(cols: number, rows: number, overrides: Record<string, TerrainId> = {}) {
  const tiles = new Map<string, Tile>();
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const { q, r } = offsetToAxial(col, row);
      const terrain = overrides[`${col},${row}`] ?? 'plains';
      tiles.set(hexKey(q, r), { q, r, terrain });
    }
  }
  return tiles;
}

describe('earliestArrival — 실제 지형 이동 비용 기반', () => {
  it('평원 직선에서 이동력만큼 한 턴에 나아간다', () => {
    const tiles = grid(8, 1);
    const start = offsetToAxial(0, 0);
    // move 5: 5칸까지 1턴, 6칸은 2턴
    expect(earliestArrival(tiles, start, offsetToAxial(5, 0), 5)!.turns).toBe(1);
    expect(earliestArrival(tiles, start, offsetToAxial(6, 0), 5)!.turns).toBe(2);
  });

  it('단순 거리÷이동력이 아니라 숲 비용을 반영한다', () => {
    // (0,0)-(4,0) 사이 전부 숲(cost 2): move 5면 2칸 진입에 4, 3칸째는 6>5 → 2턴
    const forest: Record<string, TerrainId> = { '1,0': 'forest', '2,0': 'forest', '3,0': 'forest' };
    const tiles = grid(6, 1, forest);
    const start = offsetToAxial(0, 0);
    // 평원이라면 3칸=1턴이지만 숲이라 3칸째는 2턴
    expect(earliestArrival(tiles, start, offsetToAxial(3, 0), 5)!.turns).toBe(2);
    expect(earliestArrival(tiles, start, offsetToAxial(2, 0), 5)!.turns).toBe(1);
  });

  it('기병(이동력 5)이 궁병(이동력 2)보다 빨리 도착한다', () => {
    const tiles = grid(8, 1);
    const start = offsetToAxial(0, 0);
    const target = offsetToAxial(5, 0);
    const cav = earliestArrival(tiles, start, target, UNIT_STATS.cavalry.move)!;
    const arc = earliestArrival(tiles, start, target, UNIT_STATS.archer.move)!;
    expect(cav.turns).toBeLessThan(arc.turns);
  });

  it('한 턴 예산으로도 진입 불가한 지형은 통과하지 못한다(궁병 move 2 < 산 3)', () => {
    // (1,0)이 산이라 유일 통로가 막히면 도달 불가
    const tiles = grid(3, 1, { '1,0': 'mountain' });
    const start = offsetToAxial(0, 0);
    expect(earliestArrival(tiles, start, offsetToAxial(2, 0), UNIT_STATS.archer.move)).toBeNull();
    // 보병(move 3)은 산 진입 가능
    expect(earliestArrival(tiles, start, offsetToAxial(2, 0), UNIT_STATS.infantry.move)).not.toBeNull();
  });

  it('물은 어떤 병과도 통과하지 못한다', () => {
    const tiles = grid(3, 1, { '1,0': 'water' });
    const start = offsetToAxial(0, 0);
    expect(earliestArrival(tiles, start, offsetToAxial(2, 0), UNIT_STATS.cavalry.move)).toBeNull();
  });

  it('경로는 출발지에서 목표까지 연속으로 복원된다', () => {
    const tiles = grid(6, 1);
    const start = offsetToAxial(0, 0);
    const res = earliestArrival(tiles, start, offsetToAxial(4, 0), 5)!;
    expect(res.path[0]).toEqual(start);
    expect(res.path[res.path.length - 1]).toEqual(offsetToAxial(4, 0));
  });
});

describe('analyzeObjectiveArrival — 왕관의 심장 지도', () => {
  it('세력별 최초 도착 턴과 격차를 계산한다', () => {
    const map = generateScenarioMap('crown-heart', 7);
    const rep = analyzeObjectiveArrival(map, map.crown!);
    for (const f of ['azure', 'crimson', 'violet'] as const) {
      expect(Number.isFinite(rep.earliestByFaction[f])).toBe(true);
      expect(rep.earliestByFaction[f]).toBeGreaterThanOrEqual(1);
    }
    expect(rep.maxGap).toBeGreaterThanOrEqual(0);
  });

  it('진홍 기병의 기동 우위가 실제 도착 턴에 드러난다(거리와 무관)', () => {
    // seed 7에서 진홍은 원시 거리상 가장 멀지만 실제로는 최선착 계열이다
    const map = generateScenarioMap('crown-heart', 7);
    const rep = analyzeObjectiveArrival(map, map.crown!);
    const crimson = rep.perFaction.crimson!;
    expect(crimson.unitType).toBe('cavalry');
    expect(crimson.earliestArrivalTurn).toBeLessThanOrEqual(rep.earliestByFaction.azure);
  });
});

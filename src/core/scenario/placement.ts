// 한 줄 목적: 세력별 시작 유닛 배치 정본을 제공해 도착 분석·스냅샷·지도 검증이 동일 규칙을 쓰게 한다
import { FACTION_IDS } from '../data';
import { DOCTRINES } from '../doctrines';
import { hexKey, neighbors } from '../hex';
import type { GeneratedMap } from '../map';
import type { Axial, FactionId, UnitTypeId } from '../types';

/** 시작 유닛 한 기의 배치(세력·병과·타일). 도착 분석과 스냅샷이 공유하는 단일 정본이다. */
export interface StartPlacement {
  faction: FactionId;
  type: UnitTypeId;
  at: Axial;
}

/**
 * 세력별 시작 유닛 배치를 결정한다(수도 인접 지상 타일 순서, 교리 시작 병과 순).
 * 지도 검증·UI·시뮬레이션·도착 분석이 서로 다른 배치를 쓰지 않도록 여기 하나로 모은다.
 */
export function startUnitPlacements(map: GeneratedMap): StartPlacement[] {
  const tileMap = new Map(map.tiles.map((t) => [hexKey(t.q, t.r), t]));
  const out: StartPlacement[] = [];
  const occupied = new Set<string>();
  for (const fid of FACTION_IDS) {
    const cap = map.capitals[fid];
    const spots = neighbors(cap).filter((n) => {
      const t = tileMap.get(hexKey(n.q, n.r));
      return t && t.terrain !== 'water' && !occupied.has(hexKey(n.q, n.r));
    });
    DOCTRINES[fid].startUnits.forEach((type, i) => {
      const spot = spots[i] ?? cap;
      occupied.add(hexKey(spot.q, spot.r));
      out.push({ faction: fid, type, at: spot });
    });
  }
  return out;
}

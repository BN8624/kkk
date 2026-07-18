// 한 줄 목적: 세 왕국의 비대칭 교리(고유 능력·보너스·시작 배치)를 데이터로 정의한다
import type { FactionId, TerrainId, UnitTypeId } from './types';

export interface Doctrine {
  id: FactionId;
  /** 별칭(플레이 스타일 제목) */
  title: string;
  /** 한 줄 플레이 스타일 */
  style: string;
  abilityName: string;
  abilityDesc: string;
  bonusDesc: string;
  startDesc: string;
  recommended: string;
  startGold: number;
  startUnits: [UnitTypeId, UnitTypeId];
  /** 병과별 생산 비용 증감 */
  unitCostDelta: Partial<Record<UnitTypeId, number>>;
  /** 마을 수입 추가량 */
  villageIncomeBonus: number;
  /** 거점 점령 시 즉시 획득하는 금 */
  captureGold: number;
}

/** 교리 공격·방어 보너스 수치(밸런스 시뮬레이션으로 조정) */
export const AZURE_BULWARK_DEF = 1; // 보병: 숲·산·거점에서 방어 +1
export const CRIMSON_CHARGE_ATK = 2; // 기병: 이동 후 공격 시 공격 +2
export const VIOLET_HIGHGROUND_ATK = 2; // 궁병: 숲·산에서 공격 시 공격 +2

export const HIGHGROUND_TERRAINS: TerrainId[] = ['forest', 'mountain'];

export const DOCTRINES: Record<FactionId, Doctrine> = {
  azure: {
    id: 'azure',
    title: '수비와 규율',
    style: '견고한 방어선으로 영토를 지키며 착실히 넓힌다',
    abilityName: '보루',
    abilityDesc: `보병이 숲·산·거점에서 방어 +${AZURE_BULWARK_DEF}`,
    bonusDesc: '보병 생산 비용 -5',
    startDesc: '보병·궁병으로 시작 (금 40)',
    recommended: '처음 플레이에 추천',
    startGold: 40,
    startUnits: ['infantry', 'archer'],
    unitCostDelta: { infantry: -5 },
    villageIncomeBonus: 0,
    captureGold: 0,
  },
  crimson: {
    id: 'crimson',
    title: '기동과 공격',
    style: '빠른 기병 진격으로 거점을 빼앗아 몸집을 불린다',
    abilityName: '돌격',
    abilityDesc: `기병이 이동 후 공격하면 공격 +${CRIMSON_CHARGE_ATK}`,
    bonusDesc: '거점 점령 시 즉시 금 +8',
    startDesc: '기병·보병으로 시작 (금 30)',
    recommended: '공격적인 플레이어에게 추천',
    startGold: 30,
    startUnits: ['cavalry', 'infantry'],
    unitCostDelta: {},
    villageIncomeBonus: 0,
    captureGold: 8,
  },
  violet: {
    id: 'violet',
    title: '사격과 경제',
    style: '원거리 화력과 풍부한 수입으로 후반을 지배한다',
    abilityName: '고지 사격',
    abilityDesc: `궁병이 숲·산에서 공격하면 공격 +${VIOLET_HIGHGROUND_ATK}`,
    bonusDesc: '마을 수입 +5',
    startDesc: '궁병 2기로 시작 (금 45)',
    recommended: '신중한 플레이어에게 추천',
    startGold: 45,
    startUnits: ['archer', 'archer'],
    unitCostDelta: {},
    villageIncomeBonus: 5,
    captureGold: 0,
  },
};

// 한 줄 목적: 캠페인 문서(CampaignDocument v1)와 미션·진행 저장 타입을 정의한다
import type { ScenarioDocumentV1 } from '../scenario/types';
import type { FactionId } from '../types';

/** 캠페인 미션. 시나리오 문서를 직접 포함하며 별점 조건은 문서의 starConditions가 담당한다. */
export interface CampaignMission {
  id: string;
  title: string;
  /** 짧은 도입 문구(긴 대화·컷신 없음) */
  intro: string;
  scenario: ScenarioDocumentV1;
  /** 해금 조건: 선행 미션 id(승리 시 해금). 첫 미션은 null */
  requires: string | null;
  /** 승리 시 표시하는 완료 문구 */
  completionText: string;
}

export interface CampaignDocument {
  schemaVersion: 1;
  id: string;
  faction: FactionId;
  title: string;
  description: string;
  missions: CampaignMission[];
}

/** 미션별 진행 기록(최고 기록은 단조 증가·최단 턴은 승리 기준 최소). */
export interface MissionProgress {
  won: boolean;
  bestStars: number;
  bestScore: number;
  /** 승리한 판 중 최단 턴. 승리 전에는 null */
  bestTurns: number | null;
  /** 종료 시 인간 세력 생존 유닛 최고 수 */
  bestSurvivors: number;
  /** 마지막 플레이 시각(ISO) */
  lastPlayed: string;
  /** 누적 도전 횟수(v1.5 이전 기록에는 없을 수 있음) */
  attempts?: number;
}

export interface CampaignProgressV1 {
  version: 1;
  missions: Record<string, MissionProgress>;
}

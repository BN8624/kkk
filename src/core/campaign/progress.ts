// 한 줄 목적: 캠페인 진행(해금·최고 별·최고 기록)의 저장·갱신·해금 판정을 담당한다
import type {
  CampaignDocument,
  CampaignProgressV1,
  CampaignMission,
  MissionProgress,
} from './types';

export const CAMPAIGN_PROGRESS_KEY = 'three-crowns-campaign';

function emptyProgress(): CampaignProgressV1 {
  return { version: 1, missions: {} };
}

function isMissionProgress(v: unknown): v is MissionProgress {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.won === 'boolean' &&
    typeof o.bestStars === 'number' &&
    typeof o.bestScore === 'number' &&
    (o.bestTurns === null || typeof o.bestTurns === 'number') &&
    typeof o.bestSurvivors === 'number' &&
    typeof o.lastPlayed === 'string'
  );
}

function storage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* 접근 불가 환경 */
  }
  return null;
}

/** 저장소에서 진행을 읽는다. 손상·미래 버전은 빈 진행으로 안전 처리한다. */
export function loadCampaignProgress(): CampaignProgressV1 {
  try {
    const raw = storage()?.getItem(CAMPAIGN_PROGRESS_KEY);
    if (!raw) return emptyProgress();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return emptyProgress();
    const o = parsed as Record<string, unknown>;
    if (o.version !== 1 || typeof o.missions !== 'object' || o.missions === null) {
      return emptyProgress();
    }
    const missions: Record<string, MissionProgress> = {};
    for (const [id, m] of Object.entries(o.missions as Record<string, unknown>)) {
      if (isMissionProgress(m)) missions[id] = m;
    }
    return { version: 1, missions };
  } catch {
    return emptyProgress();
  }
}

export function saveCampaignProgress(progress: CampaignProgressV1): void {
  try {
    storage()?.setItem(CAMPAIGN_PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    /* 저장 공간 부족 등은 무시(진행은 다음 판에서 다시 기록된다) */
  }
}

export interface MissionResult {
  won: boolean;
  stars: number;
  score: number;
  turns: number;
  survivors: number;
  playedAt: string;
}

/** 미션 결과를 반영한 새 진행을 돌려준다(최고 기록 단조 갱신, 최단 턴은 승리 기준). */
/** 현재 캠페인 콘텐츠 규칙 에포크(고유 병종 통합 이후). */
export const CAMPAIGN_CONTENT_EPOCH = '2.2';

export function recordMissionResult(
  progress: CampaignProgressV1,
  missionId: string,
  result: MissionResult,
): CampaignProgressV1 {
  const prev = progress.missions[missionId];
  const next: MissionProgress = {
    won: (prev?.won ?? false) || result.won,
    bestStars: Math.max(prev?.bestStars ?? 0, result.won ? result.stars : 0),
    bestScore: Math.max(prev?.bestScore ?? 0, result.score),
    bestTurns: result.won
      ? Math.min(prev?.bestTurns ?? Number.POSITIVE_INFINITY, result.turns)
      : (prev?.bestTurns ?? null),
    bestSurvivors: Math.max(prev?.bestSurvivors ?? 0, result.survivors),
    lastPlayed: result.playedAt,
    attempts: (prev?.attempts ?? 0) + 1,
    // 새 기록은 2.2 규칙. 기존 최고 기록 필드는 유지(초기화하지 않음)
    contentEpoch: CAMPAIGN_CONTENT_EPOCH,
  };
  if (next.bestTurns === Number.POSITIVE_INFINITY) next.bestTurns = null;
  return { version: 1, missions: { ...progress.missions, [missionId]: next } };
}

/** 2.2 이전 규칙에서 쌓인 기록인지(표시용 legacy 구분). */
export function isLegacyMissionProgress(m: MissionProgress | undefined): boolean {
  if (!m) return false;
  return m.contentEpoch !== CAMPAIGN_CONTENT_EPOCH && (m.won || m.attempts !== undefined);
}

/** 해금 판정: 첫 미션이거나 선행 미션을 승리했으면 열린다. */
export function isMissionUnlocked(
  campaign: CampaignDocument,
  progress: CampaignProgressV1,
  missionId: string,
): boolean {
  const mission = campaign.missions.find((m) => m.id === missionId);
  if (!mission) return false;
  if (mission.requires === null) return true;
  return progress.missions[mission.requires]?.won ?? false;
}

/** 캠페인 안에서 해당 미션 다음의 해금된 미션(다음 미션 버튼용). */
export function nextMission(
  campaign: CampaignDocument,
  missionId: string,
): CampaignMission | null {
  const idx = campaign.missions.findIndex((m) => m.id === missionId);
  if (idx < 0 || idx + 1 >= campaign.missions.length) return null;
  return campaign.missions[idx + 1];
}

/** 캠페인의 완료 미션 수. */
export function completedCount(campaign: CampaignDocument, progress: CampaignProgressV1): number {
  return campaign.missions.filter((m) => progress.missions[m.id]?.won).length;
}

/** 캠페인 전체 별 수(왕국별 또는 전체 합산용). */
export function earnedStars(campaign: CampaignDocument, progress: CampaignProgressV1): number {
  return campaign.missions.reduce((s, m) => s + (progress.missions[m.id]?.bestStars ?? 0), 0);
}

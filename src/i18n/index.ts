// 한 줄 목적: 타입 안전 번역 t()·언어 저장·전환 알림·<html lang> 갱신을 제공한다(서버·외부 서비스 없음)
import { EN } from './en';
import { KO } from './ko';
import type { ModifierId } from '../core/daily';
import type { CompatibilityDecision, ReplayCompatibility } from '../core/replay-compat';
import type { BuiltinScenarioId, FactionId } from '../core/types';
import type { VictoryCondition } from '../core/scenario/types';

export type Locale = 'ko' | 'en';
export type MessageKey = keyof typeof KO;

export const LOCALE_STORAGE_KEY = 'three-crowns-locale';

const DICTS: Record<Locale, Record<MessageKey, string>> = { ko: KO, en: EN };

function storedLocale(): Locale | null {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    return raw === 'ko' || raw === 'en' ? raw : null;
  } catch {
    return null;
  }
}

/** 브라우저 언어 목록에서 최초 언어를 고른다. 한국어 외 언어는 영어 UI로 제공한다. */
export function preferredLocale(languages: readonly string[]): Locale {
  return languages[0]?.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

function systemLocale(): Locale {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'ko';
  const languages = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  return preferredLocale(languages);
}

let current: Locale = typeof localStorage !== 'undefined' ? (storedLocale() ?? systemLocale()) : 'ko';
const listeners = new Set<() => void>();

/** 현재 언어의 메시지를 돌려준다. {name} 자리 표시자를 params로 치환한다. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let s = DICTS[current][key] ?? KO[key];
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

export function getLocale(): Locale {
  return current;
}

/** 언어를 바꾸고 저장·<html lang> 갱신·구독자 알림까지 수행한다. */
export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* 저장 실패해도 이번 세션에는 반영된다 */
  }
  applyDocumentLanguage();
  for (const fn of [...listeners]) fn();
}

/** 언어 변경 구독. 해제 함수를 돌려준다(컨트롤러 dispose에서 호출). */
export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 부팅 시 현재 언어를 <html lang>에 반영한다. */
export function applyDocumentLanguage(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}

// ---------------- 정본 이름 헬퍼(FACTION_NAMES 등 정적 테이블의 언어 인식 대체) ----------------

export function factionName(f: 'azure' | 'crimson' | 'violet'): string {
  return t(`faction.${f}`);
}

export function unitName(u: 'infantry' | 'archer' | 'cavalry'): string {
  return t(`unit.${u}`);
}

export function terrainName(x: 'plains' | 'forest' | 'mountain' | 'water'): string {
  return t(`terrain.${x}`);
}

export function buildingName(b: 'capital' | 'village' | 'crown'): string {
  return t(`building.${b}`);
}

export function victoryConditionText(c: VictoryCondition): string {
  switch (c.type) {
    case 'conquest':
      return t('condition.victory.conquest');
    case 'hold-building':
      return t('condition.victory.holdBuilding', { q: c.at.q, r: c.at.r, turns: c.turns });
    case 'capture-building':
      return t('condition.victory.captureBuilding', { q: c.at.q, r: c.at.r });
    case 'capture-count':
      return t('condition.victory.captureCount', { building: buildingName(c.building), count: c.count });
    case 'eliminate-faction':
      return t('condition.victory.eliminateFaction', { faction: factionName(c.faction) });
    case 'survive-turns':
      return t('condition.victory.surviveTurns', { turns: c.turns });
    case 'reach-score':
      return t('condition.victory.reachScore', { score: c.score });
    case 'unit-alive':
      return t('condition.victory.unitAlive', { tag: c.tag });
    case 'all-of':
      return t('condition.victory.allOf', { count: c.conditions.length });
    case 'any-of':
      return t('condition.victory.anyOf', { count: c.conditions.length });
  }
}

export function difficultyName(d: 'easy' | 'normal' | 'hard'): string {
  return t(`difficulty.${d}`);
}

export function scenarioName(id: BuiltinScenarioId): string {
  return t(`scenario.${id}.name`);
}

export function scenarioDescription(id: BuiltinScenarioId): string {
  return t(`scenario.${id}.description`);
}

export type DoctrineTextField =
  | 'title'
  | 'style'
  | 'abilityName'
  | 'abilityDesc'
  | 'bonusDesc'
  | 'startDesc'
  | 'recommended';

export function doctrineText(faction: FactionId, field: DoctrineTextField): string {
  return t(`doctrine.${faction}.${field}`);
}

export function modifierName(id: ModifierId): string {
  return t(`modifier.${id}.name`);
}

export function modifierDescription(id: ModifierId): string {
  return t(`modifier.${id}.description`);
}

type OfficialScenarioId =
  | 'official-lightning-duel'
  | 'official-grand-continent'
  | 'official-narrow-bridge'
  | 'official-ring-fortress'
  | 'official-golden-road'
  | 'official-kings-escort';

function knownOfficialScenarioId(id: string): OfficialScenarioId | null {
  switch (id) {
    case 'official-lightning-duel':
    case 'official-grand-continent':
    case 'official-narrow-bridge':
    case 'official-ring-fortress':
    case 'official-golden-road':
    case 'official-kings-escort':
      return id;
    default:
      return null;
  }
}

export function officialScenarioText(
  id: string,
  field: 'title' | 'description',
  fallback: string,
): string {
  const official = knownOfficialScenarioId(id);
  return official ? t(`official.${official}.${field}`) : fallback;
}

type CampaignSlug = 'azure' | 'crimson' | 'violet';
export type MissionId =
  | 'azure-1'
  | 'azure-2'
  | 'azure-3'
  | 'crimson-1'
  | 'crimson-2'
  | 'crimson-3'
  | 'violet-1'
  | 'violet-2'
  | 'violet-3';

function campaignSlug(id: string): CampaignSlug | null {
  switch (id) {
    case 'campaign-azure':
      return 'azure';
    case 'campaign-crimson':
      return 'crimson';
    case 'campaign-violet':
      return 'violet';
    default:
      return null;
  }
}

function knownMissionId(id: string): MissionId | null {
  switch (id) {
    case 'azure-1':
    case 'azure-2':
    case 'azure-3':
    case 'crimson-1':
    case 'crimson-2':
    case 'crimson-3':
    case 'violet-1':
    case 'violet-2':
    case 'violet-3':
      return id;
    default:
      return null;
  }
}

export function campaignText(
  id: string,
  field: 'title' | 'description',
  fallback: string,
): string {
  const slug = campaignSlug(id);
  return slug ? t(`campaign.${slug}.${field}`) : fallback;
}

export function missionText(
  id: string,
  field: 'title' | 'description' | 'intro' | 'completion',
  fallback: string,
): string {
  const mission = knownMissionId(id);
  return mission ? t(`mission.${mission}.${field}`) : fallback;
}

/** 내장 캠페인 시나리오만 번역하고 사용자 작성 제목은 그대로 둔다. */
export function campaignScenarioName(id: string, fallback: string): string {
  const mission = id.startsWith('campaign-') ? knownMissionId(id.slice('campaign-'.length)) : null;
  return mission ? t(`mission.${mission}.title`) : fallback;
}

/** 내장·캠페인·공식 콘텐츠만 번역하고 사용자 작성 시나리오 제목은 그대로 둔다. */
export function localizedScenarioName(id: string, fallback: string): string {
  switch (id) {
    case 'three-crowns':
    case 'broken-strait':
    case 'crown-heart':
      return scenarioName(id);
    default:
      break;
  }
  const campaign = id.startsWith('campaign-')
    ? knownMissionId(id.slice('campaign-'.length))
    : null;
  if (campaign) return t(`mission.${campaign}.title`);
  const official = knownOfficialScenarioId(id);
  return official ? t(`official.${official}.title`) : fallback;
}

export function replayCompatibilityLabel(value: ReplayCompatibility): string {
  return t(`replay.compat.${value}`);
}

export function replayCompatibilityReason(decision: CompatibilityDecision): string {
  return t(`replay.reason.${decision.reasonCode}`, { version: decision.gameVersion });
}

/** 현재 언어의 결과 공유 텍스트를 만든다. */
export function resultShareText(opts: {
  scenarioName: string;
  difficultyName: string;
  factionName: string;
  outcome: 'win' | 'lose' | 'draw';
  turns: number;
  score: number;
  captured: number;
  kills: number;
  seed: number;
  daily?: boolean;
  modifierName?: string;
}): string {
  const result =
    opts.outcome === 'win'
      ? t('share.win', { turns: opts.turns })
      : t(opts.outcome === 'draw' ? 'share.draw' : 'share.lose');
  return [
    t('share.heading', {
      scenario: opts.scenarioName,
      difficulty: opts.difficultyName,
      daily: opts.daily ? t('share.dailySuffix') : '',
    }),
    t('share.outcome', { faction: opts.factionName, result }),
    t('share.stats', { score: opts.score, captured: opts.captured, kills: opts.kills }),
    t('share.seed', {
      modifier: opts.modifierName
        ? t('share.modifierPrefix', { modifier: opts.modifierName })
        : '',
      seed: opts.seed,
    }),
    'https://bn8624.github.io/kkk/',
  ].join('\n');
}

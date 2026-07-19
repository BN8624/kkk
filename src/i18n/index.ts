// 한 줄 목적: 타입 안전 번역 t()·언어 저장·전환 알림·<html lang> 갱신을 제공한다(서버·외부 서비스 없음)
import { EN } from './en';
import { KO } from './ko';

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

// 시스템 언어 자동 감지는 전 화면 커버리지가 끝난 뒤에 켠다 — 부분 번역 상태를 기본값으로 내보내지 않는다
let current: Locale = typeof localStorage !== 'undefined' ? (storedLocale() ?? 'ko') : 'ko';
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

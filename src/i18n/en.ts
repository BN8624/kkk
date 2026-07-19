// 한 줄 목적: 영어 사전 — 한국어 사전의 모든 키를 타입 수준에서 강제 구현한다
import type { KO } from './ko';

export const EN: Record<keyof typeof KO, string> = {
  // 공용
  'common.back': 'Back',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.apply': 'Apply',
  'common.ok': 'Got it',

  // 타이틀
  'title.appName': 'Three Crowns Island',
  'title.tagline': 'One island, three crowns.\nBuild the strongest kingdom.',
  'title.continue': 'Continue',
  'title.quickBattle': 'Quick Battle',
  'title.campaign': 'Campaign',
  'title.daily': 'Daily Challenge',
  'title.customScenarios': 'Custom Scenarios',
  'title.editor': 'Scenario Studio',
  'title.replays': 'Replays',
  'title.analysis': 'Play Analysis',
  'title.records': 'Records',

  // 일일 도전·기록 화면
  'daily.title': 'Daily Challenge',
  'records.title': 'Records',
  'records.localOnly': 'Local records stored only in this browser',
};

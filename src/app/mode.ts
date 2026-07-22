// 한 줄 목적: 앱 화면 모드 경계를 정의한다 — 새 화면은 모드를 추가하고 src/ui/<영역> 모듈로 만든다
export type AppMode =
  | 'title' // 타이틀
  | 'setup' // 빠른 전투 설정
  | 'play' // 일반 플레이(빠른 전투·일일 도전·캠페인·테스트 플레이 공용)
  | 'strategic' // 전략 레이어 V0 (12지역·10턴 캠페인)
  | 'daily' // 일일 도전 안내
  | 'campaign' // 캠페인 선택
  | 'scenarios' // 커스텀 시나리오 보관함
  | 'editor' // 시나리오 제작실
  | 'replays' // 리플레이 보관함
  | 'replay' // 리플레이 재생
  | 'analysis' // 플레이 분석(기록실)
  | 'records' // 기록
  | 'settings'; // 설정(일시정지 포함)

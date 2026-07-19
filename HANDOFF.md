# HANDOFF — 현재 스냅샷

- 기준 커밋: `3e35819` (main, origin/main 동기화, 작업 트리 클린)
- 활성 Issue: #5 "세 왕관의 섬 Phase 4 — Product Hardening · Human Playtest Lab · Public Release 2.0"

## Phase 4 진행 상황 (Issue #5 33절 작업 순서 기준)

| 단계 | 내용 | 상태 | 커밋 |
|---|---|---|---|
| 1 | AppShell·컨트롤러 분리, 비동기 취소 | 완료 | `3398eae` |
| 2 | Decode Pipeline·정밀 검증·fuzz | 완료 | `eba8df7` |
| 3 | 리플레이 게임 버전 호환 정책 | 완료 | `013c21f` |
| 4 | Human Playtest Lab(분석 지표·UI·보고서) | 완료 | `474b8c3` |
| 5 | 관측 메타데이터 v2 · 평가 정책 5종 · 품질 매트릭스 · 별점 조정 | 완료 | `55c00cd` `bd3afd0` `451f2d6` |
| 6 | 시나리오 품질 보고서 · AI 품질 시험 · 공식 팩 6종 | 완료 | `949442e` `3e35819` |
| 7 | 한국어·영어 i18n · 접근성 | **미착수 — 다음 작업** | |
| 8 | PWA·오프라인·백업/복구 | 미착수 | |
| 9 | CI 보안·릴리스 자동화·2.0.0 | 미착수 | |

## 새로 생긴 주요 모듈

- [src/core/eval/policies.ts](src/core/eval/policies.ts) — 테스트 전용 평가 정책 5종(runEvalPolicyTurn)
- [src/core/eval/quality-trial.ts](src/core/eval/quality-trial.ts) — 자동 관전 러너(비차단·취소 가능)
- [src/core/scenario/quality.ts](src/core/scenario/quality.ts) — 품질 보고서(scenarioQualityReport)
- [src/core/scenario/official.ts](src/core/scenario/official.ts) — 공식 시나리오 6종(OFFICIAL_SCENARIOS)
- [src/replay/observation.ts](src/replay/observation.ts) — ObservationTracker(리플레이 v2 관측)
- scripts: `simulate:matrix`(캠페인 품질 매트릭스), `simulate:official`(공식 팩 게이트)
- 리플레이 스키마 v2(REPLAY_SCHEMA_VERSION=2), v1→v2 마이그레이션(migrateReplayV1·upgradeStoredReplay)

## 검증 상태 (2026-07-19, 3e35819 기준)

lint·typecheck·vitest 260개·dev E2E 33개·dist E2E 23개·determinism 593게임·simulate:campaign 972게임·simulate:matrix 324게임·simulate:official 48게임 — 전부 PASS.

## 다음 세션 첫 작업 (7단계, Issue #5 22–23절)

1. i18n 기반: 타입 안전 `t()` + ko/en 사전 + 시스템 언어 기본값 + 설정 전환 + `<html lang>` 갱신
2. 전 화면 문자열 이동(타이틀→게임→캠페인→제작실→리플레이→분석→오류 메시지 순), 누락 키 0 테스트
3. 언어 전환 UI는 커버리지 완성 후에 노출(부분 번역 상태를 공개판에 내보내지 않는다)
4. 접근성: aria-label·포커스·모달 트랩·reduced motion (23절)

## 알려진 부채(미착수)

- 번들 1.78MB 단일 청크 — vite 경고만, 30절 성능 단계에서 지연 로드 검토

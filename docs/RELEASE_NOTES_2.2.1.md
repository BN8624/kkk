# 세 왕관의 섬 2.2.1 릴리스 노트

Phase 6 외부 검토 후속 수리 패치. 정본성·구조적 자동 승리·CI action 버전만 고친다.

## 수정 요약

### GitHub Actions action 버전 수리

- `actions/checkout@v7` → `actions/checkout@v6`
- `actions/setup-node@v7` → `actions/setup-node@v6`
- `upload-artifact`·`download-artifact`·`upload-pages-artifact`·`deploy-pages`는 공개 메이저 태그 존재 여부를 확인한 뒤 유지했다.

### guardian 정본 digest 수리

- 수호대(`guardian`)의 `movedThisTurn`을 정본 상태 digest에 반영한다.
- 수호 태세(brace) 활성/비활성은 피해 계산과 리플레이 exact 검증에 모두 영향을 준다.
- **공용 병종에는 `movedThisTurn`을 넣지 않는다.** 1.5·2.0·2.1 공용 병종 리플레이 digest 형식을 보존한다.

### crimson-1 첫 라운드 승리 제거

- 캠페인 `crimson-1`(첫 번째 돌격) 정체성은 유지한다(기병 입문·마을 2곳·제한 턴 8·공용 병종).
- 목표 마을 거리·시작 위치·수비 배치를 조정해 **첫 라운드 승리 0**, 평균 종료 턴 > 1을 확보한다.
- 캠페인 시뮬 게이트에 `firstRoundWins`·`winsBeforeTurn2`를 추가하고, 기본 미션에서 첫 라운드 승리를 오류로 처리한다.
- artifact에 미션별 첫 라운드 승리 횟수를 기록한다.

## 기존 리플레이 호환 범위

| 버전·시나리오 | 호환 |
| --- | --- |
| 1.5.x 비-crown | exact (공용 digest 형식 유지) |
| 2.0.x three-crowns / broken-strait | exact |
| 2.0.x crown-heart | playable-unverified (기존 정책) |
| 2.1.x | exact (공용 digest 형식 유지) |
| 2.2.x (고유 병종·guardian brace 상태 포함) | exact |

저장 형식 버전 4 유지. 기존 공용 병종 저장·이어하기 정상.

## Phase 7로 남긴 항목

이번 패치에서 자원 후국 궁병·쇠뇌대 수치를 임의 조정하지 않았다. 다음 항목은 Phase 7 범위다.

- 자원 AI의 궁병 생산량이 쇠뇌대보다 지나치게 낮음
- 궁병과 쇠뇌대의 생산 역할 중복 가능성
- 쇠뇌대 비용·AI 생산 가중치 검토 필요
- 승률 33% 수렴·정밀 밸런스 재조정

## 검증 첨부(자동)

- 캠페인 시뮬: `artifacts/campaign-sim-summary.md` (`firstRoundWins` 포함)
- 결정론·유닛·공식 전장 산출물(`artifacts/`)

## 설치와 오프라인

PWA 셸 캐시는 `three-crowns-shell-v2.2.1`로 갱신된다. 업데이트는 게임 도중 강제 적용되지 않으며 타이틀에서 사용자가 선택한다.

## 업로드 절차

1. `npm ci && npm run build && npm run release:assets`를 실행한다.
2. `release/SHA256SUMS.txt`로 파일 무결성을 확인한다.
3. `release/three-crowns-island-2.2.1-itch.zip`을 itch.io HTML 게임으로 업로드한다.
4. 나머지 `release/` 파일을 GitHub Release 2.2.1 자산으로 첨부한다.
5. Actions의 모든 필수 작업과 Pages 배포 성공을 확인한다.

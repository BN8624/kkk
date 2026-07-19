# 세 왕관의 섬 2.2.0 릴리스 노트

## 2.2 핵심 변경

- **최종 6병종 전투 체계**: 공용 보병·궁병·기병에 왕국 고유 병종 3개를 더한다.
  - 🔵 청람 **수호대(guardian)** — 이동하지 않으면 방어 +2(수호 태세). 거점 방어 전선.
  - 🔴 진홍 **약탈대(raider)** — 숲 1·산 2 이동, 거점 점령 시 금 +5(교리 보너스와 중첩).
  - 🟣 자원 **쇠뇌대(crossbow)** — 대상 기본 방어 최대 2 관통(지형·건물·교리 방어는 관통하지 않음).
- 병종 정의는 `src/core/units.ts` 중앙 레지스트리. 이동·전투·점령·생산·AI·UI가 같은 정본 함수를 공유한다.
- **AI**가 고유 병종을 역할에 맞게 생산·운용한다(미사용·과사용 게이트 포함).
- **캠페인** 9미션 유지. 왕국별 미션2에서 고유 병종 1기 소개, 미션3에서 생산·활용. 기존 해금·별 이력 보존(2.2 이전 기록은 legacy 표시).
- **공식 전장** 6개 유지, 최소 3개에서 고유 병종 시연.
- **제작실** 팔레트 6병종, 세력·로스터 잠금, `uniqueUnits` 규칙 토글. 기존 ScenarioDocument v1은 스키마 버전 유지(선택 필드).
- **플레이 분석**에 6병종 생산 비율·수호 태세·약탈 금·관통 지표 포함.
- 시뮬레이션: `npm run simulate:units`, `npm run audit:rosters` 및 CI Unit System job.

## 호환성

- **저장**: 형식 버전 4 유지. 기존 공용 병종 게임은 정상 이어하기. `uniqueUnits` 없는 문서·저장은 공용 3병종만(조용한 규칙 변경 없음).
- **리플레이**
  - 1.5.x · 2.0.x 비-crown · 2.1.x: 기존 exact 정책 유지.
  - 2.2.x 고유 병종 리플레이: **exact**.
- **시나리오 문서**: schemaVersion 1. `rules.uniqueUnits` 선택 필드. 없으면 공용만.
- **캠페인 진행**: 미션 id 유지. 기존 won/별/완료 삭제 없음. 새 기록에 `contentEpoch: "2.2"`.

## 검증 첨부(자동)

- 병종 역할 매트릭스: `artifacts/unit-role-matrix.md`
- 고유 병종 사용률 시뮬: `artifacts/unique-unit-simulation.md`
- 기존 결정론·캠페인·공식 전장·crown 시뮬 산출물(`artifacts/`)

아래는 인간 플레이 재미 증명이 아니라 **자동 대체 정책·구조 검증** 결과다.

## 설치와 오프라인

지원 브라우저에서 공개 Pages 주소를 연 뒤 홈 화면 추가 또는 앱 설치를 선택한다. PWA 셸 캐시는 `three-crowns-shell-v2.2`로 갱신된다. 업데이트는 게임 도중 강제 적용되지 않으며 타이틀에서 사용자가 선택한다.

## 알려진 한계 · Phase 7로 남긴 항목

- 승률 33% 수렴·정밀 밸런스 재조정은 Phase 7 범위다. 이번 릴리스는 명백한 압도·무용·자동승리만 막는다.
- 데이터와 분석은 브라우저 로컬에만 저장된다.
- 물리 iPhone Safari 실기기 검증은 이 노트가 완료를 주장하지 않는다(`docs/IPHONE_CHECKLIST.md`).
- 외부 ChatGPT 독립 검토는 이슈 종료 후 별도 수행.

## 업로드 절차

1. `npm ci && npm run build && npm run release:assets`를 실행한다.
2. `release/SHA256SUMS.txt`로 파일 무결성을 확인한다.
3. `release/three-crowns-island-2.2.0-itch.zip`을 itch.io HTML 게임으로 업로드한다.
4. 나머지 `release/` 파일을 GitHub Release 2.2.0 자산으로 첨부한다.
5. Actions의 모든 필수 작업과 Pages 배포 성공을 확인한다.

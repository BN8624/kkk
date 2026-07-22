# Strategic Layer V0 (Phase 8-0 · 8-1 · 8-2)

## Phase 순서 변경

기존 계획의 Phase 8(라운드·물류 마감)을 아래로 미룬다.

| Phase | 내용 |
| --- | --- |
| **Phase 8-0** | Strategic Layer V0 — 전략 상태·명령·전술 전투 브리지 순수 모델 |
| **Phase 8-1** | 12지역 전략 지도·10턴 캠페인·전술 전투 수직 연결(플레이 가능 슬라이스) |
| **Phase 8-2** | 카드형 프로토타입 제거 → SVG 섬 영토 전략 지도 화면 교체 |
| **Phase 9** | 병종 식별·물류·시각·사운드·정식판 마감 |

이슈 #10 완료 시점의 전술 밸런스를 안정 동결 기준으로 사용한다. 프레임 연결에 막는 치명적인 경험 버그가 아닌 한, 전술 공격·방어·HP·비용·교리·타일 프로파일은 변경하지 않는다.

Strategic Layer V0는 현재 `kkk` 저장소의 실험 모드로 구현한다. 별도 정식 저장소 생성과 기존 저장소 동결은 V0 이후 검증 단계에서 결정한다.

## Phase 8 / Phase 9 경계

**Phase 8-0에 포함**

- 12지역 전략 상태 모델
- 군단·명령·충돌 시 전술 전투 context
- ScenarioDocumentV1 생성·검증
- 전술 결과 보고서 → 전략 상태 반영
- 전략 저장·복원·digest
- 순수 함수 계약과 단위 테스트

**Phase 8-1에 포함**

- 타이틀에서 전략 모드 시작·이어하기
- DOM 12지역 지도·HUD·군단 패널
- 인간 이동·대기·보충
- 전략 턴 엔진(세력 순서·수입·승패)
- 결정론 전략 AI
- AI 대 AI 자동 해결(V0 단순 시뮬)
- 인간 참여 전술 전투 진입·결과 반영
- 전술 전투 중 임시 저장·복원
- progress 백업에 전략 저장 키 포함

**Phase 8-2에 포함 (표시·입력 계층만)**

- 4×3 카드 그리드 완전 제거 (fallback 유지 금지)
- SVG 기반 하나의 섬 + 불규칙 12영토 geometry 정본
- 세력 소유 색·문양, 수도·도시·요새·지형 아이콘, 군단 토큰
- 선택 기반 하단 패널, 압축 상단 HUD
- 인접 이동 경로 미리보기·군단 이동 애니메이션(300–700ms, prefers-reduced-motion 대응)
- 점령 플래시·전투 충돌 강조 (규칙/AI/schema 불변)
- 모바일 세로 가로 스크롤 없음, 접근 가능한 포커스·ARIA

**Phase 9로 미룬 항목**

- 병종 식별 폴리시 확장
- 공개 이미지·GIF·사운드 마감
- 전술 밸런스 추가 조정
- 고도화된 자동전투
- 군단 합병·분할·지휘관·경험 등

## Phase 8-1 사용자 흐름

1. 타이틀 → 전략 전쟁 시작 → 왕국 선택
2. 12지역 지도에서 영토·군단 확인
3. 군단 선택 → 이동·대기·보충
4. 전략 턴 종료 → AI 두 세력 행동
5. AI 대 AI 충돌은 자동 해결(전술 화면 없음)
6. 인간 참여 충돌은 기존 육각 전술 전투
7. 전술 결과(생존·손실·HP·점령)가 지도에 반영
8. 세 수도 점령 또는 10턴 점수 승패
9. 전략 저장·전투 임시 저장·이어하기

## Phase 8-2 섬 영토 지도 렌더러

### 모듈

```
src/ui/strategic/
  map-geometry.ts   # 12영토 path·앵커 정본 (viewBox 0 0 400 320)
  map-icons.ts      # 세력 패턴·정착지·지형 SVG 아이콘
  map-view.ts       # 섬 SVG 조립·바인딩
  map-panel.ts      # 하단 선택 패널
  map-animation.ts  # 이동 경로·애니메이션·플래시
  styles.ts         # HUD/지도/패널 레이아웃
  index.ts / screens.ts
```

### geometry 정본

- 지역 ID·이웃 그래프는 `src/strategic/map.ts` 불변.
- 각 지역은 고정 `path` + `labelAnchor` + `structureAnchor` + `armyAnchors` + `edgeMidpoints`.
- `edgeMidpoints` 키 집합은 정본 이웃과 1:1 일치해야 한다(단위 테스트).
- 랜덤 지도 생성 없음.

### 렌더 계약

| 항상 표시 | 선택 시에만 (하단 패널) |
| --- | --- |
| 영토 채움·해안·지형 오버레이 | 지역 전체 이름·수입·방어 상세 |
| 수도/도시/요새 아이콘 | 병종 HP 목록 |
| 군단 토큰(세력 문양·병력 수·손상 HP바·행동완료) | 대기/보충 명령 |
| 선택/이동 가능 강조 | |

### 조작

1. 바다 탭 / 닫기 → 선택 해제
2. 영토 탭 → 영토 강조 + 지역 패널 (군단 선택 해제)
3. 군단 토큰 탭 → 군단 선택 + 인접 이동 가능 영토 강조 + 명령 패널
4. 이동 가능 영토 탭 → 확인 → 경로 애니메이션 → 정본 `move-army` 적용 → 점령/전투 처리

### 레이아웃

- 상단 HUD 약 12–18%, 지도 58–70%+, 하단 패널 가변
- 모바일 세로: 가로 스크롤 없음, safe-area 반영
- 가로/PC: 지도 중심, 패널 우측 가능

### 시각 회귀 스크린샷

Playwright가 `artifacts/strategic-map/` 에 저장:

- `mobile-first.png`, `army-selected.png`, `move-highlight.png`, `move-done.png`, `pc-map.png`

## 전략 턴 순서

- 각 턴은 인간 세력부터 시작
- 이후 AI 두 세력은 `FACTION_IDS`를 인간 기준으로 회전한 순서
- 세력 페이즈 종료 시 미행동 군단은 자동 대기
- 세 세력 종료 후: 승패 확인 → turn++ → moved 리셋 → 수입 1회 → 인간 페이즈

## 수입

- 라운드 종료 시 각 세력 소유 지역 `income` 합계를 국고에 지급
- 같은 턴에 두 번 지급되지 않음(저장 복원으로 중복 획득 불가)

## 보충

- 명령 `{ type: 'replenish-army', armyId }`
- 자기 세력 정착지(수도·도시·요새), 미행동, 국고 10, 손상 유닛 필요
- 생존 유닛 HP +1(최대 HP 이하), 사망 유닛·신규 유닛 없음, moved=true

## 전략 AI

- `src/strategic/ai.ts` — 동일 상태 → 동일 명령
- 손상 시 보충 검토 → 인접 후보 점수 → 최고 점수 이동 → 없으면 대기
- 인간 세력 여부로 공격 가산하지 않음, `Math.random` 금지

## 자동전투 한계

- AI 대 AI만 `autoResolveStrategicBattle`
- 병력 전력·결정론 라운드 교환·지역 defense 약반영
- 전술 엔진과 동일하다고 주장하지 않음
- report는 반드시 `validateTacticalBattleReport` 통과 후 `applyTacticalBattleReport`

## 인간 전술 전투 저장

| 키 | 용도 |
| --- | --- |
| `three-crowns-strategy-save` | 전략 캠페인 상태 |
| `three-crowns-strategy-battle-save` | 전술 전투 중 임시 저장 |
| `three-crowns-save` | 일반 전술(빠른 전투 등) — 전략과 분리 |

임시 저장: `{ schemaVersion: 1, battleId, strategicDigest, state }`.  
reload 시 battleId·digest·pendingBattle 일치 필수. 불일치 시 전투 저장만 폐기.

## 승리 조건

- 즉시: 한 세력이 세 수도 모두 소유
- 10턴 종료: 지역 10 + 수도 20 + 유닛 2 + HP/5 — 동점 draw
- 국고는 점수에 포함하지 않음

## Phase 8-2 이후

- 전략 지도 제작실
- 고도화 자동전투
- 시각·사운드 마감(Phase 9)
- 정식 버전 릴리스·별도 저장소 이전 검토

## V0 목표 (8-0 계약)

1. 12지역 프레임 식별·정본 상태
2. 군단과 군단 소속 병력의 지휘 상태
3. 프레임 명령과 전투 대기 상태에 대한 계약
4. 군단 충돌 → 현재 ScenarioDocumentV1 전술 전투 변환 계약
5. 전술 전투 결과를 프레임 상태에 다시 적용하는 계약
6. 프레임 상태 저장·복원·digest
7. 동일 시드에서 항상 같은 결과가 나오는 결정론

## 모듈 경계

```
src/strategic/
  types.ts
  map.ts
  state.ts
  orders.ts
  battle-bridge.ts
  save.ts
  digest.ts
  validate.ts
  turn.ts
  ai.ts
  auto-resolve.ts
  battle-session-save.ts
src/controllers/strategic-controller.ts
src/ui/strategic/
```

규칙:

- `src/core/`는 기존 전술 엔진 정본으로 유지한다.
- 전략 모듈은 공개 전술 타입과 ScenarioDocument 계약만 사용한다.
- 전략 코드가 전술 GameState 내부를 임의로 수정하지 않는다.
- 전술 코드가 전략 상태를 직접 소유하지 않는다.
- 전략 ↔ 전술 연결은 명시적 request/context/report 객체로만 수행한다.
- 범용 npm 패키지·공용 엔진 추상화를 만들지 않는다.

## 12지역 초기 범위

- 지역 정확히 12개, 단일 연결 그래프, 이웃 양방향, 자기 루프·중복 이웃 없음
- 세 왕국 수도 각 1, 초기 소유 지역 각 3, 중립 3
- 시작 군단 세력당 2(총 6), 기존 6병종만 사용, 군단당 유닛 4~6
- 동일 `seed` + `humanFaction` → 동일 상태
- 병력·군단·지역 ID는 안정적이며 중복하지 않음
- V0 지도는 연결 망으로 충분하며 처음부터 완벽한 서사 지도를 만들지 않는다

격자 배치:

```
r00 r01 r02 r03
r04 r05 r06 r07
r08 r09 r10 r11
```

- azure: r00(수도), r01, r04
- crimson: r03(수도), r07, r11
- violet: r08(수도), r09, r10
- 중립: r02, r05, r06

## 전략 상태 구조

`StrategicGameState` schemaVersion **1**.

- phase: `orders` | `battle` | `resolution` | `ended`
- regions / armies / treasury
- optional `pendingBattle`, `winner`

V0 제외: 보급 단계, 안개, 지휘관, 경험·승급, 부유 턴, 계절, 사건, 외교, 해상 이동, 기술, 도시 건설.

미래 확장용 빈 필드·추상 계층을 미리 만들지 않는다.

## 전략 명령 (V0)

```ts
type StrategicOrder =
  | { type: 'move-army'; armyId: string; toRegionId: string }
  | { type: 'hold-army'; armyId: string };
```

- 군단은 한 전략 턴에 최대 한 번 이동
- 인접 지역만, 자기 세력 군단만 명령
- 존재하지 않는 지역·군단 거절, 빈 군단 거절, 중복 명령 거절
- 아군 지역 이동은 전투 없이 가능
- 빈 중립·적 지역 진입은 즉시 점령
- 적 군단이 있는 지역 진입은 `pendingBattle` 생성
- 전투 대기 중이면 다른 전략 해결을 진행하지 않음
- 모든 함수는 입력 상태를 직접 변이하지 않는 순수 함수 또는 명시적 immutable update

전체 전략 턴 해결과 AI는 다음 이슈 범위다.

## 전술 battle request / report 뼈대

### StrategicBattleContext

- `battleId`·`battleSeed` 결정론적
- 전략 유닛 ↔ 전술 `tag` 1:1, 시작 HP 보존
- 존재하지 않는 군단·유닛·지역 참조 시 fail-closed
- 같은 전략 유닛 두 번 매핑 거절
- context는 해당 전투가 끝날 때까지 변경하지 않음

### 전투 준비 분류 (`prepareStrategicBattle`)

인간 참여 전투만 전술 UI 대상이다. AI 대 AI는 `auto-resolve-required`로 명시 분류한다.

```ts
type StrategicBattlePreparation =
  | { kind: 'human-tactical'; context: StrategicBattleContext; scenario: ScenarioDocumentV1 }
  | { kind: 'auto-resolve-required'; context: StrategicBattleContext };
```

- 공격군 또는 방어군이 `state.humanFaction`일 때만 `human-tactical` + ScenarioDocument 생성
- 인간 미참여(AI 대 AI) → `auto-resolve-required` (시나리오 없음)
- auto-resolve 시뮬레이터는 Phase 8-1 이후 별도 구현
- AI 세력을 임시 human controller로 바꾸지 않음
- `buildTacticalScenario`를 AI 대 AI context에 직접 호출하면 `human-not-participant`로 실패

### ScenarioDocument 생성

`buildTacticalScenario(context, strategicState)`

- 충돌 세력만 active, 세 번째 세력 inactive
- **인간 세력 군단이 참여한 전투만** 문서 생성(AI 대 AI 거절)
- 인간 세력만 `controller=human`, 상대는 `ai`, 비참여 세력 `active=false`
- fixed 8×8 보드, 지역 terrain에 따라 평원·숲·산 비중
- doctrines·uniqueUnits 활성, 전투 제한 턴 10
- 생산 가능 거점 미배치(신규 전술 유닛 미생성 구조)
- 승리: 상대 섬멸 / 제한 턴 종료 시 기존 점수 규칙으로 승자 또는 무승부
- 동일 context → 동일 시나리오 digest

### TacticalBattleReport

`buildTacticalBattleReport(context, finishedGameState)`

- 미종료 전투 거절
- 전술 전투의 **모든** 살아 있는 유닛에 strategic binding tag 필수(무태그·신규 생산 유닛 거절)
- context의 모든 전략 유닛이 survivor 또는 loss에 정확히 한 곳
- 알 수 없는 tag·중복 tag·병종/세력 mismatch·HP 범위 위반 거절
- survivor HP는 1 이상·병종 최대 HP 이하·**startingHp 이하**(전투 중 회복 계약 없음)
- 전술 승자와 보고서 승자 일치, draw 정상 상태

### 보고서 검증 (`validateTacticalBattleReport`)

`TacticalBattleReport`는 비신뢰 입력이다. `applyTacticalBattleReport`는 상태 변경 전에 반드시 이 validator를 통과해야 한다.

- schemaVersion·battleId·winner·turns·scoreByFaction 구조 검사
- survivor/loss가 context binding과 완전 분할(누락·중복·양쪽 동시 존재 거절)
- 각 항목의 `strategicUnitId`·`armyId`·`faction`·`type`이 context binding과 필수 일치
- `retreatingArmyIds`는 맵·생존 결과에서 계산한 예상 집합과 정확 일치(위치 결정 권한 없음)

### 전략 반영

`applyTacticalBattleReport(state, report)`

- validator 통과 후에만 반영
- 전략 유닛 병종·세력·군단 소속은 **context가 정본** — 보고서 type으로 덮어쓰지 않음
- 실제로 반영하는 전술 결과는 survivor HP·loss 제거·군단 이동뿐
- loss 제거, survivor HP 반영, 빈 군단 제거
- 공격 승리: 공격군 전투 지역 이동·점령, 방어 생존은 결정론적 인접 우호 지역 퇴각(없으면 해산)
- 방어 승리·draw: 방어 유지, 공격 생존은 원래 지역 복귀
- pendingBattle 제거, 동일 report 재적용·다른 battleId 거절

### pendingBattle 상태 정합·이상 저장 거절

`validateStrategicState`는 pendingBattle이 현재 전략 턴·세력·군단 위치·인접성·바인딩·battleId/battleSeed와 완전 일치하는지 검사한다.

- `deriveBattleIdentity(state, request)`가 battleId·battleSeed 단일 정본
- 저장된 battleId/battleSeed가 재계산 값과 다르면 실패
- 전투 지역에 지정 방어군 외 제3 군단 있으면 실패
- `deserializeStrategic`은 강화된 검증 실패 시 **null**(이상 pending battle 복원 거절)

## 전략 저장

- 키: `three-crowns-strategy-save`
- schemaVersion 1, 기존 `three-crowns-save`와 별도
- 기존 전술 `SAVE_VERSION=4` 의미 불변
- 전략 저장이 없거나 손상되어도 기존 전술 저장 정상
- 구조 검증 후에만 복원, 왕복 후 digest 동일
- 로컬스토리지 없는 테스트 환경에서는 순수 serialize/deserialize로 검증

## 이번 이슈에 없는 기능

- 라운드 전체 해결·AI
- 공격·반격·병참 산출
- 병종 스프라이트·전장 개발
- 공개 이미지·GIF
- 전술 밸런스 추가 조정
- 전략 지도 UI / 전술 화면 전환 연동
- 버전 범프·PWA 캐시·릴리스 에셋 이름 변경

## 다음 Phase 8-1 범위

- 전략 지휘 UI(지도·군단·명령 입력)
- 인간 참여 전투 시 전술 화면 전환
- AI 군단 전투 auto-resolve 연동
- 전략 턴 해결과 간단한 종료 조건 표시

## 검증 요약

신규 Vitest로 그래프·명령·context·시나리오 검증·report·apply·저장·digest·기존 전술 저장/리플레이 회귀를 덮는다. 공개 화면 변화 없음(전략 메뉴 미노출)이 정상이다.

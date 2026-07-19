# 세 왕관의 섬 (Three Crowns Island)

하나의 섬을 두고 세 왕국이 겨루는 모바일 우선 육각 턴제 전략게임. 왕국을 골라 12턴 안에 적의 수도를 점령하거나, 가장 높은 지배 점수로 승리한다.

<p align="center"><img src="docs/screenshot-mobile.png" alt="세 왕관의 섬 플레이 화면" width="360"></p>

## ▶ Play Now

**https://bn8624.github.io/kkk/**

아이폰 Safari와 PC 브라우저에서 설치 없이 바로 플레이. 브라우저를 닫아도 자동 저장되어 이어할 수 있다.

## 세 왕국

| 왕국 | 플레이 스타일 | 고유 능력 | 보너스 · 시작 |
| --- | --- | --- | --- |
| 🔵 청람 왕국 | 수비와 규율 | **보루** — 보병이 숲·산·거점에서 방어 +1 | 보병 생산 -2 · 보병+궁병, 금 40 |
| 🔴 진홍 공국 | 기동과 공격 | **돌격** — 기병이 이동 후 공격하면 공격 +2 | 점령 시 즉시 금 +8 · 기병+보병, 금 40 |
| 🟣 자원 후국 | 사격과 경제 | **장궁** — 궁병의 사거리 +1 | 마을 수입 +8 · 궁병 2기, 금 60 |

## 세 시나리오

- **세 왕관 전쟁** — 표준 전장. 적 수도를 모두 점령하거나 12턴 뒤 최고 점수로 승리
- **갈라진 해협** — 해협이 섬을 가른다. 좁은 육교의 병목을 장악하라
- **왕관의 심장** — 중앙 왕관 요새를 4턴 연속 보유하면 즉시 승리

모든 지도는 시드 기반으로 생성되고 자동 검증(연결성·공정성)을 거친다. 같은 시드는 항상 같은 전장이다.

## 게임 모드

- **빠른 전투** — 왕국·시나리오·난이도·시드를 골라 즉시 시작
- **일일 도전** — 날짜 기반 결정론적 시드. 오늘은 모두가 같은 전장, 같은 왕국, 같은 수정자. 최고 점수는 로컬에 기록되고 결과를 공유할 수 있다
- **이어하기** — 자동 저장된 판 재개 (AI 턴 도중 새로고침해도 안전)

난이도는 쉬움·보통·어려움 3단계로, 자원 치트 없이 AI 의사결정 수준만 달라진다. 어려움은 반격 위험 평가·집중 공격·지형 활용·적응 생산을 수행한다.

## 조작법

| 조작 | 동작 |
| --- | --- |
| 유닛 탭 | 선택, 이동 범위(금색)·공격 대상(붉은색) 표시 |
| 강조 타일 탭 | 이동 (마을·수도에 올라서면 점령) |
| 붉은 칸의 적 탭 | 1탭 = 전투 예측 표시, 재탭 = 공격 확정 |
| 내 거점(빈 타일) 탭 | 유닛 생산 시트 열기 |
| 드래그 / 두 손가락 | 지도 이동 / 확대·축소 (+·− 버튼도 지원) |
| 턴 종료 버튼 | AI 두 세력이 행동 후 다음 턴 시작 (2배속·건너뛰기 지원) |

## 개발·테스트

```bash
npm install
npm run dev           # http://localhost:5173
npm run build         # 타입 검사 + 프로덕션 빌드(dist/)
npm test              # 코어 로직 단위 테스트(Vitest)
npm run test:e2e      # Playwright E2E — Chromium·WebKit 모바일 + PC smoke
                      #   (최초 1회 npx playwright install chromium webkit)
npm run simulate      # 1,000게임+ 밸런스 시뮬레이션 → artifacts/balance-summary.md
npm run lint          # ESLint
npm run package:itch  # itch.io 업로드용 three-crowns-island.zip 생성
```

`main`에 푸시하면 GitHub Actions가 lint·타입·단위 테스트·프로덕션 빌드·멀티브라우저 E2E를 모두 통과한 경우에만 GitHub Pages에 배포한다. 배포판에는 테스트 브리지가 포함되지 않는다.

밸런스 수치는 [src/core/doctrines.ts](src/core/doctrines.ts)와 [src/core/data.ts](src/core/data.ts)에 모여 있고, 시뮬레이션 허용 기준은 [scripts/simulate.ts](scripts/simulate.ts)가 검증한다.

## itch.io 배포

`npm run package:itch`로 생성한 `three-crowns-island.zip`을 HTML 게임으로 업로드한다.

- 게임 설명 초안: *하나의 섬, 세 왕국, 열두 번의 턴. 왕국을 골라 고유 능력으로 섬을 지배하라. 세 시나리오와 매일 바뀌는 일일 도전을 브라우저에서 바로 플레이할 수 있다.*
- 권장 설정: 화면 방향 자유(세로·가로 모두 지원), 모바일 지원 체크, 대표 이미지는 `public/og-image.png`
- 버전: 1.0.0

## 그래픽 에셋 교체

현재 모든 그래픽(지형·유닛 토큰·건물·하이라이트)은 코드로 생성한 벡터 그래픽이다. 게임 로직은 중앙 에셋 ID(`terrain.plains`, `unit.infantry.azure`, `building.capital.crimson` 등)만 참조하므로, 외부 일러스트로 교체할 때 게임 코드를 수정할 필요가 없다.

1. 이미지 파일(PNG·SVG)을 `public/art/` 등에 넣는다.
2. [src/render/external-assets.ts](src/render/external-assets.ts)에 등록한다.

```ts
export const EXTERNAL_ASSETS: Record<string, string> = {
  'terrain.plains': './art/plains.png',
  'unit.infantry.azure': './art/knight-blue.png',
};
```

등록된 ID는 해당 이미지를 사용하고, 등록되지 않은 ID는 계속 코드 생성 그래픽을 사용한다. 전체 ID 목록은 [src/render/assets.ts](src/render/assets.ts)의 `AssetId` 타입 참고.

## 라이선스

MIT

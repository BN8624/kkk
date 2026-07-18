# 세 왕관의 섬

하나의 섬을 두고 세 왕국이 겨루는 모바일 우선 육각 턴제 전략게임. 12턴 안에 적의 수도를 점령하거나 가장 높은 지배 점수를 얻으면 승리한다.

**웹 플레이: https://bn8624.github.io/kkk/**

아이폰 Safari와 PC 브라우저에서 설치 없이 바로 플레이할 수 있다. 브라우저를 닫아도 자동 저장되어 이어할 수 있다.

## 플레이 가능한 기능

- 시드 기반으로 생성되는 육각 섬 지도(평원·숲·산·바다·마을·수도)
- 보병·궁병·기병 3병과, 이동·원거리 공격·반격·지형 방어 보너스
- 중립 마을과 적 거점 점령, 금 수입, 수도·마을에서 유닛 생산
- 우선순위 기반 AI 2세력(공격 → 점령 → 전진 → 생산)
- 수도 점령 승리와 12턴 종료 시 지배 점수 승부, 승리·패배·결과 화면
- 자동 저장·이어하기, 5단계 튜토리얼, 코드 생성 효과음(끄기 가능)

## 조작법

| 조작 | 동작 |
| --- | --- |
| 유닛 탭 | 선택, 이동 범위(금색)·공격 대상(붉은색) 표시 |
| 강조 타일 탭 | 이동 (마을·수도에 올라서면 점령) |
| 붉은 칸의 적 탭 | 공격 |
| 내 거점(빈 타일) 탭 | 유닛 생산 시트 열기 |
| 드래그 / 두 손가락 | 지도 이동 / 확대·축소 (+·− 버튼도 지원) |
| 턴 종료 버튼 | AI 두 세력이 행동 후 다음 턴 시작 |

## 로컬 실행

```bash
npm install
npm run dev        # http://localhost:5173
```

## 빌드·테스트

```bash
npm run build         # 타입 검사 + 프로덕션 빌드(dist/)
npm test              # 코어 로직 단위 테스트(Vitest)
npm run test:e2e      # 모바일 뷰포트 E2E(Playwright, 최초 1회 npx playwright install chromium)
npm run lint          # ESLint
npm run package:itch  # itch.io 업로드용 three-crowns-itch.zip 생성
```

`main`에 푸시하면 GitHub Actions가 자동으로 테스트·빌드 후 GitHub Pages에 배포한다.

## 그래픽 에셋 교체

현재 모든 그래픽(지형·유닛 토큰·건물·하이라이트)은 코드로 생성한 임시 벡터 그래픽이다. 게임 로직은 그래픽 구현이 아니라 중앙 에셋 ID(`terrain.plains`, `unit.infantry.player`, `building.capital.ai1` 등)만 참조하므로, 외부 일러스트로 교체할 때 게임 코드를 수정할 필요가 없다.

1. 이미지 파일(PNG·SVG)을 `public/art/` 등에 넣는다.
2. [src/render/external-assets.ts](src/render/external-assets.ts)에 등록한다.

```ts
export const EXTERNAL_ASSETS: Record<string, string> = {
  'terrain.plains': './art/plains.png',
  'unit.infantry.player': './art/knight-blue.png',
};
```

등록된 ID는 해당 이미지를 사용하고, 등록되지 않은 ID는 계속 코드 생성 그래픽을 사용한다. 전체 ID 목록은 [src/render/assets.ts](src/render/assets.ts)의 `AssetId` 타입 참고.

## 라이선스

MIT

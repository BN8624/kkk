# 세 왕관의 섬 2.2.2 릴리스 노트

이슈 #8 외부 재검토 후속 수리. **2.2.0 guardian 리플레이를 검증 없이 exact로 표시하던 호환 결함**만 고친다.

## 수정 요약

### 2.2.0 / 2.2.1+ 리플레이 호환 정책 분리

- 원인: 2.2.1에서 수호대(`guardian`)의 `movedThisTurn`을 정본 digest에 포함했으나, 호환 레지스트리는 `2.2.x` 전체를 exact로 묶어 **옛 digest(movedThisTurn 없음)로 만든 실제 2.2.0 guardian 리플레이**까지 검증 없이 exact로 라벨했다.
- 조치: `REPLAY_RULE_VERSIONS`에 **`2.2.0` 전용 migratable 항목**을 `2.2.x` 앞에 둔다.
  - **2.2.0**: 5a7bbac legacy digest로 먼저 검증한 뒤, 현행 digest·`GAME_VERSION` 문서로 **명시적 migration**.
  - **2.2.1 이후(`2.2.x`)**: 현행 guardian brace 상태 포함 exact 유지.
- 2.2.0을 검증 없이 exact로 표시하지 않는다. migration 실패 시 unsupported로 정직하게 강등한다.

### 동결 fixture

- `tests/fixtures/replay-2.2.0-guardian.json`
- **생성 근거**: 커밋 `5a7bbac`(Three Crowns Island 2.2.0 릴리스) worktree에서 청람 캠페인 미션2를 AI 플레이한 뒤 `buildReplayDocument`로 산출.
- 동결 digest: `initialStateDigest=cd9ffc20e7879bb3`, `finalStateDigest=3b0401e8da1eb195`.
- 테스트로 legacy digest 일치·현행 `verifyReplay` 거부·migration 후 exact 검증을 못박는다.

## 기존 리플레이 호환 범위

| 버전·시나리오 | 호환 |
| --- | --- |
| 1.5.x 비-crown | exact (공용 digest 형식 유지) |
| 2.0.x three-crowns / broken-strait | exact |
| 2.0.x crown-heart | playable-unverified (기존 정책) |
| 2.1.x | exact (공용 digest 형식 유지) |
| **2.2.0** | **migratable** (legacy guardian digest 검증 → 현행 digest) |
| 2.2.1+ | exact (guardian brace 상태 포함) |

저장 형식 버전 4 유지. 기존 공용 병종 저장·이어하기 정상.

## 검증 첨부(자동)

- 단위: `tests/replay-compat.test.ts` 2.2.0 fixture 스위트, `tests/unique-save-replay.test.ts` exact 정책 정직화
- 결정론·유닛·캠페인·E2E·release assets는 CI 및 로컬 검증

## 설치와 오프라인

PWA 셸 캐시는 `three-crowns-shell-v2.2.2`로 갱신된다. 업데이트는 게임 도중 강제 적용되지 않으며 타이틀에서 사용자가 선택한다.

## 업로드 절차

1. `npm ci && npm run build && npm run release:assets`를 실행한다.
2. `release/SHA256SUMS.txt`로 파일 무결성을 확인한다.
3. `release/three-crowns-island-2.2.2-itch.zip`을 itch.io HTML 게임으로 업로드한다.
4. 나머지 `release/` 파일을 GitHub Release 2.2.2 자산으로 첨부한다.
5. Actions의 모든 필수 작업과 Pages 배포 성공을 확인한다.

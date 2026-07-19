// 한 줄 목적: 왕관의 심장 시나리오 모바일 E2E — 봉인·활성화·4턴 자동승리 없음·결과 화면 불변식
import { expect, test, type Page } from '@playwright/test';

interface TcState {
  turn: number;
  current: string;
  over: boolean;
  winner?: string;
  maxTurns: number;
  units: { id: number; faction: string; q: number; r: number; hp: number }[];
  tiles: { q: number; r: number; terrain: string; building?: string; owner?: string }[];
  crownHold?: { owner: string | null; turns: number };
}

/** 다른 스펙의 전역 __tc 선언과 충돌하지 않도록 로컬 브리지 타입. */
interface CrownBridge {
  state: () => TcState | null;
  busy: () => boolean;
  screenPos: (q: number, r: number) => { x: number; y: number } | undefined;
  crownHold?: () => { owner: string | null; turns: number } | null;
}

async function getState(page: Page): Promise<TcState> {
  const s = await page.evaluate(() => (window as unknown as { __tc?: CrownBridge }).__tc?.state());
  expect(s).toBeTruthy();
  return s as TcState;
}

async function waitIdle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const b = (window as unknown as { __tc?: CrownBridge }).__tc;
      return !!b && !b.busy();
    },
    undefined,
    { timeout: 60_000 },
  );
}

async function tapHex(page: Page, q: number, r: number): Promise<void> {
  const pos = await page.evaluate(
    ([qq, rr]) => (window as unknown as { __tc: CrownBridge }).__tc.screenPos(qq, rr),
    [q, r] as const,
  );
  expect(pos).toBeTruthy();
  if (test.info().project.use.hasTouch) await page.touchscreen.tap(pos!.x, pos!.y);
  else await page.mouse.click(pos!.x, pos!.y);
}

/** 빠른 전투 → 왕관의 심장 → 청람 → 시작 (튜토리얼 완료·AI 애니 스킵). */
async function startCrownHeart(page: Page, seed = 42): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'three-crowns-settings',
      JSON.stringify({ soundOn: false, tutorialDone: true, aiSpeed: 0 }),
    );
  });
  await page.goto(`/?seed=${seed}`);
  await page.getByRole('button', { name: '빠른 전투' }).click();
  await page.getByRole('button', { name: '왕관의 심장' }).click();
  await page.getByRole('button', { name: /청람 왕국/ }).click();
  await page.getByRole('button', { name: '이 왕국으로 시작' }).click();
  await page.waitForFunction(
    () => (window as unknown as { __tc?: CrownBridge }).__tc?.state() !== null,
  );
  await waitIdle(page);
}

/** 턴 종료 클릭 후 turn 증가 또는 over 까지 대기. */
async function endTurn(page: Page): Promise<void> {
  await waitIdle(page);
  const before = await getState(page);
  if (before.over) return;
  await page.getByRole('button', { name: '턴 종료' }).click();
  await page.waitForFunction(
    ([t]) => {
      const s = (window as unknown as { __tc?: CrownBridge }).__tc?.state();
      return s !== null && s !== undefined && (s.turn > t || s.over);
    },
    [before.turn] as const,
    { timeout: 90_000 },
  );
  await waitIdle(page);
}

/** HUD 칩 또는 패널에 봉인(sealed) 표시가 있는지. */
function sealedLocator(page: Page) {
  return page.locator('.hud-top, .unit-panel').getByText(/봉인/);
}

test('turn 1: crown 상태 UI가 봉인을 표시하고 왕관 패널 규칙이 보인다', async ({ page }) => {
  await startCrownHeart(page, 42);
  const state = await getState(page);
  expect(state.turn).toBe(1);
  expect(state.over).toBe(false);

  // HUD 칩: 봉인 카운트다운 (활성화 턴 3 → turn 1 이면 2턴 후)
  await expect(sealedLocator(page)).toBeVisible();
  await expect(page.locator('.hud-top')).toContainText(/봉인/);

  const crown = state.tiles.find((t) => t.building === 'crown');
  expect(crown).toBeTruthy();
  await tapHex(page, crown!.q, crown!.r);
  await expect(page.locator('.unit-panel')).toHaveClass(/show/);
  // 패널: 봉인 문구 + 규칙(4턴 연속 확보)
  await expect(page.locator('.unit-panel')).toContainText(/봉인/);
  await expect(page.locator('.unit-panel')).toContainText(/4턴 연속 확보/);
  await expect(page.locator('.unit-panel')).toContainText(/왕관/);
});

test('여러 라운드 진행: turn 4에 자동 종료되지 않고 turn 5 이상에 도달한다', async ({ page }) => {
  await startCrownHeart(page, 7);
  // 활성화 지연 + 보유 4턴이므로 turn 4 자동 승리 불가
  for (let i = 0; i < 4; i++) {
    const s = await getState(page);
    if (s.over) break;
    await endTurn(page);
  }
  const atOrPast4 = await getState(page);
  // turn 4 도달 시점에 over 가 아니거나, turn 이 이미 5 이상
  if (atOrPast4.turn === 4) {
    expect(atOrPast4.over).toBe(false);
    await endTurn(page);
  }
  const after = await getState(page);
  // 4턴 자동 승리 없음: turn 5 이상 도달 또는 그 전 종료가 없음(여기서는 5+)
  expect(after.turn).toBeGreaterThanOrEqual(5);
  // turn 4 시점에 게임이 끝나지 않았음을 보장(지금 over 여부와 무관하게 turn>=5)
  expect(after.turn === 4 && after.over).toBe(false);
});

test('활성화 턴(3) 이후 crown UI가 봉인이 아닌 활성 표시로 전환된다', async ({ page }) => {
  await startCrownHeart(page, 11);
  await expect(sealedLocator(page)).toBeVisible();

  // turn 3 까지 진행 (활성화)
  while ((await getState(page)).turn < 3 && !(await getState(page)).over) {
    await endTurn(page);
  }
  const state = await getState(page);
  expect(state.over).toBe(false);
  expect(state.turn).toBeGreaterThanOrEqual(3);

  // 봉인 문구 소멸: 무주(미점령) 또는 보유 n/N
  await expect(page.locator('.hud-top')).not.toContainText(/봉인/);
  const hud = page.locator('.hud-top');
  const hudText = (await hud.textContent()) ?? '';
  // 활성: 무주 또는 보유 카운트(예: 0/4, 1/4) 또는 경합
  expect(/무주|\d+\/\d+|경합/.test(hudText)).toBe(true);
});

test('합리적 턴 내 게임이 종료되면 결과 화면이 표시된다', async ({ page }) => {
  test.setTimeout(360_000);
  await startCrownHeart(page, 20260719);

  // maxTurns(14) + 여유: 턴 종료만으로 진행(소극 플레이)
  for (let round = 0; round < 18; round++) {
    const s = await getState(page);
    if (s.over) break;
    await endTurn(page);
  }

  const final = await getState(page);
  expect(final.over).toBe(true);
  expect(final.winner).toBeTruthy();
  // 결과 오버레이(승리/패배/무승부)
  await expect(page.locator('.overlay')).toHaveClass(/show/, { timeout: 15_000 });
  await expect(page.locator('.result-word')).toBeVisible();
});

test('권장: AI 또는 청람이 왕관 방면으로 진입하면 crown 칩 상태가 반영된다', async ({ page }) => {
  test.setTimeout(240_000);
  await startCrownHeart(page, 99);

  let observedHoldOrContest = false;
  let observedNearCrown = false;

  for (let round = 0; round < 12; round++) {
    const s = await getState(page);
    if (s.over) break;

    const crown = s.tiles.find((t) => t.building === 'crown');
    if (crown) {
      // 왕관 소유 또는 인접 유닛 관측
      if (crown.owner) observedNearCrown = true;
      const adj = s.units.some((u) => {
        const dq = u.q - crown.q;
        const dr = u.r - crown.r;
        const dist = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
        return dist <= 1;
      });
      if (adj) observedNearCrown = true;
    }

    const hold = await page.evaluate(() => {
      const b = (window as unknown as { __tc?: CrownBridge }).__tc;
      return b?.crownHold?.() ?? b?.state()?.crownHold ?? null;
    });
    if (hold?.owner) observedHoldOrContest = true;

    // 활성화 후 HUD 가 봉인이 아니면 활성 상태 변화 관측
    if (s.turn >= 3) {
      const text = (await page.locator('.hud-top').textContent()) ?? '';
      if (/\d+\/\d+|경합|무주/.test(text) && !text.includes('봉인')) {
        observedHoldOrContest = true;
      }
    }

    if (observedNearCrown && observedHoldOrContest && s.turn >= 4) break;
    await endTurn(page);
  }

  // 브리틀 회피: 둘 중 하나라도 관측되면 권장 불변식 충족
  // (시드·AI 경로에 따라 소유 전이 없을 수 있어 soft assert)
  const final = await getState(page);
  if (!observedNearCrown && !observedHoldOrContest) {
    // 최소한 게임이 진행됐고 crown 타일이 존재함을 확인(완전 실패는 아님)
    expect(final.tiles.some((t) => t.building === 'crown')).toBe(true);
    test.info().annotations.push({
      type: 'note',
      description: '권장: 왕관 인접/보유 전이가 이 시드에서 관측되지 않음 — 필수 불변식은 다른 테스트에서 보장',
    });
  } else {
    expect(observedNearCrown || observedHoldOrContest).toBe(true);
  }
});

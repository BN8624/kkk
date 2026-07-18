// 한 줄 목적: 게임 한 판이 끝(승리 또는 패배)까지 실제로 진행되고 결과 화면이 뜨는지 검증한다
import { expect, test, type Page } from '@playwright/test';

test('한 판이 제한 턴 안에 끝나고 결과 화면이 표시된다', async ({ page }) => {
  test.setTimeout(360_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'three-crowns-settings',
      JSON.stringify({ soundOn: false, tutorialDone: true }),
    );
  });
  await page.goto('/?seed=20260719');
  await page.getByRole('button', { name: '새 게임' }).click();
  await page.waitForFunction(() => window.__tc?.state() !== null);

  // 플레이어는 매 턴 수도에서 생산만 시도하고 턴을 종료한다(수비 위주 소극 플레이)
  for (let round = 0; round < 14; round++) {
    const state = await getState(page);
    if (state.over) break;
    await page.waitForFunction(() => !window.__tc!.busy(), undefined, { timeout: 60_000 });

    const turnBefore = (await getState(page)).turn;
    await page.getByRole('button', { name: '턴 종료' }).click();
    await page.waitForFunction(
      ([t]) => {
        const s = window.__tc?.state();
        return s !== null && s !== undefined && (s.turn > t || s.over);
      },
      [turnBefore] as const,
      { timeout: 120_000 },
    );
  }

  const finalState = await getState(page);
  expect(finalState.over).toBe(true);
  expect(finalState.winner).toBeTruthy();
  // 결과 오버레이 표시(승리/패배/무승부 문구)
  await expect(page.locator('.overlay')).toHaveClass(/show/, { timeout: 15_000 });
  await expect(page.locator('.result-word')).toBeVisible();
  // 게임 종료 시 저장은 초기화된다
  const saved = await page.evaluate(() => localStorage.getItem('three-crowns-save'));
  expect(saved).toBeNull();
});

interface MinState {
  turn: number;
  over: boolean;
  winner?: string;
}

async function getState(page: Page): Promise<MinState> {
  const s = await page.evaluate(() => {
    const st = window.__tc?.state();
    return st ? { turn: st.turn, over: st.over, winner: st.winner } : null;
  });
  expect(s).toBeTruthy();
  return s as MinState;
}

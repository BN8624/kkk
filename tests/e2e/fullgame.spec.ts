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
  await page.getByRole('button', { name: '빠른 전투' }).click();
  await page.getByRole('button', { name: '이 왕국으로 시작' }).click();
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

  // 결과 화면 → 리플레이 보기: 자동 저장된 리플레이가 재생 화면으로 열린다
  await page.getByRole('button', { name: '리플레이 보기' }).click();
  await expect(page.locator('.rp-bar')).toBeVisible();
  // 한 명령 앞으로 → 명령 설명이 표시된다
  await page.locator('#rp-fwd').click();
  await expect(page.locator('#rp-desc')).not.toBeEmpty();
  // 마지막으로 → 최종 결과 문구가 표시된다
  await page.locator('#rp-last').click();
  await expect(page.locator('#rp-desc')).toHaveClass(/final/, { timeout: 30_000 });
  // 종료 → 보관함에 이 판의 리플레이가 목록으로 보인다
  await page.locator('#rp-exit').click();
  await expect(page.locator('.rp-list .rp-item')).toHaveCount(1);
  await page.getByRole('button', { name: '뒤로' }).click();
  await expect(page.locator('.overlay h1')).toHaveText('세 왕관의 섬');
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

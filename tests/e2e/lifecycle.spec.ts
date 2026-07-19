// 한 줄 목적: 화면 전환을 100회 이상 반복해도 씬·오버레이·HUD 노드·정리 항목이 누적되지 않음을 검증한다
import { expect, test, type Page } from '@playwright/test';

interface LeakCounts {
  cleanups: number;
  scenes: number;
  overlayNodes: number;
  hudNodes: number;
}

/** 다른 스펙의 전역 __tc 선언과 충돌하지 않도록 캐스팅으로 leaks 브리지를 읽는다. */
function readLeaks(page: Page): Promise<LeakCounts> {
  return page.evaluate(() =>
    (window as unknown as { __tc: { leaks: () => LeakCounts } }).__tc.leaks(),
  );
}

async function openTitle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'three-crowns-settings',
      JSON.stringify({ soundOn: false, tutorialDone: true }),
    );
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '빠른 전투' })).toBeVisible();
}

/** 타이틀 → 하위 화면 → 타이틀 왕복. 한 사이클에 8회 전환한다. */
async function cycleScreens(page: Page): Promise<void> {
  // 기록
  await page.locator('#btn-records').click();
  await page.locator('#btn-back').click();
  // 일일 도전
  await page.locator('#btn-daily').click();
  await page.locator('#btn-back').click();
  // 캠페인
  await page.locator('#btn-campaign').click();
  await page.locator('#btn-back').click();
  // 리플레이 보관함
  await page.locator('#btn-replays').click();
  await page.locator('#btn-back').click();
  await expect(page.getByRole('button', { name: '빠른 전투' })).toBeVisible();
}

test('화면 전환 100회 반복 후 씬·노드·정리 항목이 누적되지 않는다', async ({ page }) => {
  await openTitle(page);

  // 워밍업: 각 화면의 지연 초기화(스타일·씬 생성 등)를 미리 소진한다
  for (let i = 0; i < 2; i++) await cycleScreens(page);

  const before = await readLeaks(page);

  // 8전환 × 13사이클 = 104회 전환
  for (let i = 0; i < 13; i++) await cycleScreens(page);

  const after = await readLeaks(page);

  expect(after.scenes).toBe(before.scenes);
  expect(after.overlayNodes).toBe(before.overlayNodes);
  expect(after.hudNodes).toBe(before.hudNodes);
  expect(after.cleanups).toBeLessThanOrEqual(before.cleanups);
});

test('제작실 진입·이탈을 반복해도 에디터 씬·패널이 누적되지 않는다', async ({ page }) => {
  await openTitle(page);

  const enterAndLeaveEditor = async () => {
    await page.locator('#btn-editor').click();
    await expect(page.locator('#btn-new-empty')).toBeVisible();
    await page.locator('#btn-new-empty').click();
    await expect(page.locator('#ed-exit')).toBeVisible();
    await page.locator('#ed-exit').click();
    await expect(page.locator('#btn-new-empty')).toBeVisible();
    await page.locator('#btn-back').click();
    await expect(page.getByRole('button', { name: '빠른 전투' })).toBeVisible();
  };

  // 워밍업: 에디터 씬은 최초 1회 생성 후 재사용된다
  for (let i = 0; i < 2; i++) await enterAndLeaveEditor();

  const before = await readLeaks(page);

  for (let i = 0; i < 6; i++) await enterAndLeaveEditor();

  const after = await readLeaks(page);

  expect(after.scenes).toBe(before.scenes);
  expect(after.overlayNodes).toBe(before.overlayNodes);
  expect(after.hudNodes).toBe(before.hudNodes);
});

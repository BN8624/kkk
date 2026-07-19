// 한 줄 목적: 제작실의 품질 보고서·AI 품질 시험이 실제 UI에서 열리고 결과를 표시하는지 검증한다
import { expect, test } from '@playwright/test';

interface QualityBridge {
  openEditor: () => void;
}
declare const window: { __tc?: Partial<QualityBridge> } & typeof globalThis;

test('제작실: 내장 복제 문서의 품질 보고서와 AI 품질 시험이 표시된다', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'three-crowns-settings',
      JSON.stringify({ soundOn: false, tutorialDone: true, aiSpeed: 0 }),
    );
  });
  await page.goto('/');
  await page.waitForFunction(() => !!window.__tc?.openEditor);
  await page.evaluate(() => window.__tc!.openEditor!());
  await page.getByRole('button', { name: '세 왕관 전쟁 복제' }).click();
  await expect(page.locator('.ed-palette')).toBeVisible();

  // 품질 보고서: 전력 요약과 지표 문장이 표시된다
  await page.locator('#ed-menu').click();
  await page.locator('[data-m="quality"]').click();
  await expect(page.locator('.ed-sheet h3')).toContainText('품질 보고서');
  await expect(page.locator('.ed-sheet .ed-hint').first()).toContainText('물 비율');
  await page.locator('#q-close').click();

  // AI 품질 시험: 자동 관전이 끝나면 결과 패널이 뜬다(게임 사이 양보로 UI 비차단)
  await page.locator('#ed-menu').click();
  await page.locator('[data-m="trial"]').click();
  await expect(page.locator('.ed-sheet h3')).toContainText('AI 품질 시험');
  await expect(page.locator('.ed-sheet h3')).toContainText('결과', { timeout: 90_000 });
  await expect(page.locator('.ed-sheet .ed-hint')).toContainText('평균 종료');
  await page.locator('#t-close').click();
});

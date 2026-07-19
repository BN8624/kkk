// 한 줄 목적: 커스텀 목록의 공식 전장 표시·플레이·복제 편집 흐름을 실제 UI로 검증한다
import { expect, test } from '@playwright/test';

interface OfficialBridge {
  state: () => { turn: number; over: boolean; config?: { mode: string } } | null;
  editorDoc: () => { id: string; title: string } | null;
}
declare const window: { __tc?: Partial<OfficialBridge> } & typeof globalThis;

test('공식 전장: 목록 표시→플레이 시작→복제 편집이 동작한다', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'three-crowns-settings',
      JSON.stringify({ soundOn: false, tutorialDone: true, aiSpeed: 0 }),
    );
  });
  await page.goto('/');

  // 타이틀 → 커스텀: 공식 전장 6종이 표시된다
  await page.getByRole('button', { name: '커스텀' }).click();
  await expect(page.locator('.rp-item[data-kind="official"]')).toHaveCount(6);
  await expect(page.getByText('번개 결투장')).toBeVisible();

  // 공식 전장 플레이: 커스텀 모드 게임이 시작된다
  await page
    .locator('.rp-item[data-id="official-lightning-duel"] [data-act="play-official"]')
    .click();
  await page.waitForFunction(() => {
    const s = window.__tc?.state?.();
    return !!s && s.config?.mode === 'custom' && !s.over;
  });

  // 타이틀 복귀 후 복제 편집: 에디터가 사본 문서로 열린다(원본 ID와 다른 새 ID)
  await page.locator('#hud-gear').click();
  await page.getByRole('button', { name: '타이틀로' }).click();
  await page.getByRole('button', { name: '커스텀' }).click();
  await page.locator('.rp-item[data-id="official-narrow-bridge"] [data-act="clone"]').click();
  await expect(page.locator('.ed-palette')).toBeVisible();
  const doc = await page.evaluate(() => window.__tc!.editorDoc!());
  expect(doc!.title).toContain('사본');
  expect(doc!.id).not.toBe('official-narrow-bridge');
});

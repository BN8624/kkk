// 한 줄 목적: 캠페인 선택→미션 도입→출정→캠페인 게임 시작·저장 이어하기를 검증한다
import { expect, test } from '@playwright/test';

interface Bridge {
  state: () => { turn: number; over: boolean; config?: { mode: string; scenario: string } } | null;
  mode: () => string;
  busy: () => boolean;
}
declare const window: { __tc?: Partial<Bridge> } & typeof globalThis;

test('캠페인: 선택→도입→출정하면 캠페인 게임이 시작되고 이어하기가 된다', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'three-crowns-settings',
      JSON.stringify({ soundOn: false, tutorialDone: true, aiSpeed: 0 }),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: '캠페인' }).click();

  // 세 왕국의 대표 미션이 모두 열려 있다
  await expect(page.getByText('청람 왕국 — 최후의 방벽')).toBeVisible();
  await expect(page.getByText('진홍 공국 — 붉은 기치')).toBeVisible();
  await expect(page.getByText('자원 후국 — 별의 화살')).toBeVisible();

  // 남쪽 관문 도입 화면: 도입 문구와 별 조건이 보인다
  await page.getByRole('button', { name: '1. 남쪽 관문' }).click();
  await expect(page.getByText('산맥의 통로를 막고')).toBeVisible();
  await expect(page.locator('.cp-star-line').first()).toBeVisible();

  // 출정: 실제 게임 엔진으로 캠페인 게임이 시작된다
  await page.getByRole('button', { name: '출정' }).click();
  await page.waitForFunction(() => {
    const s = window.__tc!.state!();
    return (
      s !== null &&
      s.config?.mode === 'campaign' &&
      s.config?.scenario === 'campaign-azure-1' &&
      window.__tc!.mode!() === 'play'
    );
  });
  await expect(page.getByRole('button', { name: '턴 종료' })).toBeVisible();

  // 자동 저장 후 새로 고침해도 캠페인 게임을 이어 간다
  await page.waitForFunction(() => !window.__tc!.busy!());
  await page.reload();
  await page.getByRole('button', { name: '이어하기' }).click();
  await page.waitForFunction(() => {
    const s = window.__tc!.state!();
    return s !== null && s.config?.mode === 'campaign' && window.__tc!.mode!() === 'play';
  });
});

// 한 줄 목적: 영어 모바일 환경에서 설정·HUD·일시정지 핵심 흐름이 한국어 없이 렌더링되는지 검증한다
import { expect, test } from '@playwright/test';

test('영어 모바일 설정·HUD·일시정지', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('three-crowns-locale', 'en');
    localStorage.setItem(
      'three-crowns-settings',
      JSON.stringify({ soundOn: false, tutorialDone: true }),
    );
  });
  await page.goto('/?seed=42');

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: 'Quick Battle' }).click();
  await expect(page.getByRole('heading', { name: 'New Game' })).toBeVisible();
  await expect(page.getByText('Azure Kingdom')).toBeVisible();
  await expect(page.getByText('Defense and Discipline')).toBeVisible();
  await expect(page.getByText('Broken Strait')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[가-힣]/);

  await page.getByRole('button', { name: 'Start with this kingdom' }).click();
  await expect(page.getByRole('button', { name: 'End Turn' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[가-힣]/);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'AI speed: Normal' })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[가-힣]/);
});

test('영어 모바일 캠페인 목록·미션 도입', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('three-crowns-locale', 'en');
    localStorage.setItem(
      'three-crowns-settings',
      JSON.stringify({ soundOn: false, tutorialDone: true }),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Campaign' }).click();

  await expect(page.getByRole('heading', { name: 'Campaign' })).toBeVisible();
  await expect(page.getByText('The Last Bulwark', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /1\. Southern Gate/ }).click();
  await expect(page.getByRole('heading', { name: 'Southern Gate' })).toBeVisible();
  await expect(page.getByText('Win the mission')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[가-힣]/);

  await page.getByRole('button', { name: 'Deploy' }).click();
  await expect(page.getByRole('button', { name: 'End Turn' })).toBeVisible();
});

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

test('영어 모바일 일일 도전·기록·공식 전장', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('three-crowns-locale', 'en'));
  await page.goto('/');

  await page.getByRole('button', { name: 'Daily Challenge' }).click();
  await expect(page.getByRole('button', { name: 'Start Challenge' })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[가-힣]/);
  await page.getByRole('button', { name: 'Back' }).click();

  await page.getByRole('button', { name: 'Records' }).click();
  await expect(page.getByText('Games played')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[가-힣]/);
  await page.getByRole('button', { name: 'Back' }).click();

  await page.getByRole('button', { name: 'Custom Scenarios' }).click();
  await expect(page.getByText('Lightning Arena')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clone and edit Lightning Arena' })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[가-힣]/);
  await page.getByRole('button', { name: 'Back' }).click();

  await page.getByRole('button', { name: 'Replays' }).click();
  await expect(page.getByRole('heading', { name: 'Replays' })).toBeVisible();
  await expect(page.getByText('No saved replays.')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[가-힣]/);
  await page.getByRole('button', { name: 'Back' }).click();

  await page.getByRole('button', { name: 'Play Analysis' }).click();
  await expect(page.getByRole('heading', { name: 'Play Analysis' })).toBeVisible();
  await expect(page.getByText('No replays match these filters.')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[가-힣]/);
});

test('영어 모바일 시나리오 제작실 홈·편집 메뉴', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('three-crowns-locale', 'en'));
  await page.goto('/');

  await page.getByRole('button', { name: 'Scenario Studio' }).click();
  await expect(page.getByRole('heading', { name: 'Scenario Studio' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Empty Map' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Random Map' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import JSON' })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[가-힣]/);

  await page.getByRole('button', { name: 'Empty Map' }).click();
  await expect(page.getByRole('button', { name: 'Validate' })).toBeVisible();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('button', { name: 'Save Draft' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test Play' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quality Report' })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[가-힣]/);

  await page.getByRole('button', { name: 'Document Info' }).click();
  await expect(page.getByText('Author')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[가-힣]/);
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('button', { name: 'Rules' }).click();
  await expect(page.getByLabel('Turn-limit result')).toHaveValue('score');
  expect(await page.locator('body').innerText()).not.toMatch(/[가-힣]/);
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('button', { name: 'Factions' }).click();
  await expect(page.getByText('Azure Kingdom')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[가-힣]/);
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('button', { name: 'Objectives' }).click();
  await expect(page.getByText('Capture every capital')).toBeVisible();
  await expect(page.getByText('Your faction is eliminated')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[가-힣]/);
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Validate' }).click();
  await expect(page.getByRole('heading', { name: /Validation Results/ })).toBeVisible();
  await expect(page.getByText('The conquest objective has no capitals.')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[가-힣]/);
});

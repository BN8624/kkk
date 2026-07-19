// 한 줄 목적: 공개 빌드 dist를 블랙박스로 검증한다 — 브리지 부재와 핵심 흐름을 화면·버튼만으로 확인
import { expect, test, type Page } from '@playwright/test';

declare const window: { __tc?: unknown } & typeof globalThis;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'three-crowns-settings',
      JSON.stringify({ soundOn: false, tutorialDone: true, aiSpeed: 0 }),
    );
  });
});

/** 턴 종료 버튼이 다시 눌리게 될 때까지 = AI 페이즈가 끝날 때까지 기다린다. */
async function waitEndTurnReady(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: '턴 종료' });
  await expect(btn).toBeVisible();
  await expect(btn).toBeEnabled({ timeout: 60_000 });
}

/** 외부 JSON 파일 가져오기 흐름에 쓰는 작고 완전한 6×6 시나리오다. */
function importScenario(): Record<string, unknown> {
  const tiles = [];
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      const q = col - ((row - (row & 1)) >> 1);
      const tile: Record<string, unknown> = { q, r: row, terrain: 'plains' };
      if (col === 0 && row === 0) Object.assign(tile, { building: 'capital', owner: 'azure' });
      if (col === 5 && row === 5) Object.assign(tile, { building: 'capital', owner: 'crimson' });
      tiles.push(tile);
    }
  }
  return {
    schemaVersion: 1,
    id: 'e2e-imported-scenario',
    title: 'E2E 가져온 전장',
    description: '공개 빌드 파일 가져오기 검증',
    board: { cols: 6, rows: 6, tiles, source: { kind: 'fixed' } },
    factions: [
      { id: 'azure', active: true, controller: 'human' },
      { id: 'crimson', active: true, controller: 'ai' },
      { id: 'violet', active: false, controller: 'ai' },
    ],
    units: [
      { faction: 'azure', type: 'infantry', q: 0, r: 1 },
      { faction: 'crimson', type: 'infantry', q: 2, r: 4 },
    ],
    rules: { maxTurns: 6, turnLimit: 'score' },
    victoryConditions: [{ type: 'conquest' }],
    defeatConditions: [{ type: 'human-eliminated' }],
    starConditions: [{ type: 'win' }],
  };
}

test('공개 빌드에는 테스트 브리지가 없다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '빠른 전투' })).toBeVisible();
  expect(await page.evaluate(() => typeof window.__tc)).toBe('undefined');
});

test('빠른 전투: 시작→턴 종료→새로 고침 후 이어하기 복구', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '빠른 전투' }).click();
  await page.getByRole('button', { name: '이 왕국으로 시작' }).click();
  await waitEndTurnReady(page);
  await page.getByRole('button', { name: '턴 종료' }).click();
  await waitEndTurnReady(page);
  await page.reload();
  await page.getByRole('button', { name: '이어하기' }).click();
  await waitEndTurnReady(page);
});

test('일일 도전을 시작할 수 있다', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '일일 도전' }).click();
  await page.locator('#btn-daily-start').click();
  await waitEndTurnReady(page);
});

test('캠페인: 잠금 표시와 첫 미션 출정', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '캠페인' }).click();
  await expect(page.getByText('🔒 2. 포위망 돌파')).toBeVisible();
  await page.getByRole('button', { name: '1. 남쪽 관문' }).click();
  await page.getByRole('button', { name: '출정' }).click();
  await waitEndTurnReady(page);
});

test('캠페인 완료 진행: 별·다음 미션 해금이 새로 고침 후에도 복구된다', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'three-crowns-campaign',
      JSON.stringify({
        version: 1,
        missions: {
          'azure-1': {
            won: true,
            bestStars: 2,
            bestScore: 64,
            bestTurns: 10,
            bestSurvivors: 4,
            lastPlayed: '2026-07-19T00:00:00.000Z',
          },
        },
      }),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: '캠페인' }).click();
  await expect(page.getByRole('button', { name: '2. 포위망 돌파' })).toBeVisible();
  await expect(page.getByText('★★☆ · 최고 64점 · 최단 10턴')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '캠페인' }).click();
  await expect(page.getByRole('button', { name: '2. 포위망 돌파' })).toBeVisible();
  await expect(page.getByText('2★')).toBeVisible();
});

test('에디터: JSON 가져오기→검증→테스트 플레이→초안 저장→커스텀 플레이', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '시나리오 제작' }).click();
  await page.locator('#ed-import-file').setInputFiles({
    name: 'e2e-scenario.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(importScenario())),
  });
  await expect(page.locator('.ed-palette')).toBeVisible();
  await page.locator('#ed-check').click();
  await expect(page.getByText('검증 결과')).toBeVisible();
  await page.locator('.ed-sheet .close-btn').click();
  await page.locator('#ed-menu').click();
  await page.locator('[data-m="test"]').click();
  await waitEndTurnReady(page);
  await page.getByRole('button', { name: '에디터로' }).click();
  await expect(page.locator('.ed-palette')).toBeVisible();
  await page.locator('#ed-menu').click();
  await page.locator('[data-m="save"]').click();
  await expect(page.getByText('초안을 저장했습니다')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: '커스텀 시나리오' }).click();
  await page.locator('.rp-item .rp-main').first().click();
  await waitEndTurnReady(page);
});

test('완료된 빠른 전투의 리플레이를 결과 화면에서 연다', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '빠른 전투' }).click();
  await page.getByRole('button', { name: '이 왕국으로 시작' }).click();
  for (let i = 0; i < 14; i++) {
    const replay = page.getByRole('button', { name: '리플레이 보기' });
    if (await replay.isVisible().catch(() => false)) break;
    await waitEndTurnReady(page);
    // GAME_ENDED 직후 결과 오버레이는 700ms 뒤 표시된다. 그 사이 뒤쪽 턴 버튼을 누르지 않는다.
    await replay.waitFor({ state: 'visible', timeout: 900 }).catch(() => {});
    if (await replay.isVisible().catch(() => false)) break;
    await page.getByRole('button', { name: '턴 종료' }).click();
  }
  const replay = page.getByRole('button', { name: '리플레이 보기' });
  await expect(replay).toBeVisible({ timeout: 60_000 });
  await replay.click();
  await expect(page.locator('.rp-controls')).toBeVisible();
});

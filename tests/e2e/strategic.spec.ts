// 한 줄 목적: 전략 전쟁 시작·지도·턴·저장 복원 핵심 E2E 흐름을 검증한다
import { expect, test, type Page } from '@playwright/test';

interface StrategicState {
  turn: number;
  humanFaction: string;
  currentFaction: string;
  phase: string;
  regions: { id: string; owner: string | null }[];
  armies: { id: string; faction: string; regionId: string; moved: boolean }[];
  treasury: Record<string, number>;
  winner?: string;
  pendingBattle?: { battleId: string };
}

interface StrategicBridge {
  mode: () => string;
  busy: () => boolean;
  strategicState: () => StrategicState | null;
  strategicDigest: () => string | null;
  strategicSelectedArmy: () => string | null;
}

declare const window: { __tc?: Partial<StrategicBridge> } & typeof globalThis;

async function boot(page: Page, seed: number, opts?: { clearStrategic?: boolean }): Promise<void> {
  const clearStrategic = opts?.clearStrategic !== false;
  await page.addInitScript(
    ({ clear }) => {
      localStorage.setItem(
        'three-crowns-settings',
        JSON.stringify({ soundOn: false, tutorialDone: true, aiSpeed: 0 }),
      );
      // reload 이어하기 테스트에서는 전략 저장을 지우지 않는다
      if (clear) {
        localStorage.removeItem('three-crowns-strategy-save');
        localStorage.removeItem('three-crowns-strategy-battle-save');
        localStorage.removeItem('three-crowns-save');
      }
    },
    { clear: clearStrategic },
  );
  page.on('dialog', (d) => void d.accept());
  await page.goto(`/?seed=${seed}`);
}

async function startAzure(page: Page, seed: number): Promise<void> {
  await boot(page, seed);
  await page.getByRole('button', { name: '전략 전쟁 시작' }).click();
  await page.getByRole('button', { name: '청람 왕국' }).click();
  await page.getByRole('button', { name: '시작' }).click();
  await page.waitForFunction(
    () => window.__tc?.mode?.() === 'strategic' && window.__tc?.strategicState?.() != null,
    undefined,
    { timeout: 20_000 },
  );
}

test('전략: 시작·12지역·HUD', async ({ page }) => {
  await startAzure(page, 4242);
  await expect(page.locator('#strategic-map')).toBeVisible();
  await expect(page.locator('.strategic-region')).toHaveCount(12);
  await expect(page.getByRole('button', { name: '전략 턴 종료' })).toBeVisible();
  const snap = await page.evaluate(() => {
    const s = window.__tc!.strategicState!();
    return { n: s!.regions.length, a: s!.armies.length, t: s!.turn, h: s!.humanFaction };
  });
  expect(snap).toEqual({ n: 12, a: 6, t: 1, h: 'azure' });
});

test('전략: 군단 선택·이동 강조·저장 이어하기', async ({ page }) => {
  await startAzure(page, 1001);

  // 아군 군단 지역 클릭 (force: 오버레이/레이아웃 간섭 방지)
  const regionId = await page.evaluate(() => {
    const s = window.__tc!.strategicState!();
    return s!.armies.find((a) => a.faction === 'azure')!.regionId;
  });
  await page.locator(`.strategic-region[data-region="${regionId}"]`).click({ force: true });

  await expect
    .poll(async () => page.evaluate(() => window.__tc?.strategicSelectedArmy?.() ?? null), {
      timeout: 10_000,
    })
    .not.toBeNull();

  await expect(page.locator('.strategic-region.move-target').first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole('button', { name: '대기' })).toBeEnabled();

  // 대기
  await page.getByRole('button', { name: '대기' }).click({ force: true });
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const s = window.__tc?.strategicState?.();
          const id = window.__tc?.strategicSelectedArmy?.();
          if (!s || !id) return false;
          return s.armies.some((a) => a.id === id && a.moved);
        }),
      { timeout: 10_000 },
    )
    .toBe(true);

  const digest = await page.evaluate(() => window.__tc!.strategicDigest!());
  expect(digest).toBeTruthy();
  expect(
    await page.evaluate(() => localStorage.getItem('three-crowns-strategy-save') !== null),
  ).toBe(true);

  // 타이틀로 나갔다가 이어하기 (reload 시 initScript가 저장을 지우지 않도록 플래그 해제)
  await page.getByRole('button', { name: '타이틀' }).click();
  await page.getByRole('button', { name: '전략 전쟁 이어하기' }).click();
  await page.waitForFunction(
    () => window.__tc?.mode?.() === 'strategic' && window.__tc?.strategicState?.() != null,
    undefined,
    { timeout: 20_000 },
  );
  expect(await page.evaluate(() => window.__tc!.strategicDigest!())).toBe(digest);
});

test('전략: 턴 종료 후 진행', async ({ page }) => {
  await startAzure(page, 2002);
  const beforeGold = await page.evaluate(
    () => window.__tc!.strategicState!()!.treasury.azure,
  );
  await page.getByRole('button', { name: '전략 턴 종료' }).click({ force: true });

  await page.waitForFunction(
    () => {
      const mode = window.__tc?.mode?.();
      const s = window.__tc?.strategicState?.();
      if (mode === 'play') return true;
      if (s && s.turn >= 2) return true;
      if (s && (s.phase === 'ended' || s.winner !== undefined)) return true;
      return false;
    },
    undefined,
    { timeout: 90_000 },
  );

  const mode = await page.evaluate(() => window.__tc!.mode!());
  if (mode === 'play') {
    expect(await page.evaluate(() => localStorage.getItem('three-crowns-save'))).toBeNull();
  } else {
    const s = await page.evaluate(() => window.__tc!.strategicState!());
    expect(s!.turn).toBeGreaterThanOrEqual(2);
    expect(s!.treasury.azure).toBeGreaterThanOrEqual(beforeGold);
  }
});

test('전략: 모바일 세로 레이아웃', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startAzure(page, 3003);
  const box = await page.locator('#strategic-map').boundingBox();
  expect(box).toBeTruthy();
  expect(box!.width).toBeLessThanOrEqual(400);
  await page.locator('.strategic-region').first().click({ force: true });
  await expect(page.locator('#strategic-panel')).toBeVisible();
});

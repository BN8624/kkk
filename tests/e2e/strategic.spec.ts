// 한 줄 목적: 전략 섬 지도·군단 토큰·이동·저장 복원 E2E 흐름을 검증한다
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shotDir = path.join(__dirname, '../../artifacts/strategic-map');

interface StrategicState {
  turn: number;
  humanFaction: string;
  currentFaction: string;
  phase: string;
  regions: { id: string; owner: string | null; neighbors: string[] }[];
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

test('전략: 시작·SVG 섬·12영토·HUD·카드 부재', async ({ page }) => {
  await startAzure(page, 4242);
  await expect(page.locator('#strategic-map')).toBeVisible();
  await expect(page.locator('svg.strategic-map-svg')).toBeVisible();
  await expect(page.locator('path.strategic-region')).toHaveCount(12);
  await expect(page.locator('.strategic-army')).toHaveCount(6);
  // 구 카드 그리드 부재
  await expect(page.locator('button.strategic-region')).toHaveCount(0);
  await expect(page.locator('.strategic-links')).toHaveCount(0);
  // 수도 3 + 도시/요새 아이콘
  await expect(page.locator('.st-capital')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '전략 턴 종료' })).toBeVisible();
  const snap = await page.evaluate(() => {
    const s = window.__tc!.strategicState!();
    return { n: s!.regions.length, a: s!.armies.length, t: s!.turn, h: s!.humanFaction };
  });
  expect(snap).toEqual({ n: 12, a: 6, t: 1, h: 'azure' });
  await page.screenshot({
    path: path.join(shotDir, 'mobile-first.png'),
    fullPage: false,
  });
});

test('전략: 군단 토큰 선택·이동 강조·저장 이어하기', async ({ page }) => {
  await startAzure(page, 1001);

  const armyId = await page.evaluate(() => {
    const s = window.__tc!.strategicState!();
    return s!.armies.find((a) => a.faction === 'azure')!.id;
  });
  await page.locator(`.strategic-army[data-army="${armyId}"]`).click({ force: true });

  await expect
    .poll(async () => page.evaluate(() => window.__tc?.strategicSelectedArmy?.() ?? null), {
      timeout: 10_000,
    })
    .toBe(armyId);

  await expect(page.locator('path.strategic-region.move-target').first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole('button', { name: '대기' })).toBeEnabled();
  await page.screenshot({
    path: path.join(shotDir, 'army-selected.png'),
    fullPage: false,
  });

  // 비인접(이동 불가) 영토는 move-target 아님 — 인접만 강조
  const moveCount = await page.locator('path.strategic-region.move-target').count();
  expect(moveCount).toBeGreaterThan(0);
  expect(moveCount).toBeLessThan(12);

  await page.screenshot({
    path: path.join(shotDir, 'move-highlight.png'),
    fullPage: false,
  });

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

  await page.getByRole('button', { name: '타이틀' }).click();
  await page.getByRole('button', { name: '전략 전쟁 이어하기' }).click();
  await page.waitForFunction(
    () => window.__tc?.mode?.() === 'strategic' && window.__tc?.strategicState?.() != null,
    undefined,
    { timeout: 20_000 },
  );
  expect(await page.evaluate(() => window.__tc!.strategicDigest!())).toBe(digest);
});

test('전략: 군단 이동 경로·도착', async ({ page }) => {
  await startAzure(page, 5555);
  const info = await page.evaluate(() => {
    const s = window.__tc!.strategicState!();
    const army = s!.armies.find((a) => a.faction === 'azure' && !a.moved)!;
    const region = s!.regions.find((r) => r.id === army.regionId)!;
    // 적 없는 인접 우선
    const empty = region.neighbors.find((nid) => !s!.armies.some((x) => x.regionId === nid));
    const to = empty ?? region.neighbors[0]!;
    return { armyId: army.id, from: army.regionId, to };
  });

  await page.locator(`.strategic-army[data-army="${info.armyId}"]`).click({ force: true });
  await expect
    .poll(async () => page.evaluate(() => window.__tc?.strategicSelectedArmy?.() ?? null))
    .toBe(info.armyId);

  await page.locator(`path.strategic-region[data-region="${info.to}"]`).click({ force: true });

  await page.waitForFunction(
    ({ armyId, to }) => {
      const s = window.__tc?.strategicState?.();
      if (!s) return false;
      const a = s.armies.find((x) => x.id === armyId);
      return a != null && a.regionId === to && a.moved === true;
    },
    info,
    { timeout: 15_000 },
  );

  await page.screenshot({
    path: path.join(shotDir, 'move-done.png'),
    fullPage: false,
  });

  const after = await page.evaluate((armyId) => {
    const s = window.__tc!.strategicState!();
    return s!.armies.find((a) => a.id === armyId)!;
  }, info.armyId);
  expect(after.regionId).toBe(info.to);
  expect(after.moved).toBe(true);
});

test('전략: 영토 선택 패널·닫기', async ({ page }) => {
  await startAzure(page, 7777);
  await page.locator('path.strategic-region[data-region="r02"]').click({ force: true });
  await expect(page.locator('#strategic-panel')).toBeVisible();
  await expect(page.locator('#strategic-panel h3')).toBeVisible();
  await page.locator('#st-panel-close').click({ force: true });
  await expect(page.locator('.strategic-panel--hint')).toBeVisible();
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
    await page.screenshot({
      path: path.join(shotDir, 'battle-return-or-tactical.png'),
      fullPage: false,
    });
  } else {
    const s = await page.evaluate(() => window.__tc!.strategicState!());
    expect(s!.turn).toBeGreaterThanOrEqual(2);
    expect(s!.treasury.azure).toBeGreaterThanOrEqual(beforeGold);
    // 지도 복귀 후 SVG 유지
    await expect(page.locator('svg.strategic-map-svg')).toBeVisible();
    await page.screenshot({
      path: path.join(shotDir, 'after-turn.png'),
      fullPage: false,
    });
  }
});

test('전략: 모바일 세로 — 가로 스크롤 없음·패널 조작', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startAzure(page, 3003);
  const metrics = await page.evaluate(() => {
    const root = document.getElementById('strategic-root')!;
    const map = document.getElementById('strategic-map')!;
    return {
      rootScrollW: root.scrollWidth,
      rootClientW: root.clientWidth,
      mapW: map.clientWidth,
      mapH: map.clientHeight,
      bodyOverflowX: getComputedStyle(document.body).overflowX,
    };
  });
  expect(metrics.rootScrollW).toBeLessThanOrEqual(metrics.rootClientW + 1);
  expect(metrics.mapW).toBeGreaterThan(200);
  expect(metrics.mapH).toBeGreaterThan(200);

  await page.locator('.strategic-army').first().click({ force: true });
  await expect(page.locator('#strategic-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: '대기' })).toBeVisible();
});

test('전략: PC 레이아웃 스크린샷', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await startAzure(page, 8888);
  await expect(page.locator('svg.strategic-map-svg')).toBeVisible();
  await page.screenshot({
    path: path.join(shotDir, 'pc-map.png'),
    fullPage: false,
  });
});

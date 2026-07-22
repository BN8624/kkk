// 한 줄 목적: 전략 전쟁 시작·지도·턴·저장 복원 핵심 E2E 흐름을 검증한다
import { expect, test, type Page } from '@playwright/test';

interface StrategicArmy {
  id: string;
  faction: string;
  regionId: string;
  moved: boolean;
  units: { id: string; hp: number }[];
}

interface StrategicState {
  turn: number;
  maxTurns: number;
  humanFaction: string;
  currentFaction: string;
  phase: string;
  regions: { id: string; owner: string | null }[];
  armies: StrategicArmy[];
  treasury: Record<string, number>;
  winner?: string;
  pendingBattle?: { battleId: string };
}

interface StrategicBridge {
  mode: () => string;
  busy: () => boolean;
  state: () => unknown;
  strategicState: () => StrategicState | null;
  strategicDigest: () => string | null;
  strategicSelectedArmy: () => string | null;
  strategicRegion: (id: string) => { id: string; owner: string | null } | null;
  strategicContinue: () => void;
}

declare const window: { __tc?: Partial<StrategicBridge> } & typeof globalThis;

async function bootStrategic(page: Page, seed = 4242): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'three-crowns-settings',
      JSON.stringify({ soundOn: false, tutorialDone: true, aiSpeed: 0 }),
    );
    localStorage.removeItem('three-crowns-strategy-save');
    localStorage.removeItem('three-crowns-strategy-battle-save');
    localStorage.removeItem('three-crowns-save');
  });
  await page.goto(`/?seed=${seed}`);
}

async function waitStrategicReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const s = window.__tc?.strategicState?.();
      return s !== null && s !== undefined && window.__tc?.mode?.() === 'strategic';
    },
    undefined,
    { timeout: 30_000 },
  );
}

test('전략: 타이틀→왕국 선택→12지역 지도·군단 표시', async ({ page }) => {
  await bootStrategic(page);
  await page.getByRole('button', { name: '전략 전쟁 시작' }).click();
  await expect(page.getByRole('heading', { name: '왕국 선택' })).toBeVisible();
  await page.getByRole('button', { name: '청람 왕국' }).click();
  await page.getByRole('button', { name: '시작' }).click();
  await waitStrategicReady(page);

  await expect(page.locator('#strategic-map')).toBeVisible();
  await expect(page.getByRole('button', { name: /청람 왕도/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /진홍 왕도/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /자원 왕도/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '전략 턴 종료' })).toBeVisible();

  const snap = await page.evaluate(() => {
    const s = window.__tc!.strategicState!();
    return {
      regions: s!.regions.length,
      armies: s!.armies.length,
      turn: s!.turn,
      human: s!.humanFaction,
      current: s!.currentFaction,
    };
  });
  expect(snap.regions).toBe(12);
  expect(snap.armies).toBe(6);
  expect(snap.turn).toBe(1);
  expect(snap.human).toBe('azure');
  expect(snap.current).toBe('azure');
});

test('전략: 군단 선택·이동 강조·중립 점령·저장 복원', async ({ page }) => {
  await bootStrategic(page, 1001);
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '전략 전쟁 시작' }).click();
  await page.getByRole('button', { name: '청람 왕국' }).click();
  await page.getByRole('button', { name: '시작' }).click();
  await waitStrategicReady(page);

  // r00 청람 왕도 탭 → 군단 선택
  await page.getByRole('button', { name: /청람 왕도/ }).click();
  await page.waitForFunction(() => window.__tc?.strategicSelectedArmy?.() !== null);

  // 이동 가능 지역 강조
  await expect(page.locator('.strategic-region.move-target').first()).toBeVisible();

  // 북부 평야(r02) 또는 서녘 숲(r01) 등 인접 중립/지역으로 이동
  const moveTarget = page.locator('.strategic-region.move-target').first();
  await moveTarget.click();

  await page.waitForFunction(() => {
    const s = window.__tc?.strategicState?.();
    return s !== null && s !== undefined && s.armies.some((a) => a.faction === 'azure' && a.moved);
  });

  const digestBefore = await page.evaluate(() => window.__tc!.strategicDigest!());
  expect(digestBefore).toBeTruthy();

  // 새로고침 후 이어하기
  await page.reload();
  await page.getByRole('button', { name: '전략 전쟁 이어하기' }).click();
  await waitStrategicReady(page);
  const digestAfter = await page.evaluate(() => window.__tc!.strategicDigest!());
  expect(digestAfter).toBe(digestBefore);
});

test('전략: 턴 종료→AI 행동→인간 복귀·turn 증가·수입', async ({ page }) => {
  await bootStrategic(page, 2002);
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '전략 전쟁 시작' }).click();
  await page.getByRole('button', { name: '청람 왕국' }).click();
  await page.getByRole('button', { name: '시작' }).click();
  await waitStrategicReady(page);

  const before = await page.evaluate(() => {
    const s = window.__tc!.strategicState!();
    return { turn: s!.turn, gold: s!.treasury.azure };
  });

  await page.getByRole('button', { name: '전략 턴 종료' }).click();
  await page.waitForFunction(
    () => {
      const s = window.__tc?.strategicState?.();
      return (
        s !== null &&
        s !== undefined &&
        s.currentFaction === s.humanFaction &&
        s.turn >= 2 &&
        !s.pendingBattle
      );
    },
    undefined,
    { timeout: 60_000 },
  );

  const after = await page.evaluate(() => {
    const s = window.__tc!.strategicState!();
    return { turn: s!.turn, gold: s!.treasury.azure, current: s!.currentFaction };
  });
  expect(after.turn).toBeGreaterThanOrEqual(before.turn + 1);
  expect(after.gold).toBeGreaterThan(before.gold);
  expect(after.current).toBe('azure');
});

test('전략: 모바일 세로 지도·탭 영역', async ({ page }) => {
  await bootStrategic(page, 3003);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '전략 전쟁 시작' }).click();
  await page.getByRole('button', { name: '진홍 공국' }).click();
  await page.getByRole('button', { name: '시작' }).click();
  await waitStrategicReady(page);

  const map = page.locator('#strategic-map');
  await expect(map).toBeVisible();
  const box = await map.boundingBox();
  expect(box).toBeTruthy();
  // 가로 스크롤 없이 뷰포트 안에 지도가 들어감
  expect(box!.width).toBeLessThanOrEqual(390 + 2);

  const region = page.locator('.strategic-region').first();
  const rbox = await region.boundingBox();
  expect(rbox).toBeTruthy();
  expect(rbox!.height).toBeGreaterThanOrEqual(44);

  await region.click();
  await expect(page.locator('#strategic-panel')).toBeVisible();
});

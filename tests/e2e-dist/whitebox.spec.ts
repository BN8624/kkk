// 한 줄 목적: 테스트 빌드 dist를 화이트박스로 검증한다 — 브리지 노출·명령 실행·상태 다이제스트 결정론
import { expect, test } from '@playwright/test';

interface Bridge {
  state: () => { turn: number; over: boolean; seed?: number } | null;
  busy: () => boolean;
  mode: () => string;
  digest: () => string | null;
}
declare const window: { __tc?: Partial<Bridge> } & typeof globalThis;

const SETTINGS = { soundOn: false, tutorialDone: true, aiSpeed: 0 };

/** 같은 시드로 빠른 전투 1턴을 진행하고 상태 다이제스트를 반환한다. */
async function playOneTurnDigest(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/?seed=424242');
  await page.waitForFunction(() => !!window.__tc?.digest);
  await page.getByRole('button', { name: '빠른 전투' }).click();
  await page.getByRole('button', { name: '이 왕국으로 시작' }).click();
  await page.waitForFunction(() => window.__tc!.mode!() === 'play' && !window.__tc!.busy!());
  await page.getByRole('button', { name: '턴 종료' }).click();
  await page.waitForFunction(() => {
    const s = window.__tc!.state!();
    return s !== null && s.turn === 2 && !window.__tc!.busy!();
  });
  return (await page.evaluate(() => window.__tc!.digest!()))!;
}

test('테스트 빌드: 브리지가 노출되고 같은 시드의 1턴 결과 다이제스트가 재현된다', async ({ page }) => {
  await page.addInitScript((s) => {
    localStorage.setItem('three-crowns-settings', JSON.stringify(s));
  }, SETTINGS);
  const first = await playOneTurnDigest(page);
  expect(first).toMatch(/\S/);
  // 저장을 비우고 같은 시드로 다시 — 명령 실행 경로 전체가 결정론적이어야 한다
  await page.evaluate(() => localStorage.removeItem('three-crowns-save'));
  const second = await playOneTurnDigest(page);
  expect(second).toBe(first);
});

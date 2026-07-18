// 한 줄 목적: 배포된 GitHub Pages URL에서 게임 시작·이동·턴 진행이 실제로 되는지 검수한다
import { chromium, devices } from '@playwright/test';

const base = process.argv[2] ?? 'https://bn8624.github.io/kkk/';
const outDir = process.argv[3] ?? '.';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
});

await page.addInitScript(() => {
  localStorage.setItem(
    'three-crowns-settings',
    JSON.stringify({ soundOn: false, tutorialDone: true }),
  );
});
process.on('uncaughtException', async (e) => {
  console.log('FAILED:', String(e).slice(0, 300));
  console.log('page errors:', JSON.stringify(errors));
  try {
    const s = await page.evaluate(() => {
      const st = window.__tc?.state();
      return st ? { turn: st.turn, current: st.current, over: st.over, busy: window.__tc.busy() } : null;
    });
    console.log('state:', JSON.stringify(s));
    await page.screenshot({ path: `${outDir}/live-fail.png` });
  } catch { /* 무시 */ }
  await browser.close();
  process.exit(1);
});

await page.goto(base + '?seed=42');
await page.waitForTimeout(1000);
await page.screenshot({ path: `${outDir}/live-01-title.png` });

await page.getByRole('button', { name: '새 게임' }).click();
await page.waitForFunction(() => window.__tc?.state() !== null, undefined, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/live-02-board.png` });

// 유닛 선택 → 이동
const unit = await page.evaluate(() => window.__tc.state().units.find((u) => u.faction === 'player'));
const pos = await page.evaluate(([q, r]) => window.__tc.screenPos(q, r), [unit.q, unit.r]);
await page.touchscreen.tap(pos.x, pos.y);
await page.waitForTimeout(400);
const dests = await page.evaluate(() => window.__tc.dests());
const dpos = await page.evaluate(([q, r]) => window.__tc.screenPos(q, r), [dests[0].q, dests[0].r]);
await page.touchscreen.tap(dpos.x, dpos.y);
await page.waitForFunction(
  ([id]) => window.__tc.state().units.find((u) => u.id === id)?.moved === true,
  [unit.id],
  { timeout: 15000 },
);

// 이동 연출이 끝날 때까지 대기 후 턴 종료 → 2턴
await page.waitForFunction(() => !window.__tc.busy(), undefined, { timeout: 30000 });
await page.getByRole('button', { name: '턴 종료' }).click();
await page.waitForFunction(() => window.__tc?.state()?.turn === 2, undefined, { timeout: 60000 });
await page.waitForFunction(() => !window.__tc.busy(), undefined, { timeout: 60000 });
await page.screenshot({ path: `${outDir}/live-03-turn2.png` });

const state = await page.evaluate(() => {
  const s = window.__tc.state();
  return { turn: s.turn, units: s.units.length, over: s.over };
});
console.log(JSON.stringify({ ok: true, state, errors }, null, 2));
await browser.close();

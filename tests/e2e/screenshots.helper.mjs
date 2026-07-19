// 한 줄 목적: 개발 검수용 화면 캡처 스크립트(타이틀·보드·선택·생산 시트)
import { chromium, devices } from '@playwright/test';

const outDir = process.argv[2] ?? '.';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
await page.addInitScript(() => {
  localStorage.setItem('three-crowns-settings', JSON.stringify({ soundOn: false, tutorialDone: true }));
});

await page.goto('http://localhost:5199/?seed=42');
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/01-title.png` });

await page.getByRole('button', { name: '빠른 전투' }).click();
await page.waitForFunction(() => window.__tc?.state() !== null);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/02-board.png` });

// 유닛 선택 상태
const unit = await page.evaluate(() => window.__tc.state().units.find((u) => u.faction === 'player'));
const pos = await page.evaluate(([q, r]) => window.__tc.screenPos(q, r), [unit.q, unit.r]);
await page.touchscreen.tap(pos.x, pos.y);
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/03-selected.png` });

// 생산 시트
const cap = await page.evaluate(() =>
  window.__tc.state().tiles.find((t) => t.building === 'capital' && t.owner === 'player'),
);
const cpos = await page.evaluate(([q, r]) => window.__tc.screenPos(q, r), [cap.q, cap.r]);
await page.touchscreen.tap(cpos.x, cpos.y); // 선택 해제
await page.waitForTimeout(200);
await page.touchscreen.tap(cpos.x, cpos.y);
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/04-production.png` });

// 가로 모드
const land = await ctx.newPage();
await land.addInitScript(() => {
  localStorage.setItem('three-crowns-settings', JSON.stringify({ soundOn: false, tutorialDone: true }));
});
await land.setViewportSize({ width: 812, height: 375 });
await land.goto('http://localhost:5199/?seed=42');
await land.getByRole('button', { name: /빠른 전투|이어하기/ }).first().click();
await land.waitForTimeout(1200);
await land.screenshot({ path: `${outDir}/05-landscape.png` });

await browser.close();
console.log('screenshots saved to', outDir);

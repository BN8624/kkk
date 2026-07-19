// 한 줄 목적: 실행 중인 개발 서버에서 OG 이미지·README 스크린샷을 캡처한다
import { readFileSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.CAPTURE_URL ?? 'http://localhost:5199';
const SEED = 20260719;

async function startGame(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'three-crowns-settings',
      JSON.stringify({ soundOn: false, tutorialDone: true }),
    );
  });
  await page.goto(`${BASE}/?seed=${SEED}`);
  await page.getByRole('button', { name: '빠른 전투' }).click();
  await page.getByRole('button', { name: '이 왕국으로 시작' }).click();
  await page.waitForFunction(() => window.__tc?.state() !== null);
}

async function playTurns(page, turns) {
  for (let i = 0; i < turns; i++) {
    await page.getByRole('button', { name: '턴 종료' }).click();
    await page.waitForFunction(() => window.__tc && !window.__tc.busy(), undefined, {
      timeout: 60_000,
    });
  }
}

/** 아군 유닛 하나를 선택해 이동 범위 하이라이트가 보이게 한다. */
async function selectUnit(page) {
  const pos = await page.evaluate(() => {
    const tc = window.__tc;
    const s = tc.state();
    const u = s.units.find((x) => x.faction === 'azure' && !x.moved);
    return u ? tc.screenPos(u.q, u.r) : null;
  });
  if (pos) {
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(400);
  }
}

const browser = await chromium.launch();

// OG 이미지(1200x630): 정사각 게임 캡처 + 타이틀을 합성한다
{
  const page = await browser.newPage({ viewport: { width: 660, height: 630 } });
  await startGame(page);
  await playTurns(page, 2);
  await selectUnit(page);
  const shot = (await page.screenshot()).toString('base64');
  const favicon = readFileSync('public/favicon.svg', 'utf8');
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`<!doctype html>
    <body style="margin:0;width:1200px;height:630px;display:flex;background:#1d2a44;
      font-family:Georgia,'Times New Roman',serif;color:#f2e4c0;overflow:hidden">
      <img src="data:image/png;base64,${shot}" style="width:660px;height:630px;object-fit:cover">
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
        gap:18px;border-left:4px solid #d9b64e">
        <div style="width:150px;height:150px">${favicon}</div>
        <div style="font-size:64px;font-weight:bold;letter-spacing:6px">세 왕관의 섬</div>
        <div style="font-size:26px;color:#d9b64e;letter-spacing:2px">Three Crowns Island</div>
        <div style="font-size:20px;color:#b8c4dd">세 왕국 · 세 시나리오 · 일일 도전</div>
      </div>
    </body>`);
  await page.screenshot({ path: 'public/og-image.png' });
  await page.close();
  console.log('public/og-image.png');
}

// README 모바일 스크린샷(iPhone 13 뷰포트)
{
  const page = await browser.newPage({ ...devices['iPhone 13'] });
  await startGame(page);
  await playTurns(page, 2);
  await selectUnit(page);
  await page.screenshot({ path: 'docs/screenshot-mobile.png' });
  await page.close();
  console.log('docs/screenshot-mobile.png');
}

await browser.close();

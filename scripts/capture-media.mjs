// 한 줄 목적: 실행 중인 개발 서버에서 한·영 스크린샷과 2.0 대표·에디터·리플레이 GIF 등 공개 미디어를 캡처한다
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.CAPTURE_URL ?? 'http://localhost:5199';
const SEED = 20260719;

async function preparePage(page, locale = 'ko') {
  await page.addInitScript((selectedLocale) => {
    localStorage.setItem(
      'three-crowns-settings',
      JSON.stringify({ soundOn: false, tutorialDone: true, aiSpeed: 0 }),
    );
    localStorage.setItem('three-crowns-locale', selectedLocale);
  }, locale);
}

async function startGame(page, locale = 'ko') {
  await preparePage(page, locale);
  await page.goto(`${BASE}/?seed=${SEED}`);
  await page.locator('#btn-new').click();
  await page.locator('#btn-start').click();
  await page.waitForFunction(() => window.__tc?.state() !== null);
}

async function openTitle(page, locale = 'ko') {
  await preparePage(page, locale);
  await page.goto(BASE);
}

function makeGif(frameDir, output) {
  execFileSync(
    process.env.PYTHON || 'python',
    [
      '-c',
      [
        'from PIL import Image',
        'import glob, os, sys',
        "files = sorted(glob.glob(os.path.join(sys.argv[1], '*.png')))",
        "frames = [Image.open(f).convert('P', palette=Image.Palette.ADAPTIVE, colors=128) for f in files]",
        "frames[0].save(sys.argv[2], save_all=True, append_images=frames[1:], duration=900, loop=0, optimize=True, disposal=2)",
      ].join('; '),
      frameDir,
      output,
    ],
    { stdio: 'ignore' },
  );
}

async function playTurns(page, turns) {
  for (let i = 0; i < turns; i++) {
    await page.locator('button.end-turn').click();
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

// README 한국어 모바일 스크린샷(iPhone 13 뷰포트)
{
  const page = await browser.newPage({ ...devices['iPhone 13'] });
  await startGame(page);
  await playTurns(page, 2);
  await selectUnit(page);
  await page.screenshot({ path: 'docs/screenshot-ko.png' });
  copyFileSync('docs/screenshot-ko.png', 'docs/screenshot-mobile.png');
  await page.close();
  console.log('docs/screenshot-ko.png');
}

// README 영어 모바일 스크린샷(iPhone 13 뷰포트)
{
  const page = await browser.newPage({ ...devices['iPhone 13'] });
  await startGame(page, 'en');
  await playTurns(page, 2);
  await selectUnit(page);
  await page.screenshot({ path: 'docs/screenshot-en.png' });
  await page.close();
  console.log('docs/screenshot-en.png');
}

// 2.0 대표 GIF: 타이틀→설정→전투→선택 가능한 행동
{
  const frames = join('docs', '.hero-frames');
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const page = await browser.newPage({ ...devices['iPhone 13'] });
  await openTitle(page);
  await page.screenshot({ path: join(frames, '00.png') });
  await page.locator('#btn-new').click();
  await page.screenshot({ path: join(frames, '01.png') });
  await page.locator('#btn-start').click();
  await page.waitForFunction(() => window.__tc?.state() !== null);
  await page.screenshot({ path: join(frames, '02.png') });
  await playTurns(page, 1);
  await selectUnit(page);
  await page.screenshot({ path: join(frames, '03.png') });
  await page.close();
  makeGif(frames, 'docs/hero.gif');
  rmSync(frames, { recursive: true, force: true });
  console.log('docs/hero.gif');
}

// 캠페인 선택 화면
{
  const page = await browser.newPage({ ...devices['iPhone 13'] });
  await openTitle(page);
  await page.getByRole('button', { name: '캠페인' }).click();
  await page.screenshot({ path: 'docs/campaign.png' });
  await page.close();
  console.log('docs/campaign.png');
}

// 제작실: 진입→내장 복제→검증→테스트 플레이→원본 복귀
{
  const frames = join('docs', '.editor-frames');
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const page = await browser.newPage({ ...devices['iPhone 13'] });
  await openTitle(page);
  await page.getByRole('button', { name: '시나리오 제작' }).click();
  await page.screenshot({ path: join(frames, '00.png') });
  await page.getByRole('button', { name: '세 왕관 전쟁 복제' }).click();
  await page.locator('.ed-palette').waitFor();
  await page.screenshot({ path: join(frames, '01.png') });
  await page.locator('#ed-check').click();
  await page.getByText('검증 결과').waitFor();
  await page.screenshot({ path: join(frames, '02.png') });
  await page.locator('.ed-sheet .close-btn').click();
  await page.locator('#ed-menu').click();
  await page.screenshot({ path: join(frames, '03.png') });
  await page.locator('[data-m="test"]').click();
  await page.getByRole('button', { name: '에디터로' }).waitFor();
  await page.screenshot({ path: join(frames, '04.png') });
  await page.getByRole('button', { name: '에디터로' }).click();
  await page.locator('.ed-palette').waitFor();
  await page.screenshot({ path: join(frames, '05.png') });
  await page.close();
  makeGif(frames, 'docs/editor.gif');
  rmSync(frames, { recursive: true, force: true });
  console.log('docs/editor.gif');
}

// 리플레이: 빠른 전투 종료→결과에서 열기→명령·턴 이동
{
  const frames = join('docs', '.replay-frames');
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const page = await browser.newPage({ ...devices['iPhone 13'] });
  await openTitle(page);
  await page.getByRole('button', { name: '빠른 전투' }).click();
  await page.getByRole('button', { name: '이 왕국으로 시작' }).click();
  for (let i = 0; i < 14; i++) {
    await page.waitForFunction(() => window.__tc?.state()?.over || !window.__tc?.busy());
    if (await page.evaluate(() => window.__tc?.state()?.over)) break;
    await page.getByRole('button', { name: '턴 종료' }).click();
  }
  const replay = page.getByRole('button', { name: '리플레이 보기' });
  await replay.waitFor({ timeout: 60_000 });
  await replay.click();
  await page.locator('.rp-controls').waitFor();
  await page.screenshot({ path: join(frames, '00.png') });
  for (let i = 1; i <= 3; i++) {
    await page.locator('#rp-fwd').click();
    await page.screenshot({ path: join(frames, `0${i}.png`) });
  }
  await page.locator('#rp-next-turn').click();
  await page.screenshot({ path: join(frames, '04.png') });
  await page.locator('#rp-last').click();
  await page.screenshot({ path: join(frames, '05.png') });
  await page.close();
  makeGif(frames, 'docs/replay.gif');
  rmSync(frames, { recursive: true, force: true });
  console.log('docs/replay.gif');
}

await browser.close();

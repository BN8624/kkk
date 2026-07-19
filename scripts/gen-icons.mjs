// 한 줄 목적: favicon.svg를 Playwright로 렌더링해 PWA·애플 아이콘 PNG를 생성한다
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync('public/favicon.svg', 'utf8');
const targets = [
  { file: 'public/icon-192.png', size: 192 },
  { file: 'public/icon-512.png', size: 512 },
  { file: 'public/apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch();
for (const { file, size } of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const html = `<!doctype html><body style="margin:0">${svg.replace(
    '<svg ',
    `<svg width="${size}" height="${size}" `,
  )}</body>`;
  await page.setContent(html);
  await page.screenshot({ path: file, omitBackground: true });
  await page.close();
  console.log(`${file} (${size}x${size})`);
}
await browser.close();

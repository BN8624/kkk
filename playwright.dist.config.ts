// 한 줄 목적: 빌드 산출물 검증 E2E — 테스트 빌드(브리지 포함) 화이트박스와 공개 빌드 블랙박스를 정의한다
import { defineConfig, devices } from '@playwright/test';

const WHITEBOX = 'http://localhost:5301'; // dist-test (VITE_TEST_BRIDGE=1)
const BLACKBOX = 'http://localhost:5302'; // dist (공개 빌드, 브리지 없음)

export default defineConfig({
  testDir: 'tests/e2e-dist',
  timeout: 120_000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    locale: 'ko-KR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'whitebox-chromium',
      testMatch: '**/whitebox.spec.ts',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', baseURL: WHITEBOX },
    },
    {
      name: 'whitebox-webkit',
      testMatch: '**/whitebox.spec.ts',
      use: { ...devices['iPhone 13'], baseURL: WHITEBOX },
    },
    {
      name: 'blackbox-chromium-mobile',
      testMatch: '**/blackbox.spec.ts',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', baseURL: BLACKBOX },
    },
    {
      name: 'blackbox-webkit-mobile',
      testMatch: '**/blackbox.spec.ts',
      use: { ...devices['iPhone 13'], baseURL: BLACKBOX },
    },
    {
      name: 'blackbox-pc',
      testMatch: '**/blackbox.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: BLACKBOX },
    },
  ],
  webServer: [
    {
      command: 'npm run build:test && npx vite preview --outDir dist-test --port 5301 --strictPort',
      port: 5301,
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      command: 'npm run build && npx vite preview --port 5302 --strictPort',
      port: 5302,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});

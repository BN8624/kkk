// 한 줄 목적: 모바일(Chromium·WebKit)·PC smoke E2E 테스트 실행 환경을 정의한다
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5199',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-mobile',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
    {
      name: 'webkit-mobile',
      use: { ...devices['iPhone 13'] },
    },
    {
      // PC smoke: 빠른 핵심 흐름만 데스크톱 뷰포트로 확인
      name: 'pc-smoke',
      testMatch: '**/game.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5199 --strictPort',
    port: 5199,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

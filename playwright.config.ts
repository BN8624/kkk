// 한 줄 목적: 모바일 뷰포트 기반 E2E 테스트 실행 환경을 정의한다
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  retries: 1,
  use: {
    ...devices['iPhone 13'],
    baseURL: 'http://localhost:5199',
  },
  webServer: {
    command: 'npm run dev -- --port 5199 --strictPort',
    port: 5199,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

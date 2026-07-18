// 한 줄 목적: Vite 빌드·개발 서버·Vitest 설정을 정의한다
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2018',
    assetsInlineLimit: 0,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as ReturnType<typeof defineConfig>);

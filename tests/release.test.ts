// 한 줄 목적: 2.0 버전·상대 배포 경로·PWA·CSP·릴리스 자동화 계약이 저장소 이름과 무관하게 유지되는지 검증한다
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GAME_VERSION } from '../src/core/replay';

function text(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('2.1 공개 릴리스 계약', () => {
  it('패키지와 리플레이 게임 버전이 2.2.1으로 일치한다', () => {
    const pkg = JSON.parse(text('package.json')) as { version: string };
    expect(pkg.version).toBe('2.2.1');
    expect(GAME_VERSION).toBe(pkg.version);
  });

  it('Vite와 PWA가 저장소 이름 없는 상대 경로를 쓴다', () => {
    const vite = text('vite.config.ts');
    const manifest = JSON.parse(text('public/manifest.webmanifest')) as {
      start_url: string;
      scope: string;
    };
    const html = text('index.html');
    expect(vite).toContain("base: './'");
    expect(manifest.start_url).toBe('.');
    expect(manifest.scope).toBe('.');
    expect(html).not.toContain('github.io/kkk');
  });

  it('정적 진입점은 CSP와 상대 Open Graph 이미지를 선언한다', () => {
    const html = text('index.html');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("object-src 'none'");
    expect(html).toContain('content="./og-image.png"');
  });

  it('공개 산출물 생성 명령과 필수 미디어 원본을 선언한다', () => {
    const pkg = JSON.parse(text('package.json')) as { scripts: Record<string, string> };
    const script = text('scripts/release-assets.ts');
    expect(pkg.scripts['release:assets']).toContain('release-assets.ts');
    for (const name of [
      'official-scenarios-2.0.0.json',
      'scenario-schema-example.json',
      'full-backup-example.json',
      'playtest-report-example.md',
      'screenshot-ko.png',
      'screenshot-en.png',
      'hero.gif',
      'SHA256SUMS.txt',
    ]) expect(script).toContain(name);
  });
});

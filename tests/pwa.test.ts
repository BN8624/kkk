// 한 줄 목적: PWA 매니페스트와 서비스 워커가 설치·오프라인·승인 업데이트 계약을 지키는지 정적으로 검증한다
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PWA 정적 계약', () => {
  it('상대 경로 scope와 standalone 설치 메타데이터를 제공한다', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
      name: string;
      short_name: string;
      description: string;
      display: string;
      orientation: string;
      start_url: string;
      scope: string;
      theme_color: string;
      background_color: string;
      icons: { sizes: string }[];
    };
    expect(manifest).toMatchObject({
      display: 'standalone',
      orientation: 'any',
      start_url: '.',
      scope: '.',
      theme_color: '#1d2a44',
      background_color: '#1d2a44',
    });
    expect(manifest.name).not.toBe('');
    expect(manifest.short_name).not.toBe('');
    expect(manifest.description).not.toBe('');
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });

  it('앱 셸을 캐시하고 업데이트는 메시지를 받은 뒤에만 활성화한다', () => {
    const worker = readFileSync('public/sw.js', 'utf8');
    expect(worker).toContain("addEventListener('install'");
    expect(worker).toContain("addEventListener('fetch'");
    expect(worker).toContain("event.data?.type === 'SKIP_WAITING'");
    const installBlock = worker.slice(worker.indexOf("addEventListener('install'"), worker.indexOf("addEventListener('activate'"));
    expect(installBlock).not.toContain('skipWaiting');
  });
});

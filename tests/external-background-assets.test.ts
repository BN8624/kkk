// 한 줄 목적: Phase 1 외부 배경 에셋 15개의 등록·파일·PNG 규격·경로·용량을 검증한다
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXTERNAL_ASSETS } from '../src/render/external-assets';

const ROOT = resolve(import.meta.dirname, '..');
const REQUIRED_ASSETS = {
  'terrain.plains': './art/phase1/terrain/plains.png',
  'terrain.forest': './art/phase1/terrain/forest.png',
  'terrain.mountain': './art/phase1/terrain/mountain.png',
  'terrain.water': './art/phase1/terrain/water.png',
  'building.capital.azure': './art/phase1/buildings/capital-azure.png',
  'building.capital.crimson': './art/phase1/buildings/capital-crimson.png',
  'building.capital.violet': './art/phase1/buildings/capital-violet.png',
  'building.village.neutral': './art/phase1/buildings/village-neutral.png',
  'building.village.azure': './art/phase1/buildings/village-azure.png',
  'building.village.crimson': './art/phase1/buildings/village-crimson.png',
  'building.village.violet': './art/phase1/buildings/village-violet.png',
  'building.crown.neutral': './art/phase1/buildings/crown-neutral.png',
  'building.crown.azure': './art/phase1/buildings/crown-azure.png',
  'building.crown.crimson': './art/phase1/buildings/crown-crimson.png',
  'building.crown.violet': './art/phase1/buildings/crown-violet.png',
} as const;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function publicFile(url: string): string {
  return join(ROOT, 'public', url.replace(/^\.\//, ''));
}

function pngInfo(path: string): { width: number; height: number; colorType: number } {
  const header = readFileSync(path).subarray(0, 29);
  expect(header.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  expect(header.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return {
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20),
    colorType: header[25],
  };
}

function exactCaseExists(path: string): boolean {
  const relative = path.slice(ROOT.length + 1);
  let current = ROOT;
  for (const segment of relative.split(/[\\/]/)) {
    if (!readdirSync(current).includes(segment)) return false;
    current = join(current, segment);
  }
  return existsSync(current);
}

describe('Phase 1 외부 배경 에셋', () => {
  it('필수 배경 AssetId 15개가 정확한 경로로 유지된다', () => {
    expect(Object.keys(REQUIRED_ASSETS)).toHaveLength(15);
    for (const [id, url] of Object.entries(REQUIRED_ASSETS)) {
      expect(EXTERNAL_ASSETS[id]).toBe(url);
    }
    expect(Object.keys(EXTERNAL_ASSETS).some((id) => id.startsWith('ui.'))).toBe(false);
  });

  it('모든 경로가 실제 대소문자와 일치하는 RGBA PNG를 가리킨다', () => {
    for (const url of Object.values(REQUIRED_ASSETS)) {
      const path = publicFile(url);
      expect(exactCaseExists(path), path).toBe(true);
      expect(pngInfo(path).colorType, path).toBe(6);
    }
  });

  it('지형과 건물 변형의 캔버스 규격이 각각 일치한다', () => {
    const terrain = Object.entries(REQUIRED_ASSETS)
      .filter(([id]) => id.startsWith('terrain.'))
      .map(([, url]) => pngInfo(publicFile(url)));
    const buildings = Object.entries(REQUIRED_ASSETS)
      .filter(([id]) => id.startsWith('building.'))
      .map(([, url]) => pngInfo(publicFile(url)));

    expect(new Set(terrain.map(({ width, height }) => `${width}x${height}`))).toEqual(
      new Set(['324x368']),
    );
    expect(new Set(buildings.map(({ width, height }) => `${width}x${height}`))).toEqual(
      new Set(['320x320']),
    );
  });

  it('소유 변형은 서로 다른 파일을 사용하고 전체 용량이 5MB 이하다', () => {
    const urls = Object.values(REQUIRED_ASSETS);
    expect(new Set(urls)).toHaveLength(15);
    const totalBytes = urls.reduce((sum, url) => sum + statSync(publicFile(url)).size, 0);
    expect(totalBytes).toBeLessThanOrEqual(5 * 1024 * 1024);

    for (const kind of ['capital', 'village', 'crown']) {
      const variants = Object.entries(REQUIRED_ASSETS)
        .filter(([id]) => id.startsWith(`building.${kind}.`))
        .map(([, url]) => url);
      expect(new Set(variants)).toHaveLength(variants.length);
      expect(new Set(variants.map((url) => dirname(url)))).toHaveLength(1);
    }
  });
});

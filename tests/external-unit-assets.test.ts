// 한 줄 목적: Phase 2A 보병 PNG 3개의 등록·투명도·정렬 규격·용량·fallback 범위를 검증한다
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { allAssetIds } from '../src/render/assets';
import { EXTERNAL_ASSETS } from '../src/render/external-assets';

const ROOT = resolve(import.meta.dirname, '..');
const REQUIRED_UNITS = {
  'unit.infantry.azure': './art/phase2a/units/infantry-azure.png',
  'unit.infantry.crimson': './art/phase2a/units/infantry-crimson.png',
  'unit.infantry.violet': './art/phase2a/units/infantry-violet.png',
} as const;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface DecodedPng {
  width: number;
  height: number;
  pixels: Buffer;
}

function publicFile(url: string): string {
  return join(ROOT, 'public', url.replace(/^\.\//, ''));
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

function decodeRgbaPng(path: string): DecodedPng {
  const file = readFileSync(path);
  expect(file.subarray(0, 8).equals(PNG_SIGNATURE), path).toBe(true);
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  expect(file[24], path).toBe(8);
  expect(file[25], path).toBe(6);

  const idat: Buffer[] = [];
  let offset = 8;
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') idat.push(file.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      let value = row[x];
      if (filter === 1) value = (value + left) & 0xff;
      else if (filter === 2) value = (value + up) & 0xff;
      else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) {
        const estimate = left + up - upperLeft;
        const pa = Math.abs(estimate - left);
        const pb = Math.abs(estimate - up);
        const pc = Math.abs(estimate - upperLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
        value = (value + predictor) & 0xff;
      } else {
        expect(filter, `${path} filter`).toBe(0);
      }
      pixels[y * stride + x] = value;
    }
  }
  return { width, height, pixels };
}

function alphaAt(png: DecodedPng, x: number, y: number): number {
  return png.pixels[(y * png.width + x) * 4 + 3];
}

describe('Phase 2A 외부 보병 에셋', () => {
  it('보병 3세력을 등록하고 나머지 병종은 fallback으로 유지한다', () => {
    expect(
      Object.fromEntries(
        Object.entries(EXTERNAL_ASSETS).filter(([id]) => id.startsWith('unit.')),
      ),
    ).toEqual(REQUIRED_UNITS);

    const forbidden = ['archer', 'cavalry', 'guardian', 'raider', 'crossbow'];
    for (const type of forbidden) {
      expect(Object.keys(EXTERNAL_ASSETS).some((id) => id.startsWith(`unit.${type}.`))).toBe(false);
    }
  });

  it('정본 AssetId와 정확한 대소문자 경로를 사용한다', () => {
    const canonical = new Set(allAssetIds());
    for (const [id, url] of Object.entries(REQUIRED_UNITS)) {
      expect(canonical.has(id as never), id).toBe(true);
      expect(exactCaseExists(publicFile(url)), url).toBe(true);
    }
    for (const id of Object.keys(EXTERNAL_ASSETS)) {
      expect(canonical.has(id as never), id).toBe(true);
    }
  });

  it('동일한 256px RGBA 캔버스와 투명한 네 모서리를 갖는다', () => {
    for (const url of Object.values(REQUIRED_UNITS)) {
      const png = decodeRgbaPng(publicFile(url));
      expect([png.width, png.height]).toEqual([256, 256]);
      expect(alphaAt(png, 0, 0)).toBe(0);
      expect(alphaAt(png, png.width - 1, 0)).toBe(0);
      expect(alphaAt(png, 0, png.height - 1)).toBe(0);
      expect(alphaAt(png, png.width - 1, png.height - 1)).toBe(0);
    }
  });

  it('세력별 내용이 다르고 신규 PNG 총용량이 1MB 이하다', () => {
    const paths = Object.values(REQUIRED_UNITS).map((url) => publicFile(url));
    const hashes = paths.map((path) =>
      createHash('sha256').update(readFileSync(path)).digest('hex'),
    );
    expect(new Set(hashes)).toHaveLength(3);
    expect(paths.reduce((sum, path) => sum + statSync(path).size, 0)).toBeLessThanOrEqual(
      1024 * 1024,
    );
  });

  it('Phase 1 지형·건물 15개 등록을 유지한다', () => {
    expect(
      Object.keys(EXTERNAL_ASSETS).filter(
        (id) => id.startsWith('terrain.') || id.startsWith('building.'),
      ),
    ).toHaveLength(15);
  });
});

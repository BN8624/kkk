// 한 줄 목적: dist 산출물을 itch.io 업로드용 ZIP으로 묶는다
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { platform } from 'node:os';

if (!existsSync('dist/index.html')) {
  console.error('dist가 없습니다. 먼저 npm run build를 실행하세요.');
  process.exit(1);
}

const out = resolve(process.env.ITCH_OUTPUT ?? 'three-crowns-island.zip');
mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });

if (platform() === 'win32') {
  execFileSync(
    'tar.exe',
    ['-a', '-cf', out, '-C', resolve('dist'), '.'],
    { stdio: 'inherit' },
  );
} else {
  execFileSync('zip', ['-q', '-r', out, '.'], { cwd: resolve('dist'), stdio: 'inherit' });
}

console.log(`생성 완료: ${out} (itch.io의 HTML 게임으로 업로드)`);

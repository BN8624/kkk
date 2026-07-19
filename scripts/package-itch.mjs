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
const dist = resolve('dist');
mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });

if (platform() === 'win32') {
  // Windows tar는 C:\ 경로를 원격 호스트로 오인할 수 있어 PowerShell Compress-Archive 사용
  const ps = [
    `$ErrorActionPreference='Stop'`,
    `Compress-Archive -Path (Join-Path '${dist.replace(/'/g, "''")}' '*') -DestinationPath '${out.replace(/'/g, "''")}' -Force`,
  ].join('; ');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-q', '-r', out, '.'], { cwd: dist, stdio: 'inherit' });
}

console.log(`생성 완료: ${out} (itch.io의 HTML 게임으로 업로드)`);

// 한 줄 목적: dist 산출물을 itch.io 업로드용 ZIP으로 묶는다
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';

if (!existsSync('dist/index.html')) {
  console.error('dist가 없습니다. 먼저 npm run build를 실행하세요.');
  process.exit(1);
}

const out = 'three-crowns-island.zip';
if (platform() === 'win32') {
  execSync(
    `powershell -NoProfile -Command "if (Test-Path '${out}') { Remove-Item '${out}' }; Compress-Archive -Path dist/* -DestinationPath '${out}'"`,
    { stdio: 'inherit' },
  );
} else {
  execSync(`rm -f ${out} && cd dist && zip -r ../${out} .`, { stdio: 'inherit', shell: '/bin/sh' });
}
console.log(`생성 완료: ${out} (itch.io에 HTML 게임으로 업로드)`);

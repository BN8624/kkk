// 한 줄 목적: 2.0 공개 배포용 ZIP·미디어·문서 예제·번들 보고서·SHA-256 체크섬을 재현 가능하게 생성한다
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { runAiTurn } from '../src/core/ai';
import { newGame } from '../src/core/game';
import { analyzeReplay } from '../src/core/analysis/replay-metrics';
import { reportMarkdown } from '../src/core/analysis/report';
import { buildReplayDocument, GAME_VERSION } from '../src/core/replay';
import { OFFICIAL_SCENARIOS } from '../src/core/scenario/official';
import { BACKUP_PRODUCT, type BackupDocumentV1 } from '../src/storage/backup';

const VERSION = '2.2.3';
const ROOT = resolve('.');
const OUTPUT = resolve('release');

if (GAME_VERSION !== VERSION) throw new Error(`게임 버전 불일치: ${GAME_VERSION}`);
if (relative(ROOT, OUTPUT) !== 'release') throw new Error('안전하지 않은 릴리스 출력 경로');
if (!statSync(resolve('dist/index.html')).isFile()) throw new Error('dist가 없습니다. 먼저 npm run build를 실행하세요.');

rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(OUTPUT, { recursive: true });

function writeJson(name: string, value: unknown): void {
  writeFileSync(join(OUTPUT, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

writeJson('official-scenarios-2.0.0.json', {
  product: BACKUP_PRODUCT,
  gameVersion: VERSION,
  schemaVersion: 1,
  scenarios: OFFICIAL_SCENARIOS,
});

writeJson('scenario-schema-example.json', {
  ...OFFICIAL_SCENARIOS[0],
  id: 'example-lightning-duel',
  title: 'Example: Lightning Duel',
  author: 'Three Crowns Island',
});

const backupExample: BackupDocumentV1 = {
  schemaVersion: 1,
  product: BACKUP_PRODUCT,
  createdAt: '2026-07-19T00:00:00.000Z',
  categories: ['preferences', 'progress', 'scenarios', 'replays'],
  localStorage: { 'three-crowns-locale': 'ko' },
  documents: {
    'campaign-progress': [],
    'scenario-drafts': [],
    'installed-scenarios': [],
    'editor-autosave': [],
    replays: [],
  },
};
writeJson('full-backup-example.json', backupExample);

const state = newGame(20260719, {
  scenario: 'three-crowns',
  humanFaction: 'azure',
  difficulty: 'normal',
});
for (let guard = 0; !state.over && guard < (state.maxTurns + 2) * 3; guard++) {
  runAiTurn(state, state.current);
}
if (!state.over) throw new Error('플레이테스트 예제 게임이 종료되지 않았습니다.');
const replay = buildReplayDocument(state, {
  replayId: 'release-playtest-example',
  createdAt: '2026-07-19T00:00:00.000Z',
});
if (!replay) throw new Error('플레이테스트 예제 리플레이를 만들지 못했습니다.');
const analysis = analyzeReplay(replay);
if (!analysis.ok) throw new Error(`플레이테스트 예제 분석 실패: ${analysis.reason}`);
writeFileSync(
  join(OUTPUT, 'playtest-report-example.md'),
  reportMarkdown([analysis.analysis], { description: '공개 예제' }),
  'utf8',
);

const media = [
  'docs/screenshot-ko.png',
  'docs/screenshot-en.png',
  'docs/hero.gif',
  'public/icon-192.png',
  'public/icon-512.png',
  'public/apple-touch-icon.png',
] as const;
for (const source of media) copyFileSync(resolve(source), join(OUTPUT, basename(source)));

const distFiles = filesUnder(resolve('dist')).map((path) => ({
  path: relative(resolve('dist'), path).split(sep).join('/'),
  bytes: statSync(path).size,
}));
writeJson('bundle-report.json', {
  gameVersion: VERSION,
  totalBytes: distFiles.reduce((sum, file) => sum + file.bytes, 0),
  files: distFiles.sort((a, b) => b.bytes - a.bytes),
});

const packageCommand = process.platform === 'win32'
  ? { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', 'npm run package:itch'] }
  : { file: 'npm', args: ['run', 'package:itch'] };
execFileSync(packageCommand.file, packageCommand.args, {
  stdio: 'inherit',
  env: { ...process.env, ITCH_OUTPUT: join(OUTPUT, `three-crowns-island-${VERSION}-itch.zip`) },
});

const checksumLines = filesUnder(OUTPUT)
  .filter((path) => basename(path) !== 'SHA256SUMS.txt')
  .sort()
  .map((path) => {
    const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
    return `${digest}  ${relative(OUTPUT, path).split(sep).join('/')}`;
  });
writeFileSync(join(OUTPUT, 'SHA256SUMS.txt'), `${checksumLines.join('\n')}\n`, 'utf8');

console.log(`릴리스 산출물 ${checksumLines.length}개 생성: ${OUTPUT}`);

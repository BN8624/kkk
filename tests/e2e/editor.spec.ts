// 한 줄 목적: 시나리오 제작실의 문서 생성→칠하기→유닛 배치→undo→검증→초안 저장 흐름을 검증한다
import { expect, test } from '@playwright/test';

interface EditorDoc {
  id: string;
  title: string;
  board: { tiles: { q: number; r: number; terrain: string; building?: string }[] };
  units: { faction: string; type: string; q: number; r: number }[];
}

/** 스펙 간 전역 선언 충돌을 피하기 위해 브리지 접근은 인라인 캐스트로 한다. */
interface EditorBridge {
  openEditor: () => void;
  editorDoc: () => EditorDoc | null;
  editorTap: (q: number, r: number) => void;
  state: () => { turn: number; over: boolean; config?: { mode: string } } | null;
  mode: () => string;
}
declare const window: { __tc?: Partial<EditorBridge> } & typeof globalThis;

test('에디터: 새 문서→칠하기→유닛 배치→undo→검증→초안 저장', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'three-crowns-settings',
      JSON.stringify({ soundOn: false, tutorialDone: true }),
    );
  });
  await page.goto('/');
  await page.waitForFunction(() => !!window.__tc?.openEditor);
  await page.evaluate(() => window.__tc!.openEditor!());
  await page.getByRole('button', { name: '빈 지도' }).click();
  await expect(page.locator('.ed-palette')).toBeVisible();

  // 숲 도구로 타일을 칠한다(입력 좌표 변환은 별개이므로 브리지 탭으로 도구 경로를 검증)
  await page.locator('[data-tool="forest"]').click();
  await page.evaluate(() => window.__tc!.editorTap!(2, 2));
  let doc = (await page.evaluate(() => window.__tc!.editorDoc!()))!;
  expect(doc.board.tiles.find((t) => t.q === 2 && t.r === 2)?.terrain).toBe('forest');

  // 수도 배치(소유: 청람)
  await page.locator('[data-tool="capital"]').click();
  await page.locator('[data-owner="azure"]').click();
  await page.evaluate(() => window.__tc!.editorTap!(1, 1));
  doc = (await page.evaluate(() => window.__tc!.editorDoc!()))!;
  expect(doc.board.tiles.find((t) => t.q === 1 && t.r === 1)?.building).toBe('capital');

  // 유닛 배치 → undo로 제거
  await page.locator('[data-tool="unit"]').click();
  await page.evaluate(() => window.__tc!.editorTap!(3, 3));
  doc = (await page.evaluate(() => window.__tc!.editorDoc!()))!;
  expect(doc.units).toHaveLength(1);
  await page.locator('#ed-undo').click();
  doc = (await page.evaluate(() => window.__tc!.editorDoc!()))!;
  expect(doc.units).toHaveLength(0);

  // 검증: 수도가 부족하므로 오류가 표시된다
  await page.locator('#ed-check').click();
  await expect(page.locator('.ed-sheet')).toHaveClass(/show/);
  await expect(page.locator('.ed-issue').first()).toBeVisible();
  await page.locator('#v-close').click();

  // 메뉴 → 초안 저장 → 나가기 → 홈 초안 목록에 나타난다
  await page.locator('#ed-menu').click();
  await page.locator('[data-m="save"]').click();
  await expect(page.locator('.toast')).toHaveClass(/show/);
  await page.locator('#ed-exit').click();
  await expect(page.locator('.rp-list .rp-item')).toHaveCount(1);

  // 초안 이어서 열기: 칠한 숲이 유지된다
  await page.locator('.rp-item [data-act="open"]').click();
  await expect(page.locator('.ed-palette')).toBeVisible();
  doc = (await page.evaluate(() => window.__tc!.editorDoc!()))!;
  expect(doc.board.tiles.find((t) => t.q === 2 && t.r === 2)?.terrain).toBe('forest');
});

test('에디터: 내장 복제→테스트 플레이→에디터 복귀 시 원본 유지', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'three-crowns-settings',
      JSON.stringify({ soundOn: false, tutorialDone: true, aiSpeed: 0 }),
    );
  });
  await page.goto('/');
  await page.waitForFunction(() => !!window.__tc?.openEditor);
  await page.evaluate(() => window.__tc!.openEditor!());
  await page.getByRole('button', { name: '세 왕관 전쟁 복제' }).click();
  await expect(page.locator('.ed-palette')).toBeVisible();
  const before = JSON.stringify(await page.evaluate(() => window.__tc!.editorDoc!()));

  // 메뉴 → 테스트 플레이: 실제 게임 엔진으로 시작된다
  await page.locator('#ed-menu').click();
  await page.locator('[data-m="test"]').click();
  await expect(page.locator('.tp-bar')).toBeVisible();
  await page.waitForFunction(() => {
    const s = window.__tc!.state!();
    return s !== null && s.config?.mode === 'custom';
  });

  // 목표 상태 시트(테스트 플레이 전용 검증 정보)
  await page.locator('#tp-objectives').click();
  await expect(page.locator('.tp-line').first()).toBeVisible();
  await page.locator('.ed-sheet .close-btn').click();

  // 에디터 복귀: 편집 원본이 게임 상태에 오염되지 않는다
  await page.locator('#tp-exit').click();
  await expect(page.locator('.ed-palette')).toBeVisible();
  const after = JSON.stringify(await page.evaluate(() => window.__tc!.editorDoc!()));
  expect(after).toBe(before);
  // 테스트 플레이는 일반 저장을 만들지 않는다
  const saved = await page.evaluate(() => localStorage.getItem('three-crowns-save'));
  expect(saved).toBeNull();
});

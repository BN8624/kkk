// 한 줄 목적: 실제 리플레이를 만든 뒤 플레이 분석 화면(단일·다중·보고서 버튼)이 정상 렌더링되는지 검증한다
import { expect, test, type Page } from '@playwright/test';

interface MinState {
  turn: number;
  over: boolean;
  winner?: string;
}

async function getState(page: Page): Promise<MinState> {
  const s = await page.evaluate(() => {
    const st = window.__tc?.state();
    return st ? { turn: st.turn, over: st.over, winner: st.winner } : null;
  });
  expect(s).toBeTruthy();
  return s as MinState;
}

/** 한 판을 끝까지 진행해 자동 저장 리플레이를 하나 만든다(연출 건너뛰기로 빠르게). */
async function playToEnd(page: Page): Promise<void> {
  for (let round = 0; round < 16; round++) {
    const state = await getState(page);
    if (state.over) break;
    await page.waitForFunction(() => !window.__tc!.busy(), undefined, { timeout: 60_000 });
    const turnBefore = (await getState(page)).turn;
    await page.getByRole('button', { name: '턴 종료' }).click();
    await page.waitForFunction(
      ([t]) => {
        const s = window.__tc?.state();
        return s !== null && s !== undefined && (s.turn > t || s.over);
      },
      [turnBefore] as const,
      { timeout: 120_000 },
    );
  }
  expect((await getState(page)).over).toBe(true);
}

test('플레이 분석: 리플레이 생성 후 단일·다중 분석과 보고서 버튼이 표시된다', async ({ page }) => {
  test.setTimeout(360_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'three-crowns-settings',
      JSON.stringify({ soundOn: false, tutorialDone: true, aiSpeed: 0 }),
    );
  });
  await page.goto('/?seed=20260719');
  await page.getByRole('button', { name: '빠른 전투' }).click();
  await page.getByRole('button', { name: '이 왕국으로 시작' }).click();
  await page.waitForFunction(() => window.__tc?.state() !== null);
  await playToEnd(page);

  // 결과 화면 → 타이틀로
  await expect(page.locator('.result-word')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '타이틀로' }).click();
  await expect(page.locator('.overlay h1')).toHaveText('세 왕관의 섬');

  // 플레이 분석 진입: 방금 만든 리플레이 한 판이 목록에 있다
  await page.getByRole('button', { name: '플레이 분석' }).click();
  await expect(page.locator('.rp-list .rp-item')).toHaveCount(1);

  // 단일 분석: 요약·조언·턴별 사건이 렌더링된다
  await page.locator('.rp-item [data-act="open"]').click();
  await expect(page.getByText('턴별 주요 사건')).toBeVisible();
  await expect(page.locator('.an-ev')).not.toHaveCount(0);
  // 보고서 내보내기 버튼 3종이 있다
  await expect(page.getByRole('button', { name: 'JSON' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Markdown' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'CSV' })).toBeVisible();

  // 뒤로 → 전체 분석(다중): 승률 요약이 보인다
  await page.getByRole('button', { name: '뒤로' }).click();
  await page.getByRole('button', { name: '전체 분석' }).click();
  await expect(page.getByText('전적 분석')).toBeVisible();
  await expect(page.getByText('승 / 패 / 무')).toBeVisible();
});

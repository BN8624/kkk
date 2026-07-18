// 한 줄 목적: 모바일 뷰포트에서 시작→선택→이동→공격→턴 종료→저장→이어하기 핵심 흐름을 검증한다
import { expect, test, type Page } from '@playwright/test';

interface TcState {
  turn: number;
  current: string;
  over: boolean;
  units: { id: number; faction: string; q: number; r: number; hp: number; moved: boolean; attacked: boolean }[];
  tiles: { q: number; r: number; terrain: string; building?: string; owner?: string }[];
  factions: Record<string, { gold: number }>;
}

declare global {
  interface Window {
    __tc?: {
      state: () => TcState | null;
      busy: () => boolean;
      screenPos: (q: number, r: number) => { x: number; y: number } | undefined;
      dests: () => { q: number; r: number }[];
      targets: (id: number) => { id: number; q: number; r: number }[];
    };
  }
}

async function getState(page: Page): Promise<TcState> {
  const s = await page.evaluate(() => window.__tc?.state());
  expect(s).toBeTruthy();
  return s as TcState;
}

async function waitIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__tc && !window.__tc.busy(), undefined, {
    timeout: 60_000,
  });
}

async function tapHex(page: Page, q: number, r: number): Promise<void> {
  const pos = await page.evaluate(([qq, rr]) => window.__tc!.screenPos(qq, rr), [q, r] as const);
  expect(pos).toBeTruthy();
  await page.touchscreen.tap(pos!.x, pos!.y);
}

async function startNewGame(page: Page, seed: number): Promise<void> {
  // 튜토리얼 배너가 탭 좌표를 가리지 않도록 완료 상태로 시작한다
  await page.addInitScript(() => {
    localStorage.setItem(
      'three-crowns-settings',
      JSON.stringify({ soundOn: false, tutorialDone: true }),
    );
  });
  await page.goto(`/?seed=${seed}`);
  await page.getByRole('button', { name: '새 게임' }).click();
  await page.waitForFunction(() => window.__tc?.state() !== null);
}

test('시작→유닛 선택→이동→턴 종료→저장→이어하기', async ({ page }) => {
  await startNewGame(page, 42);
  let state = await getState(page);
  expect(state.turn).toBe(1);
  expect(state.units.length).toBe(6);

  // 유닛 선택
  const unit = state.units.find((u) => u.faction === 'player')!;
  await tapHex(page, unit.q, unit.r);
  await expect(page.locator('.unit-panel')).toHaveClass(/show/);

  // 이동: 강조된 목적지 중 하나로
  const dests = await page.evaluate(() => window.__tc!.dests());
  expect(dests.length).toBeGreaterThan(0);
  const dest = dests[0];
  await tapHex(page, dest.q, dest.r);
  await page.waitForFunction(
    ([id]) => {
      const s = window.__tc?.state();
      return s?.units.find((u) => u.id === id)?.moved === true;
    },
    [unit.id] as const,
  );
  await waitIdle(page);
  state = await getState(page);
  const moved = state.units.find((u) => u.id === unit.id)!;
  expect(moved.q).toBe(dest.q);
  expect(moved.r).toBe(dest.r);

  // 턴 종료 → AI 두 세력 진행 → 2턴 시작
  await page.getByRole('button', { name: '턴 종료' }).click();
  await page.waitForFunction(() => window.__tc?.state()?.turn === 2, undefined, {
    timeout: 60_000,
  });
  await waitIdle(page);

  // 저장 확인 후 새로고침 → 이어하기
  const saved = await page.evaluate(() => localStorage.getItem('three-crowns-save'));
  expect(saved).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '이어하기' }).click();
  await page.waitForFunction(() => window.__tc?.state()?.turn === 2);
  state = await getState(page);
  expect(state.turn).toBe(2);
  expect(state.units.length).toBeGreaterThan(0);
});

test('생산: 수도에서 보병을 생산하면 금이 줄고 유닛이 늘어난다', async ({ page }) => {
  await startNewGame(page, 7);
  const state = await getState(page);
  const capital = state.tiles.find((t) => t.building === 'capital' && t.owner === 'player')!;
  await tapHex(page, capital.q, capital.r);
  await expect(page.locator('.sheet')).toHaveClass(/show/);
  const goldBefore = state.factions.player.gold;
  await page.locator('.prod-card[data-type="infantry"]').click();
  await page.waitForFunction(
    ([g]) => {
      const s = window.__tc?.state();
      return s !== null && s !== undefined && s.factions.player.gold < g;
    },
    [goldBefore] as const,
  );
  const after = await getState(page);
  expect(after.units.filter((u) => u.faction === 'player').length).toBe(3);
});

function hexDist(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

test('전투: 적에게 접근해 공격하면 피해가 적용된다', async ({ page }) => {
  await startNewGame(page, 42);
  let attacked = false;

  for (let round = 0; round < 8 && !attacked; round++) {
    await waitIdle(page);
    let state = await getState(page);
    if (state.over) break;

    for (const u of state.units.filter((x) => x.faction === 'player')) {
      state = await getState(page);
      if (state.over) break;
      const live = state.units.find((x) => x.id === u.id);
      if (!live) continue;

      const targets = await page.evaluate((id) => window.__tc!.targets(id), u.id);
      if (targets.length > 0) {
        const target = targets[0];
        const before = state.units.find((x) => x.id === target.id)!;
        await tapHex(page, live.q, live.r);
        await tapHex(page, target.q, target.r);
        await page.waitForFunction(
          ([tid, hp]) => {
            const s = window.__tc?.state();
            const t = s?.units.find((x) => x.id === tid);
            return !t || t.hp < hp;
          },
          [target.id, before.hp] as const,
          { timeout: 20_000 },
        );
        attacked = true;
        break;
      }

      // 가장 가까운 적 방향으로 전진
      const enemies = state.units.filter((x) => x.faction !== 'player');
      if (enemies.length === 0) break;
      await tapHex(page, live.q, live.r);
      await page.waitForFunction(() => window.__tc!.dests().length >= 0);
      const dests = await page.evaluate(() => window.__tc!.dests());
      if (dests.length === 0) continue;
      const nearest = enemies.reduce((a, b) => (hexDist(live, a) <= hexDist(live, b) ? a : b));
      const dest = dests.reduce((a, b) => (hexDist(a, nearest) <= hexDist(b, nearest) ? a : b));
      await tapHex(page, dest.q, dest.r);
      await page.waitForFunction(
        ([id]) => {
          const s = window.__tc?.state();
          return s !== null && s !== undefined && s.units.find((x) => x.id === id)?.moved === true;
        },
        [u.id] as const,
        { timeout: 20_000 },
      );
      await waitIdle(page);

      // 이동 후 사거리에 적이 들어왔으면 즉시 공격
      const afterTargets = await page.evaluate((id) => window.__tc!.targets(id), u.id);
      if (afterTargets.length > 0) {
        const target = afterTargets[0];
        const cur = (await getState(page)).units.find((x) => x.id === target.id)!;
        const pos = (await getState(page)).units.find((x) => x.id === u.id)!;
        await tapHex(page, pos.q, pos.r);
        await tapHex(page, target.q, target.r);
        await page.waitForFunction(
          ([tid, hp]) => {
            const s = window.__tc?.state();
            const t = s?.units.find((x) => x.id === tid);
            return !t || t.hp < hp;
          },
          [target.id, cur.hp] as const,
          { timeout: 20_000 },
        );
        attacked = true;
        break;
      }
    }

    if (!attacked) {
      const before = (await getState(page)).turn;
      await page.getByRole('button', { name: '턴 종료' }).click();
      await page.waitForFunction(
        ([t]) => {
          const s = window.__tc?.state();
          return s !== null && s !== undefined && (s.turn > t || s.over);
        },
        [before] as const,
        { timeout: 60_000 },
      );
    }
  }
  expect(attacked).toBe(true);
});

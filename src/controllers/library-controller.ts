// 한 줄 목적: 일일 도전·기록·커스텀 시나리오 목록 화면과 커스텀 시나리오 플레이 진입을 담당한다
import { dailyChallenge, MODIFIERS, todayKey } from '../core/daily';
import { DIFFICULTY_NAMES, FACTION_NAMES } from '../core/data';
import { newGame, newGameFromScenario } from '../core/game';
import { loadRecords } from '../core/records';
import { normalizeScenario } from '../core/scenario/normalize';
import { isPlayable, validateScenario } from '../core/scenario/validate';
import type { ScenarioDocumentV1 } from '../core/scenario/types';
import { SCENARIO_IDS, SCENARIOS } from '../core/scenarios';
import type { GameState } from '../core/types';
import { loadDraftItems } from '../editor/drafts';
import { documentStore } from '../storage/idb';
import { showCustomScenarioListScreen } from '../ui/editor';
import { showDailyScreen, showRecordsScreen } from '../ui/title';
import type { AppContext } from '../app/app-shell';
import type { AppController } from '../app/lifecycle';
import type { LibraryFlow } from '../app/navigation';

export class LibraryController implements AppController, LibraryFlow {
  constructor(private ctx: AppContext) {}

  showDaily(): void {
    this.ctx.enterMode('daily');
    const ch = dailyChallenge(todayKey());
    const records = loadRecords();
    const today = records.daily?.dateKey === ch.dateKey ? records.daily : null;
    const lines = [
      { label: '시나리오', value: SCENARIOS[ch.scenario].name },
      { label: '왕국', value: FACTION_NAMES[ch.faction] },
      { label: '난이도', value: DIFFICULTY_NAMES[ch.difficulty] },
      {
        label: '수정자',
        value: ch.modifier ? MODIFIERS[ch.modifier].name : '없음',
      },
      ...(ch.modifier ? [{ label: '효과', value: MODIFIERS[ch.modifier].description }] : []),
      ...(today
        ? [
            { label: '오늘 최고 점수', value: `${today.bestScore}점` },
            { label: '오늘 결과', value: today.won ? '승리' : '미승리' },
          ]
        : []),
    ];
    showDailyScreen(this.ctx.overlay, {
      title: `${ch.dateKey.slice(0, 4)}년 ${ch.dateKey.slice(4, 6)}월 ${ch.dateKey.slice(6, 8)}일 — 모두 같은 전장에서 겨룹니다`,
      lines,
      note: '기록은 이 브라우저에만 저장됩니다 (서버 없음)',
      startLabel: today ? '다시 도전' : '도전 시작',
      onStart: () => {
        const state = newGame(ch.seed, {
          mode: 'daily',
          scenario: ch.scenario,
          humanFaction: ch.faction,
          difficulty: ch.difficulty,
          modifier: ch.modifier,
        });
        this.ctx.nav.launch(state);
      },
      onBack: () => this.ctx.nav.toTitle(),
    });
  }

  showRecords(): void {
    this.ctx.enterMode('records');
    const r = loadRecords();
    const lines = [
      { label: '전체 플레이', value: `${r.plays}판` },
      {
        label: '왕국별 승리',
        value: `${r.winsByFaction.azure} · ${r.winsByFaction.crimson} · ${r.winsByFaction.violet}`,
      },
      {
        label: '난이도별 승리',
        value: `쉬움 ${r.winsByDifficulty.easy} · 보통 ${r.winsByDifficulty.normal} · 어려움 ${r.winsByDifficulty.hard}`,
      },
      ...SCENARIO_IDS.map((id) => ({
        label: `${SCENARIOS[id].name} 최고`,
        value: r.bestScoreByScenario[id] !== undefined ? `${r.bestScoreByScenario[id]}점` : '-',
      })),
      { label: '최단 승리', value: r.fastestWinTurns !== null ? `${r.fastestWinTurns}턴` : '-' },
      { label: '최다 점령', value: `${r.maxCaptured}곳` },
      { label: '최다 처치', value: `${r.maxKills}기` },
      {
        label: '오늘 일일 도전',
        value: r.daily?.dateKey === todayKey() ? `${r.daily.bestScore}점 (완료)` : '미완료',
      },
    ];
    showRecordsScreen(this.ctx.overlay, lines, () => this.ctx.nav.toTitle());
  }

  /** 커스텀 시나리오 보관함: 저장된 초안을 일반 게임으로 플레이한다. */
  async showCustomScenarios(): Promise<void> {
    const token = this.ctx.enterMode('scenarios');
    this.ctx.overlay.show('<p class="subtitle">불러오는 중…</p>');
    const drafts = await loadDraftItems();
    if (!token.alive) return;
    showCustomScenarioListScreen(this.ctx.overlay, drafts, {
      onPlay: (id) => void this.playCustomScenario(id),
      onBack: () => this.ctx.nav.toTitle(),
    });
  }

  private async playCustomScenario(id: string): Promise<void> {
    const token = this.ctx.currentToken();
    const rec = await documentStore()
      .get<ScenarioDocumentV1>('scenario-drafts', id)
      .catch(() => null);
    if (!token.alive) return;
    const doc = rec?.data;
    if (!doc) {
      this.ctx.hud.toast('시나리오를 불러오지 못했습니다');
      return;
    }
    if (!isPlayable(validateScenario(doc))) {
      this.ctx.hud.toast('검증 오류가 있습니다 — 제작실에서 확인하세요');
      return;
    }
    let state: GameState;
    try {
      state = newGameFromScenario(Date.now() >>> 0, normalizeScenario(doc), {
        mode: 'custom',
        difficulty: 'normal',
      });
    } catch {
      this.ctx.hud.toast('시나리오를 시작할 수 없습니다 — 제작실에서 검증을 확인하세요');
      return;
    }
    this.ctx.nav.launch(state);
  }

  dispose(): void {}
}

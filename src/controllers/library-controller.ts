// 한 줄 목적: 일일 도전·기록·커스텀 시나리오 목록 화면과 커스텀 시나리오 플레이 진입을 담당한다
import { dailyChallenge, todayKey } from '../core/daily';
import { newGame, newGameFromScenario } from '../core/game';
import { loadRecords } from '../core/records';
import { normalizeScenario } from '../core/scenario/normalize';
import { OFFICIAL_SCENARIOS, officialScenarioById } from '../core/scenario/official';
import { isPlayable, validateScenario } from '../core/scenario/validate';
import type { ScenarioDocumentV1 } from '../core/scenario/types';
import { SCENARIO_IDS } from '../core/scenarios';
import type { GameState } from '../core/types';
import { loadDraftItems } from '../editor/drafts';
import { documentStore } from '../storage/idb';
import { showCustomScenarioListScreen } from '../ui/editor';
import { showDailyScreen, showRecordsScreen } from '../ui/title';
import type { AppContext } from '../app/app-shell';
import type { AppController } from '../app/lifecycle';
import type { LibraryFlow } from '../app/navigation';
import {
  difficultyName,
  factionName,
  modifierDescription,
  modifierName,
  officialScenarioText,
  scenarioName,
  t,
} from '../i18n';

export class LibraryController implements AppController, LibraryFlow {
  constructor(private ctx: AppContext) {}

  showDaily(): void {
    this.ctx.enterMode('daily');
    const ch = dailyChallenge(todayKey());
    const records = loadRecords();
    const today = records.daily?.dateKey === ch.dateKey ? records.daily : null;
    const lines = [
      { label: t('daily.scenario'), value: scenarioName(ch.scenario) },
      { label: t('daily.kingdom'), value: factionName(ch.faction) },
      { label: t('daily.difficulty'), value: difficultyName(ch.difficulty) },
      {
        label: t('daily.modifier'),
        value: ch.modifier ? modifierName(ch.modifier) : t('daily.none'),
      },
      ...(ch.modifier
        ? [{ label: t('daily.effect'), value: modifierDescription(ch.modifier) }]
        : []),
      ...(today
        ? [
            { label: t('daily.bestToday'), value: t('format.points', { n: today.bestScore }) },
            { label: t('daily.resultToday'), value: today.won ? t('result.win') : t('daily.notWon') },
          ]
        : []),
    ];
    showDailyScreen(this.ctx.overlay, {
      title: t('daily.dateTitle', {
        year: ch.dateKey.slice(0, 4),
        month: ch.dateKey.slice(4, 6),
        day: ch.dateKey.slice(6, 8),
      }),
      lines,
      note: t('daily.localNote'),
      startLabel: today ? t('daily.retry') : t('daily.start'),
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
      { label: t('records.totalPlays'), value: t('format.games', { n: r.plays }) },
      {
        label: t('records.winsByFaction'),
        value: `${r.winsByFaction.azure} · ${r.winsByFaction.crimson} · ${r.winsByFaction.violet}`,
      },
      {
        label: t('records.winsByDifficulty'),
        value: t('records.difficultyWins', {
          easy: r.winsByDifficulty.easy,
          normal: r.winsByDifficulty.normal,
          hard: r.winsByDifficulty.hard,
        }),
      },
      ...SCENARIO_IDS.map((id) => ({
        label: t('records.scenarioBest', { scenario: scenarioName(id) }),
        value:
          r.bestScoreByScenario[id] !== undefined
            ? t('format.points', { n: r.bestScoreByScenario[id] })
            : '-',
      })),
      {
        label: t('records.fastestWin'),
        value: r.fastestWinTurns !== null ? t('format.turns', { n: r.fastestWinTurns }) : '-',
      },
      { label: t('records.mostCaptured'), value: t('format.places', { n: r.maxCaptured }) },
      { label: t('records.mostKills'), value: t('format.units', { n: r.maxKills }) },
      {
        label: t('records.dailyToday'),
        value:
          r.daily?.dateKey === todayKey()
            ? t('records.completed', { score: r.daily.bestScore })
            : t('records.incomplete'),
      },
    ];
    showRecordsScreen(this.ctx.overlay, lines, () => this.ctx.nav.toTitle());
  }

  /** 커스텀 시나리오 보관함: 공식 전장·내 전장·가져온 전장을 구분해 표시하고 플레이한다. */
  async showCustomScenarios(): Promise<void> {
    const token = this.ctx.enterMode('scenarios');
    this.ctx.overlay.show(`<p class="subtitle">${t('library.loading')}</p>`);
    const drafts = await loadDraftItems();
    if (!token.alive) return;
    const officials = OFFICIAL_SCENARIOS.map((s) => ({
      id: s.id,
      title: officialScenarioText(s.id, 'title', s.title),
      description: officialScenarioText(s.id, 'description', s.description),
      recommended: t('library.recommended', {
        faction: factionName(s.metadata!.recommendedFaction!),
        difficulty: difficultyName(s.metadata!.recommendedDifficulty!),
        minutes: s.metadata!.estimatedMinutes!,
      }),
    }));
    showCustomScenarioListScreen(
      this.ctx.overlay,
      {
        officials,
        mine: drafts.filter((d) => !d.imported),
        imported: drafts.filter((d) => d.imported),
      },
      {
        onPlay: (id) => void this.playCustomScenario(id),
        onPlayOfficial: (id) => this.playOfficialScenario(id),
        onCloneOfficial: (id) => {
          const doc = officialScenarioById(id);
          if (doc) this.ctx.editorFlow.openCloneOf(doc);
        },
        onBack: () => this.ctx.nav.toTitle(),
      },
    );
  }

  /** 공식 전장을 일반 게임으로 플레이한다(문서는 코드에 내장된 검증 완료본이다). */
  private playOfficialScenario(id: string): void {
    const doc = officialScenarioById(id);
    if (!doc) {
      this.ctx.hud.toast(t('library.officialNotFound'));
      return;
    }
    let state: GameState;
    try {
      state = newGameFromScenario(Date.now() >>> 0, normalizeScenario(doc), {
        mode: 'custom',
        difficulty: doc.metadata?.recommendedDifficulty ?? 'normal',
      });
    } catch {
      this.ctx.hud.toast(t('library.startFailed'));
      return;
    }
    this.ctx.nav.launch(state);
  }

  private async playCustomScenario(id: string): Promise<void> {
    const token = this.ctx.currentToken();
    const rec = await documentStore()
      .get<ScenarioDocumentV1>('scenario-drafts', id)
      .catch(() => null);
    if (!token.alive) return;
    const doc = rec?.data;
    if (!doc) {
      this.ctx.hud.toast(t('library.loadFailed'));
      return;
    }
    if (!isPlayable(validateScenario(doc))) {
      this.ctx.hud.toast(t('library.validationFailed'));
      return;
    }
    let state: GameState;
    try {
      state = newGameFromScenario(Date.now() >>> 0, normalizeScenario(doc), {
        mode: 'custom',
        difficulty: 'normal',
      });
    } catch {
      this.ctx.hud.toast(t('library.startValidationFailed'));
      return;
    }
    this.ctx.nav.launch(state);
  }

  dispose(): void {}
}

// 한 줄 목적: 플레이 분석 연구실 — 리플레이 선택·필터·청크 분석(취소 가능)·결과 화면·보고서 내보내기를 담당한다
import { aggregateAnalyses } from '../core/analysis/aggregate';
import { coachAggregate, coachSingleGame } from '../core/analysis/coaching';
import { analyzeReplay, type ReplayAnalysis } from '../core/analysis/replay-metrics';
import { reportCsv, reportJson, reportMarkdown, type ReportFilters } from '../core/analysis/report';
import { missionByScenarioId } from '../core/campaign/missions';
import { loadCampaignProgress } from '../core/campaign/progress';
import { REPLAY_MAX_IMPORT_BYTES, upgradeStoredReplay, type ReplayDocument } from '../core/replay';
import { checkReplayCompatibility } from '../core/replay-compat';
import { decodeReplayDocument } from '../core/replay-decode';
import {
  difficultyName,
  factionName,
  localizedScenarioName,
  replayCompatibilityReason,
  t,
} from '../i18n';
import { defectTagLabel } from '../ui/replay';
import { documentStore } from '../storage/idb';
import {
  showAnalysisListScreen,
  showAnalysisProgressScreen,
  showMultiAnalysisScreen,
  showSingleAnalysisScreen,
  type AnalysisFilterState,
  type AnalysisListItem,
} from '../ui/analysis';
import type { AppContext } from '../app/app-shell';
import type { AppController } from '../app/lifecycle';

interface LoadedReplay {
  id: string;
  doc: ReplayDocument;
}

function modeName(mode: string): string {
  switch (mode) {
    case 'quick':
    case 'daily':
    case 'campaign':
    case 'custom':
      return t(`analysis.mode.${mode}`);
    default:
      return mode;
  }
}

function download(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export class AnalysisController implements AppController {
  private loaded: LoadedReplay[] = [];
  private selected = new Set<string>();
  private filters: AnalysisFilterState = { mode: 'all', faction: 'all', difficulty: 'all', scenario: 'all' };
  private analysisCache = new Map<string, ReplayAnalysis>();

  constructor(private ctx: AppContext) {}

  async showLab(): Promise<void> {
    const token = this.ctx.enterMode('analysis');
    this.ctx.overlay.show(`<p class="subtitle">${t('library.loading')}</p>`);
    this.loaded = [];
    try {
      const summaries = await documentStore().list('replays');
      for (const s of summaries) {
        const rec = await documentStore().get<ReplayDocument>('replays', s.id);
        const doc = upgradeStoredReplay(rec?.data);
        if (doc) this.loaded.push({ id: s.id, doc });
      }
    } catch {
      /* 저장소 접근 실패: 빈 목록 */
    }
    this.loaded.sort((a, b) => (a.doc.createdAt < b.doc.createdAt ? 1 : -1));
    if (!token.alive) return;
    this.renderList();
  }

  private filtered(): LoadedReplay[] {
    return this.loaded.filter(({ doc }) => {
      const c = doc.initialConfig;
      if (this.filters.mode !== 'all' && c.mode !== this.filters.mode) return false;
      if (this.filters.faction !== 'all' && c.humanFaction !== this.filters.faction) return false;
      if (this.filters.difficulty !== 'all' && c.difficulty !== this.filters.difficulty) return false;
      if (this.filters.scenario !== 'all' && c.scenario !== this.filters.scenario) return false;
      return true;
    });
  }

  private filterDescription(): string {
    const parts: string[] = [];
    if (this.filters.mode !== 'all')
      parts.push(`${t('analysis.filter.mode')}: ${modeName(this.filters.mode)}`);
    if (this.filters.faction !== 'all')
      parts.push(`${t('analysis.filter.faction')}: ${factionName(this.filters.faction)}`);
    if (this.filters.difficulty !== 'all')
      parts.push(
        `${t('analysis.filter.difficulty')}: ${difficultyName(this.filters.difficulty)}`,
      );
    if (this.filters.scenario !== 'all')
      parts.push(`${t('analysis.filter.scenario')}: ${this.filters.scenario}`);
    return parts.length > 0 ? parts.join(' · ') : t('analysis.all');
  }

  private renderList(): void {
    const list = this.filtered();
    const items: AnalysisListItem[] = list.map(({ id, doc }) => {
      const me = doc.initialConfig.humanFaction;
      const tag = doc.evaluation?.defectTag;
      return {
        id,
        title: localizedScenarioName(
          doc.initialConfig.scenario,
          doc.scenario.title || doc.initialConfig.scenario,
        ),
        sub: t('analysis.listSub', {
          faction: factionName(me),
          difficulty: difficultyName(doc.initialConfig.difficulty),
          mode: modeName(doc.initialConfig.mode),
          turns: doc.result.turns,
          score: doc.result.score,
        }),
        outcome:
          doc.result.winner === me ? 'win' : doc.result.winner === 'draw' ? 'draw' : 'lose',
        selected: this.selected.has(id),
        ...(tag ? { defectLabel: defectTagLabel(tag) } : {}),
      };
    });
    const scenarioOptions = [...new Map(this.loaded.map(({ doc }) => [doc.initialConfig.scenario, localizedScenarioName(doc.initialConfig.scenario, doc.scenario.title || doc.initialConfig.scenario)])).entries()].map(
      ([id, name]) => ({ id, name }),
    );
    showAnalysisListScreen(this.ctx.overlay, items, this.filters, scenarioOptions, {
      onToggle: (id) => {
        if (this.selected.has(id)) this.selected.delete(id);
        else this.selected.add(id);
        this.renderList();
      },
      onOpenSingle: (id) => void this.openSingle(id),
      onAnalyzeSelected: () => void this.analyzeMany(),
      onFilterChange: (patch) => {
        Object.assign(this.filters, patch);
        this.renderList();
      },
      onImport: (file) => void this.importAndAnalyze(file),
      onBack: () => this.ctx.nav.toTitle(),
    });
  }

  /** 캐시를 사용한 단일 분석(무거운 재실행은 판당 1회). */
  private analysisOf(id: string, doc: ReplayDocument): ReplayAnalysis | null {
    const cached = this.analysisCache.get(id);
    if (cached) return cached;
    const r = analyzeReplay(doc);
    if (!r.ok) return null;
    this.analysisCache.set(id, r.analysis);
    return r.analysis;
  }

  private async openSingle(id: string): Promise<void> {
    const entry = this.loaded.find((x) => x.id === id);
    if (!entry) return;
    const analysis = this.analysisOf(id, entry.doc);
    if (!analysis) {
      this.ctx.hud.toast(t('analysis.notSupported'));
      return;
    }
    this.showSingle(entry.doc, analysis);
  }

  private campaignNote(analysis: ReplayAnalysis): string | null {
    if (analysis.config.mode !== 'campaign') return null;
    const found = missionByScenarioId(analysis.config.scenario);
    if (!found) return null;
    const progress = loadCampaignProgress().missions[found.mission.id];
    if (!progress) return null;
    const parts = [
      t('analysis.campaignAttempts', { n: progress.attempts ?? '-' }),
      t('analysis.campaignBest', {
        stars: progress.bestStars > 0 ? '★'.repeat(progress.bestStars) : t('analysis.noStars'),
      }),
    ];
    if (progress.bestScore > 0) {
      const diff = analysis.score - progress.bestScore;
      parts.push(
        diff >= 0
          ? t('analysis.tiedBest', { score: progress.bestScore })
          : t('analysis.toBest', { score: -diff }),
      );
    }
    return t('analysis.campaignRecord', { details: parts.join(' · ') });
  }

  private showSingle(doc: ReplayDocument, analysis: ReplayAnalysis): void {
    this.ctx.enterMode('analysis');
    const tag = doc.evaluation?.defectTag ?? analysis.defectTag;
    showSingleAnalysisScreen(
      this.ctx.overlay,
      analysis,
      coachSingleGame(analysis),
      this.campaignNote(analysis),
      {
        onOpenTurn: (turn) => this.ctx.replays.openPlaybackAtTurn(doc, turn),
        onExport: (format) => this.export([analysis], format),
        onBack: () => this.renderList(),
      },
      tag ? defectTagLabel(tag) : null,
    );
  }

  /** 선택(없으면 필터 전체)을 청크로 분석한다. 화면 이탈·취소 시 즉시 중단한다. */
  private async analyzeMany(): Promise<void> {
    const source = this.filtered().filter(
      ({ id }) => this.selected.size === 0 || this.selected.has(id),
    );
    if (source.length === 0) return;
    const token = this.ctx.currentToken();
    let canceled = false;
    const analyses: ReplayAnalysis[] = [];
    let skipped = 0;
    for (let i = 0; i < source.length; i++) {
      if (!token.alive || canceled) return;
      showAnalysisProgressScreen(this.ctx.overlay, i, source.length, () => {
        canceled = true;
        this.renderList();
      });
      // 메인 스레드 양보(모바일 UI 멈춤 방지)
      await new Promise((r) => setTimeout(r, 0));
      if (!token.alive || canceled) return;
      const a = this.analysisOf(source[i].id, source[i].doc);
      if (a) analyses.push(a);
      else skipped++;
    }
    if (!token.alive || canceled) return;
    if (analyses.length === 0) {
      this.ctx.hud.toast(t('analysis.noneAvailable'));
      this.renderList();
      return;
    }
    if (skipped > 0) this.ctx.hud.toast(t('analysis.skipped', { n: skipped }));
    const agg = aggregateAnalyses(analyses);
    showMultiAnalysisScreen(this.ctx.overlay, agg, coachAggregate(agg), {
      onExport: (format) => this.export(analyses, format),
      onBack: () => this.renderList(),
    });
  }

  /** 외부 리플레이 파일을 보관하지 않고 분석만 한다. */
  private async importAndAnalyze(file: File): Promise<void> {
    if (file.size > REPLAY_MAX_IMPORT_BYTES) {
      this.ctx.hud.toast(t('replay.fileTooLarge'));
      return;
    }
    const token = this.ctx.currentToken();
    const text = await file.text().catch(() => null);
    if (!token.alive) return;
    const decoded = decodeReplayDocument(text ?? '');
    if (!decoded.ok) {
      this.ctx.hud.toast(t('replay.invalidFormat'));
      return;
    }
    const compat = checkReplayCompatibility(decoded.value);
    if (compat.compatibility === 'unsupported') {
      this.ctx.hud.toast(replayCompatibilityReason(compat));
      return;
    }
    const doc = compat.migrated ?? decoded.value;
    const r = analyzeReplay(doc);
    if (!r.ok) {
      this.ctx.hud.toast(t('analysis.failed', { reason: r.reason }));
      return;
    }
    this.showSingle(doc, r.analysis);
  }

  private export(analyses: ReplayAnalysis[], format: 'json' | 'md' | 'csv'): void {
    const filters: ReportFilters = { description: this.filterDescription() };
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      download(`playtest-report-${stamp}.json`, reportJson(analyses, filters), 'application/json');
    } else if (format === 'md') {
      download(`playtest-report-${stamp}.md`, reportMarkdown(analyses, filters), 'text/markdown');
    } else {
      download(`playtest-report-${stamp}.csv`, reportCsv(analyses), 'text/csv');
    }
  }

  dispose(): void {
    this.loaded = [];
    this.analysisCache.clear();
  }
}

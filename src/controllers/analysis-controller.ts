// 한 줄 목적: 플레이 분석 연구실 — 리플레이 선택·필터·청크 분석(취소 가능)·결과 화면·보고서 내보내기를 담당한다
import { aggregateAnalyses } from '../core/analysis/aggregate';
import { coachAggregate, coachSingleGame } from '../core/analysis/coaching';
import { analyzeReplay, type ReplayAnalysis } from '../core/analysis/replay-metrics';
import { reportCsv, reportJson, reportMarkdown, type ReportFilters } from '../core/analysis/report';
import { missionByScenarioId } from '../core/campaign/missions';
import { loadCampaignProgress } from '../core/campaign/progress';
import { DIFFICULTY_NAMES, FACTION_NAMES } from '../core/data';
import { REPLAY_MAX_IMPORT_BYTES, type ReplayDocumentV1 } from '../core/replay';
import { checkReplayCompatibility } from '../core/replay-compat';
import { decodeReplayDocument } from '../core/replay-decode';
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
  doc: ReplayDocumentV1;
}

const MODE_NAMES: Record<string, string> = {
  quick: '빠른 전투',
  daily: '일일 도전',
  campaign: '캠페인',
  custom: '커스텀',
};

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
    this.ctx.overlay.show('<p class="subtitle">불러오는 중…</p>');
    this.loaded = [];
    try {
      const summaries = await documentStore().list('replays');
      for (const s of summaries) {
        const rec = await documentStore().get<ReplayDocumentV1>('replays', s.id);
        if (rec?.data && rec.data.schemaVersion === 1) this.loaded.push({ id: s.id, doc: rec.data });
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
    if (this.filters.mode !== 'all') parts.push(`모드: ${MODE_NAMES[this.filters.mode]}`);
    if (this.filters.faction !== 'all') parts.push(`왕국: ${FACTION_NAMES[this.filters.faction]}`);
    if (this.filters.difficulty !== 'all')
      parts.push(`난이도: ${DIFFICULTY_NAMES[this.filters.difficulty]}`);
    if (this.filters.scenario !== 'all') parts.push(`시나리오: ${this.filters.scenario}`);
    return parts.length > 0 ? parts.join(' · ') : '전체';
  }

  private renderList(): void {
    const list = this.filtered();
    const items: AnalysisListItem[] = list.map(({ id, doc }) => {
      const me = doc.initialConfig.humanFaction;
      return {
        id,
        title: doc.scenario.title || doc.initialConfig.scenario,
        sub: `${FACTION_NAMES[me]} · ${DIFFICULTY_NAMES[doc.initialConfig.difficulty]} · ${
          MODE_NAMES[doc.initialConfig.mode] ?? doc.initialConfig.mode
        } · ${doc.result.turns}턴 · ${doc.result.score}점`,
        outcome:
          doc.result.winner === me ? '승리' : doc.result.winner === 'draw' ? '무승부' : '패배',
        selected: this.selected.has(id),
      };
    });
    const scenarioOptions = [...new Map(this.loaded.map(({ doc }) => [doc.initialConfig.scenario, doc.scenario.title || doc.initialConfig.scenario])).entries()].map(
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
  private analysisOf(id: string, doc: ReplayDocumentV1): ReplayAnalysis | null {
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
      this.ctx.hud.toast('이 리플레이는 현재 규칙으로 분석할 수 없습니다');
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
    const parts = [`도전 ${progress.attempts ?? '-'}회`, `최고 ${'★'.repeat(progress.bestStars)}${progress.bestStars === 0 ? '없음' : ''}`];
    if (progress.bestScore > 0) {
      const diff = analysis.score - progress.bestScore;
      parts.push(diff >= 0 ? `최고 점수와 동률·경신(${progress.bestScore})` : `최고 점수까지 ${-diff}점`);
    }
    return `캠페인 기록 — ${parts.join(' · ')}`;
  }

  private showSingle(doc: ReplayDocumentV1, analysis: ReplayAnalysis): void {
    this.ctx.enterMode('analysis');
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
      this.ctx.hud.toast('분석 가능한 리플레이가 없습니다');
      this.renderList();
      return;
    }
    if (skipped > 0) this.ctx.hud.toast(`${skipped}판은 현재 규칙으로 분석할 수 없어 제외했습니다`);
    const agg = aggregateAnalyses(analyses);
    showMultiAnalysisScreen(this.ctx.overlay, agg, coachAggregate(agg), {
      onExport: (format) => this.export(analyses, format),
      onBack: () => this.renderList(),
    });
  }

  /** 외부 리플레이 파일을 보관하지 않고 분석만 한다. */
  private async importAndAnalyze(file: File): Promise<void> {
    if (file.size > REPLAY_MAX_IMPORT_BYTES) {
      this.ctx.hud.toast('파일이 너무 큽니다');
      return;
    }
    const token = this.ctx.currentToken();
    const text = await file.text().catch(() => null);
    if (!token.alive) return;
    const decoded = decodeReplayDocument(text ?? '');
    if (!decoded.ok) {
      this.ctx.hud.toast(decoded.issues[0]?.message ?? '리플레이 형식이 아닙니다');
      return;
    }
    const compat = checkReplayCompatibility(decoded.value);
    if (compat.compatibility === 'unsupported') {
      this.ctx.hud.toast(compat.reason);
      return;
    }
    const doc = compat.migrated ?? decoded.value;
    const r = analyzeReplay(doc);
    if (!r.ok) {
      this.ctx.hud.toast(`분석할 수 없습니다: ${r.reason}`);
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

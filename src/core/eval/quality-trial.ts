// 한 줄 목적: 시나리오를 평가 정책 여러 개로 자동 관전해 종료 가능성·승자 분포·정체·별점 분포를 보고한다(UI 비차단 청크 실행)
import { runAiTurn } from '../ai';
import { FACTION_IDS } from '../data';
import { newGameFromScenario } from '../game';
import { validateState } from '../save';
import { starsEarned } from '../scenario/objectives';
import type { ScenarioRuntimeSnapshot } from '../scenario/types';
import type { Difficulty, FactionId, GameState } from '../types';
import { EVAL_POLICY_IDS, runEvalPolicyTurn, type EvalPolicyId } from './policies';

export interface QualityTrialOptions {
  /** 사용할 평가 정책(기본: 5종 전부) */
  policies?: EvalPolicyId[];
  /** noisy 정책의 시드 변형 수(기본 4) */
  noisySeeds?: number;
  /** 적 난이도(기본 normal) */
  difficulty?: Difficulty;
  /** 게임 하나가 끝날 때마다 호출(진행 표시용). 총 게임 수와 완료 수를 준다 */
  onProgress?: (done: number, total: number) => void;
  /** true를 반환하면 즉시 중단하고 부분 결과 없이 null을 반환한다 */
  shouldCancel?: () => boolean;
  /** 게임 사이에 이벤트 루프를 양보할지(브라우저 UI 멈춤 방지, 기본 true) */
  yieldBetweenGames?: boolean;
}

export interface QualityTrialReport {
  games: number;
  /** 제한 페이즈 안에 끝나지 않은 게임 수(0이어야 정상) */
  unfinished: number;
  /** 종료 후 상태 검증 실패 수(0이어야 정상) */
  invalidStates: number;
  /** 실행기가 거부한 명령 발행 시도 수(평가 정책 결함 신호) */
  rejectedCommands: number;
  /** 3페이즈 이상 받고도 행동 0회인 세력(목표 인식 정체 신호) */
  stalledFactions: FactionId[];
  /** 승자 분포(각 세력·무승부) */
  winners: Partial<Record<FactionId | 'draw', number>>;
  avgEndTurn: number;
  /** 인간 세력 승리 시 별 0·1·2·3 분포 */
  starHistogram: [number, number, number, number];
  /** 정책별 인간 세력 승수 */
  policyWins: Partial<Record<EvalPolicyId, number>>;
}

const yieldNow = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * 시나리오 스냅샷을 자동 관전한다. 인간 세력은 평가 정책이, 나머지는 공개 AI가 둔다.
 * 게임 사이에 이벤트 루프를 양보해 모바일 UI를 멈추지 않으며, shouldCancel로 즉시 취소할 수 있다.
 */
export async function runQualityTrial(
  snapshot: ScenarioRuntimeSnapshot,
  opts: QualityTrialOptions = {},
): Promise<QualityTrialReport | null> {
  const policies = opts.policies ?? EVAL_POLICY_IDS;
  const noisySeeds = opts.noisySeeds ?? 4;
  const difficulty = opts.difficulty ?? 'normal';
  const runs: { policy: EvalPolicyId; seed: number }[] = [];
  for (const policy of policies) {
    const count = policy === 'noisy' ? noisySeeds : 1;
    for (let i = 0; i < count; i++) runs.push({ policy, seed: 20270800 + i });
  }

  const report: QualityTrialReport = {
    games: 0,
    unfinished: 0,
    invalidStates: 0,
    rejectedCommands: 0,
    stalledFactions: [],
    winners: {},
    avgEndTurn: 0,
    starHistogram: [0, 0, 0, 0],
    policyWins: {},
  };
  const stalled = new Set<FactionId>();
  let turnSum = 0;
  let finished = 0;

  for (let i = 0; i < runs.length; i++) {
    if (opts.shouldCancel?.()) return null;
    const { policy, seed } = runs[i];
    const state: GameState = newGameFromScenario(seed, snapshot, { mode: 'custom', difficulty });
    report.games++;
    const human = state.config.humanFaction;
    const acted: Partial<Record<FactionId, number>> = {};
    const phases: Partial<Record<FactionId, number>> = {};
    let guard = 0;
    const maxPhases = (state.maxTurns + 2) * state.order.length;
    while (!state.over && guard < maxPhases) {
      guard++;
      const f = state.current;
      if (f === human) {
        const r = runEvalPolicyTurn(state, f, policy, seed);
        report.rejectedCommands += r.rejected;
        acted[f] = (acted[f] ?? 0) + r.commands.filter((c) => c.type !== 'end-phase').length;
      } else {
        const r = runAiTurn(state, f);
        acted[f] = (acted[f] ?? 0) + r.commands.filter((c) => c.type !== 'end-phase').length;
      }
      phases[f] = (phases[f] ?? 0) + 1;
    }
    if (!state.over) {
      report.unfinished++;
    } else {
      if (!validateState(state)) report.invalidStates++;
      finished++;
      turnSum += Math.min(state.turn, state.maxTurns);
      const w = state.winner ?? 'draw';
      report.winners[w] = (report.winners[w] ?? 0) + 1;
      for (const f of FACTION_IDS) {
        if (
          snapshot.factions.find((x) => x.id === f)?.active &&
          !state.factions[f].eliminated &&
          (phases[f] ?? 0) >= 3 &&
          (acted[f] ?? 0) === 0
        ) {
          stalled.add(f);
        }
      }
      if (state.winner === human) {
        report.policyWins[policy] = (report.policyWins[policy] ?? 0) + 1;
        const s = Math.min(3, starsEarned(state).filter(Boolean).length);
        report.starHistogram[s]++;
      }
    }
    opts.onProgress?.(i + 1, runs.length);
    if (opts.yieldBetweenGames !== false) await yieldNow();
  }
  report.stalledFactions = [...stalled];
  report.avgEndTurn = finished > 0 ? +(turnSum / finished).toFixed(1) : 0;
  return report;
}

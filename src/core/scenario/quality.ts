// 한 줄 목적: 시나리오 품질 분석(전력 균형·거리·지형·병목·별점 달성 가능성)을 ERROR/WARNING/INFO 보고서로 만든다
import { MAX_UNITS_PER_FACTION, TERRAIN_RULES, UNIT_STATS } from '../data';
import { hexDistance, hexKey } from '../hex';
import type { Axial, FactionId } from '../types';
import type {
  ScenarioDocumentV1,
  ScenarioTile,
  ValidationIssue,
  VictoryCondition,
} from './types';

/** 세력별 시작 전력 요약(품질 화면·보고서 표시용). */
export interface FactionStrength {
  faction: FactionId;
  unitCount: number;
  /** 유닛 비용 합(병력 가치) */
  unitValue: number;
  startGold: number;
  hasCapital: boolean;
}

export interface QualityMetrics {
  factionStrengths: FactionStrength[];
  /** 인간 시작 지점에서 핵심 목표까지 육각 거리(목표 없으면 null) */
  objectiveDistance: number | null;
  /** 서로 적대하는 유닛 사이 최단 접촉 예상 턴(전투 유닛 없으면 null) */
  estimatedFirstCombatTurn: number | null;
  /** 전체 타일 중 물 비율 */
  waterRatio: number;
  /** 어떤 시작 지점에서도 닿지 않는 지상 타일 수 */
  unusedLandTiles: number;
  /** 지상 연결 그래프의 단절점(병목) 수 */
  bottleneckCount: number;
}

export interface QualityReport {
  issues: ValidationIssue[];
  metrics: QualityMetrics;
}

const HEX_DIRS: Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function issue(
  code: string,
  severity: ValidationIssue['severity'],
  message: string,
  extra?: Partial<ValidationIssue>,
): ValidationIssue {
  return { code, severity, message, ...extra };
}

function flattenVictory(conds: VictoryCondition[], depth = 0): VictoryCondition[] {
  if (depth > 3) return conds;
  const out: VictoryCondition[] = [];
  for (const c of conds) {
    out.push(c);
    if (c.type === 'all-of' || c.type === 'any-of') out.push(...flattenVictory(c.conditions, depth + 1));
  }
  return out;
}

function landTiles(doc: ScenarioDocumentV1): Map<string, ScenarioTile> {
  const m = new Map<string, ScenarioTile>();
  for (const t of doc.board.tiles) {
    if (t.terrain !== 'water') m.set(hexKey(t.q, t.r), t);
  }
  return m;
}

/** 시작 지점 집합에서 지상 BFS로 닿는 타일 키 집합. */
function reachableFrom(land: Map<string, ScenarioTile>, starts: Axial[]): Set<string> {
  const visited = new Set<string>();
  const queue: Axial[] = [];
  for (const s of starts) {
    const k = hexKey(s.q, s.r);
    if (land.has(k) && !visited.has(k)) {
      visited.add(k);
      queue.push(s);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const d of HEX_DIRS) {
      const n = { q: cur.q + d.q, r: cur.r + d.r };
      const nk = hexKey(n.q, n.r);
      if (visited.has(nk) || !land.has(nk)) continue;
      visited.add(nk);
      queue.push(n);
    }
  }
  return visited;
}

/** 지상 연결 그래프의 단절점(articulation point) 수 — 병목 지표. 반복(비재귀) DFS. */
export function countBottlenecks(land: Map<string, ScenarioTile>): number {
  const keys = [...land.keys()];
  if (keys.length < 3) return 0;
  const index = new Map<string, number>(keys.map((k, i) => [k, i]));
  const adj: number[][] = keys.map(() => []);
  for (const [k, t] of land) {
    const i = index.get(k)!;
    for (const d of HEX_DIRS) {
      const nk = hexKey(t.q + d.q, t.r + d.r);
      const j = index.get(nk);
      if (j !== undefined) adj[i].push(j);
    }
  }
  const n = keys.length;
  const disc = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const parent = new Array<number>(n).fill(-1);
  const isCut = new Array<boolean>(n).fill(false);
  let timer = 0;
  for (let root = 0; root < n; root++) {
    if (disc[root] !== -1) continue;
    // 반복 DFS: [노드, 다음 이웃 인덱스]
    const stack: [number, number][] = [[root, 0]];
    disc[root] = low[root] = timer++;
    let rootChildren = 0;
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const [u] = frame;
      if (frame[1] < adj[u].length) {
        const v = adj[u][frame[1]++];
        if (disc[v] === -1) {
          parent[v] = u;
          if (u === root) rootChildren++;
          disc[v] = low[v] = timer++;
          stack.push([v, 0]);
        } else if (v !== parent[u]) {
          low[u] = Math.min(low[u], disc[v]);
        }
      } else {
        stack.pop();
        const p = parent[u];
        if (p !== -1) {
          low[p] = Math.min(low[p], low[u]);
          if (p !== root && low[u] >= disc[p]) isCut[p] = true;
        }
      }
    }
    if (rootChildren > 1) isCut[root] = true;
  }
  return isCut.filter(Boolean).length;
}

/**
 * 구조 검증을 통과한 시나리오의 품질을 분석한다. 예외를 던지지 않는다.
 * error는 정적으로 확정된 달성 불가만, 그 외 신호는 warning/info로 보고한다.
 */
export function scenarioQualityReport(doc: ScenarioDocumentV1): QualityReport {
  const issues: ValidationIssue[] = [];
  const active = doc.factions.filter((f) => f.active);
  const activeIds = new Set(active.map((f) => f.id));
  const human = active.find((f) => f.controller === 'human')?.id ?? null;
  const land = landTiles(doc);
  const total = doc.board.tiles.length;

  // ---------- 세력별 시작 전력·자원 ----------
  const strengths: FactionStrength[] = active.map((f) => {
    const units = doc.units.filter((u) => u.faction === f.id);
    return {
      faction: f.id,
      unitCount: units.length,
      unitValue: units.reduce((s, u) => s + UNIT_STATS[u.type].cost, 0),
      startGold: f.startGold ?? 0,
      hasCapital: doc.board.tiles.some((t) => t.building === 'capital' && t.owner === f.id),
    };
  });
  const totalValue = (s: FactionStrength): number => s.unitValue + s.startGold;
  const maxV = Math.max(...strengths.map(totalValue));
  const minV = Math.min(...strengths.map(totalValue));
  if (maxV > 0 && minV * 3 < maxV) {
    issues.push(
      issue('strength-imbalance', 'warning', `세력 시작 전력(병력 가치+금) 격차가 3배를 넘습니다 (${minV} vs ${maxV}) — 의도한 비대칭인지 확인하세요`),
    );
  } else if (maxV > 0 && minV * 2 < maxV) {
    issues.push(issue('strength-gap', 'info', `세력 시작 전력 격차가 2배를 넘습니다 (${minV} vs ${maxV})`));
  }

  // ---------- 수도 주변 방어 지형 ----------
  for (const s of strengths) {
    if (!s.hasCapital) continue;
    const cap = doc.board.tiles.find((t) => t.building === 'capital' && t.owner === s.faction)!;
    let open = 0;
    for (const d of HEX_DIRS) {
      const t = land.get(hexKey(cap.q + d.q, cap.r + d.r));
      if (!t) continue; // 물·맵 밖은 접근 불가 = 방어에 유리
      if (TERRAIN_RULES[t.terrain].def === 0) open++;
    }
    if (open >= 5)
      issues.push(
        issue('capital-exposed', 'info', `${s.faction} 수도 주변에 방어 지형이 없습니다(개방 ${open}방향)`, { at: { q: cap.q, r: cap.r } }),
      );
  }

  // ---------- 핵심 목표 거리 ----------
  let objectiveDistance: number | null = null;
  if (human) {
    const humanStart =
      doc.board.tiles.find((t) => t.building === 'capital' && t.owner === human) ??
      doc.units.find((u) => u.faction === human) ??
      null;
    const flat = flattenVictory(doc.victoryConditions);
    const targets: Axial[] = [];
    for (const c of flat) {
      if (c.type === 'capture-building' || c.type === 'hold-building') targets.push(c.at);
      if (c.type === 'conquest' || c.type === 'eliminate-faction') {
        for (const t of doc.board.tiles) {
          if (t.building === 'capital' && t.owner && t.owner !== human && activeIds.has(t.owner))
            targets.push(t);
        }
      }
      if (c.type === 'capture-count') {
        for (const t of doc.board.tiles) {
          if (t.building === c.building && t.owner !== human) targets.push(t);
        }
      }
    }
    if (humanStart && targets.length > 0) {
      objectiveDistance = Math.min(...targets.map((t) => hexDistance(humanStart, t)));
      // 가장 빠른 병과(기병 3칸/턴) 기준으로도 제한 턴 안에 닿을 수 없으면 달성 불가
      const bestMove = Math.max(...Object.values(UNIT_STATS).map((s) => s.move));
      if (objectiveDistance > doc.rules.maxTurns * bestMove) {
        issues.push(
          issue('objective-too-far', 'error', `핵심 목표까지 ${objectiveDistance}칸 — 최대 턴(${doc.rules.maxTurns}) 안에 도달할 수 없습니다`),
        );
      } else if (objectiveDistance > doc.rules.maxTurns * 2) {
        issues.push(
          issue('objective-far', 'warning', `핵심 목표까지 ${objectiveDistance}칸 — 제한 턴(${doc.rules.maxTurns}) 대비 멉니다`),
        );
      }
    }
  }

  // ---------- 무료 거점 접근성 ----------
  const neutral = doc.board.tiles.filter((t) => t.building && !t.owner);
  if (neutral.length > 0 && active.length >= 2) {
    const startOf = (f: FactionId): Axial | null =>
      doc.board.tiles.find((t) => t.building === 'capital' && t.owner === f) ??
      doc.units.find((u) => u.faction === f) ??
      null;
    let dominated = 0;
    for (const nb of neutral) {
      const dists = active
        .map((f) => ({ f: f.id, start: startOf(f.id) }))
        .filter((x): x is { f: FactionId; start: Axial } => x.start !== null)
        .map((x) => ({ f: x.f, d: hexDistance(x.start, nb) }))
        .sort((a, b) => a.d - b.d);
      if (dists.length >= 2 && dists[0].d + 3 <= dists[1].d) dominated++;
    }
    if (dominated === neutral.length && neutral.length >= 2)
      issues.push(
        issue('free-buildings-one-sided', 'warning', `중립 거점 ${neutral.length}개가 모두 한 세력에 크게 가깝습니다 — 경제 경쟁이 없습니다`),
      );
  }

  // ---------- 첫 전투 예상 턴 ----------
  let estimatedFirstCombatTurn: number | null = null;
  if (doc.units.length >= 2) {
    let minDist = Infinity;
    for (const a of doc.units) {
      for (const b of doc.units) {
        if (a.faction === b.faction) continue;
        minDist = Math.min(minDist, hexDistance(a, b));
      }
    }
    if (Number.isFinite(minDist)) {
      // 양쪽이 서로 접근한다고 보고 평균 이동력 2로 나눈 근사
      estimatedFirstCombatTurn = Math.max(1, Math.ceil(minDist / 4));
      if (estimatedFirstCombatTurn > doc.rules.maxTurns)
        issues.push(
          issue('no-combat-expected', 'warning', `첫 전투 예상 턴(${estimatedFirstCombatTurn})이 최대 턴(${doc.rules.maxTurns})보다 깁니다 — 전투 없이 끝날 수 있습니다`),
        );
      else if (estimatedFirstCombatTurn <= 1 && doc.rules.maxTurns >= 6)
        issues.push(issue('instant-combat', 'info', '서로 적대하는 유닛이 시작부터 교전 거리 안에 있습니다'));
    }
  }

  // ---------- 고립 세력 ----------
  if (active.length >= 2) {
    for (const f of active) {
      const mine: Axial[] = [
        ...doc.units.filter((u) => u.faction === f.id),
        ...doc.board.tiles.filter((t) => t.owner === f.id),
      ];
      if (mine.length === 0) continue;
      const mineReach = reachableFrom(land, mine);
      const others: Axial[] = [
        ...doc.units.filter((u) => u.faction !== f.id && activeIds.has(u.faction)),
        ...doc.board.tiles.filter((t) => t.owner && t.owner !== f.id && activeIds.has(t.owner)),
      ];
      const isolated =
        others.length > 0 && others.every((o) => !mineReach.has(hexKey(o.q, o.r)));
      if (isolated)
        issues.push(
          issue('faction-isolated', 'warning', `${f.id} 세력이 다른 세력과 지상으로 연결되어 있지 않습니다`),
        );
    }
  }

  // ---------- 물 비율·미사용 영역·병목 ----------
  const waterRatio = total > 0 ? +(1 - land.size / total).toFixed(3) : 0;
  if (waterRatio > 0.4)
    issues.push(issue('too-much-water', 'warning', `물 타일이 ${(waterRatio * 100).toFixed(0)}%입니다 — 전장이 지나치게 좁아질 수 있습니다`));

  const allStarts: Axial[] = [
    ...doc.units,
    ...doc.board.tiles.filter((t) => t.building !== undefined),
  ];
  const used = reachableFrom(land, allStarts);
  const unusedLandTiles = land.size - used.size;
  if (unusedLandTiles > land.size * 0.25)
    issues.push(
      issue('unused-area', 'warning', `지상 타일의 ${Math.round((unusedLandTiles / land.size) * 100)}%가 어떤 유닛·거점에서도 닿지 않는 영역입니다`),
    );
  else if (unusedLandTiles > 0)
    issues.push(issue('unused-area', 'info', `닿지 않는 지상 타일이 ${unusedLandTiles}개 있습니다`));

  const bottleneckCount = countBottlenecks(land);
  if (land.size > 0 && bottleneckCount > land.size * 0.2)
    issues.push(
      issue('many-bottlenecks', 'info', `지상 단절점(병목)이 ${bottleneckCount}개입니다 — 좁은 통로 중심의 전장입니다`),
    );

  // ---------- 승리 조건·지도 정합 ----------
  const flat = flattenVictory(doc.victoryConditions);
  if (flat.some((c) => c.type === 'reach-score') && neutral.length === 0)
    issues.push(
      issue('score-no-expansion', 'warning', '점수 승리인데 중립 거점이 없습니다 — 점수 성장 수단이 전투뿐입니다'),
    );

  // ---------- 별점 조건 달성 가능성 ----------
  if (human) {
    const humanUnits = doc.units.filter((u) => u.faction === human).length;
    const enemyUnits = doc.units.filter(
      (u) => u.faction !== human && activeIds.has(u.faction),
    ).length;
    const enemyCanProduce = doc.board.tiles.some(
      (t) => t.building && t.owner && t.owner !== human && activeIds.has(t.owner),
    );
    (doc.starConditions ?? []).forEach((c, i) => {
      const path = `starConditions[${i}]`;
      if (c.type === 'units-alive-at-least' && c.count > MAX_UNITS_PER_FACTION)
        issues.push(issue('star-impossible', 'error', `생존 유닛 조건(${c.count})이 세력 최대 유닛 수(${MAX_UNITS_PER_FACTION})를 넘습니다`, { path }));
      if (c.type === 'kills-at-least' && !enemyCanProduce && c.count > enemyUnits)
        issues.push(issue('star-impossible', 'error', `처치 조건(${c.count})이 적 총 유닛 수(${enemyUnits})를 넘고 적은 생산할 수 없습니다`, { path }));
      if (c.type === 'units-lost-at-most' && c.count >= Math.max(humanUnits, 1) + doc.rules.maxTurns)
        issues.push(issue('star-trivial', 'warning', `손실 조건(${c.count})이 지나치게 후해 사실상 항상 달성됩니다`, { path }));
      if (c.type === 'win-within-turns' && c.turns >= doc.rules.maxTurns)
        issues.push(issue('star-trivial', 'warning', `제한 턴(${doc.rules.maxTurns}) 안 승리는 항상 별점 턴(${c.turns}) 안 승리입니다 — 승리와 동일한 조건입니다`, { path }));
    });
  }

  return {
    issues,
    metrics: {
      factionStrengths: strengths,
      objectiveDistance,
      estimatedFirstCombatTurn,
      waterRatio,
      unusedLandTiles,
      bottleneckCount,
    },
  };
}

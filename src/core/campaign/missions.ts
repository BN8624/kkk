// 한 줄 목적: 왕국별 캠페인 문서와 손수 제작한 미션 시나리오(고정 지도·배치·목표)를 정의한다
import { offsetToAxial } from '../hex';
import type {
  ScenarioDocumentV1,
  ScenarioFactionSetup,
  ScenarioTile,
  ScenarioUnitSetup,
} from '../scenario/types';
import type { Axial, FactionId } from '../types';
import type { CampaignDocument } from './types';

// ---------------- 지도 제작 도구 ----------------

/** 오프셋(col,row) 좌표로 고정 지도를 조립한다. 모든 칸은 평원으로 시작한다. */
class BoardBuilder {
  readonly tiles: ScenarioTile[] = [];
  private index = new Map<string, ScenarioTile>();

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const t: ScenarioTile = { ...offsetToAxial(col, row), terrain: 'plains' };
        this.tiles.push(t);
        this.index.set(`${col},${row}`, t);
      }
    }
  }

  at(col: number, row: number): Axial {
    return offsetToAxial(col, row);
  }

  set(col: number, row: number, patch: Partial<Omit<ScenarioTile, 'q' | 'r'>>): this {
    const t = this.index.get(`${col},${row}`);
    if (!t) throw new Error(`지도 밖 좌표 (${col},${row})`);
    Object.assign(t, patch);
    return this;
  }

  /** 같은 행의 col 구간을 지정 지형으로 채운다. */
  rowTerrain(row: number, colFrom: number, colTo: number, terrain: ScenarioTile['terrain']): this {
    for (let c = colFrom; c <= colTo; c++) this.set(c, row, { terrain });
    return this;
  }
}

function factions(
  human: FactionId,
  ais: FactionId[],
  gold?: Partial<Record<FactionId, number>>,
): ScenarioFactionSetup[] {
  const all: FactionId[] = ['azure', 'crimson', 'violet'];
  return all.map((id) => ({
    id,
    active: id === human || ais.includes(id),
    controller: id === human ? 'human' : 'ai',
    ...(gold?.[id] !== undefined ? { startGold: gold[id] } : {}),
  }));
}

// ---------------- 청람 1: 남쪽 관문 ----------------

function azureMission1(): ScenarioDocumentV1 {
  const b = new BoardBuilder(9, 12);
  // 북쪽 청람 본토·남쪽 진홍 진영, 가운데 관문(산맥의 단일 통로)
  b.rowTerrain(6, 0, 3, 'mountain').rowTerrain(6, 5, 8, 'mountain');
  b.set(4, 5, { terrain: 'forest' })
    .set(3, 5, { terrain: 'forest' })
    .set(5, 5, { terrain: 'forest' })
    .set(1, 4, { terrain: 'forest' })
    .set(7, 4, { terrain: 'forest' })
    .set(0, 11, { terrain: 'water' })
    .set(8, 11, { terrain: 'water' })
    .set(0, 0, { terrain: 'water' })
    .set(8, 0, { terrain: 'water' });
  b.set(4, 1, { building: 'capital', owner: 'azure' })
    .set(2, 2, { building: 'village', owner: 'azure' })
    .set(6, 2, { building: 'village', owner: 'azure' })
    .set(4, 10, { building: 'capital', owner: 'crimson' })
    .set(2, 9, { building: 'village', owner: 'crimson' })
    .set(6, 9, { building: 'village', owner: 'crimson' });

  const units: ScenarioUnitSetup[] = [
    // 청람 수비대: 관문과 숲에 배치된 보병 방벽 + 후방 궁병
    { faction: 'azure', type: 'infantry', ...b.at(4, 6) },
    { faction: 'azure', type: 'infantry', ...b.at(3, 5) },
    { faction: 'azure', type: 'infantry', ...b.at(5, 5) },
    { faction: 'azure', type: 'archer', ...b.at(4, 4) },
    { faction: 'azure', type: 'archer', ...b.at(3, 4) },
    { faction: 'azure', type: 'cavalry', ...b.at(4, 2) },
    // 진홍 돌격대
    { faction: 'crimson', type: 'cavalry', ...b.at(3, 8) },
    { faction: 'crimson', type: 'cavalry', ...b.at(5, 8) },
    { faction: 'crimson', type: 'infantry', ...b.at(4, 8) },
    { faction: 'crimson', type: 'infantry', ...b.at(2, 8) },
    { faction: 'crimson', type: 'infantry', ...b.at(6, 8) },
    { faction: 'crimson', type: 'archer', ...b.at(4, 9) },
  ];

  return {
    schemaVersion: 1,
    id: 'campaign-azure-1',
    title: '남쪽 관문',
    description: '남쪽 산맥의 관문을 지켜라. 10턴 동안 수도를 방어하면 승리한다.',
    board: { cols: 9, rows: 12, tiles: b.tiles, source: { kind: 'fixed' } },
    factions: factions('azure', ['crimson'], { crimson: 40 }),
    units,
    rules: { maxTurns: 10, turnLimit: 'defeat' },
    victoryConditions: [{ type: 'survive-turns', turns: 10 }],
    defeatConditions: [{ type: 'lose-building', at: b.at(4, 1) }, { type: 'human-eliminated' }],
    starConditions: [
      { type: 'win' },
      { type: 'units-lost-at-most', count: 2 },
      { type: 'kills-at-least', count: 4 },
    ],
    metadata: { recommendedFaction: 'azure', tags: ['campaign'] },
  };
}

// ---------------- 진홍 1: 첫 번째 돌격 ----------------

function crimsonMission1(): ScenarioDocumentV1 {
  const b = new BoardBuilder(10, 10);
  // 서쪽 진홍 기병대가 동쪽 청람 마을들을 급습한다
  b.set(4, 4, { terrain: 'forest' })
    .set(4, 5, { terrain: 'forest' })
    .set(5, 3, { terrain: 'forest' })
    .set(5, 6, { terrain: 'forest' })
    .set(2, 1, { terrain: 'forest' })
    .set(2, 8, { terrain: 'forest' })
    .set(7, 0, { terrain: 'mountain' })
    .set(7, 9, { terrain: 'mountain' })
    .set(0, 0, { terrain: 'water' })
    .set(0, 9, { terrain: 'water' })
    .set(9, 0, { terrain: 'water' })
    .set(9, 9, { terrain: 'water' });
  b.set(1, 4, { building: 'capital', owner: 'crimson' })
    .set(8, 4, { building: 'capital', owner: 'azure' })
    .set(6, 2, { building: 'village', owner: 'azure' })
    .set(6, 7, { building: 'village', owner: 'azure' })
    .set(7, 4, { building: 'village' });

  const units: ScenarioUnitSetup[] = [
    // 진홍 돌격대: 기병 중심
    { faction: 'crimson', type: 'cavalry', ...b.at(2, 3) },
    { faction: 'crimson', type: 'cavalry', ...b.at(3, 4) },
    { faction: 'crimson', type: 'cavalry', ...b.at(2, 5) },
    { faction: 'crimson', type: 'infantry', ...b.at(1, 3) },
    // 청람 수비대
    { faction: 'azure', type: 'infantry', ...b.at(5, 2) },
    { faction: 'azure', type: 'infantry', ...b.at(5, 7) },
    { faction: 'azure', type: 'archer', ...b.at(7, 3) },
  ];

  return {
    schemaVersion: 1,
    id: 'campaign-crimson-1',
    title: '첫 번째 돌격',
    description: '8턴 안에 청람의 마을 2곳을 점령하라. 기병의 속도가 무기다.',
    board: { cols: 10, rows: 10, tiles: b.tiles, source: { kind: 'fixed' } },
    factions: factions('crimson', ['azure'], { azure: 30 }),
    units,
    rules: { maxTurns: 8, turnLimit: 'defeat' },
    victoryConditions: [{ type: 'capture-count', building: 'village', count: 2 }],
    defeatConditions: [{ type: 'human-eliminated' }, { type: 'turn-limit' }],
    starConditions: [
      { type: 'win' },
      { type: 'win-within-turns', turns: 6 },
      { type: 'units-lost-at-most', count: 1 },
    ],
    metadata: { recommendedFaction: 'crimson', tags: ['campaign'] },
  };
}

// ---------------- 자원 1: 높은 곳에서 ----------------

function violetMission1(): ScenarioDocumentV1 {
  const b = new BoardBuilder(9, 12);
  // 남서 저지대의 자원군이 북동 산등성이의 왕관 거점을 확보한다
  b.set(4, 3, { terrain: 'mountain' })
    .set(5, 3, { terrain: 'mountain' })
    .set(6, 3, { terrain: 'mountain' })
    .set(4, 4, { terrain: 'mountain' })
    .set(4, 5, { terrain: 'mountain' })
    .set(5, 5, { terrain: 'mountain' })
    .set(6, 5, { terrain: 'mountain' })
    .set(2, 6, { terrain: 'forest' })
    .set(3, 6, { terrain: 'forest' })
    .set(5, 7, { terrain: 'forest' })
    .set(6, 7, { terrain: 'forest' })
    .set(0, 0, { terrain: 'water' })
    .set(0, 1, { terrain: 'water' })
    .set(8, 11, { terrain: 'water' })
    .set(8, 10, { terrain: 'water' });
  // 왕관 거점(중립 고지) — 동쪽 (6,4)만 열린 통로다
  b.set(5, 4, { building: 'crown' })
    .set(2, 9, { building: 'capital', owner: 'violet' })
    .set(1, 7, { building: 'village', owner: 'violet' })
    .set(7, 1, { building: 'capital', owner: 'crimson' })
    .set(6, 1, { building: 'village', owner: 'crimson' });

  const units: ScenarioUnitSetup[] = [
    // 자원 원정대: 별의 사수(생존 목표)와 호위대
    { faction: 'violet', type: 'archer', ...b.at(2, 8), tag: 'star-archer' },
    { faction: 'violet', type: 'archer', ...b.at(3, 9) },
    { faction: 'violet', type: 'infantry', ...b.at(1, 8) },
    { faction: 'violet', type: 'infantry', ...b.at(3, 8) },
    // 진홍 경쟁자: 북쪽에서 왕관을 노린다
    { faction: 'crimson', type: 'cavalry', ...b.at(6, 2) },
    { faction: 'crimson', type: 'infantry', ...b.at(7, 2) },
    { faction: 'crimson', type: 'archer', ...b.at(7, 3) },
  ];

  return {
    schemaVersion: 1,
    id: 'campaign-violet-1',
    title: '높은 곳에서',
    description: '별의 사수를 지키며 산등성이의 왕관 거점을 점령하라.',
    board: { cols: 9, rows: 12, tiles: b.tiles, source: { kind: 'fixed' } },
    factions: factions('violet', ['crimson'], { crimson: 35 }),
    units,
    rules: { maxTurns: 12, turnLimit: 'defeat' },
    victoryConditions: [
      {
        type: 'all-of',
        conditions: [{ type: 'capture-building', at: b.at(5, 4) }, { type: 'unit-alive', tag: 'star-archer' }],
      },
    ],
    defeatConditions: [
      { type: 'unit-dies', tag: 'star-archer' },
      { type: 'human-eliminated' },
      { type: 'turn-limit' },
    ],
    starConditions: [
      { type: 'win' },
      { type: 'win-within-turns', turns: 9 },
      { type: 'units-lost-at-most', count: 2 },
    ],
    metadata: { recommendedFaction: 'violet', tags: ['campaign'] },
  };
}

// ---------------- 캠페인 문서 ----------------

/** 왕국별 캠페인. 대표 미션이 먼저 완성되고 나머지는 뒤 단계에서 추가된다. */
export const CAMPAIGNS: CampaignDocument[] = [
  {
    schemaVersion: 1,
    id: 'campaign-azure',
    faction: 'azure',
    title: '최후의 방벽',
    description: '청람 왕국의 방어전 — 버티는 자가 섬을 지킨다.',
    missions: [
      {
        id: 'azure-1',
        title: '남쪽 관문',
        intro: '진홍의 기병대가 남쪽 관문으로 몰려온다. 산맥의 통로를 막고 10턴을 버텨라.',
        scenario: azureMission1(),
        requires: null,
        completionText: '관문은 지켜졌다. 진홍의 첫 공세가 산맥 앞에서 부서졌다.',
      },
    ],
  },
  {
    schemaVersion: 1,
    id: 'campaign-crimson',
    faction: 'crimson',
    title: '붉은 기치',
    description: '진홍 공국의 진격전 — 속도가 곧 승리다.',
    missions: [
      {
        id: 'crimson-1',
        title: '첫 번째 돌격',
        intro: '청람의 국경 마을은 아직 방비가 얇다. 기병의 속도로 8턴 안에 마을 2곳을 점령하라.',
        scenario: crimsonMission1(),
        requires: null,
        completionText: '붉은 기치가 국경에 꽂혔다. 공국의 진격이 시작된다.',
      },
    ],
  },
  {
    schemaVersion: 1,
    id: 'campaign-violet',
    faction: 'violet',
    title: '별의 화살',
    description: '자원 후국의 원정전 — 높은 곳을 차지하는 자가 멀리 쏜다.',
    missions: [
      {
        id: 'violet-1',
        title: '높은 곳에서',
        intro: '산등성이의 왕관 거점을 진홍보다 먼저 차지하라. 별의 사수를 잃으면 원정은 실패한다.',
        scenario: violetMission1(),
        requires: null,
        completionText: '별의 사수가 산등성이에 올랐다. 이제 후국의 화살이 섬을 굽어본다.',
      },
    ],
  },
];

/** 시나리오 id(state.config.scenario)로 미션을 찾는다(결과·이어하기 귀속용). */
export function missionByScenarioId(
  scenarioId: string,
): { campaign: CampaignDocument; mission: CampaignDocument['missions'][number] } | null {
  for (const campaign of CAMPAIGNS) {
    const mission = campaign.missions.find((m) => m.scenario.id === scenarioId);
    if (mission) return { campaign, mission };
  }
  return null;
}

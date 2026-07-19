// 한 줄 목적: 검증된 공식 시나리오 팩 6종(초단기·대형·결투·요새 방어·경제·호위)을 정의한다 — 수정 불가, 복제 후 편집
import { BoardBuilder, factions } from '../campaign/missions';
import type { ScenarioDocumentV1, ScenarioUnitSetup } from './types';

// ---------------- 1. 번개 결투장 (6×6 초단기) ----------------

function lightningDuel(): ScenarioDocumentV1 {
  const b = new BoardBuilder(6, 6);
  b.set(2, 2, { terrain: 'forest' })
    .set(3, 3, { terrain: 'forest' })
    .set(2, 4, { terrain: 'forest' })
    .set(3, 1, { terrain: 'forest' });
  b.set(0, 2, { building: 'capital', owner: 'azure' })
    .set(5, 3, { building: 'capital', owner: 'crimson' })
    .set(3, 2, { building: 'village' })
    .set(2, 3, { building: 'village' });

  const units: ScenarioUnitSetup[] = [
    { faction: 'azure', type: 'infantry', ...b.at(1, 2) },
    { faction: 'azure', type: 'archer', ...b.at(0, 1) },
    { faction: 'azure', type: 'cavalry', ...b.at(1, 3) },
    { faction: 'crimson', type: 'infantry', ...b.at(4, 3) },
    { faction: 'crimson', type: 'archer', ...b.at(5, 4) },
    { faction: 'crimson', type: 'cavalry', ...b.at(4, 2) },
  ];

  return {
    schemaVersion: 1,
    id: 'official-lightning-duel',
    title: '번개 결투장',
    description: '6×6 초단기 전투. 6턴 안에 더 높은 점수를 만들거나 적을 정복하라.',
    author: '세 왕관의 섬',
    board: { cols: 6, rows: 6, tiles: b.tiles, source: { kind: 'fixed' } },
    factions: factions('azure', ['crimson'], { azure: 20, crimson: 20 }),
    units,
    rules: { maxTurns: 6, turnLimit: 'score', uniqueUnits: true },
    victoryConditions: [{ type: 'conquest' }],
    defeatConditions: [{ type: 'human-eliminated' }],
    starConditions: [
      { type: 'win' },
      { type: 'win-within-turns', turns: 5 },
      { type: 'units-lost-at-most', count: 1 },
    ],
    metadata: { tags: ['official'], recommendedFaction: 'azure', recommendedDifficulty: 'normal', estimatedMinutes: 5 },
  };
}

// ---------------- 2. 대륙 회전 (20×20 대형 전장) ----------------

function grandContinent(): ScenarioDocumentV1 {
  const b = new BoardBuilder(20, 20);
  // 중앙 호수와 산줄기·숲으로 세 전선을 가른다
  for (const [c, r] of [[9, 9], [10, 9], [9, 10], [10, 10], [8, 10], [11, 9]] as const) {
    b.set(c, r, { terrain: 'water' });
  }
  for (const [c, r] of [[0, 0], [19, 0], [0, 19], [19, 19], [1, 0], [18, 19]] as const) {
    b.set(c, r, { terrain: 'water' });
  }
  for (const [c, r] of [[6, 6], [7, 6], [13, 6], [6, 13], [13, 13], [12, 13]] as const) {
    b.set(c, r, { terrain: 'mountain' });
  }
  for (const [c, r] of [[4, 8], [8, 4], [15, 8], [8, 15], [15, 15], [4, 12], [12, 4], [11, 15]] as const) {
    b.set(c, r, { terrain: 'forest' });
  }
  b.set(2, 17, { building: 'capital', owner: 'azure' })
    .set(17, 2, { building: 'capital', owner: 'crimson' })
    .set(17, 17, { building: 'capital', owner: 'violet' })
    .set(5, 5, { building: 'village' })
    .set(14, 5, { building: 'village' })
    .set(5, 14, { building: 'village' })
    .set(14, 14, { building: 'village' })
    .set(9, 3, { building: 'village' })
    .set(3, 9, { building: 'village' })
    .set(16, 9, { building: 'village' })
    .set(9, 16, { building: 'village' });

  const squad = (f: 'azure' | 'crimson' | 'violet', spots: [number, number][]): ScenarioUnitSetup[] => [
    { faction: f, type: 'infantry', ...b.at(...spots[0]) },
    { faction: f, type: 'infantry', ...b.at(...spots[1]) },
    { faction: f, type: 'archer', ...b.at(...spots[2]) },
    { faction: f, type: 'cavalry', ...b.at(...spots[3]) },
  ];

  return {
    schemaVersion: 1,
    id: 'official-grand-continent',
    title: '대륙 회전',
    description: '20×20 대형 전장. 세 왕국이 여덟 마을과 대륙 전체를 두고 회전을 벌인다.',
    author: '세 왕관의 섬',
    board: { cols: 20, rows: 20, tiles: b.tiles, source: { kind: 'fixed' } },
    factions: factions('azure', ['crimson', 'violet'], { azure: 30, crimson: 30, violet: 30 }),
    units: [
      ...squad('azure', [[3, 16], [2, 15], [1, 16], [4, 17]]),
      ...squad('crimson', [[16, 3], [17, 4], [18, 3], [15, 2]]),
      ...squad('violet', [[16, 16], [17, 15], [18, 16], [15, 17]]),
    ],
    rules: { maxTurns: 30, turnLimit: 'score', uniqueUnits: true },
    victoryConditions: [{ type: 'conquest' }],
    defeatConditions: [{ type: 'human-eliminated' }],
    starConditions: [
      { type: 'win' },
      { type: 'buildings-captured-at-least', count: 6 },
      { type: 'kills-at-least', count: 10 },
    ],
    metadata: { tags: ['official'], recommendedFaction: 'azure', recommendedDifficulty: 'normal', estimatedMinutes: 25 },
  };
}

// ---------------- 3. 외나무 다리 (두 세력 결투) ----------------

function narrowBridge(): ScenarioDocumentV1 {
  const b = new BoardBuilder(12, 8);
  // 가운데 강(두 열)과 두 칸짜리 다리
  for (let r = 0; r < 8; r++) {
    if (r === 3 || r === 4) continue;
    b.set(5, r, { terrain: 'water' }).set(6, r, { terrain: 'water' });
  }
  b.set(4, 3, { terrain: 'forest' })
    .set(7, 4, { terrain: 'forest' })
    .set(4, 5, { terrain: 'forest' })
    .set(7, 2, { terrain: 'forest' })
    .set(5, 3, { terrain: 'plains' })
    .set(6, 4, { terrain: 'plains' });
  b.set(1, 3, { building: 'capital', owner: 'azure' })
    .set(10, 4, { building: 'capital', owner: 'crimson' })
    .set(4, 1, { building: 'village' })
    .set(7, 6, { building: 'village' })
    .set(4, 6, { building: 'village' })
    .set(7, 1, { building: 'village' });

  const units: ScenarioUnitSetup[] = [
    { faction: 'azure', type: 'infantry', ...b.at(2, 3) },
    { faction: 'azure', type: 'infantry', ...b.at(2, 4) },
    { faction: 'azure', type: 'archer', ...b.at(1, 4) },
    { faction: 'azure', type: 'cavalry', ...b.at(3, 3) },
    { faction: 'crimson', type: 'infantry', ...b.at(9, 4) },
    { faction: 'crimson', type: 'infantry', ...b.at(9, 3) },
    { faction: 'crimson', type: 'archer', ...b.at(10, 3) },
    // 약탈대 시연: 측면 침투·점령 압박
    { faction: 'crimson', type: 'raider', ...b.at(8, 4) },
  ];

  return {
    schemaVersion: 1,
    id: 'official-narrow-bridge',
    title: '외나무 다리',
    description:
      '두 세력 결투. 진홍 약탈대가 숲 우회와 점령으로 다리를 압박한다.',
    author: '세 왕관의 섬',
    board: { cols: 12, rows: 8, tiles: b.tiles, source: { kind: 'fixed' } },
    factions: factions('azure', ['crimson'], { azure: 25, crimson: 25 }),
    units,
    rules: { maxTurns: 14, turnLimit: 'score', uniqueUnits: true },
    victoryConditions: [{ type: 'conquest' }],
    defeatConditions: [{ type: 'human-eliminated' }],
    starConditions: [
      { type: 'win' },
      { type: 'win-within-turns', turns: 10 },
      { type: 'units-lost-at-most', count: 2 },
    ],
    metadata: { tags: ['official'], recommendedFaction: 'azure', recommendedDifficulty: 'normal', estimatedMinutes: 12 },
  };
}

// ---------------- 4. 원형 요새 (중앙 요새 방어) ----------------

function ringFortress(): ScenarioDocumentV1 {
  const b = new BoardBuilder(11, 11);
  // 중앙 요새를 두른 해자(물) — 동·서 성문 한 칸씩만 열려 있다(물만이 통행 불가 지형이다)
  for (const c of [3, 4, 5, 6, 7]) b.set(c, 3, { terrain: 'water' }).set(c, 7, { terrain: 'water' });
  for (const r of [4, 6]) b.set(3, r, { terrain: 'water' }).set(7, r, { terrain: 'water' });
  b.set(2, 5, { terrain: 'forest' }).set(8, 5, { terrain: 'forest' });
  b.set(5, 5, { building: 'crown', owner: 'violet' })
    .set(5, 6, { building: 'capital', owner: 'violet' })
    .set(0, 5, { building: 'capital', owner: 'azure' })
    .set(10, 5, { building: 'capital', owner: 'crimson' })
    .set(2, 2, { building: 'village' })
    .set(8, 8, { building: 'village' });

  const units: ScenarioUnitSetup[] = [
    // 쇠뇌대 시연: 성문 접근 중장을 관통 사격
    { faction: 'violet', type: 'crossbow', ...b.at(5, 5) },
    { faction: 'violet', type: 'infantry', ...b.at(4, 5) },
    { faction: 'violet', type: 'infantry', ...b.at(6, 5) },
    { faction: 'violet', type: 'archer', ...b.at(5, 4) },
    { faction: 'violet', type: 'archer', ...b.at(4, 6) },
    { faction: 'azure', type: 'guardian', ...b.at(1, 5) },
    { faction: 'azure', type: 'infantry', ...b.at(1, 4) },
    { faction: 'azure', type: 'archer', ...b.at(0, 4) },
    { faction: 'crimson', type: 'raider', ...b.at(9, 4) },
    { faction: 'crimson', type: 'infantry', ...b.at(9, 5) },
    { faction: 'crimson', type: 'archer', ...b.at(10, 4) },
  ];

  return {
    schemaVersion: 1,
    id: 'official-ring-fortress',
    title: '원형 요새',
    description:
      '중앙 요새 방어전. 자원 쇠뇌대가 성문을 조준하고, 청람 수호대·진홍 약탈대가 맞선다.',
    author: '세 왕관의 섬',
    board: { cols: 11, rows: 11, tiles: b.tiles, source: { kind: 'fixed' } },
    factions: factions('violet', ['azure', 'crimson'], { violet: 15, azure: 30, crimson: 30 }),
    units,
    rules: { maxTurns: 12, turnLimit: 'defeat', uniqueUnits: true },
    victoryConditions: [{ type: 'survive-turns', turns: 12 }],
    defeatConditions: [{ type: 'lose-building', at: b.at(5, 5) }, { type: 'human-eliminated' }],
    starConditions: [
      { type: 'win' },
      { type: 'kills-at-least', count: 8 },
      { type: 'units-lost-at-most', count: 4 },
    ],
    metadata: { tags: ['official'], recommendedFaction: 'violet', recommendedDifficulty: 'normal', estimatedMinutes: 15 },
  };
}

// ---------------- 5. 황금 항로 (경제 목표) ----------------

function goldenRoad(): ScenarioDocumentV1 {
  const b = new BoardBuilder(14, 9);
  b.set(0, 0, { terrain: 'water' })
    .set(13, 8, { terrain: 'water' })
    .set(0, 8, { terrain: 'water' })
    .set(13, 0, { terrain: 'water' });
  for (const [c, r] of [[4, 3], [8, 5], [6, 2], [7, 6], [3, 5], [10, 3]] as const) {
    b.set(c, r, { terrain: 'forest' });
  }
  b.set(6, 0, { terrain: 'mountain' }).set(7, 8, { terrain: 'mountain' });
  b.set(0, 4, { building: 'capital', owner: 'violet' })
    .set(13, 4, { building: 'capital', owner: 'azure' })
    .set(3, 4, { building: 'village' })
    .set(5, 4, { building: 'village' })
    .set(7, 4, { building: 'village' })
    .set(9, 4, { building: 'village' })
    .set(2, 2, { building: 'village' })
    .set(11, 6, { building: 'village' });

  const units: ScenarioUnitSetup[] = [
    { faction: 'violet', type: 'infantry', ...b.at(1, 4) },
    { faction: 'violet', type: 'infantry', ...b.at(1, 3) },
    { faction: 'violet', type: 'crossbow', ...b.at(0, 3) },
    { faction: 'violet', type: 'cavalry', ...b.at(2, 4) },
    { faction: 'azure', type: 'infantry', ...b.at(12, 4) },
    { faction: 'azure', type: 'guardian', ...b.at(12, 5) },
    { faction: 'azure', type: 'archer', ...b.at(13, 5) },
    { faction: 'azure', type: 'cavalry', ...b.at(12, 3) },
  ];

  return {
    schemaVersion: 1,
    id: 'official-golden-road',
    title: '황금 항로',
    description: '경제 목표전. 가도의 여섯 마을을 확보해 14턴 안에 90점에 도달하라.',
    author: '세 왕관의 섬',
    board: { cols: 14, rows: 9, tiles: b.tiles, source: { kind: 'fixed' } },
    factions: factions('violet', ['azure'], { violet: 20, azure: 25 }),
    units,
    rules: { maxTurns: 14, turnLimit: 'defeat', uniqueUnits: true },
    victoryConditions: [{ type: 'reach-score', score: 90 }],
    defeatConditions: [{ type: 'human-eliminated' }, { type: 'turn-limit' }],
    starConditions: [
      { type: 'win' },
      { type: 'gold-at-least', amount: 60 },
      { type: 'buildings-captured-at-least', count: 4 },
    ],
    metadata: { tags: ['official'], recommendedFaction: 'violet', recommendedDifficulty: 'normal', estimatedMinutes: 15 },
  };
}

// ---------------- 6. 왕의 호위 (특정 유닛 호위) ----------------

function kingsEscort(): ScenarioDocumentV1 {
  const b = new BoardBuilder(12, 7);
  for (const [c, r] of [[4, 0], [5, 0], [8, 0], [3, 6], [9, 6]] as const) {
    b.set(c, r, { terrain: 'mountain' });
  }
  for (const [c, r] of [[3, 3], [5, 4], [7, 3], [9, 2], [5, 2], [8, 5]] as const) {
    b.set(c, r, { terrain: 'forest' });
  }
  b.set(0, 0, { terrain: 'water' }).set(11, 6, { terrain: 'water' });
  b.set(0, 3, { building: 'capital', owner: 'azure' })
    .set(10, 3, { building: 'crown' })
    .set(6, 0, { building: 'capital', owner: 'crimson' })
    .set(5, 6, { building: 'village' });

  const units: ScenarioUnitSetup[] = [
    { faction: 'azure', type: 'infantry', ...b.at(1, 3), tag: 'king' },
    // 수호대 시연: 왕 옆에서 수호 태세로 호위
    { faction: 'azure', type: 'guardian', ...b.at(2, 3) },
    { faction: 'azure', type: 'infantry', ...b.at(3, 4) },
    { faction: 'azure', type: 'archer', ...b.at(1, 2) },
    { faction: 'azure', type: 'cavalry', ...b.at(2, 4) },
    { faction: 'crimson', type: 'infantry', ...b.at(5, 1) },
    { faction: 'crimson', type: 'raider', ...b.at(6, 2) },
    { faction: 'crimson', type: 'archer', ...b.at(7, 1) },
  ];

  return {
    schemaVersion: 1,
    id: 'official-kings-escort',
    title: '왕의 호위',
    description:
      '호위전. 수호대가 왕을 지키며 동쪽 성소를 점령하라. 왕이 쓰러지면 원정은 끝난다.',
    author: '세 왕관의 섬',
    board: { cols: 12, rows: 7, tiles: b.tiles, source: { kind: 'fixed' } },
    factions: factions('azure', ['crimson'], { azure: 25, crimson: 15 }),
    units,
    rules: { maxTurns: 12, turnLimit: 'defeat', uniqueUnits: true },
    victoryConditions: [
      {
        type: 'all-of',
        conditions: [{ type: 'capture-building', at: b.at(10, 3) }, { type: 'unit-alive', tag: 'king' }],
      },
    ],
    defeatConditions: [
      { type: 'unit-dies', tag: 'king' },
      { type: 'human-eliminated' },
      { type: 'turn-limit' },
    ],
    starConditions: [
      { type: 'win' },
      { type: 'win-within-turns', turns: 9 },
      { type: 'units-lost-at-most', count: 2 },
    ],
    metadata: { tags: ['official'], recommendedFaction: 'azure', recommendedDifficulty: 'normal', estimatedMinutes: 12 },
  };
}

// ---------------- 팩 ----------------

/** 공식 시나리오 팩(불변). 목록 화면에서 플레이·복제만 가능하고 직접 수정할 수 없다. */
export const OFFICIAL_SCENARIOS: readonly ScenarioDocumentV1[] = [
  lightningDuel(),
  grandContinent(),
  narrowBridge(),
  ringFortress(),
  goldenRoad(),
  kingsEscort(),
];

export function officialScenarioById(id: string): ScenarioDocumentV1 | null {
  return OFFICIAL_SCENARIOS.find((s) => s.id === id) ?? null;
}

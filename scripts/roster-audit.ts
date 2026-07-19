// 한 줄 목적: 6병종 역할 매트릭스·세력 제한·시나리오 로스터 계약을 감사한다
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMPAIGNS } from '../src/core/campaign/missions';
import { UNIT_STATS } from '../src/core/data';
import { forecastAttack } from '../src/core/game';
import { movementCostForUnit, UNIT_DEFS, UNIT_TYPE_IDS, unitTrait } from '../src/core/units';
import { OFFICIAL_SCENARIOS } from '../src/core/scenario/official';
import { validateScenario } from '../src/core/scenario/validate';
import type { FactionId, UnitTypeId } from '../src/core/types';
import { addUnit, makeState } from '../tests/helpers';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artifacts');
mkdirSync(outDir, { recursive: true });

interface RoleRow {
  id: UnitTypeId;
  faction: FactionId | null;
  hp: number;
  atk: number;
  def: number;
  move: number;
  range: number;
  cost: number;
  traits: string[];
  role: string;
  forestCost: number;
  mountainCost: number;
  braceBonus: number;
  plunderGold: number;
  pierce: number;
}

const roles: Record<UnitTypeId, string> = {
  infantry: 'frontline',
  archer: 'ranged-harass',
  cavalry: 'mobility-strike',
  guardian: 'hold-defense',
  raider: 'flank-plunder',
  crossbow: 'armor-pierce',
};

const matrix: RoleRow[] = UNIT_TYPE_IDS.map((id) => {
  const d = UNIT_DEFS[id];
  const brace = unitTrait(id, 'brace');
  const mobility = unitTrait(id, 'terrain-mobility');
  const plunder = unitTrait(id, 'plunder');
  const pierce = unitTrait(id, 'armor-piercing');
  return {
    id,
    faction: d.faction,
    hp: d.hp,
    atk: d.atk,
    def: d.def,
    move: d.move,
    range: d.range,
    cost: d.cost,
    traits: d.traits.map((t) => t.type),
    role: roles[id],
    forestCost: mobility ? mobility.forestCost : movementCostForUnit(id, 'forest'),
    mountainCost: mobility ? mobility.mountainCost : movementCostForUnit(id, 'mountain'),
    braceBonus: brace?.defenseBonus ?? 0,
    plunderGold: plunder?.bonusGold ?? 0,
    pierce: pierce?.amount ?? 0,
  };
});

// 상성 샘플: 평원 1:1 예상 피해
const matchup: { attacker: UnitTypeId; defender: UnitTypeId; damage: number; braced?: number }[] =
  [];
for (const att of UNIT_TYPE_IDS) {
  for (const def of UNIT_TYPE_IDS) {
    const state = makeState();
    const a = addUnit(state, { faction: 'azure', type: att, q: 0, r: 0 });
    const d = addUnit(state, { faction: 'crimson', type: def, q: 1, r: 0 });
    d.movedThisTurn = false;
    const fc = forecastAttack(state, a, d);
    matchup.push({
      attacker: att,
      defender: def,
      damage: fc.damage.total,
      ...(def === 'guardian' ? { braced: fc.damage.braceDef } : {}),
    });
  }
}

// 시나리오 로스터 계약
const scenarioAudit = {
  campaigns: CAMPAIGNS.flatMap((c) =>
    c.missions.map((m) => ({
      id: m.id,
      uniqueUnits: m.scenario.rules.uniqueUnits === true,
      uniqueOnBoard: m.scenario.units.filter((u) => UNIT_DEFS[u.type].faction !== null).map(
        (u) => `${u.faction}:${u.type}`,
      ),
      errors: validateScenario(m.scenario)
        .filter((i) => i.severity === 'error')
        .map((i) => i.code),
    })),
  ),
  official: OFFICIAL_SCENARIOS.map((s) => ({
    id: s.id,
    uniqueUnits: s.rules.uniqueUnits === true,
    uniqueOnBoard: s.units.filter((u) => UNIT_DEFS[u.type].faction !== null).map(
      (u) => `${u.faction}:${u.type}`,
    ),
    errors: validateScenario(s).filter((i) => i.severity === 'error').map((i) => i.code),
  })),
};

// 게이트
const notes: string[] = [];
if (matrix.length !== 6) notes.push('expected-6-units');
if (matrix.filter((r) => r.faction === null).length !== 3) notes.push('expected-3-shared');
if (matrix.filter((r) => r.faction !== null).length !== 3) notes.push('expected-3-unique');
const g = matrix.find((r) => r.id === 'guardian')!;
const r = matrix.find((r) => r.id === 'raider')!;
const c = matrix.find((r) => r.id === 'crossbow')!;
if (g.braceBonus !== 2) notes.push('guardian-brace');
if (r.forestCost !== 1 || r.mountainCost !== 2) notes.push('raider-mobility');
if (r.plunderGold !== 5) notes.push('raider-plunder');
if (c.pierce !== 2) notes.push('crossbow-pierce');
// 공용 능력치 동결(기존 값)
if (UNIT_STATS.infantry.hp !== 12 || UNIT_STATS.archer.cost !== 35 || UNIT_STATS.cavalry.move !== 5) {
  notes.push('shared-stats-changed');
}
for (const row of [...scenarioAudit.campaigns, ...scenarioAudit.official]) {
  if (row.errors.length > 0) notes.push(`${row.id}:${row.errors.join(',')}`);
}
// 미션1 공용만, 미션2 고유 1기
for (const c of CAMPAIGNS) {
  const m1 = scenarioAudit.campaigns.find((x) => x.id === c.missions[0].id)!;
  const m2 = scenarioAudit.campaigns.find((x) => x.id === c.missions[1].id)!;
  if (m1.uniqueUnits) notes.push(`${m1.id}-m1-unique-flag`);
  if (m1.uniqueOnBoard.length > 0) notes.push(`${m1.id}-m1-unique-board`);
  if (!m2.uniqueUnits) notes.push(`${m2.id}-m2-no-flag`);
  if (m2.uniqueOnBoard.filter((x) => x.startsWith(c.faction)).length < 1) {
    notes.push(`${m2.id}-m2-no-unique`);
  }
}
const officialWithUnique = scenarioAudit.official.filter((o) => o.uniqueOnBoard.length > 0);
if (officialWithUnique.length < 3) notes.push('official-unique-maps<3');

const pass = notes.length === 0;
const summary = {
  generatedAt: new Date().toISOString(),
  pass,
  notes,
  matrix,
  matchupSample: matchup.filter(
    (m) =>
      (m.attacker === 'crossbow' && m.defender === 'guardian') ||
      (m.attacker === 'raider' && m.defender === 'archer') ||
      (m.attacker === 'guardian' && m.defender === 'cavalry') ||
      (m.attacker === 'cavalry' && m.defender === 'archer'),
  ),
  scenarioAudit,
};

writeFileSync(join(outDir, 'unit-role-matrix.json'), JSON.stringify(summary, null, 2));

const md = [
  '# 병종 역할 매트릭스',
  '',
  `- 생성: ${summary.generatedAt}`,
  `- 판정: ${pass ? 'PASS' : 'FAIL'}${notes.length ? ` (${notes.join('; ')})` : ''}`,
  '',
  '| 병종 | 세력 | HP | 공 | 방 | 이 | 사 | 비용 | 역할 | 특성 |',
  '|---|---|---:|---:|---:|---:|---:|---:|---|---|',
  ...matrix.map(
    (r) =>
      `| ${r.id} | ${r.faction ?? 'shared'} | ${r.hp} | ${r.atk} | ${r.def} | ${r.move} | ${r.range} | ${r.cost} | ${r.role} | ${r.traits.join(',') || '—'} |`,
  ),
  '',
  '## 핵심 상성 샘플(평원 forecast)',
  '',
  ...summary.matchupSample.map(
    (m) =>
      `- ${m.attacker} → ${m.defender}: 피해 ${m.damage}${m.braced ? ` (수호 태세 방어 ${m.braced})` : ''}`,
  ),
  '',
  '## 시나리오 로스터',
  '',
  `- 캠페인: ${scenarioAudit.campaigns.length} 미션`,
  `- 공식: ${scenarioAudit.official.length} 전장, 고유 배치 ${officialWithUnique.length}개`,
  '',
];
writeFileSync(join(outDir, 'unit-role-matrix.md'), md.join('\n'));
console.log(md.join('\n'));
if (!pass) process.exit(1);

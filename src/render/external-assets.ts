// 한 줄 목적: 외부 이미지 에셋 교체 지점 — AssetId에 URL을 등록하면 코드 생성 그래픽 대신 사용된다

/**
 * 외부 PNG·SVG 에셋을 등록하는 곳이다.
 * 키는 AssetId, 값은 이미지 URL(정적 파일은 public/ 아래에 두고 './파일명'으로 참조).
 *
 * 예시:
 *   'terrain.plains': './art/plains.png',
 *   'unit.infantry.azure': './art/knight-blue.svg',
 *
 * 등록된 ID는 게임 로직·렌더러 수정 없이 해당 이미지로 대체된다.
 */
export const EXTERNAL_ASSETS: Record<string, string> = {
  'terrain.plains': './art/phase1/terrain/plains.png',
  'terrain.forest': './art/phase1/terrain/forest.png',
  'terrain.mountain': './art/phase1/terrain/mountain.png',
  'terrain.water': './art/phase1/terrain/water.png',
  'building.capital.azure': './art/phase1/buildings/capital-azure.png',
  'building.capital.crimson': './art/phase1/buildings/capital-crimson.png',
  'building.capital.violet': './art/phase1/buildings/capital-violet.png',
  'building.village.neutral': './art/phase1/buildings/village-neutral.png',
  'building.village.azure': './art/phase1/buildings/village-azure.png',
  'building.village.crimson': './art/phase1/buildings/village-crimson.png',
  'building.village.violet': './art/phase1/buildings/village-violet.png',
  'building.crown.neutral': './art/phase1/buildings/crown-neutral.png',
  'building.crown.azure': './art/phase1/buildings/crown-azure.png',
  'building.crown.crimson': './art/phase1/buildings/crown-crimson.png',
  'building.crown.violet': './art/phase1/buildings/crown-violet.png',
  'unit.infantry.azure': './art/phase2a/units/infantry-azure.png',
  'unit.infantry.crimson': './art/phase2a/units/infantry-crimson.png',
  'unit.infantry.violet': './art/phase2a/units/infantry-violet.png',
};

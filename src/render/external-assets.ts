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
export const EXTERNAL_ASSETS: Record<string, string> = {};

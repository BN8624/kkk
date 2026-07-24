// 한 줄 목적: 카메라 fit resize 리스너를 호스트별로 등록·교체·정리한다(전체 off 금지)

/**
 * 씬(또는 소유 객체)별 resize 맞춤 콜백.
 * scale.off('resize')로 전체를 지우지 않고 자신이 등록한 콜백만 교체·정리한다.
 */
const cameraFitByOwner = new WeakMap<object, () => void>();

export interface ResizeListenerHost {
  on: (event: string, fn: () => void) => void;
  off: (event: string, fn?: () => void) => void;
}

/** 테스트·진단용: 해당 소유 객체에 등록된 카메라 fit 콜백. */
export function getCameraFitHandler(owner: object): (() => void) | undefined {
  return cameraFitByOwner.get(owner);
}

/**
 * resize 호스트에 fit 콜백을 등록한다. 기존 등록분만 제거한 뒤 교체한다.
 * 다른 모듈이 등록한 resize 리스너는 건드리지 않는다.
 */
export function registerCameraFit(
  host: ResizeListenerHost,
  fit: () => void,
  owner: object = host,
): void {
  const prev = cameraFitByOwner.get(owner);
  if (prev) host.off('resize', prev);
  host.on('resize', fit);
  cameraFitByOwner.set(owner, fit);
}

/** 씬 종료·보드 재설정 시 자신이 등록한 resize 콜백만 제거한다. */
export function clearCameraFit(host: Pick<ResizeListenerHost, 'off'>, owner: object = host): void {
  const prev = cameraFitByOwner.get(owner);
  if (!prev) return;
  host.off('resize', prev);
  cameraFitByOwner.delete(owner);
}

// 한 줄 목적: 카메라 fit resize 리스너가 다른 리스너를 지우지 않고 누적되지 않는지 검증한다
import { describe, expect, it, vi } from 'vitest';
import {
  clearCameraFit,
  getCameraFitHandler,
  registerCameraFit,
} from '../src/render/camera-fit-lifecycle';

function makeScaleHost() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    listeners,
    on(event: string, fn: () => void) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(fn);
    },
    off(event: string, fn?: () => void) {
      const set = listeners.get(event);
      if (!set) return;
      if (fn) set.delete(fn);
      else set.clear();
    },
    emit(event: string) {
      for (const fn of listeners.get(event) ?? []) fn();
    },
    count(event: string) {
      return listeners.get(event)?.size ?? 0;
    },
  };
}

describe('camera fit resize lifecycle', () => {
  it('다른 resize 리스너를 제거하지 않는다', () => {
    const scale = makeScaleHost();
    const other = vi.fn();
    scale.on('resize', other);
    const owner = {};
    const fit = vi.fn();
    registerCameraFit(scale, fit, owner);
    expect(scale.count('resize')).toBe(2);
    scale.emit('resize');
    expect(other).toHaveBeenCalledTimes(1);
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('반복 등록 후 콜백이 누적되지 않는다', () => {
    const scale = makeScaleHost();
    const owner = {};
    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();
    registerCameraFit(scale, first, owner);
    registerCameraFit(scale, second, owner);
    registerCameraFit(scale, third, owner);
    expect(scale.count('resize')).toBe(1);
    expect(getCameraFitHandler(owner)).toBe(third);
    scale.emit('resize');
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(third).toHaveBeenCalledTimes(1);
  });

  it('resize 시 등록된 fit 콜백이 실행된다', () => {
    const scale = makeScaleHost();
    const owner = {};
    const fit = vi.fn();
    registerCameraFit(scale, fit, owner);
    scale.emit('resize');
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('clearCameraFit은 자신 콜백만 제거한다', () => {
    const scale = makeScaleHost();
    const other = vi.fn();
    scale.on('resize', other);
    const owner = {};
    registerCameraFit(scale, vi.fn(), owner);
    clearCameraFit(scale, owner);
    expect(scale.count('resize')).toBe(1);
    expect(getCameraFitHandler(owner)).toBeUndefined();
    scale.emit('resize');
    expect(other).toHaveBeenCalledTimes(1);
  });
});

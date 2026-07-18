// 한 줄 목적: 저장 직렬화·복원과 손상 데이터 안전 처리를 검증한다
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/core/game';
import { deserialize, SAVE_VERSION, serialize } from '../src/core/save';

describe('save', () => {
  it('직렬화 후 복원하면 동일한 상태가 된다', () => {
    const state = newGame(777);
    const restored = deserialize(serialize(state));
    expect(restored).toEqual(state);
  });

  it('손상된 JSON은 null을 반환한다', () => {
    expect(deserialize('not json')).toBeNull();
    expect(deserialize('{}')).toBeNull();
    expect(deserialize('{"version":1}')).toBeNull();
  });

  it('버전이 다르면 null을 반환한다', () => {
    const state = newGame(1);
    const raw = JSON.stringify({ version: SAVE_VERSION + 1, state });
    expect(deserialize(raw)).toBeNull();
  });

  it('필수 필드가 빠지면 null을 반환한다', () => {
    const state = newGame(1) as unknown as Record<string, unknown>;
    delete state.factions;
    const raw = JSON.stringify({ version: SAVE_VERSION, state });
    expect(deserialize(raw)).toBeNull();
  });
});

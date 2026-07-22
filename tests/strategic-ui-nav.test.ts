// 한 줄 목적: 전략 모드 AppMode·저장 키 분리·백업 progress 포함을 단위 검증한다
import { describe, expect, it } from 'vitest';
import { SAVE_KEY } from '../src/core/save';
import {
  STRATEGIC_BATTLE_SAVE_KEY,
  buildStrategicBattleSave,
  serializeStrategicBattleSave,
  deserializeStrategicBattleSave,
} from '../src/strategic/battle-session-save';
import {
  STRATEGIC_SAVE_KEY,
  serializeStrategic,
  deserializeStrategic,
} from '../src/strategic/save';
import { createStrategicState } from '../src/strategic/state';
import { newGame } from '../src/core/game';
import { createBackup, parseBackup } from '../src/storage/backup';
import type { StorageLike } from '../src/storage/backup';
import { strategicRegionName } from '../src/ui/strategic/map-view';
import { setLocale } from '../src/i18n';

describe('전략 UI·내비게이션 계약', () => {
  it('저장 키가 일반 전술 저장과 분리된다', () => {
    expect(STRATEGIC_SAVE_KEY).toBe('three-crowns-strategy-save');
    expect(STRATEGIC_BATTLE_SAVE_KEY).toBe('three-crowns-strategy-battle-save');
    expect(STRATEGIC_SAVE_KEY).not.toBe(SAVE_KEY);
    expect(STRATEGIC_BATTLE_SAVE_KEY).not.toBe(SAVE_KEY);
    expect(STRATEGIC_BATTLE_SAVE_KEY).not.toBe(STRATEGIC_SAVE_KEY);
  });

  it('지역 이름 번역 키가 12개 모두 존재한다', () => {
    setLocale('ko');
    const ids = [
      'r00',
      'r01',
      'r02',
      'r03',
      'r04',
      'r05',
      'r06',
      'r07',
      'r08',
      'r09',
      'r10',
      'r11',
    ];
    for (const id of ids) {
      const name = strategicRegionName(id);
      expect(name).not.toBe(id);
      expect(name.length).toBeGreaterThan(0);
    }
    setLocale('en');
    expect(strategicRegionName('r00')).toMatch(/Azure|Capital/i);
    setLocale('ko');
  });

  it('전략 전투 저장 직렬화가 일반 전술 JSON과 섞이지 않는다', () => {
    const strategic = createStrategicState(1, 'azure');
    // pending 없는 상태에서도 battle save 구조 검증
    const tactical = newGame(1, { humanFaction: 'azure' });
    const save = buildStrategicBattleSave(strategic, 'battle-test', tactical);
    const raw = serializeStrategicBattleSave(save);
    expect(deserializeStrategic(raw)).toBeNull();
    expect(deserializeStrategicBattleSave(raw)?.battleId).toBe('battle-test');
    expect(deserializeStrategic(serializeStrategic(strategic))).not.toBeNull();
  });

  it('backup progress 범주에 전략 저장 키가 포함된다', async () => {
    const memory: Record<string, string> = {};
    const storage: StorageLike = {
      getItem: (k) => memory[k] ?? null,
      setItem: (k, v) => {
        memory[k] = v;
      },
      removeItem: (k) => {
        delete memory[k];
      },
    };
    const strategic = createStrategicState(5, 'crimson');
    memory[STRATEGIC_SAVE_KEY] = serializeStrategic(strategic);
    const tactical = newGame(2, { humanFaction: 'crimson' });
    memory[STRATEGIC_BATTLE_SAVE_KEY] = serializeStrategicBattleSave(
      buildStrategicBattleSave(strategic, 'bid', tactical),
    );

    const backup = await createBackup(['progress'], {
      list: async () => [],
      get: async () => null,
      put: async () => undefined,
      remove: async () => undefined,
    } as never, storage);

    expect(backup.localStorage[STRATEGIC_SAVE_KEY]).toBeTruthy();
    expect(backup.localStorage[STRATEGIC_BATTLE_SAVE_KEY]).toBeTruthy();

    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);

    // 손상 전략 저장 거부
    const evil = {
      ...backup,
      localStorage: {
        ...backup.localStorage,
        [STRATEGIC_SAVE_KEY]: '{"version":1,"state":{"broken":true}}',
      },
    };
    const bad = parseBackup(JSON.stringify(evil));
    expect(bad.ok).toBe(false);
  });
});

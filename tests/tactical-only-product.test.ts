// 한 줄 목적: 전략 레이어 제거 후 전술 전용 제품 경계를 회귀 고정한다
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EN } from '../src/i18n/en';
import { KO } from '../src/i18n/ko';
import { newGame } from '../src/core/game';
import {
  clearSave,
  deserialize,
  loadGame,
  SAVE_KEY,
  saveGame,
  serialize,
} from '../src/core/save';
import {
  createBackup,
  parseBackup,
  type StorageLike,
} from '../src/storage/backup';
import { MemoryDocumentStore } from '../src/storage/docstore';
import { activeCleanupCount, Lifetime } from '../src/app/lifecycle';
import { recordGame, emptyRecords } from '../src/core/records';

const STRATEGY_SAVE_KEY = 'three-crowns-strategy-save';
const STRATEGY_BATTLE_KEY = 'three-crowns-strategy-battle-save';
const STRATEGIC_RESIDUE =
  /Strategic|strategic|STRATEGIC_LAYER|strategy-save|strategy-battle|three-crowns-strategy/;

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function collectTsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collectTsFiles(path, out);
    else if (path.endsWith('.ts') || path.endsWith('.md')) out.push(path);
  }
  return out;
}

function read(path: string): string {
  return readFileSync(resolve(path), 'utf8');
}

describe('전술 전용 제품 경계 (전략 레이어 철회)', () => {
  afterEach(() => {
    clearSave();
  });

  it('AppMode에 strategic이 없다', () => {
    const mode = read('src/app/mode.ts');
    expect(mode).not.toMatch(/['"]strategic['"]/);
    expect(mode).not.toMatch(/\bstrategic\b/);
  });

  it('AppNavigation에 전략 계약이 없다', () => {
    const nav = read('src/app/navigation.ts');
    expect(nav).not.toMatch(/toStrategic|StrategicFlow|StrategicBattle|strategicBattle/);
    expect(nav).not.toMatch(/\bstrategic\b/);
  });

  it('PlayController에 전략 전투 분기가 없다', () => {
    const play = read('src/controllers/play-controller.ts');
    expect(play).not.toMatch(/strategicBattle|strategicBattleId|saveStrategicBattle|loadStrategic/);
    expect(play).not.toMatch(/\bstrategic\b/);
  });

  it('타이틀에 전략 버튼·핸들러가 없다', () => {
    const title = read('src/ui/title/index.ts');
    expect(title).not.toMatch(/onStrategic|hasStrategic|btn-strategic|strategic/);
    expect(title).toMatch(/onNewGame|onCampaign|onDaily|onEditor/);
  });

  it('i18n에 strategic.* 키가 없다', () => {
    const keys = [...Object.keys(KO), ...Object.keys(EN)];
    expect(keys.filter((k) => k.startsWith('strategic.') || k.includes('strategic'))).toEqual([]);
  });

  it('전략 경로·컨트롤러 파일이 존재하지 않는다', () => {
    expect(existsSync(resolve('src/strategic'))).toBe(false);
    expect(existsSync(resolve('src/ui/strategic'))).toBe(false);
    expect(existsSync(resolve('src/controllers/strategic-controller.ts'))).toBe(false);
    expect(existsSync(resolve('docs/STRATEGIC_LAYER_V0.md'))).toBe(false);
    expect(existsSync(resolve('artifacts/strategic-map'))).toBe(false);
  });

  it('src·tests·README·docs에서 전략 잔재 검색이 0건이다', () => {
    const roots = ['src', 'tests', 'README.md', 'docs'];
    const hits: string[] = [];
    for (const root of roots) {
      const path = resolve(root);
      if (!existsSync(path)) continue;
      if (statSync(path).isFile()) {
        const text = readFileSync(path, 'utf8');
        if (STRATEGIC_RESIDUE.test(text)) hits.push(root);
        continue;
      }
      for (const file of collectTsFiles(path)) {
        const text = readFileSync(file, 'utf8');
        // 이 회귀 테스트 파일 자체는 검색 예외(잔재 검출 목적 문자열 포함)
        if (file.replace(/\\/g, '/').endsWith('tests/tactical-only-product.test.ts')) continue;
        if (STRATEGIC_RESIDUE.test(text)) hits.push(file);
      }
    }
    expect(hits).toEqual([]);
  });

  it('고아 전략 localStorage 키가 있어도 일반 전술 저장 로드가 정상이다', () => {
    const state = newGame(42);
    const raw = serialize(state);
    const store = new MemoryStorage();
    store.setItem(STRATEGY_SAVE_KEY, '{"schemaVersion":1,"orphaned":true}');
    store.setItem(STRATEGY_BATTLE_KEY, '{"schemaVersion":1,"battleId":"x"}');
    store.setItem(SAVE_KEY, raw);

    // 전략 키는 앱이 더 이상 읽지 않음 — 일반 저장만 deserialize
    expect(store.getItem(STRATEGY_SAVE_KEY)).toBeTruthy();
    expect(store.getItem(STRATEGY_BATTLE_KEY)).toBeTruthy();
    const restored = deserialize(store.getItem(SAVE_KEY)!);
    expect(restored).not.toBeNull();
    expect(restored!.seed).toBe(42);
    expect(restored!.config.mode).toBe('quick');
  });

  it('일반 전술 저장·이어하기 직렬화가 정상이다', () => {
    const state = newGame(99, { humanFaction: 'azure', difficulty: 'normal' });
    state.turn = 3;
    const raw = serialize(state);
    const restored = deserialize(raw);
    expect(restored).not.toBeNull();
    expect(restored!.turn).toBe(3);
    expect(restored!.config.humanFaction).toBe('azure');

    // localStorage 경로(가능 시)
    saveGame(state);
    const loaded = loadGame();
    if (typeof localStorage !== 'undefined') {
      expect(loaded).not.toBeNull();
      expect(loaded!.turn).toBe(3);
    }
  });

  it('backup export에 전략 키가 포함되지 않고, 전략 키 주입 백업은 거부된다', async () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, serialize(newGame(1)));
    storage.setItem(STRATEGY_SAVE_KEY, '{"orphaned":true}');
    storage.setItem(STRATEGY_BATTLE_KEY, '{"orphaned":true}');
    const store = new MemoryDocumentStore();

    const backup = await createBackup(['progress', 'preferences'], store, storage);
    expect(backup.localStorage[STRATEGY_SAVE_KEY]).toBeUndefined();
    expect(backup.localStorage[STRATEGY_BATTLE_KEY]).toBeUndefined();
    expect(backup.localStorage[SAVE_KEY]).toBeTruthy();
    expect(Object.keys(backup.localStorage).some((k) => k.includes('strategy'))).toBe(false);

    const injected = {
      ...backup,
      localStorage: {
        ...backup.localStorage,
        [STRATEGY_SAVE_KEY]: '{"orphaned":true}',
      },
    };
    expect(parseBackup(JSON.stringify(injected))).toEqual({ ok: false, code: 'invalid' });
  });

  it('일반 게임 종료 기록(recordGame)이 정상 생성된다', () => {
    const state = newGame(7);
    state.over = true;
    state.winner = 'azure';
    state.turn = 5;
    const outcome = recordGame(emptyRecords(), state);
    expect(outcome.records.plays).toBe(1);
    expect(outcome.records.recent).toHaveLength(1);
    expect(outcome.records.recent[0].outcome).toBe('win');
    expect(outcome.records.recent[0].mode).toBe('quick');
  });

  it('테스트 플레이는 저장을 오염시키지 않는 분기가 유지된다', () => {
    const play = read('src/controllers/play-controller.ts');
    expect(play).toMatch(/testPlay/);
    // 계약: 테스트 플레이는 실제 저장 직전에 차단된다. 특정 한 줄 표현이 아니라
    // 가드 자체(조기 반환 또는 !testPlay 부정 가드가 saveGame을 막는 것)를 확인해
    // 동작이 같은 정당한 리팩터링에는 깨지지 않게 한다.
    expect(play).toMatch(
      /if \(this\.testPlay\) return|!this\.testPlay[\s\S]{0,120}saveGame\(/,
    );
    expect(play).toMatch(/abandonTestPlay/);
  });

  it('Lifetime dispose 후 activeCleanupCount가 0으로 돌아온다', () => {
    const before = activeCleanupCount();
    const life = new Lifetime();
    let cleaned = 0;
    life.defer(() => {
      cleaned++;
    });
    expect(activeCleanupCount()).toBe(before + 1);
    life.dispose();
    expect(cleaned).toBe(1);
    expect(activeCleanupCount()).toBe(before);
  });

  it('app-shell·backup·README에 전략 잔재가 없다', () => {
    for (const path of [
      'src/app/app-shell.ts',
      'src/storage/backup.ts',
      'README.md',
      'src/i18n/en.ts',
      'src/i18n/ko.ts',
    ]) {
      expect(read(path), path).not.toMatch(STRATEGIC_RESIDUE);
    }
  });
});

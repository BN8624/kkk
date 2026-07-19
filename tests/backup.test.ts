// 한 줄 목적: 선택 백업·미래 버전 거부·병합·교체·복구 실패 자동 롤백을 메모리 저장소로 검증한다
import { describe, expect, it } from 'vitest';
import { MemoryDocumentStore, type DocStoreName } from '../src/storage/docstore';
import { emptyDocument } from '../src/editor/new-doc';
import {
  BACKUP_PRODUCT,
  createBackup,
  parseBackup,
  restoreBackup,
  type BackupDocumentV1,
  type StorageLike,
} from '../src/storage/backup';

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

class FailOnceStore extends MemoryDocumentStore {
  private fail = true;
  override put<T>(store: DocStoreName, id: string, data: T, opts?: { ifAbsent?: boolean }) {
    if (id === 'incoming' && this.fail) {
      this.fail = false;
      return Promise.reject(new Error('injected write failure'));
    }
    return super.put(store, id, data, opts);
  }
}

function backupWithDraft(id: string): BackupDocumentV1 {
  return {
    schemaVersion: 1,
    product: BACKUP_PRODUCT,
    createdAt: '2026-07-19T00:00:00.000Z',
    categories: ['scenarios'],
    localStorage: {},
    documents: { 'scenario-drafts': [{ id, data: { title: id } }] },
  };
}

describe('전체 데이터 백업·복구', () => {
  it('선택한 범주의 로컬 항목과 문서만 백업하고 미리보기를 만든다', async () => {
    const storage = new MemoryStorage();
    storage.setItem('three-crowns-settings', '{"soundOn":false}');
    storage.setItem('three-crowns-locale', 'en');
    storage.setItem('three-crowns-records', '{"plays":4}');
    const store = new MemoryDocumentStore();
    await store.put('scenario-drafts', 'draft-a', emptyDocument('draft-a'));
    await store.put('replays', 'replay-a', { replayId: 'A' });

    const backup = await createBackup(['preferences', 'scenarios'], store, storage);
    expect(backup.categories).toEqual(['preferences', 'scenarios']);
    expect(backup.localStorage['three-crowns-settings']).toBeTruthy();
    expect(backup.localStorage['three-crowns-records']).toBeUndefined();
    expect(backup.documents['scenario-drafts']).toHaveLength(1);
    expect(backup.documents.replays).toBeUndefined();

    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.preview).toMatchObject({ localEntries: 2, documents: 1 });
  });

  it('미래 버전과 허용되지 않은 저장 키를 안전하게 거부한다', () => {
    const future = { ...backupWithDraft('a'), schemaVersion: 2 };
    expect(parseBackup(JSON.stringify(future))).toEqual({ ok: false, code: 'future-version' });
    const injected = backupWithDraft('a');
    injected.localStorage.evil = 'value';
    expect(parseBackup(JSON.stringify(injected))).toEqual({ ok: false, code: 'invalid' });
  });

  it('병합은 기존 문서를 유지하고 교체는 선택 범주만 바꾼다', async () => {
    const storage = new MemoryStorage();
    const store = new MemoryDocumentStore();
    await store.put('scenario-drafts', 'existing', { title: 'Existing' });
    await store.put('replays', 'keep-replay', { replayId: 'keep' });

    await restoreBackup(backupWithDraft('incoming'), 'merge', store, storage);
    expect(await store.get('scenario-drafts', 'existing')).not.toBeNull();
    expect(await store.get('scenario-drafts', 'incoming')).not.toBeNull();

    await restoreBackup(backupWithDraft('replacement'), 'replace', store, storage);
    expect(await store.get('scenario-drafts', 'existing')).toBeNull();
    expect(await store.get('scenario-drafts', 'incoming')).toBeNull();
    expect(await store.get('scenario-drafts', 'replacement')).not.toBeNull();
    expect(await store.get('replays', 'keep-replay')).not.toBeNull();
  });

  it('복구 쓰기 실패 시 자동 복구 지점으로 기존 데이터를 되돌린다', async () => {
    const storage = new MemoryStorage();
    const store = new FailOnceStore();
    await store.put('scenario-drafts', 'existing', { title: 'Existing' });

    await expect(restoreBackup(backupWithDraft('incoming'), 'replace', store, storage)).rejects.toThrow();
    expect(await store.get('scenario-drafts', 'existing')).not.toBeNull();
    expect(await store.get('scenario-drafts', 'incoming')).toBeNull();
  });
});

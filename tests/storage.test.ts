// 한 줄 목적: 문서 저장소 메모리 어댑터의 목록·읽기·쓰기·삭제·충돌 처리를 검증한다
import { describe, expect, it } from 'vitest';
import {
  DocStoreError,
  MemoryDocumentStore,
  estimateSize,
  newDocId,
} from '../src/storage/docstore';

describe('MemoryDocumentStore', () => {
  it('put 후 get으로 동일한 데이터를 읽는다', async () => {
    const store = new MemoryDocumentStore();
    await store.put('scenario-drafts', 'a', { title: '테스트', n: 3 });
    const rec = await store.get<{ title: string; n: number }>('scenario-drafts', 'a');
    expect(rec).not.toBeNull();
    expect(rec!.data.title).toBe('테스트');
    expect(rec!.updatedAt).toBeTruthy();
    expect(rec!.size).toBe(estimateSize({ title: '테스트', n: 3 }));
  });

  it('없는 문서는 null을 반환한다', async () => {
    const store = new MemoryDocumentStore();
    expect(await store.get('replays', 'nope')).toBeNull();
  });

  it('list는 저장된 문서 요약을 반환하고 remove로 삭제된다', async () => {
    const store = new MemoryDocumentStore();
    await store.put('replays', 'r1', { x: 1 });
    await store.put('replays', 'r2', { x: 2 });
    expect((await store.list('replays')).map((s) => s.id).sort()).toEqual(['r1', 'r2']);
    await store.remove('replays', 'r1');
    expect((await store.list('replays')).map((s) => s.id)).toEqual(['r2']);
  });

  it('store 간 데이터가 분리된다', async () => {
    const store = new MemoryDocumentStore();
    await store.put('scenario-drafts', 'a', { x: 1 });
    expect(await store.get('installed-scenarios', 'a')).toBeNull();
  });

  it('ifAbsent 저장은 ID 충돌 시 conflict 오류를 던진다', async () => {
    const store = new MemoryDocumentStore();
    await store.put('scenario-drafts', 'a', { x: 1 });
    await expect(store.put('scenario-drafts', 'a', { x: 2 }, { ifAbsent: true })).rejects.toThrow(
      DocStoreError,
    );
    // 기본 put은 덮어쓴다
    await store.put('scenario-drafts', 'a', { x: 3 });
    expect((await store.get<{ x: number }>('scenario-drafts', 'a'))!.data.x).toBe(3);
  });

  it('저장 후 원본 객체를 수정해도 저장본이 오염되지 않는다', async () => {
    const store = new MemoryDocumentStore();
    const data = { list: [1, 2] };
    await store.put('editor-autosave', 'a', data);
    data.list.push(3);
    expect((await store.get<{ list: number[] }>('editor-autosave', 'a'))!.data.list).toEqual([1, 2]);
  });

  it('newDocId는 접두사를 갖고 호출마다 달라진다', () => {
    const a = newDocId('replay');
    const b = newDocId('replay');
    expect(a.startsWith('replay-')).toBe(true);
    expect(a).not.toBe(b);
  });
});

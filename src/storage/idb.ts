// 한 줄 목적: DB 버전·마이그레이션·오류 처리를 갖춘 IndexedDB 문서 저장소 구현을 제공한다
import {
  DOC_STORE_NAMES,
  DocStoreError,
  estimateSize,
  type DocRecord,
  type DocStoreName,
  type DocSummary,
  type DocumentStore,
} from './docstore';

export const DB_NAME = 'three-crowns-db';
/** object store 추가·변경 시 반드시 버전을 올리고 upgrade에서 마이그레이션한다. */
export const DB_VERSION = 1;

function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'QuotaExceededError';
}

function toStoreError(err: unknown, fallback: string): DocStoreError {
  if (err instanceof DocStoreError) return err;
  if (isQuotaError(err)) return new DocStoreError('quota', '저장 공간이 부족합니다');
  const msg = err instanceof Error ? err.message : fallback;
  return new DocStoreError('tx-failed', msg);
}

/** IndexedDB 기반 문서 저장소. 사용 불가 환경에서는 open이 unavailable 오류로 거부된다. */
export class IdbDocumentStore implements DocumentStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new DocStoreError('unavailable', 'IndexedDB를 사용할 수 없는 환경입니다'));
        return;
      }
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(toStoreError(err, 'IndexedDB open 실패'));
        return;
      }
      req.onupgradeneeded = () => {
        // 마이그레이션: 없는 store만 생성한다(기존 데이터 보존)
        const db = req.result;
        for (const name of DOC_STORE_NAMES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' });
          }
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // 다른 탭이 버전을 올리면 이 연결을 닫아 업그레이드를 막지 않는다
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(toStoreError(req.error, 'IndexedDB open 실패'));
      req.onblocked = () => reject(new DocStoreError('unavailable', '다른 탭이 DB를 사용 중입니다'));
    });
    // 실패한 open은 다음 호출에서 재시도할 수 있게 캐시를 비운다
    this.dbPromise.catch(() => {
      this.dbPromise = null;
    });
    return this.dbPromise;
  }

  private async tx<T>(
    store: DocStoreName,
    mode: IDBTransactionMode,
    run: (os: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let req: IDBRequest<T>;
      try {
        const t = db.transaction(store, mode);
        t.onabort = () => reject(toStoreError(t.error, '트랜잭션이 중단되었습니다'));
        req = run(t.objectStore(store));
      } catch (err) {
        reject(toStoreError(err, '트랜잭션 시작 실패'));
        return;
      }
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(toStoreError(req.error, '요청 실패'));
    });
  }

  async list(store: DocStoreName): Promise<DocSummary[]> {
    const all = await this.tx<DocRecord[]>(store, 'readonly', (os) => os.getAll() as IDBRequest<DocRecord[]>);
    return all
      .map(({ id, updatedAt, size }) => ({ id, updatedAt, size }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async get<T>(store: DocStoreName, id: string): Promise<DocRecord<T> | null> {
    const rec = await this.tx<DocRecord<T> | undefined>(
      store,
      'readonly',
      (os) => os.get(id) as IDBRequest<DocRecord<T> | undefined>,
    );
    return rec ?? null;
  }

  async put<T>(
    store: DocStoreName,
    id: string,
    data: T,
    opts?: { ifAbsent?: boolean },
  ): Promise<DocRecord<T>> {
    if (opts?.ifAbsent) {
      const existing = await this.get(store, id);
      if (existing) throw new DocStoreError('conflict', `document already exists: ${id}`);
    }
    const rec: DocRecord<T> = {
      id,
      updatedAt: new Date().toISOString(),
      size: estimateSize(data),
      data,
    };
    await this.tx(store, 'readwrite', (os) => os.put(rec));
    return rec;
  }

  async remove(store: DocStoreName, id: string): Promise<void> {
    await this.tx(store, 'readwrite', (os) => os.delete(id));
  }
}

let shared: DocumentStore | null = null;

/** 앱 전역 문서 저장소(브라우저: IndexedDB). 테스트에서는 setDocumentStore로 교체한다. */
export function documentStore(): DocumentStore {
  if (!shared) shared = new IdbDocumentStore();
  return shared;
}

export function setDocumentStore(store: DocumentStore): void {
  shared = store;
}

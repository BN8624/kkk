// 한 줄 목적: 시나리오·리플레이·캠페인 문서 저장소의 공용 인터페이스와 테스트용 메모리 어댑터를 정의한다

/** 문서 저장소의 object store 이름(역할별로 분리). */
export type DocStoreName =
  | 'scenario-drafts' // 에디터 초안
  | 'installed-scenarios' // 가져오기·설치된 커스텀 시나리오
  | 'replays' // 리플레이 문서
  | 'campaign-progress' // 캠페인 진행
  | 'editor-autosave'; // 에디터 자동 저장(원본과 분리)

export const DOC_STORE_NAMES: DocStoreName[] = [
  'scenario-drafts',
  'installed-scenarios',
  'replays',
  'campaign-progress',
  'editor-autosave',
];

export interface DocRecord<T = unknown> {
  id: string;
  /** 최근 수정 시각(ISO) */
  updatedAt: string;
  /** 직렬화 크기(바이트 근사) — 목록 표시용 */
  size: number;
  data: T;
}

export interface DocSummary {
  id: string;
  updatedAt: string;
  size: number;
}

export type DocStoreErrorCode = 'unavailable' | 'quota' | 'tx-failed' | 'conflict';

export class DocStoreError extends Error {
  code: DocStoreErrorCode;
  constructor(code: DocStoreErrorCode, message: string) {
    super(message);
    this.name = 'DocStoreError';
    this.code = code;
  }
}

/** 문서 저장소 공용 인터페이스. IndexedDB 구현과 메모리 구현이 동일하게 동작한다. */
export interface DocumentStore {
  list(store: DocStoreName): Promise<DocSummary[]>;
  get<T>(store: DocStoreName, id: string): Promise<DocRecord<T> | null>;
  /** 저장(기본 덮어쓰기). ifAbsent가 true인데 이미 존재하면 conflict 오류. */
  put<T>(store: DocStoreName, id: string, data: T, opts?: { ifAbsent?: boolean }): Promise<DocRecord<T>>;
  remove(store: DocStoreName, id: string): Promise<void>;
}

/** 접두사 기반 충돌 회피 문서 ID를 만든다(시각 + 무작위). */
export function newDocId(prefix: string, now: Date = new Date()): string {
  const t = now.getTime().toString(36);
  const r = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(5, '0');
  return `${prefix}-${t}-${r}`;
}

/** 데이터의 직렬화 크기를 추정한다(직렬화 불가 시 0). */
export function estimateSize(data: unknown): number {
  try {
    return JSON.stringify(data)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** 테스트·IndexedDB 불가 환경용 메모리 어댑터. */
export class MemoryDocumentStore implements DocumentStore {
  private stores = new Map<DocStoreName, Map<string, DocRecord>>();

  private storeMap(store: DocStoreName): Map<string, DocRecord> {
    let m = this.stores.get(store);
    if (!m) {
      m = new Map();
      this.stores.set(store, m);
    }
    return m;
  }

  list(store: DocStoreName): Promise<DocSummary[]> {
    const out = [...this.storeMap(store).values()]
      .map(({ id, updatedAt, size }) => ({ id, updatedAt, size }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return Promise.resolve(out);
  }

  get<T>(store: DocStoreName, id: string): Promise<DocRecord<T> | null> {
    const rec = this.storeMap(store).get(id);
    // 저장 시 구조 복사했으므로 그대로 반환해도 원본 오염이 없다
    return Promise.resolve(rec ? (rec as DocRecord<T>) : null);
  }

  put<T>(
    store: DocStoreName,
    id: string,
    data: T,
    opts?: { ifAbsent?: boolean },
  ): Promise<DocRecord<T>> {
    const m = this.storeMap(store);
    if (opts?.ifAbsent && m.has(id)) {
      return Promise.reject(new DocStoreError('conflict', `document already exists: ${id}`));
    }
    const rec: DocRecord<T> = {
      id,
      updatedAt: new Date().toISOString(),
      size: estimateSize(data),
      data: JSON.parse(JSON.stringify(data)) as T,
    };
    m.set(id, rec as DocRecord);
    return Promise.resolve(rec);
  }

  remove(store: DocStoreName, id: string): Promise<void> {
    this.storeMap(store).delete(id);
    return Promise.resolve();
  }
}

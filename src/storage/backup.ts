// 한 줄 목적: 로컬 설정·진행·시나리오·리플레이를 선택 백업하고 검사·미리보기·병합·교체·실패 롤백으로 복구한다
import { CAMPAIGN_PROGRESS_KEY } from '../core/campaign/progress';
import { safeJsonParse, type StructureLimits } from '../core/decode';
import { RECORDS_KEY } from '../core/records';
import { decodeReplayDocument } from '../core/replay-decode';
import { SAVE_KEY, SETTINGS_KEY } from '../core/save';
import { parseScenarioDocument } from '../core/scenario/validate';
import { LOCALE_STORAGE_KEY } from '../i18n';
import { DOC_STORE_NAMES, type DocStoreName, type DocumentStore } from './docstore';
import { documentStore } from './idb';

export const BACKUP_VERSION = 1;
export const BACKUP_PRODUCT = 'three-crowns-island';
export const BACKUP_MAX_BYTES = 25 * 1024 * 1024;

export type BackupCategory = 'preferences' | 'progress' | 'scenarios' | 'replays';
export type RestoreMode = 'merge' | 'replace';

export const BACKUP_CATEGORIES: BackupCategory[] = [
  'preferences',
  'progress',
  'scenarios',
  'replays',
];

const FAVORITES_KEY = 'three-crowns-replay-favs';
const LOCAL_KEYS: Record<Exclude<BackupCategory, 'scenarios' | 'replays'>, string[]> = {
  preferences: [SETTINGS_KEY, LOCALE_STORAGE_KEY, FAVORITES_KEY],
  progress: [SAVE_KEY, RECORDS_KEY, CAMPAIGN_PROGRESS_KEY],
};
const STORE_KEYS: Record<BackupCategory, DocStoreName[]> = {
  preferences: [],
  progress: ['campaign-progress'],
  scenarios: ['scenario-drafts', 'installed-scenarios', 'editor-autosave'],
  replays: ['replays'],
};
const ALLOWED_LOCAL_KEYS = new Set(Object.values(LOCAL_KEYS).flat());
const ALLOWED_STORES = new Set<DocStoreName>(DOC_STORE_NAMES);

export interface BackupRecord {
  id: string;
  data: unknown;
}

export interface BackupDocumentV1 {
  schemaVersion: 1;
  product: typeof BACKUP_PRODUCT;
  createdAt: string;
  categories: BackupCategory[];
  localStorage: Record<string, string>;
  documents: Partial<Record<DocStoreName, BackupRecord[]>>;
}

export interface BackupPreview {
  createdAt: string;
  categories: BackupCategory[];
  localEntries: number;
  documents: number;
}

export type BackupParseResult =
  | { ok: true; backup: BackupDocumentV1; preview: BackupPreview }
  | { ok: false; code: 'invalid' | 'future-version' | 'too-large' };

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const BACKUP_LIMITS: StructureLimits = {
  maxBytes: BACKUP_MAX_BYTES,
  maxStringLen: 4 * 1024 * 1024,
  maxArrayLen: 100_000,
  maxObjectKeys: 128,
  maxDepth: 32,
  maxNodes: 2_000_000,
};

function browserStorage(): StorageLike {
  return localStorage;
}

function storesFor(categories: readonly BackupCategory[]): DocStoreName[] {
  const stores = new Set<DocStoreName>();
  categories.forEach((category) => STORE_KEYS[category].forEach((name) => stores.add(name)));
  return [...stores];
}

function localKeysFor(categories: readonly BackupCategory[]): string[] {
  return [
    ...(categories.includes('preferences') ? LOCAL_KEYS.preferences : []),
    ...(categories.includes('progress') ? LOCAL_KEYS.progress : []),
  ];
}

export async function createBackup(
  categories: readonly BackupCategory[] = BACKUP_CATEGORIES,
  store: DocumentStore = documentStore(),
  storage: StorageLike = browserStorage(),
): Promise<BackupDocumentV1> {
  const selected = BACKUP_CATEGORIES.filter((category) => categories.includes(category));
  const localEntries: Record<string, string> = {};
  for (const key of localKeysFor(selected)) {
    const value = storage.getItem(key);
    if (value !== null) localEntries[key] = value;
  }
  const documents: Partial<Record<DocStoreName, BackupRecord[]>> = {};
  for (const name of storesFor(selected)) {
    const records: BackupRecord[] = [];
    for (const summary of await store.list(name)) {
      const record = await store.get(name, summary.id);
      if (record) records.push({ id: record.id, data: record.data });
    }
    documents[name] = records;
  }
  return {
    schemaVersion: 1,
    product: BACKUP_PRODUCT,
    createdAt: new Date().toISOString(),
    categories: selected,
    localStorage: localEntries,
    documents,
  };
}

export function backupPreview(backup: BackupDocumentV1): BackupPreview {
  return {
    createdAt: backup.createdAt,
    categories: [...backup.categories],
    localEntries: Object.keys(backup.localStorage).length,
    documents: Object.values(backup.documents).reduce((sum, records) => sum + (records?.length ?? 0), 0),
  };
}

export function parseBackup(text: string): BackupParseResult {
  if (text.length > BACKUP_MAX_BYTES) return { ok: false, code: 'too-large' };
  const decoded = safeJsonParse(text, BACKUP_LIMITS);
  if (!decoded.ok || typeof decoded.value !== 'object' || decoded.value === null) {
    return { ok: false, code: 'invalid' };
  }
  const value = decoded.value as Record<string, unknown>;
  if (typeof value.schemaVersion === 'number' && value.schemaVersion > BACKUP_VERSION) {
    return { ok: false, code: 'future-version' };
  }
  if (
    value.schemaVersion !== BACKUP_VERSION ||
    value.product !== BACKUP_PRODUCT ||
    typeof value.createdAt !== 'string' ||
    !Array.isArray(value.categories) ||
    typeof value.localStorage !== 'object' || value.localStorage === null ||
    typeof value.documents !== 'object' || value.documents === null
  ) return { ok: false, code: 'invalid' };

  const categories = value.categories;
  if (categories.some((category) => !BACKUP_CATEGORIES.includes(category as BackupCategory))) {
    return { ok: false, code: 'invalid' };
  }
  const localEntries = value.localStorage as Record<string, unknown>;
  const selectedLocalKeys = new Set(localKeysFor(categories as BackupCategory[]));
  if (Object.entries(localEntries).some(([key, entry]) => !ALLOWED_LOCAL_KEYS.has(key) || !selectedLocalKeys.has(key) || typeof entry !== 'string')) {
    return { ok: false, code: 'invalid' };
  }
  const documents = value.documents as Record<string, unknown>;
  const selectedStores = new Set(storesFor(categories as BackupCategory[]));
  for (const [name, records] of Object.entries(documents)) {
    if (!ALLOWED_STORES.has(name as DocStoreName) || !selectedStores.has(name as DocStoreName) || !Array.isArray(records)) {
      return { ok: false, code: 'invalid' };
    }
    if (records.some((record) => {
      if (typeof record !== 'object' || record === null) return true;
      const item = record as Record<string, unknown>;
      if (typeof item.id !== 'string' || item.id.length === 0 || !('data' in item)) return true;
      try {
        if (name === 'replays') return !decodeReplayDocument(item.data).ok;
        if (name === 'scenario-drafts' || name === 'installed-scenarios' || name === 'editor-autosave') {
          return parseScenarioDocument(item.data).doc === null;
        }
      } catch {
        return true;
      }
      return false;
    })) return { ok: false, code: 'invalid' };
  }
  const backup = decoded.value as BackupDocumentV1;
  return { ok: true, backup, preview: backupPreview(backup) };
}

async function applyBackup(
  backup: BackupDocumentV1,
  mode: RestoreMode,
  store: DocumentStore,
  storage: StorageLike,
): Promise<void> {
  const localKeys = localKeysFor(backup.categories);
  if (mode === 'replace') localKeys.forEach((key) => storage.removeItem(key));
  for (const [key, value] of Object.entries(backup.localStorage)) storage.setItem(key, value);

  for (const name of storesFor(backup.categories)) {
    if (mode === 'replace') {
      for (const summary of await store.list(name)) await store.remove(name, summary.id);
    }
    for (const record of backup.documents[name] ?? []) await store.put(name, record.id, record.data);
  }
}

export async function restoreBackup(
  backup: BackupDocumentV1,
  mode: RestoreMode,
  store: DocumentStore = documentStore(),
  storage: StorageLike = browserStorage(),
): Promise<void> {
  const rollback = await createBackup(BACKUP_CATEGORIES, store, storage);
  try {
    await applyBackup(backup, mode, store, storage);
  } catch (error) {
    try {
      await applyBackup(rollback, 'replace', store, storage);
    } catch {
      // 원래 오류를 유지한다. 호출자는 복구 실패를 사용자에게 알린다
    }
    throw error;
  }
}

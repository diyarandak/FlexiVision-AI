import { supportedVideoFile } from './videoFile.ts';

export const REFERENCE_VIDEO_DB_NAME = 'flexivision.reference-videos.v1';
export const REFERENCE_VIDEO_STORE_NAME = 'videos';
export const MAX_REFERENCE_VIDEO_BYTES = 100 * 1024 * 1024;
export const PENDING_VIDEO_DELETION_PREFIX = 'flexivision.reference-video.delete.';

/** Raw reference videos belong to the web device, never to the shared exercise template. */
export interface ReferenceVideoRepository {
  save(id: string, file: File): Promise<void>;
  get(id: string): Promise<File | null>;
  has(id: string): Promise<boolean>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  retain(ids: readonly string[]): Promise<void>;
}

function validId(id: string): void {
  if (typeof id !== 'string' || !id.trim() || id.length > 128) throw new Error('Video için geçerli bir egzersiz kimliği gerekli.');
}

/** A tombstone is written before the template is removed, so interrupted deletes can be retried. */
export class PendingReferenceVideoDeletions {
  constructor(private readonly storage: () => Storage = () => localStorage) {}

  enqueue(id: string): void {
    validId(id);
    this.storage().setItem(PENDING_VIDEO_DELETION_PREFIX + id, '1');
  }

  dequeue(id: string): void {
    validId(id);
    this.storage().removeItem(PENDING_VIDEO_DELETION_PREFIX + id);
  }

  pending(): string[] {
    const storage = this.storage();
    const ids: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(PENDING_VIDEO_DELETION_PREFIX)) {
        const id = key.slice(PENDING_VIDEO_DELETION_PREFIX.length);
        if (id && id.length <= 128) ids.push(id);
      }
    }
    return ids;
  }

  async drain(videos: ReferenceVideoRepository, liveIds: readonly string[]): Promise<void> {
    const live = new Set(liveIds);
    let failed = false;
    for (const id of this.pending()) {
      // A failed template delete must never cause its still-live source video to disappear.
      if (live.has(id)) continue;
      try { await videos.remove(id); this.dequeue(id); }
      catch { failed = true; }
    }
    if (failed) throw new Error('Silinen egzersizlerin bazı videoları cihazdan henüz temizlenemedi. Daha sonra tekrar denenecek.');
  }
}

function isStoredFile(value: unknown): value is File {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<File>;
  return typeof file.name === 'string' && file.name.length > 0
    && typeof file.type === 'string' && typeof file.size === 'number'
    && file.size > 0 && file.size <= MAX_REFERENCE_VIDEO_BYTES
    && typeof file.lastModified === 'number' && typeof file.arrayBuffer === 'function';
}

function storageError(action: string, reason: unknown): Error {
  const name = reason instanceof Error ? reason.name : '';
  if (name === 'QuotaExceededError') return new Error(`${action}: cihazda yeterli depolama alanı yok.`, { cause: reason });
  return new Error(`${action}: tarayıcının video depolaması kullanılamıyor.`, { cause: reason });
}

export class BrowserReferenceVideoRepository implements ReferenceVideoRepository {
  constructor(private readonly factory: () => IDBFactory = () => indexedDB,
    private readonly databaseName = REFERENCE_VIDEO_DB_NAME) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try { request = this.factory().open(this.databaseName, 1); }
      catch (reason) { reject(storageError('Video açılamadı', reason)); return; }
      let blocked = false;
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(REFERENCE_VIDEO_STORE_NAME)) database.createObjectStore(REFERENCE_VIDEO_STORE_NAME);
      };
      request.onsuccess = () => {
        if (blocked) request.result.close();
        else resolve(request.result);
      };
      request.onerror = () => reject(storageError('Video açılamadı', request.error));
      request.onblocked = () => {
        blocked = true;
        reject(new Error('Video deposu başka bir sekmede açık. Diğer sekmeleri kapatıp tekrar dene.'));
      };
    });
  }

  private async transaction<T>(mode: IDBTransactionMode,
    operation: (store: IDBObjectStore, result: (value: T) => void) => void,
    action: string): Promise<T> {
    const database = await this.open();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let value!: T;
      const finish = (reason?: unknown) => {
        if (settled) return;
        settled = true;
        database.close();
        if (reason) reject(storageError(action, reason));
        else resolve(value);
      };
      try {
        const tx = database.transaction(REFERENCE_VIDEO_STORE_NAME, mode);
        let transactionError: unknown;
        tx.oncomplete = () => finish();
        tx.onabort = () => finish(tx.error ?? transactionError ?? new Error('İşlem iptal edildi.'));
        tx.onerror = () => { transactionError = tx.error; };
        operation(tx.objectStore(REFERENCE_VIDEO_STORE_NAME), result => { value = result; });
      } catch (reason) { finish(reason); }
    });
  }

  async save(id: string, file: File): Promise<void> {
    validId(id);
    if (file?.size > MAX_REFERENCE_VIDEO_BYTES) throw new Error('Video kaydedilemedi: dosya 100 MB sınırını aşıyor.');
    if (!isStoredFile(file) || !supportedVideoFile(file)) throw new Error('Kaydedilecek dosya desteklenen bir video değil.');
    await this.transaction<void>('readwrite', store => { store.put(file, id); }, 'Video kaydedilemedi');
  }

  async get(id: string): Promise<File | null> {
    validId(id);
    const stored = await this.transaction<unknown>('readonly', (store, result) => {
      const request = store.get(id);
      request.onsuccess = () => result(request.result);
    }, 'Video okunamadı');
    if (stored === undefined) return null;
    if (!isStoredFile(stored) || !supportedVideoFile(stored)) throw new Error('Kayıtlı video bozuk; şablon kaydı korunuyor.');
    return stored;
  }

  async has(id: string): Promise<boolean> {
    validId(id);
    return this.transaction<boolean>('readonly', (store, result) => {
      const request = store.getKey(id);
      request.onsuccess = () => result(request.result !== undefined);
    }, 'Video durumu okunamadı');
  }

  async remove(id: string): Promise<void> {
    validId(id);
    await this.transaction<void>('readwrite', store => { store.delete(id); }, 'Video silinemedi');
  }

  async clear(): Promise<void> {
    await this.transaction<void>('readwrite', store => { store.clear(); }, 'Videolar silinemedi');
  }

  async retain(ids: readonly string[]): Promise<void> {
    ids.forEach(validId);
    const keep = new Set(ids);
    await this.transaction<void>('readwrite', store => {
      const request = store.getAllKeys();
      request.onsuccess = () => {
        for (const key of request.result) if (typeof key !== 'string' || !keep.has(key)) store.delete(key);
      };
    }, 'Eski videolar temizlenemedi');
  }
}

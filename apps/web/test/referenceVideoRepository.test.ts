import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserReferenceVideoRepository, MAX_REFERENCE_VIDEO_BYTES, PendingReferenceVideoDeletions } from '../src/adapters/referenceVideoRepository.ts';

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
}

class FakeDatabase {
  readonly rows = new Map<string, unknown>();
  readonly objectStoreNames = { contains: () => this.created };
  created = false;
  closeCount = 0;
  getCount = 0;
  getKeyCount = 0;
  failWrites = false;
  createObjectStore() { this.created = true; }
  close() { this.closeCount++; }
  transaction(_name: string, mode: IDBTransactionMode) {
    const database = this;
    let pending = 0, completeScheduled = false, aborted = false;
    const transaction = {
      error: null as DOMException | null,
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      objectStore() {
        const request = <T>(operation: () => T, write = false) => {
          const result = new FakeRequest<T>();
          pending++;
          queueMicrotask(() => {
            if (aborted) return;
            try {
              if (write && mode === 'readwrite' && database.failWrites) throw new DOMException('Full', 'QuotaExceededError');
              result.result = operation();
              result.onsuccess?.();
              pending--;
              if (pending === 0 && !completeScheduled) {
                completeScheduled = true;
                queueMicrotask(() => { if (!aborted && pending === 0) transaction.oncomplete?.(); });
              }
            } catch (error) {
              aborted = true;
              transaction.error = error instanceof DOMException ? error : new DOMException('Failed', 'UnknownError');
              result.error = transaction.error;
              result.onerror?.();
              transaction.onerror?.();
              transaction.onabort?.();
            }
          });
          return result as unknown as IDBRequest<T>;
        };
        return {
          put(file: File, id: string) { return request(() => { database.rows.set(id, file); }, true); },
          get(id: string) { database.getCount++; return request(() => database.rows.get(id)); },
          getKey(id: string) { database.getKeyCount++; return request(() => database.rows.has(id) ? id : undefined); },
          delete(id: string) { return request(() => { database.rows.delete(id); }, true); },
          clear() { return request(() => { database.rows.clear(); }, true); },
          getAllKeys() { return request(() => [...database.rows.keys()]); },
        } as unknown as IDBObjectStore;
      },
    };
    return transaction as unknown as IDBTransaction;
  }
}

function fixture() {
  const database = new FakeDatabase();
  const factory = {
    open() {
      const request = new FakeRequest<IDBDatabase>();
      queueMicrotask(() => {
        request.result = database as unknown as IDBDatabase;
        if (!database.created) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
  return { database, repository: new BrowserReferenceVideoRepository(() => factory), factory };
}

function video(name = 'hareket.mp4') { return new File(['video bytes'], name, { type: 'video/mp4', lastModified: 123 }); }

test('reference video keeps original filename, MIME and bytes across repository instances', async () => {
  const { database, repository, factory } = fixture();
  const file = video();
  await repository.save('ref-1', file);
  const reloaded = new BrowserReferenceVideoRepository(() => factory);
  const stored = await reloaded.get('ref-1');
  assert.equal(stored?.name, file.name);
  assert.equal(stored?.type, file.type);
  assert.equal(stored?.lastModified, file.lastModified);
  assert.equal(await stored?.text(), 'video bytes');
  assert.equal(database.closeCount, 2);
});

test('has checks a key without loading a video; remove and clear only affect video rows', async () => {
  const { database, repository } = fixture();
  await repository.save('one', video());
  await repository.save('two', video('other.mp4'));
  assert.equal(await repository.has('one'), true);
  assert.equal(await repository.has('missing'), false);
  assert.equal(database.getKeyCount, 2);
  assert.equal(database.getCount, 0);
  await repository.remove('one');
  assert.equal(await repository.get('one'), null);
  assert.equal(await repository.has('two'), true);
  await repository.clear();
  assert.equal(await repository.has('two'), false);
});

test('retain removes orphaned video rows and preserves current references', async () => {
  const { repository } = fixture();
  await repository.save('saved', video());
  await repository.save('orphan', video('old.mp4'));
  await repository.retain(['saved']);
  assert.equal(await repository.has('saved'), true);
  assert.equal(await repository.has('orphan'), false);
});

test('invalid, unsupported or oversized files cannot enter video storage', async () => {
  const { database, repository } = fixture();
  await assert.rejects(repository.save('', video()), /kimliği/);
  await assert.rejects(repository.save('ref', new File(['x'], 'notes.txt', { type: 'text/plain' })), /video değil/);
  const oversized = { ...video(), name: 'large.mp4', type: 'video/mp4', size: MAX_REFERENCE_VIDEO_BYTES + 1,
    lastModified: 1, arrayBuffer: async () => new ArrayBuffer(0) } as File;
  await assert.rejects(repository.save('ref', oversized), /100 MB sınırını/);
  assert.equal(database.rows.size, 0);
});

test('quota or unavailable IndexedDB reports failure and preserves existing videos', async () => {
  const { database, repository } = fixture();
  await repository.save('old', video());
  database.failWrites = true;
  await assert.rejects(repository.save('new', video()), /yeterli depolama alanı yok/);
  assert.equal(database.rows.has('new'), false);
  assert.equal(database.rows.has('old'), true);
  const unavailable = new BrowserReferenceVideoRepository(() => { throw new Error('Disabled'); });
  await assert.rejects(unavailable.get('old'), /depolaması kullanılamıyor/);
});

test('corrupt stored values are reported without deleting the exercise video row', async () => {
  const { database, repository } = fixture();
  database.rows.set('broken', { name: 'broken.mp4' });
  await assert.rejects(repository.get('broken'), /Kayıtlı video bozuk/);
  assert.equal(database.rows.has('broken'), true);
});

test('interrupted deletion is retried after reload without touching live or unrelated videos', async () => {
  const { repository } = fixture();
  const keys = new Map<string, string>();
  const storage = {
    get length() { return keys.size; }, key(index: number) { return [...keys.keys()][index] ?? null; },
    setItem(key: string, value: string) { keys.set(key, value); }, removeItem(key: string) { keys.delete(key); },
  } as Storage;
  const pending = new PendingReferenceVideoDeletions(() => storage);
  await repository.save('deleted', video());
  await repository.save('still-live', video());
  await repository.save('unrelated', video());
  pending.enqueue('deleted'); pending.enqueue('still-live');

  const reloaded = new PendingReferenceVideoDeletions(() => storage);
  await reloaded.drain(repository, ['still-live']);
  assert.equal(await repository.has('deleted'), false);
  assert.equal(await repository.has('still-live'), true);
  assert.equal(await repository.has('unrelated'), true);
  assert.deepEqual(reloaded.pending(), ['still-live']);
});

test('failed video deletion keeps a tombstone for a later retry', async () => {
  const { database, repository } = fixture();
  const keys = new Map<string, string>();
  const storage = {
    get length() { return keys.size; }, key(index: number) { return [...keys.keys()][index] ?? null; },
    setItem(key: string, value: string) { keys.set(key, value); }, removeItem(key: string) { keys.delete(key); },
  } as Storage;
  const pending = new PendingReferenceVideoDeletions(() => storage);
  await repository.save('deleted', video()); pending.enqueue('deleted');
  database.failWrites = true;
  await assert.rejects(pending.drain(repository, []), /henüz temizlenemedi/);
  assert.deepEqual(pending.pending(), ['deleted']);
  assert.equal(await repository.has('deleted'), true);
  database.failWrites = false;
  await pending.drain(repository, []);
  assert.deepEqual(pending.pending(), []);
  assert.equal(await repository.has('deleted'), false);
});

import type { StaticSessionSummary, StaticSessionRecord } from '@flexivision/contracts';
import type { ExerciseTemplate } from '@flexivision/contracts';
import type { ReferenceTemplateRepository, SessionHistoryRepository } from '@flexivision/application';
import type { GenericSessionRecord, GenericSessionSummary, LiveSessionSummary, SessionRecord, SquatSessionRecord } from '@flexivision/contracts';
import { MAX_SESSION_RECORDS, readReferenceLibrary, readSessionHistory, referenceTemplateData,
  savedReferenceData, sessionRecordData, writeReferenceLibrary, writeSessionHistory } from '@flexivision/core';
import type { NativeStorageDriver } from './nativeStorage.ts';

export const MOBILE_SESSION_HISTORY_KEY = 'flexivision.mobile.sessions.v1';
export const MOBILE_REFERENCE_LIBRARY_KEY = 'flexivision.mobile.references.v1';

// Share the queue between repositories using the same driver/key. Async native
// read-modify-write must not overwrite a concurrent save or resurrect a clear.
const queues = new WeakMap<NativeStorageDriver, Map<string, StorageQueue>>();
class StorageQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
function queueFor(driver: NativeStorageDriver, key: string) {
  let keys = queues.get(driver);
  if (!keys) { keys = new Map(); queues.set(driver, keys); }
  let queue = keys.get(key);
  if (!queue) { queue = new StorageQueue(); keys.set(key, queue); }
  return queue;
}

export class NativeSessionHistoryRepository implements SessionHistoryRepository {
  private readonly queue: StorageQueue;
  constructor(private readonly driver: NativeStorageDriver, private readonly id: () => string,
    private readonly now: () => Date = () => new Date(), private readonly key = MOBILE_SESSION_HISTORY_KEY) {
    this.queue = queueFor(driver, key);
  }
  private async read() { return readSessionHistory(await this.driver.getItem(this.key)); }
  list() { return this.queue.run(() => this.read()); }
  save(summary: LiveSessionSummary, reference: SquatSessionRecord['reference'], endReason: SessionRecord['endReason']) {
    return this.queue.run(async () => {
      const record = sessionRecordData({ schemaVersion: 1, id: this.id(), savedAt: this.now().toISOString(), exercise: 'squat', reference, endReason, summary }) as SquatSessionRecord;
      const records = [record, ...await this.read()].slice(0, MAX_SESSION_RECORDS);
      await this.driver.setItem(this.key, writeSessionHistory(records)); return record;
    });
  }
  saveGeneric(summary: GenericSessionSummary, reference: GenericSessionRecord['reference'], endReason: SessionRecord['endReason']) {
    return this.queue.run(async () => {
      const record = sessionRecordData({ schemaVersion: 2, id: this.id(), savedAt: this.now().toISOString(), exercise: 'generic-cycle',
        reference, endReason, summary }) as GenericSessionRecord;
      const records = [record, ...await this.read()].slice(0, MAX_SESSION_RECORDS);
      await this.driver.setItem(this.key, writeSessionHistory(records)); return record;
    });
  }
  saveStatic(summary: StaticSessionSummary, reference: StaticSessionRecord['reference'], endReason: SessionRecord['endReason']) {
    return this.queue.run(async () => {
      const record = sessionRecordData({ schemaVersion: 3, id: this.id(), savedAt: this.now().toISOString(), exercise: 'static-pose',
        reference, endReason, summary }) as StaticSessionRecord;
      const records = [record, ...await this.read()].slice(0, MAX_SESSION_RECORDS);
      await this.driver.setItem(this.key, writeSessionHistory(records)); return record;
    });
  }
  remove(id: string) { return this.queue.run(async () => { await this.driver.setItem(this.key, writeSessionHistory((await this.read()).filter(record => record.id !== id))); }); }
  clear() { return this.queue.run(async () => { await this.driver.removeItem(this.key); }); }
}

export class NativeReferenceTemplateRepository implements ReferenceTemplateRepository {
  private readonly queue: StorageQueue;
  constructor(private readonly driver: NativeStorageDriver, private readonly id: () => string,
    private readonly now: () => Date = () => new Date(), private readonly key = MOBILE_REFERENCE_LIBRARY_KEY) {
    this.queue = queueFor(driver, key);
  }
  private async read() { return readReferenceLibrary(await this.driver.getItem(this.key)); }
  list() { return this.queue.run(() => this.read()); }
  save(template: ExerciseTemplate, name: string) {
    return this.queue.run(async () => {
      const record = savedReferenceData({ schemaVersion: 1, id: this.id(), savedAt: this.now().toISOString(), name: name.trim(), template: referenceTemplateData(template) });
      await this.driver.setItem(this.key, writeReferenceLibrary([record, ...await this.read()])); return record;
    });
  }
  rename(id: string, name: string) {
    return this.queue.run(async () => {
      const records = await this.read(), selected = records.find(record => record.id === id);
      if (!selected) throw new Error('Egzersiz kaydı bulunamadı.');
      const record = savedReferenceData({ ...selected, name: name.trim() });
      await this.driver.setItem(this.key, writeReferenceLibrary(records.map(item => item.id === id ? record : item))); return record;
    });
  }
  remove(id: string) { return this.queue.run(async () => { await this.driver.setItem(this.key, writeReferenceLibrary((await this.read()).filter(record => record.id !== id))); }); }
  clear() { return this.queue.run(async () => { await this.driver.removeItem(this.key); }); }
}

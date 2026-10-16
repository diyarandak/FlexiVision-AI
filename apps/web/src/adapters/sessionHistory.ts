import type { StaticSessionSummary, StaticSessionRecord } from '@flexivision/contracts';
import type { SessionHistoryRepository } from '@flexivision/application';
import type { GenericSessionRecord, GenericSessionSummary, LiveSessionSummary, SessionRecord, SquatSessionRecord } from '@flexivision/contracts';
import { MAX_SESSION_RECORDS, readSessionHistory, sessionRecordData, writeSessionHistory } from '@flexivision/core';

export const SESSION_HISTORY_KEY = 'flexivision.sessions.v1';
export { MAX_SESSION_RECORDS } from '@flexivision/core';
type HistoryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class BrowserSessionHistoryRepository implements SessionHistoryRepository {
  constructor(private readonly storage: () => HistoryStorage = () => localStorage,
    private readonly now: () => Date = () => new Date(), private readonly id: () => string = () => crypto.randomUUID(),
    private readonly key = SESSION_HISTORY_KEY) {}

  private read(): SessionRecord[] {
    return readSessionHistory(this.storage().getItem(this.key));
  }
  async list() { return this.read(); }
  async save(summary: LiveSessionSummary, reference: SquatSessionRecord['reference'], endReason: SessionRecord['endReason']) {
    const record = sessionRecordData({ schemaVersion: 1, id: this.id(), savedAt: this.now().toISOString(), exercise: 'squat',
      reference, endReason, summary }) as SquatSessionRecord;
    // Synchronous read/write avoids lost updates between concurrent save calls.
    const records = [record, ...this.read()].slice(0, MAX_SESSION_RECORDS);
    this.storage().setItem(this.key, writeSessionHistory(records));
    return record;
  }
  async saveGeneric(summary: GenericSessionSummary, reference: GenericSessionRecord['reference'], endReason: SessionRecord['endReason']) {
    const record = sessionRecordData({ schemaVersion: 2, id: this.id(), savedAt: this.now().toISOString(), exercise: 'generic-cycle',
      reference, endReason, summary }) as GenericSessionRecord;
    const records = [record, ...this.read()].slice(0, MAX_SESSION_RECORDS);
    this.storage().setItem(this.key, writeSessionHistory(records));
    return record;
  }
  async saveStatic(summary: StaticSessionSummary, reference: StaticSessionRecord['reference'], endReason: SessionRecord['endReason']) {
    const record = sessionRecordData({ schemaVersion: 3, id: this.id(), savedAt: this.now().toISOString(), exercise: 'static-pose',
      reference, endReason, summary }) as StaticSessionRecord;
    const records = [record, ...this.read()].slice(0, MAX_SESSION_RECORDS);
    this.storage().setItem(this.key, writeSessionHistory(records));
    return record;
  }
  async remove(id: string) { this.storage().setItem(this.key, writeSessionHistory(this.read().filter(record => record.id !== id))); }
  async clear() { this.storage().removeItem(this.key); }
}

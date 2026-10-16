import type { ExerciseTemplate } from '@flexivision/contracts';
import type { ReferenceTemplateRepository } from '@flexivision/application';
import type { SavedReferenceTemplate } from '@flexivision/contracts';
import { readReferenceLibrary, referenceTemplateData, savedReferenceData, writeReferenceLibrary } from '@flexivision/core';

export const REFERENCE_LIBRARY_KEY = 'flexivision.references.v1';
type ReferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class BrowserReferenceTemplateRepository implements ReferenceTemplateRepository {
  constructor(private readonly storage: () => ReferenceStorage = () => localStorage,
    private readonly now: () => Date = () => new Date(), private readonly id: () => string = () => crypto.randomUUID(),
    private readonly key = REFERENCE_LIBRARY_KEY) {}
  private read() { return readReferenceLibrary(this.storage().getItem(this.key)); }
  private write(records: SavedReferenceTemplate[]) { this.storage().setItem(this.key, writeReferenceLibrary(records)); }
  async list() { return this.read(); }
  async save(template: ExerciseTemplate, name: string) {
    const record = savedReferenceData({ schemaVersion: 1, id: this.id(), name: name.trim(), savedAt: this.now().toISOString(), template: referenceTemplateData(template) });
    // LocalStorage operations stay synchronous so concurrent calls do not lose writes.
    this.write([record, ...this.read()]);
    return record;
  }
  async rename(id: string, name: string) {
    const records = this.read(), selected = records.find(record => record.id === id);
    if (!selected) throw new Error('Egzersiz kaydı bulunamadı.');
    const renamed = savedReferenceData({ ...selected, name: name.trim() });
    this.write(records.map(record => record.id === id ? renamed : record));
    return renamed;
  }
  async remove(id: string) { this.write(this.read().filter(record => record.id !== id)); }
  async clear() { this.storage().removeItem(this.key); }
}

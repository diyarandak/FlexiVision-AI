import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReferenceTemplateRepository } from '@flexivision/application';
import { acceptedTemplate } from '../../../packages/core/test/fixtures/acceptedTemplate.ts';
import { BrowserReferenceTemplateRepository } from '../src/adapters/referenceLibrary.ts';
import type { ReferenceVideoRepository } from '../src/adapters/referenceVideoRepository.ts';
import { saveExerciseCollection } from '../src/adapters/saveExerciseCollection.ts';

function fixture() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
  let nextId = 0;
  const references = new BrowserReferenceTemplateRepository(() => storage, () => new Date('2026-10-10T00:00:00Z'), () => `ref-${++nextId}`);
  const rows = new Map<string, File>();
  const videos: ReferenceVideoRepository = {
    async save(id, file) { rows.set(id, file); },
    async get(id) { return rows.get(id) ?? null; },
    async has(id) { return rows.has(id); },
    async remove(id) { rows.delete(id); },
    async clear() { rows.clear(); },
    async retain(ids) { for (const id of rows.keys()) if (!ids.includes(id)) rows.delete(id); },
  };
  return { references, videos, rows };
}

function video() { return new File(['video bytes'], 'my-reference.mp4', { type: 'video/mp4' }); }

test('accepted template and its original video form one saved collection item', async () => {
  const { references, videos, rows } = fixture();
  const file = video();
  const saved = await saveExerciseCollection(references, videos, acceptedTemplate(), 'Akşam squat', file);
  assert.equal(saved.name, 'Akşam squat');
  assert.equal(rows.get(saved.id), file);
  assert.deepEqual(await references.list(), [saved]);
});

test('video write failure rolls back the new template and never reports save success', async () => {
  const { references, videos, rows } = fixture();
  const existing = await references.save(acceptedTemplate(), 'Eski hareket');
  const failingVideos: ReferenceVideoRepository = {
    ...videos,
    async save() { throw new DOMException('Storage full', 'QuotaExceededError'); },
  };
  await assert.rejects(saveExerciseCollection(references, failingVideos, acceptedTemplate(), 'Yeni hareket', video()),
    /Video cihazına kaydedilemedi/);
  assert.deepEqual(await references.list(), [existing]);
  assert.equal(rows.size, 0);
});

test('rollback failure reports possible partial state instead of pretending the collection saved', async () => {
  const { references, videos } = fixture();
  const failingReferences: ReferenceTemplateRepository = {
    list: () => references.list(),
    save: (template, name) => references.save(template, name),
    rename: (id, name) => references.rename(id, name),
    async remove() { throw new Error('Storage denied'); },
    clear: () => references.clear(),
  };
  const failingVideos: ReferenceVideoRepository = {
    ...videos,
    async save() { throw new Error('Video write denied'); },
  };
  await assert.rejects(saveExerciseCollection(failingReferences, failingVideos, acceptedTemplate(), 'Yeni hareket', video()),
    /şablonu kısmen kalmış olabilir/);
  const records = await references.list();
  assert.equal(records.length, 1);
  assert.equal(records[0]?.name, 'Yeni hareket');
});

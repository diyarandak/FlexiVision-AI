import assert from 'node:assert/strict';
import test from 'node:test';
import type { SavedReferenceTemplate } from '@flexivision/contracts';
import { libraryView } from '../src/libraryView.ts';
import { acceptedTemplate } from '../../../packages/core/test/fixtures/acceptedTemplate.ts';
import { genericTemplate } from './fixtures/genericMotion.ts';

const records: SavedReferenceTemplate[] = [
  { schemaVersion: 1, id: 'a', name: 'İleri Adım', savedAt: '2026-10-10T00:00:00.000Z', template: genericTemplate() },
  { schemaVersion: 1, id: 'b', name: 'Omuz Açış', savedAt: '2026-10-09T00:00:00.000Z', template: genericTemplate() },
  { schemaVersion: 1, id: 'c', name: 'Squat', savedAt: '2026-10-08T00:00:00.000Z', template: acceptedTemplate() },
];
test('library search tolerates Turkish keyboard variants, whitespace and multiple words', () => {
  for (const query of ['ileri adim', 'ADIM İLERİ', '  İLERİ   ']) assert.deepEqual(libraryView(records, query, 'all', 'recent').map(r => r.id), ['a']);
  assert.deepEqual(libraryView(records, 'omuz acis', 'free', 'recent').map(r => r.id), ['b']);
  assert.deepEqual(libraryView(records, 'omuz', 'squat', 'recent'), []);
});
test('library ordering and filters never mutate or discard stored records', () => {
  const original = [...records];
  assert.deepEqual(libraryView([...records].reverse(), '', 'all', 'recent').map(r => r.id), ['a', 'b', 'c']);
  assert.deepEqual(libraryView(records, '', 'squat', 'name').map(r => r.id), ['c']);
  assert.deepEqual(libraryView(records, 'missing', 'all', 'name'), []);
  assert.deepEqual(records, original);
  assert.equal(libraryView(records, '', 'all', 'recent').length, 3);
});

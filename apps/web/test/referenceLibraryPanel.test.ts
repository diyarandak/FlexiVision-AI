import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { acceptedTemplate } from '../../../packages/core/test/fixtures/acceptedTemplate.ts';
import { ReferenceLibraryPanel } from '../src/components/ReferenceLibraryPanel.tsx';
import { genericTemplate } from './fixtures/genericMotion.ts';

test('saved exercise details describe the actual generic path or squat angle data', () => {
  const records = [
    { schemaVersion: 1 as const, id: 'free', name: 'Kol hareketi', savedAt: '2026-10-10T00:00:00.000Z', template: genericTemplate() },
    { schemaVersion: 1 as const, id: 'squat', name: 'Squat', savedAt: '2026-10-10T00:00:00.000Z', template: acceptedTemplate() },
  ];
  const html = renderToStaticMarkup(createElement(ReferenceLibraryPanel, {
    records, loading: false, error: '', onStartLive() {}, async onRename() { return records[0]!; },
    async onOpenVideo() {}, videoAvailability: { free: 'available', squat: 'missing' }, onRemove() {}, onClear() {},
  }));
  assert.match(html, /Kayıtlı 2B eklem yolu ile çalışırsın/);
  assert.match(html, /Kayıtlı açı şablonu ile çalışırsın/);
  assert.match(html, /aria-label="Kol hareketi videosunu aç"/);
  assert.match(html, /Bu kaydın videosu yok\. Şablonla egzersize başlayabilirsin\./);
  assert.doesNotMatch(html, /Video saklanmaz/);
  assert.equal((html.match(/class="primary-button exercise-start-action"/g) ?? []).length, 2);
  assert.match(html, /aria-label="Kol hareketi seçenekleri"/);
  assert.match(html, /aria-label="Squat seçenekleri"/);
  assert.match(html, /<details class="exercise-management exercise-more-menu">/);
});

test('empty exercise library gives one short next step and no management controls', () => {
  const html = renderToStaticMarkup(createElement(ReferenceLibraryPanel, {
    records: [], loading: false, error: '', onStartLive() {}, async onRename() { throw new Error('unused'); },
    async onOpenVideo() {}, videoAvailability: {}, onRemove() {}, onClear() {},
  }));
  assert.match(html, /Henüz kayıtlı hareketin yok\. Aşağıdan bir video ekleyerek başlayabilirsin\./);
  assert.doesNotMatch(html, /library-more-menu|exercise-more-menu|primary-button/);
});

test('video loading and read errors do not imply that an exercise template is missing', () => {
  const records = [
    { schemaVersion: 1 as const, id: 'checking', name: 'Hareket A', savedAt: '2026-10-10T00:00:00.000Z', template: genericTemplate() },
    { schemaVersion: 1 as const, id: 'error', name: 'Hareket B', savedAt: '2026-10-10T00:00:00.000Z', template: genericTemplate() },
  ];
  const html = renderToStaticMarkup(createElement(ReferenceLibraryPanel, {
    records, loading: false, error: '', onStartLive() {}, async onRename() { return records[0]!; },
    async onOpenVideo() {}, videoAvailability: { checking: 'checking', error: 'error' }, onRemove() {}, onClear() {},
  }));
  assert.match(html, /Video kontrol ediliyor…/);
  assert.match(html, /Video şu an kontrol edilemiyor\./);
  assert.match(html, /Videoyu yeniden dene/);
  assert.equal((html.match(/class="primary-button exercise-start-action"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Bu kaydın videosu yok/);
});

test('library management is disabled while analysis or video save is in progress', () => {
  const record = { schemaVersion: 1 as const, id: 'saved', name: 'Hareket', savedAt: '2026-10-10T00:00:00.000Z', template: genericTemplate() };
  const html = renderToStaticMarkup(createElement(ReferenceLibraryPanel, {
    records: [record], loading: false, error: '', disabled: true, onStartLive() {},
    async onRename() { return record; }, async onOpenVideo() {}, videoAvailability: { saved: 'available' },
    onRemove() {}, onClear() {},
  }));
  assert.match(html, /disabled=""[^>]*>Bu egzersizi sil/);
  assert.match(html, /disabled=""[^>]*>Egzersizleri temizle/);
  assert.match(html, /disabled=""[^>]*>Adı güncelle/);
  assert.match(html, /disabled=""[^>]*>Videoyu aç/);
});

test('an unreadable library offers retry without claiming the collection is empty', () => {
  const html = renderToStaticMarkup(createElement(ReferenceLibraryPanel, {
    records: [], loading: false, error: 'Okuma hatası', onRetry() {}, onStartLive() {},
    async onRename() { throw new Error('unused'); }, async onOpenVideo() {}, videoAvailability: {}, onRemove() {}, onClear() {},
  }));
  assert.match(html, /Kayıtları yeniden oku/);
  assert.match(html, /Mevcut veriler değiştirilmedi/);
  assert.doesNotMatch(html, /Henüz kayıtlı hareketin yok/);
});

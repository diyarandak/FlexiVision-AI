import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SavedBodyProfile } from '@flexivision/contracts';
import { BodyProfileCard } from '../src/components/BodyProfileCard.tsx';

const saved: SavedBodyProfile = {
  schemaVersion: 1, savedAt: '2026-10-10T00:00:00.000Z',
  profile: {} as SavedBodyProfile['profile'],
};

test('body profile presents one primary action for the current state', () => {
  const base = { loading: false, error: '', onScan() {}, onClear() {}, onExercises() {} };
  const emptyHtml = renderToStaticMarkup(createElement(BodyProfileCard, { ...base, saved: null }));
  const readyHtml = renderToStaticMarkup(createElement(BodyProfileCard, { ...base, saved }));
  assert.equal((emptyHtml.match(/class="primary-button body-primary-action"/g) ?? []).length, 1);
  assert.equal((readyHtml.match(/class="primary-button body-primary-action"/g) ?? []).length, 1);
  assert.match(emptyHtml, /Vücudumu tara/);
  assert.match(readyHtml, /Egzersizlerime geç/);
  assert.match(readyHtml, /<details class="profile-manage-menu">/);
  assert.doesNotMatch(emptyHtml, /profile-manage-menu/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { isAcceptedGenericTemplate, isAcceptedSquatTemplate, MAX_SAVED_REFERENCES,
  readReferenceLibrary, writeReferenceLibrary } from '@flexivision/core';
import { acceptedTemplate } from '../../../packages/core/test/fixtures/acceptedTemplate.ts';
import { BrowserReferenceTemplateRepository, REFERENCE_LIBRARY_KEY } from '../src/adapters/referenceLibrary.ts';
import { BODY_PROFILE_KEY } from '../src/adapters/bodyProfile.ts';
import { SESSION_HISTORY_KEY } from '../src/adapters/sessionHistory.ts';
import { genericTemplate } from './fixtures/genericMotion.ts';

function fixture() {
  const data = new Map<string, string>(); let id = 0;
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  return { data, storage, repository: new BrowserReferenceTemplateRepository(() => storage, () => new Date('2026-10-09T00:00:00Z'), () => `ref-${++id}`) };
}
test('accepted builder output persists, restores, renames and starts without a video', async () => {
  const { storage, repository } = fixture(), template = acceptedTemplate();
  assert.equal(isAcceptedSquatTemplate(template), true);
  const saved = await repository.save(template, '  Akşam squat  ');
  const reloaded = new BrowserReferenceTemplateRepository(() => storage);
  assert.deepEqual(await reloaded.list(), [saved]); assert.equal(saved.name, 'Akşam squat');
  const renamed = await reloaded.rename(saved.id, 'Sabah squat');
  assert.equal(renamed.savedAt, saved.savedAt); assert.deepEqual(renamed.template, template);
  await reloaded.remove(saved.id); assert.deepEqual(await reloaded.list(), []);
});
test('generic movement and previous squat records coexist across reload; only measured fields persist', async () => {
  const { data, storage, repository } = fixture();
  const oldSquat = await repository.save(acceptedTemplate(), 'Eski squat');
  const template = genericTemplate();
  assert.equal(isAcceptedGenericTemplate(template), true);
  Object.assign(template, { video: 'private-video', profile: 'private-profile' });
  Object.assign(template.samples[0]!, { rawFrame: 'private-frame' });
  Object.assign(template.samples[0]!.landmarks[15]!, { secret: 'private-point' });
  const saved = await repository.save(template, '  Kol kaldırma  ');
  assert.equal(saved.name, 'Kol kaldırma');
  const raw = data.get(REFERENCE_LIBRARY_KEY)!;
  for (const secret of ['private-video', 'private-profile', 'private-frame', 'private-point']) assert.equal(raw.includes(secret), false);
  const reloaded = new BrowserReferenceTemplateRepository(() => storage);
  assert.deepEqual(await reloaded.list(), [saved, oldSquat]);
  const renamed = await reloaded.rename(saved.id, 'Yeni hareket');
  assert.equal(renamed.template.kind, 'generic-cycle-template');
  assert.equal((await reloaded.list())[1]!.template.kind, 'squat-cycle-template');
});
test('rejected or corrupted generic trajectories cannot enter the exercise library', async () => {
  const { repository } = fixture();
  const rejected = genericTemplate(); rejected.qualification = 'not_evaluated';
  const gap = genericTemplate(); gap.samples[25]!.landmarks[gap.trackedIndices[0]!] = null;
  const duplicate = genericTemplate(); duplicate.motionIndices[1] = duplicate.motionIndices[0]!;
  const warped = genericTemplate(); warped.samples[20]!.offsetMs += 100;
  for (const candidate of [rejected, gap, duplicate, warped]) {
    assert.equal(isAcceptedGenericTemplate(candidate), false);
    await assert.rejects(repository.save(candidate, 'Hareket'));
  }
  assert.deepEqual(await repository.list(), []);
});
test('library caps at 20 without silently deleting references or other local data', async () => {
  const { data, repository } = fixture(); data.set(BODY_PROFILE_KEY, 'profile'); data.set(SESSION_HISTORY_KEY, 'history');
  await Promise.all(Array.from({ length: MAX_SAVED_REFERENCES }, (_, i) => repository.save(acceptedTemplate(), `Squat ${i}`)));
  const before = data.get(REFERENCE_LIBRARY_KEY);
  await assert.rejects(repository.save(acceptedTemplate(), 'One more'), /20/);
  assert.equal(data.get(REFERENCE_LIBRARY_KEY), before); assert.equal((await repository.list()).length, 20);
  await repository.clear(); assert.equal(data.get(BODY_PROFILE_KEY), 'profile'); assert.equal(data.get(SESSION_HISTORY_KEY), 'history');
});
test('only selected fields are saved; modifying returned templates does not alter saved data', async () => {
  const { data, repository } = fixture(), template = acceptedTemplate();
  Object.assign(template, { video: 'private-video', profile: 'private-profile', frames: [1] });
  Object.assign(template.source.engine, { secret: 'private-engine' });
  Object.assign(template.samples[0]!, { rawFrame: 'private-frame' });
  const saved = await repository.save(template, 'Squat'); assert.equal(saved.template.kind, 'squat-cycle-template'); if (saved.template.kind !== 'squat-cycle-template') throw new Error('Expected squat'); saved.template.samples[0]!.angles2d.leftKnee = 0;
  const raw = data.get(REFERENCE_LIBRARY_KEY)!;
  for (const value of ['private-video', 'private-profile', 'private-engine', 'private-frame', 'frames']) assert.equal(raw.includes(value), false);
  const restored = (await repository.list())[0]!.template; assert.equal(restored.kind, 'squat-cycle-template'); if (restored.kind !== 'squat-cycle-template') throw new Error('Expected squat'); assert.notEqual(restored.samples[0]!.angles2d.leftKnee, 0);
});
test('drafts, incomplete joints, phases, stale schema and invalid names cannot be persisted', async () => {
  const { repository } = fixture();
  const draft = acceptedTemplate(); draft.qualification = 'not_evaluated';
  const missing = acceptedTemplate(); missing.samples[10]!.angles2d.leftHip = null;
  const phase = acceptedTemplate(); phase.samples[0]!.phase = 'ascent';
  const time = acceptedTemplate(); time.durationMs++;
  const count = acceptedTemplate(); count.samples.pop();
  for (const template of [draft, missing, phase, time, count]) {
    assert.equal(isAcceptedSquatTemplate(template), false); await assert.rejects(repository.save(template, 'Squat'));
  }
  for (const name of ['', 'a'.repeat(81), 'bad\u0001name']) await assert.rejects(repository.save(acceptedTemplate(), name));
});
test('corruption and denied storage preserve old records and allow explicit recovery', async () => {
  const { data, storage, repository } = fixture();
  const saved = await repository.save(acceptedTemplate(), 'Squat');
  for (const raw of ['{broken', 'a'.repeat(1000001), JSON.stringify([saved, saved])]) {
    data.set(REFERENCE_LIBRARY_KEY, raw); await assert.rejects(repository.list()); await assert.rejects(repository.save(acceptedTemplate(), 'Squat'));
    assert.equal(data.get(REFERENCE_LIBRARY_KEY), raw);
  }
  await repository.clear();
  const denied = new BrowserReferenceTemplateRepository(() => ({ ...storage, setItem() { throw new Error('Quota'); } }));
  await assert.rejects(denied.save(acceptedTemplate(), 'Squat'), /Quota/); assert.deepEqual(await repository.list(), []);
  assert.throws(() => writeReferenceLibrary([saved, saved]), /kimliği/); assert.throws(() => readReferenceLibrary(JSON.stringify([saved, saved])));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { GenericSessionSummary, LiveSessionSummary } from '@flexivision/contracts';
import { acceptedTemplate } from '../../../packages/core/test/fixtures/acceptedTemplate.ts';
import { NativeReferenceTemplateRepository, NativeSessionHistoryRepository, MOBILE_REFERENCE_LIBRARY_KEY, MOBILE_SESSION_HISTORY_KEY } from '../src/adapters/nativeRecords.ts';
import { MOBILE_BODY_PROFILE_KEY } from '../src/adapters/nativeStorage.ts';

function fixture() {
  const data = new Map<string, string>(); let id = 0, deny = false;
  const yieldTurn = () => Promise.resolve();
  const driver = { async getItem(key: string) { await yieldTurn(); return data.get(key) ?? null; },
    async setItem(key: string, value: string) { await yieldTurn(); if (deny) throw new Error('Denied'); data.set(key, value); },
    async removeItem(key: string) { await yieldTurn(); data.delete(key); } };
  const makeId = () => `native-${++id}`, now = () => new Date('2026-10-09T00:00:00Z');
  return { data, driver, makeId, now, deny: (value: boolean) => { deny = value; },
    history: new NativeSessionHistoryRepository(driver, makeId, now), library: new NativeReferenceTemplateRepository(driver, makeId, now) };
}
const reference = { repetitionId: 1, side: 'left' as const };
function summary(): LiveSessionSummary {
  return { durationMs: 1000, trackedMs: 700, unmeasuredMs: 300, bodyProfileUsed: true, repetitionCount: 1,
    cleanRepetitions: 0, sampledFrames: 10, trackedFrames: 8, lostFrames: 2, spokenCues: [], cueCandidatesCount: 0,
    errorBreakdown: {}, deviations: { knee: { samples: 8, mean: 4, max: 12 }, hip: { samples: 8, mean: 2, max: 4 } } };
}
function genericSummary(): GenericSessionSummary {
  return { durationMs: 1500, repetitionCount: 1, sampledFrames: 11, trackedFrames: 9,
    unmeasuredFrames: 2, cueCandidatesCount: 0, spokenCuesCount: 0, bodyProfileUsed: true };
}
test('native history serializes concurrent saves across repository instances and retains 50', async () => {
  const f = fixture(), other = new NativeSessionHistoryRepository(f.driver, f.makeId, f.now);
  await Promise.all(Array.from({ length: 52 }, (_, i) => (i % 2 ? other : f.history).save(summary(), reference, i % 2 ? 'finished' : 'interrupted')));
  const records = await other.list(); assert.equal(records.length, 50); assert.equal(new Set(records.map(r => r.id)).size, 50);
  assert.equal(records[0]!.id, 'native-52'); assert.equal(records.at(-1)!.id, 'native-3');
  await Promise.all([f.history.save(summary(), reference, 'finished'), other.clear()]);
  assert.deepEqual(await f.history.list(), []);
});
test('native mixed session history keeps squat and generic reports with separate reference metadata', async () => {
  const f = fixture();
  const squat = await f.history.save(summary(), reference, 'finished');
  const generic = await f.history.saveGeneric(genericSummary(), { repetitionId: 3, policyVersion: 'generic-cycles-v1' }, 'interrupted');
  assert.deepEqual(await new NativeSessionHistoryRepository(f.driver, f.makeId, f.now).list(), [generic, squat]);
  assert.equal(generic.exercise, 'generic-cycle');
  await f.history.remove(squat.id);
  assert.deepEqual(await f.history.list(), [generic]);
});
test('native reference library shares validation, limits and ordered rename/delete/clear', async () => {
  const f = fixture(), other = new NativeReferenceTemplateRepository(f.driver, f.makeId, f.now);
  const first = await f.library.save(acceptedTemplate(), 'Squat');
  await Promise.all([f.library.rename(first.id, 'Sabah'), other.save(acceptedTemplate(), 'Akşam')]);
  assert.deepEqual((await other.list()).map(r => r.name), ['Akşam', 'Sabah']);
  await other.remove(first.id); assert.equal((await f.library.list()).length, 1);
  await Promise.all(Array.from({ length: 19 }, () => f.library.save(acceptedTemplate(), 'Squat')));
  await assert.rejects(f.library.save(acceptedTemplate(), 'Overflow'), /20/); assert.equal((await other.list()).length, 20);
  await Promise.all([f.library.rename((await f.library.list())[0]!.id, 'New name'), other.clear()]);
  assert.deepEqual(await f.library.list(), []);
});
test('native denied writes and corruption never acknowledge success or overwrite user data', async () => {
  const f = fixture(); f.data.set(MOBILE_BODY_PROFILE_KEY, 'body-profile');
  f.deny(true); await assert.rejects(f.history.save(summary(), reference, 'finished'), /Denied/);
  await assert.rejects(f.library.save(acceptedTemplate(), 'Squat'), /Denied/);
  f.deny(false); await f.history.save(Object.assign(summary(), { video: 'private-video', profile: 'private-profile' }), reference, 'finished');
  await f.library.save(Object.assign(acceptedTemplate(), { frames: 'private-frames' }), 'Squat');
  assert.equal(f.data.get(MOBILE_SESSION_HISTORY_KEY)!.includes('private'), false);
  assert.equal(f.data.get(MOBILE_REFERENCE_LIBRARY_KEY)!.includes('private'), false);
  f.data.set(MOBILE_SESSION_HISTORY_KEY, '{broken'); f.data.set(MOBILE_REFERENCE_LIBRARY_KEY, '{broken');
  await assert.rejects(f.history.save(summary(), reference, 'finished')); await assert.rejects(f.library.save(acceptedTemplate(), 'Squat'));
  assert.equal(f.data.get(MOBILE_SESSION_HISTORY_KEY), '{broken'); assert.equal(f.data.get(MOBILE_REFERENCE_LIBRARY_KEY), '{broken');
  await f.history.clear(); await f.library.clear(); assert.equal(f.data.get(MOBILE_BODY_PROFILE_KEY), 'body-profile');
  assert.deepEqual(await f.history.list(), []); assert.deepEqual(await f.library.list(), []);
});

test('native static templates and duration reports persist alongside existing exercise types', async () => {
  const {staticTemplate,staticSummary}=await import('../../../packages/core/test/fixtures/staticTemplate.ts');
  const f=fixture();
  const template=await f.library.save(staticTemplate(),'Duruş');
  const squat=await f.library.save(acceptedTemplate(),'Squat');
  assert.deepEqual(await new NativeReferenceTemplateRepository(f.driver,f.makeId,f.now).list(),[squat,template]);
  const report=await f.history.saveStatic(staticSummary(),{intervalId:1,policyVersion:'static-pose-v1'},'finished');
  const generic=await f.history.saveGeneric(genericSummary(),{repetitionId:1,policyVersion:'generic-cycles-v1'},'interrupted');
  assert.deepEqual(await new NativeSessionHistoryRepository(f.driver,f.makeId,f.now).list(),[generic,report]);
});

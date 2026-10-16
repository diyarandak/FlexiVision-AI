import assert from 'node:assert/strict';
import test from 'node:test';
import type { GenericSessionSummary, LiveSessionSummary } from '@flexivision/contracts';
import { isSessionSummary } from '@flexivision/core';
import { BrowserSessionHistoryRepository, MAX_SESSION_RECORDS, SESSION_HISTORY_KEY } from '../src/adapters/sessionHistory.ts';
import { BODY_PROFILE_KEY } from '../src/adapters/bodyProfile.ts';

function summary(): LiveSessionSummary {
  return { durationMs: 1000, trackedMs: 700, unmeasuredMs: 300, bodyProfileUsed: true, repetitionCount: 1,
    cleanRepetitions: 0, sampledFrames: 10, trackedFrames: 8, lostFrames: 2, spokenCues: [], cueCandidatesCount: 0,
    errorBreakdown: {}, deviations: { knee: { samples: 8, mean: 4, max: 12 }, hip: { samples: 8, mean: 2, max: 4 } } };
}
function genericSummary(): GenericSessionSummary {
  return { durationMs: 1300, repetitionCount: 1, sampledFrames: 12, trackedFrames: 10,
    unmeasuredFrames: 2, cueCandidatesCount: 1, spokenCuesCount: 0, bodyProfileUsed: false };
}
function fixture() {
  const data = new Map<string, string>(); let id = 0;
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); } };
  const repository = new BrowserSessionHistoryRepository(() => storage, () => new Date('2026-10-09T00:00:00Z'), () => `session-${++id}`);
  return { data, storage, repository };
}
const reference = { repetitionId: 1, side: 'left' as const };
test('history survives a new repository, preserves interruption and removes only selected records', async () => {
  const { data, storage, repository } = fixture();
  data.set(BODY_PROFILE_KEY, 'separate-profile');
  const first = await repository.save(summary(), reference, 'finished'), second = await repository.save(summary(), reference, 'interrupted');
  const restored = new BrowserSessionHistoryRepository(() => storage);
  assert.deepEqual(await restored.list(), [second, first]);
  await restored.remove(first.id); assert.deepEqual(await restored.list(), [second]);
  await restored.clear(); assert.deepEqual(await restored.list(), []);
  assert.equal(data.get(BODY_PROFILE_KEY), 'separate-profile');
});
test('generic and legacy squat sessions coexist, reload, and remove independently without raw motion', async () => {
  const { data, storage, repository } = fixture();
  const squat = await repository.save(summary(), reference, 'finished');
  const generic = await repository.saveGeneric(Object.assign(genericSummary(), { landmarks: [{ x: 4 }], video: 'private-video' }),
    Object.assign({ repetitionId: 2, policyVersion: 'generic-cycles-v1' as const }, { sourceVideo: 'private-source' }), 'interrupted');
  const restored = new BrowserSessionHistoryRepository(() => storage);
  assert.deepEqual(await restored.list(), [generic, squat]);
  assert.equal(generic.exercise, 'generic-cycle');
  assert.equal(generic.schemaVersion, 2);
  assert.equal(squat.exercise, 'squat');
  const raw = data.get(SESSION_HISTORY_KEY)!;
  for (const value of ['landmarks', 'private-video', 'private-source']) assert.equal(raw.includes(value), false);
  await restored.remove(generic.id);
  assert.deepEqual(await restored.list(), [squat]);
});
test('generic history refuses an unmeasured or inconsistent session', async () => {
  const { repository } = fixture();
  const ref = { repetitionId: 1, policyVersion: 'generic-cycles-v1' as const };
  await assert.rejects(repository.saveGeneric({ ...genericSummary(), repetitionCount: 0, sampledFrames: 0,
    trackedFrames: 0, unmeasuredFrames: 0 }, ref, 'finished'));
  await assert.rejects(repository.saveGeneric({ ...genericSummary(), unmeasuredFrames: 1 }, ref, 'finished'));
  assert.deepEqual(await repository.list(), []);
});
test('workout targets survive reload while invalid or extra goal data is discarded', async () => {
  const { storage, repository } = fixture();
  const ref = { repetitionId:1,policyVersion:'generic-cycles-v1' as const };
  const saved = await repository.saveGeneric({ ...genericSummary(), repetitionGoal: Object.assign({ sets:2,repetitionsPerSet:5 }, { privateAudio:'excluded' }) }, ref, 'interrupted');
  const restored = (await new BrowserSessionHistoryRepository(() => storage).list())[0]!;
  assert.deepEqual(restored, saved);
  assert.equal(restored.exercise, 'generic-cycle');
  if (restored.exercise === 'generic-cycle') assert.deepEqual(restored.summary.repetitionGoal, { sets:2,repetitionsPerSet:5 });
  const invalid = await repository.saveGeneric({ ...genericSummary(), repetitionGoal:{sets:0,repetitionsPerSet:5} }, ref, 'finished');
  assert.equal(invalid.summary.repetitionGoal, undefined);
});
test('concurrent saves retain the newest 50 records without lost updates', async () => {
  const { repository } = fixture();
  await Promise.all(Array.from({ length: 52 }, () => repository.save(summary(), reference, 'finished')));
  const records = await repository.list();
  assert.equal(records.length, MAX_SESSION_RECORDS); assert.equal(records[0]!.id, 'session-52');
  assert.equal(records.at(-1)!.id, 'session-3'); assert.equal(new Set(records.map(r => r.id)).size, 50);
});
test('raw pose, video, profile and arbitrary attachments are excluded from history', async () => {
  const { data, repository } = fixture();
  await repository.save(Object.assign(summary(), { video: 'private-video', landmarks: [1], profile: { secret: 1 } }), reference, 'finished');
  const raw = data.get(SESSION_HISTORY_KEY)!;
  for (const text of ['private-video', 'landmarks', 'secret']) assert.equal(raw.includes(text), false);
});
test('corrupted history is preserved until explicitly cleared; failed writes never acknowledge success', async () => {
  const { data, storage, repository } = fixture();
  for (const raw of ['{broken', 'a'.repeat(1000001), JSON.stringify([{ summary: summary() }])]) {
    data.set(SESSION_HISTORY_KEY, raw);
    await assert.rejects(repository.list()); await assert.rejects(repository.save(summary(), reference, 'finished'));
    assert.equal(data.get(SESSION_HISTORY_KEY), raw);
  }
  await repository.clear();
  const denied = new BrowserSessionHistoryRepository(() => ({ ...storage, setItem() { throw new Error('Quota exceeded'); } }));
  await assert.rejects(denied.save(summary(), reference, 'finished'), /Quota exceeded/);
  assert.deepEqual(await repository.list(), []);
});
test('invalid counters, time accounting, deviation aggregates and speech receipts are rejected', async () => {
  const { repository } = fixture();
  assert.equal(isSessionSummary(summary()), true);
  for (const value of [{ ...summary(), trackedMs: NaN }, { ...summary(), unmeasuredMs: 0 }, { ...summary(), trackedFrames: 9 },
    { ...summary(), cleanRepetitions: 2 }, { ...summary(), spokenCues: [{ code: 'test', text: 'test', atMs: 0 }] },
    { ...summary(), deviations: { ...summary().deviations, knee: { samples: 0, mean: 4, max: 4 } } }]) {
    assert.equal(isSessionSummary(value), false); await assert.rejects(repository.save(value, reference, 'finished'));
  }
});

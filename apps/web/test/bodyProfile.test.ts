import assert from 'node:assert/strict';
import test from 'node:test';
import type { CalibrationProfile } from '@flexivision/contracts';
import { BrowserBodyProfileRepository, BODY_PROFILE_KEY } from '../src/adapters/bodyProfile.ts';

function fixture(): CalibrationProfile {
  return { schemaVersion: 2, kind: 'body-calibration', qualification: 'not_evaluated', policyVersion: 'body-scan-v2',
    width: 1280, height: 720, torsoPixels: 200, origin: { x: 0.5, y: 0.5 },
    proportions: { shoulderWidth: 0.8, hipWidth: 0.4, leftThigh: 0.9, rightThigh: 0.9, leftShin: 0.9, rightShin: 0.9 },
    neutralAngles: { leftKnee: 175, rightKnee: 173, leftHip: 170, rightHip: 171, leftElbow: null, rightElbow: null } };
}
function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
test('a new repository restores the saved body profile without any reference video', async () => {
  const data = storage(), first = new BrowserBodyProfileRepository(() => data, () => new Date('2026-10-09T00:00:00Z'));
  const record = await first.save(fixture());
  const reloaded = new BrowserBodyProfileRepository(() => data);
  assert.deepEqual(await reloaded.load(), record);
  assert.equal(record.savedAt, '2026-10-09T00:00:00.000Z');
  await reloaded.clear(); assert.equal(await first.load(), null);
});
test('old, corrupted, incomplete and oversized storage does not become a valid profile', async () => {
  const data = storage(), repo = new BrowserBodyProfileRepository(() => data);
  for (const raw of ['{broken', JSON.stringify({ schemaVersion: 1, savedAt: 'not-a-date', profile: fixture() }),
    JSON.stringify({ schemaVersion: 1, savedAt: '2026-10-09', profile: { ...fixture(), schemaVersion: 1 } }),
    JSON.stringify({ schemaVersion: 1, savedAt: '2026-10-09', profile: { ...fixture(), proportions: {} } }),
    'a'.repeat(16001)]) {
    data.data.set(BODY_PROFILE_KEY, raw);
    assert.equal(await repo.load(), null);
  }
});
test('storage failure is reported and is never treated as a successful save', async () => {
  const repo = new BrowserBodyProfileRepository(() => { throw new Error('Storage denied'); });
  await assert.rejects(repo.save(fixture()), /Storage denied/);
  await assert.rejects(repo.load(), /Storage denied/);
});
test('only body profile fields are saved, no attached camera data or reference-specific fields', async () => {
  const data = storage(), repo = new BrowserBodyProfileRepository(() => data);
  const enriched = Object.assign(fixture(), { landmarks: [{ x: 1 }], video: 'private-video', referenceView: {} });
  await repo.save(enriched);
  const raw = data.data.get(BODY_PROFILE_KEY)!;
  assert.equal(raw.includes('landmarks'), false); assert.equal(raw.includes('private-video'), false);
  assert.equal(raw.includes('referenceView'), false);
  await assert.rejects(repo.save({ ...fixture(), torsoPixels: NaN }), /geçerli/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { CalibrationProfile, CameraPoseObservation, SessionRecord } from '@flexivision/contracts';
import type { LivePoseSource } from '@flexivision/application';
import { acceptedTemplate } from '../../../packages/core/test/fixtures/acceptedTemplate.ts';
import { standing } from '../../../packages/core/test/fixtures/liveStanding.ts';
import { MobileSquatSessionController } from '../src/models/mobileSession.ts';
import { NativeSessionHistoryRepository } from '../src/adapters/nativeRecords.ts';

class Source implements LivePoseSource {
  emit: (value: CameraPoseObservation) => void = () => {};
  fail: (error: Error) => void = () => {};
  stops = 0;
  async start(emit: typeof this.emit, fail: typeof this.fail) { this.emit = emit; this.fail = fail; }
  stop() { this.stops++; }
  prepare() { for (let time = 0; time <= 4200; time += 100) this.emit(standing(time)); }
}
const profile: CalibrationProfile = { schemaVersion: 2, kind: 'body-calibration', qualification: 'not_evaluated', policyVersion: 'body-scan-v2',
  width: 1000, height: 1000, torsoPixels: 250, origin: { x: .5, y: .45 },
  proportions: { shoulderWidth: .3, hipWidth: .25, leftThigh: .8, rightThigh: .8, leftShin: .8, rightShin: .8 },
  neutralAngles: { leftKnee: 180, rightKnee: 180, leftHip: 180, rightHip: 180, leftElbow: null, rightElbow: null } };
function fixture() {
  const sources: Source[] = [], data = new Map<string, string>(); let id = 0, denied = false;
  const history = new NativeSessionHistoryRepository({ getItem: key => data.get(key) ?? null,
    setItem(key, value) { if (denied) throw new Error('Quota'); data.set(key, value); }, removeItem: key => { data.delete(key); } }, () => `session-${++id}`);
  const controller = new MobileSquatSessionController(acceptedTemplate(), () => { const source = new Source(); sources.push(source); return source; },
    undefined, undefined, 0, { bodyProfile: profile, history, now: () => 4600 });
  return { controller, sources, history, deny: (value: boolean) => { denied = value; } };
}
test('native preparation excludes setup frames; stored profile and monotonic stop tail reach the report', async () => {
  const f = fixture(); await f.controller.start(); const source = f.sources[0]!;
  source.emit(standing(0)); assert.equal(f.controller.getState().setup?.stage, 'positioning');
  for (let time = 100; time <= 4400; time += 100) source.emit(standing(time));
  const record = await f.controller.finishAndSave(); assert.ok(record);
  assert.equal(record.summary.sampledFrames, 3); assert.equal(record.summary.bodyProfileUsed, true);
  assert.equal(record.summary.durationMs, 400); assert.equal(record.summary.trackedMs, 200); assert.equal(record.summary.unmeasuredMs, 200);
  assert.equal(source.stops, 1); assert.equal(f.controller.getState().currentFrame, undefined); assert.equal(f.controller.getState().lastCue, null);
});
test('restart creates a fresh source, old frames/errors are ignored, and duplicate saves write once', async () => {
  const f = fixture(); await f.controller.start(); f.sources[0]!.prepare();
  const [first, second] = await Promise.all([f.controller.finishAndSave(), f.controller.finishAndSave()]);
  assert.equal(first?.id, second?.id); assert.equal((await f.history.list()).length, 1);
  await f.controller.start(); assert.equal(f.sources.length, 2);
  f.sources[0]!.emit(standing(5000)); f.sources[0]!.fail(new Error('Old failure'));
  assert.equal(f.controller.getState().active, true); assert.equal(f.controller.getState().error, null);
  assert.equal(f.controller.getState().currentFrame, undefined); f.sources[1]!.prepare(); await f.controller.interrupt();
  const records = await f.history.list(); assert.equal(records.length, 2); assert.equal(records[0]!.endReason, 'interrupted');
});
test('failed save retains the frozen report for retry and prevents accidental replacement', async () => {
  const f = fixture(); await f.controller.start(); f.sources[0]!.prepare(); f.deny(true);
  await assert.rejects(f.controller.finishAndSave(), /Quota/); const frozen = f.controller.getState().summary;
  assert.equal(f.controller.getState().saveStatus, 'failed'); assert.ok(f.controller.getState().saveError);
  await f.controller.start(); assert.equal(f.sources.length, 1); assert.deepEqual(f.controller.getState().summary, frozen);
  f.deny(false); const saved = await f.controller.retrySave(); assert.deepEqual(saved?.summary, frozen);
  assert.equal(f.controller.getState().saveStatus, 'saved'); await f.controller.retrySave(); assert.equal((await f.history.list()).length, 1);
});
test('empty preparation never creates a report; tracking loss clears current measurements', async () => {
  const f = fixture(); await f.controller.start(); f.sources[0]!.emit(standing(0));
  assert.equal(await f.controller.interrupt(), null); assert.equal((await f.history.list()).length, 0);
  await f.controller.start(); f.sources[1]!.prepare();
  f.sources[1]!.emit({ ...standing(4300), frame: { timestampMs: 4300, people: [] } });
  assert.equal(f.controller.getState().currentMatch, null); assert.equal(f.controller.getState().currentFrame, undefined);
  assert.equal(f.controller.getState().hasWarning, false); await f.controller.interrupt();
  const lostRecord = (await f.history.list())[0]!;
  assert.equal(lostRecord.exercise, 'squat');
  if (lostRecord.exercise !== 'squat') throw new Error('Squat oturumu bekleniyordu.');
  assert.equal(lostRecord.summary.lostFrames, 1);
});
test('technical failure stops the source, archives interruption and preserves the error after save', async () => {
  const f = fixture(); await f.controller.start(); f.sources[0]!.prepare(); f.sources[0]!.fail(new Error('Native engine failed'));
  await f.controller.retrySave(); assert.equal(f.sources[0]!.stops, 1); assert.equal(f.controller.getState().active, false);
  assert.equal(f.controller.getState().error, 'Native engine failed'); assert.equal((await f.history.list())[0]!.endReason, 'interrupted');
});
test('unsaved reports may be explicitly discarded; consumed legacy sources cannot silently restart', async () => {
  const f = fixture(); await f.controller.start(); f.sources[0]!.prepare(); f.deny(true);
  await assert.rejects(f.controller.finishAndSave()); f.controller.discardUnsavedReport();
  f.deny(false); await f.controller.start(); assert.equal(f.sources.length, 2); await f.controller.interrupt();
  const source = new Source(), legacy = new MobileSquatSessionController(acceptedTemplate(), source);
  await legacy.start(); legacy.stop(); await legacy.start(); assert.equal(legacy.getState().active, false); assert.match(legacy.getState().error!, /yeni kamera kaynağı/);
});
test('a save-state callback requesting retry shares the pending write instead of duplicating the report', async () => {
  const f = fixture(), source = new Source(); let controller!: MobileSquatSessionController, pending: Promise<SessionRecord | null> | undefined;
  controller = new MobileSquatSessionController(acceptedTemplate(), () => source, undefined, state => {
    if (state.saveStatus === 'saving' && !pending) pending = controller.retrySave();
  }, 0, { history: f.history });
  await controller.start(); source.prepare(); const saved = await controller.finishAndSave();
  assert.equal((await pending)?.id, saved?.id); assert.equal((await f.history.list()).length, 1);
});

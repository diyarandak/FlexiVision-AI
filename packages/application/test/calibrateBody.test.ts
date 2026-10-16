import assert from 'node:assert/strict';
import test from 'node:test';
import type { CameraPoseObservation } from '@flexivision/contracts';
import { CalibrateBody, PrepareLiveSessionSource, TrackLiveSquatSession } from '../src/index.ts';
import { acceptedTemplate } from '../../core/test/fixtures/acceptedTemplate.ts';
import type { LivePoseSource } from '../src/index.ts';

class Source implements LivePoseSource {
  stops = 0;
  emit: (observation: CameraPoseObservation) => void = () => {};
  fail: (error: Error) => void = () => {};
  capture: (time: number) => void = () => {};
  async start(emit: typeof this.emit, fail: typeof this.fail, capture?: typeof this.capture) {
    this.emit = emit; this.fail = fail; this.capture = capture ?? (() => {});
  }
  stop() { this.stops++; }
}
test('calibration stop ignores late frames and releases the camera port', async () => {
  const source = new Source(), task = new CalibrateBody(source);
  let readings = 0;
  await task.start(() => readings++, () => assert.fail('Unexpected error'));
  const observation = { width: 1000, height: 1000, frame: { timestampMs: 0, people: [] } };
  source.emit(observation); task.stop(); source.emit({ ...observation, frame: { timestampMs: 100, people: [] } });
  assert.equal(readings, 1); assert.equal(source.stops, 1);
});
test('camera failure is separate from calibration evidence and terminates the source', async () => {
  const source = new Source(), task = new CalibrateBody(source);
  let failures = 0;
  await task.start(() => assert.fail('No camera frames expected'), () => failures++);
  source.fail(new Error('Permission denied')); source.fail(new Error('Late error'));
  assert.equal(failures, 1); assert.equal(source.stops, 1);
});
test('starting an already stopped calibration never requests camera permission', async () => {
  const source = new Source(); let starts = 0; source.start = async () => { starts++; };
  const task = new CalibrateBody(source); task.stop();
  await task.start(() => {}, () => {});
  assert.equal(starts, 0);
});
test('capture activity is forwarded only for the active calibration run', async () => {
  const source = new Source(), task = new CalibrateBody(source), captures: number[] = [];
  await task.start(() => {}, () => assert.fail('No errors'), time => captures.push(time));
  source.capture(100); task.stop(); source.capture(200);
  assert.deepEqual(captures, [100]);
});
test('cleanup failures cannot hide the original technical error or keep late callbacks alive', async () => {
  let cancelled = 0;
  for (const create of [
    (source: Source) => new CalibrateBody(source),
    (source: Source) => new PrepareLiveSessionSource(source, 'left', () => {}),
    (source: Source) => new TrackLiveSquatSession(source, acceptedTemplate(), { available: false, speak() {}, cancel() { cancelled++; } }),
  ]) {
    const source = new Source(), task = create(source), errors: string[] = [];
    source.stop = () => { source.stops++; throw new Error('Cleanup failed'); };
    await task.start(() => assert.fail('No late observation'), error => errors.push(error.message));
    source.fail(new Error('Original technical error')); source.fail(new Error('Late failure'));
    source.emit({ width: 1000, height: 1000, frame: { timestampMs: 0, people: [] } });
    assert.deepEqual(errors, ['Original technical error']); assert.equal(source.stops, 1);
  }
  assert.equal(cancelled, 1);
});

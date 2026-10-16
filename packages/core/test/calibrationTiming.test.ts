import assert from 'node:assert/strict';
import test from 'node:test';
import { CalibrationStreamTiming } from '../src/calibrationTiming.ts';

test('a slow in-flight frame preserves progress and freshness starts at receipt', () => {
  const timing = new CalibrationStreamTiming();
  timing.captureStarted(0); assert.equal(timing.received(0, 100), true);
  timing.captureStarted(200);
  assert.equal(timing.check(1900), 'processing');
  assert.equal(timing.received(200, 2400), true);
  assert.equal(timing.check(2500), 'fresh');
  assert.equal(timing.check(4000), 'stale');
});
test('a stuck pipeline times out and does not accept an over-age or mismatched result', () => {
  const timing = new CalibrationStreamTiming(); timing.captureStarted(100);
  assert.equal(timing.check(8100), 'processing');
  assert.equal(timing.check(8101), 'timed_out');
  assert.equal(timing.received(100, 8101), false);
  assert.equal(timing.received(200, 1000), false);
  assert.equal(timing.received(NaN, 1000), false);
  assert.equal(timing.received(100, 99), false);
});
test('reset releases all previous pipeline timing without manufacturing a fresh observation', () => {
  const timing = new CalibrationStreamTiming(); timing.captureStarted(100); timing.reset();
  assert.equal(timing.check(10000), 'fresh');
  timing.captureStarted(10100); assert.equal(timing.received(10100, 10200), true);
  assert.equal(timing.check(11800), 'stale');
});

test('a camera that stops producing frames cannot remain stale forever', () => {
  const timing = new CalibrationStreamTiming();
  timing.captureStarted(100); assert.equal(timing.received(100, 200), true);
  assert.equal(timing.check(1800), 'stale');
  assert.equal(timing.check(8200), 'stale');
  assert.equal(timing.check(8201), 'timed_out');
  timing.reset(); timing.captureStarted(9000);
  assert.equal(timing.received(9000, 9010), true);
  assert.equal(timing.check(9020), 'fresh');
});

test('a short camera stall recovers on a genuinely new measurement', () => {
  const timing = new CalibrationStreamTiming(); timing.received(100, 150);
  assert.equal(timing.check(1800), 'stale');
  timing.captureStarted(1900); assert.equal(timing.received(1900, 1950), true);
  assert.equal(timing.check(2000), 'fresh');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveReadiness } from '../src/liveReadiness.ts';
import { standing } from './fixtures/liveStanding.ts';
test('a measured standing side view holds, counts down and starts without a body rescan or T pose', () => {
  const check = new LiveReadiness('left');
  for (let time = 0; time < 1200; time += 100) assert.equal(check.observe(standing(time)).stage, 'positioning');
  assert.equal(check.observe(standing(1200)).countdown, 3);
  for (let time = 1300; time < 2200; time += 100) assert.equal(check.observe(standing(time)).countdown, 3);
  assert.equal(check.observe(standing(2200)).countdown, 2);
  for (let time = 2300; time < 3200; time += 100) check.observe(standing(time));
  assert.equal(check.observe(standing(3200)).countdown, 1);
  for (let time = 3300; time < 4200; time += 100) check.observe(standing(time));
  assert.equal(check.observe(standing(4200)).stage, 'active');
  const gone = standing(4300); gone.frame.people = [];
  assert.equal(check.observe(gone).stage, 'active'); // Normal exercise tracking owns loss after start.
});
test('missing joints, multiple people, cropped view, front view and slow processing have concrete guides', () => {
  const ankle = standing(0); ankle.frame.people[0]!.landmarks[27]!.visibility = 0;
  assert.equal(new LiveReadiness('left').observe(ankle).guide, 'show_ankles');
  const knee = standing(0); knee.frame.people[0]!.landmarks[26]!.visibility = 0;
  assert.equal(new LiveReadiness('right').observe(knee).guide, 'show_knees');
  const multiple = standing(0); multiple.frame.people.push(multiple.frame.people[0]!);
  assert.equal(new LiveReadiness('left').observe(multiple).guide, 'multiple_people');
  const cropped = standing(0); cropped.frame.people[0]!.landmarks[27]!.y = 1.1;
  assert.equal(new LiveReadiness('left').observe(cropped).guide, 'step_back');
  const front = standing(0); front.frame.people[0]!.landmarks[12]!.x = .9;
  assert.equal(new LiveReadiness('left').observe(front).guide, 'turn_sideways');
  assert.equal(new LiveReadiness('left').observe({ ...standing(0), processingMs: 1800 }).guide, 'processing_slow');
  const invalid = standing(0); invalid.width = NaN;
  assert.equal(new LiveReadiness('left').observe(invalid).guide, 'stream_waiting');
});
test('loss or a long gap cancels countdown; returning observations need a new hold', () => {
  const check = new LiveReadiness('left');
  for (let time = 0; time <= 2500; time += 100) check.observe(standing(time));
  const missing = standing(2600); missing.frame.people = [];
  assert.equal(check.observe(missing).countdown, null);
  assert.equal(check.observe(standing(2700)).progress, 0);
  assert.equal(check.observe(standing(4000)).stage, 'positioning');
  assert.equal(check.observe(standing(4100)).progress, 100 / 1200);
  assert.equal(check.invalidate().guide, 'stream_waiting');
  assert.equal(check.observe(standing(4200)).progress, 0);
});
test('starting bent, tiny body, sparse observations and invalid clocks cannot authorize a session', () => {
  const bent = standing(0); bent.frame.people[0]!.landmarks[27]!.x -= .2;
  assert.equal(new LiveReadiness('left').observe(bent).guide, 'stand_still');
  const tiny = standing(0); tiny.frame.people[0]!.landmarks.forEach(p => { p.x = .5 + (p.x-.5)*.3; p.y = .5 + (p.y-.5)*.3; });
  assert.equal(new LiveReadiness('left').observe(tiny).guide, 'step_closer');
  const sparse = new LiveReadiness('left');
  for (let time = 0; time <= 10000; time += 1000) assert.equal(sparse.observe(standing(time)).stage, 'positioning');
  assert.throws(() => sparse.observe(standing(NaN)), /timestamps/);
  assert.throws(() => sparse.observe(standing(10000)), /timestamps/);
});
test('a slow capture cadence is explained instead of showing hold at zero forever', () => {
  const check = new LiveReadiness('left'); check.observe(standing(0));
  for (let time = 600; time <= 6000; time += 600) {
    const update = check.observe(standing(time));
    assert.equal(update.guide, 'stream_slow'); assert.equal(update.progress, 0); assert.equal(update.stage, 'positioning');
  }
});

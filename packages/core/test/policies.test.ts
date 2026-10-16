import assert from 'node:assert/strict';
import test from 'node:test';
import type { FormObservation, ReferenceEvidence } from '@flexivision/contracts';
import { evaluateReference, FeedbackPolicy, jointAngleDegrees } from '../src/index.ts';

const correct: FormObservation = { status: 'correct' };
const wrong: FormObservation = { status: 'incorrect', errors: [{ code: 'knee', message: 'Diz açını düzelt.', severity: 2 }] };
const unknown: FormObservation = { status: 'unknown', reason: 'tracking_lost' };
const evidence: ReferenceEvidence = {
  durationMs: 5000, sampledFrames: 25, usableFrames: 25, multiPersonFrames: 0,
  view: 'supported', motion: 'supported', completeRepetitions: 1,
};

function simulate(getObservation: (ms: number) => FormObservation, until = 30000) {
  const policy = new FeedbackPolicy(0);
  const times: number[] = [];
  for (let ms = 0; ms <= until; ms += 250) {
    const cue = policy.observe(ms, getObservation(ms));
    if (cue) times.push(cue.atMs);
  }
  return times;
}

test('correct movement stays silent for the full session', () => {
  assert.deepEqual(simulate(() => correct), []);
});
test('persistent error speaks first at 10s and at most once per 10s', () => {
  assert.deepEqual(simulate(() => wrong), [10000, 20000, 30000]);
});
test('short errors near a check do not speak', () => {
  assert.deepEqual(simulate(ms => ms >= 9500 && ms <= 10000 ? wrong : correct), []);
});
test('resolved errors are never read from a backlog', () => {
  assert.deepEqual(simulate(ms => ms < 9750 ? wrong : correct), []);
});
test('unknown tracking clears persistence and does not count as correct form', () => {
  assert.deepEqual(simulate(ms => ms === 9750 ? unknown : wrong), [11500, 21500]);
});
test('returning from suspension does not replay stale warnings', () => {
  const policy = new FeedbackPolicy(0);
  for (let ms = 0; ms < 10000; ms += 250) policy.observe(ms, wrong);
  assert.equal(policy.observe(10000, wrong)?.atMs, 10000);
  assert.equal(policy.observe(60000, wrong), null);
  const cues: number[] = [];
  for (let ms = 60250; ms <= 70000; ms += 250) {
    const cue = policy.observe(ms, wrong); if (cue) cues.push(cue.atMs);
  }
  assert.deepEqual(cues, [61500]);
});
test('unknown frames at ten-second boundaries cannot starve persistent current errors', () => {
  const cues=simulate(ms => ms % 10000 < 500 ? unknown : wrong,40000);
  assert.deepEqual(cues,[12000,22000,32000]);
});
test('a busy output cannot spend a correction interval or queue a resolved error', () => {
  const policy=new FeedbackPolicy(0);
  for(let ms=0;ms<=12000;ms+=250) assert.equal(policy.observe(ms,wrong,false),null);
  assert.equal(policy.observe(12250,wrong,true)?.atMs,12250);
  for(let ms=12500;ms<=22500;ms+=250) assert.equal(policy.observe(ms,wrong,false),null);
  assert.equal(policy.observe(22750,correct,true),null);
  for(let ms=23000;ms<24500;ms+=250)assert.equal(policy.observe(ms,wrong,true),null);
  assert.equal(policy.observe(24500,wrong,true)?.atMs,24500);
});
test('non-monotonic or invalid clocks are rejected', () => {
  const policy = new FeedbackPolicy(100);
  assert.throws(() => policy.observe(99, wrong));
  assert.throws(() => policy.observe(Number.NaN, wrong));
  assert.throws(() => new FeedbackPolicy(-1));
});
test('malformed errors never speak', () => {
  assert.deepEqual(simulate(() => ({ status: 'incorrect', errors: [{ code: '', message: '', severity: NaN }] })), []);
});
test('only the highest priority error is emitted', () => {
  const policy = new FeedbackPolicy(0);
  const observation: FormObservation = { status: 'incorrect', errors: [
    { code: 'low', message: 'Low', severity: 1 },
    { code: 'high', message: 'High', severity: 3 },
  ] };
  for (let ms = 0; ms < 10000; ms += 250) policy.observe(ms, observation);
  assert.equal(policy.observe(10000, observation)?.code, 'high');
});
test('complete supported evidence can be accepted', () => {
  assert.equal(evaluateReference(evidence).status, 'accepted');
});
test('unknown view or motion cannot silently pass', () => {
  const decision = evaluateReference({ ...evidence, view: 'unknown', motion: 'unknown' });
  assert.equal(decision.status, 'rejected');
  if (decision.status === 'rejected') assert.deepEqual(decision.reasons, ['unsupported_view', 'unsupported_motion']);
});
test('incomplete repetition, multiple people and occlusion give explicit reasons', () => {
  const decision = evaluateReference({ ...evidence, usableFrames: 5, multiPersonFrames: 1, completeRepetitions: 0 });
  if (decision.status !== 'rejected') assert.fail('must reject');
  assert.deepEqual(decision.reasons, ['multiple_people', 'body_not_visible', 'incomplete_repetition']);
});
test('corrupt counts and NaN evidence fail closed', () => {
  for (const bad of [{ ...evidence, usableFrames: 26 }, { ...evidence, durationMs: NaN }, { ...evidence, sampledFrames: -1 }]) {
    const decision = evaluateReference(bad);
    assert.equal(decision.status, 'rejected');
    if (decision.status === 'rejected') assert.deepEqual(decision.reasons, ['invalid_evidence']);
  }
});
test('zero frames and out-of-range duration cannot pass', () => {
  assert.equal(evaluateReference({ ...evidence, durationMs: 1000 }).status, 'rejected');
  assert.equal(evaluateReference({ ...evidence, sampledFrames: 0, usableFrames: 0 }).status, 'rejected');
});
test('angle geometry handles right angles and invalid vectors', () => {
  const origin = { x: 0, y: 0, z: 0 };
  assert.equal(jointAngleDegrees({ x: 1, y: 0, z: 0 }, origin, { x: 0, y: 1, z: 0 }), 90);
  assert.equal(jointAngleDegrees(origin, origin, { x: 1, y: 1, z: 1 }), null);
  assert.equal(jointAngleDegrees({ x: NaN, y: 0, z: 0 }, origin, origin), null);
});

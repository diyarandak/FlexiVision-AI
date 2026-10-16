import assert from 'node:assert/strict';
import test from 'node:test';
import type { PersonPose, PoseSequence } from '@flexivision/contracts';
import { buildGenericTemplate, buildMotionMap, detectGenericCycles, evaluateGenericReference } from '../src/index.ts';

const hold = (value: number, count = 8) => Array<number>(count).fill(value);
const ramp = (from: number, to: number, count = 12) => Array.from({ length: count }, (_, index) =>
  from + (to - from) * index / (count - 1));
const raise = () => [...hold(0), ...ramp(0, 1), ...hold(1, 5), ...ramp(1, 0), ...hold(0)];

function pose(progress: number): PersonPose {
  const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const put = (index: number, x: number, y: number) => { p[index] = { x, y, z: 0, visibility: 0.95 }; };
  put(11, 0.43, 0.30); put(12, 0.57, 0.30);
  put(23, 0.45, 0.55); put(24, 0.55, 0.55);
  // Both arms remain almost straight: elbow angles alone cannot detect the raise.
  const dx = 0.04 + 0.26 * progress, dy = 0.30 * (1 - progress);
  put(13, 0.43 - dx / 2, 0.30 + dy / 2); put(15, 0.43 - dx, 0.30 + dy);
  put(14, 0.57 + dx / 2, 0.30 + dy / 2); put(16, 0.57 + dx, 0.30 + dy);
  return { landmarks: p, worldLandmarks: [] };
}

function sequence(values: number[], frameMs = 100): PoseSequence {
  return { schemaVersion: 1, engine: { name: 'mediapipe-pose', version: 'test', model: 'synthetic' },
    durationMs: values.length * frameMs, width: 720, height: 1280, sampleFps: 1000 / frameMs,
    frames: values.map((value, index) => ({ timestampMs: index * frameMs, people: [pose(value)] })) };
}

test('straight-arm raise produces a measured generic cycle with normalized 2D vector samples', () => {
  const map = buildMotionMap(sequence(raise()));
  assert.equal(map.status, 'insufficient_data'); // squat-only lower-body coverage is irrelevant here
  const analysis = detectGenericCycles(map);
  assert.equal(analysis.status, 'ready');
  assert.equal(analysis.repetitions.length, 1);
  assert.deepEqual(analysis.motionIndices, [13, 14, 15, 16]);
  assert.equal(analysis.trackedIndices.length, 4);
  assert.ok(analysis.repetitions[0]!.startMs < analysis.repetitions[0]!.turnMs);
  assert.ok(analysis.repetitions[0]!.turnMs < analysis.repetitions[0]!.endMs);
  const { decision, evidence } = evaluateGenericReference(map, analysis);
  assert.equal(evidence.view, 'supported');
  assert.equal(evidence.usableFrames, evidence.sampledFrames);
  assert.equal(decision.status, 'accepted');
  const template = buildGenericTemplate(map, 1, decision);
  assert.equal(template.qualification, 'accepted');
  assert.equal(template.samples.length, 51);
  assert.equal(template.samples[0]!.phase, 'outbound');
  assert.equal(template.samples[50]!.phase, 'return');
  assert.equal(template.samples[0]!.landmarks.length, 33);
  assert.ok(template.samples.every(sample => template.trackedIndices.every(index => sample.landmarks[index] !== null)));
  assert.ok(template.samples[0]!.landmarks[15]!.y > template.samples[25]!.landmarks[15]!.y);
  assert.deepEqual(JSON.parse(JSON.stringify(template)), template);
});

test('normalizing to 51 points removes source video tempo as a matching requirement', () => {
  const slow = buildMotionMap(sequence(raise(), 100));
  const quick = buildMotionMap(sequence(raise(), 50));
  const a = buildGenericTemplate(slow, 1), b = buildGenericTemplate(quick, 1);
  assert.equal(a.durationMs, b.durationMs * 2);
  for (let index = 0; index < 51; index++) {
    const left = a.samples[index]!.landmarks[15]!, right = b.samples[index]!.landmarks[15]!;
    assert.ok(Math.abs(left.x - right.x) < 1e-6);
    assert.ok(Math.abs(left.y - right.y) < 1e-6);
  }
});

test('camera translation and uniform image scale do not alter pelvis-centred template vectors', () => {
  const original = sequence(raise()), shifted = structuredClone(original);
  for (const frame of shifted.frames) {
    for (const point of frame.people[0]!.landmarks) {
      point.x = 0.5 + (point.x - 0.5) * 0.8 + 0.04;
      point.y = 0.5 + (point.y - 0.5) * 0.8 - 0.03;
    }
  }
  const a = buildGenericTemplate(buildMotionMap(original), 1);
  const b = buildGenericTemplate(buildMotionMap(shifted), 1);
  for (let index = 0; index < 51; index++) {
    for (const landmarkIndex of a.trackedIndices) {
      const left = a.samples[index]!.landmarks[landmarkIndex]!;
      const right = b.samples[index]!.landmarks[landmarkIndex]!;
      assert.ok(Math.abs(left.x - right.x) < 1e-6);
      assert.ok(Math.abs(left.y - right.y) < 1e-6);
    }
  }
});

test('static, shallow movement and an isolated landmark spike do not become accepted cycles', () => {
  for (const values of [hold(0, 50), raise().map(value => value * 0.07),
    [...hold(0), ...ramp(0, 1), ...hold(1, 20)], (() => {
    const values = hold(0, 50); values[20] = 1; return values;
  })()]) {
    const map = buildMotionMap(sequence(values));
    const analysis = detectGenericCycles(map);
    assert.equal(analysis.repetitions.length, 0);
    assert.equal(evaluateGenericReference(map, analysis).decision.status, 'rejected');
    assert.throws(() => buildGenericTemplate(map, 1));
  }
});

test('a tracking gap, cropped torso, extra person, and unstable projection cannot authorize a session', () => {
  const broken = sequence(raise());
  broken.frames[22]!.people[0]!.landmarks[11]!.visibility = 0;
  const brokenMap = buildMotionMap(broken);
  assert.equal(detectGenericCycles(brokenMap).repetitions.length, 0);
  assert.equal(evaluateGenericReference(brokenMap).decision.status, 'rejected');

  const cropped = sequence(raise());
  cropped.frames.forEach(frame => frame.people[0]!.landmarks[23]!.visibility = 0);
  assert.equal(detectGenericCycles(buildMotionMap(cropped)).reason, 'body_not_visible');

  const crowded = sequence(raise());
  crowded.frames[22]!.people.push(pose(0));
  const crowdedDecision = evaluateGenericReference(buildMotionMap(crowded)).decision;
  assert.equal(crowdedDecision.status, 'rejected');
  if (crowdedDecision.status === 'rejected') assert.ok(crowdedDecision.reasons.includes('multiple_people'));

  const turning = sequence(raise());
  for (const frame of turning.frames.slice(16, 32)) {
    const p = frame.people[0]!.landmarks;
    p[11]!.x = 0.20; p[12]!.x = 0.80; p[23]!.x = 0.25; p[24]!.x = 0.75;
  }
  assert.equal(detectGenericCycles(buildMotionMap(turning)).reason, 'unstable_view');
});

test('an accepted decision passed for different rejected evidence is not trusted', () => {
  const good = buildMotionMap(sequence(raise()));
  const accepted = evaluateGenericReference(good).decision;
  assert.equal(accepted.status, 'accepted');
  const map = buildMotionMap(sequence(raise()));
  map.sequence.frames[0]!.people.push(pose(0));
  assert.throws(() => buildGenericTemplate(map, 1, accepted));
  const fraudulent = detectGenericCycles(buildMotionMap(sequence(hold(0, 50))));
  fraudulent.repetitions.push({ id: 1, startMs: 0, turnMs: 2000, endMs: 4000, movementScore: 1 });
  assert.equal(evaluateGenericReference(buildMotionMap(sequence(hold(0, 50))), fraudulent).decision.status, 'rejected');
});

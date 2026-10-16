import assert from 'node:assert/strict';
import test from 'node:test';
import type { PersonPose, PoseSequence } from '@flexivision/contracts';
import { buildMotionMap, imageAngles, motionCoverage } from '../src/motionMap.ts';

function person(): PersonPose {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  for (const [index, x, y] of [[11,0.2,0.1],[23,0.2,0.4],[25,0.5,0.5],[27,0.5,0.9]]) {
    landmarks[index!] = { x: x!, y: y!, z: 0, visibility: 0.95 };
  }
  return { landmarks, worldLandmarks: [] };
}
function sequence(): PoseSequence {
  return { schemaVersion: 1, engine: { name: 'mediapipe-pose', version: 'test', model: 'synthetic' },
    durationMs: 3000, width: 1920, height: 1080, sampleFps: 10,
    frames: Array.from({ length: 30 }, (_, i) => ({ timestampMs: i * 100, people: [person()] })) };
}

test('image angles restore aspect ratio instead of treating normalized axes equally', () => {
  const p = person();
  p.landmarks[23] = { x: 0.25, y: 0.25, z: 0, visibility: 1 };
  p.landmarks[25] = { x: 0.5, y: 0.5, z: 0, visibility: 1 };
  p.landmarks[27] = { x: 0.75, y: 0.25, z: 0, visibility: 1 };
  const angle = imageAngles(p, 200, 100).leftKnee;
  assert.ok(angle !== null && Math.abs(angle - 126.86989764584402) < 0.0001);
});
test('occluded or out-of-frame joints are null, never zero-degree measurements', () => {
  const p = person(); p.landmarks[25]!.visibility = 0.3;
  assert.equal(imageAngles(p, 1920, 1080).leftKnee, null);
  p.landmarks[25]!.visibility = 0.9; p.landmarks[25]!.x = 1.1;
  assert.equal(imageAngles(p, 1920, 1080).leftKnee, null);
});
test('a measured map never becomes exercise approval', () => {
  const map = buildMotionMap(sequence());
  assert.equal(map.status, 'extracted');
  assert.equal(map.qualification, 'not_evaluated');
  assert.equal(map.quality.usableFrames, 30);
  assert.equal(map.ranges.rightKnee, null);
});
test('multiple bodies are retained for display but not mixed in an angle sequence', () => {
  const data = sequence(); data.frames[5]!.people.push(person());
  const map = buildMotionMap(data);
  assert.equal(map.quality.multiPersonFrames, 1);
  assert.equal(map.samples[5]!.angles2d.leftKnee, null);
  assert.equal(map.status, 'insufficient_data');
});
test('no person produces explicit insufficient data with gaps in all angle series', () => {
  const data = sequence(); data.frames.forEach(frame => frame.people = []);
  const map = buildMotionMap(data);
  assert.equal(map.status, 'insufficient_data');
  assert.equal(map.quality.usableRatio, 0);
  assert.ok(map.samples.every(sample => Object.values(sample.angles2d).every(angle => angle === null)));
});
test('unordered timestamps and oversized input are rejected', () => {
  const data = sequence(); data.frames[1]!.timestampMs = 0;
  assert.throws(() => buildMotionMap(data));
  assert.throws(() => buildMotionMap({ ...sequence(), durationMs: 100000 }));
});

test('cropped legs preserve upper-body measurements without qualifying the squat', () => {
  const data = sequence();
  for (const frame of data.frames) {
    const p = frame.people[0]!;
    p.landmarks[25]!.y = 1.2; p.landmarks[27]!.visibility = 0.1;
    p.landmarks[13] = { x: 0.4, y: 0.2, z: 0, visibility: 0.95 };
    p.landmarks[15] = { x: 0.6, y: 0.2, z: 0, visibility: 0.95 };
  }
  const map = buildMotionMap(data), coverage = motionCoverage(map);
  assert.equal(map.status, 'insufficient_data');
  assert.equal(map.qualification, 'not_evaluated');
  assert.equal(map.quality.usableFrames, 0);
  assert.deepEqual(coverage.landmarks, { shoulders: 30, hips: 30, knees: 0, ankles: 0 });
  assert.equal(coverage.angles.leftElbow, 30);
  assert.equal(coverage.angles.leftKnee, 0);
});

test('coverage excludes ambiguous multi-person frames and counts a visible pair once', () => {
  const data = sequence();
  data.frames[0]!.people.push(person());
  data.frames[1]!.people = [];
  data.frames[2]!.people[0]!.landmarks[12] = { x: 0.6, y: 0.1, z: 0, visibility: 0.95 };
  const coverage = motionCoverage(buildMotionMap(data));
  assert.equal(coverage.landmarks.shoulders, 28);
  assert.equal(coverage.angles.leftKnee, 28);
});

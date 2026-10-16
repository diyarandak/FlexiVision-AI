import assert from 'node:assert/strict';
import test from 'node:test';
import type { JointAngles, MotionMap } from '@flexivision/contracts';
import { buildSquatTemplate, detectSquatCycles } from '../src/squatCycles.ts';

function ramp(from: number, to: number, count = 10) {
  return Array.from({ length: count }, (_, i) => from + (to - from) * i / (count - 1));
}
const hold = (value: number, count = 8) => Array<number>(count).fill(value);
function cycle(bottom = 80) { return [...hold(170), ...ramp(170, bottom), ...hold(bottom), ...ramp(bottom, 170), ...hold(170)]; }

function mapFor(knees: (number | null)[], constantHip = false): MotionMap {
  const samples = knees.map((knee, i) => ({ timestampMs: i * 100, angles2d: {
    leftKnee: knee, leftHip: knee === null ? null : constantHip ? 170 : knee,
    rightKnee: null, rightHip: null, leftElbow: null, rightElbow: null,
  } as JointAngles }));
  const usableFrames = knees.filter(value => value !== null).length;
  return { schemaVersion: 1, kind: 'reference-motion-map', qualification: 'not_evaluated',
    status: usableFrames / knees.length >= 0.85 ? 'extracted' : 'insufficient_data',
    sequence: { schemaVersion: 1, engine: { name: 'mediapipe-pose', version: 'test', model: 'synthetic' },
      durationMs: knees.length * 100, width: 720, height: 1280, sampleFps: 10,
      frames: knees.map((_, i) => ({ timestampMs: i * 100, people: [{
        landmarks: Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 })), worldLandmarks: [],
      }] })) }, samples,
    quality: { sampledFrames: knees.length, singlePersonFrames: knees.length, usableFrames, multiPersonFrames: 0, usableRatio: usableFrames / knees.length },
    ranges: { leftKnee: null, rightKnee: null, leftHip: null, rightHip: null, leftElbow: null, rightElbow: null } };
}

test('standing to bent to standing makes one cycle with contiguous ordered phases', () => {
  const result = detectSquatCycles(mapFor(cycle()));
  assert.equal(result.status, 'ready'); assert.equal(result.side, 'left');
  assert.equal(result.repetitions.length, 1);
  const rep = result.repetitions[0]!;
  assert.ok(rep.startMs < rep.bottomMs && rep.bottomMs < rep.endMs);
  assert.deepEqual(rep.phases.map(p => p.phase), ['descent', 'bottom', 'ascent']);
  assert.equal(rep.phases[0]!.startMs, rep.startMs);
  assert.equal(rep.phases[2]!.endMs, rep.endMs);
  for (let i = 0; i < rep.phases.length; i++) {
    assert.ok(rep.phases[i]!.endMs > rep.phases[i]!.startMs);
    if (i) assert.equal(rep.phases[i - 1]!.endMs, rep.phases[i]!.startMs);
  }
});
test('incomplete leading and trailing movements are not counted', () => {
  const data = [...ramp(80, 170), ...hold(170), ...cycle(), ...ramp(170, 80), ...hold(80)];
  const result = detectSquatCycles(mapFor(data));
  assert.equal(result.repetitions.length, 1);
  assert.ok(result.repetitions[0]!.startMs >= 1800);
  assert.equal(detectSquatCycles(mapFor(cycle().slice(0, -10))).repetitions.length, 0);
});
test('a full cycle needs sustained standing evidence at both ends', () => {
  assert.equal(detectSquatCycles(mapFor([...hold(170, 1), ...ramp(150, 80), ...hold(80), ...ramp(80, 170), ...hold(170)])).repetitions.length, 0);
  assert.equal(detectSquatCycles(mapFor(cycle().slice(0, -8))).repetitions.length, 0);
});
test('measured partial edges explain the missing start, end or both without making a template', () => {
  const ascent = [...hold(80), ...ramp(80, 170), ...hold(170)];
  const descent = [...hold(170), ...ramp(170, 80), ...hold(80)];
  const cases = [
    [ascent, 'missing_standing_start'],
    [descent, 'missing_standing_end'],
    [[...ascent, ...descent], 'missing_standing_start_and_end'],
  ] as const;
  for (const [angles, cause] of cases) {
    const map = mapFor([...angles]), analysis = detectSquatCycles(map);
    assert.equal(analysis.incompleteCause, cause);
    assert.equal(analysis.repetitions.length, 0);
    assert.throws(() => buildSquatTemplate(map, 1));
  }
  const full = detectSquatCycles(mapFor([...ascent, ...cycle(), ...descent]));
  assert.equal(full.repetitions.length, 1);
  assert.equal(full.incompleteCause, undefined);
});
test('partial-cycle guidance cannot hide a tracking gap or diagnose static, shallow or knee-only motion as clipped squat', () => {
  const map = mapFor([...hold(80), ...ramp(80, 170), ...hold(170), ...ramp(170, 80), ...hold(80)]);
  map.samples[11]!.angles2d.leftKnee = null;
  assert.equal(detectSquatCycles(map).incompleteCause, 'tracking_gap');
  map.samples[11]!.angles2d.leftKnee = 110;
  for (let index = 11; index < map.samples.length; index++) map.samples[index]!.timestampMs += 500;
  assert.equal(detectSquatCycles(map).incompleteCause, 'tracking_gap');
  for (const other of [mapFor(hold(80, 40)), mapFor(cycle(130)), mapFor([...hold(80), ...ramp(80, 170), ...hold(170)], true)]) {
    assert.equal(detectSquatCycles(other).incompleteCause, undefined);
  }
});
test('flat, shallow and knee-only signals do not manufacture a squat cycle', () => {
  assert.equal(detectSquatCycles(mapFor(hold(170, 60))).repetitions.length, 0);
  assert.equal(detectSquatCycles(mapFor(cycle(130))).repetitions.length, 0);
  assert.equal(detectSquatCycles(mapFor(cycle(), true)).repetitions.length, 0);
});
test('isolated pose spikes do not become a bottom phase', () => {
  const angles = [...hold(170), ...ramp(170, 120), ...hold(120), ...ramp(120, 170), ...hold(170)];
  angles[21] = 70; angles[22] = 70;
  assert.equal(detectSquatCycles(mapFor(angles)).repetitions.length, 0);
});
test('a template suppresses an isolated tracked-joint spike without rewriting the raw motion map', () => {
  const map = mapFor(cycle());
  map.samples[21]!.angles2d.leftKnee = 30;
  map.samples[21]!.angles2d.leftHip = 25;
  const template = buildSquatTemplate(map, 1);
  assert.equal(Math.min(...template.samples.map(sample => sample.angles2d.leftKnee!)), 80);
  assert.equal(Math.min(...template.samples.map(sample => sample.angles2d.leftHip!)), 80);
  assert.equal(map.samples[21]!.angles2d.leftKnee, 30);
  assert.ok(template.samples.every(sample => sample.angles2d.rightKnee === null));
});
test('a missing tracked-side observation breaks a cycle even if the other side is visible', () => {
  const map = mapFor(cycle());
  map.samples[22]!.angles2d.leftKnee = null;
  map.samples[22]!.angles2d.leftHip = null;
  map.samples[22]!.angles2d.rightKnee = 80;
  map.samples[22]!.angles2d.rightHip = 80;
  const result = detectSquatCycles(map);
  assert.equal(result.repetitions.length, 0); assert.equal(result.side, 'left');
  assert.equal(result.trackingBreaks, 1);
  assert.throws(() => buildSquatTemplate(map, 1), /complete measured repetition/);
});
test('timestamp gaps cannot connect pre-gap and post-gap motion into a cycle', () => {
  const map = mapFor(cycle());
  for (let i = 22; i < map.samples.length; i++) map.samples[i]!.timestampMs += 500;
  assert.equal(detectSquatCycles(map).repetitions.length, 0);
});
test('usable frames on alternating sides cannot masquerade as one consistent tracked side', () => {
  const map = mapFor(cycle());
  map.samples.forEach((sample, i) => {
    if (i % 2) {
      sample.angles2d.rightKnee = sample.angles2d.leftKnee; sample.angles2d.rightHip = sample.angles2d.leftHip;
      sample.angles2d.leftKnee = null; sample.angles2d.leftHip = null;
    }
  });
  const result = detectSquatCycles(map);
  assert.equal(result.status, 'insufficient_data'); assert.equal(result.reason, 'no_consistent_side');
});
test('insufficient data and multiple-person maps cannot create templates', () => {
  const map = mapFor(cycle()); map.status = 'insufficient_data'; map.quality.multiPersonFrames = 1;
  assert.equal(detectSquatCycles(map).status, 'insufficient_data');
  assert.throws(() => buildSquatTemplate(map, 1));
});
test('a long static bottom does not become a complete cycle', () => {
  const map = mapFor([...hold(170), ...ramp(170, 80), ...hold(80, 130), ...ramp(80, 170), ...hold(170)]);
  assert.equal(detectSquatCycles(map).repetitions.length, 0);
});
test('separate cycles are numbered and the selected one creates 51 serializable draft points', () => {
  const map = mapFor([...cycle(), ...cycle(70)]);
  const result = detectSquatCycles(map);
  assert.equal(result.repetitions.length, 2);
  const template = buildSquatTemplate(map, 2);
  assert.equal(template.repetition.id, 2); assert.equal(template.qualification, 'not_evaluated');
  assert.equal(template.samples.length, 51);
  assert.equal(template.samples[0]!.progress, 0); assert.equal(template.samples[50]!.progress, 1);
  assert.equal(template.samples[0]!.offsetMs, 0); assert.equal(template.samples[50]!.offsetMs, template.durationMs);
  assert.equal(template.samples[0]!.phase, 'descent'); assert.equal(template.samples[50]!.phase, 'ascent');
  assert.ok(template.samples.every(sample => sample.angles2d.leftKnee !== null && sample.angles2d.leftHip !== null));
  assert.ok(template.samples.every(sample => sample.angles2d.rightElbow === null));
  assert.deepEqual(JSON.parse(JSON.stringify(template)), template);
});
test('normalization preserves the measured trajectory at a different reference tempo', () => {
  const map = mapFor(cycle()), faster = structuredClone(map);
  faster.samples.forEach(sample => sample.timestampMs /= 2);
  faster.sequence.frames.forEach(frame => frame.timestampMs /= 2);
  faster.sequence.durationMs /= 2; faster.sequence.sampleFps = 20;
  const first = buildSquatTemplate(map, 1), second = buildSquatTemplate(faster, 1);
  assert.equal(first.durationMs / 2, second.durationMs);
  assert.deepEqual(first.samples.map(s => [s.progress, s.angles2d]), second.samples.map(s => [s.progress, s.angles2d]));
});

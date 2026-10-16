import assert from 'node:assert/strict';
import test from 'node:test';
import type { CameraPoseObservation, PosePoint, SquatTemplate } from '@flexivision/contracts';
import { BodyCalibration, calibrationTarget, normalizeBodyPose } from '../src/calibration.ts';
import { buildMotionMap } from '../src/motionMap.ts';
import { isBodyProfile } from '../src/bodyProfile.ts';

function observation(time: number, reference = false): CameraPoseObservation {
  const landmarks: PosePoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.1, z: 0, visibility: 0.95 }));
  for (const [i, x, y] of [
    [11,reference ? 0.44 : 0.35,0.24],[12,reference ? 0.56 : 0.65,0.24],
    [13,0.33,0.37],[14,0.67,0.37],[15,0.31,0.53],[16,0.69,0.53],
    [23,reference ? 0.464 : 0.4,0.48],[24,reference ? 0.536 : 0.6,0.48],
    [25,reference ? 0.464 : 0.4,0.68],[26,reference ? 0.536 : 0.6,0.68],
    [27,reference ? 0.464 : 0.4,0.88],[28,reference ? 0.536 : 0.6,0.88],
  ]) landmarks[i!] = { x: x!, y: y!, z: 0, visibility: 0.95 };
  return { width: 1000, height: 1000, frame: { timestampMs: time, people: [{ landmarks, worldLandmarks: [] }] } };
}
function completed() {
  const session = new BodyCalibration();
  let update = session.observe(observation(0));
  for (let i = 1; i <= 25; i++) update = session.observe(observation(i * 100));
  return { session, update };
}
test('a relaxed standing scan completes without a reference video or a T pose', () => {
  const session = new BodyCalibration();
  for (let time = 0; time < 2500; time += 100) assert.equal(session.observe(observation(time)).profile, null);
  const update = session.observe(observation(2500));
  assert.equal(update.stage, 'complete'); assert.equal(update.progress, 1);
  assert.equal(update.profile?.schemaVersion, 2); assert.equal(update.profile?.qualification, 'not_evaluated');
  assert.ok(isBodyProfile(update.profile));
  assert.deepEqual(JSON.parse(JSON.stringify(update.profile)), update.profile);
  assert.equal('referenceView' in update.profile!, false);
  assert.equal('side' in update.profile!, false);
});
test('body-width ratios and relaxed or occluded hands do not reject a visible torso and legs', () => {
  const session = new BodyCalibration();
  let update;
  for (let time = 0; time <= 2500; time += 100) {
    const value = observation(time, true);
    value.frame.people[0]!.landmarks[15]!.visibility = 0.1;
    value.frame.people[0]!.landmarks[16]!.visibility = 0.1;
    update = session.observe(value);
    assert.notEqual(update.guide, 'face_camera');
  }
  assert.equal(update?.stage, 'complete');
  assert.equal(update?.profile?.neutralAngles.leftElbow, null);
});
test('brief visibility loss freezes progress without counting missing time or approving a missing frame', () => {
  const session = new BodyCalibration();
  for (let time = 0; time <= 800; time += 100) session.observe(observation(time));
  const missing = observation(900); missing.frame.people[0]!.landmarks[27]!.visibility = 0.2;
  const update = session.observe(missing);
  assert.equal(update.guide, 'show_ankles'); assert.equal(update.progress, 0.32); assert.equal(update.profile, null);
  assert.equal(session.observe(observation(1000)).progress, 0.32);
  for (let time = 1100; time <= 2500; time += 100) assert.equal(session.observe(observation(time)).profile, null);
  assert.equal(session.observe(observation(2600)).profile, null);
  assert.equal(session.observe(observation(2700)).stage, 'complete');
});
test('sustained missing joints reset the scan and cannot manufacture a saved baseline', () => {
  const session = new BodyCalibration();
  session.observe(observation(0)); session.observe(observation(500));
  for (const time of [600, 800, 1000]) {
    const missing = observation(time); missing.frame.people[0]!.landmarks[28]!.visibility = 0;
    assert.equal(session.observe(missing).profile, null);
  }
  assert.equal(session.observe(observation(1100)).progress, 0);
});
test('multiple people invalidate accumulation immediately', () => {
  const session = new BodyCalibration();
  session.observe(observation(0)); session.observe(observation(500));
  const multiple = observation(600); multiple.frame.people.push(multiple.frame.people[0]!);
  const update = session.observe(multiple);
  assert.equal(update.guide, 'multiple_people'); assert.equal(update.progress, 0); assert.equal(update.profile, null);
});
test('edge, off-centre, small and obscured head have specific guidance', () => {
  const edge = observation(0); edge.frame.people[0]!.landmarks[28]!.y = 1.05;
  assert.equal(new BodyCalibration().observe(edge).guide, 'show_ankles');
  const shifted = observation(0); shifted.frame.people[0]!.landmarks.forEach(p => p.x += 0.19);
  assert.equal(new BodyCalibration().observe(shifted).guide, 'center_body');
  const small = observation(0); small.frame.people[0]!.landmarks.forEach(p => { p.x = 0.5+(p.x-0.5)*0.3; p.y = 0.5+(p.y-0.5)*0.3; });
  assert.equal(new BodyCalibration().observe(small).guide, 'step_closer');
  const head = observation(0); head.frame.people[0]!.landmarks[0]!.visibility = 0;
  assert.equal(new BodyCalibration().observe(head).guide, 'face_camera');
});
test('a usable smaller body is measured without a contradictory move-closer instruction', () => {
  const session = new BodyCalibration();
  let update;
  for (let time = 0; time <= 2500; time += 100) {
    const frame = observation(time);
    frame.frame.people[0]!.landmarks.forEach(point => {
      point.x = 0.5 + (point.x - 0.5) * 0.4;
      point.y = 0.5 + (point.y - 0.5) * 0.4;
    });
    update = session.observe(frame);
    assert.notEqual(update.guide, 'step_closer');
  }
  assert.equal(update?.stage, 'complete');
  assert.ok(isBodyProfile(update?.profile));
});
test('one edge asks for camera aiming or centering; only genuine vertical overflow asks for distance', () => {
  const compact = observation(0);
  compact.frame.people[0]!.landmarks.forEach(point => {
    point.x = 0.5 + (point.x - 0.5) * 0.4;
    point.y = 0.5 + (point.y - 0.5) * 0.4;
  });
  const low = structuredClone(compact);
  low.frame.people[0]!.landmarks.forEach(point => { point.y += 0.315; });
  assert.equal(new BodyCalibration().observe(low).guide, 'show_ankles');
  const high = structuredClone(compact);
  high.frame.people[0]!.landmarks.forEach(point => { point.y -= 0.315; });
  assert.equal(new BodyCalibration().observe(high).guide, 'show_shoulders');
  const right = structuredClone(compact);
  right.frame.people[0]!.landmarks.forEach(point => { point.x += 0.41; });
  assert.equal(new BodyCalibration().observe(right).guide, 'center_body');
  const overflowing = observation(0);
  overflowing.frame.people[0]!.landmarks[27]!.y = 1.05;
  overflowing.frame.people[0]!.landmarks[28]!.y = 1.05;
  assert.equal(new BodyCalibration().observe(overflowing).guide, 'step_back');
});
test('small-body guidance has a release margin so minor scale jitter cannot flicker the direction', () => {
  const session = new BodyCalibration();
  const scaled = (time: number, scale: number) => {
    const frame = observation(time);
    frame.frame.people[0]!.landmarks.forEach(point => {
      point.x = 0.5 + (point.x - 0.5) * scale;
      point.y = 0.5 + (point.y - 0.5) * scale;
    });
    return frame;
  };
  assert.equal(session.observe(scaled(0, 0.36)).guide, 'step_closer');
  assert.equal(session.observe(scaled(100, 0.41)).guide, 'step_closer');
  assert.equal(session.observe(scaled(200, 0.45)).guide, 'hold_still');
});
test('standing must be observable, no person never completes a scan', () => {
  const bent = observation(0); bent.frame.people[0]!.landmarks[26]!.x += 0.14;
  assert.equal(new BodyCalibration().observe(bent).guide, 'stand_straight');
  const session = new BodyCalibration();
  for (let time = 0; time <= 3000; time += 100) {
    const empty = observation(time); empty.frame.people = [];
    assert.equal(session.observe(empty).profile, null);
  }
});
test('a timestamp gap or sustained body movement restarts the accumulated window', () => {
  const session = new BodyCalibration();
  session.observe(observation(0)); session.observe(observation(500));
  assert.equal(session.observe(observation(1800)).progress, 0);
  const moved = observation(1900); moved.frame.people[0]!.landmarks.forEach(p => p.x += 0.05);
  assert.equal(session.observe(moved).progress, 0);
  assert.equal(session.observe(observation(2000)).profile, null);
});
test('few observations cannot complete a scan by elapsed time alone', () => {
  const session = new BodyCalibration();
  for (const time of [0, 900, 1800, 2700]) assert.equal(session.observe(observation(time)).stage, 'front');
});
test('two-second sequential analysis accumulates evidence instead of resetting each valid frame', () => {
  const session = new BodyCalibration();
  for (let i = 0; i < 10; i++) {
    const value = { ...observation(i * 2100), processingMs: 2000 };
    const update = session.observe(value);
    assert.equal(update.progress, i / 10);
    assert.equal(update.profile, null);
  }
  const update = session.observe({ ...observation(21000), processingMs: 2000 });
  assert.equal(update.stage, 'complete'); assert.ok(isBodyProfile(update.profile));
});
test('time outside inference still resets a slow stream and invalid durations cannot become a profile', () => {
  const session = new BodyCalibration();
  session.observe({ ...observation(0), processingMs: 2000 });
  assert.equal(session.observe({ ...observation(2100), processingMs: 2000 }).progress, 0.1);
  assert.equal(session.observe({ ...observation(6200), processingMs: 2000 }).progress, 0);
  for (const processingMs of [NaN, -1, Infinity, 8001]) {
    assert.throws(() => new BodyCalibration().observe({ ...observation(0), processingMs }), /processing duration/);
  }
});
test('a completed baseline remains complete after the scan ends and the person leaves', () => {
  const { session, update } = completed();
  const empty = observation(3000); empty.frame.people = [];
  assert.deepEqual(session.observe(empty).profile, update.profile);
});
test('normalization removes image translation and scale without mixing z into 2D coordinates', () => {
  const first = observation(0), transformed = structuredClone(first);
  transformed.frame.people[0]!.landmarks.forEach(p => { p.x = p.x*0.75+0.1; p.y = p.y*0.75+0.1; p.z = 999; });
  const a = normalizeBodyPose(first)!, b = normalizeBodyPose(transformed)!;
  for (let i = 0; i < a.landmarks.length; i++) {
    assert.ok(Math.abs(a.landmarks[i]!.x - b.landmarks[i]!.x) < 1e-9);
    assert.ok(Math.abs(a.landmarks[i]!.y - b.landmarks[i]!.y) < 1e-9);
  }
  transformed.frame.people[0]!.landmarks[28]!.visibility = 0;
  assert.equal(normalizeBodyPose(transformed)!.landmarks[28], null);
  transformed.frame.people.push(transformed.frame.people[0]!);
  assert.equal(normalizeBodyPose(transformed), null);
});
test('invalid timestamps cannot advance calibration', () => {
  const session = new BodyCalibration(); session.observe(observation(100));
  assert.throws(() => session.observe(observation(100)), /monotonic/);
  assert.throws(() => session.observe(observation(NaN)), /monotonic/);
});
function referenceFixture() {
  const map = buildMotionMap({ schemaVersion: 1,
    engine: { name: 'mediapipe-pose', version: 'test', model: 'synthetic-calibration-only' },
    width: 1000, height: 1000, durationMs: 3000, sampleFps: 10,
    frames: Array.from({ length: 30 }, (_, i) => observation(i * 100, true).frame) });
  const template = { repetition: { side: 'right', startMs: 500, endMs: 2500 } } as SquatTemplate;
  return { map, template };
}
test('reference starting view extraction remains a separate operation', () => {
  const { map, template } = referenceFixture();
  const target = calibrationTarget(map, template)!;
  assert.equal(target.side, 'right');
  assert.ok(Math.abs(target.shoulderRatio - 0.5) < 1e-9);
  assert.ok(Math.abs(target.hipRatio - 0.3) < 1e-9);
  map.sequence.frames[15]!.people[0]!.landmarks[11]!.x = 0.1;
  assert.deepEqual(calibrationTarget(map, template), target);
  map.samples.forEach(sample => { sample.angles2d.rightKnee = NaN; });
  assert.equal(calibrationTarget(map, template), null);
});
test('missing or unstable reference projections remain unavailable', () => {
  const missing = referenceFixture();
  missing.map.sequence.frames.forEach(frame => { frame.people[0]!.landmarks[11]!.visibility = 0; });
  assert.equal(calibrationTarget(missing.map, missing.template), null);
  const changing = referenceFixture();
  changing.map.sequence.frames.forEach((frame, i) => {
    const points = frame.people[0]!.landmarks, half = [0.06, 0.16, 0.26][i % 3]!;
    points[11]!.x = 0.5-half; points[12]!.x = 0.5+half;
  });
  assert.equal(calibrationTarget(changing.map, changing.template), null);
});
test('persisted profiles reject old versions, missing measurements and nonfinite values', () => {
  const profile = completed().update.profile!;
  assert.equal(isBodyProfile({ ...profile, schemaVersion: 1 }), false);
  assert.equal(isBodyProfile({ ...profile, torsoPixels: Infinity }), false);
  assert.equal(isBodyProfile({ ...profile, proportions: { ...profile.proportions, leftShin: null } }), false);
  assert.equal(isBodyProfile({ ...profile, neutralAngles: { ...profile.neutralAngles, rightKnee: null } }), false);
});

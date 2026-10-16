import assert from 'node:assert/strict';
import test from 'node:test';
import type { CameraPoseObservation, JointAngles, SquatTemplate } from '@flexivision/contracts';
import { PrepareLiveSessionSource, TrackLiveSquatSession, type LivePoseSource } from '../src/index.ts';
import { standing } from '../../core/test/fixtures/liveStanding.ts';

function template(): SquatTemplate {
  return { schemaVersion: 1, kind: 'squat-cycle-template', qualification: 'accepted', decision: { status: 'accepted', policyVersion: 'reference-v1' },
    policyVersion: 'squat-cycles-v1', source: { engine: { name: 'mediapipe-pose', version: 'test', model: 'synthetic' }, width: 1000, height: 1000, durationMs: 3000 },
    durationMs: 3000, repetition: { id: 1, side: 'left', startMs: 0, endMs: 3000, bottomMs: 1500,
      phases: [{ phase: 'descent', startMs: 0, endMs: 1200 }, { phase: 'bottom', startMs: 1200, endMs: 1800 }, { phase: 'ascent', startMs: 1800, endMs: 3000 }],
      kneeRange: { min: 80, max: 170 }, hipRange: { min: 80, max: 170 } },
    samples: Array.from({ length: 51 }, (_, i) => { const progress = i / 50, a = progress < .4 ? 170-progress/.4*90 : progress > .6 ? 80+(progress-.6)/.4*90 : 80;
      return { progress, offsetMs: progress*3000, phase: progress < .4 ? 'descent' : progress > .6 ? 'ascent' : 'bottom',
        angles2d: { leftKnee: a, leftHip: a, rightKnee: null, rightHip: null, leftElbow: null, rightElbow: null } as JointAngles }; }) };
}
test('setup frames stay out of the report and the first exercise cue is ten seconds after countdown', async () => {
  let emit: (value: CameraPoseObservation) => void = () => {}, stopped = 0, spoken = 0;
  const raw: LivePoseSource = { async start(cb) { emit = cb; }, stop() { stopped++; } };
  const prepared = new PrepareLiveSessionSource(raw, 'left', () => {});
  const session = new TrackLiveSquatSession(prepared, template(), { available: true, speak(_text, started) { spoken++; started?.(); }, cancel() {} });
  await session.start(() => {}, error => assert.fail(error.message));
  for (let time = 0; time < 4200; time += 100) emit(standing(time));
  assert.equal(session.getSummary().sampledFrames, 0); assert.equal(session.getSummary().durationMs, 0);
  for (let time = 4200; time <= 4400; time += 100) emit(standing(time));
  for (let time = 4500; time < 14200; time += 100) {
    const value = standing(time), p = value.frame.people[0]!.landmarks, rad = 125*Math.PI/180;
    p[27]!.x = .5-Math.sin(Math.PI-rad)*.2; p[27]!.y = .65+Math.cos(Math.PI-rad)*.2;
    p[11]!.x = .5-Math.sin(Math.PI/3)*.2; p[11]!.y = .45+Math.cos(Math.PI/3)*.2;
    p[12] = { ...p[11]!, x: p[11]!.x+.02 };
    emit(value);
  }
  assert.equal(spoken, 0);
  const final = standing(14200); const p = final.frame.people[0]!.landmarks;
  p[27]!.x = .5-Math.sin(55*Math.PI/180)*.2; p[27]!.y = .65+Math.cos(55*Math.PI/180)*.2;
  p[11]!.x = .5-Math.sin(Math.PI/3)*.2; p[11]!.y = .55; p[12] = { ...p[11]!, x: p[11]!.x+.02 };
  emit(final); assert.equal(spoken, 1); assert.equal(session.getSummary().durationMs, 10000);
  session.stop(); emit(standing(14300)); assert.equal(stopped, 1);
});
test('stop in setup, late results and invalid setup times release the source without exercise updates', async () => {
  let emit: (value: CameraPoseObservation) => void = () => {}, stopped = 0, failures = 0, updates = 0;
  const raw: LivePoseSource = { async start(cb) { emit = cb; }, stop() { stopped++; } };
  const prepared = new PrepareLiveSessionSource(raw, 'left', () => {});
  await prepared.start(() => updates++, () => failures++);
  emit(standing(100)); emit(standing(99)); emit(standing(200));
  assert.equal(failures, 1); assert.equal(updates, 0); assert.equal(stopped, 1);
  prepared.stop(); assert.equal(stopped, 1);
});
test('a setup callback may stop at readiness without forwarding the final or a late frame', async () => {
  let emit: (value: CameraPoseObservation) => void = () => {}, updates = 0, stopped = 0;
  const raw: LivePoseSource = { async start(cb) { emit = cb; }, stop() { stopped++; } };
  const prepared = new PrepareLiveSessionSource(raw, 'left', (_value, update) => { if (update.stage === 'active') prepared.stop(); });
  await prepared.start(() => updates++, () => assert.fail('No errors'));
  for (let time = 0; time <= 4300; time += 100) emit(standing(time));
  assert.equal(updates, 0); assert.equal(stopped, 1);
});

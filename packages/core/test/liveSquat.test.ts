import assert from 'node:assert/strict';
import test from 'node:test';
import type { JointAngles, MotionMap } from '@flexivision/contracts';
import { buildSquatTemplate, detectSquatCycles, evaluateSquatReference, LiveSquatComparer } from '../src/index.ts';

function ramp(from: number, to: number, count = 10) {
  return Array.from({ length: count }, (_, i) => from + (to - from) * i / (count - 1));
}
const hold = (value: number, count = 8) => Array<number>(count).fill(value);
function cycle(bottom = 80) {
  return [...hold(170), ...ramp(170, bottom), ...hold(bottom), ...ramp(bottom, 170), ...hold(170)];
}

function createReferenceTemplate() {
  const knees = cycle();
  const samples = knees.map((knee, i) => ({
    timestampMs: i * 100,
    angles2d: {
      leftKnee: knee,
      leftHip: knee === null ? null : knee,
      rightKnee: null,
      rightHip: null,
      leftElbow: null,
      rightElbow: null,
    } as JointAngles,
  }));
  const map: MotionMap = {
    schemaVersion: 1,
    kind: 'reference-motion-map',
    qualification: 'not_evaluated',
    status: 'extracted',
    sequence: {
      schemaVersion: 1,
      engine: { name: 'mediapipe-pose', version: 'test', model: 'synthetic' },
      durationMs: knees.length * 100,
      width: 720,
      height: 1280,
      sampleFps: 10,
      frames: knees.map((_, i) => ({
        timestampMs: i * 100,
        people: [{
          landmarks: Array.from({ length: 33 }, (_, index) => ({ x: [12, 24].includes(index) ? 0.52 : 0.5, y: [11, 12].includes(index) ? 0.2 : [23, 24].includes(index) ? 0.4 : 0.5, z: 0, visibility: 0.9 })),
          worldLandmarks: [],
        }],
      })),
    },
    samples,
    quality: {
      sampledFrames: knees.length,
      singlePersonFrames: knees.length,
      usableFrames: knees.length,
      multiPersonFrames: 0,
      usableRatio: 1.0,
    },
    ranges: { leftKnee: null, rightKnee: null, leftHip: null, rightHip: null, leftElbow: null, rightElbow: null },
  };

  const analysis = detectSquatCycles(map);
  const { decision } = evaluateSquatReference(map, analysis);
  return buildSquatTemplate(map, 1, decision);
}

function trajectory(comparer: LiveSquatComparer, values: number[], start = 0, interval = 100) {
  return values.map((knee, i) => comparer.compareAngles(start + i * interval, { leftKnee:knee, leftHip:knee } as JointAngles));
}
const fullCycle = [170,170,170,150,130,110,80,80,80,80,100,130,160,170,170,170];

test('complete standing/descent/bottom/ascent/standing cycle counts once and stays silent', () => {
  const comparer = new LiveSquatComparer(createReferenceTemplate());
  const results = trajectory(comparer, fullCycle);
  assert.equal(comparer.getRepetitionCount(), 1);
  assert.ok(results.some(r => r.match?.phase === 'descent'));
  assert.ok(results.some(r => r.match?.phase === 'bottom'));
  assert.ok(results.some(r => r.match?.phase === 'ascent'));
  assert.ok(results.every(r => r.observation.status === 'correct'));
});
test('different supported tempos and consecutive cycles count without using reference duration', () => {
  for (const interval of [100,300]) {
    const comparer = new LiveSquatComparer(createReferenceTemplate());
    trajectory(comparer, fullCycle, 0, interval);
    trajectory(comparer, fullCycle, fullCycle.length * interval, interval);
    assert.equal(comparer.getRepetitionCount(), 2);
  }
});
test('starting bent and isolated bent-frame spikes do not manufacture a full repetition', () => {
  const comparer = new LiveSquatComparer(createReferenceTemplate());
  trajectory(comparer, [100,80,110,140,170,170,170]);
  assert.equal(comparer.getRepetitionCount(),0);
  trajectory(comparer,[170,170,170,80,170,170,170],1000);
  assert.equal(comparer.getRepetitionCount(),0);
});
test('slow sub-degree frames and a bottom pause follow the same reference without matching its duration', () => {
  const template = createReferenceTemplate();
  for (const steps of [181, 361]) {
    const comparer = new LiveSquatComparer(template);
    const values = [...hold(170, 20), ...ramp(170, 80, steps), ...hold(80, 50), ...ramp(80, 170, steps), ...hold(170, 20)];
    const results = trajectory(comparer, values, 0, 20);
    assert.equal(comparer.getRepetitionCount(), 1);
    assert.ok(results.some(result => result.match?.phase === 'ascent'));
    assert.ok(results.every(result => result.observation.status === 'correct'));
    assert.ok(values.length * 20 > template.durationMs * 2);
  }
});
test('a brief bent spike after a long descent is not a completed repetition', () => {
  const comparer = new LiveSquatComparer(createReferenceTemplate());
  trajectory(comparer, [...hold(170), ...ramp(170, 125, 20), 80, 130, 145, ...hold(170)]);
  assert.equal(comparer.getRepetitionCount(), 0);
});
test('an overlong unfinished cycle resets and a fresh measured cycle still counts', () => {
  const comparer = new LiveSquatComparer(createReferenceTemplate());
  const paused = [...hold(170), ...ramp(170, 80), ...hold(80, 310)];
  const results = trajectory(comparer, paused);
  assert.ok(results.some(result => result.observation.status === 'unknown' && result.observation.reason === 'cycle_timeout'));
  assert.equal(comparer.getRepetitionCount(), 0);
  trajectory(comparer, fullCycle, paused.length * 100);
  assert.equal(comparer.getRepetitionCount(), 1);
});
test('an unknown frame or long timestamp gap discards the incomplete cycle but preserves completed counts', () => {
  for (const reason of ['missing','gap','multiple']) {
    const comparer = new LiveSquatComparer(createReferenceTemplate());
    trajectory(comparer,fullCycle);
    trajectory(comparer,[170,170,170,140,100,80,80,80],2000);
    if (reason === 'missing') comparer.compareAngles(2800,null);
    if (reason === 'multiple') comparer.compare({width:640,height:480,frame:{timestampMs:2800,people:[{landmarks:[],worldLandmarks:[]},{landmarks:[],worldLandmarks:[]}]}});
    trajectory(comparer,[100,140,170,170,170],reason==='gap'?4000:2900);
    assert.equal(comparer.getRepetitionCount(),1);
  }
});
test('invalid timestamps fail and invalid angles return unknown', () => {
  const comparer = new LiveSquatComparer(createReferenceTemplate());
  comparer.compareAngles(100,{leftKnee:170,leftHip:170} as JointAngles);
  assert.throws(()=>comparer.compareAngles(100,null),/timestamps/);
  assert.throws(()=>comparer.compareAngles(NaN,null),/timestamps/);
  assert.equal(comparer.compareAngles(200,{leftKnee:181,leftHip:170} as JointAngles).observation.status,'unknown');
});
test('descent is not falsely reported as shallow depth while the user is still going down', () => {
  const comparer = new LiveSquatComparer(createReferenceTemplate());
  const results = trajectory(comparer,[170,170,170,150,130,110,104]);
  assert.equal(results.at(-1)?.match?.phase,'descent');
  assert.ok(results.every(r=>r.observation.status==='correct'));
  const held = trajectory(comparer,[104,104,104],700).at(-1)!;
  assert.equal(held.match?.phase,'bottom');
  assert.equal(held.observation.status,'incorrect');
  if(held.observation.status==='incorrect') assert.ok(held.observation.errors.some(e=>e.code==='insufficient_depth'));
});
test('excessive hip difference emits a reference deviation after a visible standing start', () => {
  const comparer = new LiveSquatComparer(createReferenceTemplate());
  trajectory(comparer,[170,170,170,150,135]);
  const result=comparer.compareAngles(500,{leftKnee:125,leftHip:60} as JointAngles);
  assert.equal(result.observation.status,'incorrect');
  if(result.observation.status==='incorrect') assert.ok(result.observation.errors.some(e=>e.code==='chest_forward'));
});
test('unqualified or missing tracked joint templates cannot start a live comparison', () => {
  const valid=createReferenceTemplate();
  assert.throws(()=>new LiveSquatComparer({...valid,qualification:'not_evaluated'}),/kabul/);
  const broken=structuredClone(valid); broken.samples[0]!.angles2d.leftKnee=null;
  assert.throws(()=>new LiveSquatComparer(broken),/eksik/);
});

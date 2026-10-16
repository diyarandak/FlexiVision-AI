import assert from 'node:assert/strict';
import test from 'node:test';
import type { JointAngles, MotionMap, RejectionCode } from '@flexivision/contracts';
import {
  buildSquatTemplate,
  detectSquatCycles,
  evaluateSquatReference,
  REFERENCE_REJECTION_MESSAGES,
  squatReferenceEvidence,
  squatCycleMessage,
} from '../src/index.ts';

function ramp(from: number, to: number, count = 10) {
  return Array.from({ length: count }, (_, i) => from + (to - from) * i / (count - 1));
}
const hold = (value: number, count = 8) => Array<number>(count).fill(value);
function cycle(bottom = 80) {
  return [...hold(170), ...ramp(170, bottom), ...hold(bottom), ...ramp(bottom, 170), ...hold(170)];
}

function mapFor(knees: (number | null)[], multiPerson = 0): MotionMap {
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
  const usableFrames = knees.filter(value => value !== null).length;
  return {
    schemaVersion: 1,
    kind: 'reference-motion-map',
    qualification: 'not_evaluated',
    status: usableFrames / knees.length >= 0.85 ? 'extracted' : 'insufficient_data',
    sequence: {
      schemaVersion: 1,
      engine: { name: 'mediapipe-pose', version: 'test', model: 'synthetic' },
      durationMs: knees.length * 100,
      width: 720,
      height: 1280,
      sampleFps: 10,
      frames: knees.map((_, i) => ({
        timestampMs: i * 100,
        people: i < multiPerson ? [
          { landmarks: Array.from({ length: 33 }, (_, index) => ({ x: [12, 24].includes(index) ? 0.52 : 0.5, y: [11, 12].includes(index) ? 0.2 : [23, 24].includes(index) ? 0.4 : 0.5, z: 0, visibility: 0.9 })), worldLandmarks: [] },
          { landmarks: Array.from({ length: 33 }, () => ({ x: 0.6, y: 0.6, z: 0, visibility: 0.8 })), worldLandmarks: [] },
        ] : [
          { landmarks: Array.from({ length: 33 }, (_, index) => ({ x: [12, 24].includes(index) ? 0.52 : 0.5, y: [11, 12].includes(index) ? 0.2 : [23, 24].includes(index) ? 0.4 : 0.5, z: 0, visibility: 0.9 })), worldLandmarks: [] },
        ],
      })),
    },
    samples,
    quality: {
      sampledFrames: knees.length,
      singlePersonFrames: knees.length - multiPerson,
      usableFrames,
      multiPersonFrames: multiPerson,
      usableRatio: usableFrames / knees.length,
    },
    ranges: { leftKnee: null, rightKnee: null, leftHip: null, rightHip: null, leftElbow: null, rightElbow: null },
  };
}

test('valid side squat reference evaluates to accepted decision', () => {
  const map = mapFor(cycle());
  const analysis = detectSquatCycles(map);
  const directEvidence = squatReferenceEvidence(map, analysis);
  assert.equal(directEvidence.view, 'supported');
  assert.equal(directEvidence.motion, 'supported');
  assert.equal(directEvidence.completeRepetitions, 1);

  const { evidence, decision } = evaluateSquatReference(map);
  assert.equal(evidence.view, 'supported');
  assert.equal(evidence.motion, 'supported');
  assert.equal(evidence.completeRepetitions, 1);
  assert.equal(decision.status, 'accepted');
});

test('multiple people in reference frames results in rejection', () => {
  const map = mapFor(cycle(), 2);
  const { decision } = evaluateSquatReference(map);
  assert.equal(decision.status, 'rejected');
  if (decision.status === 'rejected') {
    assert.ok(decision.reasons.includes('multiple_people'));
  }
});

test('body not visible / low usable ratio results in rejection', () => {
  const missingKnees = [...hold(170, 5), ...Array<null>(30).fill(null)];
  const map = mapFor(missingKnees);
  const { decision } = evaluateSquatReference(map);
  assert.equal(decision.status, 'rejected');
  if (decision.status === 'rejected') {
    assert.ok(decision.reasons.includes('body_not_visible'));
  }
});

test('flat standing without repetitions rejects with incomplete_repetition and unsupported_motion', () => {
  const flatStanding = hold(170, 40);
  const map = mapFor(flatStanding);
  const { decision } = evaluateSquatReference(map);
  assert.equal(decision.status, 'rejected');
  if (decision.status === 'rejected') {
    assert.ok(decision.reasons.includes('incomplete_repetition'));
    assert.ok(decision.reasons.includes('unsupported_motion'));
  }
});
test('visible bent/standing/bent motion stays rejected with unknown motion and measured edge guidance', () => {
  const map = mapFor([...hold(80), ...ramp(80, 170), ...hold(170), ...ramp(170, 80), ...hold(80)]);
  const analysis = detectSquatCycles(map), { evidence, decision } = evaluateSquatReference(map, analysis);
  assert.equal(evidence.usableFrames, evidence.sampledFrames);
  assert.equal(evidence.view, 'supported');
  assert.equal(evidence.motion, 'unknown');
  assert.equal(decision.status, 'rejected');
  if (decision.status === 'rejected') assert.deepEqual(decision.reasons, ['unsupported_motion', 'incomplete_repetition']);
  assert.match(squatCycleMessage(analysis).guidance, /çömelmiş → ayakta → çömelmiş/);
});

test('short video (<3000ms) rejects with duration_out_of_range', () => {
  const shortData = hold(170, 15); // 1500ms
  const map = mapFor(shortData);
  const { decision } = evaluateSquatReference(map);
  assert.equal(decision.status, 'rejected');
  if (decision.status === 'rejected') {
    assert.ok(decision.reasons.includes('duration_out_of_range'));
  }
});

test('template carries accepted qualification when provided with accepted decision', () => {
  const map = mapFor(cycle());
  const { decision } = evaluateSquatReference(map);
  const template = buildSquatTemplate(map, 1, decision);
  assert.equal(template.qualification, 'accepted');
  assert.equal(template.decision?.status, 'accepted');
});

test('template remains not_evaluated when no decision is provided', () => {
  const map = mapFor(cycle());
  const template = buildSquatTemplate(map, 1);
  assert.equal(template.qualification, 'not_evaluated');
  assert.equal(template.decision, undefined);
});

test('rejection messages cover all rejection codes with Turkish guidance', () => {
  const expectedCodes: RejectionCode[] = [
    'invalid_evidence',
    'duration_out_of_range',
    'insufficient_frames',
    'multiple_people',
    'body_not_visible',
    'unsupported_view',
    'unsupported_motion',
    'incomplete_repetition',
  ];
  for (const code of expectedCodes) {
    const entry = REFERENCE_REJECTION_MESSAGES[code];
    assert.ok(entry, `Missing message for ${code}`);
    assert.ok(entry.label.length > 0);
    assert.ok(entry.guidance.length > 0);
  }
});
test('a tracked left side cannot authorize a front-facing or unobservable camera view', () => {
  for (const variant of ['front','missing','degenerate']) {
    const map=mapFor(cycle());
    for (const frame of map.sequence.frames) {
      const p=frame.people[0]!.landmarks;
      if(variant==='front') { p[11]!.x=0.25; p[12]!.x=0.75; p[23]!.x=0.3; p[24]!.x=0.7; }
      if(variant==='missing') p[12]!.visibility=0;
      if(variant==='degenerate') p.forEach(point=>{point.x=0.5;point.y=0.5;});
    }
    assert.equal(detectSquatCycles(map).side,'left');
    const {decision}=evaluateSquatReference(map);
    assert.equal(decision.status,'rejected');
    if(decision.status==='rejected') assert.ok(decision.reasons.includes('unsupported_view'));
  }
});

import type { JointAngles, MotionMap, SquatTemplate } from '@flexivision/contracts';
import { buildSquatTemplate } from '../../src/squatCycles.ts';

/** Synthetic repository fixture, not a real video acceptance result. */
export function referenceMap(): MotionMap {
  const knees = [...Array<number>(8).fill(170), ...Array.from({ length: 10 }, (_, i) => 170 - i * 10),
    ...Array<number>(8).fill(80), ...Array.from({ length: 10 }, (_, i) => 80 + i * 10), ...Array<number>(8).fill(170)];
  return { schemaVersion: 1, kind: 'reference-motion-map', qualification: 'not_evaluated', status: 'extracted',
    sequence: { schemaVersion: 1, engine: { name: 'mediapipe-pose', version: 'test', model: 'synthetic-only' },
      durationMs: knees.length * 100, width: 1000, height: 1000, sampleFps: 10,
      frames: knees.map((_, i) => ({ timestampMs: i * 100, people: [] })) },
    samples: knees.map((knee, i) => ({ timestampMs: i * 100, angles2d: { leftKnee: knee, leftHip: knee,
      rightKnee: null, rightHip: null, leftElbow: null, rightElbow: null } as JointAngles })),
    quality: { sampledFrames: knees.length, singlePersonFrames: knees.length, usableFrames: knees.length,
      multiPersonFrames: 0, usableRatio: 1 },
    ranges: { leftKnee: null, rightKnee: null, leftHip: null, rightHip: null, leftElbow: null, rightElbow: null } };
}
export function acceptedTemplate(): SquatTemplate {
  return buildSquatTemplate(referenceMap(), 1, { status: 'accepted', policyVersion: 'reference-v1' });
}

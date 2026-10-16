import type { JointAngles, JointName, MotionMap, PersonPose, PosePoint, PoseSequence } from '@flexivision/contracts';
import { jointAngleDegrees } from './geometry.ts';

export const MIN_LANDMARK_VISIBILITY = 0.6;
export const JOINT_TRIPLETS: Record<JointName, readonly [number, number, number]> = {
  leftKnee: [23, 25, 27], rightKnee: [24, 26, 28],
  leftHip: [11, 23, 25], rightHip: [12, 24, 26],
  leftElbow: [11, 13, 15], rightElbow: [12, 14, 16],
};

export function isVisible(point: PosePoint | undefined): point is PosePoint {
  return !!point && [point.x, point.y, point.z, point.visibility].every(Number.isFinite)
    && point.visibility >= MIN_LANDMARK_VISIBILITY && point.visibility <= 1
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

export function imageAngles(person: PersonPose | undefined, width: number, height: number): JointAngles {
  return Object.fromEntries(Object.entries(JOINT_TRIPLETS).map(([name, indices]) => {
    const points = indices.map(index => person?.landmarks[index]);
    if (!points.every(isVisible)) return [name, null];
    // Restore the image aspect ratio. Normalized x and y have different units.
    const [a, vertex, b] = points.map(point => ({ x: point.x * width, y: point.y * height, z: 0 }));
    return [name, a && vertex && b ? jointAngleDegrees(a, vertex, b) : null];
  })) as JointAngles;
}

/** Counts usable observations, not anatomical correctness or confidence in an exercise. */
export function motionCoverage(map: MotionMap) {
  const groups = { shoulders: [11, 12], hips: [23, 24], knees: [25, 26], ankles: [27, 28] };
  const landmarks = Object.fromEntries(Object.entries(groups).map(([name, indices]) => [name,
    map.sequence.frames.filter(frame => frame.people.length === 1
      && indices.some(index => isVisible(frame.people[0]?.landmarks[index]))).length,
  ])) as Record<keyof typeof groups, number>;
  const angles = Object.fromEntries(Object.keys(JOINT_TRIPLETS).map(name => [name,
    map.samples.filter(sample => sample.angles2d[name as JointName] !== null).length,
  ])) as Record<JointName, number>;
  return { landmarks, angles };
}

export function buildMotionMap(sequence: PoseSequence): MotionMap {
  if (![sequence.width, sequence.height, sequence.durationMs, sequence.sampleFps].every(value => Number.isFinite(value) && value > 0)
      || sequence.durationMs > 60000 || sequence.sampleFps > 30 || sequence.frames.length > 1800) {
    throw new Error('Invalid sequence dimensions or sampling limits');
  }
  let lastTimestamp = -1;
  for (const frame of sequence.frames) {
    if (!Number.isFinite(frame.timestampMs) || frame.timestampMs < 0 || frame.timestampMs <= lastTimestamp || frame.timestampMs >= sequence.durationMs) {
      throw new Error('Frame timestamps must be ordered and within video duration');
    }
    lastTimestamp = frame.timestampMs;
  }
  let singlePersonFrames = 0, multiPersonFrames = 0, usableFrames = 0;
  const samples = sequence.frames.map(frame => {
    if (frame.people.length === 1) singlePersonFrames++;
    if (frame.people.length > 1) multiPersonFrames++;
    // Do not switch to a different detected person and mix two bodies in a template.
    const person = frame.people.length === 1 ? frame.people[0] : undefined;
    const angles2d = imageAngles(person, sequence.width, sequence.height);
    if ((angles2d.leftKnee !== null && angles2d.leftHip !== null)
      || (angles2d.rightKnee !== null && angles2d.rightHip !== null)) usableFrames++;
    return { timestampMs: frame.timestampMs, angles2d };
  });
  const ranges = Object.fromEntries(Object.keys(JOINT_TRIPLETS).map(key => {
    const values = samples.map(sample => sample.angles2d[key as JointName]).filter(value => value !== null);
    return [key, values.length ? { min: Math.min(...values), max: Math.max(...values) } : null];
  })) as MotionMap['ranges'];
  const sampledFrames = sequence.frames.length;
  const usableRatio = sampledFrames ? usableFrames / sampledFrames : 0;
  return {
    schemaVersion: 1, kind: 'reference-motion-map', qualification: 'not_evaluated',
    status: sampledFrames >= 15 && usableRatio >= 0.85 && multiPersonFrames === 0 ? 'extracted' : 'insufficient_data',
    sequence, samples, quality: { sampledFrames, singlePersonFrames, usableFrames, multiPersonFrames, usableRatio }, ranges,
  };
}

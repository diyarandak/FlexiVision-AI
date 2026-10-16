import type { CalibrationProfile, CameraPoseObservation, JointAngles, PersonalBodyPose } from '@flexivision/contracts';
import { isBodyProfile } from './bodyProfile.ts';
import { normalizeBodyPose } from './calibration.ts';
import { jointAngleDegrees } from './geometry.ts';
import { JOINT_TRIPLETS } from './motionMap.ts';

/** Re-centre and re-scale from this frame. A saved image origin is never reused. */
export function normalizePersonalBody(observation: CameraPoseObservation, profile: CalibrationProfile): PersonalBodyPose | null {
  if (!isBodyProfile(profile)) return null;
  const body = normalizeBodyPose(observation);
  if (!body) return null;
  const p = profile.proportions;
  const legInTorsoUnits = (p.leftThigh + p.leftShin + p.rightThigh + p.rightShin) / 2;
  return { origin: body.origin, legUnitPixels: body.torsoPixels * legInTorsoUnits,
    landmarks: body.landmarks.map(point => point ? { x: point.x / legInTorsoUnits, y: point.y / legInTorsoUnits } : null) };
}

/** Similarity normalization preserves the measured angles; it does not invent a
 * personalised safe depth or apply a front-view angle offset to a side view. */
export function personalBodyAngles(body: PersonalBodyPose): JointAngles {
  return Object.fromEntries(Object.entries(JOINT_TRIPLETS).map(([name, indices]) => {
    const [a, vertex, b] = indices.map(i => body.landmarks[i]);
    return [name, a && vertex && b ? jointAngleDegrees({ ...a, z: 0 }, { ...vertex, z: 0 }, { ...b, z: 0 }) : null];
  })) as JointAngles;
}

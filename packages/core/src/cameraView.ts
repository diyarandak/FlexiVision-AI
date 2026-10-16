import type { PersonPose, ReferenceEvidence } from '@flexivision/contracts';
import { isVisible } from './motionMap.ts';

/** Conservative image-projection checks for the side-view squat preset.
 * These engineering limits do not measure camera yaw or prove movement safety. */
export const SIDE_VIEW_POLICY = Object.freeze({ maxShoulderRatio: 0.65, maxHipRatio: 0.5, minFrames: 8, minSupportedRatio: 0.85 });
export function sideViewEvidence(person: PersonPose, width: number, height: number): ReferenceEvidence['view'] {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) return 'unknown';
  const p = person.landmarks;
  if (![11, 12, 23, 24].every(i => isVisible(p[i]))) return 'unknown';
  const torso = Math.hypot((p[11]!.x + p[12]!.x - p[23]!.x - p[24]!.x) * width / 2,
    (p[11]!.y + p[12]!.y - p[23]!.y - p[24]!.y) * height / 2);
  if (torso < 10) return 'unknown';
  const widthRatio = (a: number, b: number) => Math.hypot((p[a]!.x - p[b]!.x) * width, (p[a]!.y - p[b]!.y) * height) / torso;
  return widthRatio(11, 12) <= SIDE_VIEW_POLICY.maxShoulderRatio && widthRatio(23, 24) <= SIDE_VIEW_POLICY.maxHipRatio
    ? 'supported' : 'unsupported';
}

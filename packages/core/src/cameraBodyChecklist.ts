import type { PoseFrame } from '@flexivision/contracts';
import { isVisible } from './motionMap.ts';

/** Visibility is separate from pose acceptance and never certifies exercise form. */
export function cameraBodyChecklist(frame: PoseFrame | undefined) {
  const points = frame?.people.length === 1 ? frame.people[0]!.landmarks : undefined;
  const all = (indices: number[]) => !!points && indices.every(index => isVisible(points[index]));
  return [
    { label: 'Baş', visible: !!points && [0,7,8].some(index => isVisible(points[index])) },
    { label: 'Gövde', visible: all([11,12,23,24]) },
    { label: 'Kollar', visible: all([13,14,15,16]) },
    { label: 'Bacaklar', visible: all([25,26,27,28]) },
  ];
}

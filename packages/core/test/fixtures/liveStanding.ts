import type { CameraPoseObservation } from '@flexivision/contracts';
export function standing(time: number): CameraPoseObservation {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.1, z: 0, visibility: 0.9 }));
  for (const [i, x, y] of [[11,.5,.2],[12,.52,.2],[23,.5,.45],[24,.52,.45],[25,.5,.65],[26,.52,.65],[27,.5,.85],[28,.52,.85]])
    landmarks[i!] = { x: x!, y: y!, z: 0, visibility: 0.9 };
  return { width: 1000, height: 1000, processingMs: 50, frame: { timestampMs: time, people: [{ landmarks, worldLandmarks: [] }] } };
}

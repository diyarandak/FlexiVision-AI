import type { CalibrationProfile } from '@flexivision/contracts';

/** Validate persisted data before it re-enters the application. No camera images or pose arrays. */
export function isBodyProfile(value: unknown): value is CalibrationProfile {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  if (p.schemaVersion !== 2 || p.kind !== 'body-calibration' || p.qualification !== 'not_evaluated'
    || p.policyVersion !== 'body-scan-v2') return false;
  const finite = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  if (!finite(p.width, 1, 10000) || !finite(p.height, 1, 10000) || !finite(p.torsoPixels, 10, 15000)) return false;
  if (!p.origin || typeof p.origin !== 'object' || !p.proportions || typeof p.proportions !== 'object'
    || !p.neutralAngles || typeof p.neutralAngles !== 'object') return false;
  const origin = p.origin as Record<string, unknown>, proportions = p.proportions as Record<string, unknown>;
  const angles = p.neutralAngles as Record<string, unknown>;
  return finite(origin.x, 0, 1) && finite(origin.y, 0, 1)
    && ['shoulderWidth', 'hipWidth'].every(key => finite(proportions[key], 0, 10))
    && ['leftThigh', 'rightThigh', 'leftShin', 'rightShin'].every(key => finite(proportions[key], 0.001, 10))
    && ['leftKnee', 'rightKnee'].every(key => finite(angles[key], 0, 180))
    && ['leftHip', 'rightHip', 'leftElbow', 'rightElbow'].every(key => angles[key] === null || finite(angles[key], 0, 180));
}

import type { CalibrationGuide, CalibrationProfile, CalibrationTarget, CalibrationUpdate, CameraPoseObservation,
  JointAngles, MotionMap, NormalizedBodyPose, PersonPose, SquatTemplate } from '@flexivision/contracts';
import { imageAngles, isVisible } from './motionMap.ts';

export const CALIBRATION_POLICY = Object.freeze({ holdMs: 2500, minFrames: 8, maxGapMs: 1000,
  maxProcessingMs: 8000, maxSampleCreditMs: 250,
  visibilityGraceMs: 300,
  edgeMargin: 0.035, minBodyHeight: 0.30, minBodyHeightAfterCloser: 0.34,
  maxCenterShift: 0.04, maxScaleChange: 0.08,
  shoulderTolerance: 0.18, hipTolerance: 0.14 });
const REQUIRED = [11, 12, 23, 24, 25, 26, 27, 28];
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}
function geometry(person: PersonPose, width: number, height: number) {
  const p = person.landmarks;
  if (![11, 12, 23, 24].every(i => isVisible(p[i]))) return null;
  const shoulder = { x: (p[11]!.x + p[12]!.x) / 2, y: (p[11]!.y + p[12]!.y) / 2 };
  const origin = { x: (p[23]!.x + p[24]!.x) / 2, y: (p[23]!.y + p[24]!.y) / 2 };
  const distance = (a: number, b: number) => p[a] && p[b]
    ? Math.hypot((p[a]!.x - p[b]!.x) * width, (p[a]!.y - p[b]!.y) * height) : NaN;
  const torsoPixels = Math.hypot((shoulder.x - origin.x) * width, (shoulder.y - origin.y) * height);
  if (!Number.isFinite(torsoPixels) || torsoPixels < 10) return null;
  return { origin, torsoPixels, shoulderRatio: distance(11, 12) / torsoPixels,
    hipRatio: distance(23, 24) / torsoPixels, distance };
}

export function normalizeBodyPose(observation: CameraPoseObservation): NormalizedBodyPose | null {
  if (![observation.width, observation.height].every(value => Number.isFinite(value) && value > 0) || observation.frame.people.length !== 1) return null;
  const person = observation.frame.people[0]!, body = geometry(person, observation.width, observation.height);
  if (!body) return null;
  return { origin: body.origin, torsoPixels: body.torsoPixels, landmarks: person.landmarks.map(point => isVisible(point)
    ? { x: (point.x - body.origin.x) * observation.width / body.torsoPixels,
      y: (point.y - body.origin.y) * observation.height / body.torsoPixels } : null) };
}

export function calibrationTarget(map: MotionMap, template: SquatTemplate): CalibrationTarget | null {
  const side = template.repetition.side;
  const values = map.sequence.frames.flatMap((frame, index) => {
    const knee = map.samples[index]?.angles2d[`${side}Knee`];
    const nearTop = Math.abs(frame.timestampMs - template.repetition.startMs) <= 600
      || Math.abs(frame.timestampMs - template.repetition.endMs) <= 600;
    if (!nearTop
      || knee == null || !Number.isFinite(knee) || knee < 155 || frame.people.length !== 1) return [];
    const body = geometry(frame.people[0]!, map.sequence.width, map.sequence.height);
    return body ? [body] : [];
  });
  if (values.length < 3) return null;
  const shoulderRatio = median(values.map(v => v.shoulderRatio)), hipRatio = median(values.map(v => v.hipRatio));
  // A fluctuating reference projection cannot guide the user reliably.
  if (median(values.map(v => Math.abs(v.shoulderRatio - shoulderRatio))) > 0.12
    || median(values.map(v => Math.abs(v.hipRatio - hipRatio))) > 0.1) return null;
  return { side, shoulderRatio, hipRatio };
}

interface Reading {
  time: number;
  width: number;
  height: number;
  body: NonNullable<ReturnType<typeof geometry>>;
  angles: JointAngles;
  proportions: CalibrationProfile['proportions'];
}
function inspect(observation: CameraPoseObservation, wasTooSmall: boolean): { guide: CalibrationGuide; reading: Reading | null } {
  const fail = (guide: CalibrationGuide) => ({ guide, reading: null });
  const { frame, width, height } = observation;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return fail('no_person');
  if (!frame.people.length) return fail('no_person');
  if (frame.people.length !== 1) return fail('multiple_people');
  const person = frame.people[0]!, p = person.landmarks;
  // A single joint at one edge usually calls for re-aiming/centering the camera,
  // not changing distance. Ask for distance only if the body nearly fills its
  // vertical field and an endpoint is cropped.
  const observed = (index: number) => {
    const point = p[index];
    return point && point.visibility >= 0.6 && point.visibility <= 1
      && [point.x, point.y, point.z].every(Number.isFinite) ? point : null;
  };
  const head = observed(0), shoulders = [observed(11), observed(12)], ankles = [observed(27), observed(28)];
  const upperPoints = [head, ...shoulders].filter(point => point !== null);
  const topEdge = upperPoints.some(point => point.y < CALIBRATION_POLICY.edgeMargin);
  const bottomEdge = ankles.some(point => point !== null && point.y > 1 - CALIBRATION_POLICY.edgeMargin);
  if (head && ankles.every(point => point !== null)
    && Math.min(...ankles.map(point => point!.y)) - head.y > 0.9
    && (topEdge || bottomEdge)) return fail('step_back');
  if (REQUIRED.some(index => {
    const point = observed(index);
    return point && (point.x < CALIBRATION_POLICY.edgeMargin || point.x > 1 - CALIBRATION_POLICY.edgeMargin);
  })) return fail('center_body');
  if (topEdge) return fail('show_shoulders');
  if (bottomEdge) return fail('show_ankles');
  for (const [indices, guide] of [
    [[11, 12], 'show_shoulders'], [[23, 24], 'show_hips'], [[25, 26], 'show_knees'], [[27, 28], 'show_ankles'],
  ] as const) {
    if (!indices.every(i => isVisible(p[i]))) return fail(guide);
  }
  const body = geometry(person, width, height);
  if (!body) return fail('show_shoulders');
  if (Math.abs(body.origin.x - 0.5) > 0.18) return fail('center_body');
  if (!isVisible(p[0])) return fail('face_camera');
  const bodyHeight = Math.max(...ankles.map(point => point!.y)) - p[0]!.y;
  if (bodyHeight < (wasTooSmall ? CALIBRATION_POLICY.minBodyHeightAfterCloser : CALIBRATION_POLICY.minBodyHeight))
    return fail('step_closer');
  const angles = imageAngles(person, width, height);
  const knees = [angles.leftKnee, angles.rightKnee];
  if (knees.some(angle => angle === null || angle < 150)) return fail('stand_straight');
  // This scan measures visible geometry. Body-width ratios do not prove camera orientation.
  // Arms may rest naturally; no T pose is required for the torso/leg profile.
  return { guide: 'hold_still', reading: { time: frame.timestampMs, width, height, body, angles, proportions: {
    shoulderWidth: body.shoulderRatio, hipWidth: body.hipRatio,
    leftThigh: body.distance(23, 25) / body.torsoPixels, rightThigh: body.distance(24, 26) / body.torsoPixels,
    leftShin: body.distance(25, 27) / body.torsoPixels, rightShin: body.distance(26, 28) / body.torsoPixels,
  } } };
}

/** Stateful timing from supplied observations; no system clock, camera or browser dependency. */
export class BodyCalibration {
  private stage: CalibrationUpdate['stage'] = 'front';
  private readings: Reading[] = [];
  private profile: CalibrationProfile | null = null;
  private previousMs = -1;
  private previousProcessingMs = 0;
  private validMs = 0;
  private lastValidMs: number | null = null;
  private missingSince: number | null = null;
  private wasTooSmall = false;

  private resetWindow() {
    this.readings = []; this.validMs = 0; this.lastValidMs = null; this.missingSince = null;
  }

  observe(observation: CameraPoseObservation): CalibrationUpdate {
    const time = observation.frame.timestampMs;
    if (!Number.isFinite(time) || time < 0 || time <= this.previousMs) throw new Error('Calibration timestamps must be monotonic');
    const processingMs = observation.processingMs ?? 0;
    if (!Number.isFinite(processingMs) || processingMs < 0 || processingMs > CALIBRATION_POLICY.maxProcessingMs) {
      throw new Error('Calibration processing duration is invalid or too long');
    }
    // A completed scan is a baseline, not a continuing camera visibility approval.
    if (this.stage === 'complete') { this.previousMs = time; return this.update('ready', 1); }
    // Sequential inference delays the next capture. Subtract that known work, but
    // still reset when there was an actual gap outside the processing pipeline.
    if (this.previousMs >= 0 && time - this.previousMs - this.previousProcessingMs > CALIBRATION_POLICY.maxGapMs) {
      this.resetWindow();
    }
    this.previousMs = time;
    this.previousProcessingMs = processingMs;
    const result = inspect(observation, this.wasTooSmall);
    this.wasTooSmall = result.guide === 'step_closer';
    if (!result.reading) {
      const transient = ['no_person', 'show_shoulders', 'show_hips', 'show_knees', 'show_ankles', 'face_camera'].includes(result.guide);
      this.lastValidMs = null;
      if (this.missingSince === null) this.missingSince = time;
      if (!transient || time - this.missingSince > CALIBRATION_POLICY.visibilityGraceMs) this.resetWindow();
      return this.update(result.guide, this.progress());
    }
    if (this.missingSince !== null && time - this.missingSince > CALIBRATION_POLICY.visibilityGraceMs) this.resetWindow();
    this.missingSince = null;
    const reading = result.reading, first = this.readings[0];
    if (first && (reading.width !== first.width || reading.height !== first.height
      || Math.abs(reading.body.origin.x - first.body.origin.x) > CALIBRATION_POLICY.maxCenterShift
      || Math.abs(reading.body.origin.y - first.body.origin.y) > CALIBRATION_POLICY.maxCenterShift
      || Math.abs(reading.body.torsoPixels / first.body.torsoPixels - 1) > CALIBRATION_POLICY.maxScaleChange
      || Math.abs(reading.body.shoulderRatio - first.body.shoulderRatio) > 0.12
      || Math.abs(reading.body.hipRatio - first.body.hipRatio) > 0.1)) {
      this.resetWindow();
    }
    // Sparse slow frames must not earn seconds of unobserved standing time.
    if (this.lastValidMs !== null) this.validMs += Math.min(time - this.lastValidMs, CALIBRATION_POLICY.maxSampleCreditMs);
    this.lastValidMs = time;
    this.readings.push(reading);
    const progress = this.progress();
    if (progress < 1) return this.update('hold_still', progress);
    this.profile = { schemaVersion: 2, kind: 'body-calibration', qualification: 'not_evaluated', policyVersion: 'body-scan-v2',
      width: reading.width, height: reading.height,
      proportions: Object.fromEntries(Object.keys(reading.proportions).map(key => [key,
        median(this.readings.map(value => value.proportions[key as keyof typeof reading.proportions]))])) as CalibrationProfile['proportions'],
      neutralAngles: Object.fromEntries(Object.keys(reading.angles).map(key => {
        const values = this.readings.map(value => value.angles[key as keyof JointAngles]).filter(v => v !== null);
        return [key, values.length ? median(values) : null];
      })) as JointAngles,
      origin: { x: median(this.readings.map(v => v.body.origin.x)), y: median(this.readings.map(v => v.body.origin.y)) },
      torsoPixels: median(this.readings.map(v => v.body.torsoPixels)) };
    this.stage = 'complete';
    return this.update('ready', 1);
  }
  private progress() {
    return Math.min(1, this.validMs / CALIBRATION_POLICY.holdMs, this.readings.length / CALIBRATION_POLICY.minFrames);
  }
  private update(guide: CalibrationGuide, progress: number): CalibrationUpdate {
    return { stage: this.stage, guide, progress, profile: this.profile };
  }
}

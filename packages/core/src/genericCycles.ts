import type {
  GenericCycleAnalysis, GenericMotionTemplate, GenericRepetition, JointAngles, JointName,
  MotionMap, NormalizedBodyPose, ReferenceDecision, ReferenceEvidence,
} from '@flexivision/contracts';
import { normalizeBodyPose } from './calibration.ts';
import { jointAngleDegrees } from './geometry.ts';
import { JOINT_TRIPLETS } from './motionMap.ts';
import { evaluateReference, REFERENCE_POLICY } from './reference.ts';

/** Experimental 2D periodic-motion gate, not an exercise classifier or safety rule. */
export const GENERIC_CYCLE_POLICY = Object.freeze({
  version: 'generic-cycles-v1' as const,
  candidateIndices: [13, 14, 15, 16, 25, 26, 27, 28] as const,
  minTracked: 4,
  minMoving: 2,
  maxTracked: 6,
  maxMoving: 4,
  minJointRange: 0.22,
  minJointPeak: 0.18,
  minPeakDisplacement: 0.30,
  leaveBaseline: 0.12,
  returnBaseline: 0.13,
  stillFrame: 0.06,
  endpointHoldMs: 200,
  minPhaseMs: 300,
  minDurationMs: 1000,
  maxDurationMs: 12000,
  maxSampleGapMs: 250,
  maxProjectionRange: 0.30,
  templateSamples: 51,
});

type Point = { x: number; y: number };
type Reading = { time: number; pose: NormalizedBodyPose; shoulderWidth: number; hipWidth: number };
interface Prepared {
  readings: (Reading | null)[];
  trackedIndices: number[];
  motionIndices: number[];
  eligibleCoverage: number;
  trackedCoverage: number;
  projectionStable: boolean;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}
function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)]!;
}
function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function projection(pose: NormalizedBodyPose): { shoulderWidth: number; hipWidth: number } | null {
  const p = pose.landmarks;
  const shoulder = p[11] && p[12] ? distance(p[11], p[12]) : null;
  const hip = p[23] && p[24] ? distance(p[23], p[24]) : null;
  return shoulder !== null && hip !== null && Number.isFinite(shoulder) && Number.isFinite(hip)
    ? { shoulderWidth: shoulder, hipWidth: hip } : null;
}
function frameReadings(map: MotionMap): (Reading | null)[] {
  return map.sequence.frames.map(frame => {
    const measured = normalizeBodyPose({ frame, width: map.sequence.width, height: map.sequence.height });
    // Out-of-scale projections are missing data, not far-away physical joints.
    const pose = measured && { ...measured, landmarks: measured.landmarks.map(point => point
      && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 20 && Math.abs(point.y) <= 20
      ? point : null) };
    const view = pose && projection(pose);
    return pose && view && view.shoulderWidth <= 10 && view.hipWidth <= 10
      ? { time: frame.timestampMs, pose, ...view } : null;
  });
}
/** Median-filter observed coordinates only. An occluded point stays null. */
function smooth(readings: (Reading | null)[]): (Reading | null)[] {
  return readings.map((current, index) => {
    if (!current) return null;
    const nearby = readings.slice(Math.max(0, index - 1), index + 2)
      .filter((other): other is Reading => !!other
        && Math.abs(other.time - current.time) <= GENERIC_CYCLE_POLICY.maxSampleGapMs);
    return { ...current, pose: { ...current.pose, landmarks: Array.from({ length: 33 }, (_, landmarkIndex) => {
      if (!current.pose.landmarks[landmarkIndex]) return null;
      const points = nearby.flatMap(other => other.pose.landmarks[landmarkIndex] ?? []);
      return points.length ? { x: median(points.map(point => point.x)), y: median(points.map(point => point.y)) } : null;
    }) } };
  });
}
function prepare(map: MotionMap): Prepared {
  const readings = smooth(frameReadings(map));
  const count = readings.length;
  const eligibleCoverage = count ? readings.filter(Boolean).length / count : 0;
  const ranks = GENERIC_CYCLE_POLICY.candidateIndices.map(index => {
    const points = readings.flatMap(reading => reading?.pose.landmarks[index] ?? []);
    const coverage = count ? points.length / count : 0;
    const range = points.length < 4 ? 0 : Math.hypot(
      percentile(points.map(point => point.x), 0.9) - percentile(points.map(point => point.x), 0.1),
      percentile(points.map(point => point.y), 0.9) - percentile(points.map(point => point.y), 0.1));
    return { index, coverage, range };
  }).filter(entry => entry.coverage >= REFERENCE_POLICY.minUsableRatio)
    .sort((a, b) => b.range - a.range || b.coverage - a.coverage || a.index - b.index);
  const moving = ranks.filter(entry => entry.range >= GENERIC_CYCLE_POLICY.minJointRange)
    .slice(0, GENERIC_CYCLE_POLICY.maxMoving);
  const selected = ranks.slice(0, GENERIC_CYCLE_POLICY.maxTracked);
  const trackedIndices = selected.map(entry => entry.index).sort((a, b) => a - b);
  const motionIndices = moving.map(entry => entry.index).sort((a, b) => a - b);
  const trackedCoverage = count ? readings.filter(reading => reading
    && trackedIndices.every(index => reading.pose.landmarks[index])).length / count : 0;
  const views = readings.filter((reading): reading is Reading => !!reading);
  const variable = (key: 'shoulderWidth' | 'hipWidth') => views.length >= 4
    ? percentile(views.map(reading => reading[key]), 0.9) - percentile(views.map(reading => reading[key]), 0.1)
    : Number.POSITIVE_INFINITY;
  return { readings, trackedIndices, motionIndices, eligibleCoverage, trackedCoverage,
    projectionStable: variable('shoulderWidth') <= GENERIC_CYCLE_POLICY.maxProjectionRange
      && variable('hipWidth') <= GENERIC_CYCLE_POLICY.maxProjectionRange };
}
function displacement(a: Reading, b: Reading, indices: number[]): number {
  const squares = indices.map(index => {
    const x = a.pose.landmarks[index], y = b.pose.landmarks[index];
    return x && y ? distance(x, y) ** 2 : Number.NaN;
  });
  return squares.every(Number.isFinite) ? Math.sqrt(squares.reduce((sum, value) => sum + value, 0) / squares.length) : Number.NaN;
}
function hasTwoMovingPoints(anchor: Reading, peak: Reading, indices: number[]): boolean {
  return indices.filter(index => {
    const a = anchor.pose.landmarks[index], b = peak.pose.landmarks[index];
    return a && b && distance(a, b) >= GENERIC_CYCLE_POLICY.minJointPeak;
  }).length >= GENERIC_CYCLE_POLICY.minMoving;
}

function findCycles(prepared: Prepared): { repetitions: GenericRepetition[]; trackingBreaks: number } {
  const { readings, trackedIndices, motionIndices } = prepared, policy = GENERIC_CYCLE_POLICY;
  let previous: Reading | null = null, holdSince: number | null = null;
  let holdStart: Reading | null = null, anchor: Reading | null = null;
  let active: { start: Reading; peak: Reading; peakDistance: number; returnSince: number | null } | null = null;
  const repetitions: GenericRepetition[] = [];
  let trackingBreaks = 0;
  for (const reading of readings) {
    const point = reading && trackedIndices.every(index => reading.pose.landmarks[index]) ? reading : null;
    if (!point || (previous && point.time - previous.time > policy.maxSampleGapMs)) {
      if (active) trackingBreaks++;
      previous = null; holdSince = null; holdStart = null; anchor = null; active = null;
      if (!point) continue;
    }
    if (!point) continue;
    const still = previous !== null && displacement(previous, point, motionIndices) <= policy.stillFrame;
    if (!anchor) {
      if (still) {
        holdStart ??= previous;
        holdSince = holdStart!.time;
      } else { holdStart = null; holdSince = null; }
      if (holdSince !== null && point.time - holdSince >= policy.endpointHoldMs) anchor = holdStart;
    } else {
      const away = displacement(anchor, point, motionIndices);
      if (!active) {
        if (away > policy.leaveBaseline) active = { start: anchor, peak: point, peakDistance: away, returnSince: null };
      } else {
        if (point.time - active.start.time > policy.maxDurationMs) {
          active = null; anchor = null; holdSince = null; holdStart = null;
        } else {
          if (away > active.peakDistance) {
            active.peak = point; active.peakDistance = away;
          }
          if (away <= policy.returnBaseline && active.peakDistance >= policy.minPeakDisplacement) {
            active.returnSince ??= point.time;
            const start = active.start, peak = active.peak;
            if (point.time - active.returnSince >= policy.endpointHoldMs
              && active.returnSince - start.time >= policy.minDurationMs
              && peak.time - start.time >= policy.minPhaseMs
              && active.returnSince - peak.time >= policy.minPhaseMs
              && hasTwoMovingPoints(start, peak, motionIndices)) {
              repetitions.push({ id: repetitions.length + 1, startMs: start.time,
                turnMs: peak.time, endMs: active.returnSince, movementScore: active.peakDistance });
              anchor = point; active = null; holdSince = point.time; holdStart = point;
            }
          } else active.returnSince = null;
        }
      }
    }
    previous = point;
  }
  return { repetitions, trackingBreaks };
}

export function detectGenericCycles(map: MotionMap): GenericCycleAnalysis {
  const prepared = prepare(map), base = { policyVersion: GENERIC_CYCLE_POLICY.version,
    trackedIndices: prepared.trackedIndices, motionIndices: prepared.motionIndices };
  if (prepared.eligibleCoverage < REFERENCE_POLICY.minUsableRatio) {
    return { ...base, status: 'insufficient_data', repetitions: [], trackingBreaks: 0, reason: 'body_not_visible' };
  }
  if (prepared.trackedIndices.length < GENERIC_CYCLE_POLICY.minTracked
    || prepared.trackedCoverage < REFERENCE_POLICY.minUsableRatio) {
    return { ...base, status: 'insufficient_data', repetitions: [], trackingBreaks: 0, reason: 'insufficient_tracked_landmarks' };
  }
  if (!prepared.projectionStable) {
    return { ...base, status: 'insufficient_data', repetitions: [], trackingBreaks: 0, reason: 'unstable_view' };
  }
  if (prepared.motionIndices.length < GENERIC_CYCLE_POLICY.minMoving) {
    return { ...base, status: 'no_complete_repetition', repetitions: [], trackingBreaks: 0, reason: 'no_repeated_motion' };
  }
  const { repetitions, trackingBreaks } = findCycles(prepared);
  return { ...base, status: repetitions.length ? 'ready' : 'no_complete_repetition', repetitions,
    trackingBreaks, reason: repetitions.length ? null : trackingBreaks ? 'tracking_gap' : 'no_repeated_motion' };
}

export function evaluateGenericReference(map: MotionMap, _analysis?: GenericCycleAnalysis):
  { evidence: ReferenceEvidence; decision: ReferenceDecision } {
  // A caller's analysis object is a display hint, never proof of a repetition.
  const analysis = detectGenericCycles(map);
  const prepared = prepare(map), sampledFrames = map.sequence.frames.length;
  const usableFrames = prepared.readings.filter(reading => reading
    && analysis.trackedIndices.length >= GENERIC_CYCLE_POLICY.minTracked
    && analysis.trackedIndices.every(index => reading.pose.landmarks[index])).length;
  const view: ReferenceEvidence['view'] = prepared.eligibleCoverage < REFERENCE_POLICY.minUsableRatio
    ? 'unknown' : prepared.projectionStable ? 'supported' : 'unsupported';
  const evidence: ReferenceEvidence = { durationMs: map.sequence.durationMs, sampledFrames, usableFrames,
    multiPersonFrames: map.sequence.frames.filter(frame => frame.people.length > 1).length,
    view, motion: analysis.repetitions.length ? 'supported' : 'unknown',
    completeRepetitions: analysis.repetitions.length };
  return { evidence, decision: evaluateReference(evidence) };
}

function interpolateAngles(a: JointAngles, b: JointAngles, fraction: number): JointAngles {
  return Object.fromEntries(Object.keys(a).map(key => {
    const name = key as JointName, first = a[name], last = b[name];
    return [name, fraction === 0 ? first : fraction === 1 ? last
      : first !== null && last !== null && Number.isFinite(first) && Number.isFinite(last)
        ? first + (last - first) * fraction : null];
  })) as JointAngles;
}
function anglesOf(reading: Reading): JointAngles {
  return Object.fromEntries(Object.entries(JOINT_TRIPLETS).map(([name, indices]) => {
    const [a, vertex, b] = indices.map(index => reading.pose.landmarks[index]);
    return [name, a && vertex && b
      ? jointAngleDegrees({ ...a, z: 0 }, { ...vertex, z: 0 }, { ...b, z: 0 }) : null];
  })) as JointAngles;
}

/** A duration-independent pose trajectory; no missing tracked points are invented. */
export function buildGenericTemplate(map: MotionMap, repetitionId: number, decision?: ReferenceDecision): GenericMotionTemplate {
  const analysis = detectGenericCycles(map), repetition = analysis.repetitions.find(value => value.id === repetitionId);
  if (!repetition) throw new Error('A complete measured generic repetition is required');
  if (decision?.status === 'accepted' && (decision.policyVersion !== REFERENCE_POLICY.version
    || evaluateGenericReference(map, analysis).decision.status !== 'accepted')) {
    throw new Error('A rejected motion cannot be marked accepted');
  }
  const prepared = prepare(map), durationMs = repetition.endMs - repetition.startMs;
  const source = prepared.readings.flatMap(reading => reading
    && reading.time >= repetition.startMs && reading.time <= repetition.endMs
    ? [{ ...reading, angles: anglesOf(reading) }] : []);
  if (source.length < 2 || source.some(reading => !analysis.trackedIndices.every(index => reading.pose.landmarks[index]))) {
    throw new Error('Tracked landmarks must remain visible through the repetition');
  }
  const shoulderWidth = median(source.map(reading => reading.shoulderWidth));
  const hipWidth = median(source.map(reading => reading.hipWidth));
  const samples = Array.from({ length: GENERIC_CYCLE_POLICY.templateSamples }, (_, index) => {
    const progress = index / (GENERIC_CYCLE_POLICY.templateSamples - 1);
    const offsetMs = progress * durationMs, time = repetition.startMs + offsetMs;
    const upperIndex = source.findIndex(reading => reading.time >= time);
    const position = upperIndex < 0 ? source.length - 1 : upperIndex;
    const lower = source[Math.max(0, position - 1)]!, upper = source[position]!;
    const fraction = lower.time === upper.time ? 0 : (time - lower.time) / (upper.time - lower.time);
    const landmarks = Array.from({ length: 33 }, (_, landmarkIndex) => {
      const a = lower.pose.landmarks[landmarkIndex], b = upper.pose.landmarks[landmarkIndex];
      if (fraction === 0) return a ? { ...a } : null;
      if (fraction === 1) return b ? { ...b } : null;
      return a && b ? { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction } : null;
    });
    return { progress, offsetMs, phase: time < repetition.turnMs ? 'outbound' as const : 'return' as const,
      landmarks, angles2d: interpolateAngles(lower.angles, upper.angles, fraction) };
  });
  return { schemaVersion: 1, kind: 'generic-cycle-template',
    qualification: decision?.status === 'accepted' ? 'accepted' : 'not_evaluated',
    ...(decision ? { decision } : {}), policyVersion: GENERIC_CYCLE_POLICY.version,
    source: { engine: { ...map.sequence.engine }, durationMs: map.sequence.durationMs,
      width: map.sequence.width, height: map.sequence.height },
    trackedIndices: [...analysis.trackedIndices], motionIndices: [...analysis.motionIndices],
    projection: { shoulderWidth, hipWidth }, repetition: { ...repetition }, durationMs, samples };
}

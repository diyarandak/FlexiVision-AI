import { angleCorrection, positionCorrection, correctionInstruction, correctionKey, type GenericCorrection } from './genericCorrections.ts';
import type { CalibrationProfile, CameraPoseObservation, FormObservation, GenericMotionTemplate,
  JointAngles, JointName, NormalizedBodyPose, PersonPose } from '@flexivision/contracts';
import { normalizeBodyPose } from './calibration.ts';
import { isBodyProfile } from './bodyProfile.ts';
import { isVisible, imageAngles, JOINT_TRIPLETS } from './motionMap.ts';
import { normalizePersonalBody } from './personalBody.ts';

type Point = { x: number; y: number };
export type GenericLivePhase = 'waiting' | 'outbound' | 'return';
export interface GenericLiveOverlayJoint {
  index: number;
  /** Both points are in the original camera frame's 0–1 image coordinates, before UI mirroring. */
  observed: Point;
  reference: Point;
  /** Difference in the same relative units used by the live path comparer. */
  deviation: number;
  /** Measured path difference, not an anatomical safety judgment. */
  deviating: boolean;
}
export interface GenericLiveOverlay { joints: GenericLiveOverlayJoint[] }
export interface GenericLiveResult {
  timestampMs: number;
  observation: FormObservation;
  phase: GenericLivePhase;
  progress: number;
  repetitionCount: number;
  matchedTemplateIndex: number | null;
  /** Mean point displacement in the reference person's leg units, or torso units when unavailable. */
  deviation: number | null;
  /** Projected reference path at the matched phase; absent when tracking or phase is uncertain. */
  overlay: GenericLiveOverlay | null;
  /** Form match percentage (0–100) based on joint angles and position accuracy. */
  accuracyPct?: number | null;
  correction?: GenericCorrection;
  /** Average accuracy across the completed repetition cycle. */
  cycleAccuracyPct?: number | null;
}

export function computeAngleAccuracy(
  live: JointAngles,
  reference: JointAngles,
  trackedIndices: readonly number[]
): { avgDiff: number; score: number } | null {
  const diffs: number[] = [];
  const trackedSet = new Set(trackedIndices);

  const check = (name: JointName, vertex: number) => {
    if (trackedSet.size > 0 && !trackedSet.has(vertex) && !JOINT_TRIPLETS[name].some(idx => trackedSet.has(idx))) return;
    const l = live[name], r = reference[name];
    if (l !== null && r !== null && Number.isFinite(l) && Number.isFinite(r)) {
      diffs.push(Math.abs(l - r));
    }
  };

  check('leftKnee', 25);
  check('rightKnee', 26);
  check('leftHip', 23);
  check('rightHip', 24);
  check('leftElbow', 13);
  check('rightElbow', 14);

  if (!diffs.length) return null;
  const avgDiff = diffs.reduce((sum, d) => sum + d, 0) / diffs.length;
  // 0 deg error -> 100%, 40 deg error -> 0%
  const score = Math.max(0, Math.min(100, Math.round(100 * (1 - avgDiff / 40))));
  return { avgDiff, score };
}

export const LIVE_GENERIC_POLICY = Object.freeze({
  maxGapMs: 500, minStartHoldMs: 200, minReturnHoldMs: 200,
  minCycleMs: 1000, maxCycleMs: 30000, minOutboundMs: 300,
  maxStepFraction: 0.65,
  startDistance: 0.58, returnDistance: 0.20,
  moderateDeviation: 0.28, uncertainDeviation: 0.70,
});

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const FULL_BODY_LANDMARKS = [11,12,13,14,15,16,23,24,25,26,27,28] as const;
/** The head and both arms and legs must remain visible before live form comparison. */
export function isWholeBodyVisible(person: PersonPose | undefined): boolean {
  return !!person && [0,7,8].some(index => isVisible(person.landmarks[index]))
    && FULL_BODY_LANDMARKS.every(index => isVisible(person.landmarks[index]));
}
function legLength(landmarks: ({ x: number; y: number } | null)[]): number | null {
  const sides = [[23, 25, 27], [24, 26, 28]];
  const lengths = sides.flatMap(([hip, knee, ankle]) => {
    const a = landmarks[hip!], b = landmarks[knee!], c = landmarks[ankle!];
    return a && b && c ? [distance(a, b) + distance(b, c)] : [];
  });
  return lengths.length ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length : null;
}
function meanDistance(a: readonly (Point | null)[], b: readonly (Point | null)[], indices: readonly number[]): number {
  const values = indices.map(index => a[index] && b[index] ? distance(a[index]!, b[index]!) : Number.NaN);
  return values.every(Number.isFinite) && values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.POSITIVE_INFINITY;
}
function projection(pose: NormalizedBodyPose): { shoulderWidth: number; hipWidth: number } | null {
  const p = pose.landmarks;
  return p[11] && p[12] && p[23] && p[24]
    ? { shoulderWidth: distance(p[11], p[12]), hipWidth: distance(p[23], p[24]) } : null;
}

/** Aligns a measured repeating pose path to the user's own starting shape.
 * A weak camera/view match or missing landmark remains unknown, never a form error. */
export class LiveGenericComparer {
  private previousMs = -1;
  private phase: GenericLivePhase = 'waiting';
  private repetitions = 0;
  private holdSince: number | null = null;
  private returnSince: number | null = null;
  private cycleStartedAt: number | null = null;
  private mirrored = false;
  private candidateMirror: boolean | null = null;
  private candidateStartPose: (Point | null)[] | null = null;
  private baseline: (Point | null)[] | null = null;
  private startPose: (Point | null)[] | null = null;
  private peakDisplacement = 0;
  private previousAligned: (Point | null)[] | null = null;
  private matchedIndex = 0;
  private readonly turnIndex: number;
  private readonly referenceScale: number;
  private readonly peakIndex: number;
  private readonly measuredRange: number;
  private readonly usesLegUnits: boolean;
  private readonly referenceSamples: (Point | null)[][];
  private readonly movementScore: number;

  private cycleAccuracySum = 0;
  private cycleAccuracyCount = 0;
  private lastCycleAccuracy: number | null = null;

  constructor(private readonly template: GenericMotionTemplate, private readonly bodyProfile?: CalibrationProfile) {
    if (bodyProfile && !isBodyProfile(bodyProfile)) throw new Error('Kayıtlı vücut profili geçersiz.');
    if (template.kind !== 'generic-cycle-template' || template.qualification !== 'accepted'
      || template.decision?.status !== 'accepted' || template.samples.length !== 51
      || template.trackedIndices.length < 4 || template.motionIndices.length < 2
      || template.trackedIndices.some(index => !template.samples.every(sample => sample.landmarks[index]))) {
      throw new Error('Canlı izleme için kabul edilmiş, görünür bir hareket şablonu gerekir.');
    }
    this.turnIndex = template.samples.findIndex(sample => sample.phase === 'return');
    if (this.turnIndex < 2 || this.turnIndex > 48) throw new Error('Hareket dönüş noktası eksik.');
    const referenceLegLength = legLength(template.samples[0]!.landmarks);
    this.usesLegUnits = !!(bodyProfile && referenceLegLength && referenceLegLength > 0.2);
    this.referenceScale = this.usesLegUnits ? referenceLegLength! : 1;
    this.referenceSamples = template.samples.map(sample => sample.landmarks.map(point => point
      ? { x: point.x / this.referenceScale, y: point.y / this.referenceScale } : null));
    this.movementScore = template.repetition.movementScore / this.referenceScale;
    // Time-uniform samples may leave very few points in a fast reference phase.
    // Locate the measured endpoint geometrically rather than using an index margin.
    this.peakIndex = this.referenceSamples.reduce((best, points, index) =>
      meanDistance(points, this.referenceSamples[0]!, template.motionIndices)
      > meanDistance(this.referenceSamples[best]!, this.referenceSamples[0]!, template.motionIndices) ? index : best, 0);
    this.measuredRange = meanDistance(this.referenceSamples[this.peakIndex]!, this.referenceSamples[0]!, template.motionIndices);
  }

  getRepetitionCount() { return this.repetitions; }
  getLastCycleAccuracy() { return this.lastCycleAccuracy; }
  isBodyProfileApplied() { return this.usesLegUnits; }
  reset() { this.repetitions = 0; this.previousMs = -1; this.lastCycleAccuracy = null; this.interrupt(); }
  private interrupt() {
    this.phase = 'waiting'; this.holdSince = null; this.returnSince = null; this.cycleStartedAt = null;
    this.candidateMirror = null; this.candidateStartPose = null; this.baseline = null; this.startPose = null;
    this.peakDisplacement = 0; this.matchedIndex = 0; this.previousAligned = null;
    this.cycleAccuracySum = 0; this.cycleAccuracyCount = 0;
  }
  unknown(timestampMs: number, reason: string): GenericLiveResult {
    this.checkTime(timestampMs); this.interrupt();
    return { timestampMs, observation: { status: 'unknown', reason }, phase: 'waiting', progress: 0,
      repetitionCount: this.repetitions, matchedTemplateIndex: null, deviation: null, overlay: null,
      accuracyPct: null, cycleAccuracyPct: null };
  }
  private checkTime(timestampMs: number) {
    if (!Number.isFinite(timestampMs) || timestampMs < 0 || timestampMs <= this.previousMs)
      throw new Error('Live timestamps must increase');
    if (this.previousMs >= 0 && timestampMs - this.previousMs > LIVE_GENERIC_POLICY.maxGapMs) this.interrupt();
    this.previousMs = timestampMs;
  }
  private result(timestampMs: number, observation: FormObservation, index: number | null,
    deviation: number | null, overlay: GenericLiveOverlay | null = null,
    accuracyPct: number | null = null, cycleAccuracyPct: number | null = null): GenericLiveResult {
    return { timestampMs, observation, phase: this.phase, progress: index === null ? 0 : index / 50,
      repetitionCount: this.repetitions, matchedTemplateIndex: index, deviation, overlay,
      accuracyPct,
      cycleAccuracyPct: cycleAccuracyPct ?? this.lastCycleAccuracy };
  }
  private mirroredPose(points: readonly (Point | null)[], flip: boolean): (Point | null)[] {
    return points.map(point => point ? { x: flip ? -point.x : point.x, y: point.y } : null);
  }
  private matchingIndex(points: (Point | null)[], from: number, through: number): { index: number; deviation: number } {
    let best = { index: from, deviation: Number.POSITIVE_INFINITY };
    for (let index = from; index <= through; index++) {
      const deviation = meanDistance(points, this.referenceSamples[index]!, this.template.trackedIndices);
      if (deviation < best.deviation) best = { index, deviation };
    }
    return best;
  }

  /** Undo the comparison's body scaling and mirror to draw its expected relative path on the same camera frame.
   * The measured start pose supplies each joint's offset; this does not transfer anatomy or certify form. */
  private projectedOverlay(observation: CameraPoseObservation, origin: Point, unitPixels: number,
    oriented: readonly (Point | null)[], index: number, status: FormObservation['status'], extraIndices: readonly number[] = []): GenericLiveOverlay | null {
    const person = observation.frame.people[0];
    if (!person || !this.baseline || status === 'unknown') return null;
    const joints = [...new Set([...this.template.trackedIndices,...extraIndices])].flatMap(jointIndex => {
      const measured = oriented[jointIndex], offset = this.baseline?.[jointIndex];
      const target = this.referenceSamples[index]?.[jointIndex];
      const cameraPoint = person.landmarks[jointIndex];
      if (!measured || !offset || !target || !isVisible(cameraPoint)) return [];
      const expected = { x: target.x + offset.x, y: target.y + offset.y };
      const reference = { x: origin.x + (this.mirrored ? -expected.x : expected.x) * unitPixels / observation.width,
        y: origin.y + expected.y * unitPixels / observation.height };
      if (![reference.x, reference.y].every(Number.isFinite)
        || reference.x < 0 || reference.x > 1 || reference.y < 0 || reference.y > 1) return [];
      const deviation = distance(measured, expected);
      return [{ index: jointIndex, observed: { x: cameraPoint.x, y: cameraPoint.y }, reference,
        deviation, deviating: status === 'incorrect' && deviation >= LIVE_GENERIC_POLICY.moderateDeviation }];
    });
    return joints.length ? { joints } : null;
  }

  compare(observation: CameraPoseObservation): GenericLiveResult {
    const time = observation.frame.timestampMs;
    this.checkTime(time);
    const processingMs = observation.processingMs ?? 0;
    if (!Number.isFinite(processingMs) || processingMs < 0 || processingMs > 500)
      return this.unknownAfterChecked(time, 'processing_slow');
    if (observation.frame.people.length !== 1) return this.unknownAfterChecked(time,
      observation.frame.people.length ? 'multiple_people' : 'no_person');
    const raw = normalizeBodyPose(observation), liveView = raw && projection(raw);
    if (!raw || !liveView) return this.unknownAfterChecked(time, 'body_not_visible');
    if (!isWholeBodyVisible(observation.frame.people[0])) return this.unknownAfterChecked(time, 'tracking_lost');
    // Camera projection is only a conservative consistency check, not a yaw measurement.
    if (Math.abs(liveView.shoulderWidth - this.template.projection.shoulderWidth) > 0.55
      && Math.abs(liveView.hipWidth - this.template.projection.hipWidth) > 0.40)
      return this.unknownAfterChecked(time, 'camera_view');
    const personal = this.usesLegUnits && this.bodyProfile ? normalizePersonalBody(observation, this.bodyProfile) : null;
    if (this.usesLegUnits && !personal) return this.unknownAfterChecked(time, 'body_not_visible');
    const points = personal?.landmarks ?? raw.landmarks;
    if (!this.template.trackedIndices.every(index => points[index])) return this.unknownAfterChecked(time, 'tracking_lost');

    if (this.phase === 'waiting') {
      const normal = this.mirroredPose(points, false), flipped = this.mirroredPose(points, true);
      const regularDistance = meanDistance(normal, this.referenceSamples[0]!, this.template.trackedIndices);
      const flippedDistance = meanDistance(flipped, this.referenceSamples[0]!, this.template.trackedIndices);
      const mirror = flippedDistance < regularDistance;
      const startDistance = Math.min(regularDistance, flippedDistance);
      if (startDistance > LIVE_GENERIC_POLICY.startDistance) {
        this.holdSince = null; this.candidateMirror = null; this.candidateStartPose = null;
        return this.result(time, { status: 'unknown', reason: 'find_start' }, null, null);
      }
      const candidate = mirror ? flipped : normal;
      if (this.candidateMirror !== mirror || !this.candidateStartPose
        || meanDistance(candidate, this.candidateStartPose, this.template.motionIndices) > 0.03) {
        this.candidateMirror = mirror; this.holdSince = time; this.candidateStartPose = candidate;
      }
      this.holdSince ??= time;
      if (time - this.holdSince < LIVE_GENERIC_POLICY.minStartHoldMs)
        return this.result(time, { status: 'unknown', reason: 'hold_start' }, null, null);
      this.mirrored = mirror;
      this.startPose = this.mirroredPose(points, mirror);
      this.baseline = this.startPose.map((point, index) => point && this.referenceSamples[0]![index]
        ? { x: point.x - this.referenceSamples[0]![index]!.x, y: point.y - this.referenceSamples[0]![index]!.y } : null);
      this.phase = 'outbound'; this.cycleStartedAt = null; this.matchedIndex = 0;
      this.previousAligned = this.referenceSamples[0]!;
      return this.result(time, { status: 'correct' }, 0, 0,
        this.projectedOverlay(observation, raw.origin, personal?.legUnitPixels ?? raw.torsoPixels,
          this.startPose, 0, 'correct'));
    }

    if (this.cycleStartedAt !== null && time - this.cycleStartedAt > LIVE_GENERIC_POLICY.maxCycleMs)
      return this.unknownAfterChecked(time, 'cycle_timeout');
    const oriented = this.mirroredPose(points, this.mirrored);
    const aligned = oriented.map((point, index) => point && this.baseline?.[index]
      ? { x: point.x - this.baseline[index]!.x, y: point.y - this.baseline[index]!.y } : null);
    const displacement = meanDistance(oriented, this.startPose!, this.template.motionIndices);
    const step = this.previousAligned ? meanDistance(aligned, this.previousAligned, this.template.motionIndices) : 0;
    if (step > this.measuredRange * LIVE_GENERIC_POLICY.maxStepFraction)
      return this.unknownAfterChecked(time, 'motion_too_fast');
    this.previousAligned = aligned;
    if (this.cycleStartedAt === null && displacement > Math.max(0.06, this.measuredRange * 0.12)) this.cycleStartedAt = time;
    this.peakDisplacement = Math.max(this.peakDisplacement, displacement);
    const from = Math.max(this.phase === 'outbound' ? 0 : this.peakIndex, this.matchedIndex - 2);
    const through = this.phase === 'outbound' ? this.peakIndex : 50;
    const match = this.matchingIndex(aligned, from, through);
    if (!Number.isFinite(match.deviation) || match.deviation > LIVE_GENERIC_POLICY.uncertainDeviation)
      return this.unknownAfterChecked(time, 'pose_uncertain');
    this.matchedIndex = Math.max(this.matchedIndex, match.index);
    const person = observation.frame.people[0];
    const liveAngles = person ? imageAngles(person, observation.width, observation.height) : null;
    const refAngles = this.template.samples[match.index]?.angles2d;
    const angleInfo = liveAngles && refAngles ? computeAngleAccuracy(liveAngles, refAngles, this.template.trackedIndices) : null;
    const posScore = Math.max(0, Math.min(100, Math.round(100 * (1 - match.deviation / 0.35))));
    const accuracyPct = angleInfo !== null
      ? Math.round(posScore * 0.4 + angleInfo.score * 0.6)
      : posScore;
    if (this.cycleStartedAt !== null) {
      this.cycleAccuracySum += accuracyPct;
      this.cycleAccuracyCount++;
    }
    const peakDist = meanDistance(aligned, this.referenceSamples[this.peakIndex]!, this.template.motionIndices);
    const reachedPeak = (peakDist <= this.measuredRange * 0.35 || (this.matchedIndex >= this.peakIndex && accuracyPct >= 50))
      && displacement >= Math.max(0.08, this.measuredRange * 0.30);
    const reversing = this.peakDisplacement >= Math.max(0.08, this.measuredRange * 0.30)
      && displacement <= this.peakDisplacement - Math.max(0.025, this.measuredRange * 0.05);
    if (this.phase === 'outbound' && this.cycleStartedAt !== null
      && time - this.cycleStartedAt >= LIVE_GENERIC_POLICY.minOutboundMs
      && (reachedPeak || reversing)) {
      this.phase = 'return'; this.matchedIndex = Math.max(this.matchedIndex, this.peakIndex);
    }
    const returnThreshold = Math.min(LIVE_GENERIC_POLICY.returnDistance, Math.max(0.12, this.measuredRange * 0.25));
    const returnedToStart = displacement <= returnThreshold
      || (this.matchedIndex >= 46 && displacement <= LIVE_GENERIC_POLICY.returnDistance);
    if (this.phase === 'return' && this.cycleStartedAt !== null
      && this.peakDisplacement >= Math.max(0.08, this.movementScore * 0.30)
      && returnedToStart) {
      this.returnSince ??= time;
      if (time - this.returnSince >= LIVE_GENERIC_POLICY.minReturnHoldMs) {
        if (this.returnSince - this.cycleStartedAt < LIVE_GENERIC_POLICY.minCycleMs)
          return this.unknownAfterChecked(time, 'cycle_too_short');
        const cycleAccuracy = this.cycleAccuracyCount > 0
          ? Math.round(this.cycleAccuracySum / this.cycleAccuracyCount) : accuracyPct;
        if (cycleAccuracy < 50) {
          this.interrupt();
          return this.result(time, {
            status: 'incorrect',
            errors: [{
              code: 'motion_path',
              message: `Referansa benzerlik %${cycleAccuracy}. Hareket referanstan çok farklı; tekrar sayılmadı. Hareketi videodaki gibi yap.`,
              severity: 0.5,
            }],
          }, 0, match.deviation, null, accuracyPct, cycleAccuracy);
        }
        this.repetitions++;
        this.lastCycleAccuracy = cycleAccuracy;
        this.interrupt();
        return this.result(time, { status: 'correct' }, 50, match.deviation, null, accuracyPct, cycleAccuracy);
      }
    } else this.returnSince = null;
    const angular = liveAngles && refAngles ? angleCorrection(liveAngles, refAngles, this.template.trackedIndices) : null;
    const differs = !!angular || match.deviation >= LIVE_GENERIC_POLICY.moderateDeviation || accuracyPct < 55;
    const overlay = this.projectedOverlay(observation, raw.origin, personal?.legUnitPixels ?? raw.torsoPixels,
      oriented, this.matchedIndex, differs ? 'incorrect' : 'correct', angular ? [angular.jointIndex] : []);
    const deviatingJoints = overlay?.joints.filter(joint => joint.deviating) ?? [];
    const mainJoint = deviatingJoints
      .reduce<GenericLiveOverlayJoint | null>((best, joint) => !best || joint.deviation > best.deviation ? joint : best, null);
    const correction = angular ?? (mainJoint ? positionCorrection(mainJoint) : null);
    if (angular && overlay) {
      const marked = overlay.joints.find(joint => joint.index === angular.jointIndex);
      if (marked) marked.deviating = true;
    }
    const specificCorrection = correction ? correctionInstruction(correction) : '';
    const form = differs
      ? { status: 'incorrect' as const, errors: [{ code: correction ? correctionKey(correction) : 'motion_path',
        message: specificCorrection
          ? `Bu bölüm farklı. ${specificCorrection}`
          : 'Bu bölüm referanstan farklı. Başlangıca dönüp yeniden dene.',
        severity: Math.max(match.deviation, angular ? .5 : .01) }] }
      : { status: 'correct' as const };
    return { ...this.result(time, form, this.matchedIndex, match.deviation, overlay, accuracyPct),
      ...(differs && correction ? {correction} : {}) };
  }
  private unknownAfterChecked(timestampMs: number, reason: string): GenericLiveResult {
    this.interrupt();
    return this.result(timestampMs, { status: 'unknown', reason }, null, null);
  }
}

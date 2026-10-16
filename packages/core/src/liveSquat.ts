import type {
  CameraPoseObservation,
  CalibrationProfile,
  FormError,
  FormObservation,
  JointAngles,
  JointName,
  LiveComparisonResult,
  LiveMovementPhase,
  LivePhaseMatch,
  SquatTemplate,
} from '@flexivision/contracts';
import { imageAngles } from './motionMap.ts';
import { sideViewEvidence } from './cameraView.ts';
import { isBodyProfile } from './bodyProfile.ts';
import { normalizePersonalBody, personalBodyAngles } from './personalBody.ts';

export const LIVE_SQUAT_POLICY = Object.freeze({
  standingThreshold: 152,
  bentThreshold: 115,
  maxKneeDeviation: 25,
  maxHipDeviation: 25,
  maxObservationGapMs: 500,
  topHoldMs: 200,
  minCycleMs: 1000,
  maxCycleMs: 30000,
  minBentHoldMs: 200,
});

interface SamplePoint {
  index: number;
  progress: number;
  phase: string;
  knee: number;
  hip: number;
}

export class LiveSquatComparer {
  private phase: LiveMovementPhase = 'standing';
  private repCount = 0;
  private previousKnee: number | null = null;
  private previousHip: number | null = null;
  private maxKnee = 0;
  private minKneeInCurrentRep = 180;
  private previousTimestamp = -1;
  private topSince: number | null = null;
  private armed = false;
  private repStartedAt: number | null = null;
  private returnTopSince: number | null = null;
  private bottomSince: number | null = null;
  private minHip = 180;
  private maxHip = 0;
  private bentSince: number | null = null;
  private bentObserved = false;
  private ascentPeak = 0;
  private readonly side: 'left' | 'right';
  private readonly kneeJoint: JointName;
  private readonly hipJoint: JointName;
  private readonly descentSamples: SamplePoint[];
  private readonly bottomSamples: SamplePoint[];
  private readonly ascentSamples: SamplePoint[];
  private readonly standingSample: SamplePoint;

  constructor(private readonly template: SquatTemplate, private readonly bodyProfile?: CalibrationProfile) {
    if (bodyProfile && !isBodyProfile(bodyProfile)) throw new Error('Kayıtlı vücut profili geçersiz.');
    if (template.qualification !== 'accepted' || template.decision?.status !== 'accepted'
      || template.samples.length < 3 || !['descent', 'bottom', 'ascent'].every(phase => template.samples.some(s => s.phase === phase))) {
      throw new Error('Canlı izleme için kabul edilmiş, tam bir squat şablonu gerekir.');
    }
    this.side = template.repetition.side;
    this.kneeJoint = `${this.side}Knee`;
    this.hipJoint = `${this.side}Hip`;

    const mapped: SamplePoint[] = template.samples.map((s, index) => ({
      index,
      progress: s.progress,
      phase: s.phase,
      knee: s.angles2d[this.kneeJoint]!,
      hip: s.angles2d[this.hipJoint]!,
    }));
    if (mapped.some(s => ![s.knee, s.hip].every(a => a !== null && Number.isFinite(a) && a >= 0 && a <= 180))) {
      throw new Error('Şablonda izlenecek diz veya kalça ölçümü eksik.');
    }

    this.standingSample = mapped[0] ?? { index: 0, progress: 0, phase: 'standing', knee: 170, hip: 170 };
    this.descentSamples = mapped.filter(s => s.phase === 'descent');
    this.bottomSamples = mapped.filter(s => s.phase === 'bottom');
    this.ascentSamples = mapped.filter(s => s.phase === 'ascent');
  }

  reset(): void {
    this.repCount = 0;
    this.previousTimestamp = -1;
    this.interrupt();
  }

  private interrupt() {
    this.phase = 'standing'; this.previousKnee = null; this.previousHip = null; this.maxKnee = 0; this.minKneeInCurrentRep = 180;
    this.topSince = null; this.armed = false; this.repStartedAt = null;
    this.returnTopSince = null; this.bottomSince = null; this.minHip = 180; this.maxHip = 0;
    this.bentSince = null; this.bentObserved = false; this.ascentPeak = 0;
  }
  private checkTime(timestampMs: number) {
    if (!Number.isFinite(timestampMs) || timestampMs < 0 || timestampMs <= this.previousTimestamp) throw new Error('Live timestamps must increase');
    if (this.previousTimestamp >= 0 && timestampMs - this.previousTimestamp > LIVE_SQUAT_POLICY.maxObservationGapMs) this.interrupt();
    this.previousTimestamp = timestampMs;
  }
  private unknown(timestampMs: number, reason: string): LiveComparisonResult {
    this.interrupt();
    return { timestampMs, observation: { status: 'unknown', reason }, match: null, repetitionCount: this.repCount };
  }

  getRepetitionCount(): number {
    return this.repCount;
  }

  getCurrentPhase(): LiveMovementPhase {
    return this.phase;
  }

  compare(observation: CameraPoseObservation): LiveComparisonResult {
    const timestampMs = observation.frame.timestampMs;
    const processingMs = observation.processingMs ?? 0;
    if (!Number.isFinite(processingMs) || processingMs < 0 || processingMs > 500) {
      this.checkTime(timestampMs); return this.unknown(timestampMs, 'processing_slow');
    }
    if (observation.frame.people.length === 0) {
      this.checkTime(timestampMs); return this.unknown(timestampMs, 'no_person');
    }
    if (observation.frame.people.length > 1) {
      this.checkTime(timestampMs); return this.unknown(timestampMs, 'multiple_people');
    }

    if (sideViewEvidence(observation.frame.people[0]!, observation.width, observation.height) !== 'supported') {
      this.checkTime(timestampMs); return this.unknown(timestampMs, 'camera_view');
    }

    const bodyPose = this.bodyProfile ? normalizePersonalBody(observation, this.bodyProfile) : null;
    if (this.bodyProfile && !bodyPose) {
      this.checkTime(timestampMs); return this.unknown(timestampMs, 'body_not_visible');
    }
    const angles = bodyPose ? personalBodyAngles(bodyPose) : imageAngles(observation.frame.people[0]!, observation.width, observation.height);
    return { ...this.compareAngles(timestampMs, angles), bodyPose };
  }

  compareAngles(timestampMs: number, angles: JointAngles | null): LiveComparisonResult {
    this.checkTime(timestampMs);
    const knee = angles ? angles[this.kneeJoint] : null;
    const hip = angles ? angles[this.hipJoint] : null;

    if (knee === null || hip === null || !Number.isFinite(knee) || !Number.isFinite(hip)
      || knee < 0 || knee > 180 || hip < 0 || hip > 180) {
      return this.unknown(timestampMs, 'tracking_lost');
    }

    const policy = LIVE_SQUAT_POLICY;
    const isStanding = knee >= policy.standingThreshold;
    const isDecreasing = this.previousKnee !== null && knee < this.previousKnee - 0.5;
    if (this.repStartedAt !== null && timestampMs - this.repStartedAt > policy.maxCycleMs) return this.unknown(timestampMs, 'cycle_timeout');

    if (this.phase !== 'standing' && knee < this.minKneeInCurrentRep) {
      this.minKneeInCurrentRep = knee;
      this.bottomSince = timestampMs;
    }
    if (this.phase !== 'standing') { this.minHip = Math.min(this.minHip, hip); this.maxHip = Math.max(this.maxHip, hip); }
    if (this.repStartedAt !== null && knee <= policy.bentThreshold) {
      this.bentSince ??= timestampMs;
      this.bentObserved ||= timestampMs - this.bentSince >= policy.minBentHoldMs;
    } else this.bentSince = null;

    switch (this.phase) {
      case 'standing':
        if (isStanding) {
          this.maxKnee = Math.max(this.maxKnee, knee);
          this.topSince ??= timestampMs; this.armed ||= timestampMs - this.topSince >= policy.topHoldMs;
        }
        else if (!this.armed) return this.unknown(timestampMs, 'stand_first');
        if (this.armed && !isStanding && this.maxKnee - knee >= 4) {
          this.phase = 'descent';
          this.minKneeInCurrentRep = knee;
          this.repStartedAt = timestampMs; this.bottomSince = timestampMs; this.returnTopSince = null;
          this.minHip = hip; this.maxHip = Math.max(hip, this.previousHip ?? hip);
          this.bentSince = knee <= policy.bentThreshold ? timestampMs : null;
          this.bentObserved = false;
        }
        break;

      case 'descent':
        // Use cumulative movement from the measured low point. A slow ascent can
        // change less than half a degree per frame at a high camera frame rate.
        if (this.bentObserved && knee >= this.minKneeInCurrentRep + 4) {
          this.phase = 'ascent'; this.ascentPeak = knee;
        } else if (knee <= policy.bentThreshold + 8 && this.bottomSince !== null
          && timestampMs - this.bottomSince >= 200) {
          this.phase = 'bottom';
        } else if (isStanding && !isDecreasing) {
          this.phase = 'standing';
          this.minKneeInCurrentRep = 180;
          this.repStartedAt = null;
        }
        break;

      case 'bottom':
        if (this.bentObserved && knee >= this.minKneeInCurrentRep + 4) {
          this.phase = 'ascent'; this.ascentPeak = knee;
        } else if (isStanding) {
          this.interrupt(); this.topSince = timestampMs;
        }
        break;

      case 'ascent':
        this.ascentPeak = Math.max(this.ascentPeak, knee);
        if (isStanding) {
          this.returnTopSince ??= timestampMs;
          if (timestampMs - this.returnTopSince >= policy.topHoldMs) {
            if (this.repStartedAt !== null && timestampMs - this.repStartedAt >= policy.minCycleMs
              && this.maxKnee - this.minKneeInCurrentRep >= 45 && this.maxHip - this.minHip >= 30) this.repCount++;
            this.interrupt(); this.topSince = timestampMs; this.armed = true;
          }
        } else if (knee < this.ascentPeak - 6) {
          this.returnTopSince = null;
          this.phase = 'descent';
        } else this.returnTopSince = null;
        break;
    }

    this.previousKnee = knee;
    this.previousHip = hip;

    const match = this.matchSample(this.phase, knee, hip, angles!);
    const observation = this.evaluateObservation(match);

    return {
      timestampMs,
      observation,
      match,
      repetitionCount: this.repCount,
    };
  }

  private matchSample(
    phase: LiveMovementPhase,
    liveKnee: number,
    liveHip: number,
    liveAngles: JointAngles
  ): LivePhaseMatch {
    let best = this.standingSample;

    if (phase === 'standing') {
      best = this.standingSample;
    } else if (phase === 'descent') {
      best = this.findClosestSample(this.descentSamples, liveKnee);
    } else if (phase === 'bottom') {
      best = this.findClosestSample(this.bottomSamples, liveKnee);
    } else if (phase === 'ascent') {
      best = this.findClosestSample(this.ascentSamples, liveKnee);
    }

    const targetAngles = this.template.samples[best.index]!.angles2d;
    const targetKnee = best.knee;
    const targetHip = best.hip;

    const kneeDeviation = Math.abs(liveKnee - targetKnee);
    const hipDeviation = Math.abs(liveHip - targetHip);

    return {
      phase,
      progress: best.progress,
      templateIndex: best.index,
      targetAngles,
      liveAngles,
      deviations: {
        knee: Math.round(kneeDeviation * 10) / 10,
        hip: Math.round(hipDeviation * 10) / 10,
      },
    };
  }

  private findClosestSample(pool: SamplePoint[], targetKnee: number): SamplePoint {
    if (!pool.length) return this.standingSample;
    let closest = pool[0]!;
    let minDiff = Math.abs(closest.knee - targetKnee);
    for (let i = 1; i < pool.length; i++) {
      const diff = Math.abs(pool[i]!.knee - targetKnee);
      if (diff < minDiff) {
        minDiff = diff;
        closest = pool[i]!;
      }
    }
    return closest;
  }

  private evaluateObservation(match: LivePhaseMatch): FormObservation {
    const errors: FormError[] = [];
    const { knee, hip } = match.deviations;

    if (match.phase !== 'standing') {
      const liveKnee = match.liveAngles[this.kneeJoint];
      const targetKnee = match.targetAngles[this.kneeJoint];
      const liveHip = match.liveAngles[this.hipJoint];
      const targetHip = match.targetAngles[this.hipJoint];

      if (
        match.phase === 'bottom' &&
        liveKnee !== null &&
        targetKnee !== null &&
        liveKnee > targetKnee + 16
      ) {
        errors.push({
          code: 'insufficient_depth',
          message: 'Daha derine in, kalçanı diz hizasına yaklaştır.',
          severity: 2,
        });
      }

      if (
        hip !== null &&
        hip >= LIVE_SQUAT_POLICY.maxHipDeviation &&
        liveHip !== null &&
        targetHip !== null &&
        liveHip < targetHip - 15
      ) {
        errors.push({
          code: 'chest_forward',
          message: 'Gövdeni dik tut, sırtını fazla öne eğme.',
          severity: 2,
        });
      }

      if (knee !== null && knee >= LIVE_SQUAT_POLICY.maxKneeDeviation) {
        errors.push({
          code: 'knee_deviation',
          message: 'Diz açını şablona göre ayarla.',
          severity: 1,
        });
      }
    }

    if (errors.length > 0) {
      return { status: 'incorrect', errors };
    }
    return { status: 'correct' };
  }
}

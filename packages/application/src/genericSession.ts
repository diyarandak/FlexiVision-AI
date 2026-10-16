import { GENERIC_UNKNOWN_REASONS, type CalibrationProfile, type CameraPoseObservation, type FeedbackCue,
  type GenericCorrectionFinding, type GenericMotionTemplate, type GenericSessionDiagnostics, type GenericSessionSummary, type GenericUnknownReason } from '@flexivision/contracts';
import { correctionKey, FeedbackPolicy, FULL_BODY_LANDMARKS, isVisible, LiveGenericComparer, type GenericLiveResult } from '@flexivision/core';
import type { LivePoseSource, SpeechOutput } from './index.ts';
export type { GenericSessionSummary } from '@flexivision/contracts';

export interface GenericSessionUpdate {
  observation: CameraPoseObservation;
  comparison: GenericLiveResult;
  cue: FeedbackCue | null;
}

/** Platform-neutral camera session. A cue needs a persistent measured mismatch and the shared feedback policy. */
export class TrackLiveGenericSession {
  private readonly comparer: LiveGenericComparer;
  private policy: FeedbackPolicy | null = null;
  private startedAt: number | null = null;
  private lastAt = 0;
  private stopped = false;
  private frames = 0;
  private tracked = 0;
  private candidates = 0;
  private spoken = 0;
  private speaking: { cue: FeedbackCue; started: boolean } | null = null;
  private firstAt: number | null = null;
  private correct = 0;
  private incorrect = 0;
  private readonly unknownReasons: GenericSessionDiagnostics['unknownReasons'] = {};
  private readonly errorCodes: GenericSessionDiagnostics['errorCodes'] = {};
  private readonly deviatingJointFrames: GenericSessionDiagnostics['deviatingJointFrames'] = {};
  private readonly missingJointFrames: GenericSessionDiagnostics['missingJointFrames'] = {};
  private readonly poseCandidates = { none: 0, single: 0, multiple: 0 };
  private readonly postStartUnknownReasons: GenericSessionDiagnostics['unknownReasons'] = {};
  private readonly postStartPhaseFrames = { waiting: 0, outbound: 0, return: 0 };
  private cycleInterruptions = 0;
  private readonly corrections = new Map<string, GenericCorrectionFinding>();
  private correctionRun: {key:string; since:number; last:number}|null = null;
  private previousPhase: GenericLiveResult['phase'] = 'waiting';
  private readonly requiredIndices: number[];
  private processingSamples = 0;
  private processingTotal = 0;
  private processingMax = 0;

  private cancelSpeech() {
    try { this.speech?.cancel(); } catch { /* Audio failure must not stop camera tracking. */ }
  }

  constructor(private readonly source: LivePoseSource, template: GenericMotionTemplate,
    private readonly speech?: SpeechOutput, bodyProfile?: CalibrationProfile) {
    this.comparer = new LiveGenericComparer(template, bodyProfile);
    this.requiredIndices = [...new Set([...FULL_BODY_LANDMARKS, ...template.trackedIndices])];
  }

  private observeDiagnostics(observation: CameraPoseObservation, comparison: GenericLiveResult): void {
    this.firstAt ??= comparison.timestampMs;
    const form = comparison.observation;
    if (form.status === 'correct') this.correct++;
    else if (form.status === 'incorrect') {
      this.incorrect++;
      // Count each code/joint at most once per frame. Newly introduced, unreviewed keys never enter reports.
      if (form.errors.some(error => error.code.startsWith('motion_')))
        this.errorCodes.motion_path = (this.errorCodes.motion_path ?? 0) + 1;
      for (const index of new Set(comparison.overlay?.joints.filter(joint => joint.deviating).map(joint => joint.index))) {
        if (Number.isInteger(index) && index >= 0 && index <= 32)
          this.deviatingJointFrames[index] = (this.deviatingJointFrames[index] ?? 0) + 1;
      }
    } else {
      const reason: GenericUnknownReason = GENERIC_UNKNOWN_REASONS.includes(form.reason as GenericUnknownReason)
        ? form.reason as GenericUnknownReason : 'other';
      this.unknownReasons[reason] = (this.unknownReasons[reason] ?? 0) + 1;
      if (this.startedAt !== null) {
        this.postStartUnknownReasons[reason] = (this.postStartUnknownReasons[reason] ?? 0) + 1;
        if (this.previousPhase !== 'waiting') this.cycleInterruptions++;
      }
    }
    const correction = comparison.correction;
    if (form.status === 'incorrect' && correction && comparison.phase !== 'waiting') {
      const key = `${correctionKey(correction)}:${comparison.phase}`;
      if (!this.correctionRun || this.correctionRun.key !== key || comparison.timestampMs-this.correctionRun.last > 500)
        this.correctionRun = {key,since:comparison.timestampMs,last:comparison.timestampMs};
      this.correctionRun.last = comparison.timestampMs;
      const finding = this.corrections.get(key) ?? {jointIndex:correction.jointIndex,action:correction.action,
        phase:comparison.phase,frames:0,longestMs:0,spokenCount:0};
      finding.frames++;
      finding.longestMs = Math.max(finding.longestMs,comparison.timestampMs-this.correctionRun.since);
      this.corrections.set(key,finding);
    } else this.correctionRun = null;
    if (this.startedAt !== null) this.postStartPhaseFrames[comparison.phase]++;
    this.previousPhase = comparison.phase;
    const people = observation.frame.people;
    this.poseCandidates[people.length === 0 ? 'none' : people.length === 1 ? 'single' : 'multiple']++;
    if (people.length === 1) {
      if (![0,7,8].some(index => isVisible(people[0]!.landmarks[index])))
        this.missingJointFrames[0] = (this.missingJointFrames[0] ?? 0) + 1;
      for (const index of this.requiredIndices) if (!isVisible(people[0]!.landmarks[index]))
        this.missingJointFrames[index] = (this.missingJointFrames[index] ?? 0) + 1;
    }
    const processing = observation.processingMs;
    if (typeof processing === 'number' && Number.isFinite(processing) && processing >= 0 && processing <= 86400000) {
      this.processingSamples++; this.processingTotal += processing;
      this.processingMax = Math.max(this.processingMax, processing);
    }
  }

  async start(onUpdate: (update: GenericSessionUpdate) => void, onError: (error: Error) => void,
    onCaptureStarted?: (timestampMs: number) => void): Promise<void> {
    if (this.stopped) return;
    const fail = (error: Error) => {
      if (this.stopped) return;
      try { this.stop(); } catch { /* Preserve the original measurement error. */ }
      onError(error);
    };
    try {
      await this.source.start(observation => {
        if (this.stopped) return;
        try {
          const time = observation.frame.timestampMs;
          const comparison = (observation.processingMs ?? 0) > 500
            ? this.comparer.unknown(time, 'processing_slow') : this.comparer.compare(observation);
          // Positioning is setup time. The first exercise correction window begins
          // only after a held start pose is measured, never when the camera opens.
          if (!this.policy && comparison.phase !== 'waiting') {
            this.policy = new FeedbackPolicy(time); this.startedAt = time;
          }
          this.lastAt = time;
          this.frames++;
          if (comparison.observation.status !== 'unknown') this.tracked++;
          this.observeDiagnostics(observation, comparison);
          if (this.speaking && (comparison.observation.status !== 'incorrect'
            || !comparison.observation.errors.some(error => error.code === this.speaking!.cue.code))) {
            const started = this.speaking.started;
            this.speaking = null;
            // A warning already audible may finish; cancelling it on the next
            // correct camera frame cuts a sentence into an inaudible fragment.
            if (!started || comparison.observation.status === 'unknown') this.cancelSpeech();
          }
          if (comparison.observation.status === 'unknown') this.cancelSpeech();
          const cue = this.policy?.observe(time, comparison.observation, this.speech?.available ?? true) ?? null;
          if (cue) {
            this.candidates++;
            if (this.speech?.available) {
              const current = { cue, started: false };
              this.speaking = current;
              try {
                void Promise.resolve(this.speech.speak(cue.text, () => {
                  if (!this.stopped && this.speaking === current) { current.started = true; this.spoken++;
                    const finding = this.corrections.get(`${cue.code}:${comparison.phase}`);
                    if (finding) finding.spokenCount++; }
                })).then(() => { if (this.speaking === current) this.speaking = null; },
                  () => { if (this.speaking === current) this.speaking = null; });
              } catch { if (this.speaking === current) this.speaking = null; }
            }
          }
          onUpdate({ observation, comparison, cue });
        } catch (error) { fail(error instanceof Error ? error : new Error('Canlı hareket ölçümü işlenemedi.')); }
      }, fail, onCaptureStarted);
    } catch (error) { fail(error instanceof Error ? error : new Error('Kamera başlatılamadı.')); }
  }

  getSummary(atMs = this.lastAt): GenericSessionSummary {
    // The session clock ends when the user stops it, even if the last camera
    // observation was earlier. The caller supplies the same monotonic clock.
    const end = Number.isFinite(atMs) ? Math.max(this.lastAt, atMs) : this.lastAt;
    return { durationMs: this.startedAt === null ? 0 : Math.max(0, end - this.startedAt),
      repetitionCount: this.comparer.getRepetitionCount(), sampledFrames: this.frames,
      trackedFrames: this.tracked, unmeasuredFrames: this.frames - this.tracked,
      cueCandidatesCount: this.candidates, spokenCuesCount: this.spoken,
      bodyProfileUsed: this.comparer.isBodyProfileApplied(),
      diagnostics: { schemaVersion: 1, elapsedMs: this.firstAt === null ? 0 : Math.max(0, end - this.firstAt),
        measuredStart: this.startedAt !== null,
        timeToStartMs: this.startedAt === null || this.firstAt === null ? null : Math.max(0, this.startedAt - this.firstAt),
        correctFrames: this.correct, incorrectFrames: this.incorrect,
        unknownReasons: { ...this.unknownReasons }, errorCodes: { ...this.errorCodes },
        deviatingJointFrames: { ...this.deviatingJointFrames }, missingJointFrames: { ...this.missingJointFrames },
        poseCandidates: { ...this.poseCandidates }, processing: { samples: this.processingSamples,
          meanMs: this.processingSamples ? this.processingTotal / this.processingSamples : null,
          maxMs: this.processingSamples ? this.processingMax : null },
        postStartUnknownReasons: { ...this.postStartUnknownReasons },
        postStartPhaseFrames: { ...this.postStartPhaseFrames }, cycleInterruptions: this.cycleInterruptions,
        corrections: [...this.corrections.values()].map(value => ({...value})) } };
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    try { this.source.stop(); } finally { this.speaking = null; this.cancelSpeech(); }
  }
}

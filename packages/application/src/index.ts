import type { StaticSessionSummary, StaticSessionRecord } from '@flexivision/contracts';
import type { ExerciseTemplate } from '@flexivision/contracts';
import type { AnalysisProgress, AnalysisResult, CalibrationProfile, CalibrationUpdate, CameraPoseObservation,
  BodySide, FeedbackCue, GenericSessionRecord, GenericSessionSummary, LiveComparisonResult, LiveSessionSummary, LiveSetupGuide, LiveSetupUpdate, MotionMap, NormalizedBodyPose, PoseSequence, ReferenceEvidence, SavedBodyProfile, SavedReferenceTemplate, SessionRecord, SquatSessionRecord, SquatTemplate } from '@flexivision/contracts';
import { analyzeStaticPose, BodyCalibration, buildMotionMap, detectGenericCycles, detectSquatCycles, evaluateGenericReference, evaluateReference, evaluateSquatReference, FeedbackPolicy, LiveSquatComparer, normalizeBodyPose } from '@flexivision/core';
import { LiveReadiness } from '@flexivision/core';
export * from './genericSession.ts';

/** Local URI on mobile; object URL in the browser. Never an upload destination. */
export interface VideoSource { uri: string; name: string }

export interface PoseExtractor {
  extract(source: VideoSource, onProgress: (progress: AnalysisProgress) => void): Promise<PoseSequence>;
  cancel(): void;
}

export class ExtractReferenceMap {
  constructor(private readonly extractor: PoseExtractor, private readonly mode: 'free' | 'squat' | 'static' = 'squat') {}
  async execute(source: VideoSource, onProgress: (progress: AnalysisProgress) => void): Promise<MotionMap> {
    const sequence = await this.extractor.extract(source, onProgress);
    const map = buildMotionMap(sequence);
    if (this.mode === 'static') {
      const analysis = analyzeStaticPose(map);
      return {...map,staticAnalysis:analysis,qualification:analysis.decision.status,decision:analysis.decision,evidence:analysis.evidence,
        status:analysis.decision.status === 'accepted' ? 'extracted' : 'insufficient_data'};
    }
    const { evidence, decision } = this.mode === 'free'
      ? evaluateGenericReference(map, detectGenericCycles(map))
      : evaluateSquatReference(map, detectSquatCycles(map));
    return {
      ...map,
      ...(this.mode === 'free' && decision.status === 'accepted' ? { status: 'extracted' as const } : {}),
      qualification: decision.status,
      decision,
      evidence,
    };
  }
  cancel() { this.extractor.cancel(); }
}

export interface ReferenceAnalyzer {
  readonly available: boolean;
  extractEvidence(source: VideoSource, signal?: AbortSignalLike): Promise<ReferenceEvidence>;
}

/** Platform-neutral cancellation, so the shared package does not require the DOM library. */
export interface AbortSignalLike { readonly aborted: boolean }

export interface SpeechOutput {
  readonly available: boolean;
  /** Optional receipt fires when speech actually starts, not when a cue is queued. */
  speak(text: string, onStarted?: () => void): void | Promise<void>;
  cancel(): void;
}

export interface LivePoseSource {
  start(onObservation: (observation: CameraPoseObservation) => void, onError: (error: Error) => void,
    onCaptureStarted?: (timestampMs: number) => void): Promise<void>;
  stop(): void;
}

/** One camera pipeline: setup frames do not enter exercise timers or reports. */
export class PrepareLiveSessionSource implements LivePoseSource {
  private stopped = false;
  private started = false;
  private ready = false;
  private readiness: LiveReadiness;
  constructor(private readonly source: LivePoseSource, side: BodySide,
    private readonly onSetup: (observation: CameraPoseObservation | null, update: LiveSetupUpdate) => void) {
    this.readiness = new LiveReadiness(side);
  }
  invalidate(guide?: LiveSetupGuide) { if (!this.stopped && !this.ready) this.onSetup(null, this.readiness.invalidate(guide)); }
  async start(onObservation: (value: CameraPoseObservation) => void, onError: (error: Error) => void,
    onCaptureStarted?: (timestampMs: number) => void) {
    if (this.stopped || this.started) return;
    this.started = true;
    const fail = (error: Error) => { if (!this.stopped) { try { this.stop(); } catch { /* Preserve the original error. */ } onError(error); } };
    try {
      await this.source.start(value => {
        if (this.stopped) return;
        try {
          if (!this.ready) {
            const update = this.readiness.observe(value);
            this.onSetup(value, update);
            if (this.stopped) return;
            this.ready = update.stage === 'active';
          }
          if (this.ready) onObservation(value);
        } catch (error) { fail(error instanceof Error ? error : new Error('Kamera hazırlığı tamamlanamadı.')); }
      }, fail, time => { if (!this.stopped) onCaptureStarted?.(time); });
    } catch (error) { fail(error instanceof Error ? error : new Error('Kamera başlatılamadı.')); }
  }
  stop() { if (!this.stopped) { this.stopped = true; this.source.stop(); } }
}
export interface BodyProfileRepository {
  load(): Promise<SavedBodyProfile | null>;
  save(profile: CalibrationProfile): Promise<SavedBodyProfile>;
  clear(): Promise<void>;
}
export interface SessionHistoryRepository {
  saveStatic?(summary:StaticSessionSummary, reference:StaticSessionRecord['reference'],endReason:SessionRecord['endReason']):Promise<StaticSessionRecord>;
  list(): Promise<SessionRecord[]>;
  save(summary: LiveSessionSummary, reference: SquatSessionRecord['reference'], endReason: SessionRecord['endReason']): Promise<SquatSessionRecord>;
  saveGeneric(summary: GenericSessionSummary, reference: GenericSessionRecord['reference'], endReason: SessionRecord['endReason']): Promise<GenericSessionRecord>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}
export interface ReferenceTemplateRepository {
  list(): Promise<SavedReferenceTemplate[]>;
  save(template: ExerciseTemplate, name: string): Promise<SavedReferenceTemplate>;
  rename(id: string, name: string): Promise<SavedReferenceTemplate>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}
export interface CalibrationReading {
  observation: CameraPoseObservation;
  update: CalibrationUpdate;
  normalized: NormalizedBodyPose | null;
}
export class CalibrateBody {
  private stopped = false;
  private calibration: BodyCalibration;
  constructor(private readonly source: LivePoseSource) {
    this.calibration = new BodyCalibration();
  }
  async start(onReading: (reading: CalibrationReading) => void, onError: (error: Error) => void,
    onCaptureStarted?: (timestampMs: number) => void) {
    if (this.stopped) return;
    const fail = (error: Error) => { if (!this.stopped) { try { this.stop(); } catch { /* Preserve the original error. */ } onError(error); } };
    try {
      await this.source.start(observation => {
        if (this.stopped) return;
        onReading({ observation, update: this.calibration.observe(observation), normalized: normalizeBodyPose(observation) });
      }, fail, timestampMs => { if (!this.stopped) onCaptureStarted?.(timestampMs); });
    } catch (error) { fail(error instanceof Error ? error : new Error('Kamera kalibrasyonu başlatılamadı.')); }
  }
  stop() { this.stopped = true; this.source.stop(); }
  invalidate() { this.calibration = new BodyCalibration(); }
}

export class AnalyzeReference {
  constructor(private readonly analyzer: ReferenceAnalyzer) {}

  async execute(source: VideoSource, signal?: AbortSignalLike): Promise<AnalysisResult> {
    if (!this.analyzer.available) return { status: 'unavailable', reason: 'Analiz motoru henüz hazır değil.' };
    if (signal?.aborted) return { status: 'failed', reason: 'Analiz iptal edildi.' };
    try {
      const evidence = await this.analyzer.extractEvidence(source, signal);
      if (signal?.aborted) return { status: 'failed', reason: 'Analiz iptal edildi.' };
      return { status: 'completed', decision: evaluateReference(evidence) };
    } catch {
      return { status: 'failed', reason: 'Video analiz edilemedi. Yeniden deneyin.' };
    }
  }
}

export interface LiveSessionUpdate {
  observation: CameraPoseObservation;
  comparison: LiveComparisonResult;
  cue: FeedbackCue | null;
}

export class TrackLiveSquatSession {
  private stopped = false;
  private comparer: LiveSquatComparer;
  private policy: FeedbackPolicy | null = null;
  private startTimeMs: number | null = null;
  private lastTimeMs = 0;
  private sampledFrames = 0;
  private trackedFrames = 0;
  private lostFrames = 0;
  private cleanRepetitions = 0;
  private currentRepHasError = false;
  private lastRepCount = 0;
  private spokenCues: { code: string; text: string; atMs: number }[] = [];
  private cueCandidatesCount = 0;
  private currentSpeechCue: FeedbackCue | null = null;
  private errorBreakdown: Record<string, number> = {};
  private trackedMs = 0;
  private previousTracked = false;
  private bodyProfileUsed = false;
  private deviations = { knee: { samples: 0, total: 0, max: 0 }, hip: { samples: 0, total: 0, max: 0 } };

  private cancelSpeech() {
    try { this.speech?.cancel(); } catch { /* Audio failure must not stop camera tracking. */ }
  }

  constructor(
    private readonly source: LivePoseSource,
    template: SquatTemplate,
    private readonly speech?: SpeechOutput,
    startTimeMs = 0,
    bodyProfile?: CalibrationProfile
  ) {
    this.comparer = new LiveSquatComparer(template, bodyProfile);
    this.lastTimeMs = startTimeMs;
  }

  async start(
    onUpdate: (update: LiveSessionUpdate) => void,
    onError: (error: Error) => void,
    onCaptureStarted?: (timestampMs: number) => void
  ) {
    if (this.stopped) return;
    const fail = (error: Error) => {
      if (!this.stopped) {
        try { this.stop(); } catch { /* Preserve the original measurement error. */ }
        onError(error);
      }
    };
    try {
      await this.source.start(
        observation => {
          if (this.stopped) return;
          try {
          const timestampMs = observation.frame.timestampMs;
          const gap = this.startTimeMs === null ? 0 : timestampMs - this.lastTimeMs;
          if (this.startTimeMs === null) {
            this.startTimeMs = timestampMs;
            this.policy = new FeedbackPolicy(timestampMs);
          }
          const comparison = (observation.processingMs ?? 0) > 500
            ? { ...this.comparer.compareAngles(timestampMs, null), observation: { status: 'unknown' as const, reason: 'processing_slow' } }
            : this.comparer.compare(observation);
          this.lastTimeMs = timestampMs;
          this.sampledFrames++;
          const tracked = comparison.observation.status !== 'unknown';
          if (tracked && this.previousTracked && gap > 0 && gap <= 500) this.trackedMs += gap;
          this.previousTracked = tracked;
          this.bodyProfileUsed ||= !!comparison.bodyPose;
          if (comparison.match && tracked) {
            for (const name of ['knee', 'hip'] as const) {
              const value = comparison.match.deviations[name];
              if (value !== null && Number.isFinite(value)) {
                const metric = this.deviations[name]; metric.samples++; metric.total += value; metric.max = Math.max(metric.max, value);
              }
            }
          }
          if (this.currentSpeechCue && (comparison.observation.status !== 'incorrect'
            || !comparison.observation.errors.some(error => error.code === this.currentSpeechCue!.code))) {
            this.currentSpeechCue = null;
            this.cancelSpeech();
          }
          if (comparison.observation.status === 'unknown') {
            this.lostFrames++;
            this.currentRepHasError = true;
            this.cancelSpeech();
          } else {
            this.trackedFrames++;
            // An interrupted partial cycle must not contaminate the next full
            // cycle after a new, measured standing anchor.
            if (comparison.match?.phase === 'standing' && comparison.observation.status === 'correct'
              && comparison.repetitionCount === this.lastRepCount) this.currentRepHasError = false;
          }

          if (comparison.observation.status === 'incorrect') {
            this.currentRepHasError = true;
            for (const err of comparison.observation.errors) {
              this.errorBreakdown[err.code] = (this.errorBreakdown[err.code] ?? 0) + 1;
            }
          }

          if (comparison.repetitionCount > this.lastRepCount) {
            const diff = comparison.repetitionCount - this.lastRepCount;
            this.lastRepCount = comparison.repetitionCount;
            if (!this.currentRepHasError) {
              this.cleanRepetitions += diff;
            }
            this.currentRepHasError = false;
          }

          const cue = this.policy!.observe(timestampMs, comparison.observation);
          if (cue) {
            this.cueCandidatesCount++;
            if (this.speech?.available) {
              this.currentSpeechCue = cue;
              try {
                void Promise.resolve(this.speech.speak(cue.text, () => {
                  if (!this.stopped && this.currentSpeechCue === cue) this.spokenCues.push({ code: cue.code, text: cue.text, atMs: cue.atMs });
                })).catch(() => { if (this.currentSpeechCue === cue) this.currentSpeechCue = null; });
              } catch { if (this.currentSpeechCue === cue) this.currentSpeechCue = null; }
            }
          }
          onUpdate({ observation, comparison, cue });
          } catch (error) { fail(error instanceof Error ? error : new Error('Canlı ölçüm işlenemedi.')); }
        },
        fail,
        timestampMs => {
          if (!this.stopped) onCaptureStarted?.(timestampMs);
        }
      );
    } catch (error) {
      fail(error instanceof Error ? error : new Error('Canlı egzersiz oturumu başlatılamadı.'));
    }
  }

  getSummary(atMs = this.lastTimeMs): LiveSessionSummary {
    const start = this.startTimeMs ?? 0;
    const durationMs = this.startTimeMs === null ? 0 : Math.max(0, this.lastTimeMs, Number.isFinite(atMs) ? atMs : 0) - start;
    const metric = (name: 'knee' | 'hip') => {
      const value = this.deviations[name];
      return { samples: value.samples, mean: value.samples ? Math.round(value.total / value.samples * 10) / 10 : null,
        max: value.samples ? value.max : null };
    };
    return {
      durationMs,
      repetitionCount: this.comparer.getRepetitionCount(),
      sampledFrames: this.sampledFrames,
      trackedFrames: this.trackedFrames,
      lostFrames: this.lostFrames,
      cleanRepetitions: this.cleanRepetitions,
      spokenCues: [...this.spokenCues],
      cueCandidatesCount: this.cueCandidatesCount,
      errorBreakdown: { ...this.errorBreakdown },
      trackedMs: this.trackedMs,
      unmeasuredMs: Math.max(0, durationMs - this.trackedMs),
      bodyProfileUsed: this.bodyProfileUsed,
      deviations: { knee: metric('knee'), hip: metric('hip') },
    };
  }

  stop() {
    this.stopped = true;
    try { this.source.stop(); } finally { this.cancelSpeech(); }
  }

  reset() {
    this.comparer.reset();
  }
}

export * from './staticSession.ts';
export * from './staticSessionArchive.ts';

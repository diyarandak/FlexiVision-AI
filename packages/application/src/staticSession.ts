import type { CameraPoseObservation, StaticPoseTemplate, StaticSessionSummary, FeedbackCue } from '@flexivision/contracts';
import { FeedbackPolicy, LiveStaticComparer, type StaticLiveResult } from '@flexivision/core';
import type { LivePoseSource, SpeechOutput } from './index.ts';
export class TrackStaticSession {
    private comparer: LiveStaticComparer;
    private stopped = false;
    private started = false;
    private policy: FeedbackPolicy | null = null;
    private startAt: number | null = null;
    private last = 0;
    private frames = 0;
    private tracked = 0;
    private candidates = 0;
    private spoken = 0;
    private currentCue: FeedbackCue | null = null;
    private result: StaticLiveResult | null = null;
    constructor(private readonly source: LivePoseSource, template: StaticPoseTemplate, private readonly targetMs: number, private readonly speech?: SpeechOutput) { this.comparer = new LiveStaticComparer(template, targetMs); }
    private cancel() { this.currentCue = null; try {
        this.speech?.cancel();
    }
    catch { /* Camera is independent of audio. */ } }
    async start(update: (value: CameraPoseObservation, result: StaticLiveResult) => void, error: (error: Error) => void, captured?: (time: number) => void) {
        if (this.stopped || this.started)
            return;
        this.started = true;
        const fail = (e: unknown) => { if (this.stopped)
            return; try {
            this.stop();
        }
        catch { /* Preserve original. */ } error(e instanceof Error ? e : new Error('Duruş takibi kesildi.')); };
        try {
            await this.source.start(value => {
                if (this.stopped || this.result?.completed)
                    return;
                try {
                    const result = this.comparer.compare(value);
                    this.last = value.frame.timestampMs;
                    this.result = result;
                    this.frames++;
                    if (result.observation.status !== 'unknown')
                        this.tracked++;
                    if (result.started && !this.policy) {
                        this.startAt = this.last;
                        this.policy = new FeedbackPolicy(this.last);
                    }
                    if (result.observation.status !== 'incorrect')
                        this.cancel();
                    const cue = this.policy?.observe(this.last, result.observation);
                    if (cue) {
                        this.candidates++;
                        if (this.speech?.available) {
                            this.currentCue = cue;
                            try {
                                let acknowledged = false;
                                void Promise.resolve(this.speech.speak(cue.text, () => { if (!acknowledged && !this.stopped && this.currentCue === cue) {
                                    acknowledged = true;
                                    this.spoken++;
                                } })).catch(() => { if (this.currentCue === cue)
                                    this.currentCue = null; });
                            }
                            catch {
                                this.currentCue = null;
                            }
                        }
                    }
                    if (result.completed) {
                        // Release the camera even when the host UI has not rendered yet.
                        let cleanupError: Error | null = null;
                        try { this.stop(); }
                        catch (failure) { cleanupError = failure instanceof Error ? failure : new Error('Kamera kapatılamadı.'); }
                        update(value, result);
                        if (cleanupError) error(cleanupError);
                    } else {
                        update(value, result);
                    }
                }
                catch (e) {
                    fail(e);
                }
            }, fail, time => { if (!this.stopped) captured?.(time); });
        }
        catch (e) {
            fail(e);
        }
    }
    getSummary(at = this.last): StaticSessionSummary {
        return { durationMs: this.startAt === null ? 0 : Math.max(0, (this.result?.completed ? this.last : Math.max(this.last, Number.isFinite(at) ? at : this.last)) - this.startAt),
            matchedMs: this.result?.matchedMs ?? 0, targetMs: this.targetMs, targetReached: this.result?.completed ?? false,
            sampledFrames: this.frames, trackedFrames: this.tracked, unmeasuredFrames: this.frames - this.tracked, cueCandidatesCount: this.candidates, spokenCuesCount: this.spoken };
    }
    stop() { if (this.stopped)
        return; this.stopped = true; try {
        this.source.stop();
    }
    finally {
        this.cancel();
    } }
}

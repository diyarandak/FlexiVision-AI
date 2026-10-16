import type { FeedbackCue, FormError, FormObservation } from '@flexivision/contracts';

export const FEEDBACK_INTERVAL_MS = 10000;
export const ERROR_PERSISTENCE_MS = 1500;
export const MAX_OBSERVATION_GAP_MS = 500;

/** One instance per active session. Feed fresh observations with a monotonic clock. */
export class FeedbackPolicy {
  private nextCheckMs: number;
  private previousMs: number;
  private activeError: { code: string; sinceMs: number } | null = null;

  constructor(startedAtMs: number) {
    if (!Number.isFinite(startedAtMs) || startedAtMs < 0) throw new Error('Invalid start time');
    this.nextCheckMs = startedAtMs + FEEDBACK_INTERVAL_MS;
    this.previousMs = startedAtMs;
  }

  observe(nowMs: number, observation: FormObservation, outputReady = true): FeedbackCue | null {
    if (!Number.isFinite(nowMs) || nowMs < this.previousMs) throw new Error('Clock must be monotonic');
    if (nowMs - this.previousMs > MAX_OBSERVATION_GAP_MS) this.activeError = null;
    this.previousMs = nowMs;

    let error: FormError | undefined;
    if (observation.status === 'incorrect') {
      error = observation.errors
        .filter(item => item.code.trim() && item.message.trim() && Number.isFinite(item.severity) && item.severity > 0)
        .reduce<FormError | undefined>((best, item) => !best || item.severity > best.severity ? item : best, undefined);
    }
    if (!error) this.activeError = null;
    else if (this.activeError?.code !== error.code) this.activeError = { code: error.code, sinceMs: nowMs };

    if (nowMs < this.nextCheckMs) return null;
    // The gate stays open until a CURRENT persistent error can be delivered.
    // An unknown frame or a busy speaker must not spend the next ten seconds.
    if (!outputReady || !error || !this.activeError || nowMs - this.activeError.sinceMs < ERROR_PERSISTENCE_MS) return null;
    this.nextCheckMs = nowMs + FEEDBACK_INTERVAL_MS;
    return { code: error.code, text: error.message, atMs: nowMs };
  }
}

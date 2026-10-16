import type { SessionEndReason, StaticSessionRecord, StaticSessionSummary } from '@flexivision/contracts';
import { isStaticSessionSummary, staticSessionSummaryData } from '@flexivision/core';

export type SaveStaticSession = (
  summary: StaticSessionSummary,
  reference: StaticSessionRecord['reference'],
  reason: SessionEndReason,
) => Promise<StaticSessionRecord>;

/** One frozen report per run. Concurrent finish/close calls share a save attempt.
 * A failed attempt retains the original snapshot for an explicit retry. */
export class StaticSessionArchive {
  private readonly snapshot: StaticSessionSummary;
  private readonly reference: StaticSessionRecord['reference'];
  private pending: Promise<boolean> | null = null;
  private state: 'unsaved' | 'saving' | 'saved' | 'failed' | 'discarded' = 'unsaved';

  constructor(summary: StaticSessionSummary, reference: StaticSessionRecord['reference'],
    readonly reason: SessionEndReason, private readonly persist: SaveStaticSession) {
    if (!isStaticSessionSummary(summary)) throw new Error('Oturum özeti geçersiz.');
    if (!Number.isInteger(reference.intervalId) || reference.intervalId < 1 || reference.intervalId > 1000
      || reference.policyVersion !== 'static-pose-v1') throw new Error('Referans duruş bilgisi geçersiz.');
    this.snapshot = staticSessionSummaryData(summary);
    this.reference = { intervalId: reference.intervalId, policyVersion: 'static-pose-v1' };
    // No measured pose means there is no report to persist.
    if (summary.trackedFrames === 0) this.state = 'discarded';
  }
  get summary() { return staticSessionSummaryData(this.snapshot); }
  get status() { return this.state; }
  get canLeave() { return this.state === 'saved' || this.state === 'discarded'; }

  save(): Promise<boolean> {
    if (this.canLeave) return Promise.resolve(true);
    if (this.pending) return this.pending;
    this.state = 'saving';
    this.pending = Promise.resolve()
      .then(() => this.persist(this.summary, { ...this.reference }, this.reason))
      .then(() => { this.state = 'saved'; return true; })
      .catch(() => { this.state = 'failed'; return false; })
      .finally(() => { this.pending = null; });
    return this.pending;
  }
  discard(): boolean {
    if (this.pending) return false;
    if (this.state !== 'saved') this.state = 'discarded';
    return true;
  }
}

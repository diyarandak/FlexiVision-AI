import { CALIBRATION_POLICY } from './calibration.ts';

/** Pipeline health uses supplied times, not a browser clock. A pending frame is
 * different from a stopped stream; processing time never advances calibration. */
export class CalibrationStreamTiming {
  private pendingAt: number | null = null;
  private receivedAt: number | null = null;
  reset() { this.pendingAt = null; this.receivedAt = null; }
  captureStarted(atMs: number) { this.pendingAt = atMs; }
  received(capturedAtMs: number, atMs: number): boolean {
    if (![capturedAtMs, atMs].every(Number.isFinite) || capturedAtMs < 0 || atMs < capturedAtMs
      || atMs - capturedAtMs > CALIBRATION_POLICY.maxProcessingMs
      || (this.pendingAt !== null && this.pendingAt !== capturedAtMs)) return false;
    this.pendingAt = null; this.receivedAt = atMs;
    return true;
  }
  check(atMs: number): 'fresh' | 'processing' | 'stale' | 'timed_out' {
    if (this.pendingAt !== null) {
      const elapsed = atMs - this.pendingAt;
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > CALIBRATION_POLICY.maxProcessingMs) return 'timed_out';
      return elapsed > 1500 ? 'processing' : 'fresh';
    }
    if (this.receivedAt === null) return 'fresh';
    const elapsed = atMs - this.receivedAt;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > CALIBRATION_POLICY.maxProcessingMs) return 'timed_out';
    return elapsed > 1500 ? 'stale' : 'fresh';
  }
}

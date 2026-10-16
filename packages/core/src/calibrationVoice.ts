/** Setup guidance has its own timing; it never produces exercise correction cues. */
export class CalibrationVoicePolicy {
  private pending = '';
  private since = 0;
  private last = '';
  private lastAt = -Infinity;
  private previous = -1;
  begin(now: number) { this.check(now); this.lastAt = now; this.pending = ''; this.last = ''; }
  next(key: string | null, now: number, repeat = true): boolean {
    this.check(now);
    // A measured recovery breaks continuity, but does not restart the speech cooldown.
    if (key === null) { this.pending = ''; this.since = now; return false; }
    if (key !== this.pending) { this.pending = key; this.since = now; }
    if (now - this.since < 600 || now - this.lastAt < 7000
      || (key === this.last && (!repeat || now - this.lastAt < 7000))) return false;
    this.last = key; this.lastAt = now;
    return true;
  }
  private check(now: number) {
    if (!Number.isFinite(now) || now < 0 || now < this.previous) throw new Error('Invalid calibration voice clock');
    this.previous = now;
  }
}

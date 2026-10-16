import type { ReferenceDecision, ReferenceEvidence, RejectionCode } from '@flexivision/contracts';

/** Initial engineering thresholds, not clinically validated measurements. */
export const REFERENCE_POLICY = Object.freeze({
  version: 'reference-v1' as const,
  minDurationMs: 3000,
  maxDurationMs: 60000,
  minSampledFrames: 15,
  minUsableRatio: 0.85,
});

export function evaluateReference(evidence: ReferenceEvidence): ReferenceDecision {
  const policyVersion = REFERENCE_POLICY.version;
  const counts = [evidence.sampledFrames, evidence.usableFrames,
    evidence.multiPersonFrames, evidence.completeRepetitions];
  if (!Number.isFinite(evidence.durationMs) || evidence.durationMs <= 0 ||
      counts.some(value => !Number.isInteger(value) || value < 0) ||
      evidence.usableFrames > evidence.sampledFrames ||
      evidence.multiPersonFrames > evidence.sampledFrames) {
    return { status: 'rejected', policyVersion, reasons: ['invalid_evidence'] };
  }

  const reasons: RejectionCode[] = [];
  if (evidence.durationMs < REFERENCE_POLICY.minDurationMs ||
      evidence.durationMs > REFERENCE_POLICY.maxDurationMs) reasons.push('duration_out_of_range');
  if (evidence.sampledFrames < REFERENCE_POLICY.minSampledFrames) reasons.push('insufficient_frames');
  if (evidence.multiPersonFrames > 0) reasons.push('multiple_people');
  if (evidence.sampledFrames === 0 ||
      evidence.usableFrames / evidence.sampledFrames < REFERENCE_POLICY.minUsableRatio) {
    reasons.push('body_not_visible');
  }
  if (evidence.view !== 'supported') reasons.push('unsupported_view');
  if (evidence.motion !== 'supported') reasons.push('unsupported_motion');
  if (evidence.completeRepetitions < 1) reasons.push('incomplete_repetition');
  return reasons.length > 0
    ? { status: 'rejected', policyVersion, reasons }
    : { status: 'accepted', policyVersion };
}

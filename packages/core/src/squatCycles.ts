import type { BodySide, JointAngles, JointName, MotionMap, MotionSample, ReferenceDecision, SquatCycleAnalysis, SquatPhase, SquatRepetition, SquatTemplate } from '@flexivision/contracts';
import { REFERENCE_POLICY } from './reference.ts';

/** Engineering presets for segmentation. These are not form or safety rules. */
export const SQUAT_CYCLE_POLICY = Object.freeze({
  version: 'squat-cycles-v1' as const,
  standingKneeDegrees: 155,
  bentKneeDegrees: 110,
  minKneeExcursionDegrees: 45,
  minHipExcursionDegrees: 30,
  topHoldMs: 200,
  minBentHoldMs: 200,
  bottomBandDegrees: 8,
  minDurationMs: 1000,
  maxDurationMs: 12000,
  maxSampleGapMs: 250,
  templateSamples: 51,
});

interface Signal { index: number; time: number; knee: number; hip: number }
function joint(side: BodySide, name: 'Knee' | 'Hip'): JointName { return `${side}${name}`; }
function validAngle(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 180;
}
function usable(sample: MotionSample, side: BodySide) {
  return validAngle(sample.angles2d[joint(side, 'Knee')]) && validAngle(sample.angles2d[joint(side, 'Hip')]);
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function chooseSide(map: MotionMap): BodySide | null {
  const scores = (['left', 'right'] as const).map(side => {
    const count = map.samples.filter(sample => usable(sample, side)).length;
    const indices = side === 'left' ? [11, 23, 25, 27] : [12, 24, 26, 28];
    const visibility = map.sequence.frames.flatMap((frame, i) => {
      const person = frame.people.length === 1 ? frame.people[0] : undefined;
      return person && map.samples[i] && usable(map.samples[i]!, side)
        ? indices.map(index => person.landmarks[index]?.visibility ?? 0) : [];
    });
    return { side, count, visibility: visibility.length ? median(visibility) : 0 };
  }).filter(score => score.count / map.samples.length >= REFERENCE_POLICY.minUsableRatio);
  scores.sort((a, b) => b.count - a.count || b.visibility - a.visibility);
  return scores[0]?.side ?? null;
}

/** Smooth only inside contiguous observations of the same side. Never fill tracking gaps. */
function signalFor(map: MotionMap, side: BodySide): (Signal | null)[] {
  return map.samples.map((sample, index) => {
    if (!usable(sample, side)) return null;
    const neighbors = map.samples.slice(Math.max(0, index - 1), index + 2)
      .filter(other => usable(other, side)
        && Math.abs(other.timestampMs - sample.timestampMs) <= SQUAT_CYCLE_POLICY.maxSampleGapMs);
    return { index, time: sample.timestampMs,
      knee: median(neighbors.map(other => other.angles2d[joint(side, 'Knee')]!)),
      hip: median(neighbors.map(other => other.angles2d[joint(side, 'Hip')]!)) };
  });
}

function heldBent(points: readonly Signal[]): boolean {
  let since: number | null = null;
  for (const point of points) {
    if (point.knee > SQUAT_CYCLE_POLICY.bentKneeDegrees) since = null;
    else {
      since ??= point.time;
      if (point.time - since >= SQUAT_CYCLE_POLICY.minBentHoldMs) return true;
    }
  }
  return false;
}

/** Explain observed partial motion without joining the video's ends or filling gaps. */
function incompleteCause(signal: (Signal | null)[]): SquatCycleAnalysis['incompleteCause'] {
  if (signal.some((point, index) => !point || (index > 0 && signal[index - 1]
    && point.time - signal[index - 1]!.time > SQUAT_CYCLE_POLICY.maxSampleGapMs))) return 'tracking_gap';
  const points = signal.filter((point): point is Signal => point !== null);
  if (!points.length) return undefined;
  let topSince: number | null = null, firstTop = -1, lastTop = -1;
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    if (point.knee < SQUAT_CYCLE_POLICY.standingKneeDegrees) { topSince = null; continue; }
    topSince ??= point.time;
    if (point.time - topSince >= SQUAT_CYCLE_POLICY.topHoldMs) {
      if (firstTop < 0) firstTop = index;
      lastTop = index;
    }
  }
  if (firstTop < 0) return undefined;
  const substantial = (part: Signal[]) => part.length > 1 && heldBent(part)
    && part[part.length - 1]!.time - part[0]!.time <= SQUAT_CYCLE_POLICY.maxDurationMs
    && Math.max(...part.map(point => point.knee)) - Math.min(...part.map(point => point.knee)) >= SQUAT_CYCLE_POLICY.minKneeExcursionDegrees
    && Math.max(...part.map(point => point.hip)) - Math.min(...part.map(point => point.hip)) >= SQUAT_CYCLE_POLICY.minHipExcursionDegrees;
  const missingStart = points[0]!.knee <= SQUAT_CYCLE_POLICY.bentKneeDegrees && substantial(points.slice(0, firstTop + 1));
  const missingEnd = points[points.length - 1]!.knee <= SQUAT_CYCLE_POLICY.bentKneeDegrees && substantial(points.slice(lastTop));
  return missingStart && missingEnd ? 'missing_standing_start_and_end'
    : missingStart ? 'missing_standing_start' : missingEnd ? 'missing_standing_end' : undefined;
}

export function detectSquatCycles(map: MotionMap): SquatCycleAnalysis {
  const base = { policyVersion: SQUAT_CYCLE_POLICY.version, trackingBreaks: 0 };
  if (map.status !== 'extracted') return { ...base, status: 'insufficient_data', side: null, repetitions: [], reason: 'body_not_visible' };
  const side = chooseSide(map);
  if (!side) return { ...base, status: 'insufficient_data', side: null, repetitions: [], reason: 'no_consistent_side' };
  const signal = signalFor(map, side), repetitions: SquatRepetition[] = [];
  let topSince: number | null = null, anchor: Signal | null = null;
  let cycle: Signal[] | null = null, returnTop: Signal | null = null;
  let previous: Signal | null = null, trackingBreaks = 0;
  const policy = SQUAT_CYCLE_POLICY;
  for (const point of signal) {
    if (!point || (previous && point.time - previous.time > policy.maxSampleGapMs)) {
      if (anchor || cycle) trackingBreaks++;
      topSince = null; anchor = null; cycle = null; returnTop = null; previous = null;
      if (!point) continue;
    }
    previous = point;
    const standing = point.knee >= policy.standingKneeDegrees;
    if (!cycle) {
      if (standing) {
        topSince ??= point.time;
        if (point.time - topSince >= policy.topHoldMs) anchor = point;
      } else {
        if (anchor) cycle = [anchor, point];
        topSince = null; anchor = null;
      }
      continue;
    }
    cycle.push(point);
    if (point.time - cycle[0]!.time > policy.maxDurationMs) {
      cycle = null; returnTop = null; topSince = standing ? point.time : null; anchor = null;
      continue;
    }
    if (!standing) { returnTop = null; continue; }
    returnTop ??= point;
    if (point.time - returnTop.time < policy.topHoldMs) continue;
    const body = cycle.filter(value => value.time <= returnTop!.time);
    const first = body[0]!, last = body[body.length - 1]!;
    const bottom = body.reduce((lowest, value) => value.knee < lowest.knee ? value : lowest);
    const kneeMin = bottom.knee, kneeMax = Math.max(...body.map(value => value.knee));
    const hipMin = Math.min(...body.map(value => value.hip)), hipMax = Math.max(...body.map(value => value.hip));
    const bottomBand = body.filter(value => value.knee <= kneeMin + policy.bottomBandDegrees);
    const bottomStart = bottomBand[0]!, bottomEnd = bottomBand[bottomBand.length - 1]!;
    // Returning to standing must close a substantial knee AND hip cycle.
    if (last.time - first.time >= policy.minDurationMs && heldBent(body)
      && kneeMax - kneeMin >= policy.minKneeExcursionDegrees && hipMax - hipMin >= policy.minHipExcursionDegrees
      && bottomStart.time > first.time && bottomEnd.time < last.time) {
      const ascentStart = body.find(value => value.time > bottomEnd.time)?.time ?? last.time;
      repetitions.push({ id: repetitions.length + 1, side, startMs: first.time, endMs: last.time,
        bottomMs: bottom.time, kneeRange: { min: kneeMin, max: kneeMax }, hipRange: { min: hipMin, max: hipMax },
        phases: [
          { phase: 'descent', startMs: first.time, endMs: bottomStart.time },
          { phase: 'bottom', startMs: bottomStart.time, endMs: ascentStart },
          { phase: 'ascent', startMs: ascentStart, endMs: last.time },
        ] });
    }
    // The held top also arms the next repetition; the video edges cannot close a cycle.
    topSince = returnTop.time; anchor = point; cycle = null; returnTop = null;
  }
  const cause = repetitions.length ? undefined : incompleteCause(signal);
  return { ...base, trackingBreaks, side, repetitions, ...(cause ? { incompleteCause: cause } : {}),
    status: repetitions.length ? 'ready' : 'no_complete_repetition',
    reason: repetitions.length ? null : 'no_complete_repetition' };
}

function phaseAt(repetition: SquatRepetition, time: number): SquatPhase {
  return repetition.phases.find(interval => time < interval.endMs)?.phase ?? 'ascent';
}

/** Create a draft with the same vector length for references of different duration. */
export function buildSquatTemplate(map: MotionMap, repetitionId: number, decision?: ReferenceDecision): SquatTemplate {
  const analysis = detectSquatCycles(map);
  const repetition = analysis.repetitions.find(value => value.id === repetitionId);
  if (!repetition) throw new Error('A complete measured repetition is required');
  const durationMs = repetition.endMs - repetition.startMs;
  const signal = signalFor(map, repetition.side);
  const sourceSamples = map.samples.flatMap((sample, index) => {
    if (sample.timestampMs < repetition.startMs || sample.timestampMs > repetition.endMs) return [];
    const measured = signal[index];
    if (!measured) throw new Error('Tracked joints must remain measured throughout the repetition');
    // The template uses the same local spike filter as cycle segmentation.
    // Untracked joints and the original exported motion map are preserved.
    return [{ ...sample, angles2d: { ...sample.angles2d,
      [joint(repetition.side, 'Knee')]: measured.knee, [joint(repetition.side, 'Hip')]: measured.hip } }];
  });
  const samples = Array.from({ length: SQUAT_CYCLE_POLICY.templateSamples }, (_, index) => {
    const progress = index / (SQUAT_CYCLE_POLICY.templateSamples - 1), offsetMs = progress * durationMs;
    const time = repetition.startMs + offsetMs;
    const upperIndex = sourceSamples.findIndex(sample => sample.timestampMs >= time);
    const position = upperIndex === -1 ? sourceSamples.length - 1 : upperIndex;
    const upper = sourceSamples[position]!;
    const lower = sourceSamples[Math.max(0, position - 1)]!;
    const fraction = upper.timestampMs === lower.timestampMs ? 0 : (time - lower.timestampMs) / (upper.timestampMs - lower.timestampMs);
    const angles2d = Object.fromEntries(Object.keys(lower.angles2d).map(key => {
      const name = key as JointName, a = lower.angles2d[name], b = upper.angles2d[name];
      // Other joints may be absent. Do not invent values across an occlusion.
      return [name, fraction === 0 ? a : fraction === 1 ? b
        : validAngle(a) && validAngle(b) ? a + (b - a) * fraction : null];
    })) as JointAngles;
    return { progress, offsetMs, phase: phaseAt(repetition, time), angles2d };
  });
  const qualification = decision?.status === 'accepted' ? 'accepted' : 'not_evaluated';
  return { schemaVersion: 1, kind: 'squat-cycle-template', qualification,
    ...(decision ? { decision } : {}),
    policyVersion: analysis.policyVersion,
    source: { engine: { ...map.sequence.engine }, durationMs: map.sequence.durationMs, width: map.sequence.width, height: map.sequence.height },
    repetition, durationMs, samples };
}

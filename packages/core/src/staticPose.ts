import type { CameraPoseObservation, MotionMap, StaticPoseAnalysis, StaticPoseTemplate, RejectionCode } from '@flexivision/contracts';
import { normalizeBodyPose } from './calibration.ts';
export const STATIC_POSE_POLICY = Object.freeze({ minStableMs: 2000, minFrames: 16, maxGapMs: 250,
    maxReferenceDrift: .12, maxLiveGapMs: 500, startHoldMs: 500, toleranceDegrees: 15 });
export const STATIC_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28] as const;
export const STATIC_BONES = [[23, 24], [23, 11], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28]] as const;
type Point = {
    x: number;
    y: number;
};
export function staticPosePoints(observation: CameraPoseObservation) {
    const pose = normalizeBodyPose(observation);
    if (!pose || !STATIC_JOINTS.every(index => pose.landmarks[index]))
        return null;
    if (STATIC_BONES.some(([a, b]) => Math.hypot(pose.landmarks[a]!.x - pose.landmarks[b]!.x, pose.landmarks[a]!.y - pose.landmarks[b]!.y) < .06))
        return null;
    return pose;
}
export function boneDeviation(a: Point, b: Point, c: Point, d: Point) {
    const ax = b.x - a.x, ay = b.y - a.y, bx = d.x - c.x, by = d.y - c.y;
    const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by);
    return denominator > 1e-8 ? Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / denominator))) * 180 / Math.PI : Infinity;
}
/** Find measured stable intervals. The longest is suggested; the user can preview/select another. */
export function analyzeStaticPose(map: MotionMap): StaticPoseAnalysis {
    const { sequence } = map, holds: StaticPoseTemplate[] = [];
    const reasons: RejectionCode[] = [];
    type Reading = {
        time: number;
        pose: NonNullable<ReturnType<typeof staticPosePoints>>;
    };
    let run: Reading[] = [];
    let usable = 0, multiple = 0, last = -1;
    const flush = () => {
        const first = run[0], end = run.at(-1);
        if (first && end && run.length >= STATIC_POSE_POLICY.minFrames && end.time - first.time >= STATIC_POSE_POLICY.minStableMs) {
            const landmarks = Array.from({ length: 33 }, (_, index) => {
                if (!STATIC_JOINTS.includes(index as typeof STATIC_JOINTS[number]))
                    return null;
                const median = (values: number[]) => { values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)]!; };
                return { x: median(run.map(r => r.pose.landmarks[index]!.x)), y: median(run.map(r => r.pose.landmarks[index]!.y)) };
            });
            const template: StaticPoseTemplate = { schemaVersion: 1, kind: 'static-pose-template', qualification: 'accepted', policyVersion: 'static-pose-v1',
                source: { engine: { ...sequence.engine }, width: sequence.width, height: sequence.height, durationMs: sequence.durationMs },
                durationMs: end.time - first.time, interval: { id: holds.length + 1, startMs: first.time, endMs: end.time }, landmarks };
            if (isAcceptedStaticTemplate(template))
                holds.push(template);
        }
        run = [];
    };
    let invalid = false;
    for (const frame of sequence.frames) {
        const time = frame.timestampMs;
        if (!Number.isFinite(time) || time < 0 || time <= last || time > sequence.durationMs) {
            invalid = true;
            break;
        }
        if (frame.people.length > 1)
            multiple++;
        const pose = staticPosePoints({ frame, width: sequence.width, height: sequence.height });
        if (!pose) {
            flush();
            last = time;
            continue;
        }
        usable++;
        const anchor = run[0]?.pose;
        if (time - last > STATIC_POSE_POLICY.maxGapMs)
            flush();
        if (anchor && run.length) {
            const drift = Math.max(...STATIC_JOINTS.map(i => Math.hypot(pose.landmarks[i]!.x - anchor.landmarks[i]!.x, pose.landmarks[i]!.y - anchor.landmarks[i]!.y)));
            const cameraDrift = Math.hypot((pose.origin.x - anchor.origin.x) * sequence.width, (pose.origin.y - anchor.origin.y) * sequence.height) / anchor.torsoPixels;
            if (drift > STATIC_POSE_POLICY.maxReferenceDrift || cameraDrift > .15 || Math.abs(pose.torsoPixels / anchor.torsoPixels - 1) > .15)
                flush();
        }
        run.push({ time, pose });
        last = time;
    }
    flush();
    if (invalid || ![sequence.width, sequence.height].every(v => Number.isFinite(v) && v > 0 && v <= 10000))
        reasons.push('invalid_evidence');
    if (!Number.isFinite(sequence.durationMs) || sequence.durationMs < 3000 || sequence.durationMs > 60000)
        reasons.push('duration_out_of_range');
    if (sequence.frames.length < 16)
        reasons.push('insufficient_frames');
    if (multiple)
        reasons.push('multiple_people');
    if (usable / Math.max(1, sequence.frames.length) < .8)
        reasons.push('body_not_visible');
    if (!holds.length)
        reasons.push('unsupported_motion');
    return { decision: reasons.length ? { status: 'rejected', policyVersion: 'reference-v1', reasons } : { status: 'accepted', policyVersion: 'reference-v1' },
        evidence: { durationMs: sequence.durationMs, sampledFrames: sequence.frames.length, usableFrames: usable, multiPersonFrames: multiple,
            view: holds.length ? 'supported' : 'unknown', motion: holds.length ? 'supported' : 'unknown', completeRepetitions: 0 },
        holds: reasons.length ? [] : holds.sort((a, b) => b.durationMs - a.durationMs) };
}
export function isAcceptedStaticTemplate(value: unknown): value is StaticPoseTemplate {
    if (!value || typeof value !== 'object')
        return false;
    const t = value as StaticPoseTemplate;
    const finite = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
    if (t.schemaVersion !== 1 || t.kind !== 'static-pose-template' || t.qualification !== 'accepted' || t.policyVersion !== 'static-pose-v1'
        || !t.source || t.source.engine?.name !== 'mediapipe-pose' || !['version', 'model'].every(k => typeof t.source.engine[k as 'version' | 'model'] === 'string' && t.source.engine[k as 'version' | 'model'].length > 0 && t.source.engine[k as 'version' | 'model'].length <= 150)
        || !finite(t.source.width, 1, 10000) || !finite(t.source.height, 1, 10000) || !finite(t.source.durationMs, 3000, 60000)
        || !t.interval || !Number.isInteger(t.interval.id) || !finite(t.interval.id, 1, 1000)
        || !finite(t.interval.startMs, 0, t.source.durationMs) || !finite(t.interval.endMs, t.interval.startMs, t.source.durationMs)
        || !finite(t.durationMs, 2000, 60000) || Math.abs(t.interval.endMs - t.interval.startMs - t.durationMs) > 1e-6
        || !Array.isArray(t.landmarks) || t.landmarks.length !== 33)
        return false;
    if (!t.landmarks.every((p, i) => p === null ? !STATIC_JOINTS.includes(i as typeof STATIC_JOINTS[number]) : !!p && finite(p.x, -20, 20) && finite(p.y, -20, 20)))
        return false;
    return STATIC_BONES.every(([a, b]) => Math.hypot(t.landmarks[a]!.x - t.landmarks[b]!.x, t.landmarks[a]!.y - t.landmarks[b]!.y) >= .06);
}
export function staticTemplateData(t: StaticPoseTemplate): StaticPoseTemplate {
    if (!isAcceptedStaticTemplate(t))
        throw new Error('Geçerli ve kabul edilmiş bir sabit duruş gerekli.');
    return { schemaVersion: 1, kind: 'static-pose-template', qualification: 'accepted', policyVersion: 'static-pose-v1',
        source: { engine: { name: t.source.engine.name, version: t.source.engine.version, model: t.source.engine.model }, width: t.source.width, height: t.source.height, durationMs: t.source.durationMs },
        durationMs: t.durationMs, interval: { id: t.interval.id, startMs: t.interval.startMs, endMs: t.interval.endMs },
        landmarks: t.landmarks.map(p => p ? { x: p.x, y: p.y } : null) };
}

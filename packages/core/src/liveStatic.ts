import type { CameraPoseObservation, FormObservation, StaticPoseTemplate } from '@flexivision/contracts';
import type { GenericLiveOverlay } from './liveGeneric.ts';
import { boneDeviation, isAcceptedStaticTemplate, staticPosePoints, STATIC_BONES, STATIC_POSE_POLICY } from './staticPose.ts';
export interface StaticLiveResult {
    observation: FormObservation;
    matchedMs: number;
    targetMs: number;
    started: boolean;
    completed: boolean;
    overlay: GenericLiveOverlay | null;
}
/** Compare bone directions, independent of limb length, position and image scale. */
export class LiveStaticComparer {
    private last = -1;
    private since: number | null = null;
    private begun = false;
    private matched = 0;
    private previousCorrect = false;
    private mirror = false;
    constructor(private readonly template: StaticPoseTemplate, readonly targetMs: number) {
        if (!isAcceptedStaticTemplate(template))
            throw new Error('Geçerli sabit duruş şablonu gerekli.');
        if (!Number.isInteger(targetMs) || targetMs < 5000 || targetMs > 600000)
            throw new Error('Hedef süre 5–600 saniye olmalı.');
    }
    compare(value: CameraPoseObservation): StaticLiveResult {
        const time = value.frame.timestampMs;
        if (!Number.isFinite(time) || time < 0 || time <= this.last)
            throw new Error('Kamera zamanı ilerlemeli.');
        const gap = this.last < 0 ? 0 : time - this.last;
        this.last = time;
        const result = (observation: FormObservation, overlay: GenericLiveOverlay | null = null): StaticLiveResult => ({ observation, overlay,
            matchedMs: this.matched, targetMs: this.targetMs, started: this.begun, completed: this.matched >= this.targetMs });
        const unknown = (reason: string) => { this.since = null; this.previousCorrect = false; return result({ status: 'unknown', reason }); };
        if (this.matched >= this.targetMs)
            return result({ status: 'correct' });
        if (gap > STATIC_POSE_POLICY.maxLiveGapMs) {
            this.since = null;
            this.previousCorrect = false;
        }
        if (!Number.isFinite(value.processingMs ?? 0) || (value.processingMs ?? 0) < 0 || (value.processingMs ?? 0) > 500)
            return unknown('processing_slow');
        if (value.frame.people.length !== 1)
            return unknown(value.frame.people.length ? 'multiple_people' : 'no_person');
        const pose = staticPosePoints(value);
        if (!pose)
            return unknown('body_not_visible');
        const p = pose.landmarks, ref = this.template.landmarks;
        const reference = (i: number, mirror: boolean) => ({ x: ref[i]!.x * (mirror ? -1 : 1), y: ref[i]!.y });
        const deviations = (mirror: boolean) => STATIC_BONES.map(([a, b]) => boneDeviation(reference(a, mirror), reference(b, mirror), p[a]!, p[b]!));
        const regular = deviations(false), flipped = deviations(true);
        if (!this.begun)
            this.mirror = Math.max(...flipped) < Math.max(...regular);
        const differences = this.mirror ? flipped : regular, max = Math.max(...differences);
        const width = (a: number, b: number, points: typeof p) => Math.hypot(points[a]!.x - points[b]!.x, points[a]!.y - points[b]!.y);
        if (Math.abs(width(11, 12, p) - width(11, 12, ref)) > .5 && Math.abs(width(23, 24, p) - width(23, 24, ref)) > .4)
            return unknown('camera_view');
        if (max > 100)
            return unknown('pose_uncertain');
        const correct = max <= STATIC_POSE_POLICY.toleranceDegrees;
        if (!this.begun) {
            if (!correct)
                return unknown('find_start');
            this.since ??= time;
            if (time - this.since < STATIC_POSE_POLICY.startHoldMs)
                return unknownHolding();
            this.begun = true;
            this.previousCorrect = false;
        }
        if (correct && this.previousCorrect && gap <= STATIC_POSE_POLICY.maxLiveGapMs)
            this.matched = Math.min(this.targetMs, this.matched + gap);
        this.previousCorrect = correct;
        const expected = new Map<number, {
            x: number;
            y: number;
        }>([[23, { ...p[23]! }]]), red = new Set<number>();
        STATIC_BONES.forEach(([a, b], index) => {
            const start = expected.get(a)!, ra = reference(a, this.mirror), rb = reference(b, this.mirror);
            const length = width(a, b, p), rLength = Math.hypot(rb.x - ra.x, rb.y - ra.y);
            expected.set(b, { x: start.x + (rb.x - ra.x) * length / rLength, y: start.y + (rb.y - ra.y) * length / rLength });
            if (differences[index]! > STATIC_POSE_POLICY.toleranceDegrees) {
                red.add(a);
                red.add(b);
            }
        });
        const overlay: GenericLiveOverlay = { joints: [...expected].map(([index, target]) => ({ index,
                observed: { x: value.frame.people[0]!.landmarks[index]!.x, y: value.frame.people[0]!.landmarks[index]!.y },
                reference: { x: pose.origin.x + target.x * pose.torsoPixels / value.width, y: pose.origin.y + target.y * pose.torsoPixels / value.height },
                deviation: max, deviating: red.has(index) })) };
        return result(correct ? { status: 'correct' } : { status: 'incorrect', errors: [{ code: 'static_pose_difference', severity: 2,
                    message: 'Duruşun referanstan ayrıldı. Kırmızı işaretli bölgeleri referans çizgisine yaklaştır.' }] }, overlay);
        function unknownHolding() { return result({ status: 'unknown', reason: 'hold_start' }); }
    }
}

import type { BodySide, CameraPoseObservation, LiveSetupGuide, LiveSetupUpdate } from '@flexivision/contracts';
import { isVisible, imageAngles, MIN_LANDMARK_VISIBILITY } from './motionMap.ts';
import { sideViewEvidence } from './cameraView.ts';
import { LIVE_SQUAT_POLICY } from './liveSquat.ts';

export const LIVE_SETUP_POLICY = Object.freeze({ holdMs: 1200, minFrames: 6, countdownMs: 3000, maxGapMs: 500 });
export const LIVE_SETUP_MESSAGES: Record<LiveSetupGuide, string> = {
  find_person: 'Kamera karşısına geç', multiple_people: 'Kadrajda yalnızca sen kal',
  show_shoulders: 'Omuzların görünsün', show_hips: 'Kalçan görünsün', show_knees: 'Dizlerin görünsün', show_ankles: 'Ayak bileklerin görünsün',
  step_back: 'Biraz geri git · Vücudun kadraja sığsın', step_closer: 'Biraz yaklaş · Görüntün çok küçük',
  turn_sideways: 'Kameraya yan dön', stand_still: 'Önce ayakta rahat dur', processing_slow: 'Telefon görüntüyü yavaş işliyor',
  stream_slow: 'Kamera ölçümleri yeterince hızlı gelmiyor',
  stream_waiting: 'Yeni kamera ölçümü bekleniyor', hold: 'Böyle kal · Kadraj kontrol ediliyor',
  countdown: 'Hazırsın · Geri sayım bitene kadar ayakta kal', start: 'Başla · Squat hareketini yapabilirsin',
};

/** A short per-session framing check, not a new body scan or form approval.
 * Only measured standing intervals advance the countdown; missing frames never do. */
export class LiveReadiness {
  private previous = -1;
  private holdMs = 0;
  private frames = 0;
  private countdownMs = 0;
  private stage: LiveSetupUpdate['stage'] = 'positioning';
  constructor(private readonly side: BodySide) {}

  invalidate(guide: LiveSetupGuide = 'stream_waiting'): LiveSetupUpdate { return this.reset(guide); }
  private reset(guide: LiveSetupGuide): LiveSetupUpdate {
    if (this.stage === 'active') return { stage: 'active', guide: 'start', progress: 1, countdown: null };
    this.stage = 'positioning'; this.frames = 0; this.holdMs = 0; this.countdownMs = 0;
    return { stage: this.stage, guide, progress: 0, countdown: null };
  }
  observe(value: CameraPoseObservation): LiveSetupUpdate {
    const time = value.frame.timestampMs;
    if (!Number.isFinite(time) || time < 0 || time <= this.previous) throw new Error('Live setup timestamps must increase');
    const gap = this.previous < 0 ? 0 : time - this.previous; this.previous = time;
    if (this.stage === 'active') return { stage: 'active', guide: 'start', progress: 1, countdown: null };
    const slowStream = gap > LIVE_SETUP_POLICY.maxGapMs;
    if (slowStream) this.reset('stream_slow');
    const guide = this.issue(value);
    if (guide) return this.reset(guide);
    const interval = this.frames > 0 && gap <= LIVE_SETUP_POLICY.maxGapMs ? gap : 0;
    this.frames++;
    if (slowStream) return { stage: 'positioning', guide: 'stream_slow', progress: 0, countdown: null };
    if (this.stage === 'positioning') {
      this.holdMs += interval;
      if (this.holdMs < LIVE_SETUP_POLICY.holdMs || this.frames < LIVE_SETUP_POLICY.minFrames)
        return { stage: this.stage, guide: 'hold', progress: Math.min(1, this.holdMs / LIVE_SETUP_POLICY.holdMs), countdown: null };
      this.stage = 'countdown';
    } else this.countdownMs += interval;
    if (this.countdownMs >= LIVE_SETUP_POLICY.countdownMs) {
      this.stage = 'active'; return { stage: this.stage, guide: 'start', progress: 1, countdown: null };
    }
    return { stage: 'countdown', guide: 'countdown', progress: this.countdownMs / LIVE_SETUP_POLICY.countdownMs,
      countdown: Math.ceil((LIVE_SETUP_POLICY.countdownMs - this.countdownMs) / 1000) };
  }
  private issue(value: CameraPoseObservation): LiveSetupGuide | null {
    if (![value.width, value.height].every(n => Number.isFinite(n) && n > 0)) return 'stream_waiting';
    const processing = value.processingMs ?? 0;
    if (!Number.isFinite(processing) || processing < 0 || processing > 500) return 'processing_slow';
    if (value.frame.people.length === 0) return 'find_person';
    if (value.frame.people.length > 1) return 'multiple_people';
    const person = value.frame.people[0]!, p = person.landmarks;
    const groups: [LiveSetupGuide, number[]][] = [ ['show_shoulders', [11,12]], ['show_hips', [23,24]],
      ['show_knees', [this.side === 'left' ? 25 : 26]], ['show_ankles', [this.side === 'left' ? 27 : 28]] ];
    for (const [message, indices] of groups) {
      if (indices.some(i => p[i] && p[i]!.visibility >= MIN_LANDMARK_VISIBILITY && p[i]!.visibility <= 1 && [p[i]!.x, p[i]!.y].every(Number.isFinite)
        && (p[i]!.x < 0.02 || p[i]!.x > 0.98 || p[i]!.y < 0.02 || p[i]!.y > 0.98))) return 'step_back';
      if (!indices.every(i => isVisible(p[i]))) return message;
    }
    if (sideViewEvidence(person, value.width, value.height) !== 'supported') return 'turn_sideways';
    const angles = imageAngles(person, value.width, value.height), knee = angles[`${this.side}Knee`], hip = angles[`${this.side}Hip`];
    if (knee === null || hip === null || knee < LIVE_SQUAT_POLICY.standingThreshold || hip < 145) return 'stand_still';
    const shoulder = p[this.side === 'left' ? 11 : 12]!, ankle = p[this.side === 'left' ? 27 : 28]!;
    if (Math.abs(ankle.y - shoulder.y) < 0.25) return 'step_closer';
    return null;
  }
}

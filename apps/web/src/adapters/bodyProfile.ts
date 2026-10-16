import type { BodyProfileRepository } from '@flexivision/application';
import type { CalibrationProfile, SavedBodyProfile } from '@flexivision/contracts';
import { isBodyProfile } from '@flexivision/core';

export const BODY_PROFILE_KEY = 'flexivision.body-profile.v2';
type ProfileStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export class BrowserBodyProfileRepository implements BodyProfileRepository {
  constructor(private readonly storage: () => ProfileStorage = () => window.localStorage,
    private readonly now: () => Date = () => new Date(), private readonly key = BODY_PROFILE_KEY) {}
  async load(): Promise<SavedBodyProfile | null> {
    const raw = this.storage().getItem(this.key);
    if (!raw || raw.length > 16000) return null;
    try {
      const record = JSON.parse(raw) as Partial<SavedBodyProfile>;
      if (record?.schemaVersion !== 1 || typeof record.savedAt !== 'string'
        || !Number.isFinite(Date.parse(record.savedAt)) || !isBodyProfile(record.profile)) return null;
      return { schemaVersion: 1, savedAt: record.savedAt, profile: record.profile };
    } catch { return null; }
  }
  async save(profile: CalibrationProfile): Promise<SavedBodyProfile> {
    if (!isBodyProfile(profile)) throw new Error('Vücut profili geçerli ölçümler içermiyor.');
    // Explicitly select fields: never persist arbitrary attached landmarks or raw data.
    const record: SavedBodyProfile = { schemaVersion: 1, savedAt: this.now().toISOString(),
      profile: { schemaVersion: 2, kind: 'body-calibration', qualification: 'not_evaluated', policyVersion: 'body-scan-v2',
        width: profile.width, height: profile.height, torsoPixels: profile.torsoPixels,
        origin: { x: profile.origin.x, y: profile.origin.y },
        proportions: { shoulderWidth: profile.proportions.shoulderWidth, hipWidth: profile.proportions.hipWidth,
          leftThigh: profile.proportions.leftThigh, rightThigh: profile.proportions.rightThigh,
          leftShin: profile.proportions.leftShin, rightShin: profile.proportions.rightShin },
        neutralAngles: { leftKnee: profile.neutralAngles.leftKnee, rightKnee: profile.neutralAngles.rightKnee,
          leftHip: profile.neutralAngles.leftHip, rightHip: profile.neutralAngles.rightHip,
          leftElbow: profile.neutralAngles.leftElbow, rightElbow: profile.neutralAngles.rightElbow } } };
    this.storage().setItem(this.key, JSON.stringify(record));
    return record;
  }
  async clear() { this.storage().removeItem(this.key); }
}

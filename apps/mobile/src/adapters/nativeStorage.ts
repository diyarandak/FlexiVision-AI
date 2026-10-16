import type { BodyProfileRepository } from '@flexivision/application';
import type { CalibrationProfile, SavedBodyProfile } from '@flexivision/contracts';
import { isBodyProfile } from '@flexivision/core';

export const MOBILE_BODY_PROFILE_KEY = 'flexivision.mobile.body-profile.v2';

export interface NativeStorageDriver {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

/**
 * Mobile native storage adapter for body calibration profile.
 * Compatible with React Native AsyncStorage / Expo SecureStore.
 * Enforces schema validation and clean serialization.
 */
export class NativeBodyProfileRepository implements BodyProfileRepository {
  constructor(
    private readonly driver: NativeStorageDriver,
    private readonly now: () => Date = () => new Date(),
    private readonly key = MOBILE_BODY_PROFILE_KEY
  ) {}

  async load(): Promise<SavedBodyProfile | null> {
    // A storage/permission failure is not evidence that no profile exists.
    const raw = await this.driver.getItem(this.key);
    try {
      if (!raw || raw.length > 16000) return null;

      const record = JSON.parse(raw) as Partial<SavedBodyProfile>;
      if (
        record?.schemaVersion !== 1 ||
        typeof record.savedAt !== 'string' ||
        !Number.isFinite(Date.parse(record.savedAt)) ||
        !isBodyProfile(record.profile)
      ) {
        return null;
      }

      return {
        schemaVersion: 1,
        savedAt: record.savedAt,
        profile: record.profile,
      };
    } catch {
      return null;
    }
  }

  async save(profile: CalibrationProfile): Promise<SavedBodyProfile> {
    if (!isBodyProfile(profile)) {
      throw new Error('Vücut profili geçerli ölçümler içermiyor.');
    }

    const record: SavedBodyProfile = {
      schemaVersion: 1,
      savedAt: this.now().toISOString(),
      profile: {
        schemaVersion: 2,
        kind: 'body-calibration',
        qualification: 'not_evaluated',
        policyVersion: 'body-scan-v2',
        width: profile.width,
        height: profile.height,
        torsoPixels: profile.torsoPixels,
        origin: { x: profile.origin.x, y: profile.origin.y },
        proportions: {
          shoulderWidth: profile.proportions.shoulderWidth,
          hipWidth: profile.proportions.hipWidth,
          leftThigh: profile.proportions.leftThigh,
          rightThigh: profile.proportions.rightThigh,
          leftShin: profile.proportions.leftShin,
          rightShin: profile.proportions.rightShin,
        },
        neutralAngles: {
          leftKnee: profile.neutralAngles.leftKnee,
          rightKnee: profile.neutralAngles.rightKnee,
          leftHip: profile.neutralAngles.leftHip,
          rightHip: profile.neutralAngles.rightHip,
          leftElbow: profile.neutralAngles.leftElbow,
          rightElbow: profile.neutralAngles.rightElbow,
        },
      },
    };

    await this.driver.setItem(this.key, JSON.stringify(record));
    return record;
  }

  async clear(): Promise<void> {
    await this.driver.removeItem(this.key);
  }
}

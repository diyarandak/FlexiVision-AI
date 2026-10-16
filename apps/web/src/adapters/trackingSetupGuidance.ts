import { CalibrationVoicePolicy } from '@flexivision/core';

interface SetupSpeech {
  setup(text: string): void;
  clearSetup(): void;
}

/** Placement recovery remains available after exercise start; it is not a form correction. */
export function trackingSetupGuidance(speech: SetupSpeech, startedAt: number) {
  const policy = new CalibrationVoicePolicy();
  policy.begin(startedAt);
  let spokenKey: string | null = null;
  return {
    update(reason: string | null, text: string, now: number, repeat = true) {
      const key = reason === null ? null : `${reason}:${text}`;
      if (key === null || (spokenKey !== null && key !== spokenKey)) {
        speech.clearSetup();
        spokenKey = null;
      }
      if (policy.next(key, now, repeat)) {
        spokenKey = key;
        speech.setup(text);
      }
    },
    announce(text: string, now: number) {
      policy.begin(now);
      spokenKey = null;
      speech.setup(text);
    },
  };
}

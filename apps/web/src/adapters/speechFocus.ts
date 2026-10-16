import type { SpeechOutput } from '@flexivision/application';

/** Mark coach output so recognition ignores its echo without cycling the microphone. */
export function speechWithInputPause(speech: SpeechOutput, pauseInput: (active: boolean) => void): SpeechOutput {
  let generation = 0;
  return {
    get available() { return speech.available; },
    speak(text, onStarted) {
      const token = ++generation;
      pauseInput(true);
      try {
        const result = speech.speak(text, onStarted);
        const done = () => { if (token === generation) pauseInput(false); };
        if (result === undefined) { done(); return; }
        return Promise.resolve(result).finally(done);
      } catch (error) { if (token === generation) pauseInput(false); throw error; }
    },
    cancel() {
      generation++;
      try { speech.cancel(); } finally { pauseInput(false); }
    },
  };
}

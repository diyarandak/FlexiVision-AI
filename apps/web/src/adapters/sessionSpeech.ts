import type { SpeechOutput } from '@flexivision/application';

/** Tracking uncertainty cancels correction speech without cutting off setup guidance. */
export function sessionSpeech(speech: SpeechOutput, enabled: () => boolean, failed: () => void) {
  let owner: 'ready' | 'setup' | 'milestone' | 'coach' | 'answer' | 'count' | 'correction' | null = null;
  let generation = 0;
  let setupPending = false;
  let pending = false;
  let audible = false;
  let spokenCoachKey: string | null = null;
  let coachRetryAt = 0;
  function say(text: string, kind: NonNullable<typeof owner>, onStarted?: () => void) {
    if (!enabled() || !speech.available) return;
    const token = ++generation;
    owner = kind;
    audible = false;
    const reportFailure = () => { if (generation === token && owner === kind) { pending = false; setupPending = false; failed(); } };
    const receipt = () => { if (generation === token && owner === kind && enabled()) { audible = true; onStarted?.(); } };
    try {
      const completed = speech.speak(text, receipt);
      pending = completed !== undefined;
      setupPending = kind !== 'correction' && completed !== undefined;
      const settled = Promise.resolve(completed).then(() => {
        if (generation === token && owner === kind) { pending = false; setupPending = false; }
      }, reportFailure);
      return completed === undefined ? undefined : settled;
    } catch { reportFailure(); }
  }
  function cancelOwned(kind: 'setup' | 'coach' | 'answer' | 'correction') {
    if (owner !== kind) return;
    owner = null; generation++; setupPending = false; pending = false;
    try { speech.cancel(); } catch { failed(); }
  }
  return {
    ready(text: string, onStarted?: () => void) {
      if (!enabled() || !speech.available) return;
      owner = null; generation++; setupPending = false; pending = false;
      try { speech.cancel(); } catch { /* Still announce actual readiness. */ }
      say(text, 'ready', onStarted);
    },
    setup(text: string, onStarted?: () => void) {
      if (!enabled() || !speech.available) return;
      if ((owner === 'ready' || owner === 'answer' || owner === 'count') && pending) return;
      owner = null; generation++; setupPending = false; pending = false;
      try { speech.cancel(); } catch { /* A broken cancel must not block a new current guide. */ }
      say(text, 'setup', onStarted);
    },
    /** A measured start cue is setup audio, but routine correct frames must not cut it off. */
    milestone(text: string, onStarted?: () => void) {
      if (!enabled() || !speech.available) return;
      owner = null; generation++; setupPending = false; pending = false;
      try { speech.cancel(); } catch { /* Keep the current measured transition visible. */ }
      say(text, 'milestone', onStarted);
    },
    /** A recovered measurement retires a stale guide, never a current correction. */
    clearSetup() { cancelOwned('setup'); },
    /** Offer only the instruction valid on this frame. Busy offers are dropped, never queued. */
    coach(key: string, text: string, onStarted?: () => void) {
      if (pending || spokenCoachKey === key || Date.now() < coachRetryAt || !enabled() || !speech.available) return;
      coachRetryAt = Date.now() + 4000;
      say(text, 'coach', () => { spokenCoachKey = key; coachRetryAt = 0; onStarted?.(); });
    },
    clearCoach(finishAudible = false) {
      if (finishAudible && owner === 'coach' && audible && pending) return;
      spokenCoachKey = null; coachRetryAt = 0; cancelOwned('coach');
    },
    /** A direct user question supersedes the previous instruction, with no response backlog. */
    answer(text: string, onStarted?: () => void) {
      if (!enabled() || !speech.available) return;
      owner = null; generation++; setupPending = false; pending = false;
      try { speech.cancel(); } catch { /* Still try this current requested answer. */ }
      say(text, 'answer', onStarted);
    },
    clearAnswer() { cancelOwned('answer'); },
    /** A newly measured repetition is spoken once, immediately; old counts never queue. */
    count(text: string, onStarted?: () => void) {
      if (!enabled() || !speech.available) return;
      owner = null; generation++; setupPending = false; pending = false;
      try { speech.cancel(); } catch { /* Still announce the newly measured count. */ }
      say(text, 'count', onStarted);
    },
    output: {
      get available() { return enabled() && speech.available && !pending; },
      speak(text: string, onStarted?: () => void) {
        // A skipped correction must not steal a pending guide's ownership.
        // It is dropped, so a later fresh observation decides whether to speak.
        if ((owner === 'ready' || owner === 'setup' || owner === 'milestone' || owner === 'coach' || owner === 'answer' || owner === 'count') && setupPending) return;
        return say(text, 'correction', onStarted);
      },
      cancel() { cancelOwned('correction'); },
    } satisfies SpeechOutput,
  };
}

import type { SpeechOutput } from '@flexivision/application';

// One browser engine is shared by setup, exercise and sound checks. Only the
// active owner can stop it; completed ownership must not block the next session.
let activeSpeech: { release: () => void } | null = null;
let managedEngine = false;

export type BrowserSpeechFailure = 'start_timeout' | 'end_timeout' | 'synthesis_failed'
  | 'audio_busy' | 'audio_hardware' | 'network' | 'not_allowed' | 'interrupted';

function speechFailure(error: string | undefined): BrowserSpeechFailure {
  switch (error) {
    case 'audio-busy': return 'audio_busy';
    case 'audio-hardware': return 'audio_hardware';
    case 'network': return 'network';
    case 'not-allowed': return 'not_allowed';
    case 'canceled': case 'interrupted': return 'interrupted';
    default: return 'synthesis_failed';
  }
}

/** Call after the user starts a session. Browsers may require user activation for audio. */
export function createBrowserSpeech(options: { replace?: boolean; onError?: (reason: BrowserSpeechFailure) => void } = {}): SpeechOutput {
  const available = typeof window !== 'undefined' && 'speechSynthesis' in window;
  let current: SpeechSynthesisUtterance | null = null;
  let settleCurrent: (() => void) | null = null;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  let endTimer: ReturnType<typeof setTimeout> | undefined;
  let ownership: typeof activeSpeech = null;
  function cancel() {
    const hadUtterance = current !== null;
    clearTimeout(startTimer); startTimer = undefined;
    clearTimeout(endTimer); endTimer = undefined;
    if (current) { current.onstart = null; current.onerror = null; current.onend = null; current = null; }
    const settle = settleCurrent; settleCurrent = null; settle?.();
    if (ownership && activeSpeech === ownership) activeSpeech = null;
    ownership = null;
    if (available && !activeSpeech && (hadUtterance || window.speechSynthesis.speaking || window.speechSynthesis.pending))
      window.speechSynthesis.cancel();
  }
  return {
    available,
    speak(text, onStarted) {
      if (!available || document.hidden || ((activeSpeech || (!managedEngine && (window.speechSynthesis.speaking || window.speechSynthesis.pending))) && !options.replace)) return;
      if (options.replace) activeSpeech?.release();
      cancel();
      managedEngine = true;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'tr-TR';
      const voices = window.speechSynthesis.getVoices?.() ?? [];
      const turkish = voices.filter(voice => /^tr(?:-|$)/i.test(voice.lang));
      const voice = turkish.find(item => item.localService) ?? turkish[0];
      if (voice) utterance.voice = voice;
      utterance.rate = .95;
      let started = false;
      const completed = new Promise<void>(resolve => { settleCurrent = resolve; });
      const release = () => {
        clearTimeout(startTimer); startTimer = undefined;
        clearTimeout(endTimer); endTimer = undefined;
        utterance.onstart = null; utterance.onerror = null; utterance.onend = null; current = null;
        const settle = settleCurrent; settleCurrent = null; settle?.();
        if (activeSpeech === ownership) activeSpeech = null;
        ownership = null;
      };
      utterance.onstart = () => { if (current === utterance && !started) {
        started = true; clearTimeout(startTimer); startTimer = undefined;
        // Android engines can omit onend. Bound ownership so later fresh cues
        // can recover instead of leaving speech permanently busy.
        endTimer = setTimeout(() => {
          if (current !== utterance) return;
          // Some engines finish playback but omit onend. Their idle state is
          // sufficient to release ownership, but not evidence of an audio fault.
          if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) { release(); return; }
          try { cancel(); } catch { /* Engine recovery failed; report without crashing tracking. */ }
          options.onError?.('end_timeout');
        }, Math.min(20000, Math.max(8000, text.length * 120)));
        onStarted?.();
      } };
      utterance.onerror = event => { if (current === utterance) { release(); options.onError?.(speechFailure(event?.error)); } };
      utterance.onend = () => { if (current === utterance) release(); };
      current = utterance;
      ownership = { release }; activeSpeech = ownership;
      startTimer = setTimeout(() => {
        if (current !== utterance) return;
        try { cancel(); } catch { /* Cleanup must not escape the timer. */ }
        options.onError?.('start_timeout');
      }, 4000);
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        window.speechSynthesis.speak(utterance);
      } catch {
        try { cancel(); } catch { /* Report the original speech failure. */ }
        options.onError?.('synthesis_failed');
      }
      return completed;
    },
    cancel,
  };
}

import { parseVoiceCommand, type VoiceCommand } from '@flexivision/core';

export interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
export interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; abort(): void;
}
export type VoiceCommandStatus = 'off' | 'starting' | 'listening' | 'speaking' | 'error';
type Factory = () => Recognition;
function browserFactory(): Factory | null {
  if (typeof window === 'undefined') return null;
  const browser = window as Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
  return Constructor ? () => new Constructor() : null;
}

/** Explicit opt-in only. No recording, stored transcripts, or queued commands. */
export class BrowserVoiceCommands {
  readonly available: boolean;
  private current: Recognition | null = null;
  private wanted = false;
  private outputActive = false;
  private startWatchdog: ReturnType<typeof setTimeout> | undefined;
  private restart: ReturnType<typeof setTimeout> | undefined;
  private echoUntil = -Infinity;
  private lastCommand: VoiceCommand | null = null;
  private lastAt = -Infinity;
  constructor(private readonly onCommand: (command: VoiceCommand) => void,
    private readonly onState: (status: VoiceCommandStatus, message?: string) => void,
    private readonly factory: Factory | null = browserFactory(),
    private readonly speaking = () => !!(window.speechSynthesis?.speaking || window.speechSynthesis?.pending),
    private readonly hidden = () => document.hidden,
    private readonly now = () => performance.now()) { this.available = factory !== null; }

  start() {
    this.stop();
    if (!this.factory) { this.onState('error', 'Bu tarayıcı sesli komutları desteklemiyor. Ekrandaki düğmeleri kullanabilirsin.'); return; }
    if (this.hidden()) return;
    this.wanted = true; this.lastCommand = null; this.lastAt = -Infinity;
    this.connect();
  }
  stop() {
    this.wanted = false; this.disconnect(); this.onState('off');
  }
  private disconnect() {
    clearTimeout(this.startWatchdog); this.startWatchdog = undefined; clearTimeout(this.restart); this.restart = undefined;
    const current = this.current; this.current = null;
    if (current) {
      current.onstart = null; current.onresult = null; current.onerror = null; current.onend = null;
      try { current.abort(); } catch { /* Release intent even when the browser already ended. */ }
    }
  }
  /** Ignore coach audio without cycling Android's microphone (which plays a system tone). */
  setOutputActive(active: boolean) {
    if (this.outputActive === active) return;
    this.outputActive = active;
    if (!active) this.echoUntil = this.now() + 800;
    if (!this.wanted) return;
    if (active) {
      clearTimeout(this.restart); this.restart = undefined;
      this.onState('speaking');
    } else if (this.current) this.onState('listening');
    else {
      this.onState('starting');
      this.restart = setTimeout(() => { this.restart = undefined; this.connect(); }, 300);
    }
  }
  private fail(message: string) { this.stop(); this.onState('error', message); }
  private connect() {
    if (!this.wanted || this.hidden()) { this.stop(); return; }
    if (this.outputActive) { this.onState('speaking'); return; }
    try {
      const recognition = this.factory!(); this.current = recognition;
      const handled = new Set<number>();
      recognition.lang = 'tr-TR'; recognition.continuous = true;
      recognition.interimResults = false; recognition.maxAlternatives = 1;
      const current = () => this.wanted && this.current === recognition;
      recognition.onstart = () => { if (current()) { clearTimeout(this.startWatchdog); this.startWatchdog = undefined; this.onState(this.outputActive ? 'speaking' : 'listening'); } };
      recognition.onresult = event => {
        if (!current()) return;
        let latest: string | null = null;
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const result = event.results[index];
          if (!result?.isFinal || handled.has(index)) continue;
          handled.add(index); latest = result[0].transcript;
        }
        if (latest === null || this.hidden() || this.outputActive || this.speaking() || this.now() < this.echoUntil) return;
        const command = parseVoiceCommand(latest), at = this.now();
        if (!command || (command === this.lastCommand && at - this.lastAt < 1500)) return;
        this.lastCommand = command; this.lastAt = at; this.onCommand(command);
      };
      recognition.onerror = event => {
        if (!current() || event.error === 'no-speech') return;
        this.fail(event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Mikrofon izni verilmedi. İzin ayarlarını kontrol edip yeniden açabilirsin.'
          : event.error === 'network' ? 'Sesli komut bağlantısı kesildi. İnternetini kontrol edip yeniden aç.'
          : 'Sesli komut kullanılamıyor. Mikrofonunu ve tarayıcı desteğini kontrol et.');
      };
      recognition.onend = () => {
        if (!current()) return;
        clearTimeout(this.startWatchdog); this.startWatchdog = undefined;
        this.current = null;
        // Some Android services end after every silence. Automatic reconnection
        // produces recurring system beeps even when nobody is speaking.
        this.fail('Sesli soru dinlemesi sona erdi. Koçun yönlendirmeleri sürüyor; soru sormak için mikrofonu yeniden aç.');
      };
      this.onState('starting');
      this.startWatchdog = setTimeout(() => {
        if (current()) this.fail('Mikrofon bağlantısı kurulamadı. Tarayıcıdaki izin durumunu kontrol edip yeniden aç.');
      }, 15000);
      recognition.start();
    } catch { this.fail('Mikrofon başlatılamadı. Sesli kontrolü düğmeden yeniden aç.'); }
  }
}

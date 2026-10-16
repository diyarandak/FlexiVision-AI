import type { SpeechOutput } from '@flexivision/application';

export interface NativeTtsDriver {
  isSpeaking(): Promise<boolean> | boolean;
  speak(text: string, options?: { language?: string; onStart?: () => void }): void | Promise<void>;
  stop(): void | Promise<void>;
}

export interface NativeSpeechOptions {
  language?: string;
  onError?: (error: Error) => void;
}

/**
 * Mobile native SpeechOutput adapter adhering to Clean Architecture.
 * Complies with the 10-second exercise speech rule:
 * - Never queues speech if the driver is currently speaking (replace: false).
 * - Cancels immediately on demand.
 */
export class NativeSpeechAdapter implements SpeechOutput {
  private speakingInternal = false;
  private generation = 0;

  constructor(
    private readonly driver: NativeTtsDriver,
    private readonly options: NativeSpeechOptions = { language: 'tr-TR' }
  ) {}

  get available(): boolean {
    return true;
  }

  async speak(text: string, onStarted?: () => void): Promise<void> {
    if (!text || !text.trim()) return;
    const generation = this.generation;

    try {
      const busy = await this.driver.isSpeaking();
      if (generation !== this.generation || busy || this.speakingInternal) {
        // Obey product rule: do not queue voice warnings. Skip if speaking.
        return;
      }

      this.speakingInternal = true;
      await this.driver.speak(text, { language: this.options.language ?? 'tr-TR',
        onStart: () => { if (generation === this.generation) onStarted?.(); } });
    } catch (err) {
      if (generation === this.generation) this.speakingInternal = false;
      this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (generation === this.generation) this.speakingInternal = false;
    }
  }

  cancel(): void {
    this.generation++;
    this.speakingInternal = false;
    try {
      const stopped = this.driver.stop();
      if (stopped) void stopped.catch(err => this.options.onError?.(err instanceof Error ? err : new Error(String(err))));
    } catch (err) {
      this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

import type { LivePoseSource } from '@flexivision/application';
import type { CameraPoseObservation } from '@flexivision/contracts';

export interface NativeCameraDriver {
  requestPermission(): Promise<boolean>;
  start(onFrame: (observation: CameraPoseObservation) => void,
    onCaptureStarted?: (timestampMs: number) => void): Promise<void>;
  stop(): Promise<void> | void;
}

/**
 * Mobile native LivePoseSource adapter for React Native / Expo.
 * Connects native camera & on-device pose estimation to the shared Clean Architecture pipeline.
 * Guards against non-monotonic timestamps, late frame delivery after stop, and camera permission rejections.
 */
export class NativeCameraPose implements LivePoseSource {
  private stopped = false;
  private previousTimestampMs = -1;

  constructor(
    private readonly driver: NativeCameraDriver
  ) {}

  async start(
    onObservation: (observation: CameraPoseObservation) => void,
    onError: (error: Error) => void,
    onCaptureStarted?: (timestampMs: number) => void
  ): Promise<void> {
    if (this.stopped) return;

    try {
      const granted = await this.driver.requestPermission();
      if (this.stopped) return;
      if (!granted) {
        throw new Error('Kamera izni verilmedi. Canlı egzersiz için kamera erişimi gereklidir.');
      }

      await this.driver.start((observation: CameraPoseObservation) => {
        if (this.stopped) return;

        // Ensure monotonic timestamps
        const ts = observation.frame.timestampMs;
        if (!Number.isFinite(ts) || ts < 0 || ts <= this.previousTimestampMs) {
          return;
        }
        this.previousTimestampMs = ts;

        onObservation(observation);
      }, timestampMs => { if (!this.stopped) onCaptureStarted?.(timestampMs); });
    } catch (err) {
      if (!this.stopped) {
        this.stop();
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  stop(): void {
    this.stopped = true;
    try {
      const stopped = this.driver.stop();
      if (stopped) void stopped.catch(() => {});
    } catch {
      // Clean teardown ignores errors during driver release
    }
  }
}

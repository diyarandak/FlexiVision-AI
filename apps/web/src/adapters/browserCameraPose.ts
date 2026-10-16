import type { LivePoseSource } from '@flexivision/application';
import type { CameraPoseObservation, PoseFrame } from '@flexivision/contracts';
import type { ModelStartupStage } from '../workers/protocol.ts';
import { AnalysisCancelled, PoseWorkerClient } from './poseWorkerClient.ts';

interface CameraDetector { initialize(onProgress?: (stage: ModelStartupStage) => void): Promise<void>; detect(bitmap: ImageBitmap, timestampMs: number): Promise<PoseFrame>; cancel(): void }
export interface CameraDependencies {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createDetector(): CameraDetector;
  bitmap(video: HTMLVideoElement, maxDimension: number): Promise<ImageBitmap>;
  videoReady(video: HTMLVideoElement, signal: AbortSignal): Promise<void>;
  now(): number;
  schedule(callback: () => void): ReturnType<typeof setTimeout>;
  unschedule(id: ReturnType<typeof setTimeout>): void;
}

export interface CameraOptions { facingMode: 'user' | 'environment'; maxDimension: 480 | 640; deviceId?: string; portrait?: boolean }
export type CameraStartupStage = 'permission' | 'video' | 'model' | 'detecting' | 'tracking' | ModelStartupStage;
export const CAMERA_STARTUP_MESSAGES: Record<CameraStartupStage, string> = {
  permission: 'Kamera izni bekleniyor. İzin penceresini onayla.',
  video: 'Kamera görüntüsü hazırlanıyor. Telefonu sabit tut.',
  model: 'Hareket algılama yükleniyor. Hazır olduğunda haber vereceğim.',
  loading_library: 'Analiz dosyaları yükleniyor. İnternet bağlantısı gerekiyor.',
  loading_model: 'Hareket modeli indiriliyor. İlk açılış biraz sürebilir.',
  starting_engine: 'Hareket motoru açılıyor. Henüz ölçüm başlamadı.',
  detecting: 'İlk ölçüm bekleniyor. Başın ve ayakların kamerada görünsün.',
  tracking: 'Kamera ölçümü başladı.',
};
export const DEFAULT_CAMERA_OPTIONS: CameraOptions = { facingMode: 'user', maxDimension: 640 };
export function preferredCameraOptions(portrait = typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches): CameraOptions {
  return { ...DEFAULT_CAMERA_OPTIONS, portrait };
}
export function cameraConstraints(options: CameraOptions, nativeFormat = true): MediaStreamConstraints {
  const identity = options.deviceId ? { deviceId: { exact: options.deviceId } }
    : { facingMode: options.facingMode === 'environment' ? { exact: 'environment' } : { ideal: 'user' } };
  if (!options.portrait) return { audio: false, video: { ...identity, width: { ideal: 640 }, height: { ideal: 480 } } };
  // Constraints use the camera's primary (usually landscape) orientation, even
  // when the browser delivers upright portrait frames. Inverse 9:16 constraints
  // can select a cropped sensor mode and produce the opposite shape on Android.
  // https://www.w3.org/TR/mediacapture-streams/#constrainable-properties
  return { audio: false, video: { ...identity, ...(nativeFormat
    ? { width: { ideal: 1280 }, height: { ideal: 960 }, aspectRatio: { ideal: 4 / 3 }, resizeMode: { exact: 'none' } }
    // A driver may reject native-format control. Drop size/ratio preferences so
    // the fallback cannot recreate the old forced 9:16 sensor crop.
    : { resizeMode: { ideal: 'none' } }) } };
}
export function cameraCaptureSize(width: number, height: number, maxDimension: number) {
  if (![width, height, maxDimension].every(n => Number.isFinite(n) && n > 0)) throw new Error('Geçersiz kamera görüntü boyutu.');
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return { resizeWidth: Math.max(1, Math.round(width * scale)), resizeHeight: Math.max(1, Math.round(height * scale)) };
}

function videoReady(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer); video.removeEventListener('loadeddata', ready);
      video.removeEventListener('error', failed); signal.removeEventListener('abort', cancelled);
      if (error) reject(error); else resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error('Kamera görüntüsü okunamadı. Kamerayı yeniden aç.'));
    const cancelled = () => finish(new AnalysisCancelled());
    const timer = setTimeout(() => finish(new Error('Kameradan görüntü alınamadı. Kamerayı kullanan diğer uygulamaları kapat.')), 15000);
    video.addEventListener('loadeddata', ready, { once: true }); video.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', cancelled, { once: true });
    if (signal.aborted) cancelled(); else if (video.readyState >= 2) ready();
  });
}

/** A live camera can deliver advancing frames while its play() promise stays
 * pending. Accept that observable playback, and bound a genuinely stalled start. */
async function waitForPlayback(video: HTMLVideoElement, ready: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new AnalysisCancelled();
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new AnalysisCancelled());
    signal.addEventListener('abort', abort, { once: true });
  });
  let poll: ReturnType<typeof setInterval> | undefined, timeout: ReturnType<typeof setTimeout> | undefined;
  const firstTime = video.currentTime;
  const observedPlayback = new Promise<void>((resolve, reject) => {
    poll = setInterval(() => {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0
        && !video.paused && Number.isFinite(video.currentTime) && video.currentTime > firstTime) resolve();
    }, 100);
    timeout = setTimeout(() => reject(new Error('Kamera görüntüsü ilerlemedi. Kamerayı yeniden aç.')), 12000);
  });
  try {
    const playback = Promise.resolve().then(() => {
      if (signal.aborted) throw new AnalysisCancelled();
      return video.play();
    });
    await Promise.race([Promise.all([ready, playback]), observedPlayback, cancelled]);
  } finally {
    clearInterval(poll); clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}

const MAX_UNAVAILABLE_FRAMES = 20;
function temporarilyUnavailable(error: unknown): boolean {
  return error instanceof Error && error.name === 'InvalidStateError';
}
export const browserCameraDependencies: CameraDependencies = {
  getUserMedia: constraints => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Kamera erişimi için localhost veya HTTPS ve güncel bir tarayıcı gerekiyor.');
    return navigator.mediaDevices.getUserMedia(constraints);
  },
  createDetector: () => new PoseWorkerClient(),
  bitmap: (video, maxDimension) => createImageBitmap(video, cameraCaptureSize(video.videoWidth, video.videoHeight, maxDimension)),
  videoReady, now: () => performance.now(), schedule: callback => setTimeout(callback, 100),
  // Keep native timer calls unbound: the dependency object is not a Window.
  unschedule: id => clearTimeout(id),
};

function cameraError(error: unknown): Error {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return new Error('Kamera izni verilmedi. Tarayıcıdaki kamera iznini açıp yeniden dene.');
  if (name === 'NotFoundError') return new Error('Kamera bulunamadı. Bir kamera bağlayıp yeniden dene.');
  if (name === 'NotReadableError') return new Error('Kamera açılamadı. Kamerayı kullanan diğer uygulamaları kapatıp yeniden dene.');
  if (name === 'OverconstrainedError') return new Error('Seçilen kamera kullanılamıyor. Ön kamerayı seçip yeniden dene.');
  return error instanceof Error ? error : new Error('Kamera başlatılamadı. Yeniden dene.');
}

type CleanupStage = 'abort' | 'timer' | 'listener' | 'track' | 'detector' | 'playback' | 'video-source';
export class CameraCleanupError extends Error {
  constructor(readonly stages: readonly CleanupStage[]) {
    super(`Kamera kapatma adımları başarısız: ${stages.join(', ')}`);
    this.name = 'CameraCleanupError';
  }
}
export function cameraCleanupMessage(error: unknown): string {
  if (!(error instanceof CameraCleanupError)) return 'Kamera kapatılırken sorun oldu. Kamera göstergesi açık kalırsa sayfayı yenile.';
  if (error.stages.includes('track')) return 'Kamera izi kapatılırken hata oluştu. Kamera göstergesi açık kalırsa sayfayı yenile.';
  const labels: Record<CleanupStage, string> = {
    abort: 'iptal', timer: 'zamanlayıcı', listener: 'olay dinleyicisi', track: 'kamera izi',
    detector: 'poz modeli', playback: 'video oynatma', 'video-source': 'video bağlantısı',
  };
  return `Kamera izleri durduruldu; ${error.stages.map(stage => labels[stage]).join(', ')} temizliğinde hata oluştu.`;
}

/** Fresh detector per session, monotonically timed capture, no queued frames or microphone. */
export class BrowserCameraPose implements LivePoseSource {
  private controller = new AbortController();
  private stream: MediaStream | null = null;
  private detector: CameraDetector | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private endedListeners: (() => void)[] = [];
  constructor(private readonly video: HTMLVideoElement, private readonly deps: CameraDependencies = browserCameraDependencies,
    private readonly options: CameraOptions = DEFAULT_CAMERA_OPTIONS,
    private readonly onStartup?: (stage: CameraStartupStage) => void) {}

  stop() {
    const failures: CleanupStage[] = [];
    const release = (stage: CleanupStage, operation: () => void) => { try { operation(); } catch { failures.push(stage); } };
    release('abort', () => this.controller.abort());
    const timer = this.timer; this.timer = null;
    if (timer !== null) release('timer', () => this.deps.unschedule(timer));
    const listeners = this.endedListeners; this.endedListeners = [];
    listeners.forEach(remove => release('listener', remove));
    const stream = this.stream, detector = this.detector; this.stream = null; this.detector = null;
    release('track', () => stream?.getTracks().forEach(track => release('track', () => track.stop())));
    release('detector', () => detector?.cancel());
    release('playback', () => this.video.pause()); release('video-source', () => { this.video.srcObject = null; });
    if (failures.length) throw new CameraCleanupError([...new Set(failures)]);
  }
  async start(onObservation: (observation: CameraPoseObservation) => void, onError: (error: Error) => void,
    onCaptureStarted?: (timestampMs: number) => void) {
    if (this.started || this.controller.signal.aborted) return;
    this.started = true;
    const signal = this.controller.signal;
    const fail = (error: unknown) => { if (!signal.aborted) { try { this.stop(); } catch { /* Report the original technical failure after all cleanup attempts. */ } onError(cameraError(error)); } };
    try {
      this.onStartup?.('permission');
      // Permission may resolve after unmount or stop. Always release that late stream.
      let stream: MediaStream;
      try { stream = await this.deps.getUserMedia(cameraConstraints(this.options)); }
      catch (error) {
        // Older cameras can reject native-format control: retry once without
        // size/aspect constraints, preserving the chosen lens and no-crop preference.
        const constraint = (error as { constraint?: string })?.constraint;
        if (signal.aborted || !this.options.portrait || !(error instanceof Error)
          || error.name !== 'OverconstrainedError'
          || !['aspectRatio', 'width', 'height', 'resizeMode'].includes(constraint ?? '')) throw error;
        stream = await this.deps.getUserMedia(cameraConstraints(this.options, false));
      }
      if (signal.aborted) {
        for (const track of stream.getTracks()) {
          try { track.stop(); } catch { /* Still stop the other tracks. The panel has already closed. */ }
        }
        return;
      }
      this.stream = stream;
      this.onStartup?.('video');
      for (const track of stream.getTracks()) {
        const ended = () => fail(new Error('Kamera bağlantısı kesildi. Kamerayı yeniden aç.'));
        track.addEventListener('ended', ended);
        this.endedListeners.push(() => track.removeEventListener('ended', ended));
      }
      this.video.muted = true; this.video.playsInline = true;
      const ready = this.deps.videoReady(this.video, signal);
      this.video.srcObject = stream;
      await waitForPlayback(this.video, ready, signal);
      if (signal.aborted) return;
      this.onStartup?.('model');
      const detector = this.deps.createDetector(); this.detector = detector;
      await detector.initialize(stage => { if (!signal.aborted) this.onStartup?.(stage); });
      if (signal.aborted) return;
      this.onStartup?.('detecting');
      let firstFrame = true;
      let previousTimestamp = -1;
      let unavailableFrames = 0;
      const capture = async () => {
        if (signal.aborted) return;
        let bitmap: ImageBitmap | null = null;
        const retryUnavailableFrame = () => {
          if (++unavailableFrames > MAX_UNAVAILABLE_FRAMES) return false;
          if (!signal.aborted) this.timer = this.deps.schedule(() => { void capture(); });
          return true;
        };
        try {
          const width = this.video.videoWidth, height = this.video.videoHeight;
          if (!width || !height || this.video.readyState < 2) {
            if (retryUnavailableFrame()) return;
            throw new Error('Kamera görüntüsü geri gelmedi. Kamerayı yeniden aç.');
          }
          const timestampMs = Math.max(previousTimestamp + 1, this.deps.now());
          previousTimestamp = timestampMs;
          onCaptureStarted?.(timestampMs);
          if (signal.aborted) return;
          try {
            bitmap = await this.deps.bitmap(this.video, this.options.maxDimension);
          } catch (error) {
            if (temporarilyUnavailable(error)) {
              if (retryUnavailableFrame()) return;
              throw new Error('Kamera karesi okunamadı. Kamerayı yeniden aç.');
            }
            throw error;
          }
          if (signal.aborted) { bitmap.close(); return; }
          unavailableFrames = 0;
          const sent = bitmap; bitmap = null;
          const frame = await detector.detect(sent, timestampMs);
          if (signal.aborted) return;
          if (frame.timestampMs !== timestampMs) throw new Error('Kamera ölçümünün zamanı eşleşmedi. Kamerayı yeniden aç.');
          if (firstFrame) { firstFrame = false; this.onStartup?.('tracking'); }
          onObservation({ frame, width, height, processingMs: Math.max(0, this.deps.now() - timestampMs) });
          if (!signal.aborted) this.timer = this.deps.schedule(() => { void capture(); });
        } catch (error) { bitmap?.close(); fail(error); }
      };
      void capture();
    } catch (error) { fail(error); }
  }
}

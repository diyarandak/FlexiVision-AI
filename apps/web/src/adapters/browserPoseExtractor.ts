import type { PoseExtractor, VideoSource } from '@flexivision/application';
import type { AnalysisProgress, PoseFrame, PoseSequence } from '@flexivision/contracts';
import { AnalysisCancelled, POSE_MODEL, PoseWorkerClient, SDK_VERSION } from './poseWorkerClient.ts';
export { AnalysisCancelled } from './poseWorkerClient.ts';

const SAMPLE_FPS = 10;
export type ReferenceDetail = 640 | 960;

function waitForVideo(video: HTMLVideoElement, event: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new AnalysisCancelled()); return; }
    const finish = (error?: Error) => {
      clearTimeout(timeout); video.removeEventListener(event, ready);
      video.removeEventListener('error', failed); signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error('Video çözülemedi. Tarayıcının desteklediği bir MP4 veya WebM dosyası deneyin.'));
    const abort = () => finish(new AnalysisCancelled());
    const timeout = setTimeout(() => finish(new Error('Video karesi okunamadı. Farklı bir video deneyin.')), 15000);
    video.addEventListener(event, ready, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** A cancelled or stalled decoder must not keep the hidden video and Worker alive. */
function captureBitmap(video: HTMLVideoElement, size: ImageBitmapOptions, signal: AbortSignal): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); signal.removeEventListener('abort', abort); reject(error);
    };
    const abort = () => finish(new AnalysisCancelled());
    const timeout = setTimeout(() => finish(new Error('Video karesi çözülemedi. Farklı bir video deneyin.')), 15000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    void Promise.resolve().then(() => {
      if (signal.aborted) throw new AnalysisCancelled();
      return createImageBitmap(video, size);
    }).then(bitmap => {
      if (settled || signal.aborted) {
        try { bitmap.close(); } catch { /* The bitmap is already unavailable. */ }
        if (!settled) abort();
        return;
      }
      settled = true; clearTimeout(timeout); signal.removeEventListener('abort', abort); resolve(bitmap);
    }, error => finish(error instanceof Error ? error : new Error('Video karesi çözülemedi.')));
  });
}

/** One instance per run. At most one frame in flight, with abortable waits. */
export class BrowserPoseExtractor implements PoseExtractor {
  constructor(private readonly maxDimension: ReferenceDetail = 640,
    private readonly client: Pick<PoseWorkerClient, 'signal' | 'initialize' | 'detect' | 'cancel'> = new PoseWorkerClient()) {}
  cancel() { this.client.cancel(); }

  async extract(source: VideoSource, onProgress: (progress: AnalysisProgress) => void): Promise<PoseSequence> {
    if (this.client.signal.aborted) throw new AnalysisCancelled();
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    const signal = this.client.signal;
    try {
      const ready = waitForVideo(video, 'loadeddata', signal);
      video.src = source.uri; video.load();
      await ready;
      const durationMs = video.duration * 1000;
      if (!Number.isFinite(durationMs) || durationMs < 3000 || durationMs > 60000 || !video.videoWidth || !video.videoHeight) {
        throw new Error('Video 3–60 saniye uzunluğunda ve okunabilir olmalı.');
      }
      const total = Math.ceil(durationMs / (1000 / SAMPLE_FPS));
      onProgress({ stage: 'loading_model', completed: 0, total });
      await this.client.initialize();
      const frames: PoseFrame[] = [];
      const scale = Math.min(1, this.maxDimension / Math.max(video.videoWidth, video.videoHeight));
      let nextReady: Promise<Error | null> = Promise.resolve(null);
      for (let index = 0; index < total; index++) {
        const seekError = await nextReady;
        if (seekError) throw seekError;
        if (signal.aborted) throw new AnalysisCancelled();
        const timestampMs = index * (1000 / SAMPLE_FPS);
        const bitmap = await captureBitmap(video, {
          resizeWidth: Math.max(1, Math.round(video.videoWidth * scale)),
          resizeHeight: Math.max(1, Math.round(video.videoHeight * scale)),
        }, signal);
        if (signal.aborted) { bitmap.close(); throw new AnalysisCancelled(); }
        // The immutable bitmap belongs to this frame. Decode the next frame
        // while the Worker analyzes it, without adding inference concurrency.
        if (index + 1 < total) {
          nextReady = waitForVideo(video, 'seeked', signal).then(() => null, error => error as Error);
          video.currentTime = (index + 1) / SAMPLE_FPS;
        }
        const frame = await this.client.detect(bitmap, timestampMs);
        if (signal.aborted) throw new AnalysisCancelled();
        frames.push(frame);
        onProgress({ stage: 'extracting', completed: index + 1, total, frame });
      }
      return { schemaVersion: 1, engine: { name: 'mediapipe-pose', version: SDK_VERSION, model: POSE_MODEL },
        durationMs, width: video.videoWidth, height: video.videoHeight, sampleFps: SAMPLE_FPS, frames };
    } finally {
      try { video.pause(); } catch { /* Continue releasing the remaining resources. */ }
      try { video.removeAttribute('src'); } catch { /* Continue releasing the remaining resources. */ }
      try { video.load(); } catch { /* Continue releasing the remaining resources. */ }
      this.client.cancel();
    }
  }
}

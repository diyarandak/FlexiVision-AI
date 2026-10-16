import modelManifest from '../../../../scripts/model-manifest.json';
import type { PoseFrame } from '@flexivision/contracts';
import type { ModelStartupStage, WorkerReply, WorkerRequest } from '../workers/protocol.ts';

export const SDK_VERSION = '1.1.0';
export const POSE_MODEL = 'pose_landmarker_lite/float16/1';
export const MODEL_CACHE_NAME = 'flexivision-model-v1';
export class AnalysisCancelled extends Error {}

export function getModelUrl(): string {
  const base = typeof location !== 'undefined' ? location.origin : 'https://flexivision.local';
  return new URL(`/models/${modelManifest.sha256}/${modelManifest.file}`, base).href;
}

export function preloadPoseModel(): void {
  if (typeof window === 'undefined') return;
  const modelUrl = getModelUrl();
  const wasmUrl = new URL(`/vendor/mediapipe/${SDK_VERSION}/wasm/vision_wasm_internal.wasm`, location.origin).href;
  const bundleUrl = new URL(`/vendor/mediapipe/${SDK_VERSION}/vision_bundle.js`, location.origin).href;

  if ('caches' in window) {
    void (async () => {
      try {
        const cache = await caches.open(MODEL_CACHE_NAME);
        for (const url of [modelUrl, wasmUrl, bundleUrl]) {
          const matched = await cache.match(url);
          if (!matched) {
            const resp = await fetch(url, { cache: 'force-cache' });
            if (resp.ok) await cache.put(url, resp);
          }
        }
      } catch {
        for (const url of [modelUrl, wasmUrl, bundleUrl]) {
          void fetch(url, { cache: 'force-cache' }).catch(() => {});
        }
      }
    })();
  } else {
    for (const url of [modelUrl, wasmUrl, bundleUrl]) {
      void fetch(url, { cache: 'force-cache' }).catch(() => {});
    }
  }
}

/** Shared by reference extraction and live capture. One request at a time. */
export class PoseWorkerClient {
  private worker: Worker | null = null;
  private controller = new AbortController();
  private requestId = 0;
  constructor(private readonly initTimeoutMs = 60000) {}
  get signal() { return this.controller.signal; }
  cancel() { this.controller.abort(); this.worker?.terminate(); this.worker = null; }
  async initialize(onProgress?: (stage: ModelStartupStage) => void) {
    if (this.signal.aborted) throw new AnalysisCancelled();
    if (!('Worker' in window) || !('OffscreenCanvas' in window) || !('createImageBitmap' in window)) {
      throw new Error('Bu tarayıcı cihaz üzerinde analizi desteklemiyor. Güncel Chrome veya Safari deneyin.');
    }
    this.worker = new Worker('/workers/pose.js');
    await this.request({ id: ++this.requestId, type: 'init',
      assetRoot: new URL(`/vendor/mediapipe/${SDK_VERSION}`, location.origin).href,
      modelUrl: getModelUrl() }, [], onProgress);
  }
  async detect(bitmap: ImageBitmap, timestampMs: number): Promise<PoseFrame> {
    if (this.signal.aborted || !this.worker) { bitmap.close(); throw new AnalysisCancelled(); }
    const response = await this.request({ id: ++this.requestId, type: 'frame', timestampMs, bitmap }, [bitmap]);
    if (response.type !== 'frame') throw new Error('Beklenmeyen analiz yanıtı.');
    return response.frame;
  }
  private request(message: WorkerRequest, transfer: Transferable[] = [], onProgress?: (stage: ModelStartupStage) => void): Promise<WorkerReply> {
    const worker = this.worker, signal = this.signal;
    if (!worker || signal.aborted) return Promise.reject(new AnalysisCancelled());
    return new Promise((resolve, reject) => {
      let stage: ModelStartupStage = 'loading_library';
      const finish = (result?: WorkerReply, error?: Error) => {
        clearTimeout(timeout); worker.removeEventListener('message', receive);
        worker.removeEventListener('error', failed); worker.removeEventListener('messageerror', failed);
        signal.removeEventListener('abort', abort);
        if (error) reject(error); else if (result) resolve(result);
      };
      const receive = (event: MessageEvent<WorkerReply>) => {
        if (event.data.id !== message.id) return;
        if (event.data.type === 'progress') { stage = event.data.stage; onProgress?.(stage); return; }
        if (event.data.type === 'error') {
          console.error('Pose worker:', event.data.message);
          finish(undefined, new Error(message.type === 'init'
            ? 'Poz modeli yüklenemedi. Model dosyalarını ve tarayıcı desteğini kontrol edin.'
            : 'Kamera veya video karesi analiz edilemedi. Yeniden deneyin.'));
        } else finish(event.data);
      };
      const failed = () => finish(undefined, new Error('Analiz işlemi başlatılamadı. Güncel Chrome veya Safari ile yeniden deneyin.'));
      const abort = () => finish(undefined, new AnalysisCancelled());
      const timeout = setTimeout(() => finish(undefined, new Error(message.type === 'init'
        ? stage === 'starting_engine' ? 'Hareket motoru başlatılamadı. Sayfayı yenileyip yeniden dene.'
          : 'Analiz dosyaları yüklenemedi. İnternet bağlantını kontrol edip yeniden dene.'
        : 'Analiz zaman aşımına uğradı. Yeniden deneyin.')), message.type === 'init' ? this.initTimeoutMs : 20000);
      worker.addEventListener('message', receive); worker.addEventListener('error', failed);
      worker.addEventListener('messageerror', failed); signal.addEventListener('abort', abort, { once: true });
      try { worker.postMessage(message, transfer); } catch { if (message.type === 'frame') message.bitmap.close(); failed(); }
    });
  }
}

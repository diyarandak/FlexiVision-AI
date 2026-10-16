/// <reference lib="webworker" />
import type { PoseLandmarker, PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import type { PosePoint } from '@flexivision/contracts';
import type { WorkerReply, WorkerRequest } from './protocol.ts';

// Classic worker: MediaPipe's WASM loader uses importScripts. Built as an IIFE.
declare const Vision: typeof import('@mediapipe/tasks-vision');
const worker = self as unknown as DedicatedWorkerGlobalScope;
let detector: PoseLandmarker | undefined;
function reply(message: WorkerReply) { worker.postMessage(message); }
function point(value: { x: number; y: number; z: number; visibility?: number }): PosePoint {
  return { x: value.x, y: value.y, z: value.z, visibility: value.visibility ?? 0 };
}

async function loadModelBuffer(modelUrl: string): Promise<Uint8Array> {
  const CACHE_NAME = 'flexivision-model-v1';
  const cachesObj = typeof self !== 'undefined' && 'caches' in self ? self.caches : undefined;
  if (cachesObj) {
    try {
      const cache = await cachesObj.open(CACHE_NAME);
      const cached = await cache.match(modelUrl);
      if (cached && cached.ok) {
        return new Uint8Array(await cached.arrayBuffer());
      }
      const response = await fetch(modelUrl, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
      void cache.put(modelUrl, response.clone()).catch(() => {});
      return new Uint8Array(await response.arrayBuffer());
    } catch {
      // Fallback to direct fetch
    }
  }
  const response = await fetch(modelUrl, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

worker.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  let result: PoseLandmarkerResult | undefined;
  try {
    if (request.type === 'init') {
      reply({ id: request.id, type: 'progress', stage: 'loading_library' });
      worker.importScripts(`${request.assetRoot}/vision_bundle.js`);
      const fileset = await Vision.FilesetResolver.forVisionTasks(`${request.assetRoot}/wasm`);
      reply({ id: request.id, type: 'progress', stage: 'loading_model' });
      const modelAssetBuffer = await loadModelBuffer(request.modelUrl);
      reply({ id: request.id, type: 'progress', stage: 'starting_engine' });
      detector = await Vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer, delegate: 'CPU' },
        runningMode: 'VIDEO', numPoses: 2,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5, outputSegmentationMasks: false,
      });
      reply({ id: request.id, type: 'ready' });
    } else {
      if (!detector) throw new Error('Model is not initialized');
      result = detector.detectForVideo(request.bitmap, request.timestampMs);
      reply({ id: request.id, type: 'frame', frame: {
        timestampMs: request.timestampMs,
        people: result.landmarks.map((landmarks, index) => ({
          landmarks: landmarks.map(point), worldLandmarks: (result?.worldLandmarks[index] ?? []).map(point),
        })),
      } });
    }
  } catch (error) {
    reply({ id: request.id, type: 'error', message: error instanceof Error ? error.message : 'Pose inference failed' });
  } finally {
    result?.close();
    if (request.type === 'frame') request.bitmap.close();
  }
};

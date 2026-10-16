import type { PoseFrame } from '@flexivision/contracts';

export type ModelStartupStage = 'loading_library' | 'loading_model' | 'starting_engine';

export type WorkerRequest =
  | { id: number; type: 'init'; assetRoot: string; modelUrl: string }
  | { id: number; type: 'frame'; timestampMs: number; bitmap: ImageBitmap };
export type WorkerReply =
  | { id: number; type: 'progress'; stage: ModelStartupStage }
  | { id: number; type: 'ready' }
  | { id: number; type: 'frame'; frame: PoseFrame }
  | { id: number; type: 'error'; message: string };

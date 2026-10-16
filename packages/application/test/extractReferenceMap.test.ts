import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoseFrame, PoseSequence } from '@flexivision/contracts';
import { ExtractReferenceMap, type PoseExtractor } from '../src/index.ts';
import { genericCycle, genericPose } from '../../core/test/fixtures/genericTemplate.ts';

function createSyntheticSequence(kneeAngles: number[]): PoseSequence {
  const frames: PoseFrame[] = kneeAngles.map((knee, i) => {
    // MediaPipe landmark indices: 11 (left shoulder), 23 (left hip), 25 (left knee), 27 (left ankle)
    // Create geometry corresponding to standing (170 deg) or bent (80 deg)
    const rad = (knee * Math.PI) / 180;
    const hipX = 0.5, hipY = 0.5;
    const kneeX = 0.5, kneeY = 0.7;
    const ankleX = kneeX - Math.sin(Math.PI - rad) * 0.2;
    const ankleY = kneeY + Math.cos(Math.PI - rad) * 0.2;
    const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
    landmarks[11] = { x: 0.5, y: 0.3, z: 0, visibility: 0.95 };
    landmarks[12] = { x: 0.52, y: 0.3, z: 0, visibility: 0.85 };
    landmarks[23] = { x: hipX, y: hipY, z: 0, visibility: 0.95 };
    landmarks[24] = { x: hipX + 0.02, y: hipY, z: 0, visibility: 0.85 };
    landmarks[25] = { x: kneeX, y: kneeY, z: 0, visibility: 0.95 };
    landmarks[27] = { x: ankleX, y: ankleY, z: 0, visibility: 0.95 };
    return {
      timestampMs: i * 100,
      people: [{ landmarks, worldLandmarks: [] }],
    };
  });
  return {
    schemaVersion: 1,
    engine: { name: 'mediapipe-pose', version: 'test', model: 'synthetic' },
    durationMs: kneeAngles.length * 100,
    width: 720,
    height: 1280,
    sampleFps: 10,
    frames,
  };
}

test('ExtractReferenceMap evaluates qualification decision and attaches evidence', async () => {
  const hold = (v: number, n: number) => Array(n).fill(v);
  const ramp = (from: number, to: number, n: number) =>
    Array.from({ length: n }, (_, i) => from + (to - from) * (i / (n - 1)));
  // Stand 170 -> descent to 80 -> hold 80 -> ascent to 170 -> stand 170
  const squatSeries = [
    ...hold(170, 8),
    ...ramp(170, 80, 8),
    ...hold(80, 6),
    ...ramp(80, 170, 8),
    ...hold(170, 8),
  ];
  const sequence = createSyntheticSequence(squatSeries);

  const extractor: PoseExtractor = {
    async extract() { return sequence; },
    cancel() {},
  };

  const useCase = new ExtractReferenceMap(extractor);
  const map = await useCase.execute({ uri: 'fixture://test', name: 'test.mp4' }, () => {});

  assert.ok(map.decision);
  assert.ok(map.evidence);
  assert.equal(map.qualification, map.decision.status);
  assert.equal(map.evidence.durationMs, sequence.durationMs);
  assert.equal(map.evidence.sampledFrames, sequence.frames.length);
});

test('free mode stores the generic decision in the downloadable motion map', async () => {
  const values = genericCycle();
  const sequence: PoseSequence = { schemaVersion: 1,
    engine: { name: 'mediapipe-pose', version: 'test', model: 'synthetic' },
    durationMs: values.length * 100, width: 720, height: 1280, sampleFps: 10,
    frames: values.map((value, index) => ({ timestampMs: index * 100, people: [genericPose(value)] })) };
  const extractor: PoseExtractor = { async extract() { return sequence; }, cancel() {} };
  const map = await new ExtractReferenceMap(extractor, 'free').execute({ uri: 'fixture://arm-raise', name: 'arm.mp4' }, () => {});
  assert.equal(map.status, 'extracted');
  assert.equal(map.qualification, 'accepted');
  assert.equal(map.decision?.status, 'accepted');
  assert.equal(map.evidence?.motion, 'supported');
});

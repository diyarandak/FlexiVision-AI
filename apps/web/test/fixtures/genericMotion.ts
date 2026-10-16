import type { PoseSequence } from '@flexivision/contracts';
import { buildGenericTemplate, buildMotionMap, evaluateGenericReference } from '@flexivision/core';

export function genericReferenceMap() {
  const hold = (value: number, count: number) => Array<number>(count).fill(value);
  const ramp = (from: number, to: number) => Array.from({ length: 12 }, (_, i) => from + (to - from) * i / 11);
  const values = [...hold(0, 8), ...ramp(0, 1), ...hold(1, 5), ...ramp(1, 0), ...hold(0, 8)];
  const sequence: PoseSequence = { schemaVersion: 1,
    engine: { name: 'mediapipe-pose', version: 'test', model: 'synthetic' },
    durationMs: values.length * 100, width: 720, height: 1280, sampleFps: 10,
    frames: values.map((progress, i) => {
      const landmarks = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 0 }));
      const put = (index: number, x: number, y: number) => { landmarks[index] = { x, y, z: 0, visibility: .95 }; };
      put(11, .43, .3); put(12, .57, .3); put(23, .45, .55); put(24, .55, .55);
      const dx = .04 + .26 * progress, dy = .30 * (1 - progress);
      put(13, .43 - dx / 2, .3 + dy / 2); put(15, .43 - dx, .3 + dy);
      put(14, .57 + dx / 2, .3 + dy / 2); put(16, .57 + dx, .3 + dy);
      return { timestampMs: i * 100, people: [{ landmarks, worldLandmarks: [] }] };
    }) };
  return buildMotionMap(sequence);
}

export function genericTemplate() {
  const map = genericReferenceMap();
  return buildGenericTemplate(map, 1, evaluateGenericReference(map).decision);
}

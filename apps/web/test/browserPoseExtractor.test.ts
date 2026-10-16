import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserPoseExtractor, AnalysisCancelled } from '../src/adapters/browserPoseExtractor.ts';

test('reference decoding overlaps inference, keeps all 10 Hz frames and limits bitmap size', async t => {
  const descriptors = ['document', 'createImageBitmap'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  t.after(() => descriptors.forEach(([key, value]) => value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key)));
  class Video extends EventTarget {
    duration = 3; videoWidth = 1080; videoHeight = 1920; src = ''; muted = false; playsInline = false; preload = '';
    private time = 0;
    set currentTime(value: number) { this.time = value; queueMicrotask(() => this.dispatchEvent(new Event('seeked'))); }
    get currentTime() { return this.time; }
    load() { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event('loadeddata'))); }
    pause() {} removeAttribute() { this.src = ''; }
  }
  for (const maxDimension of [640, 960] as const) {
    const video = new Video(), controller = new AbortController();
    let closed = 0, inFlight = 0, overlaps = 0;
    const captures: number[] = [], sizes: ImageBitmapOptions[] = [];
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => video } });
    Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async (_video: unknown, size: ImageBitmapOptions) => {
      const capturedAt = video.currentTime * 1000; captures.push(capturedAt); sizes.push(size);
      return { capturedAt, close() { closed++; } };
    } });
    const extractor = new BrowserPoseExtractor(maxDimension, {
      signal: controller.signal, initialize: async () => {}, cancel: () => controller.abort(),
      async detect(bitmap, timestampMs) {
        assert.equal(++inFlight, 1);
        assert.ok(Math.abs((bitmap as ImageBitmap & { capturedAt: number }).capturedAt - timestampMs) < .001);
        if (video.currentTime * 1000 > timestampMs) overlaps++;
        await Promise.resolve(); bitmap.close(); inFlight--;
        return { timestampMs, people: [] };
      },
    });
    const result = await extractor.extract({ uri: 'blob:local-test', name: 'test.mp4' }, () => {});
    assert.equal(result.frames.length, 30); assert.equal(result.sampleFps, 10);
    assert.equal(result.width, 1080); assert.equal(result.height, 1920);
    assert.equal(overlaps, 29); assert.equal(closed, 30); assert.equal(video.src, '');
    assert.deepEqual(sizes[0], { resizeWidth: maxDimension * 9 / 16, resizeHeight: maxDimension });
    assert.deepEqual(result.frames.map(frame => frame.timestampMs), Array.from({ length: 30 }, (_, i) => i * 100));
    assert.equal(captures.length, 30); assert.equal(controller.signal.aborted, true);
  }
});

test('cancelling a pending bitmap releases the video immediately and closes the late bitmap', { timeout: 2000 }, async t => {
  const descriptors = ['document', 'createImageBitmap'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  t.after(() => descriptors.forEach(([key, value]) => value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key)));
  const video = new EventTarget() as EventTarget & Record<string, unknown>;
  Object.assign(video, { duration: 3, videoWidth: 640, videoHeight: 480, src: '', currentTime: 0,
    load() { if (video.src) queueMicrotask(() => video.dispatchEvent(new Event('loadeddata'))); }, pause() {}, removeAttribute() { video.src = ''; } });
  let capture!: () => void, release!: (bitmap: ImageBitmap) => void;
  const capturing = new Promise<void>(resolve => { capture = resolve; });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => video } });
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: () => { capture(); return new Promise<ImageBitmap>(resolve => { release = resolve; }); } });
  const controller = new AbortController(); let detections = 0, closed = 0, frames = 0;
  const extractor = new BrowserPoseExtractor(640, { signal: controller.signal, initialize: async () => {}, cancel: () => controller.abort(),
    async detect(_bitmap, timestampMs) { detections++; return { timestampMs, people: [] }; } });
  const result = extractor.extract({ uri: 'blob:local', name: 'test.mp4' }, progress => { if (progress.frame) frames++; });
  await capturing; extractor.cancel();
  await assert.rejects(result, AnalysisCancelled);
  assert.equal(video.src, '');
  release({ close() { closed++; } } as ImageBitmap);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(closed, 1); assert.equal(detections, 0); assert.equal(frames, 0); assert.equal(video.src, '');
});

test('a stalled video decoder times out, releases resources, and closes a late bitmap', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const descriptors = ['document', 'createImageBitmap'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  t.after(() => descriptors.forEach(([key, value]) => value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key)));
  const video = new EventTarget() as EventTarget & Record<string, unknown>;
  Object.assign(video, { duration: 3, videoWidth: 640, videoHeight: 480, src: '', currentTime: 0,
    load() { if (video.src) queueMicrotask(() => video.dispatchEvent(new Event('loadeddata'))); },
    pause() {}, removeAttribute() { video.src = ''; } });
  let started!: () => void, release!: (bitmap: ImageBitmap) => void;
  const capturing = new Promise<void>(resolve => { started = resolve; });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => video } });
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: () => {
    started(); return new Promise<ImageBitmap>(resolve => { release = resolve; });
  } });
  const controller = new AbortController(); let closed = 0;
  const extractor = new BrowserPoseExtractor(640, { signal: controller.signal, initialize: async () => {},
    cancel: () => controller.abort(), async detect(_bitmap, timestampMs) { return { timestampMs, people: [] }; } });
  const result = extractor.extract({ uri: 'blob:local', name: 'test.mp4' }, () => {});
  await capturing; t.mock.timers.tick(15000);
  await assert.rejects(result, /Video karesi çözülemedi/);
  assert.equal(video.src, ''); assert.equal(controller.signal.aborted, true);
  release({ close() { closed++; } } as ImageBitmap);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(closed, 1);
});

test('a decoder failure is reported even when video cleanup methods throw', async t => {
  const descriptors = ['document', 'createImageBitmap'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  t.after(() => descriptors.forEach(([key, value]) => value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key)));
  const video = new EventTarget() as EventTarget & Record<string, unknown>;
  let detached = 0, unloaded = 0, cancelled = 0;
  Object.assign(video, { duration: 3, videoWidth: 640, videoHeight: 480, src: '', currentTime: 0,
    load() { if (video.src) queueMicrotask(() => video.dispatchEvent(new Event('loadeddata'))); else unloaded++; },
    pause() { throw new Error('Pause failed'); }, removeAttribute() { video.src = ''; detached++; } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => video } });
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => { throw new Error('Decoder failed'); } });
  const controller = new AbortController();
  const extractor = new BrowserPoseExtractor(640, { signal: controller.signal, initialize: async () => {},
    cancel: () => { cancelled++; controller.abort(); },
    async detect(_bitmap, timestampMs) { return { timestampMs, people: [] }; } });
  await assert.rejects(extractor.extract({ uri: 'blob:local', name: 'test.mp4' }, () => {}), /Decoder failed/);
  assert.equal(detached, 1); assert.equal(unloaded, 1); assert.equal(cancelled, 1);
});

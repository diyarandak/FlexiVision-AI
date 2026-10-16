import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkerRequest } from '../src/workers/protocol.ts';

test('the default camera adapter cancels its browser timer without an invalid native receiver', async t => {
  const descriptors = ['window', 'navigator', 'location', 'Worker', 'createImageBitmap', 'setTimeout', 'clearTimeout']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  t.after(() => descriptors.forEach(([key, value]) => value
    ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key)));
  const install = (key: string, value: unknown) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let nextTimer = 0, stopped = 0, terminated = 0, paused = 0, observations = 0;
  const timers = new Map<number, number>();
  const track = new EventTarget() as MediaStreamTrack;
  track.stop = () => { stopped++; };
  const stream = { getTracks: () => [track] };
  class Video extends EventTarget {
    srcObject: unknown = null; readyState = 2; videoWidth = 960; videoHeight = 1280;
    muted = false; playsInline = false;
    async play() {}
    pause() { paused++; }
  }
  class Worker extends EventTarget {
    postMessage(message: WorkerRequest) {
      if (message.type === 'frame') message.bitmap.close();
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: message.type === 'init'
        ? { id: message.id, type: 'ready' }
        : { id: message.id, type: 'frame', frame: { timestampMs: message.timestampMs, people: [] } } })));
    }
    terminate() { terminated++; }
  }
  install('window', { Worker, OffscreenCanvas: class {}, createImageBitmap() {} });
  install('navigator', { mediaDevices: { getUserMedia: async () => stream } });
  install('location', { origin: 'https://example.test' });
  install('Worker', Worker);
  install('createImageBitmap', async () => ({ close() {} }));
  install('setTimeout', (_callback: () => void, delay: number) => { timers.set(++nextTimer, delay); return nextTimer; });
  // Window timer functions accept a bare call, but not a dependency object as `this`.
  install('clearTimeout', function(this: unknown, timer: number) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    timers.delete(timer);
  });
  // Import after installing browser timer semantics: the old adapter captured the
  // native clearTimeout function at module initialization.
  const { BrowserCameraPose } = await import('../src/adapters/browserCameraPose.ts');
  const video = new Video();
  const source = new BrowserCameraPose(video as unknown as HTMLVideoElement);
  await source.start(() => { observations++; }, error => assert.fail(error.message));
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(observations, 1);
  assert.deepEqual([...timers.values()], [100]);
  assert.doesNotThrow(() => source.stop());
  assert.equal(timers.size, 0);
  assert.equal(stopped, 1); assert.equal(terminated, 1); assert.equal(paused, 1);
  assert.equal(video.srcObject, null);
  assert.doesNotThrow(() => source.stop());
  assert.equal(stopped, 1); assert.equal(terminated, 1);
});

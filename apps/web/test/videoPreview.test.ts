import assert from 'node:assert/strict';
import test from 'node:test';
import { watchVideoPreview } from '../src/adapters/videoPreview.ts';

function fixture() {
  const video = Object.assign(new EventTarget(), { paused: true, seeking: false, currentTime: 0 });
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  const updates: { time: number; seeking: boolean }[] = [];
  const stop = watchVideoPreview(video as unknown as HTMLVideoElement,
    (time, seeking) => updates.push({ time, seeking }),
    { request(callback) { frames.set(++id, callback); return id; }, cancel(key) { frames.delete(key); } });
  const emit = (event: string) => video.dispatchEvent(new Event(event));
  const tick = () => { const next = frames.entries().next().value; assert.ok(next); frames.delete(next[0]); next[1](0); };
  return { video, frames, updates, stop, emit, tick };
}

test('paused reference previews do no frame polling; play resumes one loop and pause releases it', () => {
  const f = fixture();
  assert.equal(f.frames.size, 0);
  f.video.paused = false; f.emit('play');
  assert.equal(f.frames.size, 1);
  f.video.currentTime = 1.25; f.tick();
  assert.deepEqual(f.updates.at(-1), { time: 1250, seeking: false });
  f.emit('timeupdate'); assert.equal(f.frames.size, 1);
  f.video.paused = true; f.emit('pause');
  assert.equal(f.frames.size, 0);
  f.video.currentTime = 3; f.emit('timeupdate');
  assert.equal(f.updates.at(-1)?.time, 3000);
  assert.equal(f.frames.size, 0);
  f.stop();
});

test('seek hides stale pose immediately and cleanup ignores late video events and frame callbacks', () => {
  const f = fixture();
  f.video.paused = false; f.emit('play');
  const late = [...f.frames.values()][0]!;
  f.video.seeking = true; f.video.currentTime = 4; f.emit('seeking');
  assert.deepEqual(f.updates.at(-1), { time: 4000, seeking: true });
  assert.equal(f.frames.size, 0);
  f.video.seeking = false; f.emit('seeked');
  assert.equal(f.frames.size, 1);
  assert.deepEqual(f.updates.at(-1), { time: 4000, seeking: false });
  f.stop();
  const count = f.updates.length;
  late(0); f.emit('play'); f.emit('timeupdate');
  assert.equal(f.frames.size, 0);
  assert.equal(f.updates.length, count);
});

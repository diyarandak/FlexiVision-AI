import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraZoom, setCameraZoom } from '../src/adapters/cameraLens.ts';
import { cameraConstraints } from '../src/adapters/browserCameraPose.ts';

function fixture() {
  let value = 2, ignored = false, ended = false;
  const requests: (MediaTrackConstraints & { zoom?: { exact: number } })[] = [];
  const track = { get readyState() { return ended ? 'ended' : 'live'; },
    getCapabilities: () => ({ zoom: { min: .5, max: 4, step: .1 } }), getSettings: () => ({ zoom: value }),
    getConstraints: () => ({ width: { ideal: 720 }, facingMode: { exact: 'environment' }, advanced: [{ zoom: 2, frameRate: 30 }] }),
    async applyConstraints(constraints: MediaTrackConstraints & { zoom: { exact: number } }) {
      requests.push(constraints); if (!ignored) value = constraints.zoom.exact;
    },
  } as unknown as MediaStreamTrack;
  return { track, requests, ignore() { ignored = true; }, end() { ended = true; } };
}

test('real track zoom widens to its advertised minimum and preserves other capture constraints', async () => {
  const camera = fixture();
  assert.equal(cameraZoom(camera.track)?.value, 2);
  const actual = await setCameraZoom(camera.track, .2);
  assert.equal(actual.value, .5);
  assert.deepEqual(camera.requests[0]?.width, { ideal: 720 });
  assert.deepEqual(camera.requests[0]?.facingMode, { exact: 'environment' });
  assert.deepEqual(camera.requests[0]?.advanced, [{ frameRate: 30 }]);
  assert.equal((await setCameraZoom(camera.track, 9)).value, 4);
});
test('unsupported, malformed, ignored and stopped zoom never claims a wider camera', async () => {
  const unsupported = { readyState: 'live', getCapabilities: () => ({}), getSettings: () => ({}) } as unknown as MediaStreamTrack;
  assert.equal(cameraZoom(unsupported), null);
  await assert.rejects(setCameraZoom(unsupported, .5), /kontrolü sunmuyor/);
  const camera = fixture(); camera.ignore();
  await assert.rejects(setCameraZoom(camera.track, .5), /uygulamadı/);
  assert.equal(cameraZoom(camera.track)?.value, 2);
  camera.end(); assert.equal(cameraZoom(camera.track), null);
  await assert.rejects(setCameraZoom(camera.track, .5));
  const broken = fixture(); broken.track.getCapabilities = () => { throw new Error('unsupported'); };
  assert.equal(cameraZoom(broken.track), null);
  const invalidStep = fixture();
  invalidStep.track.getCapabilities = () => ({ zoom: { min: .5, max: 4, step: Infinity } } as MediaTrackCapabilities);
  assert.equal(cameraZoom(invalidStep.track)?.step, .1);
  assert.equal((await setCameraZoom(invalidStep.track, .5)).value, .5);
});
test('a selected lens preserves its device ID and requests uncropped primary-orientation video, with no microphone', () => {
  const request = cameraConstraints({ facingMode: 'environment', maxDimension: 480, deviceId: 'wide-lens', portrait: true });
  assert.equal(request.audio, false);
  const video = request.video as MediaTrackConstraints & { resizeMode?: ConstrainDOMString };
  assert.deepEqual(video.deviceId, { exact: 'wide-lens' });
  assert.equal(video.facingMode, undefined);
  assert.deepEqual(video.aspectRatio, { ideal: 4 / 3 });
  assert.deepEqual(video.resizeMode, { exact: 'none' });
});

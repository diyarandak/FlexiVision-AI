import assert from 'node:assert/strict';
import test from 'node:test';
import type { CameraPoseObservation, PoseFrame } from '@flexivision/contracts';
import { BrowserCameraPose, CameraCleanupError, cameraCaptureSize, cameraCleanupMessage, cameraConstraints, preferredCameraOptions } from '../src/adapters/browserCameraPose.ts';
import type { CameraDependencies } from '../src/adapters/browserCameraPose.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); }
function setup() {
  const track = new EventTarget() as MediaStreamTrack;
  let stoppedTracks = 0, cancelledDetectors = 0, initializations = 0, inFlight = 0, maxInFlight = 0, closedBitmaps = 0;
  track.stop = () => { stoppedTracks++; };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const video = { muted: false, playsInline: false, srcObject: null, videoWidth: 640, videoHeight: 480, readyState: 2,
    play: async () => {}, pause: () => {} } as unknown as HTMLVideoElement;
  const scheduled: (() => void)[] = [];
  const frame = deferred<PoseFrame>();
  const detector = {
    initialize: async () => { initializations++; },
    detect: async (bitmap: ImageBitmap, _time: number) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      const result = await frame.promise; bitmap.close(); inFlight--; return result;
    },
    cancel: () => { cancelledDetectors++; },
  };
  const deps: CameraDependencies = {
    getUserMedia: async () => stream, createDetector: () => detector,
    bitmap: async () => ({ close: () => { closedBitmaps++; } }) as ImageBitmap,
    videoReady: async () => {}, now: () => 100,
    schedule: callback => { scheduled.push(callback); return scheduled.length as unknown as ReturnType<typeof setTimeout>; },
    unschedule: id => { scheduled[Number(id)-1] = () => {}; },
  };
  const source = new BrowserCameraPose(video, deps);
  return { source, deps, video, stream, track, detector, frame, scheduled,
    stats: () => ({ stoppedTracks, cancelledDetectors, initializations, inFlight, maxInFlight, closedBitmaps }) };
}

test('a permission result arriving after stop releases tracks without starting a detector', async () => {
  const rig = setup(), permission = deferred<MediaStream>();
  rig.deps.getUserMedia = () => permission.promise;
  const start = rig.source.start(() => assert.fail('No frames'), () => assert.fail('No late errors'));
  rig.source.stop(); permission.resolve(rig.stream); await start;
  assert.equal(rig.stats().stoppedTracks, 1); assert.equal(rig.stats().initializations, 0);
  assert.equal(rig.video.srcObject, null);
});
test('a late permission result attempts to stop every track even if one stop throws', async () => {
  const rig = setup(), permission = deferred<MediaStream>(); let otherTrackStopped = 0;
  const first = { stop: () => { throw new Error('Track driver failed'); } } as unknown as MediaStreamTrack;
  const second = { stop: () => { otherTrackStopped++; } } as unknown as MediaStreamTrack;
  rig.deps.getUserMedia = () => permission.promise;
  const start = rig.source.start(() => assert.fail('No frames'), () => assert.fail('No late errors'));
  rig.source.stop();
  permission.resolve({ getTracks: () => [first, second] } as MediaStream);
  await start;
  assert.equal(otherTrackStopped, 1); assert.equal(rig.stats().initializations, 0);
});
test('stopping while video playback is still pending settles startup and releases the camera', async () => {
  const rig = setup(), playback = deferred<void>(); let errors = 0;
  rig.video.play = () => playback.promise;
  const start = rig.source.start(() => assert.fail('No frames'), () => { errors++; });
  await settle();
  rig.source.stop();
  await Promise.race([start, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Startup stayed pending after stop')), 100))]);
  playback.resolve(); await settle();
  assert.equal(errors, 0); assert.equal(rig.stats().stoppedTracks, 1);
  assert.equal(rig.stats().initializations, 0); assert.equal(rig.video.srcObject, null);
});
test('permission denial returns actionable text and never creates a detector', async () => {
  const rig = setup(); let message = '';
  rig.deps.getUserMedia = async () => { const error = new Error('Denied'); error.name = 'NotAllowedError'; throw error; };
  await rig.source.start(() => assert.fail('No frames'), error => { message = error.message; });
  assert.match(message, /Kamera izni verilmedi/); assert.equal(rig.stats().initializations, 0);
});
test('a model startup failure releases the camera and reports a technical error', async () => {
  const rig = setup(); let message = '';
  rig.detector.initialize = async () => { throw new Error('Model unavailable'); };
  await rig.source.start(() => assert.fail('No frames'), error => { message = error.message; });
  assert.equal(message, 'Model unavailable'); assert.equal(rig.stats().stoppedTracks, 1);
  assert.equal(rig.stats().cancelledDetectors, 1); assert.equal(rig.video.srcObject, null);
});
test('inference has one frame in flight and stop ignores its delayed result', async () => {
  const rig = setup(); let frames = 0;
  await rig.source.start(() => frames++, () => assert.fail('No errors'));
  await settle(); assert.equal(rig.stats().maxInFlight, 1); assert.equal(rig.scheduled.length, 0);
  rig.source.stop(); rig.frame.resolve({ timestampMs: 100, people: [] }); await settle();
  assert.equal(frames, 0); assert.equal(rig.scheduled.length, 0);
  assert.equal(rig.stats().closedBitmaps, 1); assert.equal(rig.stats().stoppedTracks, 1);
});
test('delayed bitmap capture after stop is closed without sending it to inference', async () => {
  const rig = setup(), bitmap = deferred<ImageBitmap>(); let closed = 0;
  rig.deps.bitmap = () => bitmap.promise;
  await rig.source.start(() => assert.fail('No frames'), () => assert.fail('No errors'));
  rig.source.stop(); bitmap.resolve({ width: 640, height: 480, close: () => { closed++; } } as ImageBitmap); await settle();
  assert.equal(closed, 1); assert.equal(rig.stats().maxInFlight, 0);
});
test('a brief camera frame pause recovers without a false technical failure', async () => {
  const rig = setup(); let frames = 0, errors = 0;
  (rig.video as unknown as { readyState: number }).readyState = 1;
  await rig.source.start(() => { frames++; rig.source.stop(); }, () => { errors++; });
  assert.equal(rig.scheduled.length, 1); assert.equal(rig.stats().maxInFlight, 0);
  rig.scheduled[0]!(); await settle();
  assert.equal(rig.scheduled.length, 2);
  (rig.video as unknown as { readyState: number }).readyState = 2;
  rig.scheduled[1]!(); await settle();
  rig.frame.resolve({ timestampMs: 100, people: [] }); await settle();
  assert.equal(frames, 1); assert.equal(errors, 0); assert.equal(rig.stats().maxInFlight, 1);
});
test('transient bitmap invalid state retries, while repeated failure stops the camera', async () => {
  const recovered = setup(); let attempts = 0, frames = 0;
  const originalBitmap = recovered.deps.bitmap;
  recovered.deps.bitmap = (video, max) => {
    attempts++;
    if (attempts < 3) { const error = new Error('Frame not ready'); error.name = 'InvalidStateError'; return Promise.reject(error); }
    return originalBitmap(video, max);
  };
  await recovered.source.start(() => { frames++; recovered.source.stop(); }, () => assert.fail('No error expected'));
  await settle(); recovered.scheduled[0]!(); await settle(); recovered.scheduled[1]!(); await settle();
  recovered.frame.resolve({ timestampMs: 102, people: [] }); await settle();
  assert.equal(attempts, 3); assert.equal(frames, 1);

  const stalled = setup(); let errors = 0, message = '';
  stalled.deps.bitmap = async () => { const error = new Error('Frame not ready'); error.name = 'InvalidStateError'; throw error; };
  await stalled.source.start(() => assert.fail('No frames'), error => { errors++; message = error.message; });
  await settle();
  for (let i = 0; i < 20; i++) { stalled.scheduled[i]!(); await settle(); }
  assert.equal(errors, 1); assert.match(message, /Kamera karesi okunamadı/);
  assert.equal(stalled.stats().stoppedTracks, 1); assert.equal(stalled.stats().cancelledDetectors, 1);
});
test('stopping inside a delivered observation schedules no extra capture', async () => {
  const rig = setup(); let observation: CameraPoseObservation | undefined;
  await rig.source.start(value => { observation = value; rig.source.stop(); }, () => assert.fail('No errors'));
  rig.frame.resolve({ timestampMs: 100, people: [] }); await settle();
  assert.equal(observation?.width, 640); assert.equal(rig.scheduled.length, 0);
});
test('detector cleanup failure still releases tracks/video and reports a startup error', async () => {
  const rig = setup(); let message = '';
  rig.detector.cancel = () => { throw new Error('Detector cleanup failed'); };
  rig.detector.initialize = async () => { throw new Error('Original model error'); };
  await rig.source.start(() => assert.fail('No frames'), error => { message = error.message; });
  assert.equal(message, 'Original model error'); assert.equal(rig.stats().stoppedTracks, 1);
  assert.equal(rig.video.srcObject, null); assert.doesNotThrow(() => rig.source.stop());
});
test('cleanup diagnostics separate a detector failure from a camera track failure',async()=>{
  const detectorRig=setup();
  await detectorRig.source.start(()=>{},()=>assert.fail('No startup error'));
  detectorRig.detector.cancel=()=>{throw Error('worker failed');};
  assert.throws(()=>detectorRig.source.stop(),error=>{
    assert.ok(error instanceof CameraCleanupError);
    assert.deepEqual(error.stages,['detector']);
    assert.match(cameraCleanupMessage(error),/Kamera izleri durduruldu; poz modeli/);
    return true;
  });
  assert.equal(detectorRig.stats().stoppedTracks,1);
  const trackRig=setup();
  await trackRig.source.start(()=>{},()=>assert.fail('No startup error'));
  trackRig.track.stop=()=>{throw Error('track failed');};
  assert.throws(()=>trackRig.source.stop(),error=>{
    assert.ok(error instanceof CameraCleanupError);
    assert.deepEqual(error.stages,['track']);
    assert.match(cameraCleanupMessage(error),/Kamera izi kapatılırken hata/);
    return true;
  });
  assert.equal(trackRig.video.srcObject,null);
});
test('camera disconnect terminates tracks and detector and reports the interruption once', async () => {
  const rig = setup(); let errors = 0;
  await rig.source.start(() => assert.fail('No frames'), error => { errors++; assert.match(error.message, /bağlantısı kesildi/); });
  rig.track.dispatchEvent(new Event('ended')); rig.track.dispatchEvent(new Event('ended'));
  rig.frame.resolve({ timestampMs: 100, people: [] }); await settle();
  assert.equal(errors, 1); assert.equal(rig.stats().stoppedTracks, 1); assert.equal(rig.stats().cancelledDetectors, 1);
});
test('capture notification precedes analysis and its measured duration survives delayed inference', async () => {
  const rig = setup(); let now = 100; const observations: CameraPoseObservation[] = [];
  const captures: number[] = []; rig.deps.now = () => now;
  await rig.source.start(value => { observations.push(value); rig.source.stop(); }, () => assert.fail('No errors'), time => captures.push(time));
  await settle(); assert.deepEqual(captures, [100]); assert.equal(observations.length, 0);
  now = 2300; rig.frame.resolve({timestampMs:100, people:[]}); await settle();
  assert.equal(observations[0]?.processingMs, 2200); assert.equal(observations[0]?.frame.timestampMs, 100);
  assert.equal(rig.stats().maxInFlight, 1); assert.equal(rig.scheduled.length, 0);
});
test('stopping from capture notification does not allocate or send a camera bitmap', async () => {
  const rig = setup();
  await rig.source.start(() => assert.fail('No frames'), () => assert.fail('No errors'), () => rig.source.stop());
  await settle(); assert.equal(rig.stats().inFlight, 0); assert.equal(rig.scheduled.length, 0);
  assert.equal(rig.stats().stoppedTracks, 1);
});

test('phone camera choices request the selected camera without audio and limit portrait/landscape capture sizes', async () => {
  assert.equal(preferredCameraOptions(true).portrait, true);
  assert.equal(preferredCameraOptions(false).portrait, false);
  assert.deepEqual(cameraCaptureSize(1920, 1080, 640), { resizeWidth: 640, resizeHeight: 360 });
  assert.deepEqual(cameraCaptureSize(1080, 1920, 480), { resizeWidth: 270, resizeHeight: 480 });
  assert.deepEqual(cameraCaptureSize(320, 240, 480), { resizeWidth: 320, resizeHeight: 240 });
  assert.throws(() => cameraCaptureSize(0, 720, 640));
  const options = { facingMode: 'environment' as const, maxDimension: 480 as const };
  assert.deepEqual(cameraConstraints(options), { audio: false, video: { facingMode: { exact: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } } });
  assert.deepEqual(cameraConstraints(preferredCameraOptions(true)), { audio: false, video: {
    facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 960 }, aspectRatio: { ideal: 4 / 3 }, resizeMode: { exact: 'none' },
  } });
  const rig = setup(); let actual: MediaStreamConstraints | undefined, dimension = 0;
  rig.deps.getUserMedia = async constraints => { actual = constraints; return rig.stream; };
  rig.deps.bitmap = async (_video, max) => { dimension = max; return { close() {} } as ImageBitmap; };
  const source = new BrowserCameraPose(rig.video, rig.deps, options);
  await source.start(() => source.stop(), () => assert.fail('No errors'));
  rig.frame.resolve({ timestampMs: 100, people: [] }); await settle();
  assert.deepEqual(actual, cameraConstraints(options)); assert.equal(dimension, 480); assert.equal(rig.stats().stoppedTracks, 1);
});
test('unavailable back camera and mismatched pose timestamp are technical errors, never observations', async () => {
  const denied = setup(); let message = '';
  denied.deps.getUserMedia = async () => { const error = new Error('Unsupported camera'); error.name = 'OverconstrainedError'; throw error; };
  await denied.source.start(() => assert.fail('No frames'), error => { message = error.message; });
  assert.match(message, /Ön kamerayı seç/);
  const mismatch = setup();
  await mismatch.source.start(() => assert.fail('No frames'), error => { message = error.message; });
  mismatch.frame.resolve({ timestampMs: 99, people: [] }); await settle();
  assert.match(message, /zamanı eşleşmedi/); assert.equal(mismatch.stats().stoppedTracks, 1);
});


test('native format rejection retries once on the same lens without requesting a cropped sensor ratio', async () => {
  const rig=setup(), requests: MediaStreamConstraints[]=[];
  const options={...preferredCameraOptions(true), deviceId:'selected-lens'};
  rig.deps.getUserMedia=async c=>{
    requests.push(c);
    if(requests.length===1) throw Object.assign(new Error('portrait unavailable'),{name:'OverconstrainedError',constraint:'aspectRatio'});
    return rig.stream;
  };
  const source=new BrowserCameraPose(rig.video,rig.deps,options);
  await source.start(()=>{},()=>assert.fail('fallback should work'));
  assert.deepEqual(requests,[cameraConstraints(options),cameraConstraints(options,false)]);
  assert.deepEqual(requests[1], { audio: false, video: { deviceId: { exact: 'selected-lens' }, resizeMode: { ideal: 'none' } } });
  assert.equal(rig.video.srcObject,rig.stream);
  source.stop();assert.equal(rig.stats().stoppedTracks,1);
});
test('a rotating phone selects in sensor coordinates and delivers its real portrait dimensions to analysis', async () => {
  const rig = setup(); let observation: CameraPoseObservation | undefined, requestCount = 0;
  rig.deps.getUserMedia = async request => {
    requestCount++;
    const constraints = request.video as MediaTrackConstraints & { resizeMode?: ConstrainDOMString };
    // Model a 4:3 native sensor whose browser rotates delivered frames. A 9:16
    // sensor request cannot open this camera without cropping.
    assert.deepEqual(constraints.aspectRatio, { ideal: 4 / 3 });
    assert.deepEqual(constraints.resizeMode, { exact: 'none' });
    Object.assign(rig.video, { videoWidth: 960, videoHeight: 1280 });
    return rig.stream;
  };
  let bitmapSize: ReturnType<typeof cameraCaptureSize> | undefined;
  rig.deps.bitmap = async (video, limit) => {
    bitmapSize = cameraCaptureSize(video.videoWidth, video.videoHeight, limit);
    return { close() {} } as ImageBitmap;
  };
  const source = new BrowserCameraPose(rig.video, rig.deps, preferredCameraOptions(true));
  await source.start(value => { observation = value; source.stop(); }, () => assert.fail('Native camera should start'));
  rig.frame.resolve({ timestampMs: 100, people: [] }); await settle();
  assert.equal(requestCount, 1);
  assert.equal(observation?.width, 960); assert.equal(observation?.height, 1280);
  assert.deepEqual(bitmapSize, { resizeWidth: 480, resizeHeight: 640 });
  assert.equal(rig.stats().stoppedTracks, 1);
});
test('an upright landscape camera remains landscape instead of inventing a portrait result', async () => {
  const rig = setup(); let observation: CameraPoseObservation | undefined;
  const source = new BrowserCameraPose(rig.video, rig.deps, preferredCameraOptions(true));
  await source.start(value => { observation = value; source.stop(); }, () => assert.fail('Camera should start'));
  rig.frame.resolve({ timestampMs: 100, people: [] }); await settle();
  assert.equal(observation?.width, 640); assert.equal(observation?.height, 480);
  assert.equal(rig.stats().initializations, 1);
});
test('native-format fallback failure is reported once without opening more cameras', async () => {
  const rig = setup(); let calls = 0, errors = 0;
  rig.deps.getUserMedia = async () => { calls++; throw Object.assign(new Error('Native controls unavailable'), { name: 'OverconstrainedError', constraint: 'resizeMode' }); };
  await new BrowserCameraPose(rig.video, rig.deps, preferredCameraOptions(true)).start(() => assert.fail('No frames'), () => { errors++; });
  assert.equal(calls, 2); assert.equal(errors, 1); assert.equal(rig.stats().initializations, 0);
});
test('portrait camera permission and identity failures never trigger fallback requests',async()=>{
  for(const failure of [Object.assign(new Error('permission'),{name:'NotAllowedError'}),
    Object.assign(new Error('missing lens'),{name:'OverconstrainedError',constraint:'deviceId'})]){
    const rig=setup();let calls=0,errors=0;
    rig.deps.getUserMedia=async()=>{calls++;throw failure;};
    await new BrowserCameraPose(rig.video,rig.deps,preferredCameraOptions(true)).start(()=>{},()=>{errors++;});
    assert.equal(calls,1);assert.equal(errors,1);assert.equal(rig.stats().initializations,0);
  }
});
test('stopped portrait acquisition cannot request a fallback camera',async()=>{
  const rig=setup();let reject!:(error:Error)=>void,calls=0;
  rig.deps.getUserMedia=()=>{calls++;return new Promise((_resolve,no)=>{reject=no;});};
  const source=new BrowserCameraPose(rig.video,rig.deps,preferredCameraOptions(true));
  const work=source.start(()=>assert.fail(),()=>assert.fail());source.stop();
  reject(Object.assign(new Error('format'),{name:'OverconstrainedError',constraint:'height'}));
  await work;assert.equal(calls,1);
});
test('a late portrait fallback stream is released after stop without inference',async()=>{
  const rig=setup(),fallback=deferred<MediaStream>();let calls=0;
  rig.deps.getUserMedia=async()=>{if(++calls===1)throw Object.assign(new Error('format'),{name:'OverconstrainedError',constraint:'resizeMode'});return fallback.promise;};
  const source=new BrowserCameraPose(rig.video,rig.deps,preferredCameraOptions(true));
  const work=source.start(()=>assert.fail(),()=>assert.fail());await settle();source.stop();fallback.resolve(rig.stream);
  await work;assert.equal(calls,2);assert.equal(rig.stats().stoppedTracks,1);assert.equal(rig.stats().initializations,0);
});

test('advancing camera frames unblock a play promise that never settles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const rig=setup(), stages:string[]=[];
  Object.assign(rig.video,{currentTime:0,paused:false});
  rig.video.play=()=>new Promise(()=>{});
  const source=new BrowserCameraPose(rig.video,rig.deps,undefined,stage=>stages.push(stage));
  const start=source.start(()=>source.stop(),()=>assert.fail('Advancing playback must recover'));
  await settle(); assert.deepEqual(stages,['permission','video']);
  Object.assign(rig.video,{currentTime:.1}); t.mock.timers.tick(100); await settle(); await start;
  assert.deepEqual(stages,['permission','video','model','detecting']);
  rig.frame.resolve({timestampMs:100,people:[]});await settle();
  assert.equal(stages.at(-1),'tracking'); assert.equal(rig.stats().stoppedTracks,1);
});
test('a non-advancing camera with a pending play promise fails once and cleans up', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const rig=setup(); let errors=0;
  Object.assign(rig.video,{currentTime:0,paused:false});
  rig.video.play=()=>new Promise(()=>{});
  const start=rig.source.start(()=>assert.fail(),error=>{errors++;assert.match(error.message,/görüntüsü ilerlemedi/);});
  await settle();t.mock.timers.tick(12000);await start;
  assert.equal(errors,1);assert.equal(rig.stats().stoppedTracks,1);assert.equal(rig.stats().initializations,0);
  t.mock.timers.tick(20000);assert.equal(errors,1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { CalibrationProfile, CameraPoseObservation } from '@flexivision/contracts';
import {
  NativeSpeechAdapter,
  type NativeTtsDriver,
} from '../src/adapters/nativeSpeech.ts';
import {
  MOBILE_BODY_PROFILE_KEY,
  NativeBodyProfileRepository,
  type NativeStorageDriver,
} from '../src/adapters/nativeStorage.ts';
import {
  NativeCameraPose,
  type NativeCameraDriver,
} from '../src/adapters/nativeCameraPose.ts';

test('NativeSpeechAdapter respects busy state and never queues speech', async () => {
  let speaking = false;
  const spoken: string[] = [];
  let stopped = false;

  const driver: NativeTtsDriver = {
    isSpeaking: () => speaking,
    speak: text => {
      spoken.push(text);
    },
    stop: () => {
      stopped = true;
      speaking = false;
    },
  };

  const adapter = new NativeSpeechAdapter(driver);
  assert.equal(adapter.available, true);

  // First speech succeeds
  await adapter.speak('Gövdeni dik tut.');
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0], 'Gövdeni dik tut.');

  // When driver is busy, speech is skipped
  speaking = true;
  await adapter.speak('Daha derine in.');
  assert.equal(spoken.length, 1);

  // Empty string does not speak
  speaking = false;
  await adapter.speak('   ');
  assert.equal(spoken.length, 1);

  // Cancel stops driver
  adapter.cancel();
  assert.equal(stopped, true);
});

test('NativeBodyProfileRepository persists, reloads, and rejects corrupt data', async () => {
  const store = new Map<string, string>();
  const driver: NativeStorageDriver = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, val) => { store.set(key, val); },
    removeItem: key => { store.delete(key); },
  };

  const now = () => new Date('2026-10-09T10:00:00.000Z');
  const repo = new NativeBodyProfileRepository(driver, now);

  // Initially empty
  const initial = await repo.load();
  assert.equal(initial, null);

  const profile: CalibrationProfile = {
    schemaVersion: 2,
    kind: 'body-calibration',
    qualification: 'not_evaluated',
    policyVersion: 'body-scan-v2',
    width: 640,
    height: 480,
    torsoPixels: 180,
    origin: { x: 0.5, y: 0.5 },
    proportions: {
      shoulderWidth: 0.3,
      hipWidth: 0.25,
      leftThigh: 0.4,
      rightThigh: 0.4,
      leftShin: 0.38,
      rightShin: 0.38,
    },
    neutralAngles: {
      leftKnee: 180,
      rightKnee: 180,
      leftHip: 180,
      rightHip: 180,
      leftElbow: 160,
      rightElbow: 160,
    },
  };

  const saved = await repo.save(profile);
  assert.equal(saved.schemaVersion, 1);
  assert.equal(saved.savedAt, '2026-10-09T10:00:00.000Z');
  assert.equal(store.has(MOBILE_BODY_PROFILE_KEY), true);

  const reloaded = await repo.load();
  assert.ok(reloaded);
  assert.equal(reloaded?.profile.torsoPixels, 180);

  // Corrupt data returns null safely
  store.set(MOBILE_BODY_PROFILE_KEY, '{ invalid json');
  assert.equal(await repo.load(), null);

  // Incomplete schema returns null
  store.set(MOBILE_BODY_PROFILE_KEY, JSON.stringify({ schemaVersion: 99 }));
  assert.equal(await repo.load(), null);

  // Clear removes data
  await repo.clear();
  assert.equal(store.has(MOBILE_BODY_PROFILE_KEY), false);
});

test('NativeCameraPose requests permission and rejects non-monotonic frames', async () => {
  let granted = true;
  let pushFrame = (_obs: CameraPoseObservation) => {};
  let driverStopped = false;

  const driver: NativeCameraDriver = {
    requestPermission: async () => granted,
    start: async onFrame => {
      pushFrame = onFrame;
    },
    stop: () => {
      driverStopped = true;
    },
  };

  const camera = new NativeCameraPose(driver);
  const observations: CameraPoseObservation[] = [];
  const errors: Error[] = [];

  await camera.start(
    obs => observations.push(obs),
    err => errors.push(err)
  );

  assert.ok(pushFrame);

  const makeObs = (timestampMs: number): CameraPoseObservation => ({
    frame: {
      timestampMs,
      people: [{ landmarks: [], worldLandmarks: [] }],
    },
    width: 640,
    height: 480,
  });

  // Push frame at 100ms
  pushFrame!(makeObs(100));
  assert.equal(observations.length, 1);

  // Push frame with backwards timestamp (90ms) -> ignored
  pushFrame!(makeObs(90));
  assert.equal(observations.length, 1);

  // Push forward frame (200ms) -> accepted
  pushFrame!(makeObs(200));
  assert.equal(observations.length, 2);

  camera.stop();
  assert.equal(driverStopped, true);

  // Push frame after stop -> ignored
  pushFrame!(makeObs(300));
  assert.equal(observations.length, 2);

  // Permission failure terminates immediately
  granted = false;
  const rejectedCamera = new NativeCameraPose(driver);
  const rejectErrors: Error[] = [];
  await rejectedCamera.start(
    () => {},
    err => rejectErrors.push(err)
  );
  assert.equal(rejectErrors.length, 1);
  assert.ok(rejectErrors[0]!.message.includes('Kamera izni verilmedi'));
});

test('a late permission grant does not reopen a stopped native camera', async () => {
  let grant!:(value:boolean)=>void, starts=0;
  const permission=new Promise<boolean>(resolve=>{grant=resolve;});
  const camera=new NativeCameraPose({requestPermission:()=>permission,async start(){starts++;},stop(){}});
  const pending=camera.start(()=>assert.fail('No frames'),()=>assert.fail('No error'));
  camera.stop(); grant(true); await pending; assert.equal(starts,0);
});
test('native profile storage failure remains an error instead of a missing profile', async () => {
  const repo = new NativeBodyProfileRepository({ getItem() { throw new Error('Storage unavailable'); }, setItem() {}, removeItem() {} });
  await assert.rejects(repo.load(), /Storage unavailable/);
});
test('cancel during an asynchronous native busy check cannot speak a late warning', async () => {
  let ready!:(value:boolean)=>void, speaks=0;
  const busy=new Promise<boolean>(resolve=>{ready=resolve;});
  const speech=new NativeSpeechAdapter({isSpeaking:()=>busy,speak(){speaks++;},stop(){}});
  const pending=speech.speak('Old warning'); speech.cancel(); ready(false); await pending;
  assert.equal(speaks,0);
});

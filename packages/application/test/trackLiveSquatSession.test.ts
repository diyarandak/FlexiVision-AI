import assert from 'node:assert/strict';
import test from 'node:test';
import type { CalibrationProfile, CameraPoseObservation, JointAngles, MotionMap, SquatTemplate } from '@flexivision/contracts';
import { buildSquatTemplate, detectSquatCycles, evaluateSquatReference } from '@flexivision/core';
import { type LivePoseSource, type SpeechOutput, TrackLiveSquatSession } from '../src/index.ts';

function createReferenceTemplate(): SquatTemplate {
  const ramp = (from: number, to: number, count = 10) =>
    Array.from({ length: count }, (_, i) => from + (to - from) * i / (count - 1));
  const hold = (value: number, count = 8) => Array<number>(count).fill(value);
  const knees = [...hold(170), ...ramp(170, 80), ...hold(80), ...ramp(80, 170), ...hold(170)];

  const samples = knees.map((knee, i) => ({
    timestampMs: i * 100,
    angles2d: {
      leftKnee: knee,
      leftHip: knee,
      rightKnee: null,
      rightHip: null,
      leftElbow: null,
      rightElbow: null,
    } as JointAngles,
  }));

  const map: MotionMap = {
    schemaVersion: 1,
    kind: 'reference-motion-map',
    qualification: 'not_evaluated',
    status: 'extracted',
    sequence: {
      schemaVersion: 1,
      engine: { name: 'mediapipe-pose', version: 'test', model: 'synthetic' },
      durationMs: knees.length * 100,
      width: 720,
      height: 1280,
      sampleFps: 10,
      frames: knees.map((_, i) => ({
        timestampMs: i * 100,
        people: [{
          landmarks: Array.from({ length: 33 }, (_, index) => ({ x: [12, 24].includes(index) ? 0.52 : 0.5, y: [11, 12].includes(index) ? 0.2 : [23, 24].includes(index) ? 0.4 : 0.5, z: 0, visibility: 0.9 })),
          worldLandmarks: [],
        }],
      })),
    },
    samples,
    quality: {
      sampledFrames: knees.length,
      singlePersonFrames: knees.length,
      usableFrames: knees.length,
      multiPersonFrames: 0,
      usableRatio: 1.0,
    },
    ranges: { leftKnee: null, rightKnee: null, leftHip: null, rightHip: null, leftElbow: null, rightElbow: null },
  };

  const analysis = detectSquatCycles(map);
  const { decision } = evaluateSquatReference(map, analysis);
  return buildSquatTemplate(map, 1, decision);
}

test('TrackLiveSquatSession forwards observations, phase matches and respects stop', async () => {
  const template = createReferenceTemplate();
  let stopped = false;
  let pushObservation = (_obs: CameraPoseObservation) => {};

  const source: LivePoseSource = {
    async start(onObservation) {
      pushObservation = onObservation;
    },
    stop() {
      stopped = true;
    },
  };

  const spoken: string[] = [];
  const speech: SpeechOutput = {
    available: true,
    speak(text) { spoken.push(text); },
    cancel() {},
  };

  const session = new TrackLiveSquatSession(source, template, speech);
  const updates: any[] = [];
  await session.start(update => updates.push(update), () => {});

  assert.ok(pushObservation);

  // Send a valid observation
  const obs: CameraPoseObservation = {
    frame: {
      timestampMs: 100,
      people: [{
        landmarks: Array.from({ length: 33 }, (_, index) => ({ x: [12, 24].includes(index) ? 0.52 : 0.5, y: [11, 12].includes(index) ? 0.2 : [23, 24].includes(index) ? 0.4 : 0.5, z: 0, visibility: 0.9 })),
        worldLandmarks: [],
      }],
    },
    width: 640,
    height: 480,
  };

  pushObservation!(obs);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].comparison.timestampMs, 100);

  session.stop();
  assert.equal(stopped, true);

  // Subsequent pushed observation ignored after stop
  pushObservation!(obs);
  assert.equal(updates.length, 1);
});

test('TrackLiveSquatSession tracks session metrics, errors and returns summary', async () => {
  const template = createReferenceTemplate();
  let pushObservation = (_obs: CameraPoseObservation) => {};

  const source: LivePoseSource = {
    async start(onObservation) {
      pushObservation = onObservation;
    },
    stop() {},
  };

  const spoken: string[] = [];
  const speech: SpeechOutput = {
    available: true,
    speak(text) { spoken.push(text); },
    cancel() {},
  };

  const session = new TrackLiveSquatSession(source, template, speech, 0);
  await session.start(() => {}, () => {});

  const makeObs = (timestampMs: number, hasPerson = true): CameraPoseObservation => {
    const landmarks = Array.from({ length: 33 }, (_, index) => ({ x: [12, 24].includes(index) ? 0.52 : 0.5, y: [11, 12].includes(index) ? 0.2 : [23, 24].includes(index) ? 0.4 : 0.5, z: 0, visibility: 0.9 }));
    if (hasPerson) {
      landmarks[11] = { x: 0.5, y: 0.2, z: 0, visibility: 0.9 };
      landmarks[23] = { x: 0.5, y: 0.4, z: 0, visibility: 0.9 };
      landmarks[25] = { x: 0.5, y: 0.6, z: 0, visibility: 0.9 };
      landmarks[27] = { x: 0.5, y: 0.8, z: 0, visibility: 0.9 };
    }
    return {
      frame: {
        timestampMs,
        people: hasPerson ? [{
          landmarks,
          worldLandmarks: [],
        }] : [],
      },
      width: 640,
      height: 480,
    };
  };

  // Push 5 valid frames, 1 lost frame
  for (let i = 0; i < 5; i++) {
    pushObservation(makeObs(i * 200, true));
  }
  pushObservation(makeObs(1000, false));

  const summary = session.getSummary();
  assert.equal(summary.sampledFrames, 6);
  assert.equal(summary.trackedFrames, 5);
  assert.equal(summary.lostFrames, 1);
  assert.equal(summary.durationMs, 1000);
  assert.equal(summary.trackedMs, 800);
  assert.equal(summary.unmeasuredMs, 200);
  assert.equal(summary.repetitionCount, 0);
  assert.equal(summary.cleanRepetitions, 0);
  assert.equal(typeof summary.errorBreakdown, 'object');
  session.stop();
});

function angleObservation(time: number, knee=170, hip=170): CameraPoseObservation {
  const p=Array.from({length:33},()=>({x:0.5,y:0.1,z:0,visibility:0.9}));
  const hipRad=hip*Math.PI/180, kneeRad=knee*Math.PI/180;
  p[23]={x:0.5,y:0.45,z:0,visibility:0.9}; p[24]={x:0.52,y:0.45,z:0,visibility:0.9};
  p[25]={x:0.5,y:0.65,z:0,visibility:0.9};
  p[27]={x:0.5-Math.sin(Math.PI-kneeRad)*0.2,y:0.65+Math.cos(Math.PI-kneeRad)*0.2,z:0,visibility:0.9};
  p[11]={x:0.5-Math.sin(hipRad)*0.2,y:0.45+Math.cos(hipRad)*0.2,z:0,visibility:0.9};
  p[12]={...p[11]!,x:p[11]!.x+0.02};
  return {width:1000,height:1000,frame:{timestampMs:time,people:[{landmarks:p,worldLandmarks:[]}]}};
}
test('first feedback window begins at the first camera observation, not model loading time', async () => {
  let emit: (o:CameraPoseObservation)=>void=()=>{};
  const source:LivePoseSource={async start(cb){emit=cb;},stop(){}};
  const spoken:string[]=[];
  const speech:SpeechOutput={available:true,speak(text,started){spoken.push(text);started?.();},cancel(){}};
  const session=new TrackLiveSquatSession(source,createReferenceTemplate(),speech,0);
  await session.start(()=>{},()=>assert.fail('No errors'));
  for(let t=30000;t<=30200;t+=100) emit(angleObservation(t));
  for(let t=30300;t<40000;t+=100) emit(angleObservation(t,125,60));
  assert.equal(spoken.length,0);
  emit(angleObservation(40000,125,60)); assert.equal(spoken.length,1);
  assert.equal(session.getSummary().spokenCues.length,1);
  session.stop(); emit(angleObservation(40100,125,60)); assert.equal(spoken.length,1);
});
test('an unavailable or skipped speech request is not reported as a spoken warning', async () => {
  let emit:(o:CameraPoseObservation)=>void=()=>{};
  const source:LivePoseSource={async start(cb){emit=cb;},stop(){}};
  let requests=0;
  const session=new TrackLiveSquatSession(source,createReferenceTemplate(),{available:true,speak(){requests++;},cancel(){}},0);
  await session.start(()=>{},()=>assert.fail('No errors'));
  for(let t=0;t<=200;t+=100) emit(angleObservation(t));
  for(let t=300;t<=10000;t+=100) emit(angleObservation(t,125,60));
  assert.equal(requests,1); assert.equal(session.getSummary().cueCandidatesCount,1);
  assert.equal(session.getSummary().spokenCues.length,0);
});
test('rejected speech playback keeps squat tracking alive and does not count a spoken cue', async () => {
  let emit:(o:CameraPoseObservation)=>void=()=>{},failures=0,updates=0;
  const source:LivePoseSource={async start(cb){emit=cb;},stop(){}};
  const session=new TrackLiveSquatSession(source,createReferenceTemplate(),{
    available:true,speak(){return Promise.reject(new Error('audio unavailable'));},
    cancel(){throw new Error('audio cancel unavailable');}
  });
  await session.start(()=>{updates++;},()=>{failures++;});
  for(let t=0;t<=200;t+=100)emit(angleObservation(t));
  for(let t=300;t<=10000;t+=100)emit(angleObservation(t,125,60));
  await Promise.resolve();
  assert.equal(failures,0);
  assert.equal(session.getSummary().cueCandidatesCount,1);
  assert.equal(session.getSummary().spokenCues.length,0);
  emit(angleObservation(10100,125,125));
  assert.equal(failures,0);
  assert.ok(updates>100);
  session.stop();
});
test('a resolved deviation cancels pending speech and a late start receipt is not counted', async () => {
  let emit: (value: CameraPoseObservation) => void = () => {}, receipt: (() => void) | undefined;
  let cancellations = 0, requests = 0;
  const source: LivePoseSource = { async start(callback) { emit = callback; }, stop() {} };
  const speech: SpeechOutput = { available: true, speak(_text, started) { requests++; receipt = started; }, cancel() { cancellations++; } };
  const session = new TrackLiveSquatSession(source, createReferenceTemplate(), speech);
  await session.start(() => {}, () => assert.fail('No errors'));
  for (let time = 0; time <= 200; time += 100) emit(angleObservation(time));
  for (let time = 300; time <= 10000; time += 100) emit(angleObservation(time, 125, 60));
  assert.equal(requests, 1); assert.equal(cancellations, 0);
  emit(angleObservation(10100, 125, 125));
  assert.equal(cancellations, 1);
  receipt?.(); assert.equal(session.getSummary().spokenCues.length, 0);
  for (let time = 10200; time <= 19900; time += 100) emit(angleObservation(time, 125, 60));
  assert.equal(requests, 1);
  emit(angleObservation(20000, 125, 60)); assert.equal(requests, 2);
  receipt?.(); assert.equal(session.getSummary().spokenCues.length, 1);
  session.stop();
});
test('invalid timestamps terminate the live source as a technical failure', async () => {
  let emit:(o:CameraPoseObservation)=>void=()=>{}, stops=0, failures=0;
  const source:LivePoseSource={async start(cb){emit=cb;},stop(){stops++;}};
  const session=new TrackLiveSquatSession(source,createReferenceTemplate());
  await session.start(()=>{},()=>failures++);
  emit(angleObservation(100)); emit(angleObservation(99)); emit(angleObservation(200));
  assert.equal(failures,1); assert.equal(stops,1);
});
test('slow processing is unknown tracking and never earns a correction or a clean repetition', async () => {
  let emit:(o:CameraPoseObservation)=>void=()=>{};
  const source:LivePoseSource={async start(cb){emit=cb;},stop(){}};
  const session=new TrackLiveSquatSession(source,createReferenceTemplate(),{available:true,speak(){assert.fail('No speech');},cancel(){}});
  await session.start(()=>{},()=>assert.fail('No errors'));
  for(let t=0;t<=12000;t+=2000) emit({...angleObservation(t,125,60),processingMs:1900});
  const summary=session.getSummary();
  assert.equal(summary.trackedFrames,0); assert.equal(summary.lostFrames,7);
  assert.equal(summary.cueCandidatesCount,0); assert.equal(summary.cleanRepetitions,0);
  assert.equal(summary.trackedMs, 0); assert.equal(summary.unmeasuredMs, 12000);
  assert.deepEqual(summary.deviations.knee, { samples: 0, mean: null, max: null });
});

test('coverage excludes gaps, unknown frames and the tail after the final observation; deviations use measured matches', async () => {
  let emit: (o: CameraPoseObservation) => void = () => {};
  const source: LivePoseSource = { async start(cb) { emit = cb; }, stop() {} };
  const session = new TrackLiveSquatSession(source, createReferenceTemplate());
  const values: { knee: number; hip: number }[] = [];
  await session.start(update => {
    if (update.comparison.match && update.comparison.observation.status !== 'unknown') {
      const d = update.comparison.match.deviations; values.push({ knee: d.knee!, hip: d.hip! });
    }
  }, () => assert.fail('No errors'));
  emit(angleObservation(100)); emit(angleObservation(200, 169, 160)); emit(angleObservation(300));
  emit({ ...angleObservation(400), frame: { timestampMs: 400, people: [] } });
  emit(angleObservation(500)); emit(angleObservation(600)); emit(angleObservation(1400)); emit(angleObservation(1500));
  const report = session.getSummary(2000);
  assert.equal(report.durationMs, 1900); assert.equal(report.trackedMs, 400); assert.equal(report.unmeasuredMs, 1500);
  assert.equal(report.deviations.knee.samples, values.length);
  assert.equal(report.deviations.hip.mean, Math.round(values.reduce((n, v) => n + v.hip, 0) / values.length * 10) / 10);
  assert.equal(report.deviations.knee.max, Math.max(...values.map(v => v.knee)));
  assert.equal(report.bodyProfileUsed, false); session.stop();
});

test('live session actually normalizes through the saved profile; a new standing anchor discards partial-cycle errors', async () => {
  const profile: CalibrationProfile = { schemaVersion: 2, kind: 'body-calibration', qualification: 'not_evaluated', policyVersion: 'body-scan-v2',
    width: 1280, height: 720, torsoPixels: 200, origin: { x: 0.9, y: 0.9 },
    proportions: { shoulderWidth: 0.8, hipWidth: 0.4, leftThigh: 0.9, rightThigh: 0.9, leftShin: 0.9, rightShin: 0.9 },
    neutralAngles: { leftKnee: 175, rightKnee: 175, leftHip: 170, rightHip: 170, leftElbow: null, rightElbow: null } };
  let emit: (o: CameraPoseObservation) => void = () => {};
  const session = new TrackLiveSquatSession({ async start(cb) { emit = cb; }, stop() {} }, createReferenceTemplate(), undefined, 0, profile);
  await session.start(update => {
    if (update.comparison.bodyPose) assert.notDeepEqual(update.comparison.bodyPose.origin, profile.origin);
  }, () => assert.fail('No errors'));
  emit({ ...angleObservation(0), frame: { timestampMs: 0, people: [] } });
  const knees = [170, 170, 170, 150, 130, 110, 80, 80, 80, 80, 100, 130, 160, 170, 170, 170];
  knees.forEach((knee, i) => emit(angleObservation((i + 1) * 100, knee, knee)));
  const report = session.getSummary();
  assert.equal(report.bodyProfileUsed, true); assert.equal(report.repetitionCount, 1); assert.equal(report.cleanRepetitions, 1);
  assert.equal(report.deviations.knee.samples, 16); session.stop();
});

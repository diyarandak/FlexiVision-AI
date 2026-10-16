import assert from 'node:assert/strict';
import test from 'node:test';
import type { CameraPoseObservation } from '@flexivision/contracts';
import { genericAcceptedTemplate, genericCycle, genericObservation } from '../../core/test/fixtures/genericTemplate.ts';
import { TrackLiveGenericSession, type LivePoseSource, type SpeechOutput } from '../src/index.ts';

test('generic session counts a slower full cycle and stays silent when measured movement matches',async()=>{
  let emit:((value:CameraPoseObservation)=>void)|undefined,stops=0,spoken=0,updates=0;
  const source:LivePoseSource={async start(callback){emit=callback;},stop(){stops++;}};
  const speech:SpeechOutput={available:true,speak(){spoken++;},cancel(){}};
  const session=new TrackLiveGenericSession(source,genericAcceptedTemplate(),speech);
  await session.start(()=>{updates++;},error=>{throw error;});
  const values=genericCycle();
  values.forEach((value,index)=>emit!(genericObservation(value,1000+index*180)));
  assert.equal(session.getSummary().repetitionCount,1);
  assert.equal(session.getSummary().sampledFrames,values.length);
  assert.equal(updates,values.length);
  assert.equal(spoken,0);
  session.stop();
  emit!(genericObservation(0,1000+values.length*180));
  assert.equal(updates,values.length);
  assert.equal(stops,1);
});

test('a slow frame is unknown and cannot produce a spoken correction',async()=>{
  let emit:((value:CameraPoseObservation)=>void)|undefined,spoken=0;
  const source:LivePoseSource={async start(callback){emit=callback;},stop(){}};
  const session=new TrackLiveGenericSession(source,genericAcceptedTemplate(),{available:true,speak(){spoken++;},cancel(){}});
  const states:string[]=[];
  await session.start(update=>states.push(update.comparison.observation.status),error=>{throw error;});
  emit!({...genericObservation(0,1000),processingMs:700});
  assert.deepEqual(states,['unknown']);
  assert.equal(session.getSummary().unmeasuredFrames,1);
  assert.equal(spoken,0);
  session.stop();
});

test('time spent finding the starting pose is excluded from the exercise clock',async()=>{
  let emit:((value:CameraPoseObservation)=>void)|undefined;
  const session=new TrackLiveGenericSession({async start(callback){emit=callback;},stop(){}},genericAcceptedTemplate());
  await session.start(()=>{},error=>{throw error;});
  for(let index=0;index<90;index++)emit!({frame:{timestampMs:1000+index*100,people:[]},width:720,height:1280});
  assert.equal(session.getSummary().durationMs,0);
  genericCycle().forEach((value,index)=>emit!(genericObservation(value,12000+index*180)));
  assert.equal(session.getSummary().repetitionCount,1);
  assert.ok(session.getSummary().durationMs<9000);
  assert.equal(session.getSummary().cueCandidatesCount,0);
  session.stop();
});

test('post-start diagnostics separate setup loss from an interrupted movement',async()=>{
  let emit!:(value:CameraPoseObservation)=>void;
  const session=new TrackLiveGenericSession({async start(callback){emit=callback;},stop(){}},genericAcceptedTemplate());
  await session.start(()=>{},error=>{throw error;});
  emit({frame:{timestampMs:1000,people:[]},width:720,height:1280});
  emit(genericObservation(0,1200));emit(genericObservation(0,1400));
  emit({frame:{timestampMs:1600,people:[]},width:720,height:1280});
  const d=session.getSummary().diagnostics!;
  assert.equal(d.unknownReasons.no_person,2);
  assert.deepEqual(d.postStartUnknownReasons,{no_person:1});
  assert.equal(d.postStartPhaseFrames?.outbound,1);
  assert.equal(d.postStartPhaseFrames?.waiting,1);
  assert.equal(d.cycleInterruptions,1);
  session.stop();
});

test('generic summary includes the measured session tail until the user stops, but not setup time',async()=>{
  let emit:((value:CameraPoseObservation)=>void)|undefined;
  const session=new TrackLiveGenericSession({async start(callback){emit=callback;},stop(){}},genericAcceptedTemplate());
  await session.start(()=>{},error=>{throw error;});
  emit!({frame:{timestampMs:1000,people:[]},width:720,height:1280});
  assert.equal(session.getSummary(9000).durationMs,0);
  emit!(genericObservation(0,10000));
  emit!(genericObservation(0,10200));
  assert.equal(session.getSummary(12500).durationMs,2300);
  assert.equal(session.getSummary(10100).durationMs,0);
  assert.equal(session.getSummary(Number.NaN).durationMs,0);
  session.stop();
});

test('a speech cancellation failure does not interrupt generic camera measurements',async()=>{
  let emit:((value:CameraPoseObservation)=>void)|undefined, failures=0, updates=0;
  const session=new TrackLiveGenericSession({async start(callback){emit=callback;},stop(){}},
    genericAcceptedTemplate(),{available:true,speak(){},cancel(){throw new Error('audio unavailable');}});
  await session.start(()=>{updates++;},()=>{failures++;});
  emit!({...genericObservation(0,1000),processingMs:700});
  emit!(genericObservation(0,1200));
  emit!(genericObservation(0,1400));
  assert.equal(failures,0);
  assert.equal(updates,3);
  session.stop();
});

test('a started correction can finish after a correct frame, but tracking loss cancels it',async()=>{
  let emit!:(value:CameraPoseObservation)=>void, cancels=0, starts=0;
  const session=new TrackLiveGenericSession({async start(callback){emit=callback;},stop(){}},
    genericAcceptedTemplate(),{available:true,speak(_text,onStarted){starts++;onStarted?.();return new Promise<void>(()=>{});},cancel(){cancels++;}});
  await session.start(()=>{},error=>assert.fail(error.message));
  emit(genericObservation(0,1000));emit(genericObservation(0,1200));
  for(let index=1;index<=55;index++){
    const reading=genericObservation(.3,1200+index*200);
    for(const joint of [13,14,15,16])reading.frame.people[0]!.landmarks[joint]!.x+=.2;
    emit(reading);
  }
  assert.equal(starts,1);
  assert.equal(session.getSummary().spokenCuesCount,1);
  const beforeCorrect=cancels;
  emit(genericObservation(.3,12400));
  assert.equal(cancels,beforeCorrect);
  emit({frame:{timestampMs:12600,people:[]},width:720,height:1280});
  assert.equal(cancels,beforeCorrect+1);
  session.stop();
});

test('a correction that has not started is cancelled when its error clears',async()=>{
  let emit!:(value:CameraPoseObservation)=>void, cancels=0, starts=0;
  const session=new TrackLiveGenericSession({async start(callback){emit=callback;},stop(){}},
    genericAcceptedTemplate(),{available:true,speak(){starts++;return new Promise<void>(()=>{});},cancel(){cancels++;}});
  await session.start(()=>{},error=>assert.fail(error.message));
  emit(genericObservation(0,1000));emit(genericObservation(0,1200));
  for(let index=1;index<=55;index++){
    const reading=genericObservation(.3,1200+index*200);
    for(const joint of [13,14,15,16])reading.frame.people[0]!.landmarks[joint]!.x+=.2;
    emit(reading);
  }
  assert.equal(starts,1);
  const beforeCorrect=cancels;
  emit(genericObservation(.3,12400));
  assert.equal(cancels,beforeCorrect+1);
  assert.equal(session.getSummary().spokenCuesCount,0);
  session.stop();
});

test('asymmetric reference tempo and long live pauses do not create false spoken warnings', async()=>{
  const {tempoTemplate,tempoReadings}=await import('../../core/test/fixtures/tempo.ts');
  for(const [out,back] of [[500,6000],[6000,500]] as const){
    let emit!:(o:CameraPoseObservation)=>void,spoken=0;
    const session=new TrackLiveGenericSession({async start(next){emit=next;},stop(){}},tempoTemplate(out,back),
      {available:true,speak(_text,started){spoken++;started?.();},cancel(){}});
    await session.start(()=>{},e=>assert.fail(e.message));
    tempoReadings({out:1000,back:1000,pause:15000,start:29000}).forEach(emit);
    const summary=session.getSummary();assert.equal(summary.repetitionCount,1);assert.equal(summary.cueCandidatesCount,0);assert.equal(spoken,0);
    session.stop();
  }
});

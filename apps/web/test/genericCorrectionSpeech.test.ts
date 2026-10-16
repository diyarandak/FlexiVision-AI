import assert from 'node:assert/strict';
import test from 'node:test';
import type { CameraPoseObservation } from '@flexivision/contracts';
import { TrackLiveGenericSession } from '@flexivision/application';
import { genericAcceptedTemplate, genericObservation } from '../../../packages/core/test/fixtures/genericTemplate.ts';
import { sessionSpeech } from '../src/adapters/sessionSpeech.ts';

test('busy guide releases a live correction without another ten-second wait; delayed native start is recorded', async () => {
  let emit!: (value: CameraPoseObservation) => void, finishGuide!: () => void, nativeStart!: () => void;
  let cancels=0;
  const spoken:string[]=[];
  const channels=sessionSpeech({available:true,cancel(){cancels++;},speak(text,receipt){
    spoken.push(text);
    if(text==='Hazırlık sesi') return new Promise<void>(resolve=>{finishGuide=resolve;});
    nativeStart=receipt!; return new Promise<void>(()=>{});
  }},()=>true,()=>assert.fail('Unexpected speech failure'));
  const session=new TrackLiveGenericSession({async start(callback){emit=callback;},stop(){}},genericAcceptedTemplate(),{
    get available(){return channels.output.available;},
    speak(text,onStarted){return channels.output.speak(text,onStarted);},cancel(){channels.output.cancel();},
  });
  await session.start(()=>{},error=>assert.fail(error.message));
  emit(genericObservation(0,0)); emit(genericObservation(0,200));
  const wrong=(time:number)=>{
    const reading=genericObservation(.3,time);
    for(const joint of [13,14,15,16])reading.frame.people[0]!.landmarks[joint]!.x+=.2;
    emit(reading);
  };
  for(let time=400;time<=12000;time+=200){
    if(time===10000)channels.ready('Hazırlık sesi');
    wrong(time); await Promise.resolve();
  }
  assert.equal(session.getSummary().cueCandidatesCount,0);
  finishGuide(); await Promise.resolve();
  wrong(12200); await Promise.resolve();
  assert.equal(spoken.length,2); assert.match(spoken[1]!,/Bu bölüm farklı/);
  assert.equal(session.getSummary().cueCandidatesCount,1);
  assert.equal(session.getSummary().spokenCuesCount,0);
  wrong(12400); await Promise.resolve(); nativeStart();
  assert.equal(session.getSummary().spokenCuesCount,1);
  assert.equal(session.getSummary().diagnostics!.corrections!.reduce((sum,f)=>sum+f.spokenCount,0),1);
  const beforeLoss=cancels;
  emit({frame:{timestampMs:12600,people:[]},width:720,height:1280});
  assert.equal(cancels,beforeLoss+1);
  session.stop();
});

test('an audible direction finishes through a form difference, but unstarted or lost-tracking directions cancel', async()=>{
  let cancels=0, finish!:()=>void, receipt!:()=>void;
  const channels=sessionSpeech({available:true,cancel(){cancels++;},speak(_text,onStarted){
    receipt=onStarted!;return new Promise<void>(resolve=>{finish=resolve;});
  }},()=>true,()=>assert.fail());
  channels.coach('start','Başlangıç hazır. Ellerini kaldır.'); receipt();
  channels.clearCoach(true); channels.clearCoach(true);
  assert.equal(cancels,0); assert.equal(channels.output.available,false);
  finish();await Promise.resolve();assert.equal(channels.output.available,true);
  channels.coach('return','Ellerini indir.');
  channels.clearCoach(true);assert.equal(cancels,1);
  channels.coach('return-again','Ellerini indir.');receipt();
  channels.clearCoach();assert.equal(cancels,2);
});

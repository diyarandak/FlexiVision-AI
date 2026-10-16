import assert from 'node:assert/strict';
import test from 'node:test';
import type { CameraPoseObservation } from '@flexivision/contracts';
import { FEEDBACK_INTERVAL_MS } from '@flexivision/core';
import { ExtractReferenceMap, TrackStaticSession, type LivePoseSource, type SpeechOutput } from '../src/index.ts';
import { staticMap, staticObservation, staticTemplate } from '../../core/test/fixtures/staticTemplate.ts';

async function fixture(target=30000){
  let emit!:(o:CameraPoseObservation)=>void,fail!:(e:Error)=>void,stops=0,cancels=0,updates=0;
  const spoken:number[]=[],errors:Error[]=[];let time=0;
  const source:LivePoseSource={async start(next,error){emit=next;fail=error;},stop(){stops++;}};
  const speech:SpeechOutput={available:true,speak(_text,onStarted){spoken.push(time);onStarted?.();},cancel(){cancels++;}};
  const session=new TrackStaticSession(source,staticTemplate(),target,speech);
  await session.start(()=>updates++,e=>errors.push(e));
  return {session,fail,spoken,errors,get stops(){return stops;},get cancels(){return cancels;},get updates(){return updates;},
    emit(o:CameraPoseObservation){time=o.frame.timestampMs;emit(o);}};
}
test('static extraction has an explicit acceptance decision and no fabricated repetition',async()=>{
  const map=staticMap();const extractor={async extract(){return map.sequence;},cancel(){}};
  const result=await new ExtractReferenceMap(extractor,'static').execute({uri:'test:static',name:'hold.mp4'},()=>{});
  assert.equal(result.status,'extracted');assert.equal(result.staticAnalysis?.holds.length,1);
  assert.equal(result.decision?.status,'accepted');assert.equal(result.evidence?.completeRepetitions,0);
});
test('static session counts only matched time, stays silent and freezes its summary at completion',async()=>{
  const f=await fixture(5000);for(let t=0;t<=6000;t+=100)f.emit(staticObservation(t));
  const summary=f.session.getSummary(10000);assert.equal(summary.matchedMs,5000);assert.equal(summary.durationMs,5000);
  assert.equal(summary.targetReached,true);assert.deepEqual(f.spoken,[]);assert.equal(f.updates,56);
  f.session.stop();f.session.stop();assert.equal(f.stops,1);
  f.emit(staticObservation(6100));assert.deepEqual(f.session.getSummary(20000),summary);
});
test('static correction starts at the policy interval, correct/unknown cancels and never credits unseen time',async()=>{
  const f=await fixture();for(let t=0;t<=500;t+=100)f.emit(staticObservation(t));
  const first=500+FEEDBACK_INTERVAL_MS;
  for(let t=600;t<first;t+=100)f.emit(staticObservation(t,.6));
  assert.deepEqual(f.spoken,[]);f.emit(staticObservation(first,.6));assert.deepEqual(f.spoken,[first]);
  const cancelBefore=f.cancels;const missing=staticObservation(first+100);missing.frame.people=[];f.emit(missing);
  assert.ok(f.cancels>cancelBefore);
  for(let t=first+200;t<=first+FEEDBACK_INTERVAL_MS;t+=100)f.emit(staticObservation(t));
  assert.deepEqual(f.spoken,[first]);const summary=f.session.getSummary();assert.equal(summary.spokenCuesCount,1);
  assert.equal(summary.matchedMs,FEEDBACK_INTERVAL_MS-200);assert.equal(summary.targetReached,false);
});
test('invalid clocks and late callbacks preserve the last summary and stop the source',async()=>{
  const f=await fixture();for(let t=0;t<=700;t+=100)f.emit(staticObservation(t));
  f.emit(staticObservation(NaN));assert.equal(f.errors.length,1);assert.equal(f.stops,1);
  assert.equal(f.session.getSummary().durationMs,200);
  const updates=f.updates;f.emit(staticObservation(800));assert.equal(f.updates,updates);
  f.fail(new Error('late error'));assert.equal(f.errors.length,1);
});

test('repeated start and late capture callbacks cannot reopen or update a stopped static session', async () => {
  let starts=0, stops=0, captured=0, updates=0, resolveStart!:()=>void;
  let emit!:(o:CameraPoseObservation)=>void, capture!:(t:number)=>void;
  const session=new TrackStaticSession({start(next,_error,onCapture){
    starts++;emit=next;capture=onCapture!;return new Promise(resolve=>{resolveStart=resolve;});
  },stop(){stops++;}}, staticTemplate(),5000);
  const first=session.start(()=>updates++,()=>assert.fail('No errors expected'),()=>captured++);
  await session.start(()=>updates++,()=>assert.fail('No second source expected'));
  assert.equal(starts,1);capture(100);assert.equal(captured,1);
  session.stop();capture(200);emit(staticObservation(200));resolveStart();await first;
  assert.equal(stops,1);assert.equal(captured,1);assert.equal(updates,0);
  await session.start(()=>updates++,()=>{});assert.equal(starts,1);
});
test('target completion releases source without host stop; cleanup failure preserves the completed result', async () => {
  for(const throwOnStop of [false,true]){
    let stops=0, emit!:(o:CameraPoseObservation)=>void,completed=0;const errors:Error[]=[];
    const session=new TrackStaticSession({async start(next){emit=next;},stop(){stops++;if(throwOnStop)throw Error('Cleanup failed');}},staticTemplate(),5000);
    await session.start((_o,r)=>{if(r.completed)completed++;},e=>errors.push(e));
    for(let t=0;t<=6000;t+=100)emit(staticObservation(t));
    assert.equal(stops,1);assert.equal(completed,1);assert.equal(session.getSummary().matchedMs,5000);
    assert.equal(errors.length,throwOnStop?1:0);session.stop();assert.equal(stops,1);
  }
});
test('a new run uses a fresh source and duration counter', async () => {
  const first=await fixture(5000);for(let t=0;t<=5500;t+=100)first.emit(staticObservation(t));
  assert.equal(first.session.getSummary().targetReached,true);assert.equal(first.stops,1);
  const second=await fixture(10000);for(let t=10000;t<=10600;t+=100)second.emit(staticObservation(t));
  assert.equal(second.session.getSummary().matchedMs,100);assert.equal(second.session.getSummary().targetReached,false);
  first.emit(staticObservation(11000));assert.equal(second.session.getSummary().matchedMs,100);second.session.stop();
});

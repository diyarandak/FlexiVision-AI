import assert from 'node:assert/strict';
import test from 'node:test';
import type { CameraPoseObservation, PersonPose, PoseSequence } from '@flexivision/contracts';
import { buildGenericTemplate, buildMotionMap, evaluateGenericReference, isWholeBodyVisible, LiveGenericComparer } from '../src/index.ts';

const hold = (value:number, count=8) => Array<number>(count).fill(value);
const ramp = (from:number,to:number,count=12) => Array.from({length:count},(_,i)=>from+(to-from)*i/(count-1));
const cycle = () => [...hold(0),...ramp(0,1),...hold(1,5),...ramp(1,0),...hold(0)];
function pose(value:number):PersonPose {
  const landmarks = Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:0}));
  const set = (index:number,x:number,y:number) => {landmarks[index]={x,y,z:0,visibility:.95};};
  set(11,.43,.30);set(12,.57,.30);set(23,.45,.55);set(24,.55,.55);
  const dx=.04+.26*value,dy=.30*(1-value);
  set(13,.43-dx/2,.30+dy/2);set(15,.43-dx,.30+dy);
  set(14,.57+dx/2,.30+dy/2);set(16,.57+dx,.30+dy);
  return {landmarks,worldLandmarks:[]};
}
function sequence(values:number[], frameMs=100):PoseSequence {
  return {schemaVersion:1,engine:{name:'mediapipe-pose',version:'test',model:'synthetic'},
    durationMs:values.length*frameMs,width:720,height:1280,sampleFps:1000/frameMs,
    frames:values.map((value,index)=>({timestampMs:index*frameMs,people:[pose(value)]}))};
}
function observation(value:number,time:number):CameraPoseObservation {
  const person=pose(value);
  for(const [index,x,y] of [[0,.5,.16],[25,.45,.72],[26,.55,.72],[27,.45,.93],[28,.55,.93]])
    person.landmarks[index!]={x:x!,y:y!,z:0,visibility:.95};
  return {frame:{timestampMs:time,people:[person]},width:720,height:1280};
}
function acceptedTemplate(){
  const map=buildMotionMap(sequence(cycle()));
  return buildGenericTemplate(map,1,evaluateGenericReference(map).decision);
}

test('generic template follows the visible cycle at a different live tempo',()=>{
  const template=acceptedTemplate();
  const comparer=new LiveGenericComparer(template);
  const output=cycle().map((value,index)=>comparer.compare(observation(value,1000+index*180)));
  assert.equal(output.at(-1)?.repetitionCount,1);
  assert.ok(output.some(item=>item.phase==='outbound'));
  assert.ok(output.some(item=>item.phase==='return'));
  assert.equal(output[0]?.observation.status,'unknown');
});

test('tracking loss and static pose cannot create an invented repetition',()=>{
  const template=acceptedTemplate();
  const still=new LiveGenericComparer(template);
  const samples=hold(0,60).map((value,index)=>still.compare(observation(value,1000+index*150)));
  assert.equal(samples.at(-1)?.repetitionCount,0);
  const interrupted=new LiveGenericComparer(template);
  cycle().forEach((value,index)=>{
    const reading=observation(value,1000+index*150);
    if(index===22)reading.frame.people=[];
    interrupted.compare(reading);
  });
  assert.equal(interrupted.getRepetitionCount(),0);
});

test('full body visibility gates movement and a lost ankle returns to framing before a new start',()=>{
  const comparer=new LiveGenericComparer(acceptedTemplate());
  const initial=observation(0,1000);
  assert.equal(isWholeBodyVisible(initial.frame.people[0]),true);
  assert.equal(comparer.compare(initial).observation.status,'unknown');
  assert.equal(comparer.compare(observation(0,1200)).phase,'outbound');
  const lost=observation(.3,1400);
  lost.frame.people[0]!.landmarks[28]!.visibility=0;
  const interrupted=comparer.compare(lost);
  assert.equal(interrupted.phase,'waiting');
  assert.deepEqual(interrupted.observation,{status:'unknown',reason:'tracking_lost'});
  assert.equal(comparer.compare(observation(.3,1600)).phase,'waiting');
  assert.equal(comparer.compare(observation(0,1800)).phase,'waiting');
  assert.equal(comparer.compare(observation(0,2000)).phase,'outbound');
  assert.equal(comparer.getRepetitionCount(),0);
  const head=observation(0,2200).frame.people[0]!;
  head.landmarks[0]!.visibility=0;
  assert.equal(isWholeBodyVisible(head),false);
  head.landmarks[7]={x:.48,y:.17,z:0,visibility:.9};
  assert.equal(isWholeBodyVisible(head),true);
});

test('unaccepted template is rejected before live tracking',()=>{
  const template=acceptedTemplate();
  assert.throws(()=>new LiveGenericComparer({...template,qualification:'not_evaluated'}));
});

test('live overlay projects the matched reference onto the measured camera body, including a mirrored view',()=>{
  const template=acceptedTemplate(), comparer=new LiveGenericComparer(template);
  const flip=(reading:CameraPoseObservation)=>{
    for(const point of reading.frame.people[0]!.landmarks) if(point.visibility>=.6)point.x=1-point.x;
    return reading;
  };
  const first=comparer.compare(flip(observation(0,1000)));
  assert.equal(first.overlay,null);
  const held=comparer.compare(flip(observation(0,1200)));
  assert.equal(held.observation.status,'correct');
  assert.ok(held.overlay?.joints.length);
  for(const joint of held.overlay!.joints){
    assert.ok(Math.abs(joint.reference.x-joint.observed.x)<1e-10);
    assert.ok(Math.abs(joint.reference.y-joint.observed.y)<1e-10);
    assert.equal(joint.deviating,false);
  }
  const moving=comparer.compare(flip(observation(.35,1400)));
  assert.ok(moving.overlay?.joints.length);
  assert.ok(moving.overlay!.joints.every(joint=>joint.reference.x>=0&&joint.reference.x<=1));
});

test('red overlay markers require a reliable overall path mismatch and local measured deviation',()=>{
  const template=acceptedTemplate(), comparer=new LiveGenericComparer(template);
  comparer.compare(observation(0,1000)); comparer.compare(observation(0,1200));
  const shifted=observation(.3,1400);
  for(const index of template.motionIndices.slice(0,-1))shifted.frame.people[0]!.landmarks[index]!.x+=.2;
  const result=comparer.compare(shifted);
  assert.equal(result.observation.status,'incorrect');
  if(result.observation.status==='incorrect'){
    assert.match(result.observation.errors[0]!.message,/Bu bölüm farklı/);
    assert.match(result.observation.errors[0]!.message,/Sağ dirseğini biraz daha aç/);
  }
  assert.ok(result.overlay?.joints.some(joint=>joint.deviating));
  assert.ok(result.overlay?.joints.some(joint=>!joint.deviating));
  assert.ok(result.overlay!.joints.every(joint=>joint.deviating===
    (joint.deviation>=.28 || joint.index === result.correction?.jointIndex)));
  assert.doesNotMatch(result.observation.status === 'incorrect' ? result.observation.errors[0]!.message : '', /öne|geriye/);
  const uncertain=observation(.3,1600);
  for(const index of template.motionIndices)uncertain.frame.people[0]!.landmarks[index]!.x+=.32;
  const unknown=comparer.compare(uncertain);
  assert.equal(unknown.observation.status,'unknown');
  assert.equal(unknown.overlay,null);
  // A pose outside the reliable path invalidates the partial cycle. The
  // following non-start pose must not resume its old phase or earn a rep.
  const afterUncertain=comparer.compare(observation(.9,1800));
  assert.equal(afterUncertain.phase,'waiting');
  assert.equal(afterUncertain.observation.status,'unknown');
  const lost=observation(.3,2000);lost.frame.people=[];
  assert.equal(comparer.compare(lost).overlay,null);
});

test('a measured vertical joint offset gets an image-plane direction, not an invented depth cue',()=>{
  const comparer=new LiveGenericComparer(acceptedTemplate());
  comparer.compare(observation(0,1000));comparer.compare(observation(0,1200));
  const shifted=observation(.3,1400);
  for(const index of [13,14,15,16])shifted.frame.people[0]!.landmarks[index]!.y+=.14;
  const result=comparer.compare(shifted);
  assert.equal(result.observation.status,'incorrect');
  if(result.observation.status==='incorrect'){
    assert.match(result.observation.errors[0]!.message,/Bu bölüm farklı/);
    assert.match(result.observation.errors[0]!.message,/biraz yukarı kaldır/);
    assert.doesNotMatch(result.observation.errors[0]!.message,/öne|arkaya/);
  }
});

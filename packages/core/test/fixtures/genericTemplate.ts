import type { CameraPoseObservation, PersonPose, PoseSequence } from '@flexivision/contracts';
import { buildGenericTemplate, buildMotionMap, evaluateGenericReference } from '../../src/index.ts';

const hold = (value: number, count = 8) => Array<number>(count).fill(value);
const ramp = (from: number, to: number, count = 12) => Array.from({ length: count }, (_, index) => from + (to-from)*index/(count-1));
export const genericCycle = () => [...hold(0), ...ramp(0,1), ...hold(1,5), ...ramp(1,0), ...hold(0)];
export function genericPose(value: number): PersonPose {
  const landmarks = Array.from({ length:33 }, () => ({ x:.5,y:.5,z:0,visibility:0 }));
  const set = (index:number,x:number,y:number) => { landmarks[index]={x,y,z:0,visibility:.95}; };
  set(11,.43,.30);set(12,.57,.30);set(23,.45,.55);set(24,.55,.55);
  const dx=.04+.26*value,dy=.30*(1-value);
  set(13,.43-dx/2,.30+dy/2);set(15,.43-dx,.30+dy);
  set(14,.57+dx/2,.30+dy/2);set(16,.57+dx,.30+dy);
  return {landmarks,worldLandmarks:[]};
}
export function genericObservation(value:number,time:number):CameraPoseObservation {
  const person=genericPose(value);
  for(const [index,x,y] of [[0,.5,.16],[25,.45,.72],[26,.55,.72],[27,.45,.93],[28,.55,.93]])
    person.landmarks[index!]={x:x!,y:y!,z:0,visibility:.95};
  return {frame:{timestampMs:time,people:[person]},width:720,height:1280};
}
export function genericAcceptedTemplate() {
  const values=genericCycle();
  const sequence:PoseSequence={schemaVersion:1,engine:{name:'mediapipe-pose',version:'test',model:'synthetic'},
    durationMs:values.length*100,width:720,height:1280,sampleFps:10,
    frames:values.map((value,index)=>({timestampMs:index*100,people:[genericPose(value)]}))};
  const map=buildMotionMap(sequence);
  return buildGenericTemplate(map,1,evaluateGenericReference(map).decision);
}

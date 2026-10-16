import type { CameraPoseObservation, GenericMotionTemplate } from '@flexivision/contracts';
import { buildGenericTemplate, buildMotionMap, evaluateGenericReference } from '../../src/index.ts';
import { genericObservation } from './genericTemplate.ts';
export interface Tempo { out:number; back:number; pause?:number; start?:number; step?:number }
/** Continuous path sampled at independent camera times, not a slowed list of video frames. */
export function tempoReadings({out,back,pause=0,start=600,step=50}:Tempo):CameraPoseObservation[] {
  const end=start+out+pause+back+600;
  return Array.from({length:Math.floor(end/step)+1},(_,i)=>{
    const time=i*step;
    const value=time<start?0:time<start+out?(time-start)/out:time<start+out+pause?1:
      time<start+out+pause+back?1-(time-start-out-pause)/back:0;
    return genericObservation(value,time);
  });
}
export function tempoTemplate(out:number,back:number):GenericMotionTemplate {
  const readings=tempoReadings({out,back,pause:300,step:100});
  const map=buildMotionMap({schemaVersion:1,engine:{name:'mediapipe-pose',version:'test',model:'synthetic'},width:720,height:1280,
    sampleFps:10,durationMs:Math.max(3000,readings.at(-1)!.frame.timestampMs+100),frames:readings.map(r=>r.frame)});
  return buildGenericTemplate(map,1,evaluateGenericReference(map).decision);
}

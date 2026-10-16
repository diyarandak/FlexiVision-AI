import type { CameraPoseObservation, MotionMap, PersonPose, StaticSessionSummary } from '@flexivision/contracts';
import { analyzeStaticPose, buildMotionMap } from '../../src/index.ts';
import { genericPose } from './genericTemplate.ts';
export function staticPose(arm=0):PersonPose {
  const pose=genericPose(arm);
  for(const [i,x,y] of [[25,.45,.72],[26,.55,.72],[27,.45,.9],[28,.55,.9]])
    pose.landmarks[i!]={x:x!,y:y!,z:0,visibility:.95};
  return pose;
}
export function staticObservation(time:number,arm=0):CameraPoseObservation {
  return {frame:{timestampMs:time,people:[staticPose(arm)]},width:720,height:1280};
}
export function staticMap(values=Array<number>(41).fill(0)):MotionMap {
  return buildMotionMap({schemaVersion:1,engine:{name:'mediapipe-pose',version:'test',model:'synthetic'},
    width:720,height:1280,durationMs:Math.max(3000,values.length*100),sampleFps:10,
    frames:values.map((v,i)=>staticObservation(i*100,v).frame)});
}
export const staticTemplate=()=>analyzeStaticPose(staticMap()).holds[0]!;
export const staticSummary=():StaticSessionSummary=>({durationMs:8000,matchedMs:5000,targetMs:5000,targetReached:true,
  sampledFrames:86,trackedFrames:60,unmeasuredFrames:26,cueCandidatesCount:0,spokenCuesCount:0});

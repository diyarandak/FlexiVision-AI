import { GENERIC_UNKNOWN_REASONS, type GenericCorrectionFinding, type GenericSessionDiagnostics, type GenericSessionSummary } from '@flexivision/contracts';
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const number=(v:unknown,max=86400000):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
const count=(v:unknown,max:number):v is number=>number(v,max)&&Number.isInteger(v);
/** Optional diagnostic data never invalidates an otherwise usable legacy summary. */
export function genericDiagnosticsData(raw: unknown, summary: GenericSessionSummary): GenericSessionDiagnostics | undefined {
  if(!obj(raw)||raw.schemaVersion!==1||!number(raw.elapsedMs)||typeof raw.measuredStart!=='boolean')return;
  if(raw.measuredStart ? !number(raw.timeToStartMs,raw.elapsedMs) : raw.timeToStartMs!==null)return;
  if(!count(raw.correctFrames,summary.trackedFrames)||!count(raw.incorrectFrames,summary.trackedFrames)
    ||raw.correctFrames+raw.incorrectFrames!==summary.trackedFrames)return;
  const map=(value:unknown,keys:readonly string[],max:number):Record<string,number>|undefined=>{
    if(!obj(value)||Object.keys(value).length>keys.length)return;
    if(!Object.entries(value).every(([key,n])=>keys.includes(key)&&count(n,max)))return;
    return Object.fromEntries(Object.entries(value)) as Record<string,number>;
  };
  const unknownReasons=map(raw.unknownReasons,GENERIC_UNKNOWN_REASONS,summary.unmeasuredFrames);
  const errorCodes=map(raw.errorCodes,['motion_path'],raw.incorrectFrames);
  const jointKeys=Array.from({length:33},(_,i)=>String(i));
  const deviatingJointFrames=map(raw.deviatingJointFrames,jointKeys,raw.incorrectFrames);
  const c=raw.poseCandidates,p=raw.processing;
  if(!obj(c)||!['none','single','multiple'].every(k=>count(c[k],summary.sampledFrames)))return;
  if((c.none as number)+(c.single as number)+(c.multiple as number)!==summary.sampledFrames)return;
  const missingJointFrames=map(raw.missingJointFrames,jointKeys,c.single as number);
  if(!unknownReasons||!errorCodes||!deviatingJointFrames||!missingJointFrames
    ||Object.values(unknownReasons).reduce((a,b)=>a+b,0)!==summary.unmeasuredFrames)return;
  if(!obj(p)||!count(p.samples,summary.sampledFrames))return;
  if(p.samples===0 ? p.meanMs!==null||p.maxMs!==null : !number(p.meanMs)||!number(p.maxMs)||p.meanMs>p.maxMs)return;
  const postStartUnknownReasons=map(raw.postStartUnknownReasons,GENERIC_UNKNOWN_REASONS,summary.unmeasuredFrames);
  const phase=raw.postStartPhaseFrames;
  const postUnknownCount=postStartUnknownReasons ? Object.values(postStartUnknownReasons).reduce((a,b)=>a+b,0) : 0;
  const hasPostStart=raw.postStartUnknownReasons!==undefined || phase!==undefined || raw.cycleInterruptions!==undefined;
  const validPostStart=hasPostStart && postStartUnknownReasons && postUnknownCount<=summary.unmeasuredFrames
    && obj(phase) && Object.keys(phase).length===3
    && ['waiting','outbound','return'].every(key=>count(phase[key],summary.sampledFrames))
    && (phase.waiting as number)+(phase.outbound as number)+(phase.return as number)<=summary.sampledFrames
    && postUnknownCount<=(phase.waiting as number)
    && count(raw.cycleInterruptions,postUnknownCount)
    && (raw.measuredStart || (postUnknownCount===0 && phase.waiting===0 && phase.outbound===0 && phase.return===0));
  const correctionKeys = new Set<string>();
  const validCorrections = Array.isArray(raw.corrections) && raw.corrections.length <= 120
    && raw.corrections.every(value => {
      if (!obj(value) || ![11,12,13,14,15,16,23,24,25,26,27,28].includes(value.jointIndex as number)
        || !['bend','extend','raise','lower','align'].includes(value.action as string)
        || !['outbound','return'].includes(value.phase as string) || !count(value.frames,raw.incorrectFrames as number)
        || value.frames === 0 || !number(value.longestMs,raw.elapsedMs as number)
        || !count(value.spokenCount,Math.min(value.frames,summary.spokenCuesCount))) return false;
      const key = `${value.jointIndex}:${value.action}:${value.phase}`;
      if (correctionKeys.has(key)) return false;
      correctionKeys.add(key); return true;
    }) && raw.corrections.reduce((sum,value) => sum+value.frames,0) <= raw.incorrectFrames;
  const corrections: GenericCorrectionFinding[] | undefined = validCorrections
    ? (raw.corrections as GenericCorrectionFinding[]).map(({jointIndex,action,phase,frames,longestMs,spokenCount}) =>
      ({jointIndex,action,phase,frames,longestMs,spokenCount})) : undefined;
  return {schemaVersion:1,elapsedMs:raw.elapsedMs,measuredStart:raw.measuredStart,timeToStartMs:raw.timeToStartMs as number|null,
    correctFrames:raw.correctFrames,incorrectFrames:raw.incorrectFrames,unknownReasons,errorCodes,deviatingJointFrames,missingJointFrames,
    ...(corrections ? {corrections} : {}),
    poseCandidates:{none:c.none as number,single:c.single as number,multiple:c.multiple as number},
    processing:{samples:p.samples,meanMs:p.meanMs as number|null,maxMs:p.maxMs as number|null},
    ...(validPostStart ? {postStartUnknownReasons,postStartPhaseFrames:{waiting:phase.waiting as number,
      outbound:phase.outbound as number,return:phase.return as number},cycleInterruptions:raw.cycleInterruptions as number} : {})};
}

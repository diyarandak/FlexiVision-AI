import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeStaticPose, isAcceptedStaticTemplate, LiveStaticComparer, staticTemplateData, isStaticSessionSummary } from '../src/index.ts';
import { staticMap, staticObservation, staticTemplate, staticSummary } from './fixtures/staticTemplate.ts';

test('static reference accepts measured holds without a repetition, exposes separate intervals',()=>{
  const result=analyzeStaticPose(staticMap());assert.equal(result.decision.status,'accepted');
  assert.equal(result.evidence.completeRepetitions,0);assert.equal(result.holds[0]!.durationMs,4000);
  assert.ok(isAcceptedStaticTemplate(result.holds[0]));
  const separate=analyzeStaticPose(staticMap([...Array(22).fill(0),...Array(32).fill(1)]));
  assert.equal(separate.holds.length,2);assert.equal(separate.holds[0]!.interval.startMs,2200);
});
test('static reference rejects missing joints, multiple people, too-short holds, timestamps and gaps',()=>{
  const missing=staticMap();missing.sequence.frames.forEach(f=>{f.people[0]!.landmarks[27]!.visibility=0;});
  const multiple=staticMap();multiple.sequence.frames[10]!.people.push(staticObservation(0).frame.people[0]!);
  const short=staticMap(Array.from({length:41},(_,i)=>i%2));
  const invalid=staticMap();invalid.sequence.frames[10]!.timestampMs=NaN;
  const gaps=staticMap();gaps.sequence.frames.forEach((f,i)=>{f.timestampMs=i*400;});gaps.sequence.durationMs=17000;
  const small=staticMap();small.sequence.durationMs=2500;
  for(const map of [missing,multiple,short,invalid,gaps,small]){
    const result=analyzeStaticPose(map);assert.equal(result.decision.status,'rejected');assert.deepEqual(result.holds,[]);
  }
});
test('static live duration pauses on deviation, missing or slow measurements and gaps; target is independent',()=>{
  const c=new LiveStaticComparer(staticTemplate(),5000);
  for(let t=0;t<=1000;t+=100)c.compare(staticObservation(t));
  assert.equal(c.compare(staticObservation(1100)).matchedMs,600);
  const wrong=c.compare(staticObservation(1200,.6));assert.equal(wrong.observation.status,'incorrect');assert.equal(wrong.matchedMs,600);
  assert.ok(wrong.overlay?.joints.some(j=>j.deviating));
  const missing=staticObservation(1300);missing.frame.people=[];
  assert.equal(c.compare(missing).overlay,null);
  assert.equal(c.compare({...staticObservation(1400),processingMs:800}).observation.status,'unknown');
  assert.equal(c.compare(staticObservation(1500)).matchedMs,600);
  assert.equal(c.compare(staticObservation(3000)).matchedMs,600);
  let end=c.compare(staticObservation(3100));
  for(let t=3200;t<=7600;t+=100)end=c.compare(staticObservation(t));
  assert.equal(end.matchedMs,5000);assert.equal(end.completed,true);
  assert.equal(c.compare(staticObservation(7700,.7)).matchedMs,5000);
});
test('static setup requires continuous matching pose and does not credit preparation',()=>{
  const c=new LiveStaticComparer(staticTemplate(),5000);
  assert.equal(c.compare(staticObservation(0,.8)).started,false);
  for(let t=100;t<=500;t+=100)assert.equal(c.compare(staticObservation(t)).started,false);
  const started=c.compare(staticObservation(600));assert.equal(started.started,true);assert.equal(started.matchedMs,0);
  assert.equal(c.compare(staticObservation(700)).matchedMs,100);
});
test('static comparison tolerates translation, scale, mirror and limb-length changes without changing direction',()=>{
  for(const transform of ['scale','mirror','limb'] as const){
    const c=new LiveStaticComparer(staticTemplate(),5000);
    for(let t=0;t<=600;t+=100){
      const o=staticObservation(t);const p=o.frame.people[0]!.landmarks;
      if(transform==='scale')p.forEach(v=>{v.x=.15+v.x*.7;v.y=.1+v.y*.7;});
      if(transform==='mirror')p.forEach(v=>{v.x=1-v.x;});
      if(transform==='limb'){const shoulder=p[11]!,elbow=p[13]!,wrist=p[15]!;
        const dx=(elbow.x-shoulder.x)*.2,dy=(elbow.y-shoulder.y)*.2;elbow.x+=dx;elbow.y+=dy;wrist.x+=dx;wrist.y+=dy;}
      const r=c.compare(o);if(t===600){assert.equal(r.observation.status,'correct',transform);assert.equal(r.matchedMs,100);}
    }
  }
});
test('invalid timing, targets, degenerate templates and impossible summaries fail explicitly',()=>{
  const template=staticTemplate();for(const target of [0,4999,600001,NaN])assert.throws(()=>new LiveStaticComparer(template,target));
  const c=new LiveStaticComparer(template,5000);c.compare(staticObservation(100));assert.throws(()=>c.compare(staticObservation(100)));
  assert.equal(new LiveStaticComparer(template,5000).compare({...staticObservation(0),processingMs:NaN}).observation.status,'unknown');
  const broken=structuredClone(template);broken.landmarks[13]={...broken.landmarks[11]!};assert.equal(isAcceptedStaticTemplate(broken),false);
  Object.assign(template,{video:'private'});assert.equal('video' in staticTemplateData(template),false);
  const summary=staticSummary();assert.ok(isStaticSessionSummary(summary));summary.matchedMs=9000;assert.equal(isStaticSessionSummary(summary),false);
});

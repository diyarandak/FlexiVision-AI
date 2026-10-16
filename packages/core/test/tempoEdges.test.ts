import assert from 'node:assert/strict';
import test from 'node:test';
import type { JointAngles } from '@flexivision/contracts';
import { LiveGenericComparer, LiveSquatComparer } from '../src/index.ts';
import { genericObservation } from './fixtures/genericTemplate.ts';
import { acceptedTemplate } from './fixtures/acceptedTemplate.ts';
import { tempoReadings, tempoTemplate, type Tempo } from './fixtures/tempo.ts';
const liveCases:Tempo[]=[{out:700,back:700},{out:6000,back:6000},{out:500,back:7000,pause:1000},
  {out:7000,back:500},{out:1000,back:1000,pause:15000},{out:1000,back:1000,start:29000}];
for(const [out,back] of [[500,500],[1000,1000],[500,6000],[6000,500]] as const){
  for(const live of liveCases){
    test(`tempo: reference ${out}/${back} ms, live ${JSON.stringify(live)} counts once without false deviation`,()=>{
      const comparer=new LiveGenericComparer(tempoTemplate(out,back));
      const results=tempoReadings(live).map(o=>comparer.compare(o));
      assert.equal(comparer.getRepetitionCount(),1);
      assert.ok(results.every(r=>r.observation.status!=='incorrect'));
      assert.ok(results.every(r=>r.observation.status!=='unknown'||r.observation.reason==='hold_start'));
    });
  }
}
test('camera cadence 5/10/20/30 fps and jitter do not change the supported slow cycle count',()=>{
  for(const step of [200,100,50,1000/30]){
    const c=new LiveGenericComparer(tempoTemplate(500,6000));
    const results=tempoReadings({out:5500,back:1500,step}).map((o,i)=>{
      // Timestamp jitter stays monotonic and within the tracking budget.
      o.frame.timestampMs+=i%3*3;
      return c.compare(o);
    });
    assert.equal(c.getRepetitionCount(),1);assert.ok(results.every(r=>r.observation.status!=='incorrect'));
  }
});
test('a partial return is not counted as a new completed repetition',()=>{
  const c=new LiveGenericComparer(tempoTemplate(6000,500));
  const readings=tempoReadings({out:1500,back:6000});
  readings.filter(o=>o.frame.timestampMs<=6000).forEach(o=>c.compare(o));
  // Live return is only 65% complete; the old index margin already counted it.
  assert.equal(c.getRepetitionCount(),0);
  readings.filter(o=>o.frame.timestampMs>6000).forEach(o=>c.compare(o));assert.equal(c.getRepetitionCount(),1);
});
test('one-frame jumps after a long rest remain uncertain, not a valid repetition or form warning',()=>{
  const c=new LiveGenericComparer(tempoTemplate(1000,1000));
  for(let t=0;t<=10000;t+=100)c.compare(genericObservation(0,t));
  const spike=c.compare(genericObservation(1,10100));
  assert.equal(spike.observation.status,'unknown');assert.equal(spike.overlay,null);
  for(let t=10200;t<=11000;t+=100)c.compare(genericObservation(0,t));assert.equal(c.getRepetitionCount(),0);
  tempoReadings({out:1000,back:1000}).forEach(o=>{o.frame.timestampMs+=11200;c.compare(o);});assert.equal(c.getRepetitionCount(),1);
});
test('gap, occlusion, extra person and processing delay discard only the partial generic cycle',()=>{
  for(const failure of ['gap','missing','multiple','slow']){
    const c=new LiveGenericComparer(tempoTemplate(1000,1000));let offset=0;
    for(let run=0;run<3;run++){
      const readings=tempoReadings({out:1000,back:1000});
      for(const o of readings){
        const local=o.frame.timestampMs;o.frame.timestampMs+=offset;
        if(run===1&&local===1500){
          if(failure==='gap'){offset+=1000;o.frame.timestampMs+=1000;}
          if(failure==='missing')o.frame.people=[];
          if(failure==='multiple')o.frame.people.push(structuredClone(o.frame.people[0]!));
          if(failure==='slow')o.processingMs=800;
        }
        c.compare(o);
      }
      offset=readings.at(-1)!.frame.timestampMs+100;
    }
    assert.equal(c.getRepetitionCount(),2,failure);
  }
});
test('unfinished generic movement times out without inventing a repetition and can restart',()=>{
  const c=new LiveGenericComparer(tempoTemplate(1000,1000));
  const results=tempoReadings({out:1000,back:1000,pause:32000}).map(o=>c.compare(o));
  assert.ok(results.some(r=>r.observation.status==='unknown'&&r.observation.reason==='cycle_timeout'));
  assert.equal(c.getRepetitionCount(),0);
  const offset=results.at(-1)!.timestampMs+100;
  tempoReadings({out:1000,back:1000}).forEach(o=>{o.frame.timestampMs+=offset;c.compare(o);});assert.equal(c.getRepetitionCount(),1);
});
test('squat fast/slow and uneven phases are aligned by angles, including a bottom pause',()=>{
  for(const tempo of [{out:700,back:700,pause:300},{out:9000,back:9000},{out:500,back:7000,pause:1000},
    {out:7000,back:500,pause:300},{out:1000,back:1000,pause:15000}]){
    const c=new LiveSquatComparer(acceptedTemplate());
    const results=tempoReadings({...tempo,step:20}).map(o=>{
      const v=(.39-o.frame.people[0]!.landmarks[15]!.x)/.26,knee=170-90*v;
      return c.compareAngles(o.frame.timestampMs,{leftKnee:knee,leftHip:knee,rightKnee:null,rightHip:null,leftElbow:null,rightElbow:null} as JointAngles);
    });
    assert.equal(c.getRepetitionCount(),1,JSON.stringify(tempo));assert.ok(results.every(r=>r.observation.status==='correct'));
  }
});
test('invalid processing durations cannot pass either live comparer',()=>{
  for(const processingMs of [NaN,Infinity,-1,501]){
    const generic=new LiveGenericComparer(tempoTemplate(1000,1000)).compare({...genericObservation(0,0),processingMs});
    const squat=new LiveSquatComparer(acceptedTemplate()).compare({...genericObservation(0,0),processingMs});
    for(const r of [generic,squat]){assert.equal(r.observation.status,'unknown');if(r.observation.status==='unknown')assert.equal(r.observation.reason,'processing_slow');}
  }
});

test('a sub-second return cannot become a valid repetition merely by waiting at the endpoint',()=>{
  const c=new LiveGenericComparer(tempoTemplate(1000,1000));
  const results=tempoReadings({out:400,back:400,step:50}).map(o=>c.compare(o));
  for(let time=results.at(-1)!.timestampMs+50;time<=6000;time+=50)c.compare(genericObservation(0,time));
  assert.equal(c.getRepetitionCount(),0);
  assert.ok(results.some(r=>r.observation.status==='unknown'&&r.observation.reason==='cycle_too_short'));
});

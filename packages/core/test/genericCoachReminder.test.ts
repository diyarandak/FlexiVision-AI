import assert from 'node:assert/strict';
import test from 'node:test';
import { genericCoachReminder } from '../src/genericCoachReminder.ts';
import type { GenericLiveResult } from '../src/liveGeneric.ts';

const instructions = {startInstruction:'Kollarını aşağıda tut.',outbound:'Ellerini yukarı kaldır.',returning:'Ellerini aşağı indir.'};
const reading = (timestampMs: number, phase: GenericLiveResult['phase'] = 'outbound', progress = .1,
  observation: GenericLiveResult['observation'] = {status:'correct'}, repetitionCount = 0) => ({timestampMs,phase,progress,observation,repetitionCount});
const hold = (next: ReturnType<typeof genericCoachReminder>, start: number, end: number, phase: GenericLiveResult['phase'] = 'outbound', progress = .1,
  observation: GenericLiveResult['observation'] = {status:'correct'}) => {
  let cue = null;
  for(let time=start;time<=end;time+=250) cue=next(reading(time,phase,progress,observation));
  return cue;
};

test('ten seconds of observed stillness offers a current, deduplicable reminder without praising form',()=>{
  const next=genericCoachReminder(instructions);
  assert.equal(hold(next,0,9750),null);
  const cue=next(reading(10000));
  assert.match(cue!.text,/Hazır olduğunda ellerini yukarı kaldır/);
  assert.doesNotMatch(cue!.text,/doğru|uygun|tamamlandı|Harika|Evet/);
  assert.equal(next(reading(10250))!.key,cue!.key);
  assert.equal(hold(next,10500,21750)!.key,cue!.key);
  assert.notEqual(next(reading(22000))!.key,cue!.key);
});

test('ongoing small movements accumulate and retire reminders; direction and repetition reset their clock',()=>{
  const next=genericCoachReminder(instructions);
  for(let time=0;time<=15000;time+=250) assert.equal(next(reading(time,'outbound',time/60000)),null);
  const cue=hold(next,15250,25500,'outbound',.25);
  assert.ok(cue);
  assert.equal(next(reading(25750,'outbound',.3)),null);
  assert.equal(next(reading(26000,'return',.8)),null);
  assert.match(hold(next,26250,36000,'return',.8)!.text,/ellerini aşağı indir.*Başlangıca dönünce/);
  assert.equal(next(reading(36250,'outbound',.1,{status:'correct'},1)),null);
});

test('unknown measurements, differences and long gaps never turn into movement instructions',()=>{
  for (const observation of [{status:'unknown',reason:'camera_view'}, {status:'unknown',reason:'tracking_lost'},
    {status:'incorrect',errors:[{code:'motion_path',message:'Fark',severity:.4}]}] as GenericLiveResult['observation'][]) {
    const next=genericCoachReminder(instructions);
    hold(next,0,9750);
    assert.equal(hold(next,10000,22000,'outbound',.1,observation),null);
    assert.equal(next(reading(22250)),null);
  }
  const next=genericCoachReminder(instructions);
  next(reading(0)); assert.equal(next(reading(12000)),null);
  assert.equal(next(reading(NaN)),null);
  assert.equal(next(reading(12250)),null);
});

test('a stalled unconfirmed start explains camera angle and offers an example, never movement approval',()=>{
  const next=genericCoachReminder(instructions);
  const cue=hold(next,0,10000,'waiting',0,{status:'unknown',reason:'find_start'});
  assert.ok(cue!.showExample);
  assert.match(cue!.text,/Kollarını aşağıda tut.*aynı açıdan.*aynı yerde olman gerekmiyor/);
  assert.equal(next(reading(10250,'waiting',0,{status:'unknown',reason:'hold_start'})),null);
});

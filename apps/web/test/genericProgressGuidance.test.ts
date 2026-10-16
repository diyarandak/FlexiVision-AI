import assert from 'node:assert/strict';
import test from 'node:test';
import { genericProgressGuidance } from '../src/genericProgressGuidance.ts';
import type { GenericLiveResult } from '@flexivision/core';

const frame = (phase: GenericLiveResult['phase'], status: 'correct' | 'incorrect' | 'unknown', repetitionCount = 0, timestampMs = 0, progress = phase==='outbound'?.2:phase==='return'?.8:0) => ({
  phase, repetitionCount, timestampMs, progress,
  observation: status === 'unknown' ? { status, reason: 'tracking_lost' }
    : status === 'incorrect' ? { status, errors: [{ code: 'motion_path', message: 'Fark', severity: .3 }] }
      : { status },
}) as Pick<GenericLiveResult, 'timestampMs' | 'phase' | 'progress' | 'repetitionCount' | 'observation'>;

test('reports one measured turn and a clean full repetition, never praises partial movement', () => {
  const next = genericProgressGuidance();
  assert.equal(next(frame('waiting','correct')),null);
  assert.equal(next(frame('outbound','correct')),null);
  assert.equal(next(frame('outbound','correct')),null);
  assert.match(next(frame('return','correct'))?.text ?? '',/Başlangıç duruşuna dön/);
  assert.equal(next(frame('return','correct')),null);
  assert.deepEqual(next(frame('waiting','correct',1)),{
    kind:'completed',assessment:'near',text:'Evet, ölçülen tam tekrarı referansa uygun yaptın.',
  });
  assert.equal(next(frame('waiting','correct',1)),null);
});

test('speaks once for a continuous measured near segment even before a full repetition', () => {
  const next = genericProgressGuidance();
  assert.equal(next(frame('outbound','correct',0,1000)),null);
  assert.equal(next(frame('outbound','correct',0,2500)),null);
  assert.match(next(frame('outbound','correct',0,3000))?.text ?? '',/Evet, görünen hareketi şu anda referansa uygun yapıyorsun/);
  assert.equal(next(frame('outbound','correct',0,4000)),null);
  assert.equal(next(frame('waiting','unknown',0,4200)),null);
  assert.equal(next(frame('outbound','correct',0,5000)),null);
  assert.equal(next(frame('outbound','correct',0,7200)),null);
});

test('holding the start pose does not earn a correct-movement voice', () => {
  const next = genericProgressGuidance();
  assert.equal(next(frame('outbound','correct',0,1000,0)),null);
  assert.equal(next(frame('outbound','correct',0,5000,0)),null);
  assert.equal(next(frame('outbound','correct',0,5100,.2)),null);
  assert.equal(next(frame('outbound','correct',0,7100,.2))?.kind,'near');
});

test('reentering framing after earlier repetitions does not announce an old repetition again', () => {
  const next = genericProgressGuidance(2);
  assert.equal(next(frame('waiting','unknown',2,1000)),null);
  assert.equal(next(frame('outbound','correct',2,1200)),null);
  assert.equal(next(frame('return','correct',2,2000))?.kind,'return');
  assert.equal(next(frame('waiting','correct',3,2400))?.kind,'completed');
});

test('an incorrect or unknown frame never earns a near cue and restarts the stability clock', () => {
  const next = genericProgressGuidance();
  next(frame('outbound','correct',0,1000));
  assert.equal(next(frame('outbound','incorrect',0,2500)),null);
  assert.equal(next(frame('outbound','correct',0,3000)),null);
  assert.equal(next(frame('outbound','correct',0,4900)),null);
  assert.equal(next(frame('waiting','unknown',0,5000)),null);
  assert.equal(next(frame('outbound','correct',0,6000)),null);
  assert.equal(next(frame('outbound','correct',0,7900)),null);
  assert.equal(next(frame('outbound','correct',0,8000))?.kind,'near');
});

test('a measured difference prevents a clean-repetition claim; unknown tracking resets the cycle', () => {
  const next = genericProgressGuidance();
  next(frame('outbound','correct'));
  next(frame('outbound','incorrect'));
  assert.equal(next(frame('return','incorrect')),null);
  assert.equal(next(frame('return','correct'))?.kind,'return');
  assert.match(next(frame('waiting','correct',1))?.text ?? '',/Bazı bölümlerde referans farkı/);
  next(frame('outbound','correct',1));
  assert.equal(next(frame('waiting','unknown',1)),null);
  assert.equal(next(frame('waiting','correct',1)),null);
  next(frame('outbound','correct',1));
  assert.match(next(frame('waiting','correct',2))?.text ?? '',/referansa uygun yaptın/);
});

test('return coaching follows the selected exercise instead of telling every user to stand up',()=>{
  const next=genericProgressGuidance(0,{outbound:'Ellerini yukarı kaldır.',returning:'Ellerini aşağı indir.'});
  next(frame('outbound','correct',0,1000));
  assert.equal(next(frame('return','correct',0,2000))?.text,'Ellerini aşağı indir.');
});
test('a sustained correction recovery is acknowledged only in the same phase and after two seconds',()=>{
  const next=genericProgressGuidance(0,{outbound:'Ellerini yukarı kaldır.',returning:'Ellerini aşağı indir.'});
  next(frame('outbound','incorrect',0,1000));
  assert.equal(next(frame('outbound','correct',0,1200)),null);
  assert.equal(next(frame('outbound','correct',0,3100)),null);
  assert.match(next(frame('outbound','correct',0,3200))?.text??'',/şimdi referansa daha yakın.*Ellerini yukarı kaldır/);
  assert.equal(next(frame('outbound','correct',0,3300)),null);
  next(frame('outbound','incorrect',0,3400));
  assert.equal(next(frame('waiting','unknown',0,3500)),null);
  assert.doesNotMatch(next(frame('return','correct',0,5600))?.text??'',/şimdi referansa daha yakın/);
});

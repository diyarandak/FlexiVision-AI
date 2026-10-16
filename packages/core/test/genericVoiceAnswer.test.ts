import test from 'node:test';
import assert from 'node:assert/strict';
import { genericVoiceAnswer } from '../src/genericVoiceAnswer.ts';
import { genericCoachingPlan } from '../src/genericCoaching.ts';
import type { GenericLiveResult } from '../src/liveGeneric.ts';
import { genericAcceptedTemplate } from './fixtures/genericTemplate.ts';

const plan = genericCoachingPlan(genericAcceptedTemplate());
const result = (changes: Partial<GenericLiveResult> = {}): GenericLiveResult => ({
  timestampMs: 1000, phase: 'outbound', progress: .3, repetitionCount: 2,
  observation: { status: 'correct' }, matchedTemplateIndex: 15, deviation: 0, overlay: null, ...changes,
});
const context = (value: GenericLiveResult | null, fresh = true) => ({ plan, result: value, fresh, guidance: 'Ayakların kamerada görünsün.' });

test('voice answers distinguish the start pose, a measured section and missing tracking', () => {
  assert.match(genericVoiceAnswer('check_form', context(result({ progress: 0 }))), /hareketi henüz ölçmedim/);
  assert.match(genericVoiceAnswer('check_form', context(result())), /şu anda görünen bölüm referansa yakın/);
  const unknown = genericVoiceAnswer('check_form', context(result({ observation: { status: 'unknown', reason: 'tracking_lost' } })));
  assert.match(unknown, /Henüz doğru veya yanlış diyemiyorum/);
  assert.match(unknown, /Ayakların kamerada/);
  assert.doesNotMatch(genericVoiceAnswer('check_form', context(result(), false)), /Evet|uygun|yakın/);
  assert.match(genericVoiceAnswer('check_form', context(null)), /güncel ölçüm alamıyorum/);
});

test('questions answer the current direction and measured difference instead of repeating an old cue', () => {
  assert.equal(genericVoiceAnswer('next_step', context(result())), plan.outbound);
  assert.equal(genericVoiceAnswer('repeat_guidance', context(result({ phase: 'return' }))), plan.returning);
  const different = result({ observation: { status: 'incorrect', errors: [{ code: 'motion_path', message: 'Sol elini aşağı indir.', severity: .3 }] } });
  assert.equal(genericVoiceAnswer('check_form', context(different)), 'Sol elini aşağı indir.');
});

test('demonstration and measured repetition counts remain available without current body tracking', () => {
  assert.match(genericVoiceAnswer('show_movement', context(null, false)), /Örneği gösteriyorum.*Ellerini yukarı kaldır.*ellerini aşağı indir/);
  assert.equal(genericVoiceAnswer('hide_movement', context(null, false)), 'Örneği kapattım. Kamerada hareketine devam edebilirsin.');
  assert.equal(genericVoiceAnswer('progress', context(result(), false)), '2 tam tekrar ölçtüm.');
  assert.match(genericVoiceAnswer('progress', context(null)), /Henüz tam bir tekrar ölçmedim/);
  assert.equal(genericVoiceAnswer('progress', { ...context(result({ repetitionCount:6 })), goal:{sets:2,repetitionsPerSet:5} }),
    'Toplam 6 tekrar ölçtüm. 1 set tamamlandı. Şimdi 2. settesin; bu sette 1/5 tekrar.');
});

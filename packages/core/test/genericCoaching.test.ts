import assert from 'node:assert/strict';
import test from 'node:test';
import { genericCoachingPlan } from '../src/genericCoaching.ts';
import { genericAcceptedTemplate } from './fixtures/genericTemplate.ts';

test('a two-arm reference teaches the outbound and opposite return movement', () => {
  const template = genericAcceptedTemplate(), plan = genericCoachingPlan(template);
  assert.ok(plan.peakIndex > 0 && plan.peakIndex < 50);
  assert.equal(plan.outbound, 'Ellerini yukarı kaldır.');
  assert.equal(plan.returning, 'Ellerini aşağı indir.');
  assert.deepEqual(plan.movingIndices, [15, 16]);
  assert.match(plan.startInstruction,/kollarını aşağıda tut/);
});

test('symmetric horizontal movement teaches separation without guessing depth', () => {
  const template = genericAcceptedTemplate();
  for (const sample of template.samples) for (const index of template.motionIndices) {
    if (sample.landmarks[index]) sample.landmarks[index]!.y = template.samples[0]!.landmarks[index]!.y;
  }
  const plan = genericCoachingPlan(template);
  assert.equal(plan.outbound, 'Ellerini iki yana aç.');
  assert.equal(plan.returning, 'Ellerini birbirine yaklaştır.');
  assert.doesNotMatch(plan.outbound + plan.returning, /ileri|geri|yukarı|aşağı/);
});
test('an ambiguous one-sided horizontal movement keeps the visual target without guessing forward or back',()=>{
  const template=genericAcceptedTemplate();template.motionIndices=[15];
  for(const sample of template.samples) if(sample.landmarks[15]) sample.landmarks[15]!.y=template.samples[0]!.landmarks[15]!.y;
  const plan=genericCoachingPlan(template);
  assert.match(plan.outbound,/turuncu hedef/);assert.doesNotMatch(plan.outbound,/ileri|geri|iki yana/);
});

test('a one-sided leg reference names the measured leg and leaves the other alone', () => {
  const template = genericAcceptedTemplate();
  template.motionIndices = [25, 27];
  for (const sample of template.samples) {
    const lift = Math.sin(sample.progress * Math.PI);
    sample.landmarks[25] = { x: -.2, y: .7 - lift * .3 };
    sample.landmarks[27] = { x: -.2, y: 1.3 - lift * .8 };
  }
  const plan = genericCoachingPlan(template);
  assert.equal(plan.outbound, 'Sol ayağını yukarı kaldır.');
  assert.equal(plan.returning, 'Sol ayağını aşağı indir.');
  assert.deepEqual(plan.movingIndices, [27]);
});

test('a single moving knee is not classified as a squat merely because its pixels move downward',()=>{
  const template=genericAcceptedTemplate();template.motionIndices=[25];
  for(const sample of template.samples) sample.landmarks[25]={x:-.2,y:.7+Math.sin(sample.progress*Math.PI)*.5};
  const plan=genericCoachingPlan(template);
  assert.equal(plan.outbound,'Sol dizini aşağı indir.');
  assert.equal(plan.returning,'Sol dizini yukarı kaldır.');
  assert.doesNotMatch(plan.outbound+plan.returning,/çömel|ayağa kalk/i);
});

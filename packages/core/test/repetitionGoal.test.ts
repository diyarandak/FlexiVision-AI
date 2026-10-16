import assert from 'node:assert/strict';
import test from 'node:test';
import { isRepetitionGoal, repetitionGoalProgress, repetitionAnnouncement } from '../src/repetitionGoal.ts';
import { LiveGenericComparer } from '../src/liveGeneric.ts';
import { genericAcceptedTemplate, genericCycle, genericObservation } from './fixtures/genericTemplate.ts';

test('five measured repetitions complete one set and multiple sets retain their own counter', () => {
  const goal = { sets: 2, repetitionsPerSet: 5 };
  assert.deepEqual(repetitionGoalProgress(goal, 1), { target:10,total:1,complete:false,completedSets:0,currentSet:1,inSet:1 });
  assert.deepEqual(repetitionGoalProgress(goal, 5), { target:10,total:5,complete:false,completedSets:1,currentSet:2,inSet:0 });
  assert.equal(repetitionGoalProgress(goal, 6).inSet, 1);
  assert.deepEqual(repetitionGoalProgress(goal, 10), { target:10,total:10,complete:true,completedSets:2,currentSet:2,inSet:5 });
  assert.equal(repetitionGoalProgress(goal, 11).total, 10);
  assert.equal(repetitionGoalProgress({ sets:1,repetitionsPerSet:5 }, 5).complete, true);
});

test('partial movement and lost framing cannot advance the workout target', () => {
  const comparer = new LiveGenericComparer(genericAcceptedTemplate());
  let time = 0;
  const feed = (value:number) => comparer.compare(genericObservation(value, time += 180));
  for (const value of genericCycle()) feed(value);
  assert.equal(comparer.getRepetitionCount(), 1);
  for (const value of [0,0,0,.1,.3,.5]) feed(value);
  comparer.unknown(time += 180, 'tracking_lost');
  for (let index=0;index<10;index++) feed(0);
  assert.equal(repetitionGoalProgress({ sets:1,repetitionsPerSet:5 }, comparer.getRepetitionCount()).inSet, 1);
});

test('count speech numbers every repetition and separates completion from reference quality', () => {
  const goal = { sets:2,repetitionsPerSet:5 };
  assert.equal(repetitionAnnouncement(goal, 1, 'near'), '1 tamamlandı. Evet, referansa uygun.');
  assert.match(repetitionAnnouncement(goal, 5, 'different'), /^5 tamamlandı.*referans farkı.*1\. set tamamlandı.*2\. sete geç/);
  assert.doesNotMatch(repetitionAnnouncement(goal, 5, 'different'), /Evet|Hedefin tamamlandı/);
  assert.match(repetitionAnnouncement(goal, 10, 'unknown'), /^5 tamamlandı\. 2\. set tamamlandı\. Hedefin tamamlandı\. Toplam 10 tekrar/);
  assert.equal(repetitionAnnouncement(goal, 0, 'near'), '');
  for (const bad of [null,{sets:0,repetitionsPerSet:5},{sets:11,repetitionsPerSet:5},{sets:1,repetitionsPerSet:NaN},{sets:1,repetitionsPerSet:1.5}]) assert.equal(isRepetitionGoal(bad), false);
});

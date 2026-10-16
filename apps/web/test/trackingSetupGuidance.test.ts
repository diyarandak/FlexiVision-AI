import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveStaticComparer } from '@flexivision/core';
import { staticObservation, staticTemplate } from '../../../packages/core/test/fixtures/staticTemplate.ts';
import { sessionSpeech } from '../src/adapters/sessionSpeech.ts';
import { trackingSetupGuidance } from '../src/adapters/trackingSetupGuidance.ts';

function fixture() {
  const spoken: string[] = []; let cancellations = 0;
  const channels = sessionSpeech({ available: true, speak(text) { spoken.push(text); }, cancel() { cancellations++; } },
    () => true, () => assert.fail('Unexpected audio failure'));
  return { spoken, channels, guidance: trackingSetupGuidance(channels, 0), cancelled: () => cancellations };
}

test('stable tracking loss speaks after measured recovery, while brief losses and correct frames stay quiet', () => {
  const f = fixture();
  f.guidance.announce('Hazırlan', 0);
  f.guidance.update(null, '', 7000);
  assert.equal(f.cancelled(), 2); // Initial replacement and retirement after recovery.
  f.guidance.update('no_person', 'Kadraja gir', 8000);
  f.guidance.update(null, '', 8500);
  f.guidance.update('no_person', 'Kadraja gir', 9000);
  f.guidance.update('no_person', 'Kadraja gir', 9500);
  assert.deepEqual(f.spoken, ['Hazırlan']);
  f.guidance.update('no_person', 'Kadraja gir', 9600);
  f.guidance.update('no_person', 'Kadraja gir', 16599);
  assert.deepEqual(f.spoken, ['Hazırlan', 'Kadraja gir']);
  f.guidance.update('no_person', 'Kadraja gir', 16600);
  assert.deepEqual(f.spoken, ['Hazırlan', 'Kadraja gir', 'Kadraja gir']);
  f.guidance.update(null, '', 17000);
  f.guidance.update(null, '', 30000);
  assert.equal(f.spoken.length, 3);
});

test('changing missing joints starts a new stability interval and retires the outdated guide', () => {
  const f = fixture();
  f.guidance.update('body_not_visible', 'Ayakların görünsün', 7000);
  f.guidance.update('body_not_visible', 'Omuzların görünsün', 7500);
  f.guidance.update('body_not_visible', 'Omuzların görünsün', 8099);
  assert.deepEqual(f.spoken, []);
  f.guidance.update('body_not_visible', 'Omuzların görünsün', 8100);
  const before = f.cancelled();
  f.guidance.update('body_not_visible', 'Ayakların görünsün', 8200);
  assert.equal(f.cancelled(), before + 1);
  assert.deepEqual(f.spoken, ['Omuzların görünsün']);
});

test('clearing a placement guide never cancels a form correction and hold messages do not repeat', () => {
  const f = fixture();
  f.guidance.update('hold_start', 'Böyle kal', 7000, false);
  f.guidance.update('hold_start', 'Böyle kal', 7600, false);
  f.guidance.update('hold_start', 'Böyle kal', 20000, false);
  assert.deepEqual(f.spoken, ['Böyle kal']);
  f.channels.output.speak('Güncel referans farkı');
  const before = f.cancelled();
  f.guidance.update(null, '', 20100);
  assert.equal(f.cancelled(), before);
});

test('static hold continues placement recovery after its started flag remains true', () => {
  const f = fixture(), comparer = new LiveStaticComparer(staticTemplate(), 30000);
  for (let time = 0; time <= 9000; time += 100) {
    const input = staticObservation(time);
    if (time >= 8000) input.frame.people = [];
    const result = comparer.compare(input);
    if (time >= 8000) assert.equal(result.started, true);
    f.guidance.update(result.observation.status === 'unknown' ? result.observation.reason : null,
      'Kadraja gir', time, result.observation.status !== 'unknown' || result.observation.reason !== 'hold_start');
  }
  assert.deepEqual(f.spoken, ['Kadraja gir']);
});

test('startup waiting is spoken once even if model preparation spans many reminder intervals',()=>{
  const f=fixture();f.guidance.announce('Kamerayı hazırlıyorum',0);
  for(let now=250;now<=60000;now+=250)
    f.guidance.update('startup_preparing','Hazır olduğunda haber vereceğim',now,false);
  assert.deepEqual(f.spoken,['Kamerayı hazırlıyorum','Hazır olduğunda haber vereceğim']);
  f.guidance.update('no_person','Kadraja gir',60250);
  f.guidance.update('no_person','Kadraja gir',61000);
  assert.equal(f.spoken.at(-1),'Kadraja gir');
});

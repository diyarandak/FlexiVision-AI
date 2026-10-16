import assert from 'node:assert/strict';
import test from 'node:test';
import { CalibrationVoicePolicy } from '../src/calibrationVoice.ts';

test('setup guidance ignores rapidly flickering issues and announces the current stable one', () => {
  const voice = new CalibrationVoicePolicy(); voice.begin(0);
  assert.equal(voice.next('ankles', 4100), false);
  assert.equal(voice.next('hips', 4200), false);
  assert.equal(voice.next('ankles', 4300), false);
  assert.equal(voice.next('ankles', 7000), true);
  assert.equal(voice.next('hips', 7100), false);
  assert.equal(voice.next('hold', 7700), false);
  assert.equal(voice.next('hold', 15000), true);
});
test('a continuing setup issue can repeat, while hold cues do not loop', () => {
  const voice = new CalibrationVoicePolicy(); voice.begin(0);
  voice.next('ankles', 1000);
  assert.equal(voice.next('ankles', 7000), true);
  assert.equal(voice.next('ankles', 9000), false);
  assert.equal(voice.next('ankles', 14000), true);
  voice.next('hold', 15000, false);
  assert.equal(voice.next('hold', 21000, false), true);
  assert.equal(voice.next('hold', 40000, false), false);
});
test('setup voice rejects invalid clocks', () => {
  const voice = new CalibrationVoicePolicy(); voice.begin(10);
  assert.throws(() => voice.next('any', 9), /clock/);
  assert.throws(() => voice.next('any', NaN), /clock/);
});

test('tracking recovery clears an old issue and later loss can speak without restarting the session', () => {
  const voice = new CalibrationVoicePolicy(); voice.begin(0);
  voice.next('ankles', 1000);
  assert.equal(voice.next('ankles', 7000), true);
  assert.equal(voice.next(null, 7300), false);
  assert.equal(voice.next(null, 20000), false); // Correct movement stays silent.
  assert.equal(voice.next('ankles', 20100), false); // Earlier loss is not retained.
  assert.equal(voice.next(null, 20400), false);
  assert.equal(voice.next('ankles', 20700), false);
  assert.equal(voice.next('ankles', 21200), false);
  assert.equal(voice.next('ankles', 21300), true);
  voice.next(null, 21400);
  voice.next('shoulders', 22000);
  assert.equal(voice.next('shoulders', 23000), false); // Still respects the 7 s cooldown.
  assert.equal(voice.next('shoulders', 28300), true);
});

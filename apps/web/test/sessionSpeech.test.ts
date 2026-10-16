import assert from 'node:assert/strict';
import test from 'node:test';

test('each new count interrupts a long guide and survives routine tracking transitions without queuing', () => {
  const spoken:string[] = [];
  let starts = 0, cancellations = 0;
  const channels = sessionSpeech({ available:true, cancel(){cancellations++;}, speak(text, receipt){
    spoken.push(text);receipt?.();return new Promise<void>(()=>{});
  } }, () => true, () => assert.fail());
  channels.coach('return', 'Başlangıca dön.');
  channels.count('1 tamamlandı.', () => starts++);
  const afterCount = cancellations;
  channels.clearCoach(); channels.clearSetup(); channels.clearAnswer(); channels.output.cancel();
  channels.setup('Kadraja gir.'); channels.coach('start','Harekete başla.'); channels.output.speak('Fark');
  assert.equal(cancellations, afterCount);
  channels.count('2 tamamlandı.', () => starts++);
  assert.deepEqual(spoken, ['Başlangıca dön.','1 tamamlandı.','2 tamamlandı.']);
  assert.equal(starts, 2);
});
import { sessionSpeech } from '../src/adapters/sessionSpeech.ts';

test('a requested answer supersedes teaching and survives routine frames until context is invalidated', async () => {
  const spoken: string[] = []; let cancels = 0;
  const channels = sessionSpeech({ available: true, cancel() { cancels++; }, speak(text, receipt) {
    spoken.push(text); receipt?.(); return new Promise<void>(() => {});
  } }, () => true, () => assert.fail());
  channels.coach('start', 'Harekete başla');
  channels.answer('Ellerini yukarı kaldır');
  channels.clearCoach(); channels.output.cancel(); channels.setup('Bekleyen kurulum');
  channels.output.speak('Eski fark'); channels.coach('return', 'Eski talimat');
  assert.deepEqual(spoken, ['Harekete başla', 'Ellerini yukarı kaldır']);
  assert.equal(cancels, 1);
  channels.clearAnswer(); assert.equal(cancels, 2);
  channels.setup('Kadraja dön'); assert.equal(spoken.at(-1), 'Kadraja dön');
});

test('teaching finishes the current sentence and only accepts the latest fresh phase after it', async () => {
  const spoken: string[] = [];
  let finish!: () => void, cancels = 0;
  const channels = sessionSpeech({ available: true, cancel() { cancels++; }, speak(text, receipt) {
    spoken.push(text); receipt?.(); return new Promise<void>(resolve => { finish = resolve; });
  } }, () => true, () => assert.fail());
  channels.coach('start', 'Ellerini kaldır');
  channels.coach('near', 'Evet'); channels.coach('return', 'Ellerini indir');
  assert.deepEqual(spoken, ['Ellerini kaldır']); assert.equal(cancels, 0);
  finish(); await Promise.resolve();
  assert.equal(spoken.length, 1); // No queued near/return speech after settlement.
  channels.coach('return', 'Ellerini indir');
  assert.deepEqual(spoken, ['Ellerini kaldır', 'Ellerini indir']);
  finish(); await Promise.resolve(); channels.coach('return', 'Ellerini indir');
  assert.equal(spoken.length, 2);
  channels.clearCoach(); channels.setup('Kadraja dön');
  assert.equal(spoken.at(-1), 'Kadraja dön');
});

test('teaching yields to an ongoing correction and visibility loss invalidates late starts', async () => {
  let finish!: () => void, started = 0;
  const spoken: string[] = [], receipts: (() => void)[] = [];
  const channels = sessionSpeech({ available: true, cancel() {}, speak(text, receipt) {
    spoken.push(text); receipts.push(receipt!); return new Promise<void>(resolve => { finish = resolve; });
  } }, () => true, () => assert.fail());
  channels.output.speak('Güncel fark');
  channels.coach('return', 'Geri dön'); assert.equal(spoken.length, 1);
  finish(); await Promise.resolve();
  channels.coach('return', 'Geri dön', () => started++);
  channels.clearCoach(); receipts[1]!(); assert.equal(started, 0);
});

test('tracking cancellation preserves setup guidance but cancels an exercise correction', () => {
  let cancels = 0, enabled = true, started = 0;
  const spoken: string[] = [];
  const channels = sessionSpeech({ available: true, cancel() { cancels++; }, speak(text, receipt) { spoken.push(text); receipt?.(); } }, () => enabled, () => assert.fail());
  channels.setup('Başlangıç duruşuna geç'); const afterSetup = cancels;
  channels.output.cancel(); channels.output.cancel(); assert.equal(cancels, afterSetup);
  channels.output.speak('Güncel fark', () => started++); assert.equal(started, 1);
  channels.output.cancel(); channels.output.cancel(); assert.equal(cancels, afterSetup + 1);
  enabled = false; channels.setup('Sessiz'); channels.output.speak('Sessiz');
  assert.equal(channels.output.available, false); assert.equal(spoken.length, 2);
});

test('sync and async speech failures are reported without breaking camera callbacks', async () => {
  let errors = 0;
  const channels = sessionSpeech({ available: true, cancel() {}, speak() { throw new Error('engine'); } }, () => true, () => errors++);
  assert.doesNotThrow(() => channels.setup('Hazır')); assert.equal(errors, 1);
  const asyncChannels = sessionSpeech({ available: true, cancel() {}, async speak() { throw new Error('engine'); } }, () => true, () => errors++);
  asyncChannels.output.speak('Düzelt'); await Promise.resolve(); assert.equal(errors, 2);
});

test('recovered tracking cancels a setup guide once and never cancels a current correction', () => {
  let cancels = 0, setupStarts = 0, correctionStarts = 0;
  const starts: (() => void)[] = [];
  const channels = sessionSpeech({ available: true, cancel() { cancels++; }, speak(_text, receipt) { starts.push(receipt!); } }, () => true, () => assert.fail());
  channels.setup('Kadrajda görün', () => setupStarts++);
  const beforeRecovery = cancels;
  channels.clearSetup(); channels.clearSetup();
  assert.equal(cancels, beforeRecovery + 1);
  starts[0]!(); assert.equal(setupStarts, 0); // canceled native starts are not counted
  channels.setup('Güncel kadraj', () => setupStarts++); starts[1]!(); assert.equal(setupStarts, 1);
  channels.clearSetup();
  channels.output.speak('Güncel fark', () => correctionStarts++);
  const beforeCorrection = cancels;
  channels.clearSetup(); assert.equal(cancels, beforeCorrection);
  starts[2]!(); assert.equal(correctionStarts, 1);
  channels.output.cancel();
});

test('superseded asynchronous speech failures and starts do not contaminate the current guide', async () => {
  let errors = 0, starts = 0;
  let rejectOld!: (error: Error) => void;
  let startOld!: () => void;
  let calls = 0;
  const channels = sessionSpeech({ available: true, cancel() {}, speak(_text, receipt) {
    if (++calls === 1) { startOld = receipt!; return new Promise<void>((_resolve, reject) => { rejectOld = reject; }); }
    receipt?.();
  } }, () => true, () => errors++);
  channels.setup('Eski', () => starts++); channels.setup('Güncel', () => starts++);
  rejectOld(new Error('canceled')); startOld(); await Promise.resolve();
  assert.equal(starts, 1); assert.equal(errors, 0);
});

test('a native cancellation failure cannot interrupt recovered camera callbacks', () => {
  let errors = 0;
  const channels = sessionSpeech({ available: true, cancel() { throw new Error('engine'); }, speak() {} }, () => true, () => errors++);
  channels.setup('Güncel');
  assert.doesNotThrow(() => channels.clearSetup()); assert.equal(errors, 1);
});

test('a correction skipped during setup cannot steal or cancel the setup audio', async () => {
  let endGuide!: () => void;
  let cancels = 0, correctionStarts = 0;
  const spoken: string[] = [];
  const channels = sessionSpeech({ available: true, cancel() { cancels++; }, speak(text, receipt) {
    spoken.push(text); receipt?.();
    if (text === 'Kadraj') return new Promise<void>(resolve => { endGuide = resolve; });
  } }, () => true, () => assert.fail());
  channels.setup('Kadraj'); const setupCancels = cancels;
  channels.output.speak('Eski fark', () => correctionStarts++);
  channels.output.cancel();
  assert.deepEqual(spoken, ['Kadraj']); assert.equal(cancels, setupCancels);
  assert.equal(correctionStarts, 0);
  endGuide(); await Promise.resolve();
  channels.output.speak('Güncel fark', () => correctionStarts++);
  assert.deepEqual(spoken, ['Kadraj', 'Güncel fark']); assert.equal(correctionStarts, 1);
  channels.clearSetup(); assert.equal(cancels, setupCancels);
  channels.output.cancel(); assert.equal(cancels, setupCancels + 1);
});

test('measured start cue survives quiet correct frames and yields to a current placement guide',async()=>{
  const spoken:string[]=[],receipts:(()=>void)[]=[];
  let cancels=0,started=0;
  const channels=sessionSpeech({available:true,cancel(){cancels++;},speak(text,receipt){spoken.push(text);receipts.push(receipt!);return new Promise<void>(()=>{});}},
    ()=>true,()=>assert.fail('No speech failure'));
  channels.setup('Kadrajda görün');
  channels.clearSetup();
  channels.milestone('Başlangıç bulundu. Hareketine başla.',()=>started++);
  const afterStart=cancels;
  channels.clearSetup();channels.output.speak('Erken düzeltme');
  assert.equal(cancels,afterStart);
  assert.deepEqual(spoken,['Kadrajda görün','Başlangıç bulundu. Hareketine başla.']);
  receipts[1]!();assert.equal(started,1);
  channels.setup('Ayakların görünsün');
  assert.deepEqual(spoken,['Kadrajda görün','Başlangıç bulundu. Hareketine başla.','Ayakların görünsün']);
  assert.equal(cancels,afterStart+1);
  receipts[1]!();assert.equal(started,1);
});


test('actual camera readiness finishes before routine placement and never approves a movement', async () => {
  const spoken: string[] = []; let end!: () => void;
  const channels = sessionSpeech({available:true,cancel(){},speak(text){
    spoken.push(text); return new Promise<void>(resolve => { end = resolve; });
  }}, () => true, () => assert.fail());
  channels.ready('Kamera analizi hazır. Kameranın karşısına geç.');
  channels.setup('Başın görünsün'); channels.clearSetup();
  channels.coach('start', 'Başlangıcı bul'); channels.output.speak('Eski fark');
  assert.deepEqual(spoken, ['Kamera analizi hazır. Kameranın karşısına geç.']);
  end(); await Promise.resolve(); channels.setup('Başın görünsün');
  assert.equal(spoken.at(-1), 'Başın görünsün');
});

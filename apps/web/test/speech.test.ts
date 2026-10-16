import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserSpeech, type BrowserSpeechFailure } from '../src/adapters/speech.ts';

test('setup voice replaces stale speech; exercise speech keeps its existing busy behavior; cancel releases callbacks', t => {
  const descriptors = ['window', 'document', 'SpeechSynthesisUtterance'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const spoken: { text: string; lang: string; onstart: (() => void) | null; onerror: (() => void) | null; onend: (() => void) | null }[] = [];
  let cancels = 0, errors = 0, starts = 0;
  class Utterance { lang = ''; onstart: (() => void) | null = null; onerror: (() => void) | null = null; onend: (() => void) | null = null; constructor(readonly text: string) {} }
  const synth = { speaking: true, cancel: () => { cancels++; }, speak: (value: Utterance) => { spoken.push(value); } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { speechSynthesis: synth } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false } });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
  t.after(() => { descriptors.forEach(([key, descriptor]) => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }); });
  createBrowserSpeech().speak('exercise'); assert.equal(spoken.length, 0);
  const setup = createBrowserSpeech({ replace: true, onError: () => { errors++; } });
  setup.speak('current guide', () => starts++); assert.equal(spoken[0]?.lang, 'tr-TR');
  assert.equal(starts,0); spoken[0]?.onstart?.(); assert.equal(starts,1);
  setup.speak('profile saved'); assert.equal(spoken[0]?.onerror, null);
  assert.equal(spoken[0]?.onstart, null);
  assert.equal(spoken[1]?.text, 'profile saved');
  spoken[1]?.onerror?.(); assert.equal(errors, 1);
  setup.speak('another'); setup.cancel(); assert.equal(spoken[2]?.onerror, null);
  assert.equal(cancels, 4);
});

test('local Turkish voice is preferred; a voice that never starts times out without a false receipt', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const descriptors = ['window', 'document', 'SpeechSynthesisUtterance'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  t.after(() => descriptors.forEach(([key, value]) => value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key)));
  class Utterance {
    lang = ''; voice: unknown = null; rate = 1;
    onstart: (() => void) | null = null; onerror: (() => void) | null = null; onend: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  const local = { lang: 'tr-TR', localService: true };
  const spoken: Utterance[] = []; let errors = 0, starts = 0;
  const synth = { speaking: false, pending: false, cancel() {},
    getVoices: () => [{ lang: 'en-US', localService: true }, { lang: 'tr-TR', localService: false }, local],
    speak: (value: Utterance) => spoken.push(value) };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { speechSynthesis: synth } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false } });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
  const speech = createBrowserSpeech({ onError: () => errors++ });
  speech.speak('güncel uyarı', () => starts++); const lateStart = spoken[0]!.onstart;
  speech.speak('kuyruğa girmemeli'); assert.equal(spoken.length, 1);
  assert.equal(spoken[0]!.voice, local);
  t.mock.timers.tick(4000); assert.equal(errors, 1); lateStart?.(); assert.equal(starts, 0);
  speech.speak('yeniden dene', () => starts++); spoken[1]!.onstart?.();
  t.mock.timers.tick(4000); assert.equal(errors, 1); assert.equal(starts, 1);
  speech.cancel();
});

test('missing end event recovers, paused speech resumes and late events cannot affect a new cue', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const descriptors = ['window', 'document', 'SpeechSynthesisUtterance'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  t.after(() => descriptors.forEach(([key, value]) => value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key)));
  class Utterance {
    onstart: (() => void) | null = null; onerror: (() => void) | null = null; onend: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  const spoken: Utterance[] = []; let errors = 0, starts = 0, resumes = 0;
  const synth = { speaking: false, pending: false, paused: true, cancel() {}, resume() { resumes++; },
    speak(value: Utterance) { spoken.push(value); this.speaking = true; } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { speechSynthesis: synth } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false } });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
  const speech = createBrowserSpeech({ onError: () => errors++ });
  speech.speak('Bir', () => starts++);
  const lateStart = spoken[0]!.onstart, lateEnd = spoken[0]!.onend;
  lateStart?.(); lateStart?.(); assert.equal(starts, 1); assert.equal(resumes, 1);
  t.mock.timers.tick(8000); assert.equal(errors, 1);
  // The browser still says speaking even though the owned utterance timed out.
  speech.speak('İki', () => starts++); assert.equal(spoken.length, 2);
  lateStart?.(); lateEnd?.(); assert.equal(starts, 1);
  spoken[1]!.onstart?.(); assert.equal(starts, 2); spoken[1]!.onend?.();
  t.mock.timers.tick(20000); assert.equal(errors, 1);
  speech.speak('Üç'); assert.equal(spoken.length, 3);
  const other = createBrowserSpeech(); other.speak('Başka'); assert.equal(spoken.length, 3);
  speech.cancel();
});

test('a fresh session recovers stale native busy flags and stale owners cannot cancel its speech', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const descriptors = ['window', 'document', 'SpeechSynthesisUtterance'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  t.after(() => descriptors.forEach(([key, value]) => value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key)));
  class Utterance {
    onstart: (() => void) | null = null; onerror: (() => void) | null = null; onend: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  const spoken: Utterance[] = []; let cancels = 0, errors = 0;
  const synth = { speaking: false, pending: false, cancel() { cancels++; },
    speak(value: Utterance) { spoken.push(value); this.speaking = true; } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { speechSynthesis: synth } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false } });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
  const previous = createBrowserSpeech({ replace: true, onError: () => errors++ });
  previous.speak('Önceki'); spoken[0]!.onstart?.(); previous.cancel();
  const next = createBrowserSpeech(); next.speak('Yeni oturum'); assert.equal(spoken.length, 2);
  const cancelCount = cancels;
  previous.cancel(); assert.equal(cancels, cancelCount); // old cleanup cannot cut the new owner
  spoken[1]!.onstart?.(); spoken[1]!.onend?.();
  next.speak('Güncel uyarı'); assert.equal(spoken.length, 3);
  // Replacing an owned utterance must retire its watchdog, not produce a late error.
  previous.speak('Yeni kurulum'); spoken[3]!.onstart?.(); spoken[3]!.onend?.();
  t.mock.timers.tick(25000); assert.equal(errors, 0); next.cancel();
});

test('missing onend with an idle native engine releases ownership without a false playback error', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const descriptors = ['window', 'document', 'SpeechSynthesisUtterance'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  t.after(() => descriptors.forEach(([key, value]) => value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key)));
  class Utterance {
    onstart: (() => void) | null = null; onerror: (() => void) | null = null; onend: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  const spoken: Utterance[] = []; const failures: BrowserSpeechFailure[] = [];
  const synth = { speaking: false, pending: false, cancel() {}, speak(value: Utterance) { spoken.push(value); } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { speechSynthesis: synth } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false } });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
  const speech = createBrowserSpeech({ onError: reason => failures.push(reason) });
  let settled = false;
  void Promise.resolve(speech.speak('Kadraj')).then(() => { settled = true; });
  spoken[0]!.onstart?.(); await Promise.resolve(); assert.equal(settled, false);
  t.mock.timers.tick(8000);
  await Promise.resolve(); assert.equal(settled, true);
  assert.deepEqual(failures, []);
  speech.speak('Güncel yönlendirme'); assert.equal(spoken.length, 2);
  t.mock.timers.tick(4000); assert.deepEqual(failures, ['start_timeout']);
  speech.cancel();
});

test('native errors have bounded diagnostic reasons, and intentional cancellation ignores late errors', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const descriptors = ['window', 'document', 'SpeechSynthesisUtterance'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  t.after(() => descriptors.forEach(([key, value]) => value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key)));
  class Utterance {
    onstart: (() => void) | null = null; onerror: ((event: { error: string }) => void) | null = null; onend: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  const spoken: Utterance[] = []; const failures: BrowserSpeechFailure[] = [];
  const synth = { speaking: false, pending: false, cancel() {}, speak(value: Utterance) { spoken.push(value); } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { speechSynthesis: synth } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false } });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
  const speech = createBrowserSpeech({ onError: reason => failures.push(reason) });
  let settled = false;
  void Promise.resolve(speech.speak('İlk')).then(() => { settled = true; }); const lateError = spoken[0]!.onerror;
  await Promise.resolve(); assert.equal(settled, false);
  speech.cancel(); await Promise.resolve(); assert.equal(settled, true);
  lateError?.({ error: 'interrupted' }); assert.deepEqual(failures, []);
  speech.speak('İkinci'); spoken[1]!.onerror?.({ error: 'not-allowed' });
  speech.speak('Üçüncü'); spoken[2]!.onerror?.({ error: 'untrusted arbitrary detail' });
  assert.deepEqual(failures, ['not_allowed', 'synthesis_failed']);
  speech.cancel();
});

test('first idle speech does not cancel the native engine before speaking',t=>{
  const descriptors=['window','document','SpeechSynthesisUtterance'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
  t.after(()=>descriptors.forEach(([key,value])=>value?Object.defineProperty(globalThis,key,value):Reflect.deleteProperty(globalThis,key)));
  class Utterance {onstart:(()=>void)|null=null;onend:(()=>void)|null=null;onerror:(()=>void)|null=null;constructor(readonly text:string){}}
  let cancels=0;const spoken:Utterance[]=[];
  const synth={speaking:false,pending:false,cancel(){cancels++;},speak(value:Utterance){spoken.push(value);}};
  Object.defineProperty(globalThis,'window',{configurable:true,value:{speechSynthesis:synth}});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{hidden:false}});
  Object.defineProperty(globalThis,'SpeechSynthesisUtterance',{configurable:true,value:Utterance});
  const speech=createBrowserSpeech();speech.cancel();speech.speak('Hazırlanıyor');
  assert.equal(cancels,0);assert.equal(spoken.length,1);
  spoken[0]!.onstart?.();spoken[0]!.onend?.();speech.cancel();assert.equal(cancels,0);
});

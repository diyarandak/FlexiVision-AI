import assert from 'node:assert/strict';
import test from 'node:test';
import { parseVoiceCommand, type VoiceCommand } from '@flexivision/core';
import { BrowserVoiceCommands, type Recognition, type VoiceCommandStatus } from '../src/adapters/voiceCommands.ts';

class FakeRecognition implements Recognition {
  lang = ''; continuous = false; interimResults = false; maxAlternatives = 0; aborted = 0;
  onstart: Recognition['onstart'] = null; onresult: Recognition['onresult'] = null;
  onerror: Recognition['onerror'] = null; onend: Recognition['onend'] = null;
  start() { this.onstart?.(); } abort() { this.aborted++; }
  say(text: string, index = 0, final = true) {
    const results = Array.from({ length: index + 1 }, (_, i) => ({ isFinal: final, 0: { transcript: i === index ? text : '' } }));
    this.onresult?.({ resultIndex: index, results });
  }
}
test('only explicit completed Turkish commands map to actions', () => {
  assert.equal(parseVoiceCommand('BİTİR!'), 'finish');
  assert.equal(parseVoiceCommand('Flexi, sesi kapat.'), 'mute');
  assert.equal(parseVoiceCommand('Sesi aç'), 'unmute');
  for (const text of ['bitirme', 'sesi kapatma', 'birazdan bitir desem', 'sesi', '', 'bitir ve tekrar başlat']) assert.equal(parseVoiceCommand(text), null);
});
test('natural exercise questions and a wake prefix map to supported answers without guessing negation', () => {
  assert.equal(parseVoiceCommand('Flexi, hareketi gösterir misin?'), 'show_movement');
  assert.equal(parseVoiceCommand('kaldır'), 'hide_movement');
  assert.equal(parseVoiceCommand('tamam'), 'hide_movement');
  assert.equal(parseVoiceCommand('kapat'), 'hide_movement');
  assert.equal(parseVoiceCommand('rehberi kaldır'), 'hide_movement');
  assert.equal(parseVoiceCommand('Şimdi ne yapacağım?'), 'next_step');
  assert.equal(parseVoiceCommand('DOĞRU YAPIYOR MUYUM?'), 'check_form');
  assert.equal(parseVoiceCommand('Bir daha söyle.'), 'repeat_guidance');
  assert.equal(parseVoiceCommand('Kaç tekrar yaptım?'), 'progress');
  assert.equal(parseVoiceCommand('Beni duyuyor musun?'), 'help');
  for (const text of ['hareketi gösterme', 'kaldırma', 'kapatma', 'doğru yaptığımı söyle', 'bitir demedim', 'sorunca hareketi göster', 'ne'])
    assert.equal(parseVoiceCommand(text), null);
});
test('voice input ignores partial, duplicate, echo, hidden and late events; fatal errors do not restart', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const engines: FakeRecognition[] = [], commands: VoiceCommand[] = [], states: VoiceCommandStatus[] = [];
  let speaking = false, hidden = false, now = 0;
  const control = new BrowserVoiceCommands(command => commands.push(command), status => states.push(status),
    () => { const engine = new FakeRecognition(); engines.push(engine); return engine; }, () => speaking, () => hidden, () => now);
  assert.equal(engines.length, 0); control.start();
  const first = engines[0]!; assert.equal(first.lang, 'tr-TR'); assert.equal(first.continuous, true);
  first.say('bitir', 0, false); assert.deepEqual(commands, []);
  first.say('sesi kapat', 0); first.say('sesi kapat', 0); first.say('sesi kapat', 1);
  assert.deepEqual(commands, ['mute']);
  speaking = true; first.say('bitir', 2); speaking = false; first.say('bitir', 2);
  hidden = true; first.say('bitir', 3); hidden = false;
  now = 2000; first.say('sesi aç', 4); assert.deepEqual(commands, ['mute', 'unmute']);
  const late = first.onresult; first.onerror?.({ error: 'not-allowed' });
  late?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'bitir' } }] });
  t.mock.timers.tick(20000); assert.equal(engines.length, 1); assert.equal(states.at(-1), 'error');
  assert.equal(first.aborted, 1); assert.deepEqual(commands, ['mute', 'unmute']);
});
test('service silence endings never automatically reopen the microphone, even after long listening', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const engines: FakeRecognition[] = [], states: VoiceCommandStatus[] = [];
  const control = new BrowserVoiceCommands(() => {}, status => states.push(status),
    () => { const engine = new FakeRecognition(); engines.push(engine); return engine; }, () => false, () => false, () => 60000);
  control.start(); engines[0]!.onend?.();
  t.mock.timers.tick(120000);
  control.setOutputActive(true); control.setOutputActive(false); t.mock.timers.tick(1000);
  assert.equal(engines.length, 1); assert.equal(states.at(-1), 'error');
  control.start(); assert.equal(engines.length, 2); control.stop();
});

test('a recognition engine that never starts times out, aborts and can be explicitly retried', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const engines: FakeRecognition[] = [], states: VoiceCommandStatus[] = [], commands: VoiceCommand[] = [];
  const control = new BrowserVoiceCommands(command => commands.push(command), status => states.push(status),
    () => { const engine = new FakeRecognition(); engine.start = () => {}; engines.push(engine); return engine; },
    () => false, () => false, () => 0);
  control.start(); const late = engines[0]!.onstart;
  t.mock.timers.tick(14999); assert.equal(states.at(-1), 'starting');
  t.mock.timers.tick(1); assert.equal(states.at(-1), 'error'); assert.equal(engines[0]!.aborted, 1);
  late?.(); engines[0]!.say('bitir'); assert.equal(states.at(-1), 'error'); assert.deepEqual(commands, []);
  t.mock.timers.tick(30000); assert.equal(engines.length, 1); // no new permission attempt
  control.start(); engines[1]!.onstart?.(); t.mock.timers.tick(15000);
  assert.equal(states.at(-1), 'listening'); control.stop();
});

test('coach speech defers microphone startup and resumes only while the user still wants listening', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const engines:FakeRecognition[]=[], states:VoiceCommandStatus[]=[];
  const control=new BrowserVoiceCommands(()=>{},state=>states.push(state),()=>{const engine=new FakeRecognition();engines.push(engine);return engine;},()=>false,()=>false);
  control.setOutputActive(true);control.start();
  assert.equal(engines.length,0);assert.equal(states.at(-1),'speaking');
  control.setOutputActive(false);t.mock.timers.tick(300);
  assert.equal(engines.length,1);assert.equal(states.at(-1),'listening');
  control.setOutputActive(true);assert.equal(engines[0]!.aborted,0);
  control.setOutputActive(false);control.setOutputActive(true);t.mock.timers.tick(300);
  assert.equal(engines.length,1);
  control.stop();control.setOutputActive(false);t.mock.timers.tick(1000);
  assert.equal(engines.length,1);assert.equal(states.at(-1),'off');
});

test('coach output never cycles an open microphone and late echoes cannot become commands', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let now = 0;
  const engines: FakeRecognition[] = [], commands: VoiceCommand[] = [];
  const control = new BrowserVoiceCommands(command => commands.push(command), () => {},
    () => { const engine = new FakeRecognition(); engines.push(engine); return engine; }, () => false, () => false, () => now);
  control.start(); const engine = engines[0]!;
  for (let i = 0; i < 20; i++) {
    control.setOutputActive(false); control.setOutputActive(true); control.setOutputActive(true);
    engine.say('Bitir', i); control.setOutputActive(false);
  }
  engine.say('Bitir', 20); now = 801; engine.say('Kaç tekrar yaptım', 21);
  t.mock.timers.tick(10000);
  assert.equal(engines.length, 1); assert.equal(engine.aborted, 0);
  assert.deepEqual(commands, ['progress']); control.stop(); assert.equal(engine.aborted, 1);
});

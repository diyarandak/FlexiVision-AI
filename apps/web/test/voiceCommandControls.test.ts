import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrowserVoiceCommands, type Recognition } from '../src/adapters/voiceCommands.ts';
import { VoiceCommandControls, type CreateVoiceCommands } from '../src/components/VoiceCommandControls.tsx';

test('microphone command button is available only during a live session', () => {
  const createCommands: CreateVoiceCommands = (onCommand, onState) => new BrowserVoiceCommands(
    onCommand, onState,
    () => ({ lang: '', continuous: false, interimResults: false, maxAlternatives: 1,
      onstart: null, onresult: null, onerror: null, onend: null, start() {}, abort() {} }) as Recognition,
    () => false, () => false, () => 0,
  );
  const markup = (sessionActive: boolean) => renderToStaticMarkup(createElement(VoiceCommandControls,
    { sessionActive, onCommand() {}, createCommands }));
  const inactive = markup(false), active = markup(true);
  const commandButton = (html: string) => html.match(/<button[^>]*>Mikrofonla komutları aç<\/button>/)?.[0] ?? '';

  assert.match(commandButton(inactive), /disabled=""/);
  assert.match(inactive, /Sesli komutları kullanmak için önce kamerayı aç/);
  assert.doesNotMatch(commandButton(active), /disabled/);
  assert.doesNotMatch(active, /Sesli komutları kullanmak için önce kamerayı aç/);
});

test('coach opt-in explains microphone service use before starting and keeps its state visible live', () => {
  const initial = renderToStaticMarkup(createElement(VoiceCommandControls, { sessionActive: false, coach: true, onCommand() {} }));
  assert.match(initial, /şimdi ne yapacağım/);
  assert.match(initial, /tarayıcının servisine ses gönderilebilir/);
  const live = renderToStaticMarkup(createElement(VoiceCommandControls, { sessionActive: true, coach: true, onCommand() {} }));
  assert.match(live, /generic-voice-status/);
  assert.match(live, /Mikrofon kapalı/);
});

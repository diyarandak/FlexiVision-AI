import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { referenceMap } from '../../../packages/core/test/fixtures/acceptedTemplate.ts';
import { MotionResults } from '../src/components/MotionResults.tsx';
import { genericReferenceMap } from './fixtures/genericMotion.ts';

function sideViewMap() {
  const map = referenceMap();
  map.sequence.frames.forEach(frame => {
    frame.people = [{ landmarks: Array.from({ length: 33 }, (_, index) => ({
      x: [12, 24].includes(index) ? .52 : .5,
      y: [11, 12].includes(index) ? .2 : [23, 24].includes(index) ? .4 : .5,
      z: 0, visibility: .9,
    })), worldLandmarks: [] }];
  });
  return map;
}

test('partial reference UI explains missing edges once and never offers a live session', () => {
  const map = sideViewMap();
  const samples = [...map.samples.slice(22), ...map.samples.slice(0, 22)];
  map.samples = samples.map((sample, index) => ({ ...sample, timestampMs: index * 100 }));
  const html = renderToStaticMarkup(createElement(MotionResults, { map, onPreview() {}, onStartLive() {} }));
  assert.match(html, /Tekrarın ayakta başlangıcı ve dönüşü eksik/);
  assert.match(html, /çömelmiş → ayakta → çömelmiş/);
  assert.doesNotMatch(html, /Desteklenen hareket algılanamadı|Kaydet ve başla|Egzersize başla|Referans video onaylandı/);
  assert.equal(html.match(/class="rejection-item"/g)?.length, 1);
});

test('a full side-view reference still offers its measured live template', () => {
  const html = renderToStaticMarkup(createElement(MotionResults, { map: sideViewMap(), onPreview() {}, onStartLive() {} }));
  assert.match(html, /Referans video onaylandı/);
  assert.match(html, /Egzersize başla/);
  assert.match(html, /<details class="template-inspection template-more-options">/);
  assert.doesNotMatch(html, /class="rejection-item"|başlangıcı ve dönüşü eksik/);
});

test('free movement UI accepts a measured arm cycle despite no squat data, with honest scope', () => {
  const map = genericReferenceMap();
  assert.equal(map.status, 'insufficient_data');
  const html = renderToStaticMarkup(createElement(MotionResults, { mode: 'free', map, onPreview() {}, onStartLive() {}, async onSaveTemplate() { throw new Error('unused'); } }));
  assert.match(html, /Hareket referansı hazır/);
  assert.match(html, /Kaydet ve başla/);
  assert.match(html, /hareketin türünü, doğru yapıldığını veya kişi için güvenli olduğunu doğrulamaz/);
  assert.match(html, /Yalnızca kaydet/);
  assert.equal((html.match(/class="primary-button live-start-btn template-primary-action"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Alt gövde açıları|Squat ön ayarında|Kabul Edilmedi/);
});

test('free movement UI with interrupted tracking shows rejection and does not offer live start', () => {
  const map = genericReferenceMap();
  map.sequence.frames[22]!.people[0]!.landmarks[11]!.visibility = 0;
  const html = renderToStaticMarkup(createElement(MotionResults, { mode: 'free', map, onPreview() {}, onStartLive() {} }));
  assert.match(html, /Hareket şablonu oluşturulamadı/);
  assert.doesNotMatch(html, /Kaydet ve başla|Egzersize başla|Yalnızca kaydet/);
});

test('switching an accepted free-motion map to squat never reuses its approval', () => {
  const map = genericReferenceMap();
  const html = renderToStaticMarkup(createElement(MotionResults, { mode: 'squat', map, onPreview() {}, onStartLive() {} }));
  assert.match(html, /Kabul Edilmedi/);
  assert.doesNotMatch(html, /Referans video onaylandı|Kaydet ve başla|Egzersize başla/);
});

test('accepted squat also has a single save-then-start action when persistence is available', () => {
  const html = renderToStaticMarkup(createElement(MotionResults, {
    map: sideViewMap(), onPreview() {}, onStartLive() {}, async onSaveTemplate() { throw new Error('unused'); },
  }));
  assert.match(html, /Kaydet ve başla/);
  assert.match(html, /Yalnızca kaydet/);
  assert.equal((html.match(/class="primary-button live-start-btn template-primary-action"/g) ?? []).length, 1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GenericMovementGuide } from '../src/components/GenericMovementGuide.tsx';
import { genericAcceptedTemplate } from '../../../packages/core/test/fixtures/genericTemplate.ts';

test('next target changes with phase without changing the reference drawing scale', () => {
  const template = genericAcceptedTemplate();
  const outbound = renderToStaticMarkup(createElement(GenericMovementGuide, { template, phase: 'outbound' }));
  const returning = renderToStaticMarkup(createElement(GenericMovementGuide, { template, phase: 'return' }));
  assert.equal(outbound.match(/viewBox="([^"]+)"/)?.[1], returning.match(/viewBox="([^"]+)"/)?.[1]);
  assert.notEqual(outbound.match(/opacity="1" class="reference-person">(.+?)<\/g>/)?.[1], returning.match(/opacity="1" class="reference-person">(.+?)<\/g>/)?.[1]);
  assert.match(outbound,/data-silhouette="head"/);assert.match(outbound,/data-silhouette="torso"/);
  assert.match(outbound, /ŞİMDİ BU HEDEFE GİT/);
  assert.match(returning, /ŞİMDİ BAŞLANGICA DÖN/);
  assert.match(outbound, /Hareketi göster/);
});

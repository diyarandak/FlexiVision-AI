import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CameraPlacementGuide, CameraSetupProgress, placementMessage, visibleCameraGuideRect } from '../src/components/CameraPlacementGuide.tsx';
import { cameraBodyChecklist } from '@flexivision/core';
import { genericAcceptedTemplate, genericObservation } from '../../../packages/core/test/fixtures/genericTemplate.ts';

test('setup checklist distinguishes visible regions from start acceptance and resets on missing or ambiguous tracking',()=>{
  const frame=genericObservation(0,100).frame;
  const render=(started=false,loading=false)=>renderToStaticMarkup(createElement(CameraSetupProgress,{frame,started,loading}));
  assert.ok(cameraBodyChecklist(frame).every(check=>check.visible));
  assert.match(render(),/aria-current="step"[^>]*><span aria-hidden="true">2/);
  assert.match(render(true),/aria-current="step"[^>]*><span aria-hidden="true">3/);
  assert.match(render(true,true),/aria-current="step"[^>]*><span aria-hidden="true">1/);
  frame.people[0]!.landmarks[28]!.visibility=0;
  assert.deepEqual(cameraBodyChecklist(frame).map(check=>check.visible),[true,true,true,false]);
  assert.match(render(true),/aria-current="step"[^>]*><span aria-hidden="true">1/);
  frame.people.push(frame.people[0]!);
  assert.ok(cameraBodyChecklist(frame).every(check=>!check.visible));
  assert.ok(cameraBodyChecklist(undefined).every(check=>!check.visible));
});

test('placement instructions require head, both arms and legs before reference start',()=>{
  const template=genericAcceptedTemplate(), frame=genericObservation(0,100).frame;
  assert.match(placementMessage(undefined,template.trackedIndices,'no_person'),/Telefonu sabitle/);
  assert.match(placementMessage(frame,template.trackedIndices,'find_start'),/Vücudun görünüyor/);
  frame.people[0]!.landmarks[15]!.visibility=0;
  assert.match(placementMessage(frame,template.trackedIndices,'tracking_lost'),/Kolların ve ellerin görünmüyor/);
  frame.people[0]!.landmarks[11]!.visibility=0;
  assert.match(placementMessage(frame,template.trackedIndices,'body_not_visible'),/Omuzların görünmüyor/);
  frame.people[0]!.landmarks[11]!.visibility=.95;
  frame.people[0]!.landmarks[15]!.visibility=.95;
  frame.people[0]!.landmarks[28]!.visibility=0;
  assert.match(placementMessage(frame,template.trackedIndices,'tracking_lost'),/Dizlerin ve ayakların görünmüyor/);
  frame.people[0]!.landmarks[28]!.visibility=.95;
  frame.people[0]!.landmarks[0]!.visibility=0;
  assert.match(placementMessage(frame,template.trackedIndices,'tracking_lost'),/Başın görünmüyor/);
});
test('visible boundary uses the analyser threshold and never labels multiple pose candidates or slow frames ready',()=>{
  const template=genericAcceptedTemplate(),frame=genericObservation(0,100).frame;
  frame.people[0]!.landmarks[11]!.visibility=.6;
  assert.match(placementMessage(frame,template.trackedIndices,'hold_start'),/Kısa bir an sabit kal/);
  assert.match(placementMessage(frame,template.trackedIndices,'processing_slow'),/gecikiyor/);
  frame.people.push(frame.people[0]!);
  for (const reason of ['multiple_people', 'find_start', 'hold_start']) {
    const uncertain = placementMessage(frame,template.trackedIndices,reason);
    assert.match(uncertain,/Tek bir vücut net seçilemiyor/);
    assert.match(uncertain,/Telefonu sabitle/);
    assert.doesNotMatch(uncertain,/yalnızca sen|Diğer kişiler|Birden fazla kişi|Vücudun görünüyor|Duruş bulundu/);
  }
});
test('placement and reference shadows use the actual camera canvas and matching fit transform',()=>{
  const template=genericAcceptedTemplate();
  const body=renderToStaticMarkup(createElement(CameraPlacementGuide,{template,width:1280,height:720,fill:false,showReference:false}));
  assert.match(body,/viewBox="0 0 1280 720"/);assert.match(body,/xMidYMid meet/);assert.match(body,/Kadraj rehberi/);assert.match(body,/body-ghost/);
  const reference=renderToStaticMarkup(createElement(CameraPlacementGuide,{template,width:720,height:1280,fill:true,showReference:true}));
  assert.match(reference,/Başlangıç duruşu gölgesi/);assert.match(reference,/xMidYMid slice/);assert.match(reference,/reference-ghost/);assert.doesNotMatch(reference,/NaN|Infinity/);
});


test('reference shadow fits static torso and head even when only arms are tracked',()=>{
  const template=genericAcceptedTemplate();
  assert.ok(!template.trackedIndices.includes(11));
  for(const [width,height] of [[720,1280],[1280,720]]) {
    const html=renderToStaticMarkup(createElement(CameraPlacementGuide,{template,width:width!,height:height!,fill:false,showReference:true}));
    const coords=[...html.matchAll(/(?:x1|x2|cx|y1|y2|cy)="([^"]+)"/g)];
    assert.ok(coords.length>10);
    for(const match of coords){
      const value=Number(match[1]);const axis=match[0]!.startsWith('x')||match[0]!.startsWith('cx')?'x':'y';
      assert.ok(value>=(axis==='x'?width!*.1:height!*.30),match[0]);
      assert.ok(value<=(axis==='x'?width!*.9:height!*.83),match[0]);
    }
  }
});

test('cover guide uses the visible source rectangle on a portrait phone without changing camera coordinates', () => {
  const viewport = { width: 390, height: 740 };
  const area = visibleCameraGuideRect(1280, 720, viewport);
  assert.equal(area.width, 720 * 390 / 740);
  assert.equal(area.height, 720);
  assert.equal(area.x + area.width / 2, 640);
  assert.equal(area.y, 0);
  const html = renderToStaticMarkup(createElement(CameraPlacementGuide, {
    template: genericAcceptedTemplate(), width: 1280, height: 720, fill: true, showReference: true, viewport,
  }));
  assert.match(html, /viewBox="0 0 1280 720"/);
  assert.match(html, /xMidYMid slice/);
  assert.doesNotMatch(html, /NaN|Infinity/);
  const stroke = Number(html.match(/stroke-width="([^"]+)"/)![1]);
  const fits = (value: number, axis: 'x'|'y', radius = 0) => {
    const origin = area[axis], size = axis === 'x' ? area.width : area.height;
    const padding = size * .08;
    assert.ok(value - radius - stroke/2 >= origin + padding, `${axis} lower bound: ${value}`);
    assert.ok(value + radius + stroke/2 <= origin + size - padding, `${axis} upper bound: ${value}`);
  };
  const lines = [...html.matchAll(/(?:x1|x2|y1|y2)="([^"]+)"/g)];
  assert.equal(lines.length, 32); // All eight visible links, including the untracked static torso.
  for (const coord of lines) fits(Number(coord[1]), coord[0].startsWith('x') ? 'x' : 'y');
  const head = html.match(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/)!;
  fits(Number(head[1]), 'x', Number(head[3]));
  fits(Number(head[2]), 'y', Number(head[3]));
});

test('whole body silhouette fits inside the cover crop and stays large enough to guide placement', () => {
  const viewport = { width: 390, height: 740 };
  const area = visibleCameraGuideRect(1280, 720, viewport);
  const html = renderToStaticMarkup(createElement(CameraPlacementGuide, {
    template: genericAcceptedTemplate(), width: 1280, height: 720, fill: true, showReference: false, viewport,
  }));
  assert.doesNotMatch(html, /NaN|Infinity/);
  const transform = html.match(/transform="translate\(([^ ]+) ([^)]+)\) scale\(([^)]+)\) translate\(-120 -235\)"/)!;
  assert.ok(transform);
  const cx = Number(transform[1]), cy = Number(transform[2]), scale = Number(transform[3]);
  // Includes head radius, both arms, legs and the floor marker in the SVG path bounds.
  const left = cx + (53 - 120)*scale, right = cx + (184 - 120)*scale;
  const top = cy + (35 - 235)*scale, bottom = cy + (435 - 235)*scale;
  assert.ok(left >= area.x + area.width*.08 && right <= area.x + area.width*.92);
  assert.ok(top >= area.y + area.height*.08 && bottom <= area.y + area.height*.92);
  assert.ok(bottom - top > area.height*.5);
});

test('contain guide reserves header space without inventing a crop and an unmeasured viewport stays finite', () => {
  const props = { template: genericAcceptedTemplate(), width: 1280, height: 720, fill: false, showReference: true };
  assert.deepEqual(visibleCameraGuideRect(1280,720,{width:390,height:740},'contain'),{x:0,y:0,width:1280,height:720});
  const area=visibleCameraGuideRect(720,1280,{width:390,height:740,topInset:235,bottomInset:130},'contain');
  assert.ok(area.y>0);assert.ok(area.height<1280);assert.equal(area.width,720);
  assert.deepEqual(visibleCameraGuideRect(1280,720,{width:0,height:0}), {x:0,y:0,width:1280,height:720});
  assert.deepEqual(visibleCameraGuideRect(1280,720,{width:NaN,height:740}), {x:0,y:0,width:1280,height:720});
  assert.doesNotMatch(renderToStaticMarkup(createElement(CameraPlacementGuide, {
    ...props, fill: true, viewport: { width:0, height:0 },
  })), /NaN|Infinity/);
});

test('cover placement reserves the space occupied by guidance and camera controls', () => {
  const area=visibleCameraGuideRect(1280,720,{width:390,height:740,topInset:185,bottomInset:220});
  const scale=740/720;
  assert.ok(Math.abs(area.y*scale-185)<.001);
  assert.ok(Math.abs((area.y+area.height)*scale-520)<.001);
  assert.ok(area.width>0 && area.height>0);
});

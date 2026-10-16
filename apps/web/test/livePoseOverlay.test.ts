import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PoseFrame } from '@flexivision/contracts';
import { SquatPoseOverlay, squatOverlayState } from '../src/components/LiveExercisePanel.tsx';

const frame: PoseFrame = {
  timestampMs: 1,
  people: [{
    landmarks: Array.from({ length: 33 }, (_, index) => ({ x: .2 + index / 100, y: .3 + index / 100, z: 0, visibility: .99 })),
    worldLandmarks: [],
  }],
};

function markup(observation: Parameters<typeof SquatPoseOverlay>[0]['observation'], side: 'left' | 'right' = 'left') {
  return renderToStaticMarkup(createElement(SquatPoseOverlay, { frame, width: 640, height: 480, side, observation }));
}

test('unknown and setup pose cannot paint a reference mismatch', () => {
  assert.deepEqual(squatOverlayState(null, 'left'), { tracked: false, knee: null, hip: null });
  assert.deepEqual(squatOverlayState({ status: 'unknown', reason: 'camera_view' }, 'left'), { tracked: false, knee: null, hip: null });
  assert.doesNotMatch(markup({ status: 'unknown', reason: 'camera_view' }), /data-reference-difference="true"/);
  assert.match(markup(null), /stroke="#c7d0ca"/);
});

test('reliable knee difference highlights only the tracked shin; a clean match stays green', () => {
  const observation = { status: 'incorrect' as const, errors: [{ code: 'knee_deviation', message: 'reference difference', severity: 1 }] };
  const left = markup(observation);
  assert.match(left, /data-pose-segment="25-27" data-reference-difference="true"[^>]+stroke="#ff695d"/);
  assert.doesNotMatch(left, /data-pose-segment="26-28" data-reference-difference="true"/);
  const right = markup(observation, 'right');
  assert.match(right, /data-pose-segment="26-28" data-reference-difference="true"/);
  assert.doesNotMatch(markup({ status: 'correct' }), /data-reference-difference="true"/);
  assert.match(markup({ status: 'correct' }), /stroke="#a9f779"/);
});

test('hip difference highlights tracked torso without inventing a full reference avatar', () => {
  const html = markup({ status: 'incorrect', errors: [{ code: 'chest_forward', message: 'reference difference', severity: 2 }] });
  assert.match(html, /data-pose-segment="11-23" data-reference-difference="true"/);
  assert.doesNotMatch(html, /data-pose-segment="25-27" data-reference-difference="true"/);
});

test('generic comparison marks measured differing bones red and keeps other compared bones green', async () => {
  const { LiveReferenceOverlay } = await import('../src/components/GenericLiveExercisePanel.tsx');
  const overlay = { joints: [11, 13, 15, 12, 14, 16].map(index => ({ index,
    observed: { x: .2 + index / 100, y: .4 }, reference: { x: .2 + index / 100, y: .3 },
    deviation: index === 15 ? .4 : .1, deviating: index === 15 })) };
  const html = renderToStaticMarkup(createElement(LiveReferenceOverlay, { overlay, width: 640, height: 480, fill: true }));
  assert.match(html, /preserveAspectRatio="xMidYMid slice"/);
  assert.match(html, /data-pose-segment="13-15" data-reference-difference="true"[^>]*stroke="#ff625b"/);
  assert.match(html, /data-pose-segment="12-14" data-reference-difference="false"[^>]*stroke="#a9f779"/);
  const clean = renderToStaticMarkup(createElement(LiveReferenceOverlay, {
    overlay: { joints: overlay.joints.map(joint => ({ ...joint, deviating: false })) }, width: 640, height: 480 }));
  assert.doesNotMatch(clean, /data-reference-difference="true"/);
  assert.match(clean, /preserveAspectRatio="xMidYMid meet"/);
});

test('measured skeleton and squat overlay keep the camera fit transform aligned', async () => {
  const { Skeleton } = await import('../src/components/MotionResults.tsx');
  for (const fill of [false, true]) {
    const expected = fill ? 'slice' : 'meet';
    const measured = renderToStaticMarkup(createElement(Skeleton, { frame, width: 480, height: 640, fill }));
    const squat = renderToStaticMarkup(createElement(SquatPoseOverlay, { frame, width: 480, height: 640, fill, side: 'left', observation: { status: 'correct' } }));
    assert.match(measured, new RegExp(`preserveAspectRatio="xMidYMid ${expected}"`));
    assert.match(squat, new RegExp(`preserveAspectRatio="xMidYMid ${expected}"`));
  }
});

test('skeleton colors correct joints green and deviating joints/bones red', async () => {
  const { Skeleton } = await import('../src/components/MotionResults.tsx');
  const deviating = new Set([25]);
  const html = renderToStaticMarkup(createElement(Skeleton, { frame, width: 640, height: 480, deviatingJoints: deviating }));
  assert.match(html, /fill="#ff3b30"/);
  assert.match(html, /data-joint-deviating="true"/);
  assert.match(html, /fill="#30d158"/);
  assert.match(html, /data-joint-deviating="false"/);
  assert.match(html, /stroke="#ff453a"/);
  assert.match(html, /data-bone-deviating="true"/);
  assert.match(html, /stroke="#30d158"/);
  assert.match(html, /data-bone-deviating="false"/);
  assert.match(html, /data-joint-alert="25"/);
});


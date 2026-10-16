import assert from 'node:assert/strict';
import test from 'node:test';
import type { CalibrationProfile, CameraPoseObservation } from '@flexivision/contracts';
import { normalizePersonalBody, personalBodyAngles } from '../src/personalBody.ts';
import { imageAngles } from '../src/motionMap.ts';

function profile(): CalibrationProfile {
  return { schemaVersion: 2, kind: 'body-calibration', qualification: 'not_evaluated', policyVersion: 'body-scan-v2',
    width: 1280, height: 720, torsoPixels: 200, origin: { x: 0.9, y: 0.9 },
    proportions: { shoulderWidth: 0.8, hipWidth: 0.4, leftThigh: 0.9, rightThigh: 0.9, leftShin: 0.9, rightShin: 0.9 },
    neutralAngles: { leftKnee: 175, rightKnee: 175, leftHip: 170, rightHip: 170, leftElbow: null, rightElbow: null } };
}
function pose(): CameraPoseObservation {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.2, z: 0, visibility: 0.9 }));
  for (const [index, x, y] of [[11, 0.45, 0.2], [12, 0.55, 0.2], [23, 0.48, 0.45], [24, 0.52, 0.45],
    [25, 0.5, 0.6], [26, 0.55, 0.6], [27, 0.4, 0.8], [28, 0.45, 0.8]]) landmarks[index!] = { x: x!, y: y!, z: 0, visibility: 0.9 };
  return { width: 1280, height: 720, frame: { timestampMs: 0, people: [{ landmarks, worldLandmarks: [] }] } };
}
test('personal normalization follows the current frame under translation, scale and aspect changes', () => {
  const original = pose(), changed = structuredClone(original);
  changed.width = 640; changed.height = 960;
  changed.frame.people[0]!.landmarks.forEach(p => {
    p.x = (p.x * original.width * 0.6 + 20) / changed.width;
    p.y = (p.y * original.height * 0.6 + 30) / changed.height; p.z = 999;
  });
  const a = normalizePersonalBody(original, profile())!, b = normalizePersonalBody(changed, profile())!;
  assert.notDeepEqual(a.origin, profile().origin);
  assert.notDeepEqual(a.origin, b.origin);
  assert.ok(Math.abs(b.legUnitPixels / a.legUnitPixels - 0.6) < 1e-9);
  a.landmarks.forEach((p, i) => {
    assert.ok(Math.abs(p!.x - b.landmarks[i]!.x) < 1e-9);
    assert.ok(Math.abs(p!.y - b.landmarks[i]!.y) < 1e-9);
  });
  const measured = imageAngles(original.frame.people[0]!, original.width, original.height), normalized = personalBodyAngles(b);
  for (const key of Object.keys(measured) as (keyof typeof measured)[]) {
    assert.ok(measured[key] === null ? normalized[key] === null : Math.abs(measured[key]! - normalized[key]!) < 1e-6);
  }
});
test('saved leg proportions change personal units without inventing an angle offset', () => {
  const first = profile(), longer = profile();
  longer.proportions.leftThigh = longer.proportions.rightThigh = 1.8;
  longer.proportions.leftShin = longer.proportions.rightShin = 1.8;
  longer.neutralAngles.leftKnee = 160;
  const a = normalizePersonalBody(pose(), first)!, b = normalizePersonalBody(pose(), longer)!;
  assert.equal(b.legUnitPixels, a.legUnitPixels * 2);
  assert.equal(b.landmarks[27]!.x, a.landmarks[27]!.x / 2);
  assert.deepEqual(personalBodyAngles(a), personalBodyAngles(b));
});
test('occluded joints remain missing; invalid profiles, missing torso or multiple people cannot normalize', () => {
  const observation = pose(); observation.frame.people[0]!.landmarks[27]!.visibility = 0;
  const body = normalizePersonalBody(observation, profile())!;
  assert.equal(body.landmarks[27], null); assert.equal(personalBodyAngles(body).leftKnee, null);
  assert.equal(normalizePersonalBody(observation, { ...profile(), torsoPixels: NaN }), null);
  observation.frame.people[0]!.landmarks[11]!.visibility = 0;
  assert.equal(normalizePersonalBody(observation, profile()), null);
  observation.frame.people.push(observation.frame.people[0]!);
  assert.equal(normalizePersonalBody(observation, profile()), null);
});

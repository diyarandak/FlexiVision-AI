import assert from 'node:assert/strict';
import test from 'node:test';
import { supportedVideoFile } from '../src/adapters/videoFile.ts';

test('Android picker with no MIME accepts supported video extensions for decoder validation', () => {
  assert.equal(supportedVideoFile({ name: 'exercise.MP4', type: '' }), true);
  assert.equal(supportedVideoFile({ name: 'clip.mov', type: '' }), true);
  assert.equal(supportedVideoFile({ name: 'clip.webm', type: '' }), true);
  assert.equal(supportedVideoFile({ name: 'clip.mp4', type: 'application/octet-stream' }), true);
  assert.equal(supportedVideoFile({ name: 'clip.jpg', type: '' }), false);
  assert.equal(supportedVideoFile({ name: 'clip.mp4', type: 'image/png' }), false);
});

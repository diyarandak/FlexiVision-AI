import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalyzeReference } from '../src/index.ts';

const source = { uri: 'fixture://synthetic', name: 'synthetic-reference' };

test('missing analyzer returns unavailable without manufacturing a decision', async () => {
  const useCase = new AnalyzeReference({ available: false, async extractEvidence() { assert.fail('must not run'); } });
  assert.equal((await useCase.execute(source)).status, 'unavailable');
});
test('analyzer failure remains a technical failure, not an exercise rejection', async () => {
  const useCase = new AnalyzeReference({ available: true, async extractEvidence() { throw new Error('private SDK detail'); } });
  const result = await useCase.execute(source);
  assert.equal(result.status, 'failed');
  assert.ok(!JSON.stringify(result).includes('private SDK detail'));
});
test('cancelled work is not started', async () => {
  const useCase = new AnalyzeReference({ available: true, async extractEvidence() { assert.fail('must not run'); } });
  assert.equal((await useCase.execute(source, { aborted: true })).status, 'failed');
});
test('evidence passes through the shared policy', async () => {
  const useCase = new AnalyzeReference({ available: true, async extractEvidence() {
    return { durationMs: 5000, sampledFrames: 25, usableFrames: 25, multiPersonFrames: 0,
      view: 'unknown', motion: 'supported', completeRepetitions: 1 };
  } });
  const result = await useCase.execute(source);
  assert.equal(result.status, 'completed');
  if (result.status === 'completed') assert.equal(result.decision.status, 'rejected');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createApi } from '../src/app.ts';

test('HTTP health, truthful capabilities and unavailable routes', async t => {
  const server = createApi();
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') assert.fail('expected port');
  const base = `http://127.0.0.1:${address.port}`;
  assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { status: 'ok' });
  const response = await fetch(`${base}/api/v1/capabilities`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    contractVersion: 1, referenceAnalysis: 'unavailable', liveComparison: 'unavailable',
    rawVideoUpload: false, feedbackIntervalMs: 10000,
  });
  assert.equal((await fetch(`${base}/does-not-exist`)).status, 404);
  assert.equal((await fetch(`${base}/api/v1/videos`, { method: 'POST', body: 'not-a-video' })).status, 405);
});

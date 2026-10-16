import { createServer } from 'node:http';
import type { Capabilities } from '@flexivision/contracts';

export const capabilities: Capabilities = {
  contractVersion: 1,
  referenceAnalysis: 'unavailable',
  liveComparison: 'unavailable',
  rawVideoUpload: false,
  feedbackIntervalMs: 10000,
};

/** HTTP adapter. Business rules belong to packages/core, never to this router. */
export function createApi() {
  return createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const path = (request.url ?? '/').split('?')[0];
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' });
      response.end(JSON.stringify({ error: 'method_not_allowed' }));
    } else if (path === '/healthz') {
      response.end(JSON.stringify({ status: 'ok' }));
    } else if (path === '/api/v1/capabilities') {
      response.end(JSON.stringify(capabilities));
    } else {
      response.writeHead(404);
      response.end(JSON.stringify({ error: 'not_found' }));
    }
  });
}

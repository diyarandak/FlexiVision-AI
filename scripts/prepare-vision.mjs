import { createHash } from 'node:crypto';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('scripts/model-manifest.json', root), 'utf8'));
const pkg = new URL('node_modules/@mediapipe/tasks-vision/', root);
const metadata = JSON.parse(await readFile(new URL('package.json', pkg), 'utf8'));
if (metadata.version !== manifest.sdkVersion) throw new Error('SDK/WASM version mismatch. Update manifest and adapter together.');
const model = await readFile(new URL(`apps/web/public/models/${manifest.file}`, root)).catch(() => null);
if (!model || createHash('sha256').update(model).digest('hex') !== manifest.sha256) {
  throw new Error('Pose model missing or invalid. Run: npm run models:download');
}
const versionedModel = new URL(`apps/web/public/models/${manifest.sha256}/`, root);
await mkdir(versionedModel, { recursive: true });
await cp(new URL(`apps/web/public/models/${manifest.file}`, root), new URL(manifest.file, versionedModel));
const target = new URL(`apps/web/public/vendor/mediapipe/${manifest.sdkVersion}/`, root);
await mkdir(target, { recursive: true });
await cp(new URL('wasm', pkg), new URL('wasm', target), { recursive: true });
await cp(new URL('vision_bundle.js', pkg), new URL('vision_bundle.js', target));
await mkdir(new URL('apps/web/public/workers/', root), { recursive: true });
await build({ entryPoints: [new URL('apps/web/src/workers/pose.worker.ts', root).pathname],
  outfile: new URL('apps/web/public/workers/pose.js', root).pathname,
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022' });
console.info(`Prepared local MediaPipe ${manifest.sdkVersion} assets and Worker.`);

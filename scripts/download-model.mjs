import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('scripts/model-manifest.json', root), 'utf8'));
const directory = new URL('apps/web/public/models/', root);
await mkdir(directory, { recursive: true });
const destination = new URL(manifest.file, directory);
const digest = buffer => createHash('sha256').update(buffer).digest('hex');
const existing = await readFile(destination).catch(() => null);
if (existing && digest(existing) === manifest.sha256) {
  console.info('Pose model already verified.');
} else {
  const response = await fetch(manifest.url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (digest(buffer) !== manifest.sha256) throw new Error('Model checksum mismatch; file not saved.');
  const temporary = new URL(`${manifest.file}.tmp`, directory);
  try { await writeFile(temporary, buffer); await rename(temporary, destination); }
  finally { await rm(temporary, { force: true }); }
  console.info(`Downloaded and verified ${manifest.name}.`);
}

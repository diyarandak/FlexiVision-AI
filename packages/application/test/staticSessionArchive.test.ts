import assert from 'node:assert/strict';
import test from 'node:test';
import type { StaticSessionRecord } from '@flexivision/contracts';
import { StaticSessionArchive, type SaveStaticSession } from '../src/index.ts';
import { staticSummary } from '../../core/test/fixtures/staticTemplate.ts';
const reference = { intervalId: 1, policyVersion: 'static-pose-v1' } as const;
const makeRecord: SaveStaticSession = async (summary, reference, endReason) => ({
  schemaVersion: 3, id: 'one', savedAt: '2026-10-11T10:00:00Z', exercise: 'static-pose', summary, reference, endReason,
});

test('automatic finish and close share one pending write, and cannot discard while writing', async () => {
  let calls = 0, complete!: (record: StaticSessionRecord) => void;
  const archive = new StaticSessionArchive(staticSummary(), reference, 'finished', () => {
    calls++; return new Promise(resolve => { complete = resolve; });
  });
  const first = archive.save(), second = archive.save();
  assert.equal(first, second); assert.equal(archive.status, 'saving'); assert.equal(archive.canLeave, false);
  assert.equal(archive.discard(), false);
  await Promise.resolve(); assert.equal(calls, 1);
  complete(await makeRecord(staticSummary(), reference, 'finished'));
  assert.equal(await first, true); assert.equal(archive.canLeave, true);
  await archive.save(); assert.equal(calls, 1); assert.equal(archive.status, 'saved');
});
test('failed persistence retries the original frozen report and reason, even when an adapter mutates arguments', async () => {
  let calls = 0; const supplied = staticSummary(), ref: StaticSessionRecord['reference'] = { ...reference };
  const reports: StaticSessionRecord[] = [];
  const archive = new StaticSessionArchive(supplied, ref, 'interrupted', async (summary, reference, reason) => {
    calls++; if (calls === 1) { summary.matchedMs = 0; reference.intervalId = 900; throw new Error('Storage denied'); }
    const record = await makeRecord(summary, reference, reason); reports.push(record); return record;
  });
  supplied.matchedMs = 0; ref.intervalId = 800; archive.summary.targetMs = 9000;
  assert.equal(await archive.save(), false); assert.equal(archive.status, 'failed'); assert.equal(archive.canLeave, false);
  assert.equal(await archive.save(), true);
  assert.equal(reports[0]!.summary.matchedMs, 5000); assert.equal(reports[0]!.summary.targetMs, 5000);
  assert.equal(reports[0]!.reference.intervalId, 1); assert.equal(reports[0]!.endReason, 'interrupted');
});
test('empty sessions do not save; explicit discard allows exit without a second persistence attempt', async () => {
  let writes = 0;
  const persist: SaveStaticSession = async () => { writes++; throw Error('Denied'); };
  const empty = new StaticSessionArchive({ ...staticSummary(), durationMs: 0, matchedMs: 0, targetReached: false,
    trackedFrames: 0, unmeasuredFrames: 86 }, reference, 'interrupted', persist);
  assert.equal(await empty.save(), true); assert.equal(writes, 0); assert.equal(empty.canLeave, true);
  const measured = new StaticSessionArchive(staticSummary(), reference, 'finished', persist);
  assert.equal(await measured.save(), false); assert.equal(measured.discard(), true);
  assert.equal(await measured.save(), true); assert.equal(writes, 1); assert.equal(measured.status, 'discarded');
});
test('malformed reports never reach storage', () => {
  const persist: SaveStaticSession = () => { throw Error('Must not save'); };
  assert.throws(() => new StaticSessionArchive({ ...staticSummary(), matchedMs: 9000 }, reference, 'finished', persist));
  assert.throws(() => new StaticSessionArchive(staticSummary(), { ...reference, intervalId: 0 }, 'finished', persist));
});

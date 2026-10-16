import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserDemoSession, DEMO_SESSION_KEY } from '../src/adapters/demoSession.ts';
import { appSection } from '../src/navigation.ts';

test('demo entry survives reload in the same session storage without creating an identity or deleting records', () => {
  const data = new Map<string, string>([['flexivision.body-profile.v2', 'body'], ['flexivision.references.v1', 'references']]);
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const demo = new BrowserDemoSession(() => storage); assert.equal(demo.load(), false); demo.enter();
  assert.equal(new BrowserDemoSession(() => storage).load(), true);
  assert.deepEqual(JSON.parse(data.get(DEMO_SESSION_KEY)!), { schemaVersion: 1, mode: 'demo' });
  demo.leave(); assert.equal(demo.load(), false); assert.equal(data.get('flexivision.body-profile.v2'), 'body'); assert.equal(data.get('flexivision.references.v1'), 'references');
});
test('corrupt demo sessions stay logged out and storage denial is surfaced', () => {
  for (const raw of ['{broken', 'a'.repeat(501), '{"mode":"user","schemaVersion":1}']) {
    const demo = new BrowserDemoSession(() => ({ getItem: () => raw, setItem() {}, removeItem() {} })); assert.equal(demo.load(), false);
  }
  const denied = new BrowserDemoSession(() => { throw new Error('Denied'); });
  assert.throws(() => denied.enter(), /Denied/); assert.throws(() => denied.load(), /Denied/);
  assert.equal(appSection('#vucudum'), 'vucudum'); assert.equal(appSection('#egzersizlerim'), 'egzersizlerim'); assert.equal(appSection('#gecmis'), 'gecmis');
  assert.equal(appSection('#unknown'), 'vucudum');
});

export const DEMO_SESSION_KEY = 'flexivision.demo-session.v1';
export type DemoSessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** UI demo gate only. No identity, password, access control or cloud account. */
export class BrowserDemoSession {
  constructor(private readonly storage: () => DemoSessionStorage = () => sessionStorage, private readonly key = DEMO_SESSION_KEY) {}
  load(): boolean {
    const raw = this.storage().getItem(this.key);
    if (!raw || raw.length > 500) return false;
    try { const data = JSON.parse(raw); return data?.schemaVersion === 1 && data?.mode === 'demo'; } catch { return false; }
  }
  enter() { this.storage().setItem(this.key, JSON.stringify({ schemaVersion: 1, mode: 'demo' })); }
  leave() { this.storage().removeItem(this.key); }
}

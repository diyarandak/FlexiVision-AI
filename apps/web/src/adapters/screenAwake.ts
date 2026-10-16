type Lock = Pick<WakeLockSentinel, 'release' | 'addEventListener' | 'released'>;
export type ScreenAwakeState = 'off' | 'active' | 'unavailable';
/** Optional session resource. Late grants are released after stop; denial cannot break tracking. */
export function keepScreenAwake(onState: (state: ScreenAwakeState) => void,
  request: (() => Promise<Lock>) | undefined = typeof navigator !== 'undefined' && navigator.wakeLock
    ? () => navigator.wakeLock.request('screen') : undefined) {
  let stopped = false, lock: Lock | null = null;
  const release = (value: Lock) => { try { void value.release().catch(() => {}); } catch { /* Best-effort optional cleanup. */ } };
  if (!request) onState('unavailable');
  else void (async () => {
    try {
      const acquired = await request();
      if (stopped) { release(acquired); return; }
      lock = acquired;
      acquired.addEventListener('release', () => { if (!stopped) onState('unavailable'); }, { once:true });
      onState(acquired.released ? 'unavailable' : 'active');
    } catch { if (!stopped) onState('unavailable'); }
  })();
  return () => { stopped = true; if (lock) { release(lock); lock = null; } };
}

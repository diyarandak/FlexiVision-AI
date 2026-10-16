import { useCallback, useEffect, useRef, useState } from 'react';
import type { BodyProfileRepository } from '@flexivision/application';
import type { CalibrationProfile, SavedBodyProfile } from '@flexivision/contracts';
import { BrowserBodyProfileRepository } from '../adapters/bodyProfile.ts';

export function useBodyProfile(supplied?: BodyProfileRepository) {
  const [repository] = useState(() => supplied ?? new BrowserBodyProfileRepository());
  const [saved, setSaved] = useState<SavedBodyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const [readAttempt, setReadAttempt] = useState(0);
  const reload = useCallback(() => { setLoading(true); setReadAttempt(value => value + 1); }, []);
  useEffect(() => {
    let disposed = false;
    const current = generation.current;
    void repository.load().then(record => {
      if (!disposed && generation.current === current) { setSaved(record); setError(''); }
    }).catch(() => {
      if (!disposed && generation.current === current) setError('Kayıtlı profile erişilemedi. Tarayıcının site depolama iznini kontrol et.');
    }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [repository, readAttempt]);
  const save = useCallback(async (profile: CalibrationProfile) => {
    const current = ++generation.current;
    const record = await repository.save(profile);
    if (current === generation.current) { setSaved(record); setError(''); }
  }, [repository]);
  const clear = useCallback(async () => {
    const current = ++generation.current;
    try {
      await repository.clear();
      if (current === generation.current) { setSaved(null); setError(''); }
      return true;
    } catch { if (current === generation.current) setError('Profil silinemedi. Tarayıcının site depolama iznini kontrol et.'); return false; }
  }, [repository]);
  return { saved, loading, error, reload, save, clear };
}

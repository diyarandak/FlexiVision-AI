import type { StaticSessionSummary, StaticSessionRecord } from '@flexivision/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionHistoryRepository } from '@flexivision/application';
import type { GenericSessionRecord, GenericSessionSummary, LiveSessionSummary, SessionRecord, SquatSessionRecord } from '@flexivision/contracts';
import { BrowserSessionHistoryRepository, MAX_SESSION_RECORDS } from '../adapters/sessionHistory.ts';

export function useSessionHistory(supplied?: SessionHistoryRepository) {
  const [repository] = useState(() => supplied ?? new BrowserSessionHistoryRepository());
  const [records, setRecords] = useState<SessionRecord[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const generation = useRef(0);
  const [readAttempt, setReadAttempt] = useState(0);
  const reload = useCallback(() => { setLoading(true); setReadAttempt(value => value + 1); }, []);
  useEffect(() => {
    let disposed = false; const current = generation.current;
    void repository.list().then(data => { if (!disposed && current === generation.current) { setRecords(data); setError(''); } })
      .catch(() => { if (!disposed && generation.current === current) setError('Oturum geçmişi okunamadı. Tarayıcının site depolamasını kontrol et.'); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [repository, readAttempt]);
  const save = useCallback(async (summary: LiveSessionSummary, reference: SquatSessionRecord['reference'], endReason: SessionRecord['endReason']) => {
    ++generation.current;
    try {
      const record = await repository.save(summary, reference, endReason);
      // A completed write is the acknowledgement. A second read must not turn
      // a saved session into a failed save that the user might duplicate.
      setRecords(data => [record, ...data.filter(item => item.id !== record.id)].slice(0, MAX_SESSION_RECORDS));
      setError('');
      return record;
    } catch (failure) {
      setError('Oturum kaydedilemedi. Site depolamasını kontrol edip tekrar dene.');
      throw failure;
    }
  }, [repository]);
  const saveGeneric = useCallback(async (summary: GenericSessionSummary, reference: GenericSessionRecord['reference'], endReason: SessionRecord['endReason']) => {
    ++generation.current;
    try {
      const record = await repository.saveGeneric(summary, reference, endReason);
      setRecords(data => [record, ...data.filter(item => item.id !== record.id)].slice(0, MAX_SESSION_RECORDS));
      setError('');
      return record;
    } catch (failure) {
      setError('Oturum kaydedilemedi. Site depolamasını kontrol edip tekrar dene.');
      throw failure;
    }
  }, [repository]);
  const saveStatic = useCallback(async (summary: StaticSessionSummary, reference: StaticSessionRecord['reference'], endReason: SessionRecord['endReason']) => {
    ++generation.current;
    try {
      if (!repository.saveStatic) throw new Error('Bu depolama sabit duruş kaydını desteklemiyor.');
      const record = await repository.saveStatic(summary, reference, endReason);
      setRecords(data => [record, ...data.filter(item => item.id !== record.id)].slice(0, MAX_SESSION_RECORDS));
      setError('');
      return record;
    } catch (failure) {
      setError('Oturum kaydedilemedi. Site depolamasını kontrol edip tekrar dene.');
      throw failure;
    }
  }, [repository]);
  const remove = useCallback(async (id: string) => {
    const current = ++generation.current;
    try { await repository.remove(id); if (current === generation.current) { setRecords(data => data.filter(record => record.id !== id)); setError(''); } return true; }
    catch { if (current === generation.current) setError('Oturum silinemedi. Tekrar dene.'); return false; }
  }, [repository]);
  const clear = useCallback(async () => {
    const current = ++generation.current;
    try { await repository.clear(); if (current === generation.current) { setRecords([]); setError(''); } return true; }
    catch { if (current === generation.current) setError('Geçmiş temizlenemedi. Tekrar dene.'); return false; }
  }, [repository]);
  return { records, loading, error, reload, save, saveGeneric, saveStatic, remove, clear };
}

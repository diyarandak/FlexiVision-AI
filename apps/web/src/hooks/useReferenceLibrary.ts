import type { ExerciseTemplate } from '@flexivision/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReferenceTemplateRepository } from '@flexivision/application';
import type { SavedReferenceTemplate } from '@flexivision/contracts';
import { BrowserReferenceTemplateRepository } from '../adapters/referenceLibrary.ts';
import type { ReferenceVideoRepository } from '../adapters/referenceVideoRepository.ts';
import { saveExerciseCollection } from '../adapters/saveExerciseCollection.ts';

export function useReferenceLibrary(supplied?: ReferenceTemplateRepository) {
  const [repository] = useState(() => supplied ?? new BrowserReferenceTemplateRepository());
  const [records, setRecords] = useState<SavedReferenceTemplate[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const generation = useRef(0);
  const [readAttempt, setReadAttempt] = useState(0);
  const reload = useCallback(() => { setLoading(true); setReadAttempt(value => value + 1); }, []);
  useEffect(() => {
    let disposed = false; const current = generation.current;
    void repository.list().then(data => { if (!disposed && current === generation.current) { setRecords(data); setError(''); } })
      .catch(() => { if (!disposed && current === generation.current) setError('Egzersizler okunamadı. Kayıtlar değiştirilmedi; site depolamasını kontrol et.'); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [repository, readAttempt]);
  const save = useCallback(async (template: ExerciseTemplate, name: string) => {
    ++generation.current;
    try {
      const record = await repository.save(template, name);
      setRecords(data => [record, ...data.filter(item => item.id !== record.id)]); setError(''); return record;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Egzersiz kaydedilemedi.'); throw failure;
    }
  }, [repository]);
  const saveWithVideo = useCallback(async (template: ExerciseTemplate, name: string, video: File,
    videos: ReferenceVideoRepository) => {
    ++generation.current;
    try {
      const record = await saveExerciseCollection(repository, videos, template, name, video);
      setRecords(data => [record, ...data.filter(item => item.id !== record.id)]); setError(''); return record;
    } catch (failure) {
      try { setRecords(await repository.list()); } catch { /* Preserve the last readable view. */ }
      setError(failure instanceof Error ? failure.message : 'Video ve egzersiz kaydedilemedi.'); throw failure;
    }
  }, [repository]);
  const rename = useCallback(async (id: string, name: string) => {
    ++generation.current;
    try {
      const record = await repository.rename(id, name);
      setRecords(data => data.map(item => item.id === id ? record : item)); setError(''); return record;
    } catch (failure) { setError('Egzersizin adı değiştirilemedi.'); throw failure; }
  }, [repository]);
  const remove = useCallback(async (id: string) => {
    ++generation.current;
    try { await repository.remove(id); setRecords(data => data.filter(item => item.id !== id)); setError(''); return true; }
    catch { setError('Egzersiz silinemedi. Tekrar dene.'); return false; }
  }, [repository]);
  const clear = useCallback(async () => {
    ++generation.current;
    try { await repository.clear(); setRecords([]); setError(''); return true; }
    catch { setError('Egzersizler temizlenemedi. Tekrar dene.'); return false; }
  }, [repository]);
  return { records, loading, error, reload, save, saveWithVideo, rename, remove, clear };
}

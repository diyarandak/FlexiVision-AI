import type { ExerciseTemplate } from '@flexivision/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExtractReferenceMap } from '@flexivision/application';
import type { BodyProfileRepository, ReferenceTemplateRepository, SessionHistoryRepository } from '@flexivision/application';
import type { AnalysisProgress, MotionMap } from '@flexivision/contracts';
import { AnalysisCancelled, BrowserPoseExtractor, type ReferenceDetail } from './adapters/browserPoseExtractor.ts';
import { MotionResults } from './components/MotionResults.tsx';
import { ReferenceVideoPreview } from './components/ReferenceVideoPreview.tsx';
import { CalibrationPanel } from './components/CalibrationPanel.tsx';
import { LiveExercisePanel } from './components/LiveExercisePanel.tsx';
import { StaticLiveExercisePanel } from './components/StaticLiveExercisePanel.tsx';
import { GenericLiveExercisePanel } from './components/GenericLiveExercisePanel.tsx';
import { BodyProfileCard } from './components/BodyProfileCard.tsx';
import { useBodyProfile } from './hooks/useBodyProfile.ts';
import { useSessionHistory } from './hooks/useSessionHistory.ts';
import { SessionHistoryPanel } from './components/SessionHistoryPanel.tsx';
import { useReferenceLibrary } from './hooks/useReferenceLibrary.ts';
import { ReferenceLibraryPanel } from './components/ReferenceLibraryPanel.tsx';
import { BrowserDemoSession } from './adapters/demoSession.ts';
import { DemoLogin } from './components/DemoLogin.tsx';
import { BodyProfileDetails } from './components/BodyProfileDetails.tsx';
import { NavIcon } from './components/NavIcon.tsx';
import { appSection, type AppSection } from './navigation.ts';
import { supportedVideoFile } from './adapters/videoFile.ts';
import { BrowserReferenceVideoRepository, PendingReferenceVideoDeletions, type ReferenceVideoRepository } from './adapters/referenceVideoRepository.ts';
import { preloadPoseModel } from './adapters/poseWorkerClient.ts';

const MAX_BYTES = 100 * 1024 * 1024;

export interface AppProps {
  bodyProfileRepository?: BodyProfileRepository;
  referenceRepository?: ReferenceTemplateRepository;
  referenceVideoRepository?: ReferenceVideoRepository;
  historyRepository?: SessionHistoryRepository;
  demoSession?: BrowserDemoSession;
  calibration?: Pick<Parameters<typeof CalibrationPanel>[0], 'createSource' | 'createSpeech'>;
}
export function App(props: AppProps = {}) {
  const [demoSession] = useState(() => props.demoSession ?? new BrowserDemoSession());
  const [entered, setEntered] = useState(() => { try { return demoSession.load(); } catch { return false; } });
  const [demoError, setDemoError] = useState('');
  const [section, setSection] = useState<AppSection>(() => appSection(location.hash));
  const sectionRef = useRef(section);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [map, setMap] = useState<MotionMap | null>(null);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [referenceDetail, setReferenceDetail] = useState<ReferenceDetail>(640);
  const [referenceMode, setReferenceMode] = useState<'free' | 'squat' | 'static'>('free');
  const [composerOpen, setComposerOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [videoSaving, setVideoSaving] = useState(false);
  const [collectionEditing, setCollectionEditing] = useState(false);
  const [videoStorageError, setVideoStorageError] = useState('');
  const [videoAvailability, setVideoAvailability] = useState<Record<string, 'checking' | 'available' | 'missing' | 'error'>>({});
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [liveExerciseTemplate, setLiveExerciseTemplate] = useState<ExerciseTemplate | null>(null);
  const bodyProfile = useBodyProfile(props.bodyProfileRepository);
  const history = useSessionHistory(props.historyRepository);
  const library = useReferenceLibrary(props.referenceRepository);
  const [referenceVideos] = useState<ReferenceVideoRepository>(() => props.referenceVideoRepository ?? new BrowserReferenceVideoRepository());
  const [pendingVideoDeletions] = useState(() => new PendingReferenceVideoDeletions());
  const videoSavingRef = useRef(false);
  const collectionEditingRef = useRef(false);
  const collectionGeneration = useRef(0);
  const videoReconciliation = useRef<Promise<void> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const analysisRef = useRef<ExtractReferenceMap | null>(null);
  const generation = useRef(0);
  const previewEndMs = useRef<number | null>(null);
  useEffect(() => {
    preloadPoseModel();
  }, []);
  useEffect(() => {
    let disposed = false;
    const ids = library.records.map(record => record.id);
    setVideoAvailability(previous => Object.fromEntries(ids.map(id => [id, previous[id] ?? 'checking'])));
    for (const id of ids) {
      void referenceVideos.has(id).then(found => {
        if (!disposed) setVideoAvailability(previous => ({ ...previous, [id]: found ? 'available' : 'missing' }));
      }).catch(() => {
        if (!disposed) setVideoAvailability(previous => ({ ...previous, [id]: 'error' }));
      });
    }
    return () => { disposed = true; };
  }, [library.records, referenceVideos]);
  useEffect(() => {
    if (library.loading || library.error || videoSavingRef.current || collectionEditingRef.current) return;
    let disposed = false;
    const ids = library.records.map(record => record.id);
    const previous = videoReconciliation.current;
    const work = (previous ?? Promise.resolve()).then(async () => {
      if (disposed) return;
      await pendingVideoDeletions.drain(referenceVideos, ids);
      if (!disposed) setVideoStorageError('');
    }).catch(() => {
      if (!disposed) setVideoStorageError('Silinmiş videoların bir kısmı cihazdan temizlenemedi. Depolama erişimini kontrol et; sonraki açılışta yeniden denenecek.');
    }).finally(() => { if (videoReconciliation.current === work) videoReconciliation.current = null; });
    videoReconciliation.current = work;
    return () => { disposed = true; };
  }, [library.records, library.loading, library.error, videoSaving, collectionEditing, referenceVideos, pendingVideoDeletions]);
  useEffect(() => {
    const changed = () => { videoRef.current?.pause(); const next = appSection(location.hash); sectionRef.current = next; setSection(next); };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  function goSection(next: AppSection) {
    videoRef.current?.pause(); sectionRef.current = next; setSection(next); location.hash = next;
    window.scrollTo({ top: 0 });
  }

  const stop = useCallback(() => {
    generation.current++; analysisRef.current?.cancel(); analysisRef.current = null;
    previewEndMs.current = null;
    setCalibrationOpen(false);
    setLiveExerciseTemplate(null);
  }, []);
  const previewFailure = useCallback((message: string) => {
    stop(); setBusy(false); setProgress(null); setError(message);
  }, [stop]);
  useEffect(() => () => { generation.current++; analysisRef.current?.cancel(); }, []);
  useEffect(() => {
    if (!file) { setUrl(''); return; }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  const previewRepetition = useCallback((startMs: number, endMs: number) => {
    const video = videoRef.current;
    if (!video) return;
    previewEndMs.current = endMs;
    video.currentTime = startMs / 1000;
    video.scrollIntoView({ behavior: 'smooth', block: 'center' });
    void video.play().catch(() => {
      previewEndMs.current = null;
      setNotice('Seçilen aralığın başlangıcına gidildi. Oynatmak için video kontrolünü kullan.');
    });
  }, []);
  const openCalibration = useCallback(() => {
    videoRef.current?.pause(); setCalibrationOpen(true);
  }, []);

  function selectFile(next: File | undefined) {
    if (videoSavingRef.current) { setNotice('Video kaydı sürüyor. Tamamlanınca başka bir video seçebilirsin.'); return; }
    if (next && !supportedVideoFile(next)) {
      setError('MP4, WebM veya MOV biçiminde bir video seç.'); return;
    }
    if (next && (next.size === 0 || next.size > MAX_BYTES)) {
      setError('Video boş olmamalı ve en fazla 100 MB olmalı.'); return;
    }
    stop(); setBusy(false); setProgress(null); setMap(null); setNotice('');
    if (next) setComposerOpen(true);
    setDuration(null); setError(''); setFile(next ?? null);
  }

  function closeComposer() {
    if (videoSavingRef.current) return;
    videoRef.current?.pause();
    if (busy) { stop(); setBusy(false); setProgress(null); setNotice('Analiz durduruldu. Videoyu yeniden analiz edebilirsin.'); }
    setComposerOpen(false);
    goSection('egzersizlerim');
  }

  async function saveTemplateWithVideo(template: ExerciseTemplate, name: string) {
    const source = file;
    if (!source) throw new Error('Kaydedilecek video bulunamadı. Videoyu yeniden seç.');
    if (videoSavingRef.current) throw new Error('Video kaydı hâlâ sürüyor.');
    if (collectionEditingRef.current) throw new Error('Egzersiz koleksiyonu düzenleniyor. Tamamlanınca tekrar dene.');
    videoSavingRef.current = true; setVideoSaving(true); setVideoStorageError('');
    const current = generation.current;
    try {
      await videoReconciliation.current;
      const record = await library.saveWithVideo(template, name, source, referenceVideos);
      setVideoAvailability(previous => ({ ...previous, [record.id]: 'available' }));
      if (current !== generation.current || sectionRef.current !== 'egzersizlerim') {
        throw new Error('Video kaydedildi. Egzersizlerim bölümünden daha sonra başlayabilirsin.');
      }
      return record;
    } finally { videoSavingRef.current = false; setVideoSaving(false); }
  }

  async function openSavedVideo(id: string) {
    if (collectionEditingRef.current || videoSavingRef.current) throw new Error('Koleksiyon işlemi sürüyor. Tamamlanınca videoyu yeniden aç.');
    const current = generation.current;
    const collectionAtOpen = collectionGeneration.current;
    let saved: File | null;
    try { saved = await referenceVideos.get(id); }
    catch (reason) { setVideoAvailability(previous => ({ ...previous, [id]: 'error' })); throw reason; }
    if (!saved) { setVideoAvailability(previous => ({ ...previous, [id]: 'missing' })); throw new Error('Kayıtlı video bulunamadı.'); }
    if (!supportedVideoFile(saved) || saved.size === 0 || saved.size > MAX_BYTES) {
      setVideoAvailability(previous => ({ ...previous, [id]: 'error' })); throw new Error('Kayıtlı video açılamıyor.');
    }
    if (current !== generation.current || collectionAtOpen !== collectionGeneration.current || collectionEditingRef.current)
      throw new Error('Koleksiyon değişti. Videoyu yeniden aç.');
    const selected = library.records.find(record => record.id === id);
    if (selected) setReferenceMode(selected.template.kind === 'static-pose-template' ? 'static' : selected.template.kind === 'generic-cycle-template' ? 'free' : 'squat');
    selectFile(saved); setComposerOpen(true); goSection('egzersizlerim');
    setNotice('Koleksiyondaki video açıldı. İzleyebilir veya yeniden analiz edebilirsin; kayıtlı egzersizin değişmez.');
    requestAnimationFrame(() => document.getElementById('reference-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function removeExercise(id: string): Promise<boolean> {
    if (videoSavingRef.current || collectionEditingRef.current || busy) return false;
    collectionGeneration.current++;
    collectionEditingRef.current = true; setCollectionEditing(true);
    try {
      await videoReconciliation.current;
      let retryQueued = true;
      try { pendingVideoDeletions.enqueue(id); }
      catch { retryQueued = false; } // A full local store must not prevent the user from deleting a record.
      if (!await library.remove(id)) return false;
      setVideoAvailability(previous => { const next = { ...previous }; delete next[id]; return next; });
      try { await referenceVideos.remove(id); }
      catch {
        setVideoStorageError(retryQueued
          ? 'Egzersiz silindi ancak video dosyası temizlenemedi. Sonraki açılışta yeniden denenecek.'
          : 'Egzersiz silindi ancak video dosyası temizlenemedi. Tarayıcı depolamasını kontrol et.');
        return true;
      }
      try { if (retryQueued) pendingVideoDeletions.dequeue(id); setVideoStorageError(''); }
      catch { setVideoStorageError('Video silindi; yerel temizlik kaydı sonraki açılışta yeniden kontrol edilecek.'); }
      return true;
    } catch {
      setVideoStorageError('Egzersiz silinemedi. Yerel depolama erişimini kontrol edip tekrar dene.');
      return false;
    } finally { collectionEditingRef.current = false; setCollectionEditing(false); }
  }

  async function clearExercises(): Promise<boolean> {
    if (videoSavingRef.current || collectionEditingRef.current || busy) return false;
    collectionGeneration.current++;
    collectionEditingRef.current = true; setCollectionEditing(true);
    try {
      await videoReconciliation.current;
      let allQueued = true;
      for (const record of library.records) {
        try { pendingVideoDeletions.enqueue(record.id); }
        catch { allQueued = false; }
      }
      if (!await library.clear()) return false;
      setVideoAvailability({});
      try {
        await referenceVideos.clear();
      } catch {
        setVideoStorageError(allQueued
          ? 'Egzersizler silindi ancak bazı video dosyaları cihazda kaldı. Sonraki açılışta yeniden denenecek.'
          : 'Egzersizler silindi ancak bazı video dosyaları cihazda kaldı. Tarayıcı depolamasını kontrol et.');
        return true;
      }
      try {
        for (const id of pendingVideoDeletions.pending()) pendingVideoDeletions.dequeue(id);
        setVideoStorageError('');
      } catch { setVideoStorageError('Videolar silindi; yerel temizlik kayıtları sonraki açılışta yeniden kontrol edilecek.'); }
      return true;
    } catch {
      setVideoStorageError('Egzersizler temizlenemedi. Yerel depolama erişimini kontrol edip tekrar dene.');
      return false;
    } finally { collectionEditingRef.current = false; setCollectionEditing(false); }
  }

  async function analyze() {
    if (!file || !url || busy) return;
    stop(); const current = generation.current;
    setBusy(true); setMap(null); setError(''); setNotice(''); setProgress(null);
    videoRef.current?.pause();
    try {
      const useCase = new ExtractReferenceMap(new BrowserPoseExtractor(referenceDetail), referenceMode);
      analysisRef.current = useCase;
      const result = await useCase.execute({ uri: url, name: file.name }, update => {
        if (current !== generation.current) return;
        setProgress(update);
        if (update.frame && videoRef.current) videoRef.current.currentTime = update.frame.timestampMs / 1000;
      });
      if (current !== generation.current) return;
      setMap(result);
      if (videoRef.current) videoRef.current.currentTime = 0;
    } catch (failure) {
      if (current !== generation.current) return;
      if (!(failure instanceof AnalysisCancelled)) setError(failure instanceof Error ? failure.message : 'Analiz tamamlanamadı. Yeniden deneyin.');
    } finally {
      if (current === generation.current) { setBusy(false); setProgress(null); analysisRef.current = null; }
    }
  }

  const workspaceVisible = composerOpen || (!library.loading && !library.error && library.records.length === 0) || busy;
  const validDuration = duration !== null && Number.isFinite(duration) && duration >= 3 && duration <= 60;
  const percent = progress && progress.total > 0 ? Math.round(progress.completed / progress.total * 100) : 0;

  if (!entered) return <DemoLogin error={demoError} onEnter={() => {
    try { demoSession.enter(); setDemoError(''); }
    catch { setDemoError('Tarayıcı demo girişini saklayamadı. Bu sayfada devam edebilirsin; yenilemede tekrar giriş gerekebilir.'); }
    setEntered(true);
  }} />;
  return <div className="app-shell has-app-nav">
    <header className="topbar">
      <a className="brand" href="#vucudum" aria-label="FlexiVision ana sayfa"><span className="brand-mark">f.</span>FlexiVision</a>
      <details className="demo-account"><summary>Demo alanı</summary><button className="text-button" onClick={() => {
        stop(); setBusy(false); setProgress(null); setMap(null); setFile(null);
        try { demoSession.leave(); setDemoError(''); } catch { setDemoError('Demo giriş kaydı silinemedi. Site depolamasını kontrol et.'); }
        setEntered(false);
      }}>Çıkış</button></details>
    </header>
    <nav className="app-navigation" aria-label="Ana bölümler">{([
      ['vucudum', 'Vücudum'], ['egzersizlerim', 'Egzersizlerim'], ['gecmis', 'Geçmiş'],
    ] as const).map(([key,label]) => <a key={key} href={`#${key}`} aria-current={section === key ? 'page' : undefined}
      onClick={() => { videoRef.current?.pause(); sectionRef.current = key; setSection(key); window.scrollTo({ top: 0 }); }}><NavIcon section={key} />{label}</a>)}</nav>
    <main>
      <p className="local-account-note"><span aria-hidden="true">●</span> Cihazında saklanır · Demo alanı</p>
      {demoError && <p className="message error" role="alert">{demoError}</p>}
      {busy && section !== 'egzersizlerim' && <button className="analysis-running" onClick={() => goSection('egzersizlerim')}>Referans analizi devam ediyor · Sonuca dön →</button>}
      <section hidden={section !== 'vucudum'} aria-labelledby="my-body-title">
        <div className="section-heading"><p className="eyebrow">KİŞİSEL BAŞLANGIÇ NOKTAN</p><h1 id="my-body-title">Vücudum</h1><p>Bir kez ölç, sonraki egzersizlerde aynı profili kullan.</p></div>
        <BodyProfileCard saved={bodyProfile.saved} loading={bodyProfile.loading} error={bodyProfile.error}
          busy={busy} onScan={openCalibration} onRetry={bodyProfile.reload} onClear={bodyProfile.clear} onExercises={() => goSection('egzersizlerim')} />
        {bodyProfile.saved && <BodyProfileDetails saved={bodyProfile.saved} />}
      </section>
      <section hidden={section !== 'egzersizlerim'} aria-labelledby="my-exercises-title">
      <div className="section-heading exercise-heading">
        <p className="eyebrow">HAREKET ALANIN</p>
        <div className="exercise-heading-row"><h1 id="my-exercises-title">Egzersizlerim</h1>
          {library.records.length > 0 && !composerOpen && !busy &&
            <button className="secondary-button add-exercise-button" onClick={() => setComposerOpen(true)}>{file ? 'Videoya dön' : '+ Yeni hareket'}</button>}</div>
        <p>{library.error ? 'Kayıtlarına yeniden erişmek için aşağıdaki yönlendirmeyi izle.' : library.records.length > 0 ? 'Kayıtlı hareketini seç veya yeni bir video ekle.' : 'Bir video ekle; tekrarlı hareket veya sabit duruş şablonu çıkaralım.'}</p>
      </div>
      {!composerOpen && (library.records.length > 0 || library.loading || !!library.error) && <ReferenceLibraryPanel records={library.records} loading={library.loading} error={library.error} disabled={busy || videoSaving || collectionEditing}
        videoAvailability={videoAvailability} onOpenVideo={openSavedVideo}
        onStartLive={template => { if (collectionEditingRef.current || videoSavingRef.current) return; videoRef.current?.pause(); setLiveExerciseTemplate(template); }} onRename={library.rename}
        onRemove={removeExercise} onClear={clearExercises} onRetry={library.reload} />}
      {videoStorageError && <p className="message error" role="alert">{videoStorageError}</p>}
      {(workspaceVisible || !!file || !!map) && <div className="workspace" hidden={!workspaceVisible}>
        <section className="card upload-card" aria-labelledby="reference-title">
          {library.records.length > 0 && <button className="text-button" disabled={videoSaving} onClick={closeComposer}>← Koleksiyonuma dön</button>}
          <div className="card-heading"><div><p className="eyebrow">YENİ HAREKET</p><h2 id="reference-title">Video ekle</h2></div><span className="local-badge">{referenceMode === 'static' ? 'Sabit duruş' : referenceMode === 'free' ? 'Tekrarlı hareket' : 'Squat'}</span></div>
          {!file && !map && <p className="upload-lead">Kamerası sabit, tek kişinin göründüğü 3–60 saniyelik video seç.</p>}
          <div className="reference-options"><span className="local-badge">{referenceMode === 'static' ? 'Sabit duruş' : referenceMode === 'free' ? 'Tekrarlı hareket' : 'Squat'} · {referenceDetail === 640 ? 'Dengeli' : 'Ayrıntılı'}</span>
          <fieldset className="reference-mode" disabled={busy || videoSaving}>
            <legend>Nasıl analiz edelim?</legend>
            <label><input type="radio" name="reference-mode" value="free" checked={referenceMode === 'free'} onChange={() => setReferenceMode('free')} /> Tekrarlı hareket <small>Görünür bir tekrarın hareket izini çıkar</small></label>
            <label><input type="radio" name="reference-mode" value="static" checked={referenceMode === 'static'} onChange={() => setReferenceMode('static')} /> Sabit duruş <small>En az 2 saniye korunan duruşu seç; canlıda süre tut</small></label>
            <label><input type="radio" name="reference-mode" value="squat" checked={referenceMode === 'squat'} onChange={() => setReferenceMode('squat')} /> Squat ön ayarı <small>Yandan çekilmiş tam squat döngüsünü doğrula</small></label>
          </fieldset>
          <details><summary>Görüntü ayrıntısı</summary><label className="reference-detail">Görüntü ayrıntısı
            <select value={referenceDetail} disabled={busy || videoSaving} onChange={event => setReferenceDetail(Number(event.target.value) as ReferenceDetail)}>
              <option value={640}>Dengeli · daha hafif</option><option value={960}>Ayrıntılı · daha fazla işlem</option>
            </select><small>Eklemler küçük görünüyorsa Ayrıntılı seçeneğini dene.</small>
          </label></details></div>
          <label className={`upload-area ${file ? 'has-file' : ''}`}>
            <span className="upload-icon" aria-hidden="true">↑</span>
            <strong>{file ? 'Videoyu değiştir' : 'Video seç'}</strong>
            <span>MP4, WebM veya MOV · 3–60 saniye · En fazla 100 MB</span>
            <input type="file" disabled={videoSaving} accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" onChange={event => {
              const selected = event.target.files?.[0];
              if (selected) selectFile(selected);
              event.target.value = '';
            }} />
          </label>
          {file && url && <div className="preview">
            <ReferenceVideoPreview key={url} url={url} videoRef={videoRef} map={map} progressFrame={progress?.frame}
              busy={busy} active={workspaceVisible && entered && section === 'egzersizlerim' && !calibrationOpen && !liveExerciseTemplate}
              previewEndMs={previewEndMs} onDuration={setDuration} onFailure={previewFailure} />
            <div className="file-info"><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(1)} MB{duration !== null && Number.isFinite(duration) ? ` · ${duration.toFixed(1)} sn` : ''}</span></div>
            <button className="text-button" disabled={videoSaving} onClick={() => selectFile(undefined)}>Videoyu kaldır</button>
          </div>}
          <div aria-live="polite">
            {error && <p className="message error" role="alert">{error}</p>}
            {notice && <p className="message">{notice}</p>}
            {duration !== null && !validDuration && <p className="message error">Lütfen 3–60 saniye uzunluğunda bir video seç.</p>}
          </div>
          {busy ? <div className="analysis-progress">
            <p role="status">{progress?.stage === 'extracting' ? `Kareler analiz ediliyor · ${percent}%` : 'Poz modeli hazırlanıyor…'}</p>
            <progress value={percent} max="100" aria-label="Video analiz ilerlemesi" />
            <button className="secondary-button" onClick={() => { stop(); setBusy(false); setProgress(null); setNotice('Analiz iptal edildi. Videoyu yeniden analiz edebilirsin.'); }}>Analizi iptal et</button>
          </div> : file && !map ? <button className="primary-button analyze-button" disabled={!url || !validDuration} onClick={analyze}>
            Videoyu analiz et <span aria-hidden="true">↗</span>
          </button> : null}
          {!map && file && <p className="implementation-note">{referenceMode === 'static' ? 'Hedef duruşun en az 2 saniye kesintisiz korunduğu bir video seç. Omuz, kalça, dirsek, el bileği, diz ve ayak bilekleri görünmeli. Referanstaki bekleme süresi canlı hedefini belirlemez.' : referenceMode === 'free'
            ? 'Tek kişinin bir hareketi baştan sona yaptığı, kameranın sabit olduğu bir video seç. Hareketin başlangıç ve bitiş duruşu görünsün; aynı hareketi canlıda benzer kamera açısından yapabileceğin bir kayıt kullan.'
            : 'Yandan çekilmiş squat için ayakta → çömelme → tekrar ayakta sırası ve görünür omuz, kalça, diz, ayak bileği gerekir. Kaydı ayakta başlat ve tekrar ayağa kalktıktan sonra bitir.'}</p>}
          {map && <MotionResults map={map} mode={referenceMode} onPreview={previewRepetition} onSaveTemplate={saveTemplateWithVideo} savedReferenceIds={library.records.map(record => record.id)}
            onStartLive={template => {
              videoRef.current?.pause(); setLiveExerciseTemplate(template);
              setFile(null); setMap(null); setDuration(null); setComposerOpen(false); setNotice('');
            }} />}
          {map && <button className="text-button" disabled={videoSaving} onClick={analyze}>Videoyu yeniden analiz et</button>}
        </section>
        <details className="card tips-card"><summary>İyi bir video için kısa ipuçları</summary><ul>
            <li><span>01</span><div><strong>Tek kişi görünsün</strong><p>{referenceMode === 'static' ? 'Omuz, kalça, dirsek, el bileği, diz ve ayak bilekleri görünmeli.' : referenceMode === 'free' ? 'Omuz, kalça ve hareket eden eklemler kadrajda olsun. Kol hareketinde tüm bacakların görünmesi gerekmez.' : 'Omuz, kalça, diz ve ayak bileği kadrajda olsun.'}</p></div></li>
            <li><span>02</span><div><strong>Kamera sabit kalsın</strong><p>Egzersizi aynı açıdan yapabileceğin bir video seç.</p></div></li>
            <li><span>03</span><div><strong>Başlangıç ve bitiş görünsün</strong><p>{referenceMode === 'static' ? 'Hedef duruşu en az 2 saniye kesintisiz koru. Başlangıç ve bitişte aynı duruşa dönmek gerekmez.' : referenceMode === 'free' ? 'Seçtiğin hareketin tam bir tekrarını, öncesi ve sonrasıyla kaydet.' : 'En az bir ayakta → çömelme → tekrar ayakta döngüsü olsun. Başta ve sonda kısa süre ayakta kal.'}</p></div></li>
          </ul></details>
      </div>}
      </section>
      <section hidden={section !== 'gecmis'} aria-labelledby="my-history-title"><div className="section-heading"><p className="eyebrow">SEANS RAPORLARIN</p><h1 id="my-history-title">Geçmiş</h1><p>Tamamlanan ve kesilen seanslarını burada incele.</p></div>
      <SessionHistoryPanel records={history.records} loading={history.loading} error={history.error}
        onRemove={history.remove} onClear={history.clear} onRetry={history.reload} />
      </section>
      {calibrationOpen && createPortal(<CalibrationPanel onSave={bodyProfile.save}
        {...props.calibration} onClose={() => { setCalibrationOpen(false); goSection('vucudum'); }}
        onGoExercises={() => { setCalibrationOpen(false); goSection('egzersizlerim'); }} />, document.body)}
      {liveExerciseTemplate && createPortal(liveExerciseTemplate.kind === 'static-pose-template'
        ? <StaticLiveExercisePanel template={liveExerciseTemplate} onSave={history.saveStatic} onClose={() => setLiveExerciseTemplate(null)} />
        : liveExerciseTemplate.kind === 'generic-cycle-template'
        ? <GenericLiveExercisePanel template={liveExerciseTemplate} bodyProfile={bodyProfile.saved?.profile ?? null}
          onSave={history.saveGeneric}
          onClose={() => setLiveExerciseTemplate(null)} onGoBody={() => { setLiveExerciseTemplate(null); goSection('vucudum'); }} />
        : <LiveExercisePanel template={liveExerciseTemplate}
          bodyProfile={bodyProfile.saved?.profile ?? null} onSave={history.save}
          onClose={() => setLiveExerciseTemplate(null)} />, document.body)}
    </main>
    <footer><span>FlexiVision AI</span><span>Video ve kamera görüntüsü cihazında kalır.</span></footer>
  </div>;
}

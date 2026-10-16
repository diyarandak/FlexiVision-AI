import { CameraOptions as CameraOptionsSheet } from './CameraOptions.tsx';
import { useEffect, useRef, useState } from 'react';
import { CalibrateBody } from '@flexivision/application';
import type { CalibrationReading, LivePoseSource, SpeechOutput } from '@flexivision/application';
import type { CalibrationGuide, CalibrationProfile } from '@flexivision/contracts';
import { CalibrationStreamTiming, CalibrationVoicePolicy } from '@flexivision/core';
import { BrowserCameraPose, preferredCameraOptions, type CameraOptions } from '../adapters/browserCameraPose.ts';
import { createBrowserSpeech } from '../adapters/speech.ts';
import { Skeleton } from './MotionResults.tsx';
import { BodyPoseHint } from './BodyPoseHint.tsx';
import { CameraFraming } from './CameraFraming.tsx';
import { CameraSettings } from './CameraSettings.tsx';
import { CameraLensControls } from './CameraLensControls.tsx';

const INTRO = 'Ayakta rahat dur. Kameraya bak. Kolların gövdeni kapatmasın.';
const PROCESSING_ERROR = 'Cihaz görüntüyü zamanında işleyemedi. Diğer uygulamaları kapatıp kamerayı yeniden aç.';
const GUIDES: Record<CalibrationGuide, { title: string; detail: string }> = {
  no_person: { title: 'Kameranın karşısına geç', detail: 'Başından ayaklarına kadar görünmelisin.' },
  multiple_people: { title: 'Kadrajda tek kişi kalsın', detail: 'Diğer kişiler görüntüden çıksın.' },
  show_shoulders: { title: 'Omuzlarını göster', detail: 'Kamerayı biraz yukarı çevir veya daha geniş kadrajlı lensi dene. Işık önünden gelsin.' },
  show_hips: { title: 'Kalçanı görünür hale getir', detail: 'Kollarını gövdenden biraz ayır. Önünü kapatan nesneleri kaldır.' },
  show_knees: { title: 'Dizlerini kadraja al', detail: 'Önce kamerayı biraz aşağı çevir veya daha geniş kadrajlı lensi dene.' },
  show_ankles: { title: 'Ayaklarını kadraja al', detail: 'Önce kamerayı biraz aşağı çevir veya daha geniş kadrajlı lensi dene.' },
  step_back: { title: 'Başın ve ayakların kesiliyor', detail: 'Kamera açısını düzelt veya en geniş kadrajı dene. Yetmezse biraz geri çekil.' },
  step_closer: { title: 'Biraz yaklaş', detail: 'Başın ve ayakların görünür kalıyorsa kameraya biraz yaklaş.' },
  center_body: { title: 'Kadrajın ortasına geç', detail: 'Gövden ekranın merkezinde olsun.' },
  face_camera: { title: 'Kameraya bak', detail: 'Başın net görünsün. Işık yüzünün önünden gelsin.' },
  stand_straight: { title: 'Ayakta rahat dur', detail: 'Çömelme. Dizlerini rahatça düz tut.' },
  hold_still: { title: 'Görüldün · duruşunu koru', detail: 'Başlangıç ölçülerin alınıyor. Kollarını kilitlemen gerekmiyor.' },
  ready: { title: 'Vücut ölçümün tamamlandı', detail: 'Bu profil egzersiz videolarından bağımsızdır.' },
};
type Status = 'idle' | 'starting' | 'active' | 'stopped' | 'saving' | 'saved' | 'save_failed';

export function CalibrationPanel({ onClose, onSave, onGoExercises, createSource = (video, options) => new BrowserCameraPose(video, undefined, options),
  createSpeech = onError => createBrowserSpeech({ replace: true, onError }) }: {
  onClose: () => void; onSave: (profile: CalibrationProfile) => Promise<void>;
  onGoExercises?: (() => void) | undefined;
  createSource?: (video: HTMLVideoElement, options: CameraOptions) => LivePoseSource;
  createSpeech?: (onError: () => void) => SpeechOutput;
}) {
  const [fillCamera, setFillCamera] = useState(false);
  const panelRef = useRef<HTMLElement>(null), videoRef = useRef<HTMLVideoElement>(null);
  const taskRef = useRef<CalibrateBody | null>(null), runId = useRef(0);
  const timing = useRef(new CalibrationStreamTiming());
  const speechRef = useRef<SpeechOutput | null>(null), speechPolicy = useRef(new CalibrationVoicePolicy());
  const soundRef = useRef(true), savingRef = useRef(false);
  const manualCaptureOrientation = useRef(false);
  const [status, setStatus] = useState<Status>('idle');
  const [reading, setReading] = useState<CalibrationReading | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [mirrored, setMirrored] = useState(true), [stale, setStale] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [sound, setSound] = useState(true), [speechError, setSpeechError] = useState('');
  const [cameraOptions, setCameraOptions] = useState<CameraOptions>(preferredCameraOptions);
  const [viewportPortrait, setViewportPortrait] = useState(() => preferredCameraOptions().portrait ?? true);
  const [capturePortrait, setCapturePortrait] = useState<boolean | null>(null);
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);

  function updateVideoSize() {
    const video = videoRef.current;
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      setVideoSize({ width: video.videoWidth, height: video.videoHeight });
    }
  }

  function cancelSpeech() { try { speechRef.current?.cancel(); } catch { /* Closing must always release the dialog lock. */ } }
  function releaseTask() {
    const task = taskRef.current; taskRef.current = null; timing.current.reset();
    try { task?.stop(); } catch { setNotice('Kamera kapatılırken bir teknik sorun oluştu. Kamera göstergesi açık kalırsa sayfayı yenile.'); }
  }
  function releaseCamera() {
    runId.current++; releaseTask(); cancelSpeech(); savingRef.current = false;
  }
  function stop(message = 'Kamera kapatıldı. Yeniden açınca ölçüm baştan başlayacak.') {
    releaseCamera(); setStatus('stopped'); setReading(null); setStale(false); setProcessing(false);
    setCapturePortrait(null); setVideoSize(null); setNotice(message);
  }
  function ensureSpeech() {
    if (!speechRef.current) speechRef.current = createSpeech(() => setSpeechError('Ses çalınamadı. Cihazın sesini ve tarayıcı desteğini kontrol et.'));
    if (!speechRef.current.available) setSpeechError('Bu tarayıcıda sesli yönlendirme kullanılamıyor. Büyük yazıları takip edebilirsin.');
    return speechRef.current;
  }
  function say(text: string) {
    if (!soundRef.current) return;
    try {
      void Promise.resolve(ensureSpeech().speak(text)).catch(() => {
        setSpeechError('Ses çalınamadı. Ekrandaki yönlendirmeyi takip et.');
      });
    } catch { setSpeechError('Ses çalınamadı. Ekrandaki yönlendirmeyi takip et.'); }
  }

  useEffect(() => {
    const orientation = window.matchMedia('(orientation: portrait)');
    const updateOrientation = () => {
      setViewportPortrait(orientation.matches);
      if (!manualCaptureOrientation.current) setCameraOptions(options => ({ ...options, portrait: orientation.matches }));
    };
    orientation.addEventListener('change', updateOrientation);
    window.addEventListener('resize', updateOrientation);
    updateOrientation();
    return () => { orientation.removeEventListener('change', updateOrientation); window.removeEventListener('resize', updateOrientation); };
  }, []);
  useEffect(() => {
    const video = videoRef.current;
    video?.addEventListener('resize', updateVideoSize);
    return () => video?.removeEventListener('resize', updateVideoSize);
  }, []);
  useEffect(() => {
    if (status === 'starting') panelRef.current?.scrollTo({ top: 0 });
  }, [status]);
  useEffect(() => {
    const previousFocus = document.activeElement, previousOverflow = document.body.style.overflow;
    const app = document.getElementById('root'), wasInert = app?.inert ?? false;
    document.body.style.overflow = 'hidden';
    if (app) app.inert = true;
    panelRef.current?.focus();
    const suspend = () => { if (document.hidden && taskRef.current) stop('Sekmeden ayrıldığın için kamera kapatıldı. Yeniden açıp ölçümü tekrarla.'); };
    const hide = () => { if (taskRef.current) stop('Sayfadan ayrıldığın için kamera kapatıldı.'); };
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { stop(''); onClose(); return; }
      if (event.key !== 'Tab') return;
      const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button, input, select, summary') ?? [])
        .filter(element => !element.hasAttribute('disabled') && element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('visibilitychange', suspend); window.addEventListener('pagehide', hide); document.addEventListener('keydown', keys);
    return () => {
      try { releaseCamera(); } finally {
        document.body.style.overflow = previousOverflow; if (app) app.inert = wasInert;
        if (previousFocus instanceof HTMLElement) previousFocus.focus();
      }
      document.removeEventListener('visibilitychange', suspend); window.removeEventListener('pagehide', hide); document.removeEventListener('keydown', keys);
    };
  }, []);
  useEffect(() => {
    if (status !== 'active' && status !== 'starting') return;
    const timer = setInterval(() => {
      if (!taskRef.current || savingRef.current) return;
      const health = timing.current.check(performance.now());
      setProcessing(health === 'processing');
      if (health === 'timed_out') {
        stop(''); setError(PROCESSING_ERROR); say(PROCESSING_ERROR);
      } else if (health === 'stale') {
        taskRef.current.invalidate(); setReading(null); setStale(true);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [status]);

  const guide = reading?.update.guide ?? 'no_person', progress = reading?.update.progress ?? 0;
  const guidance = processing ? { title: 'Görüntü işleniyor · duruşunu koru', detail: 'Telefon görüntüyü analiz ediyor. İlerlemen korunuyor; ayakta rahat durmaya devam et.' }
    : stale ? { title: 'Kameradan yeni ölçüm gelmiyor', detail: 'Kamera akışı kesildi. Bağlantıyı kontrol et veya kamerayı yeniden aç.' } : GUIDES[guide];
  useEffect(() => {
    if (status !== 'active' || !sound) return;
    const key = processing ? 'processing' : stale ? 'stale' : guide;
    const timer = setInterval(() => {
      if (speechPolicy.current.next(key, performance.now(), !processing && guide !== 'hold_still')) say(guidance.title + '. ' + guidance.detail);
    }, 250);
    return () => clearInterval(timer);
  }, [status, sound, guide, stale, processing]);

  async function save(profile: CalibrationProfile, current: number) {
    setStatus('saving'); setProcessing(false); setError(''); cancelSpeech();
    try {
      await onSave(profile);
      if (current !== runId.current) return;
      setStatus('saved'); say('Vücut profilin kaydedildi. Artık kameraya yaklaşabilirsin. Her egzersizde yeniden tarama gerekmiyor.');
    } catch {
      if (current !== runId.current) return;
      setStatus('save_failed'); setError('Ölçüm alındı ama profil kaydedilemedi. Tarayıcının site depolama iznini kontrol edip tekrar kaydet.');
      say('Ölçüm tamamlandı ama profil kaydedilemedi. Ekrana yaklaş ve tekrar kaydet düğmesini kullan.');
    }
  }
  async function start() {
    if (!videoRef.current) return;
    stop(''); const current = runId.current;
    const selectedOptions = manualCaptureOrientation.current ? cameraOptions : { ...cameraOptions, portrait: preferredCameraOptions().portrait ?? true };
    setCameraOptions(selectedOptions); setCapturePortrait(selectedOptions.portrait ?? false);
    setError(''); setNotice(''); setSpeechError(''); setStatus('starting');
    speechPolicy.current = new CalibrationVoicePolicy(); speechPolicy.current.begin(performance.now());
    say(INTRO);
    let task: CalibrateBody;
    try { task = new CalibrateBody(createSource(videoRef.current, selectedOptions)); }
    catch (failure) {
      if (current !== runId.current) return;
      const message = failure instanceof Error ? failure.message : 'Kamera başlatılamadı. Yeniden dene.';
      stop(''); setError(message); say(message); return;
    }
    taskRef.current = task;
    await task.start(next => {
      if (current !== runId.current || savingRef.current) return;
      if (!timing.current.received(next.observation.frame.timestampMs, performance.now())) {
        stop(''); setError(PROCESSING_ERROR); say(PROCESSING_ERROR); return;
      }
      setReading(next); setStale(false); setProcessing(false); setStatus('active');
      if (next.update.profile) {
        savingRef.current = true; setStatus('saving'); releaseTask();
        void save(next.update.profile, current);
      }
    }, failure => {
      if (current !== runId.current) return;
      stop(''); setError(failure.message); say(failure.message);
    }, timestampMs => { if (current === runId.current && !savingRef.current) timing.current.captureStarted(timestampMs); });
  }
  const active = status === 'active' || status === 'starting', finished = status === 'saved' || status === 'saving' || status === 'save_failed';
  const feedPortrait = videoSize ? videoSize.height > videoSize.width : capturePortrait;
  const orientationMismatch = active && feedPortrait !== null && feedPortrait !== viewportPortrait;
  useEffect(() => {
    if (orientationMismatch && sound) say('Telefonun yönü değişti. Kamerayı durdurup kadrajı yeniden seç.');
  }, [orientationMismatch, sound]);
  const title = processing ? guidance.title : status === 'starting' ? 'Kamera ve model hazırlanıyor…' : status === 'saved' ? 'Profilin kaydedildi'
    : status === 'saving' ? 'Profilin kaydediliyor…' : status === 'save_failed' ? 'Kaydetme tamamlanamadı'
    : active ? guidance.title : 'Ayakta rahat dur, kameraya bak';
  const detail = status === 'saved' ? 'Artık yaklaşabilirsin. Yeni egzersiz videolarında bu kayıt kullanılacak.'
    : active ? guidance.detail : 'Referanstaki egzersizi yapma. T pozu zorunlu değil; başın, omuzların, kalçan, dizlerin ve ayakların görünsün.';

  return <section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="calibration-title" aria-describedby="calibration-purpose" className={'body-scan-dialog' + (active ? ' camera-running' : '') + (fillCamera ? ' fill-camera' : '')}>
    <header className="body-scan-header"><div><p className="eyebrow">VÜCUT PROFİLİ · BİR KEZ ÖLÇ</p><h2 id="calibration-title">Kendini kameraya tanıt</h2></div>
      <div className="scan-toolbar"><button className="secondary-button" aria-label={sound ? 'Sesli yönlendirmeyi kapat' : 'Sesli yönlendirmeyi aç'} aria-pressed={sound} onClick={() => {
        const next = !sound; setSound(next); soundRef.current = next;
        if (!next) cancelSpeech();
        else { speechPolicy.current = new CalibrationVoicePolicy(); speechPolicy.current.begin(performance.now()); say(active ? guidance.title + '. ' + guidance.detail : INTRO); }
      }}>{sound ? 'Ses açık' : 'Ses kapalı'}</button>
      <button className="secondary-button" onClick={() => { stop(''); onClose(); }}>Kapat</button></div>
    </header>
    {finished ? <section className="scan-result-card">
      <span className="scan-result-icon" aria-hidden="true">{status === 'saved' ? '✓' : status === 'saving' ? '…' : '!'}</span>
      <h3 role="status">{status === 'saved' ? 'Vücudun kayıtlı, hazırsın' : status === 'saving' ? 'Ölçüm tamamlandı · profil kaydediliyor' : 'Ölçüm alındı, kayıt tamamlanmadı'}</h3>
      <p>{status === 'saved' ? 'Kamerayı durdurduk. Vücudum bölümünde başlangıç ölçülerini görebilirsin; her egzersizde tekrar taraman gerekmez.'
        : status === 'saving' ? 'Kaydın tamamlanması bekleniyor.' : 'Ölçülerin henüz saklanmadı. Yeniden taramadan kaydetmeyi tekrar deneyebilirsin.'}</p>
      {error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message" role="status">{notice}</p>}
      {status === 'saved' && <div className="scan-result-actions"><button className="primary-button" onClick={() => { stop(''); if (onGoExercises) onGoExercises(); else onClose(); }}>{onGoExercises ? 'Egzersizlerime geç' : 'Vücuduma dön'} <span aria-hidden="true">→</span></button></div>}
      {status === 'save_failed' && <div className="scan-result-actions"><button className="primary-button" onClick={() => { if (reading?.update.profile) void save(reading.update.profile, runId.current); }}>Kaydetmeyi tekrar dene</button>
        <button className="text-button" onClick={() => { stop(''); onClose(); }}>Kaydetmeden kapat</button></div>}
      <small>Video saklanmadı. Sayısal ölçülerin bu tarayıcıda tutulur.</small>
    </section> : <>
    <div className="body-scan-guidance">
      <h3 role="status">{title}</h3><p>{detail}</p>
      {(active || finished) && <div className="scan-progress"><progress max={100} value={progress * 100} aria-label="Vücut ölçümü ilerlemesi" /><strong>{Math.round(progress * 100)}%</strong>
        <span>{finished ? 'Başlangıç ölçümü tamam' : (progress * 2.5).toFixed(1) + ' / 2,5 sn ölçüldü'}</span></div>}
    </div>
    {!active && !finished && <button className="primary-button camera-start-button" onClick={() => { void start(); }}>Kamerayı aç ve tara <span aria-hidden="true">→</span></button>}
    {!active && !finished && <details className="scan-settings"><summary>Kamera seçimi ve kadraj</summary><CameraSettings value={cameraOptions} disabled={false}
      onChange={value => {
        if (value.portrait !== cameraOptions.portrait) manualCaptureOrientation.current = true;
        setCameraOptions(value); setMirrored(value.facingMode === 'user');
      }} /></details>}
    {orientationMismatch && <div className="camera-orientation-tip" role="status">
      <strong>Kamera görüntüsü telefonun yönüne uymuyor.</strong>
      <span>Kamerayı durdurup Kadraj bölümünden {viewportPortrait ? 'Dikey' : 'Yatay'} seçerek yeniden aç. Lens bu görünümü sunmuyorsa diğer kamerayı dene.</span>
      <button className="secondary-button" onClick={() => stop('')}>Kadrajı ayarla</button>
    </div>}
    <div className="body-scan-views"><div className="scan-camera-area">
      <div className={'camera-stage' + (mirrored ? ' mirrored' : '') + (active && videoSize && !orientationMismatch ? ' natural-preview' : '')}
        style={videoSize ? { aspectRatio: `${videoSize.width} / ${videoSize.height}` } : undefined}>
        <video ref={videoRef} muted playsInline aria-label="Canlı vücut tarama kamerası" onLoadedMetadata={updateVideoSize} />
        {reading && !finished && <Skeleton fill={fillCamera} frame={reading.observation.frame} width={reading.observation.width} height={reading.observation.height} />}
        {!active && <div className="camera-placeholder">Kamera açılınca burada görüneceksin</div>}
      </div>
      
    </div>{!active && <BodyPoseHint />}</div>
    <div className="scan-bottom">
      <p id="calibration-purpose">Ayakta rahat dur. Bu ölçüm bir kez yapılır; video kaydedilmez.</p>
      {!active && speechError && <p className="message error" role="alert">{speechError}</p>}
      {error && <p className="message error" role="alert">{error}</p>}
      {notice && <p className="message">{notice}</p>}
      <div className="template-actions">
        {active && <button className="secondary-button" onClick={() => stop()}>Kamerayı durdur</button>}
      </div>
      {active && <CameraOptionsSheet notice={speechError}><label className="mirror-option"><input type="checkbox" checked={mirrored} onChange={event => setMirrored(event.target.checked)} /> Ayna</label><CameraFraming fill={fillCamera} onChange={setFillCamera} /><CameraLensControls video={videoRef.current} active={active} /><button className="secondary-button" onClick={() => { taskRef.current?.invalidate(); setReading(null); setStale(false); }}>Yeniden başlat</button></CameraOptionsSheet>}
    </div></>}
  </section>;
}

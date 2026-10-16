import { CameraOptions as CameraOptionsSheet } from './CameraOptions.tsx';
import { useEffect, useRef, useState } from 'react';
import type { LivePoseSource, LiveSessionUpdate, SpeechOutput } from '@flexivision/application';
import { PrepareLiveSessionSource, TrackLiveSquatSession } from '@flexivision/application';
import { CalibrationStreamTiming, LIVE_SETUP_MESSAGES, isVisible } from '@flexivision/core';
import type { CalibrationProfile, CameraPoseObservation, FormObservation, LiveSessionSummary, LiveSetupUpdate, PoseFrame, SessionRecord, SquatSessionRecord, SquatTemplate } from '@flexivision/contracts';
import { BrowserCameraPose, preferredCameraOptions, type CameraOptions } from '../adapters/browserCameraPose.ts';
import { sessionSpeech } from '../adapters/sessionSpeech.ts';
import { trackingSetupGuidance } from '../adapters/trackingSetupGuidance.ts';
import { createBrowserSpeech } from '../adapters/speech.ts';
import { SessionSummaryView } from './SessionSummaryView.tsx';
import { CameraFraming } from './CameraFraming.tsx';
import { CameraSettings } from './CameraSettings.tsx';
import { CameraLensControls } from './CameraLensControls.tsx';
import { VoiceCommandControls, type CreateVoiceCommands } from './VoiceCommandControls.tsx';

interface LiveExercisePanelProps {
  template: SquatTemplate;
  onClose: () => void;
  bodyProfile?: CalibrationProfile | null;
  onSave?: (summary: LiveSessionSummary, reference: SquatSessionRecord['reference'], reason: SessionRecord['endReason']) => Promise<SquatSessionRecord>;
  createSource?: (video: HTMLVideoElement, options: CameraOptions) => LivePoseSource;
  createSpeech?: (onError: () => void) => SpeechOutput;
  createVoiceCommands?: CreateVoiceCommands;
}

const PHASE_NAMES = {
  standing: 'Ayakta (Başlangıç)',
  descent: 'İniş Fazı',
  bottom: 'Dip Fazı',
  ascent: 'Çıkış Fazı',
};

function trackingNotice(reason: string) {
  switch (reason) {
    case 'camera_view': return 'Kameraya yan dön · Referanstaki açıyla aynı yönde dur.';
    case 'stand_first': return 'Önce ayakta rahat dur · Tam tekrarın başlangıcı ölçülsün.';
    case 'processing_slow': return 'Telefon analizi yavaş · Şu an hareket düzeltmesi yapılmıyor.';
    case 'cycle_timeout': return 'Uzun ara verildi · Ayakta durarak yeni tekrara başla.';
    case 'no_person': return 'Vücut görünmüyor. Kameranın karşısına geç ve ayakların dahil kadrajda kal.';
    case 'multiple_people': return 'Vücut net seçilemiyor. Kadrajda yalnız sen kal ve ışığı kontrol et.';
    default: return 'Takip belirsiz · Omuz, kalça, diz ve ayakların kadrajda olsun.';
  }
}

const POSE_CONNECTIONS: readonly (readonly [number, number])[] = [
  [11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],
  [23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32],
];

/** A red segment represents a measured 2D difference from the saved reference, never a clinical verdict. */
export function squatOverlayState(observation: FormObservation | null, side: 'left' | 'right') {
  const tracked = observation?.status === 'correct' || observation?.status === 'incorrect';
  const codes = observation?.status === 'incorrect' ? new Set(observation.errors.map(error => error.code)) : new Set<string>();
  return {
    tracked,
    knee: tracked && (codes.has('knee_deviation') || codes.has('insufficient_depth'))
      ? (side === 'left' ? '25-27' : '26-28') : null,
    hip: tracked && codes.has('chest_forward') ? (side === 'left' ? '11-23' : '12-24') : null,
  };
}

export function SquatPoseOverlay({ frame, width, height, side, observation, fill = false }: {
  frame: PoseFrame | undefined;
  width: number;
  height: number;
  side: 'left' | 'right';
  observation: FormObservation | null;
  fill?: boolean;
}) {
  if (!frame) return null;
  const state = squatOverlayState(observation, side);
  return <svg className="skeleton squat-pose-overlay" preserveAspectRatio={fill ? 'xMidYMid slice' : 'xMidYMid meet'} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    {frame.people.map((person, personIndex) => <g key={personIndex}>
      {POSE_CONNECTIONS.map(([from, to]) => {
        const a = person.landmarks[from], b = person.landmarks[to];
        if (!isVisible(a) || !isVisible(b)) return null;
        const line = `${from}-${to}`;
        const red = personIndex === 0 && (line === state.knee || line === state.hip);
        const color = personIndex === 0 && state.tracked ? '#a9f779' : '#c7d0ca';
        return <line key={line} data-pose-segment={line} data-reference-difference={red ? 'true' : undefined}
          x1={a.x * width} y1={a.y * height} x2={b.x * width} y2={b.y * height}
          stroke={red ? '#ff695d' : color} strokeWidth={red ? Math.max(4, width / 135) : Math.max(2, width / 200)}
          strokeLinecap="round" />;
      })}
      {person.landmarks.map((point, index) => index >= 11 && isVisible(point)
        ? <circle key={index} cx={point.x * width} cy={point.y * height} r={Math.max(3, width / 130)}
          fill={personIndex === 0 && state.tracked ? '#a9f779' : '#c7d0ca'} stroke="#16372d" strokeWidth={1} /> : null)}
    </g>)}
  </svg>;
}

export function LiveExercisePanel({
  template,
  onClose,
  bodyProfile,
  onSave,
  createSource = (video, options) => new BrowserCameraPose(video, undefined, options),
  createSpeech = onError => createBrowserSpeech({ replace: false, onError }),
  createVoiceCommands,
}: LiveExercisePanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fillCamera, setFillCamera] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<TrackLiveSquatSession | null>(null);
  const speechRef = useRef<SpeechOutput | null>(null);
  const correctionSpeechRef = useRef<SpeechOutput | null>(null);
  const setupGuidanceRef = useRef<ReturnType<typeof trackingSetupGuidance> | null>(null);
  const streamTiming = useRef(new CalibrationStreamTiming());
  const setupSourceRef = useRef<PrepareLiveSessionSource | null>(null);
  const setupStage = useRef<LiveSetupUpdate['stage']>('positioning');
  const previousCameraTime = useRef<number | null>(null);
  const [cameraOptions, setCameraOptions] = useState<CameraOptions>(preferredCameraOptions);
  const [setup, setSetup] = useState<LiveSetupUpdate | null>(null);
  const [speechError, setSpeechError] = useState('');
  const [cameraTiming, setCameraTiming] = useState<{ frames: number; processingMs: number | null; intervalMs: number | null }>({ frames: 0, processingMs: null, intervalMs: null });
  const mounted = useRef(true);
  const archive = useRef<{ summary: LiveSessionSummary; reason: SessionRecord['endReason']; saved: boolean; discarded?: boolean; pending?: Promise<boolean> } | null>(null);
  const finalizeRef = useRef<(reason: SessionRecord['endReason']) => Promise<boolean>>(async () => true);
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  const [mirrored, setMirrored] = useState(true);
  const [sound, setSound] = useState(true);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const [currentFrame, setCurrentFrame] = useState<PoseFrame | undefined>(undefined);
  const [overlayObservation, setOverlayObservation] = useState<FormObservation | null>(null);
  const [dimensions, setDimensions] = useState({ width: 640, height: 480 });
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  const [reps, setReps] = useState(0);
  const [phase, setPhase] = useState<'standing' | 'descent' | 'bottom' | 'ascent'>('standing');
  const [progress, setProgress] = useState(0);
  const [liveKnee, setLiveKnee] = useState<number | null>(null);
  const [targetKnee, setTargetKnee] = useState<number | null>(null);
  const [liveHip, setLiveHip] = useState<number | null>(null);
  const [targetHip, setTargetHip] = useState<number | null>(null);
  const [guidanceNotice, setGuidanceNotice] = useState('Kameranın karşısında ayakta dur ve harekete başla.');
  const [hasErrorState, setHasErrorState] = useState(false);
  const [trackingUnknown, setTrackingUnknown] = useState(true);
  const [isFinished, setIsFinished] = useState(false);
  const [summary, setSummary] = useState<LiveSessionSummary | null>(null);
  const [restartRequested, setRestartRequested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'none' | 'saved' | 'failed'>('none');
  const [endReason, setEndReason] = useState<SessionRecord['endReason']>('finished');

  const trackedSideLabel = template.repetition.side === 'left' ? 'Sol taraf' : 'Sağ taraf';
  const trackedKneeJoint = `${template.repetition.side}Knee` as const;
  const trackedHipJoint = `${template.repetition.side}Hip` as const;
  const orientationMismatch = active && !!cameraOptions.portrait && !!videoSize && videoSize.width > videoSize.height;

  function stopSession() {
    const session = sessionRef.current, speech = speechRef.current;
    sessionRef.current = null; speechRef.current = null;
    setupSourceRef.current = null; correctionSpeechRef.current = null; setupGuidanceRef.current = null;
    try { session?.stop(); } catch { if (mounted.current) setError('Kamera kapatılırken teknik bir sorun oluştu. Kamera göstergesi açık kalırsa sayfayı yenile.'); }
    try { speech?.cancel(); } catch { /* The panel must still close and release focus. */ }
    setActive(false);
    setVideoSize(null);
    streamTiming.current.reset();
  }

  function updateVideoSize() {
    const video = videoRef.current;
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      setVideoSize({ width: video.videoWidth, height: video.videoHeight });
    }
  }

  function testVoice() {
    speechRef.current?.cancel(); setSound(true); soundRef.current = true; setSpeechError('');
    let speech: SpeechOutput;
    try { speech = createSpeech(() => setSpeechError('Ses başlatılamadı. Cihazın sesini ve tarayıcı ayarlarını kontrol et.')); }
    catch { setSpeechError('Bu tarayıcıda sesli yönlendirme başlatılamadı. Ekrandaki yazıları takip et.'); return; }
    speechRef.current = speech;
    if (!speech.available) { setSpeechError('Bu tarayıcıda sesli yönlendirme kullanılamıyor.'); return; }
    try { void Promise.resolve(speech.speak('Sesli yönlendirme hazır. Egzersizi kendi hızında yapabilirsin.')).catch(() => setSpeechError('Ses çalınamadı.')); }
    catch { setSpeechError('Ses çalınamadı.'); }
  }

  useEffect(() => {
    mounted.current = true;
    const previousFocus = document.activeElement, previousOverflow = document.body.style.overflow;
    const app = document.getElementById('root'), wasInert = app?.inert ?? false;
    document.body.style.overflow = 'hidden'; if (app) app.inert = true;
    panelRef.current?.focus();
    function handleVisibilityChange() {
      if (document.hidden && sessionRef.current) {
        void finalizeRef.current('interrupted');
      }
    }
    const hide = () => { void finalizeRef.current('interrupted'); };
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { void finalizeRef.current('interrupted').then(ok => { if (ok) onClose(); }); return; }
      if (event.key !== 'Tab') return;
      const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button, input, select, summary') ?? [])
        .filter(el => !el.hasAttribute('disabled') && el.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', hide); document.addEventListener('keydown', keys);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', hide); document.removeEventListener('keydown', keys);
      mounted.current = false;
      void finalizeRef.current('interrupted');
      document.body.style.overflow = previousOverflow; if (app) app.inert = wasInert;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);
  useEffect(() => {
    if (restartRequested && !isFinished) { setRestartRequested(false); void startExercise(); }
  }, [restartRequested, isFinished]);
  useEffect(() => {
    if (active) panelRef.current?.scrollTo({ top: 0 });
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const health = streamTiming.current.check(performance.now());
      if (health === 'fresh') return;
      if (health === 'timed_out') {
        setError('Telefon görüntüyü zamanında işleyemedi. Hafif görüntü seçeneğiyle yeniden dene.');
        void finalizeRef.current('interrupted'); return;
      }
      setTrackingUnknown(true); setCurrentFrame(undefined); setOverlayObservation(null); setProgress(0);
      setLiveKnee(null); setTargetKnee(null); setLiveHip(null); setTargetHip(null);
      setGuidanceNotice('Yeni ölçüm bekleniyor · Telefon görüntüyü zamanında işleyemiyor veya kamera akışı kesildi.');
      if (setupStage.current === 'active') setupGuidanceRef.current?.update('tracking_lost',
        'Yeni ölçüm alınamıyor. Telefonu sabit tut; kamera görüntüsünü kontrol et.', performance.now());
      try { correctionSpeechRef.current?.cancel(); } catch { /* Tracking must survive an audio failure. */ }
      setupSourceRef.current?.invalidate(health === 'processing' ? 'processing_slow' : 'stream_waiting');
    },250);
    return () => clearInterval(timer);
  }, [active]);

  async function startExercise() {
    const video = videoRef.current;
    if (!video) return;

    stopSession(); setCurrentFrame(undefined); setOverlayObservation(null); setReps(0); setProgress(0); setPhase('standing');
    setTrackingUnknown(true);
    setLiveKnee(null); setTargetKnee(null); setLiveHip(null); setTargetHip(null);
    setGuidanceNotice('Kameraya yan dön. Referanstaki görünümle aynı açıdan ayakta başla.'); setHasErrorState(false);

    setError('');
    setIsFinished(false);
    setSummary(null);
    setSetup({ stage: 'positioning', guide: 'stream_waiting', progress: 0, countdown: null });
    setupStage.current = 'positioning'; previousCameraTime.current = null;
    setCameraTiming({ frames: 0, processingMs: null, intervalMs: null }); setSpeechError('');
    archive.current = null; setSaveState('none');
    setActive(true);

    let rawSource: LivePoseSource;
    try { rawSource = createSource(video, cameraOptions); }
    catch (failure) {
      setActive(false);
      setError(failure instanceof Error ? failure.message : 'Kamera başlatılamadı. Yeniden dene.');
      return;
    }
    const voiceFailed = () => { if (mounted.current) setSpeechError('Ses çalınamadı. Cihazın sesini kontrol et; ekrandaki büyük yazıları takip edebilirsin.'); };
    let underlyingSpeech: SpeechOutput;
    let speechSetupFailed = false;
    try { underlyingSpeech = createSpeech(voiceFailed); }
    catch {
      // A speech adapter failure must not prevent a visible camera session.
      speechSetupFailed = true;
      underlyingSpeech = { available: false, speak() {}, cancel() {} };
      setSpeechError('Sesli yönlendirme başlatılamadı. Ekrandaki yazılarla devam edebilirsin.');
    }
    speechRef.current = underlyingSpeech;
    if (!underlyingSpeech.available && !speechSetupFailed) setSpeechError('Sesli yönlendirme bu tarayıcıda kullanılamıyor. Büyük yazıları takip edebilirsin.');
    const channels = sessionSpeech(underlyingSpeech, () => soundRef.current, voiceFailed);
    correctionSpeechRef.current = channels.output;
    const guidance = trackingSetupGuidance(channels, performance.now());
    setupGuidanceRef.current = guidance;
    guidance.announce('Telefonu sabitle. Omuzdan ayaklarına kadar kadrajda kal ve kameraya yan dön. Ayakta rahat dur; geri sayımdan sonra başlayabilirsin.', performance.now());
    function cameraReading(value: CameraPoseObservation) {
      if (value.frame.timestampMs === previousCameraTime.current) return true;
      if (!streamTiming.current.received(value.frame.timestampMs, performance.now())) {
        setError('Güncel kamera ölçümü alınamadı. Kamerayı yeniden aç.');
        void finalizeRef.current('interrupted'); return false;
      }
      const intervalMs = previousCameraTime.current === null ? null : value.frame.timestampMs - previousCameraTime.current;
      previousCameraTime.current = value.frame.timestampMs;
      setCameraTiming(current => ({ frames: current.frames + 1, processingMs: value.processingMs ?? null, intervalMs }));
      setCurrentFrame(value.frame); setDimensions({ width: value.width, height: value.height });
      return true;
    }
    const source = new PrepareLiveSessionSource(rawSource, template.repetition.side, (value, update) => {
      if (setupSourceRef.current !== source) return;
      if (value && !cameraReading(value)) return;
      setupStage.current = update.stage;
      setSetup(update);
      if (!value) channels.output.cancel();
      // The visual countdown is enough; avoid interrupting guidance with three spoken numbers.
      guidance.update(update.stage === 'positioning' ? update.guide : null,
        LIVE_SETUP_MESSAGES[update.guide], performance.now(), update.guide !== 'hold');

    });
    setupSourceRef.current = source;

    const wrappedSpeech = channels.output;

    const session = new TrackLiveSquatSession(source, template, wrappedSpeech, performance.now(), bodyProfile ?? undefined);
    sessionRef.current = session;

    try {
      await session.start(
        (update: LiveSessionUpdate) => {
          if (sessionRef.current !== session) return;
          if (!cameraReading(update.observation)) return;
          const comp = update.comparison;
          guidance.update(comp.observation.status === 'unknown' ? comp.observation.reason : null,
            comp.observation.status === 'unknown' ? trackingNotice(comp.observation.reason) : '', performance.now());
          setOverlayObservation(comp.observation);
          setTrackingUnknown(comp.observation.status === 'unknown');
          setReps(comp.repetitionCount);

          if (comp.match) {
            setPhase(comp.match.phase);
            setProgress(Math.round(comp.match.progress * 100));

            const knee = comp.match.liveAngles[trackedKneeJoint];
            const tKnee = comp.match.targetAngles[trackedKneeJoint];
            const hip = comp.match.liveAngles[trackedHipJoint];
            const tHip = comp.match.targetAngles[trackedHipJoint];

            setLiveKnee(knee !== null ? Math.round(knee) : null);
            setTargetKnee(tKnee !== null ? Math.round(tKnee) : null);
            setLiveHip(hip !== null ? Math.round(hip) : null);
            setTargetHip(tHip !== null ? Math.round(tHip) : null);
          } else { setProgress(0); setLiveKnee(null); setTargetKnee(null); setLiveHip(null); setTargetHip(null); }

          if (update.cue) {
            setGuidanceNotice(update.cue.text);
            setHasErrorState(true);
          } else if (comp.observation.status === 'correct') {
            setGuidanceNotice('İzlenen açılar referans aralığında.');
            setHasErrorState(false);
          } else if (comp.observation.status === 'unknown') {
            setGuidanceNotice(trackingNotice(comp.observation.reason));
            setHasErrorState(false);
          } else if (comp.observation.status === 'incorrect' && comp.observation.errors.length > 0) {
            setGuidanceNotice(comp.observation.errors[0]!.message);
            setHasErrorState(true);
          }
        },
        (err: Error) => {
          if (sessionRef.current !== session) return;
          setError(err.message);
          void finalizeRef.current('interrupted');
        }, timestampMs => { if (sessionRef.current === session) streamTiming.current.captureStarted(timestampMs); }
      );
    } catch (err) {
      if (sessionRef.current === session) {
        setError(err instanceof Error ? err.message : 'Kamera başlatılamadı.');
        void finalizeRef.current('interrupted');
      }
    }
  }

  async function finishSession(reason: SessionRecord['endReason'] = 'finished'): Promise<boolean> {
    if (!archive.current) {
      const snapshot = sessionRef.current?.getSummary(performance.now());
      stopSession();
      if (!snapshot || snapshot.sampledFrames === 0) return true;
      archive.current = { summary: snapshot, reason, saved: false };
      if (mounted.current) { setSummary(snapshot); setEndReason(reason); setIsFinished(true); }
    }
    const record = archive.current;
    if (record.saved || record.discarded || !onSave) return true;
    if (record.pending) return record.pending;
    if (mounted.current) { setSaving(true); setSaveState('none'); }
    record.pending = onSave(record.summary, { repetitionId: template.repetition.id, side: template.repetition.side }, record.reason)
      .then(() => { record.saved = true; if (mounted.current) setSaveState('saved'); return true; })
      .catch(() => { if (mounted.current) setSaveState('failed'); return false; })
      .finally(() => { delete record.pending; if (mounted.current) setSaving(false); });
    return record.pending;
  }
  finalizeRef.current = finishSession;

  function closePanel() { void finishSession('interrupted').then(ok => { if (ok) onClose(); }); }

  function toggleSound() {
    const next = !soundRef.current; soundRef.current = next; setSound(next);
    if (!next) speechRef.current?.cancel();
  }

  return (
    <div ref={panelRef} tabIndex={-1} className={'live-exercise-dialog visual-live' + (fillCamera ? ' fill-camera' : '') + (active ? ' camera-running' : '') + (active && setup?.stage === 'active' ? ' session-tracking' : '') + (orientationMismatch ? ' orientation-mismatch' : '') + (active && error ? ' has-live-message' : '')} role="dialog" aria-modal="true" aria-labelledby="live-title">
      <div className="live-header">
        <div>
          <p className="eyebrow">HAREKET ALANIN</p>
          <h2 id="live-title">Squat zamanı</h2>
          <span className="live-side-tag">{bodyProfile ? '✓ Vücut profilin bağlı' : 'Profilsiz deneme'} · {trackedSideLabel}</span>
        </div>
        <div className="scan-toolbar">
          <button
            className="secondary-button"
            onClick={toggleSound}
            aria-pressed={sound}
            title={sound ? 'Sesi Kapat' : 'Sesi Aç'}
          >
            {sound ? 'Ses: Açık' : 'Ses: Kapalı'}
          </button>
          <button
            className="secondary-button"
            disabled={saving}
            onClick={closePanel}
          >
            Kapat
          </button>
        </div>
      </div>

      {isFinished ? (
        <div className="live-summary-card">
          <div className="summary-badge">{endReason === 'finished' ? 'Oturum bitti' : 'Oturum kesildi'}</div>
          <h3>Oturum özeti</h3>
          {endReason === 'interrupted' && <p>İzleme durduğu ana kadar alınan ölçümler gösteriliyor.</p>}
          {error && <p className="message error" role="alert">{error}</p>}
          {summary && <SessionSummaryView summary={summary} />}
          {onSave && <p role="status">{saving ? 'Özet cihazına kaydediliyor…' : saveState === 'saved' ? 'Özet cihazına kaydedildi. Oturum geçmişinden yeniden açabilirsin.' : saveState === 'failed' ? 'Özet kaydedilemedi. Bu ekranı kapatmadan tekrar dene.' : ''}</p>}
          {saveState === 'failed' && <div className="template-actions">
            <button className="secondary-button" onClick={() => { void finishSession(endReason); }}>Kaydı tekrar dene</button>
            <button className="text-button" onClick={() => { if (archive.current) archive.current.discarded = true; onClose(); }}>Kaydetmeden kapat</button>
          </div>}

          <div className="template-actions">
            <button className="primary-button" disabled={saving || saveState === 'failed'} onClick={() => { setIsFinished(false); setRestartRequested(true); }}>
              Yeniden Başla
            </button>
            <button className="secondary-button" disabled={saving} onClick={closePanel}>
              Ana Ekrana Dön
            </button>
          </div>
        </div>
      ) : (
        <>
          {active && setup && setup.stage !== 'active' && <section className="live-setup-guidance" aria-label="Kamera hazırlığı">
            <p className="eyebrow">{setup.stage === 'countdown' ? 'OTOMATİK BAŞLANGIÇ' : 'KADRAJ HAZIRLIĞI'}</p>
            <h3>{orientationMismatch ? 'Telefonu dik tut veya Kadraj bölümünden Dikey çekimi seç.' : LIVE_SETUP_MESSAGES[setup.guide]}</h3>
            {setup.countdown !== null ? <strong className="live-countdown" aria-label={`${setup.countdown} saniye kaldı`}>{setup.countdown}</strong>
              : (setup.guide === 'processing_slow' || setup.guide === 'stream_slow') && <p>{cameraOptions.maxDimension === 480
                ? 'Hafif görüntü seçili. Diğer uygulamaları kapatıp yeniden dene. Bu hızda canlı oturum başlayamaz.'
                : 'Durdurup Hafif görüntü seçeneğini dene. Bu hızda canlı oturum başlayamaz.'}</p>}
            <progress value={setup.progress} max={1} aria-label="Kadraj hazırlığı ilerlemesi" />
          </section>}
          {!active && <p className="pace-note">Kendi hızında çalış. Referansla aynı saniyede aynı pozu vermen gerekmez.</p>}
          {!active && <button className="primary-button camera-start-button" onClick={() => void startExercise()}>Kamerayı Aç ve Başla <span aria-hidden="true">▶</span></button>}
          {!active && <details className="live-setup-options"><summary>Kamera ve ses seçenekleri</summary>
            <CameraSettings value={cameraOptions} disabled={false} onChange={value => { setCameraOptions(value); setMirrored(value.facingMode === 'user'); }} />
            <button className="secondary-button voice-test-button" onClick={testVoice}>Yönlendirme sesini dene</button>
          </details>}
          
          <div className={'live-views' + (active && setup?.stage !== 'active' ? ' preparing' : '')}>
            <div className="live-camera-wrap">
            <div className="live-camera-stage">
              <div className={`camera-stage ${mirrored ? 'mirrored' : ''}${active && videoSize ? ' natural-preview' : ''}`}
                style={videoSize ? { aspectRatio: `${videoSize.width} / ${videoSize.height}` } : undefined}>
                <video ref={videoRef} playsInline muted autoPlay aria-label="Canlı egzersiz kamerası" onLoadedMetadata={updateVideoSize} />
                <SquatPoseOverlay fill={fillCamera} frame={currentFrame} width={dimensions.width} height={dimensions.height}
                  side={template.repetition.side} observation={setup?.stage === 'active' ? overlayObservation : null} />
                {active && setup?.stage === 'active' && <div className="live-visual-legend" aria-label="İskelet renklerinin anlamı">
                  {setup?.stage === 'active' && !trackingUnknown ? <>
                    <span><i className="live-visual-swatch tracked" aria-hidden="true" />İzlenen eklemler</span>
                    <span><i className="live-visual-swatch difference" aria-hidden="true" />Referans açı farkı</span>
                  </> : <span><i className="live-visual-swatch uncertain" aria-hidden="true" />Karşılaştırma bekleniyor</span>}
                </div>}
                {active && setup?.stage === 'active' && !trackingUnknown &&
                  liveKnee !== null && targetKnee !== null && liveHip !== null && targetHip !== null &&
                  <div className="live-reference-readout" aria-label="Canlı ölçüm ve referans açıları">
                    <span>Diz <strong>{liveKnee}°</strong><small>ref. {targetKnee}°</small></span>
                    <span>Kalça <strong>{liveHip}°</strong><small>ref. {targetHip}°</small></span>
                  </div>}
                {!active && !error && (
                  <div className="camera-placeholder">
                    <p>Kamera kapalı. Başlamak için butona bas.</p>
                  </div>
                )}
              </div>
              <div className="camera-underbar"><label className="mirror-option">
                <input type="checkbox" checked={mirrored} onChange={e => setMirrored(e.target.checked)} />
                Ayna
              </label><span>{active && setup?.stage === 'active' ? 'Canlı takip' : 'Başın ve ayakların kadrajda olsun'}</span></div>
            </div>
            </div>

            {(!active || setup?.stage === 'active') && <div className="live-hud">
              <div className="rep-counter-card">
                <span className="hud-label">TEKRAR</span>
                <strong className="rep-number">{reps}</strong>
              </div>

              <div className="phase-card">
                <span className="hud-label">ANLIK FAZ</span>
                <strong className="phase-name">{PHASE_NAMES[phase]}</strong>
                <div className="phase-progress-bar">
                  <div className="phase-progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <small className="phase-pct">Döngü ilerlemesi: %{progress}</small>
              </div>

              <div className={`live-guidance-box ${trackingUnknown ? 'unknown' : hasErrorState ? 'warning' : 'ok'}`}>
                <span className="guidance-indicator" aria-hidden="true">{trackingUnknown ? '?' : hasErrorState ? '!' : '✓'}</span>
                <p><small className="mobile-phase">{PHASE_NAMES[phase]} · {reps} tekrar</small>{guidanceNotice}</p>
              </div>

            </div>}
          </div>

          {error && <p className="message error" role="alert">{error}</p>}
          {!active && speechError && <p className="message" role="status">{speechError}</p>}

          {active && <CameraOptionsSheet notice={[speechError, orientationMismatch ? 'Kamera yatay görüntü gönderiyor. Tüm kadraj seçeneği kırpmayı önler. Dikey çekim veya başka lens için oturumu bitirip kamera seçeneklerini aç.' : ''].filter(Boolean).join(' ')}>
      <label className="mirror-option"><input type="checkbox" checked={mirrored} onChange={event => setMirrored(event.target.checked)} /> Ayna</label>
          <CameraFraming fill={fillCamera} onChange={setFillCamera} /><CameraLensControls video={videoRef.current} active={active} disabled={setup?.stage === 'active' || setup?.stage === 'countdown'} />
          <VoiceCommandControls sessionActive={active} createCommands={createVoiceCommands} onCommand={command => {
            if (command === 'finish') { if (active) void finishSession(); }
            else if (command === 'mute' || command === 'unmute') {
              const next = command === 'unmute'; soundRef.current = next; setSound(next);
              if (!next) speechRef.current?.cancel();
            }
          }} />
          <details className="angles-card"><summary>Açı karşılaştırması</summary>
            <div className="angle-comparison-row"><span>Diz Açısı:</span><strong>{liveKnee !== null ? `${liveKnee}°` : '—'}</strong>
              <small>(Hedef: {targetKnee !== null ? `${targetKnee}°` : '—'})</small></div>
            <div className="angle-comparison-row"><span>Kalça Açısı:</span><strong>{liveHip !== null ? `${liveHip}°` : '—'}</strong>
              <small>(Hedef: {targetHip !== null ? `${targetHip}°` : '—'})</small></div>
          </details>

          {cameraTiming.frames > 0 && <details className="camera-timing"><summary>Kamera durumu</summary>
            <p>Alınan ölçüm: {cameraTiming.frames} · İşleme: {cameraTiming.processingMs === null ? '—' : `${Math.round(cameraTiming.processingMs)} ms`}
              {' · '}Ölçüm aralığı: {cameraTiming.intervalMs === null ? '—' : `${Math.round(cameraTiming.intervalMs)} ms`}</p>
            <p>0,5 saniyeden yavaş ölçümlerde hareket düzeltmesi yapılmaz. Yavaşsa durdurup Hafif seçeneğiyle yeniden açabilirsin.</p>
          </details>}

          <details className="session-info"><summary>Profilim ve referans nasıl kullanılıyor?</summary>
            <p>{bodyProfile ? 'Kayıtlı vücut ölçülerin canlı konumları ölçeklemek için kullanılıyor. Referansın diz ve kalça açıları hareketinin aynı fazıyla karşılaştırılıyor; yeniden tarama gerekmiyor.' : 'Profil olmadan açı takibi denenebilir. Vücudum bölümünden bir kez tarama yapabilirsin.'}</p>
            <p>Bu, 2B açı karşılaştırmasıdır; 3B avatar uyarlaması veya kişisel güvenli hareket sınırı üretmez. Takip belirsizse düzeltme yapılmaz.</p>
          </details></CameraOptionsSheet>}
          {active && <div className="live-bottom-bar">
              <button className="secondary-button stop-exercise-btn" onClick={() => { void finishSession(); }}>
                {setup?.stage === 'active' ? 'Oturumu Bitir ve Özeti Gör' : 'Hazırlığı Durdur'}
              </button>
          </div>}
        </>
      )}
    </div>
  );
}

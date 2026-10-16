import { GenericSessionSummaryView } from './GenericSessionSummaryView.tsx';
import { genericReportText } from '../genericSessionReport.ts';
import { saveAttemptReport, ATTEMPT_REPORT_EVENT } from '../adapters/attemptReport.ts';
declare const __APP_BUILD__: string;
import { CameraPlacementGuide, CameraSetupProgress, placementMessage } from './CameraPlacementGuide.tsx';
import { CameraOptions as CameraOptionsSheet } from './CameraOptions.tsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LivePoseSource, SpeechOutput } from '@flexivision/application';
import { TrackLiveGenericSession, type GenericSessionSummary } from '@flexivision/application';
import { CalibrationStreamTiming, DEFAULT_REPETITION_GOAL, genericCoachingPlan, genericCoachReminder, genericCoachStatus, genericVoiceAnswer, isWholeBodyVisible,
  repetitionGoalProgress, repetitionAnnouncement, type GenericLiveResult, type VoiceCommand } from '@flexivision/core';
import type { CalibrationProfile, GenericMotionTemplate, GenericSessionRecord, PoseFrame, RepetitionGoal, SessionEndReason } from '@flexivision/contracts';
import { BrowserCameraPose, CAMERA_STARTUP_MESSAGES, cameraCleanupMessage, preferredCameraOptions, type CameraOptions, type CameraStartupStage } from '../adapters/browserCameraPose.ts';
import { speechWithInputPause } from '../adapters/speechFocus.ts';
import { sessionSpeech } from '../adapters/sessionSpeech.ts';
import { keepScreenAwake, type ScreenAwakeState } from '../adapters/screenAwake.ts';
import { trackingSetupGuidance } from '../adapters/trackingSetupGuidance.ts';
import { genericProgressGuidance } from '../genericProgressGuidance.ts';
import { GenericMovementGuide } from './GenericMovementGuide.tsx';
import { createBrowserSpeech, type BrowserSpeechFailure } from '../adapters/speech.ts';
import { CameraFraming } from './CameraFraming.tsx';
import { CameraSettings } from './CameraSettings.tsx';
import { CameraLensControls } from './CameraLensControls.tsx';
import { Skeleton } from './MotionResults.tsx';
import { VoiceCommandControls, type CreateVoiceCommands } from './VoiceCommandControls.tsx';
import type { BrowserVoiceCommands } from '../adapters/voiceCommands.ts';

interface Props {
  template: GenericMotionTemplate;
  bodyProfile?: CalibrationProfile | null;
  onClose: () => void;
  onGoBody?: () => void;
  onSave?: (summary: GenericSessionSummary, reference: GenericSessionRecord['reference'], reason: SessionEndReason) => Promise<GenericSessionRecord>;
  reportStorageKey?: string;
  createVoiceCommands?: CreateVoiceCommands;
  createSource?: (video: HTMLVideoElement, options: CameraOptions, onStartup: (stage: CameraStartupStage) => void) => LivePoseSource;
  createSpeech?: (onError: (reason?: BrowserSpeechFailure) => void) => SpeechOutput;
}

const edges = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
/** Both measured points and the matched reference are projected into this camera frame by the comparer. */
export function LiveReferenceOverlay({ overlay, width, height, fill = false }: {
  overlay: NonNullable<GenericLiveResult['overlay']>; width: number; height: number; fill?: boolean;
}) {
  const joints = new Map(overlay.joints.map(joint => [joint.index, joint]));
  const x = (value: number) => value * width, y = (value: number) => value * height;
  return <svg className="generic-reference-overlay" preserveAspectRatio={fill ? 'xMidYMid slice' : 'xMidYMid meet'} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    <g className="generic-reference-ghost" fill="none" stroke="#e8fff0" strokeLinecap="round" strokeDasharray="8 7"
      strokeWidth={Math.max(2, width / 260)}>
      {edges.map(([from, to], index) => {
        const a = joints.get(from!), b = joints.get(to!);
        return a && b ? <line key={index} x1={x(a.reference.x)} y1={y(a.reference.y)}
          x2={x(b.reference.x)} y2={y(b.reference.y)} /> : null;
      })}
    </g>
    <g fill="#e8fff0" stroke="#133d30" strokeWidth={Math.max(1, width / 500)}>
      {overlay.joints.map(joint => <circle key={joint.index} cx={x(joint.reference.x)} cy={y(joint.reference.y)}
        r={Math.max(3, width / 110)} />)}
    </g>
    <g className="generic-measured-bones" strokeLinecap="round" strokeWidth={Math.max(4, width / 155)}>
      {edges.map(([from, to]) => {
        const a = joints.get(from!), b = joints.get(to!);
        if (!a || !b) return null;
        const different = a.deviating || b.deviating;
        return <line key={`${from}-${to}`} data-pose-segment={`${from}-${to}`} data-reference-difference={different}
          x1={x(a.observed.x)} y1={y(a.observed.y)} x2={x(b.observed.x)} y2={y(b.observed.y)}
          stroke={different ? '#ff625b' : '#a9f779'} />;
      })}
    </g>
    <g className="generic-measured-deviations" fill="none" stroke="#ff625b" strokeLinecap="round"
      strokeWidth={Math.max(3, width / 210)}>
      {overlay.joints.filter(joint => joint.deviating).map(joint => <g key={joint.index}>
        <line x1={x(joint.reference.x)} y1={y(joint.reference.y)}
          x2={x(joint.observed.x)} y2={y(joint.observed.y)} />
        <circle cx={x(joint.observed.x)} cy={y(joint.observed.y)} r={Math.max(7, width / 65)} />
      </g>)}
    </g>
  </svg>;
}

function messageFor(reason: string): string {
  switch (reason) {
    case 'find_start': return 'Önce çizimdeki başlangıç duruşuna geç. Referanstaki kamera açısını kullan.';
    case 'hold_start': return 'Başlangıç duruşunu kısa bir an koru.';
    case 'camera_view': return 'Kameranın açısı referansla uyuşmuyor. Telefonu sabitleyip aynı yönden dene.';
    case 'multiple_people': return 'Tek bir vücut net seçilemiyor. Telefonu sabitle; gövden ve hareket eden uzuvların görünsün.';
    case 'no_person': case 'body_not_visible': return 'Omuz ve kalçaların kadrajda olsun. Görüntüde eksik kalan yöne kamerayı çevir.';
    case 'tracking_lost': return 'Başın, iki kolun ve iki bacağın kadrajda görünmeli. Tüm vücudun görünene kadar ilk adıma dön.';
    case 'processing_slow': return 'Telefon görüntüyü yavaş işliyor. Durdurup Hafif görüntü seçeneğini dene.';
    case 'cycle_timeout': return 'Hareket başladıktan sonra 30 saniyede tamamlanamadı. Başlangıç duruşuna dönüp yeniden dene.';
    case 'cycle_too_short': return 'Hareket döngüsü ölçüm için çok kısa kaldı; tekrar sayılmadı. Başlangıçta kısa durup hareketi daha yavaş dene.';
    case 'motion_too_fast': return 'İki ölçüm arasında hareket izlenemeyecek kadar değişti. Kadrajı sabitle; gerekirse daha yavaş dene. Bu tekrar sayılmadı.';
    default: return 'Takip belirsiz. Hareketin görünür olduğundan emin ol.';
  }
}

/** The reference is a repeatable 2D joint path, not an exercise name or a safety diagnosis. */
export function GenericLiveExercisePanel({ template, bodyProfile, onClose, onGoBody, onSave, reportStorageKey, createVoiceCommands,
  createSource = (video, options, onStartup) => new BrowserCameraPose(video, undefined, options, onStartup),
  createSpeech = onError => createBrowserSpeech({ replace:false, onError }), }: Props) {
  const voiceCommandsRef = useRef<BrowserVoiceCommands>(null);
  const voiceOptIn = useRef(false);
  const answerSpeech = useRef<ReturnType<typeof sessionSpeech> | null>(null);
  const lastMeasurement = useRef<{ result: GenericLiveResult; receivedAt: number; scope: string } | null>(null);
  const answerScope = useRef<string | null>(null);
  const [voiceReply, setVoiceReply] = useState('');
  const [coachStatus, setCoachStatus] = useState(() => genericCoachStatus(null, false));
  const [cameraStartup, setCameraStartup] = useState<CameraStartupStage>('permission');
  const startupStage = useRef<CameraStartupStage>('permission');
  const startupHistory = useRef<{stage: CameraStartupStage; elapsedMs: number}[]>([]);
  const [keepAwake, setKeepAwake] = useState(true), [awakeState, setAwakeState] = useState<ScreenAwakeState>('off');
  const [repetitionGoal, setRepetitionGoal] = useState<RepetitionGoal>({ ...DEFAULT_REPETITION_GOAL });
  const sessionGoal = useRef<RepetitionGoal>({ ...DEFAULT_REPETITION_GOAL });
  const [demoRequest, setDemoRequest] = useState(0), [showDemo, setShowDemo] = useState(false);
  const coaching = useMemo(() => genericCoachingPlan(template), [template]);
  const clearCoachRef = useRef<(() => void) | null>(null);
  const [fillCamera, setFillCamera] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null), videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<TrackLiveGenericSession | null>(null), speechRef = useRef<SpeechOutput | null>(null);
  const correctionSpeechRef = useRef<SpeechOutput | null>(null);
  const guidanceRef = useRef<ReturnType<typeof trackingSetupGuidance> | null>(null);
  const trackingResetGeneration = useRef(0);
  const speechGeneration = useRef(0);
  const voiceDiagnostics = useRef({setupStarted:0,recoveryStarted:0,referenceStarted:0,startStarted:0,nearStarted:0,returnStarted:0,completedStarted:0,failures:0,lastFailureCode:''});
  const [restartRequested, setRestartRequested] = useState(false);
  const timing = useRef(new CalibrationStreamTiming()), alive = useRef(true), soundRef = useRef(true);
  const archive = useRef<{ summary: GenericSessionSummary; reason: SessionEndReason; saved: boolean;
    discarded?: boolean; pending?: Promise<boolean> } | null>(null);
  const finalizeRef = useRef<(reason: SessionEndReason) => Promise<boolean>>(async () => true);
  const [options, setOptions] = useState<CameraOptions>(preferredCameraOptions);
  const [mirrored, setMirrored] = useState(true), [sound, setSound] = useState(true);
  const [active, setActive] = useState(false), [finished, setFinished] = useState(false);
  const [frame, setFrame] = useState<PoseFrame>(), [size, setSize] = useState({ width:640, height:480 });
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  const [guideViewport, setGuideViewport] = useState<{ width: number; height: number; topInset: number; bottomInset: number }>();
  const [reps, setReps] = useState(0), [phase, setPhase] = useState('Başlangıcı bul');
  const goalProgress = repetitionGoalProgress(repetitionGoal, reps);
  const [referenceOverlay, setReferenceOverlay] = useState<GenericLiveResult['overlay']>(null);
  const deviatingJoints = useMemo(() => {
    if (!referenceOverlay?.joints) return undefined;
    const set = new Set<number>();
    for (const j of referenceOverlay.joints) {
      if (j.deviating) set.add(j.index);
    }
    return set.size > 0 ? set : undefined;
  }, [referenceOverlay]);
  const [exerciseStarted, setExerciseStarted] = useState(false);
  const [wholeBodyReady, setWholeBodyReady] = useState(false);
  const waitingForStart = phase === 'Başlangıcı bul';
  const referenceGuide = wholeBodyReady && waitingForStart;
  const [progress, setProgress] = useState(0), [accuracy, setAccuracy] = useState<number | null>(null), [notice, setNotice] = useState(() => placementMessage(undefined, template.trackedIndices, 'no_person'));
  const [state, setState] = useState<'unknown'|'correct'|'incorrect'>('unknown');
  const [error, setErrorState] = useState(''), [speechError, setSpeechErrorState] = useState('');
  const technicalErrorRef=useRef(''), lastMessageRef=useRef(''), speechErrorRef=useRef('');
  const reportSettings=useRef({options,fillCamera,mirrored});
  reportSettings.current={options,fillCamera,mirrored};
  const lastVideoSize=useRef({width:0,height:0});
  const attemptStarted=useRef<number|null>(null), reportRef=useRef<string|null>(null);
  const [attemptReport,setAttemptReport]=useState<string|null>(null),[reportSaved,setReportSaved]=useState(false);
  function setError(message:string){technicalErrorRef.current=message;setErrorState(message);}
  function setSpeechError(message:string){speechErrorRef.current=message;setSpeechErrorState(message);} 
  const [summary, setSummary] = useState<GenericSessionSummary | null>(null);
  const [saving, setSaving] = useState(false), [saveState, setSaveState] = useState<'none'|'saved'|'failed'>('none');
  const [endReason, setEndReason] = useState<SessionEndReason>('finished');
  const orientationMismatch = active && !!options.portrait && !!videoSize && videoSize.width > videoSize.height;
  useEffect(() => {
    // Asking for the list starts the browser's lazy voice discovery before the
    // first Start tap. It does not speak or request microphone access.
    try { window.speechSynthesis?.getVoices(); } catch { /* Camera remains available. */ }
  }, []);
  useEffect(() => {
    if (!active || !keepAwake) { setAwakeState('off'); return; }
    return keepScreenAwake(setAwakeState);
  }, [active, keepAwake]);
  useEffect(() => {
    const stage = stageRef.current, panel = panelRef.current;
    if (!active || !stage || !panel) return;
    const hud = panel.querySelector('.live-hud');
    const lower = panel.querySelector('.camera-recovery') ?? panel.querySelector('.generic-voice-status') ?? panel.querySelector('.live-bottom-bar');
    const measure = () => {
      const { width, height, top, bottom } = stage.getBoundingClientRect();
      if (width > 0 && height > 0) setGuideViewport({ width, height,
        topInset: Math.max(0, (hud?.getBoundingClientRect().bottom ?? top) - top + 12),
        bottomInset: Math.max(0, bottom - (lower?.getBoundingClientRect().top ?? bottom) + 12),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    [stage, hud, lower].forEach(element => { if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, [active, orientationMismatch, fillCamera]);
  const first = template.samples[0]!.landmarks;
  const profileApplied = !!bodyProfile && [[23,25,27],[24,26,28]].some(([hip,knee,ankle]) => {
    const a=first[hip!],b=first[knee!],c=first[ankle!];
    return !!(a&&b&&c&&Math.hypot(a.x-b.x,a.y-b.y)+Math.hypot(b.x-c.x,b.y-c.y)>.2);
  });

  useEffect(() => {
    if (!voiceReply) return;
    const timer = setTimeout(() => setVoiceReply(''), 5500);
    return () => clearTimeout(timer);
  }, [voiceReply]);
  function onVoiceCommand(command: VoiceCommand) {
    if (!sessionRef.current) return;
    if (command === 'finish') { void finish(); return; }
    if (command === 'mute' || command === 'unmute') {
      const enabled = command === 'unmute'; soundRef.current = enabled; setSound(enabled);
      if (!enabled) speechRef.current?.cancel();
      return;
    }
    if (command === 'hide_movement') {
      setShowDemo(false); setDemoRequest(0);
      const text = 'Rehberi kapattım.';
      setVoiceReply(text); answerSpeech.current?.answer(text);
      return;
    }
    const snapshot = lastMeasurement.current;
    const text = genericVoiceAnswer(command, { plan: coaching, result: snapshot?.result ?? null, goal: sessionGoal.current,
      fresh: !!snapshot && performance.now() - snapshot.receivedAt <= 1500, guidance: lastMessageRef.current });
    answerScope.current = ['show_movement', 'hide_movement', 'progress', 'help'].includes(command) ? null : snapshot?.scope ?? null;
    if (command === 'show_movement') { setShowDemo(true); setDemoRequest(value => value + 1); }
    setVoiceReply(text);
    answerSpeech.current?.answer(text);
  }
  function release() {
    voiceCommandsRef.current?.stop();
    answerSpeech.current = null; lastMeasurement.current = null; answerScope.current = null;
    if (alive.current) { setVoiceReply(''); setShowDemo(false); setDemoRequest(0); }
    const session = sessionRef.current, speech = speechRef.current;
    sessionRef.current = null; speechRef.current = null; correctionSpeechRef.current = null;
    guidanceRef.current = null; clearCoachRef.current = null; speechGeneration.current++;
    try { session?.stop(); } catch (failure) { if (alive.current) setError(cameraCleanupMessage(failure)); }
    try { speech?.cancel(); } catch { /* Camera cleanup must still finish. */ }
    timing.current.reset();
    if (alive.current) { setActive(false); setVideoSize(null); }
  }
  function updateVideoSize() {
    const video = videoRef.current;
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      lastVideoSize.current={width:video.videoWidth,height:video.videoHeight};
      setVideoSize(lastVideoSize.current);
    }
  }
  async function finish(reason: SessionEndReason = 'finished', completionText?: string): Promise<boolean> {
    if (!archive.current) {
      const session = sessionRef.current;
      // A voice command before camera startup must not fabricate an empty session.
      if (!session && (attemptStarted.current === null || reportRef.current)) return true;
      const snapshot: GenericSessionSummary = { ...(session?.getSummary(performance.now()) ?? {durationMs:0,repetitionCount:0,sampledFrames:0,trackedFrames:0,unmeasuredFrames:0,cueCandidatesCount:0,spokenCuesCount:0,bodyProfileUsed:false}),
        repetitionGoal: { ...sessionGoal.current } };
      const video=videoRef.current;
      const cameraSize=video?.videoWidth ? {width:video.videoWidth,height:video.videoHeight} : lastVideoSize.current;
      const settings=reportSettings.current;
      const finalVoice = speechRef.current;
      release();
      // Close camera/microphone immediately, then let the final count finish on the summary screen.
      if (completionText && finalVoice && alive.current && soundRef.current && finalVoice.available) {
        speechRef.current = finalVoice;
        const token = speechGeneration.current;
        const failed = () => { if (alive.current && speechGeneration.current === token) setSpeechError('Son durum sesi çalınamadı. Sonucu ekrandan görebilirsin.'); };
        try { void Promise.resolve(finalVoice.speak(completionText)).catch(failed); } catch { failed(); }
      }
      const ua=navigator.userAgent;
      const report=genericReportText(snapshot,{
        createdAt:new Date().toISOString(),endReason:reason,attemptMs:Math.max(0,performance.now()-(attemptStarted.current??performance.now())),
        build:typeof __APP_BUILD__==='undefined'?'development':__APP_BUILD__,
        camera:{...cameraSize,facing:settings.options.facingMode,portraitRequested:!!settings.options.portrait,fill:settings.fillCamera,mirrored:settings.mirrored,analysisMaxDimension:settings.options.maxDimension},
        viewport:{width:window.innerWidth,height:window.innerHeight},
        browser:`${/Android/.test(ua)?'Android':/iPhone|iPad/.test(ua)?'iOS':'Diğer'} · ${/Chrome/.test(ua)?'Chrome':/Firefox/.test(ua)?'Firefox':/Safari/.test(ua)?'Safari':'Diğer'}`,
        lastMessage:lastMessageRef.current,technicalError:technicalErrorRef.current.slice(0,500),speechError:speechErrorRef.current.slice(0,500),
        voice:{...voiceDiagnostics.current}, startup: [...startupHistory.current],
      },template);
      reportRef.current=report;
      const stored=saveAttemptReport(report,undefined,reportStorageKey);
      window.dispatchEvent(new Event(ATTEMPT_REPORT_EVENT));
      if(alive.current){setAttemptReport(report);setReportSaved(stored);}
      if (alive.current) { setSummary(snapshot); setEndReason(reason); setFinished(true); }
      if (snapshot.trackedFrames === 0) return true;
      archive.current = { summary: snapshot, reason, saved: !onSave };
    }
    const record = archive.current;
    if (record.saved || record.discarded || !onSave) return true;
    if (record.pending) return record.pending;
    if (alive.current) { setSaving(true); setSaveState('none'); }
    record.pending = onSave(record.summary, { repetitionId: template.repetition.id, policyVersion: 'generic-cycles-v1' }, record.reason)
      .then(() => { record.saved = true; if (alive.current) setSaveState('saved'); return true; })
      .catch(() => { if (alive.current) setSaveState('failed'); return false; })
      .finally(() => { delete record.pending; if (alive.current) setSaving(false); });
    return record.pending;
  }
  finalizeRef.current = finish;
  useEffect(() => {
    alive.current = true;
    const prior = document.activeElement, overflow = document.body.style.overflow;
    const root = document.getElementById('root'), wasInert = root?.inert ?? false;
    document.body.style.overflow = 'hidden'; if (root) root.inert = true;
    panelRef.current?.focus();
    const hide = () => { if (document.hidden) void finalizeRef.current('interrupted'); };
    const pagehide = () => { void finalizeRef.current('interrupted'); };
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { void finalizeRef.current('interrupted').then(ok => { if (ok) onClose(); }); return; }
      if (event.key !== 'Tab') return;
      const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button,input,select,summary') ?? [])
        .filter(element => !element.hasAttribute('disabled') && element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', pagehide);
    document.addEventListener('keydown', keys);
    return () => {
      alive.current = false; void finalizeRef.current('interrupted'); release();
      document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', pagehide);
      document.removeEventListener('keydown', keys);
      document.body.style.overflow = overflow; if (root) root.inert = wasInert;
      if (prior instanceof HTMLElement) prior.focus();
    };
  }, []);
  useEffect(() => {
    if (restartRequested && !finished) { setRestartRequested(false); void start(); }
  }, [restartRequested, finished]);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (startupStage.current !== 'tracking') {
        guidanceRef.current?.update('startup_preparing', 'Kamera hazırlanıyor. Hazır olduğunda haber vereceğim.', performance.now(), false);
        return;
      }
      const health = timing.current.check(performance.now());
      if (health === 'fresh') return;
      if (health === 'timed_out') { setError('Kamera akışı kesildi. Hafif görüntüyle yeniden dene.'); void finish('interrupted'); return; }
      trackingResetGeneration.current++; clearCoachRef.current?.(); answerSpeech.current?.clearAnswer(); setVoiceReply('');
      setCoachStatus(genericCoachStatus(null, false));
      setState('unknown'); setPhase('Başlangıcı bul'); setProgress(0); setWholeBodyReady(false); setFrame(undefined); setReferenceOverlay(null);
      const message='Yeni ölçüm bekleniyor. Bu sırada hareket düzeltmesi yapılmaz.';
      lastMessageRef.current=message;setNotice(message);
      try { correctionSpeechRef.current?.cancel(); } catch { /* Tracking must survive an audio failure. */ }
      guidanceRef.current?.update('camera_pending',message,performance.now());
    }, 250);
    return () => clearInterval(id);
  }, [active]);

  async function start(withVoice = voiceOptIn.current) {
    const video = videoRef.current; if (!video) return;
    if (archive.current && !archive.current.saved && !archive.current.discarded) return;
    archive.current = null; setSaveState('none');
    attemptStarted.current=performance.now();lastVideoSize.current={width:0,height:0};reportRef.current=null;lastMessageRef.current='Kamera başlatılıyor.';setAttemptReport(null);setReportSaved(false);
    release(); voiceOptIn.current = withVoice; sessionGoal.current = { ...repetitionGoal };
    if (withVoice) { soundRef.current = true; setSound(true); }
    setFinished(false); setSummary(null); setError(''); setSpeechError('');
    voiceDiagnostics.current={setupStarted:0,recoveryStarted:0,referenceStarted:0,startStarted:0,nearStarted:0,returnStarted:0,completedStarted:0,failures:0,lastFailureCode:''};
    const speechToken=speechGeneration.current;
    const voiceFailed=(code:BrowserSpeechFailure|'adapter_failure'|'unavailable'='adapter_failure')=>{
      if(!alive.current || speechGeneration.current!==speechToken)return;
      voiceDiagnostics.current.failures++;voiceDiagnostics.current.lastFailureCode=code;
      setSpeechError('Sesli yönlendirmede sorun yaşandı. Güncel talimat yeniden denenecek; ekrandaki yazıları takip et.');
    };
    const voiceStarted=()=>{if(alive.current && speechGeneration.current===speechToken)setSpeechError('');};
    setFrame(undefined); setReps(0); setProgress(0); setPhase('Başlangıcı bul'); setExerciseStarted(false); setWholeBodyReady(false); setState('unknown');
    setCoachStatus(genericCoachStatus(null, false));
    startupStage.current = 'permission'; setCameraStartup('permission'); startupHistory.current = [];
    setReferenceOverlay(null);
    setNotice(placementMessage(undefined, template.trackedIndices, 'no_person'));
    timing.current.reset(); setActive(true);
    let source: LivePoseSource;
    const startup = (stage: CameraStartupStage) => {
      if (!alive.current || speechGeneration.current !== speechToken) return;
      startupStage.current = stage; setCameraStartup(stage);
      startupHistory.current.push({stage, elapsedMs: Math.round(performance.now() - attemptStarted.current!)});
      if (stage !== 'tracking') { lastMessageRef.current = CAMERA_STARTUP_MESSAGES[stage]; setNotice(lastMessageRef.current); }
    };
    try { source = createSource(video, options, startup); }
    catch (failure) {
      setActive(false);
      setError(failure instanceof Error ? failure.message : 'Kamera başlatılamadı. Yeniden dene.');
      void finish('interrupted'); return;
    }
    let voice: SpeechOutput;
    let speechSetupFailed = false;
    try { voice = createSpeech(reason => voiceFailed(reason)); }
    catch {
      // Speech is optional; a broken browser TTS implementation must not block the camera.
      speechSetupFailed = true;
      voice = { available: false, speak() {}, cancel() {} };
      voiceFailed();
      setSpeechError('Sesli yönlendirme başlatılamadı. Ekrandaki yazılarla devam edebilirsin.');
    }
    voice = speechWithInputPause(voice, active => voiceCommandsRef.current?.setOutputActive(active));
    speechRef.current = voice;
    if (!voice.available && !speechSetupFailed) {voiceFailed('unavailable');setSpeechError('Bu tarayıcıda sesli yönlendirme kullanılamıyor. Ekrandaki yazılarla devam edebilirsin.');}
    const channels = sessionSpeech(voice, () => soundRef.current, () => voiceFailed());
    answerSpeech.current = channels;
    clearCoachRef.current = channels.clearCoach;
    const correction:SpeechOutput={get available(){return channels.output.available;},
      speak(text,onStarted){return channels.output.speak(text,()=>{voiceStarted();onStarted?.();});},cancel(){channels.output.cancel();}};
    correctionSpeechRef.current = correction;
    let movementStarted = false, everStarted = false, previousWholeBody = false, cameraReadyAnnounced = false;
    let previousPhase = 'waiting', phaseSince = performance.now(), phaseSerial = 0;
    let previousFormStatus: 'unknown' | 'correct' | 'incorrect' = 'unknown', returnDirectionSpoken = false;
    let wholeBodyLostSince = 0;
    let currentCue: { kind: 'reference' | 'start' | 'return' | 'near' | 'completed' | 'reminder'; text: string; until: number } | null = null;
    let seenTrackingReset=trackingResetGeneration.current;
    let progressCue = genericProgressGuidance(0, coaching);
    let reminder = genericCoachReminder(coaching), automaticExampleShown = false;
    const referencePrompt=`Vücudun görünüyor. ${coaching.startInstruction}`;
    const startPrompt=`Başlangıç hazır. ${coaching.outbound}`;
    const guidance=trackingSetupGuidance({clearSetup:channels.clearSetup,setup(text){
      const recovery=everStarted;
      channels.setup(text,()=>{if(speechGeneration.current!==speechToken)return;voiceStarted();voiceDiagnostics.current.setupStarted++;if(recovery)voiceDiagnostics.current.recoveryStarted++;});
    }},performance.now());
    guidanceRef.current=guidance;
    const session = new TrackLiveGenericSession(source, template, correction, bodyProfile ?? undefined);
    sessionRef.current = session;
    guidance.announce('Kamerayı hazırlıyorum. Hazır olunca söyleyeceğim.',performance.now());
    if (withVoice) voiceCommandsRef.current?.start();
    try {
      await session.start(update => {
        if (sessionRef.current !== session) return;
        if (startupStage.current !== 'tracking') startup('tracking');
        const reading = update.observation;
        if (!timing.current.received(reading.frame.timestampMs, performance.now())) {
          setError('Güncel kamera ölçümü alınamadı. Yeniden başlat.'); void finish('interrupted'); return;
        }
        setFrame(reading.frame); setSize({ width:reading.width, height:reading.height });
        const result = update.comparison;
        setAccuracy(result.accuracyPct ?? null);
        const currentReason = result.observation.status === 'unknown' ? result.observation.reason : '';
        const detail = result.observation.status === 'incorrect' ? result.observation.errors[0]?.message : '';
        const scope = `${result.phase}:${result.observation.status}:${currentReason}:${detail}`;
        if (answerScope.current !== null && answerScope.current !== scope) {
          channels.clearAnswer(); setVoiceReply(''); answerScope.current = null;
        }
        lastMeasurement.current = { result, receivedAt: performance.now(), scope };
        const now = performance.now();
        const currentWholeBody=reading.frame.people.length===1&&isWholeBodyVisible(reading.frame.people[0]);
        setCoachStatus(genericCoachStatus(result, currentWholeBody, reading.frame.people.length === 1));
        if (!currentWholeBody) {
          if (wholeBodyLostSince === 0) wholeBodyLostSince = now;
        } else {
          wholeBodyLostSince = 0;
        }
        const wholeBodyReallyLost = wholeBodyLostSince > 0 && (now - wholeBodyLostSince > 2500);
        if(seenTrackingReset!==trackingResetGeneration.current){
          reminder = genericCoachReminder(coaching);
          movementStarted=false;currentCue=null;previousPhase='waiting';previousWholeBody=false;channels.clearCoach();progressCue=genericProgressGuidance(result.repetitionCount, coaching);
          seenTrackingReset=trackingResetGeneration.current;setExerciseStarted(false);setAccuracy(null);
        }
        if(previousWholeBody&&wholeBodyReallyLost){
          reminder = genericCoachReminder(coaching);
          movementStarted=false;currentCue=null;previousPhase='waiting';channels.clearCoach();progressCue=genericProgressGuidance(result.repetitionCount, coaching);
          setExerciseStarted(false);previousWholeBody=false;setAccuracy(null);
        }
        if(currentWholeBody) previousWholeBody=true;
        setWholeBodyReady(currentWholeBody);
        const setupNotice = currentWholeBody && currentReason === 'find_start' ? coaching.startInstruction
          : placementMessage(reading.frame, template.trackedIndices, currentReason);
        const milestone = progressCue(result);
        const currentReminder = reminder(result);
        if (currentCue?.kind === 'reminder' && !currentReminder) {
          currentCue = null; channels.clearCoach();
        }
        const phaseChanged = previousPhase !== result.phase;
        if (phaseChanged) {
          // Retire the old direction as soon as the measured movement turns back.
          channels.clearCoach(); previousPhase = result.phase; phaseSince = now; phaseSerial++;
          returnDirectionSpoken = false;
        }
        if (result.phase === 'waiting') movementStarted = false;
        const justStarted = result.phase !== 'waiting' && !movementStarted;
        if (justStarted) {
          movementStarted = true; everStarted = true; setExerciseStarted(true);
          if (result.repetitionCount === 0) setShowDemo(true);
        }
        const findingStart = currentWholeBody && ['find_start','hold_start'].includes(currentReason);
        if (result.observation.status === 'unknown') {
          if (!(findingStart && currentCue?.kind === 'completed' && now < currentCue.until))
            currentCue = findingStart ? { kind: 'reference', text: referencePrompt, until: Infinity } : null;
          if (!findingStart) channels.clearCoach();
        } else if (result.observation.status === 'incorrect') {
          currentCue = null;
          if (previousFormStatus !== 'incorrect') channels.clearCoach(true);
        } else if (milestone?.kind === 'completed') {
          setShowDemo(false); setDemoRequest(0);
          const repAccuracy = milestone.accuracyPct ?? result.cycleAccuracyPct ?? result.accuracyPct;
          const text = repetitionAnnouncement(sessionGoal.current, result.repetitionCount, milestone.assessment ?? 'unknown', repAccuracy);
          currentCue = { kind: 'completed', text, until: now + 3500 };
          setVoiceReply(''); answerScope.current = null;
          const goal = repetitionGoalProgress(sessionGoal.current, result.repetitionCount);
          if (goal.complete) {
            setReps(result.repetitionCount); lastMessageRef.current = text;
            void finish('finished', text); return;
          }
          channels.count(text, () => { voiceStarted(); voiceDiagnostics.current.completedStarted++; });
        } else if (!(currentCue?.kind === 'completed' && now < currentCue.until)) {
          if (milestone?.kind === 'return') {
            currentCue = { kind: 'return', text: milestone.text, until: Infinity };
          } else if (milestone?.kind === 'near') {
            currentCue = { kind: 'near', text: milestone.text, until: now + 3500 };
            channels.milestone(milestone.text, () => {
              if (speechGeneration.current !== speechToken) return;
              voiceStarted();
              voiceDiagnostics.current.nearStarted++;
            });
          } else if (result.phase === 'return') {
            currentCue = { kind: 'return', text: coaching.returning, until: Infinity };
          } else if (result.phase === 'outbound' && (phaseChanged || !currentCue || currentCue.kind === 'reference' || now >= currentCue.until)) {
            currentCue = { kind: 'start', text: justStarted ? startPrompt : coaching.outbound, until: Infinity };
          }
        }
        // A measured return still needs a direction when form differs. Let a
        // current correction finish, then offer only the still-current phase.
        if (result.phase === 'return' && result.observation.status !== 'unknown' && !returnDirectionSpoken) {
          channels.coach(`return:${phaseSerial}`, coaching.returning, () => {
            if (speechGeneration.current !== speechToken) return;
            returnDirectionSpoken = true; voiceStarted(); voiceDiagnostics.current.returnStarted++;
          });
        }
        previousFormStatus = result.observation.status;
        if (currentReminder && !milestone && !(currentCue?.kind === 'completed' && now < currentCue.until)) {
          currentCue = {kind: 'reminder', text: currentReminder.text, until: now + 500};
          channels.coach(currentReminder.key, currentReminder.text, () => {
            if (speechGeneration.current !== speechToken) return;
            voiceStarted();
            voiceDiagnostics.current[result.phase === 'waiting' ? 'referenceStarted' : 'startStarted']++;
          });
          if (currentReminder.showExample && !automaticExampleShown) {
            automaticExampleShown = true; setShowDemo(true); setDemoRequest(value => value + 1);
          }
        }
        setReps(result.repetitionCount); setProgress(Math.round(result.progress * 100));
        setReferenceOverlay(result.observation.status === 'unknown' ? null : result.overlay);
        setPhase(result.phase === 'outbound' ? 'Gidiş' : result.phase === 'return' ? 'Dönüş' : 'Başlangıcı bul');
        setState(result.observation.status);
        const formTag = typeof result.accuracyPct === 'number' ? ` (Benzerlik: %${result.accuracyPct})` : '';
        const nextNotice = currentCue?.kind === 'reminder' ? currentCue.text : result.observation.status === 'unknown'
          ? (['find_start','hold_start','body_not_visible','no_person','camera_view','tracking_lost','multiple_people','processing_slow'].includes(currentReason) ? setupNotice : messageFor(currentReason))
          : result.observation.status === 'incorrect' ? result.observation.errors[0]?.message ?? 'Hareket yolu farklı görünüyor.'
          : currentCue?.kind === 'completed' ? `✓ ${currentCue.text}`
          : currentCue?.kind === 'near' ? `✓ ${currentCue.text}`
          : milestone?.kind === 'near' ? `✓ Harika! Görünen hareket referansa uyuyor.${formTag}`
          : result.phase === 'return' ? `✓ Harika! ${coaching.returning}${formTag}`
          : result.progress < .08 ? `Başlangıç hazır. ${coaching.outbound}` : `✓ Görünen hareket uyuyor. ${coaching.outbound}${formTag}`;
        lastMessageRef.current=nextNotice;setNotice(nextNotice);
        if (!cameraReadyAnnounced) {
          cameraReadyAnnounced = true;
          channels.ready('Kamera analizi hazır. Şimdi başın ve ayakların görünecek şekilde kameranın karşısına geç.',
            () => { voiceStarted(); voiceDiagnostics.current.setupStarted++; });
        }
        guidance.update(result.observation.status === 'unknown' && !findingStart ? currentReason : null, nextNotice, now, currentReason !== 'hold_start');
        if (currentCue && (currentCue.kind === 'reference' || currentCue.kind === 'start')) {
          const cue = currentCue;
          // Repeat only when user is stalled before moving; stay quiet while movement is actively in progress.
          const repeat = Math.floor((now - phaseSince) / 8000);
          const shouldSpeak = repeat === 0;
          if (shouldSpeak) {
            const key = `${phaseSerial}:${cue.kind}:${repeat}`;
            channels.coach(key, cue.text, () => {
              if(speechGeneration.current !== speechToken) return;
              voiceStarted();
              if(cue.kind === 'reference') voiceDiagnostics.current.referenceStarted++;
              else if(cue.kind === 'start') voiceDiagnostics.current.startStarted++;
            });
          }
        }
      }, failure => {
        if (sessionRef.current !== session) return;
        setError(failure.message); void finish('interrupted', `Analiz durdu. ${failure.message}`);
      }, timestampMs => { if (sessionRef.current === session) timing.current.captureStarted(timestampMs); });
    } catch (failure) {
      if (sessionRef.current === session) { const message = failure instanceof Error ? failure.message : 'Kamera başlatılamadı.'; setError(message); void finish('interrupted', `Analiz başlatılamadı. ${message}`); }
    }
  }

  function changeSetupCamera(facingMode: CameraOptions['facingMode']) {
    if (exerciseStarted) return;
    release();
    setOptions(previous => ({ ...previous, facingMode, deviceId: '', portrait: true }));
    setMirrored(facingMode === 'user'); setRestartRequested(true);
  }

  useEffect(() => {
    const video = videoRef.current;
    video?.addEventListener('resize', updateVideoSize);
    return () => video?.removeEventListener('resize', updateVideoSize);
  }, [active]);

  function toggleSound() { const next = !soundRef.current; soundRef.current = next; setSound(next); if (!next) speechRef.current?.cancel(); }
  function testVoice() {
    speechRef.current?.cancel(); setSpeechError('');
    let voice: SpeechOutput;
    try { voice = createSpeech(() => setSpeechError('Ses çalınamadı. Cihazın sesini ve tarayıcı ayarlarını kontrol et.')); }
    catch { setSpeechError('Bu tarayıcıda sesli yönlendirme başlatılamadı. Ekrandaki yazıları takip et.'); return; }
    speechRef.current = voice;
    if (!voice.available) { setSpeechError('Bu tarayıcı sesli yönlendirmeyi desteklemiyor.'); return; }
    try { void Promise.resolve(voice.speak('Sesli yönlendirme hazır. Hareketi kendi hızında yapabilirsin.'))
      .catch(() => setSpeechError('Ses çalınamadı.')); } catch { setSpeechError('Ses çalınamadı.'); }
  }
  function close() { if(sessionRef.current&&!finished){void finish('interrupted');return;} void finish('interrupted').then(ok => { if (ok) onClose(); }); }

  return <div ref={panelRef} tabIndex={-1} data-coach-tone={coachStatus.tone} className={`live-exercise-dialog generic-live-dialog distance-coach${fillCamera ? ' fill-camera' : ''}${active ? ' camera-running session-tracking visual-live' : ''}${orientationMismatch ? ' orientation-mismatch' : ''}${active && error ? ' has-live-message' : ''}`}
    role="dialog" aria-modal="true" aria-labelledby="generic-live-title">
    <div className="live-header"><div><p className="eyebrow">SERBEST HAREKET · CANLI</p><h2 id="generic-live-title">Hareketini takip et</h2>
      <span className="live-side-tag">{profileApplied ? 'Vücut profilin ölçekte kullanılıyor' : bodyProfile ? 'Profil kayıtlı · bu referansta gövde ölçeği' : 'Profilsiz deneme'} · Referansla aynı süre şart değil</span></div>
      <div className="scan-toolbar"><button className="secondary-button" onClick={toggleSound} aria-pressed={sound}>{sound ? 'Ses: Açık' : 'Ses: Kapalı'}</button>
        <button className="secondary-button" disabled={saving} onClick={close}>Kapat</button></div></div>
    {finished ? <section className="live-summary-card" aria-label="Oturum özeti"><div className="summary-badge">{endReason === 'finished' ? 'Oturum bitti' : 'Oturum kesildi'}</div>
      <h3>Hareket özeti</h3>{error && <p className="message error" role="alert">{error}</p>}
      {speechError && <p className="message" role="status">{speechError}</p>}
      {summary && <GenericSessionSummaryView summary={summary} reportText={attemptReport ?? undefined} />}
      {attemptReport && <p className="implementation-note">{reportSaved ? 'Rapor Geçmiş → Son kaydedilen deneme raporu bölümünde de durur. Dosyayı indirip inceleme için paylaşabilirsin.' : 'Bu denemenin raporu cihazda saklanamadı; Geçmiş’te önceki denemenin raporu duruyor olabilir. Bu ekranı kapatmadan dosyayı indir.'}</p>}
      {saving && <p role="status">Oturum Geçmiş’e kaydediliyor…</p>}
      {saveState === 'saved' && <p role="status">{endReason === 'finished' ? 'Bitirilen' : 'Kesilen'} oturum Geçmiş’e kaydedildi.</p>}
      {summary?.trackedFrames === 0 && <p className="implementation-note">Tamamlanmış egzersiz kaydı oluşturulmadı; deneme raporunu yine de indirebilirsin.</p>}
      {saveState === 'failed' && <div className="message error" role="alert">Geçmiş’e kaydedilemedi. Aynı özetle tekrar deneyebilir veya kaydetmeden çıkabilirsin.
        <div className="template-actions"><button className="secondary-button" onClick={() => { void finish(endReason); }}>Kaydetmeyi tekrar dene</button>
          <button className="text-button" onClick={() => { if (archive.current) archive.current.discarded = true; onClose(); }}>Kaydetmeden kapat</button></div></div>}
      <div className="template-actions"><button className="primary-button" disabled={saving || saveState === 'failed'} onClick={() => { setFinished(false); setRestartRequested(true); }}>Yeniden başla</button>
        <button className="secondary-button" disabled={saving || saveState === 'failed'} onClick={close}>Egzersizlerime dön</button></div></section> : <>
      {!active && <section className="generic-teaching-intro" aria-label="Hareketi öğren">
        <GenericMovementGuide template={template} />
        <div><p className="eyebrow">ÖNCE İZLE, SONRA DENE</p><h3>Adım adım birlikte yapalım</h3>
          <ol><li><strong>Kadraja yerleş.</strong> Başından ayak bileklerine kadar tüm vücudun görünsün. (Telefonu masaya koyuyorsan hafifçe aşağı doğru eğebilirsin).</li>
            <li><strong>Başlangıç duruşunu eşleştir.</strong> Duruş algılanınca "Başlangıç hazır" diyeceğim.</li>
            <li><strong>{coaching.outbound}</strong> Dönüş zamanı geldiğinde “{coaching.returning}” diyeceğim; başlangıca dönünce tekrarı sayacağım.</li></ol>
          <p>Telefonu uzağa koyunca sesimi takip et. Yeşil ✓: görünen hareket referansa yakın. Her tam tekrarda sayıyı sesli söylerim.</p></div></section>}
      {!active && <section className="camera-angle-intro" aria-label="Telefonu yerleştir">
        <strong>Önce kameranın açısını eşleştir</strong>
        <p>Videoda kişi yandan görünüyorsa sen de yan dur. Önden görünüyorsa kameraya dön. Telefonu sabitle; başın, ellerin ve ayakların hareket boyunca kadrajda kalsın.</p>
        <small>Ayna düğmesi yalnızca ekrandaki görüntüyü çevirir; farklı çekim açısını düzeltmez. Gölgeyle aynı boyda veya aynı yerde olman gerekmiyor.</small>
      </section>}
      {!bodyProfile && !active && onGoBody && <div className="message"><p>Vücut profilin yok. Bir kez tararsan sonraki videolarda kullanılır.</p>
        <button className="text-button" onClick={onGoBody}>Vücudum’a git</button></div>}
      {!active && <fieldset className="repetition-goal-setup"><legend>Bugünkü hedefin</legend>
        <div><label>Set sayısı<select value={repetitionGoal.sets} onChange={event => setRepetitionGoal(previous => ({ ...previous, sets: Number(event.target.value) }))}>
          {Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} set</option>)}</select></label>
        <label>Her sette tekrar<select value={repetitionGoal.repetitionsPerSet} onChange={event => setRepetitionGoal(previous => ({ ...previous, repetitionsPerSet: Number(event.target.value) }))}>
          {Array.from({ length: 30 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} tekrar</option>)}</select></label></div>
        <p>{repetitionGoal.sets} set × {repetitionGoal.repetitionsPerSet} tekrar · toplam {goalProgress.target}. Her tam tekrarı sesli sayacağım. Setler arasında istediğin kadar dinlen; hazır olduğunda hareketle devam et. Hedef bitince oturum kapanır.</p>
      </fieldset>}
      <VoiceCommandControls coach controllerRef={voiceCommandsRef} sessionActive={active} createCommands={createVoiceCommands} onCommand={onVoiceCommand} />
      {!active && <div className="voice-start-actions"><button className="primary-button camera-start-button" onClick={() => void start(true)}>Kamera ve sesli koçu başlat <span aria-hidden="true">▶</span></button>
        <button className="text-button" onClick={() => void start(false)}>Yalnız kamerayla başla</button></div>}
      {!active && <details className="live-setup-options"><summary>Kamera ve ses seçenekleri</summary>
        <CameraSettings value={options} disabled={false} onChange={value => { setOptions(value); setMirrored(value.facingMode === 'user'); }} />
        <label className="screen-awake-option"><input type="checkbox" checked={keepAwake} onChange={event => setKeepAwake(event.target.checked)} /> Seans sırasında ekranı açık tut</label>
        <button className="secondary-button voice-test-button" onClick={testVoice}>Yönlendirme sesini dene</button>
      </details>}
      
      <div className="live-views"><div className="live-camera-stage"><div ref={stageRef}
        className={`camera-stage${mirrored ? ' mirrored' : ''}${active && videoSize ? ' natural-preview' : ''}${state === 'unknown' ? ' tracking-uncertain' : ''}${state === 'incorrect' ? ' measured-deviation' : ''}`}
        style={videoSize ? { aspectRatio: `${videoSize.width} / ${videoSize.height}` } : undefined}>
        <video ref={videoRef} playsInline muted autoPlay aria-label="Canlı egzersiz kamerası" onLoadedMetadata={updateVideoSize} />
        {active && waitingForStart && <CameraPlacementGuide template={template} width={videoSize?.width ?? size.width} height={videoSize?.height ?? size.height} fill={fillCamera} showReference={cameraStartup === 'tracking' && referenceGuide} viewport={guideViewport} />}
        {active && cameraStartup !== 'tracking' && <div className="camera-preparing-badge" role="status" aria-live="polite">
          <span className="preparing-spinner" aria-hidden="true" />
          <span>{cameraStartup === 'loading_model' ? 'Hareket modeli indiriliyor… Lütfen bekle' : cameraStartup === 'starting_engine' ? 'Hareket motoru açılıyor… Lütfen bekle' : 'Analiz hazırlanıyor… Lütfen bekle'}</span>
        </div>}
        <Skeleton fill={fillCamera} frame={frame} width={size.width} height={size.height} deviatingJoints={deviatingJoints} />
        {active && referenceOverlay && <LiveReferenceOverlay overlay={referenceOverlay} width={videoSize?.width ?? size.width} height={videoSize?.height ?? size.height} fill={fillCamera} />}
        {active && showDemo && <div className="demo-guide-overlay">
          <button type="button" className="demo-guide-close" onClick={() => { setShowDemo(false); setDemoRequest(0); }} aria-label="Rehberi kapat">✕</button>
          <GenericMovementGuide template={template} phase={waitingForStart ? 'start' : phase === 'Dönüş' ? 'return' : 'outbound'} playRequest={demoRequest} onPlaybackChange={playing => { setShowDemo(playing); if (!playing) setDemoRequest(0); }} />
        </div>}
        {active && !showDemo && <button type="button" className="camera-demo-toggle" onClick={() => { setShowDemo(true); setDemoRequest(v => v + 1); }} aria-label="Referans hareketi göster">▶ Hareketi göster</button>}
        {active && <div className="generic-live-legend" aria-hidden="true">
          <span>{state === 'unknown' ? '○ Hareket henüz değerlendirilemiyor' : '● Yeşil: Ölçülen fark yok'}</span>
          {referenceOverlay ? <>
            {deviatingJoints && <span>● Kırmızı: Düzeltilecek eklem</span>}
            <span>● Kesik çizgi: Video referansı</span>
          </> : <span>● Eşleşme bekleniyor</span>}
        </div>}
        {!active && <div className="camera-placeholder"><p>Kamera kapalı. Başlatınca bütün hareket eden eklemler kadrajda kalsın.</p></div>}
      </div><div className="camera-underbar"><label className="mirror-option"><input type="checkbox" checked={mirrored}
        onChange={event => setMirrored(event.target.checked)} /> Ayna</label><span>{fillCamera ? 'Ekranı doldur' : 'Tüm kadraj'}</span></div></div>
      <div className="live-hud"><div className="rep-counter-card repetition-goal-counter" aria-label={`Set ${goalProgress.currentSet}/${repetitionGoal.sets}, tekrar ${goalProgress.inSet}/${repetitionGoal.repetitionsPerSet}`}>
        <span className="hud-label">SET {goalProgress.currentSet}/{repetitionGoal.sets}</span>
        <strong key={reps} className={`rep-number${reps > 0 ? ' rep-counted' : ''}`}>{goalProgress.inSet}<small>/{repetitionGoal.repetitionsPerSet}</small></strong><span className="hud-label">TEKRAR</span></div>
        <div className="phase-card"><span className="hud-label">{cameraStartup === 'tracking' ? (wholeBodyReady ? '2 · HAREKETİ DEĞERLENDİR' : '1 · TAM VÜCUDU GÖSTER') : 'HAZIRLIK · ANALİZ YÜKLENİYOR'}</span><strong className="phase-name">{cameraStartup === 'tracking' ? (wholeBodyReady ? phase : 'Kadraja gir') : cameraStartup === 'loading_model' ? 'Model indiriliyor…' : cameraStartup === 'starting_engine' ? 'Motor açılıyor…' : 'Kamera hazırlanıyor…'}</strong>
          <div className="phase-progress-bar"><div className="phase-progress-fill" style={{ width:`${cameraStartup === 'tracking' ? progress : 0}%` }} /></div>
          <small className="phase-pct">{cameraStartup === 'tracking' ? `Şablon boyunca %${progress}${accuracy !== null ? ` · Benzerlik: %${accuracy}` : ''}` : 'Lütfen bekle · Hazır olunca sesleneceğim'}</small></div>
        <div className={`live-guidance-box ${state === 'unknown' ? 'unknown' : state === 'incorrect' ? 'warning' : 'ok'}`} role="status" aria-atomic="true">
          <div className="distance-status-heading">
            <span className="distance-status-symbol" aria-hidden="true">{cameraStartup === 'tracking' ? coachStatus.symbol : '…'}</span>
            <strong>{cameraStartup === 'tracking' ? coachStatus.title : ['model','loading_library','loading_model','starting_engine'].includes(cameraStartup) ? 'ANALİZ HAZIRLANIYOR' : cameraStartup === 'detecting' ? 'İLK ÖLÇÜM' : 'KAMERA AÇILIYOR'}</strong>
            {cameraStartup === 'tracking' && accuracy !== null && (
              <span className={`live-accuracy-pill ${accuracy >= 75 ? 'good' : accuracy >= 50 ? 'medium' : 'poor'}`}>
                Benzerlik %{accuracy}
              </span>
            )}
          </div>
          <p>{voiceReply || notice}</p>
          <small className="distance-status-scope">{cameraStartup !== 'tracking' ? 'Hazır olunca sesli yönlendireceğim' : wholeBodyReady ? 'Görünen hareket · referansla karşılaştırma' : 'Önce başın, ellerin ve ayakların görünsün'}</small>
        </div>
        {active && <CameraSetupProgress frame={frame} started={!waitingForStart && state !== 'unknown'} loading={cameraStartup !== 'tracking'} />}
        </div></div>
      {orientationMismatch && !exerciseStarted && <section className="camera-recovery" aria-label="Dikey kamera kurulumu">
        <strong>{fillCamera ? 'Ekran dolu · yan kenarlar kırpılıyor' : 'Kamera yatay kare gönderiyor'}</strong>
        <p>{fillCamera ? 'Görüntünün tümünü görmek için Tüm kadraj’a dön.' : 'Büyütmek kenarları kırpar. Tam kadraj için telefonu yatay da kullanabilirsin.'}</p>
        <div><button onClick={() => setFillCamera(previous => !previous)}>{fillCamera ? 'Tüm kadrajı göster' : 'Ekranı doldur'}</button>
          <button onClick={() => changeSetupCamera(options.facingMode === 'user' ? 'environment' : 'user')}>{options.facingMode === 'user' ? 'Arka kameraya geç' : 'Ön kameraya geç'}</button></div>
      </section>}
      {error && <p className="message error" role="alert">{error}</p>}{speechError && <p className="message" role="status">{speechError}</p>}
      {active && <CameraOptionsSheet notice={[speechError, orientationMismatch ? 'Kamera yatay görüntü gönderiyor. Ekranı doldur seçeneği kenarları kırpar; Tüm kadraj görüntüyü bütünüyle korur.' : ''].filter(Boolean).join(' ')}>
      <p className="camera-source-info">Alınan görüntü: {videoSize ? `${videoSize.width} × ${videoSize.height}` : 'bekleniyor'} · {options.facingMode === 'user' ? 'Ön kamera' : 'Arka kamera'}</p>
      <label className="screen-awake-option"><input type="checkbox" checked={keepAwake} onChange={event => setKeepAwake(event.target.checked)} /> Seans sırasında ekranı açık tut</label>
      <p role="status">{awakeState === 'active' ? 'Ekran açık tutuluyor.' : keepAwake ? 'Ekran kilidi önlenemedi; telefonun ekran süresini uzatabilirsin.' : 'Telefonun ekran süresi kullanılıyor.'}</p>
      <label className="mirror-option"><input type="checkbox" checked={mirrored} onChange={event => setMirrored(event.target.checked)} /> Ayna</label>
      <CameraFraming fill={fillCamera} onChange={setFillCamera} /><CameraLensControls video={videoRef.current} active={active} disabled={exerciseStarted} />
      <details className="session-info"><summary>Bu karşılaştırma ne yapıyor?</summary>
        <p>Görünür eklemlerin yolunu referans tekrarıyla karşılaştırır. Hızını kendin seçersin. Takip belirsizse düzeltme yapılmaz; ilk egzersiz düzeltmesi 10. saniyeden önce söylenmez.</p>
        <p>{profileApplied ? 'Kayıtlı vücut profilin göreli bacak/gövde oranıyla konum ölçeğinde kullanılır.' : 'Bu referansta ölçülen görüntü gövde ölçeği kullanılır; kayıtlı profilin oranları uygulanmaz.'}</p>
        <p>Egzersizin adını, güvenli sınırlarını veya 3B anatomik doğruluğunu tespit etmez.</p></details></CameraOptionsSheet>}
      {active && <div className="live-bottom-bar"><button className="secondary-button stop-exercise-btn" onClick={() => void finish()}>Oturumu bitir</button></div>}
    </>}
  </div>;
}

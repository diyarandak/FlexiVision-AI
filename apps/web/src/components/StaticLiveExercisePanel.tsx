import { CameraOptions as CameraOptionsSheet } from './CameraOptions.tsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LivePoseSource, SpeechOutput } from '@flexivision/application';
import { StaticSessionArchive, TrackStaticSession } from '@flexivision/application';
import type { PoseFrame, SessionEndReason, StaticPoseTemplate, StaticSessionRecord, StaticSessionSummary } from '@flexivision/contracts';
import { CalibrationStreamTiming, type StaticLiveResult } from '@flexivision/core';
import { BrowserCameraPose, preferredCameraOptions, type CameraOptions } from '../adapters/browserCameraPose.ts';
import { createBrowserSpeech } from '../adapters/speech.ts';
import { sessionSpeech } from '../adapters/sessionSpeech.ts';
import { trackingSetupGuidance } from '../adapters/trackingSetupGuidance.ts';
import { CameraSettings } from './CameraSettings.tsx';
import { CameraFraming } from './CameraFraming.tsx';
import { CameraLensControls } from './CameraLensControls.tsx';
import { VoiceCommandControls } from './VoiceCommandControls.tsx';
import { Skeleton } from './MotionResults.tsx';
import { LiveReferenceOverlay } from './GenericLiveExercisePanel.tsx';
import { StaticReferenceFigure } from './StaticPoseResults.tsx';
import { StaticSessionSummaryView } from './StaticSessionSummaryView.tsx';
const guide = (r: StaticLiveResult | null) => {
    if (!r)
        return 'Referans duruşa geç. Süre yalnız eşleşen duruşta ilerler.';
    if (r.completed)
        return 'Hedef süre tamamlandı.';
    if (r.observation.status === 'correct')
        return 'Duruş eşleşiyor. Süre ilerliyor.';
    if (r.observation.status === 'incorrect')
        return 'Süre duraklatıldı. Kırmızı işaretli bölgeleri referansla eşleştir.';
    switch (r.observation.reason) {
        case 'hold_start': return 'Bu duruşu kısa bir an koru.';
        case 'find_start': return 'Önce çizimdeki referans duruşa geç.';
        case 'multiple_people': return 'Vücut net seçilemiyor. Kadrajda yalnız sen kal ve ışığı kontrol et.';
        case 'camera_view': return 'Kamerayı referans videodaki açıya getir.';
        case 'processing_slow': return 'Ölçüm yavaş. Hafif kamera ayarıyla yeniden dene.';
        default: return 'Süre duraklatıldı. Omuzların, kalçan, kolların ve bacakların net görünsün.';
    }
};
interface Props {
    template: StaticPoseTemplate;
    onClose: () => void;
    onSave: (summary: StaticSessionSummary, reference: StaticSessionRecord['reference'], reason: SessionEndReason) => Promise<StaticSessionRecord>;
    createSource?: (video: HTMLVideoElement, options: CameraOptions) => LivePoseSource;
    createSpeech?: () => SpeechOutput;
}
export function StaticLiveExercisePanel({ template, onClose, onSave, createSource = (video, options) => new BrowserCameraPose(video, undefined, options), createSpeech }: Props) {
    const panel = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null), session = useRef<TrackStaticSession | null>(null);
    const voice = useRef<SpeechOutput | null>(null), correction = useRef<SpeechOutput | null>(null), alive = useRef(true), soundRef = useRef(true);
    const setupGuidance = useRef<ReturnType<typeof trackingSetupGuidance> | null>(null);
    const timing = useRef(new CalibrationStreamTiming()), finalizer = useRef<(reason: SessionEndReason) => Promise<boolean>>(async () => true);
    const [options, setOptions] = useState(preferredCameraOptions), [fill, setFill] = useState(false), [mirrored, setMirrored] = useState(true);
    const [sound, setSound] = useState(true), [active, setActive] = useState(false), [finished, setFinished] = useState(false);
    const [target, setTarget] = useState('30'), [result, setResult] = useState<StaticLiveResult | null>(null), [frame, setFrame] = useState<PoseFrame>();
    const [size, setSize] = useState({ width: 640, height: 480 }), [error, setError] = useState(''), [audioError, setAudioError] = useState('');
    const [summary, setSummary] = useState<StaticSessionSummary | null>(null), [saving, setSaving] = useState(false), [saveState, setSaveState] = useState<'none' | 'saved' | 'failed'>('none');
    const deviatingJoints = useMemo(() => {
        if (!result?.overlay?.joints) return undefined;
        const set = new Set<number>();
        for (const j of result.overlay.joints) {
            if (j.deviating) set.add(j.index);
        }
        return set.size > 0 ? set : undefined;
    }, [result?.overlay]);
    const record = useRef<StaticSessionArchive | null>(null);
    function release() {
        const current = session.current;
        session.current = null;
        correction.current = null;
        setupGuidance.current = null;
        try {
            current?.stop();
        }
        catch {
            if (alive.current)
                setError('Kamera kapatılamadı. Kamera göstergesi açık kalırsa sayfayı yenile.');
        }
        try {
            voice.current?.cancel();
        }
        catch { /* Release UI even if speech fails. */ }
        voice.current = null;
        timing.current.reset();
        if (alive.current)
            setActive(false);
    }
    async function finish(reason: SessionEndReason = 'finished'): Promise<boolean> {
        if (!record.current) {
            const current = session.current;
            if (!current)
                return true;
            const snapshot = current.getSummary(performance.now());
            release();
            if (alive.current) {
                setSummary(snapshot);
                setFinished(true);
            }
            record.current = new StaticSessionArchive(snapshot, { intervalId: template.interval.id, policyVersion: 'static-pose-v1' }, reason, onSave);
        }
        const item = record.current;
        if (item.canLeave) return true;
        if (alive.current) { setSaving(true); setSaveState('none'); }
        const ok = await item.save();
        if (alive.current && record.current === item) {
            setSaveState(ok ? 'saved' : 'failed');
            setSaving(false);
        }
        return ok;
    }
    finalizer.current = finish;
    const close = () => { void finish('interrupted').then(ok => { if (ok)
        onClose(); }); };
    useEffect(() => {
        alive.current = true;
        const root = document.getElementById('root'), inert = root?.inert ?? false, overflow = document.body.style.overflow, focus = document.activeElement;
        if (root)
            root.inert = true;
        document.body.style.overflow = 'hidden';
        panel.current?.focus();
        const hide = () => { if (document.hidden)
            void finalizer.current('interrupted'); }, exit = () => { void finalizer.current('interrupted'); };
        const key = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                void finalizer.current('interrupted').then(ok => { if (ok)
                    onClose(); });
                return;
            }
            if (e.key !== 'Tab')
                return;
            const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button,input,select,summary') ?? []).filter(v => !v.hasAttribute('disabled') && v.getClientRects().length > 0);
            const first = items[0], last = items.at(-1);
            if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
                e.preventDefault();
                last?.focus();
            }
            else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {
                e.preventDefault();
                first?.focus();
            }
        };
        document.addEventListener('visibilitychange', hide);
        window.addEventListener('pagehide', exit);
        document.addEventListener('keydown', key);
        return () => {
            alive.current = false;
            void finalizer.current('interrupted');
            if (root)
                root.inert = inert;
            document.body.style.overflow = overflow;
            document.removeEventListener('visibilitychange', hide);
            window.removeEventListener('pagehide', exit);
            document.removeEventListener('keydown', key);
            if (focus instanceof HTMLElement)
                focus.focus();
        };
    }, []);
    useEffect(() => {
        if (!active)
            return;
        const timer = setInterval(() => {
            const health = timing.current.check(performance.now());
            if (health === 'fresh')
                return;
            if (health === 'timed_out') {
                setError('Kamera ölçümü kesildi. Kamerayı yeniden başlat.');
                void finish('interrupted');
                return;
            }
            setFrame(undefined);
            setResult(old => old ? { ...old, observation: { status: 'unknown', reason: 'tracking_lost' }, overlay: null } : null);
            setupGuidance.current?.update('tracking_lost', 'Yeni ölçüm alınamıyor. Telefonu sabit tut; kamera görüntüsünü kontrol et.', performance.now());
            try {
                correction.current?.cancel();
            }
            catch { /* Audio cannot break tracking. */ }
        }, 250);
        return () => clearInterval(timer);
    }, [active]);
    async function start() {
        if (!video.current || session.current || (record.current && !record.current.canLeave))
            return;
        const seconds = Number(target);
        if (!Number.isInteger(seconds) || seconds < 5 || seconds > 600) {
            setError('5–600 saniye arasında tam sayı seç.');
            return;
        }
        release();
        record.current = null;
        setError('');
        setAudioError('');
        setSaveState('none');
        setSummary(null);
        setResult(null);
        setFrame(undefined);
        setFinished(false);
        let source: LivePoseSource;
        try {
            source = createSource(video.current, options);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Kamera başlatılamadı.');
            return;
        }
        const failed = () => { if (alive.current)
            setAudioError('Ses kullanılamadı. Ekrandaki yönlendirme ile devam edebilirsin.'); };
        try {
            voice.current = createSpeech ? createSpeech() : createBrowserSpeech({ onError: failed });
        }
        catch {
            failed();
            voice.current = { available: false, speak() { }, cancel() { } };
        }
        if (!voice.current.available)
            failed();
        const channels = sessionSpeech(voice.current, () => soundRef.current, failed);
        correction.current = channels.output;
        const guidance = trackingSetupGuidance(channels, performance.now());
        setupGuidance.current = guidance;
        const current = new TrackStaticSession(source, template, seconds * 1000, channels.output);
        session.current = current;
        setActive(true);
        guidance.announce('Referans duruşa geç. Süre eşleştiğinde başlayacak.', performance.now());
        await current.start((value, next) => {
            if (session.current !== current)
                return;
            if (!timing.current.received(value.frame.timestampMs, performance.now())) {
                setError('Güncel ölçüm alınamadı. Yeniden dene.');
                void finish('interrupted');
                return;
            }
            setFrame(value.frame);
            setSize({ width: value.width, height: value.height });
            setResult(next);
            guidance.update(next.observation.status === 'unknown' ? next.observation.reason : null,
                guide(next), performance.now(), next.observation.status !== 'unknown' || next.observation.reason !== 'hold_start');
            if (next.completed)
                void finish('finished');
        }, e => { if (alive.current && (session.current === current || (!session.current && record.current))) {
            setError(e.message);
            void finish('interrupted');
        } }, time => { if (session.current === current)
            timing.current.captureStarted(time); });
    }
    function setAudio(next: boolean) { soundRef.current = next; setSound(next); if (!next)
        try {
            voice.current?.cancel();
        }
        catch { /* Visual controls remain available. */ } }
    return <div ref={panel} tabIndex={-1} className={`live-exercise-dialog visual-live static-live-dialog${active ? ' camera-running session-tracking' : ''}${fill ? ' fill-camera' : ''}${active && error ? ' has-live-message' : ''}`} role="dialog" aria-modal="true" aria-labelledby="static-title">
    <header className="live-header"><div><p className="eyebrow">SABİT DURUŞ</p><h2 id="static-title">Duruşunu koru</h2></div><div className="scan-toolbar">
      <button className="secondary-button" aria-pressed={sound} onClick={() => setAudio(!sound)}>{sound ? 'Ses açık' : 'Ses kapalı'}</button>
      <button className="secondary-button" disabled={saving} onClick={close}>Kapat</button></div></header>
    {finished ? <section className="live-summary-card">{summary && <StaticSessionSummaryView summary={summary}/>}
      {error && <p className="message error" role="alert">{error}</p>}
      <p role="status">{saving ? 'Geçmiş kaydediliyor…' : saveState === 'saved' ? 'Geçmişe kaydedildi.' : summary?.trackedFrames === 0 ? 'Ölçüm olmadığı için geçmiş kaydı oluşturulmadı.' : ''}</p>
      {saveState === 'failed' && <div className="message error">Geçmiş kaydedilemedi.<button onClick={() => void finish(record.current?.reason ?? 'finished')}>Kaydı tekrar dene</button><button onClick={() => { if (record.current?.discard()) onClose(); }}>Kaydetmeden kapat</button></div>}
      <div className="template-actions"><button className="primary-button" disabled={saving || saveState === 'failed'} onClick={() => { setFinished(false); setResult(null); setFrame(undefined); setError(''); }}>Yeni oturum hazırla</button><button className="secondary-button" disabled={saving} onClick={close}>Egzersizlerime dön</button></div>
    </section> : <>
      {!active && <><div className="generic-start-card"><StaticReferenceFigure template={template}/><p>Referansla aynı kamera açısını kullan. Kemik yönleri, kendi uzuv uzunluklarınla karşılaştırılır; bu mod için yeniden vücut taraması gerekmez.</p></div>
        <label>Hedef süre (saniye)<input type="number" min={5} max={600} step={1} value={target} onChange={e => setTarget(e.target.value)}/></label>
        <p>Süre, duruş eşleştiğinde ilerler. Görüş kaybında veya sapmada duraklar.</p>
        <button className="primary-button" onClick={() => void start()}>Kamerayı aç ve başla</button>
        <details className="live-setup-options"><summary>Kamera seçenekleri</summary><CameraSettings value={options} disabled={false} onChange={v => { setOptions(v); setMirrored(v.facingMode === 'user'); }}/></details></>}
      <div className="live-views"><div className="live-camera-wrap"><div className={`camera-stage${mirrored ? ' mirrored' : ''}${result?.observation.status !== 'unknown' && result ? '' : ' tracking-uncertain'}`}>
        <video ref={video} playsInline muted aria-label="Canlı sabit duruş kamerası"/>
        <Skeleton frame={frame} width={size.width} height={size.height} fill={fill} deviatingJoints={deviatingJoints} />
        {result?.overlay && <LiveReferenceOverlay overlay={result.overlay} width={size.width} height={size.height} fill={fill}/>}
      </div></div>
      <div className="live-hud"><div className="rep-counter-card"><span className="hud-label">TUTULAN SÜRE</span><strong className="rep-number">{((result?.matchedMs ?? 0) / 1000).toFixed(1)}</strong><small> / {target} sn</small></div>
        <div className={`live-guidance-box ${result?.observation.status === 'incorrect' ? 'warning' : result?.observation.status === 'correct' ? 'ok' : 'unknown'}`}><p role="status">{guide(result)}</p></div></div></div>
      {active && !result?.started && !error && <div className="generic-start-card static-start-hint"><StaticReferenceFigure template={template}/><div><h3>Bu duruşa geç</h3><p>Kısa bir an sabit kal; süre otomatik başlayacak.</p></div></div>}
      {active && <><CameraOptionsSheet notice={audioError}><StaticReferenceFigure template={template}/><CameraFraming fill={fill} onChange={setFill}/>
        <label><input type="checkbox" checked={mirrored} onChange={e => setMirrored(e.target.checked)}/> Ayna</label>
        <CameraLensControls video={video.current} active={active} disabled={result?.started ?? false}/>
        <VoiceCommandControls sessionActive={active} onCommand={c => { if (c === 'finish')
                void finish();
            else if (c === 'mute' || c === 'unmute')
                setAudio(c === 'unmute'); }}/>
        <p>Yeşil: referansa yakın. Kırmızı: ölçülen yön farkı. Gri: karşılaştırma belirsiz. İlk düzeltme 10. saniyeden önce verilmez.</p></CameraOptionsSheet>
        <div className="live-bottom-bar"><button className="stop-exercise-btn secondary-button" onClick={() => void finish()}>Oturumu bitir</button></div></>}
      {error && <p className="message error" role="alert">{error}</p>}{!active && audioError && <p className="message" role="status">{audioError}</p>}
    </>}
  </div>;
}

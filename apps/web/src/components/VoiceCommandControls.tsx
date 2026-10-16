import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { VoiceCommand } from '@flexivision/core';
import { BrowserVoiceCommands, type VoiceCommandStatus } from '../adapters/voiceCommands.ts';

export type CreateVoiceCommands = (onCommand: (command: VoiceCommand) => void,
  onState: (status: VoiceCommandStatus, message?: string) => void) => BrowserVoiceCommands;
const createBrowserCommands: CreateVoiceCommands = (command, state) => new BrowserVoiceCommands(command, state);

export function VoiceCommandControls({ onCommand, sessionActive, createCommands = createBrowserCommands,
  controllerRef, coach = false, finishDescription = 'Bitir komutu oturumu sonlandırıp özetini kaydeder.' }: {
  onCommand: (command: VoiceCommand) => void; sessionActive: boolean; createCommands?: CreateVoiceCommands | undefined;
  finishDescription?: string; controllerRef?: Ref<BrowserVoiceCommands>; coach?: boolean;
}) {
  const [status, setStatus] = useState<VoiceCommandStatus>('off');
  const [message, setMessage] = useState('');
  const callback = useRef(onCommand); callback.current = onCommand;
  const active = useRef(sessionActive); active.current = sessionActive;
  const wasActive = useRef(sessionActive);
  const [controller] = useState(() => createCommands(command => { if (active.current) callback.current(command); },
    (next, detail) => { setStatus(next); setMessage(detail ?? ''); }));
  useImperativeHandle(controllerRef, () => controller, [controller]);
  useEffect(() => {
    const hide = () => { if (document.hidden) controller.stop(); };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); controller.stop(); };
  }, [controller]);
  useEffect(() => {
    if (wasActive.current && !sessionActive) controller.stop();
    wasActive.current = sessionActive;
  }, [controller, sessionActive]);
  const enabled = status === 'starting' || status === 'listening' || status === 'speaking';
  if (coach) return <section className={sessionActive ? 'generic-voice-status' : 'generic-voice-intro'} aria-label="Sesli koç">
    {sessionActive ? <>
      <span role="status">{status === 'listening' ? 'Dinliyorum · Soru sorabilirsin' : status === 'speaking' ? 'Koç konuşuyor' : status === 'starting' ? 'Mikrofon bağlanıyor…' : 'Mikrofon kapalı'}</span>
      <button type="button" disabled={!controller.available} onClick={() => enabled ? controller.stop() : controller.start()}>
        {enabled ? 'Mikrofonu kapat' : 'Mikrofonu aç'}</button>
    </> : <>
      <strong>Uzaktan sesinle yönet · ek servis ücreti yok</strong>
      <p>“Hareketi göster”, “kaldır”, “şimdi ne yapacağım?”, “doğru yapıyor muyum?” veya “kaç tekrar yaptım?” diyebilirsin. “Bitir” diyerek kapat.</p>
      <p className="voice-privacy">Sesli koçla başlatırsan mikrofon izni istenir. Ses tanıma için tarayıcının servisine ses gönderilebilir ve internet gerekebilir. FlexiVision sesini veya konuşma metnini saklamaz.</p>
      {!controller.available && <p>Bu tarayıcı sesli soruları desteklemiyor. Kamera ile devam edebilirsin.</p>}
    </>}
  </section>;
  return <details className="voice-controls">
    <summary>Sesli kontrol <span>{status === 'listening' ? '· Dinliyor' : status === 'starting' ? '· Bağlanıyor' : '· Kapalı'}</span></summary>
    <p>“Bitir”, “sesi kapat” veya “sesi aç” diyebilirsin. {finishDescription}</p>
    <p>İsteğe bağlı mikrofon erişimi. Sesin tarayıcının konuşma tanıma servisine gönderilebilir; internet gerekebilir. FlexiVision ses kaydı ve konuşma metni saklamaz.</p>
    <button className="secondary-button" disabled={!controller.available || !sessionActive}
      onClick={() => { if (sessionActive) { if (enabled) controller.stop(); else controller.start(); } }}>
      {enabled ? 'Mikrofonu kapat' : 'Mikrofonla komutları aç'}
    </button>
    {!sessionActive && <p>Sesli komutları kullanmak için önce kamerayı aç.</p>}
    {!controller.available && <p>Bu tarayıcı sesli komutları desteklemiyor. Ekrandaki düğmeler kullanılabilir.</p>}
    {message && <p role="status">{message}</p>}
  </details>;
}

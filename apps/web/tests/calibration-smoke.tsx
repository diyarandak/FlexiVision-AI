import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import type { CameraPoseObservation } from '@flexivision/contracts';
import type { LivePoseSource } from '@flexivision/application';
import { CalibrationPanel } from '../src/components/CalibrationPanel.tsx';
import { BodyProfileCard } from '../src/components/BodyProfileCard.tsx';
import { BrowserBodyProfileRepository } from '../src/adapters/bodyProfile.ts';
import { useBodyProfile } from '../src/hooks/useBodyProfile.ts';
import '../src/styles.css';
import '../src/redesign.css';

// Test namespace only. Never writes the user's real saved profile or opens a camera.
const repository = new BrowserBodyProfileRepository(() => window.localStorage, () => new Date(), 'flexivision.body-profile.smoke.v2');
let pose = 'missing', failSave = false, failStop = false, failCreate = false, failSpeech = false, analysisDelay = 0, paused = false;
function observation(time: number): CameraPoseObservation {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.1, z: 0, visibility: 0.95 }));
  for (const [i,x,y] of [[11,0.35,0.24],[12,0.65,0.24],[13,0.33,0.37],[14,0.67,0.37],[15,0.31,0.53],[16,0.69,0.53],
    [23,0.4,0.48],[24,0.6,0.48],[25,0.4,0.68],[26,0.6,0.68],[27,0.4,0.88],[28,0.6,0.88]]) {
    landmarks[i!] = {x:x!,y:y!,z:0,visibility:0.95};
  }
  return {width:1000,height:1000,frame:{timestampMs:time,people:[{landmarks,worldLandmarks:[]}]}};
}
class ScriptedSource implements LivePoseSource {
  timer: ReturnType<typeof setTimeout> | undefined;
  stopped = false;
  async start(emit: (value: CameraPoseObservation) => void, _onError: (error: Error) => void,
    onCaptureStarted?: (timestampMs: number) => void) {
    const capture = () => {
      if (this.stopped) return;
      if (paused) { this.timer = setTimeout(capture, 100); return; }
      const value = observation(performance.now());
      if (pose === 'missing') value.frame.people[0]!.landmarks[28]!.visibility = 0;
      if (pose === 'none') value.frame.people = [];
      if (pose === 'crowded') value.frame.people.push(value.frame.people[0]!);
      onCaptureStarted?.(value.frame.timestampMs);
      this.timer = setTimeout(() => {
        if (this.stopped) return;
        value.processingMs = performance.now() - value.frame.timestampMs;
        emit(value);
        if (!this.stopped) this.timer = setTimeout(capture, 100);
      }, analysisDelay);
    };
    capture();
  }
  stop() {this.stopped = true; clearTimeout(this.timer); if (failStop) throw new Error('Synthetic cleanup error');}
}
function Smoke() {
  const profile = useBodyProfile(repository);
  const [open,setOpen] = useState(false), [spoken,setSpoken] = useState('');
  return <>
    <main className="app-shell" style={{paddingTop:130}}>
      <BodyProfileCard saved={profile.saved} loading={profile.loading} error={profile.error}
        onScan={() => setOpen(true)} onClear={() => {void profile.clear();}} />
    </main>
    {createPortal(<div className="smoke-controls">
      <strong>SENTETİK TEST · Kamera/model/ses açılmaz; ayrı test profili kaydı</strong>
      <div>{[['relaxed','Rahat duruş gönder'],['missing','Ayak bileğini gizle'],['none','Kişiyi kaldır'],['crowded','İkinci kişi ekle']].map(([value,label]) =>
        <button key={value} onClick={() => {pose=value!;}}>{label}</button>)}
        <button onClick={() => {failSave=true;}}>Kaydetmeyi boz</button><button onClick={() => {failSave=false;}}>Kaydetmeyi düzelt</button>
        <button onClick={() => {failCreate=true;}}>Kamera oluşturmayı boz</button><button onClick={() => {failCreate=false;}}>Kamera oluşturmayı düzelt</button>
        <button onClick={() => {failSpeech=true;}}>Sesi boz</button><button onClick={() => {failSpeech=false;}}>Sesi düzelt</button>
        <button onClick={() => {failStop=true;}}>Kamera temizliğini boz</button><button onClick={() => {failStop=false;}}>Kamera temizliğini düzelt</button>
        <button onClick={() => {analysisDelay=2000; paused=false;}}>Yavaş analiz (2 sn/kare)</button>
        <button onClick={() => {analysisDelay=0; paused=false;}}>Normal analiz</button>
        <button onClick={() => {paused=true;}}>Kamera akışını kes</button>
        <button onClick={() => {analysisDelay=9000; paused=false;}}>Analizi takılı bırak</button>
      </div><p aria-label="Test edilen ses metni">Test edilen ses metni: {spoken || 'Yok'}</p>
    </div>,document.body)}
    {open && createPortal(<CalibrationPanel onClose={() => setOpen(false)} onSave={async value => {
      if (failSave) throw new Error('Synthetic storage failure'); await profile.save(value);
    }} createSource={() => { if (failCreate) throw new Error('Sentetik kamera oluşturma hatası'); return new ScriptedSource(); }}
      createSpeech={() => ({available:true,speak(text) { if (failSpeech) return Promise.reject(new Error('Synthetic speech failure')); setSpoken(text); },cancel:()=>{}})} />,document.body)}
  </>;
}
createRoot(document.getElementById('root')!).render(<Smoke />);

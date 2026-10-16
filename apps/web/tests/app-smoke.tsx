import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/App.tsx';
import { BrowserBodyProfileRepository } from '../src/adapters/bodyProfile.ts';
import { BrowserReferenceTemplateRepository } from '../src/adapters/referenceLibrary.ts';
import { BrowserSessionHistoryRepository } from '../src/adapters/sessionHistory.ts';
import { BrowserDemoSession } from '../src/adapters/demoSession.ts';
import type { CameraPoseObservation } from '@flexivision/contracts';
import type { LivePoseSource } from '@flexivision/application';
import { createPortal } from 'react-dom';
import '../src/styles.css';
import '../src/redesign.css';
import { acceptedTemplate } from '../../../packages/core/test/fixtures/acceptedTemplate.ts';

let failStop = false, failSave = false, failRead = new URLSearchParams(location.search).has('readError');
const testStorage = {
  getItem(key: string) { if (failRead) throw new Error('Synthetic read denial'); return localStorage.getItem(key); },
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
  removeItem: (key: string) => localStorage.removeItem(key),
};
const keys = ['flexivision.ux-smoke.body.v2', 'flexivision.ux-smoke.references.v1', 'flexivision.ux-smoke.history.v1', 'flexivision.ux-smoke.demo.v1'];
const profile = new BrowserBodyProfileRepository(() => ({ getItem: key => testStorage.getItem(key),
  setItem(key, value) { if (failSave) throw new Error('Synthetic storage denial'); localStorage.setItem(key, value); }, removeItem: key => localStorage.removeItem(key) }), () => new Date(), keys[0]);
const references = new BrowserReferenceTemplateRepository(() => testStorage, () => new Date(), () => crypto.randomUUID(), keys[1]);
const history = new BrowserSessionHistoryRepository(() => testStorage, () => new Date(), () => crypto.randomUUID(), keys[2]);
const demo = new BrowserDemoSession(() => sessionStorage, keys[3]);
class Source implements LivePoseSource {
  timer: ReturnType<typeof setInterval> | undefined;
  async start(emit: (o: CameraPoseObservation) => void, _error: (e: Error) => void, capture?: (time: number) => void) {
    this.timer = setInterval(() => {
      const time = performance.now(), landmarks = Array.from({ length: 33 }, () => ({ x: .5, y: .1, z: 0, visibility: .95 }));
      for (const [i,x,y] of [[11,.35,.24],[12,.65,.24],[23,.4,.48],[24,.6,.48],[25,.4,.68],[26,.6,.68],[27,.4,.88],[28,.6,.88]])
        landmarks[i!] = { x: x!, y: y!, z: 0, visibility: .95 };
      capture?.(time); emit({ width: 1000, height: 1000, processingMs: 0, frame: { timestampMs: time, people: [{ landmarks, worldLandmarks: [] }] } });
    },100);
  }
  stop() { clearInterval(this.timer); if (failStop) throw new Error('Synthetic cleanup failure'); }
}
const calibration = { createSource: () => new Source(), createSpeech: () => ({ available: true, speak() {}, cancel() {} }) };
function Smoke() { return <><App bodyProfileRepository={profile} referenceRepository={references} historyRepository={history} demoSession={demo} calibration={calibration} />
  {createPortal(<details style={{position:'fixed',right:5,top:5,zIndex:200,background:'#fff',border:'1px solid #c56',padding:6,fontSize:11,maxWidth:230}}><summary>SENTETİK TEST · kamera/model yok</summary>
    <button onClick={() => { failRead = false; }}>Depolama erişimini düzelt</button>
    <button onClick={() => { void Promise.all(['Sentetik İleri Adım', 'Sentetik Omuz Açış', 'Sentetik Yan Hareket'].map(name => references.save(acceptedTemplate(), name))).then(() => location.reload()); }}>Üç arama kaydı ekle</button>
    <button onClick={() => {failStop=true;}}>Temizleme hatası</button><button onClick={() => {failStop=false;}}>Temizlemeyi düzelt</button>
    <button onClick={() => {failSave=true;}}>Kayıt hatası</button><button onClick={() => {failSave=false;}}>Kaydı düzelt</button>
    <button onClick={() => { void references.save(acceptedTemplate(), 'Sentetik squat').then(() => window.location.reload()); }}>Örnek egzersiz ekle</button>
    <button onClick={() => { keys.slice(0,3).forEach(key=>localStorage.removeItem(key!)); sessionStorage.removeItem(keys[3]!); }}>Test kayıtlarını temizle</button>
    <p>Ayrı test anahtarları. Ham kamera/model/ses açılmaz.</p></details>,document.body)}</>; }
createRoot(document.getElementById('root')!).render(<StrictMode><Smoke /></StrictMode>);

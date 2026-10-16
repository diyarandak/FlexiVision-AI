import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import type {CalibrationProfile, CameraPoseObservation, JointAngles, SquatTemplate} from '@flexivision/contracts';
import type {LivePoseSource} from '@flexivision/application';
import {LiveExercisePanel} from '../src/components/LiveExercisePanel.tsx';
import {SessionHistoryPanel} from '../src/components/SessionHistoryPanel.tsx';
import {useSessionHistory} from '../src/hooks/useSessionHistory.ts';
import {BrowserSessionHistoryRepository} from '../src/adapters/sessionHistory.ts';
import '../src/styles.css';
import '../src/redesign.css';
import { BrowserVoiceCommands, type Recognition } from '../src/adapters/voiceCommands.ts';

let commandEngine: Recognition | null = null;
let commandIndex = 0;
function sendCommand(transcript: string) {
  const index = commandIndex++;
  commandEngine?.onresult?.({ resultIndex: index,
    results: Array.from({ length: index + 1 }, (_, i) => ({ isFinal: true, 0: { transcript: i === index ? transcript : '' } })) });
}
function syntheticRecognition(): Recognition {
  const engine: Recognition = { lang: '', continuous: false, interimResults: false, maxAlternatives: 1,
    onstart: null, onresult: null, onerror: null, onend: null,
    start() { commandEngine = engine; commandIndex = 0; engine.onstart?.(); },
    abort() { if (commandEngine === engine) commandEngine = null; } };
  return engine;
}

// Explicit synthetic UI fixture. No camera, model, real speech or user storage.
const template:SquatTemplate={schemaVersion:1,kind:'squat-cycle-template',qualification:'accepted',
  decision:{status:'accepted',policyVersion:'reference-v1'},policyVersion:'squat-cycles-v1',
  source:{engine:{name:'mediapipe-pose',version:'test',model:'synthetic-ui-only'},durationMs:3000,width:1000,height:1000},
  durationMs:3000,repetition:{id:1,side:'left',startMs:0,endMs:3000,bottomMs:1500,
    phases:[{phase:'descent',startMs:0,endMs:1200},{phase:'bottom',startMs:1200,endMs:1800},{phase:'ascent',startMs:1800,endMs:3000}],
    kneeRange:{min:80,max:170},hipRange:{min:80,max:170}},
  samples:Array.from({length:51},(_,i)=>{const t=i/50,knee=t<0.4?170-t/0.4*90:t>0.6?80+(t-0.6)/0.4*90:80;
    return {progress:t,offsetMs:t*3000,phase:t<0.4?'descent':t<0.6?'bottom':'ascent',
      angles2d:{leftKnee:knee,leftHip:knee,rightKnee:null,rightHip:null,leftElbow:null,rightElbow:null} as JointAngles};})};
let mode='standing';
let failSave=false;
let throwOnSourceCreation=false;
let throwOnSpeechCreation=false;
const profile:CalibrationProfile={schemaVersion:2,kind:'body-calibration',qualification:'not_evaluated',policyVersion:'body-scan-v2',
  width:1000,height:1000,torsoPixels:200,origin:{x:0.5,y:0.45},
  proportions:{shoulderWidth:0.8,hipWidth:0.4,leftThigh:0.9,rightThigh:0.9,leftShin:0.9,rightShin:0.9},
  neutralAngles:{leftKnee:175,rightKnee:175,leftHip:170,rightHip:170,leftElbow:null,rightElbow:null}};
const historyRepository=new BrowserSessionHistoryRepository(()=>({getItem:key=>localStorage.getItem(key),
  setItem(key,value){if(failSave)throw new Error('Synthetic quota error');localStorage.setItem(key,value);},
  removeItem:key=>localStorage.removeItem(key)}),()=>new Date(),()=>crypto.randomUUID(),'flexivision.sessions.smoke.v1');
class ScriptedLiveSource implements LivePoseSource {
  timer:ReturnType<typeof setInterval>|undefined;
  async start(emit:(o:CameraPoseObservation)=>void) {
    let i=0;
    const cycle=[170,170,170,150,130,110,80,80,80,80,100,130,160,170,170,170];
    this.timer=setInterval(()=>{
      const knee=mode==='cycle'?cycle[i++%cycle.length]!:170,rad=knee*Math.PI/180;
      const landmarks=Array.from({length:33},()=>({x:0.5,y:0.1,z:0,visibility:0.95}));
      landmarks[23]={x:0.5,y:0.45,z:0,visibility:0.95}; landmarks[24]={x:0.52,y:0.45,z:0,visibility:0.95};
      landmarks[25]={x:0.5,y:0.65,z:0,visibility:0.95};
      landmarks[27]={x:0.5-Math.sin(Math.PI-rad)*0.2,y:0.65+Math.cos(Math.PI-rad)*0.2,z:0,visibility:0.95};
      landmarks[11]={x:0.5-Math.sin(rad)*0.2,y:0.45+Math.cos(rad)*0.2,z:0,visibility:0.95};
      landmarks[12]={...landmarks[11]!,x:landmarks[11]!.x+0.02};
      if(mode==='front')landmarks[12]!.x+=.4;
      if(mode==='ankles')landmarks[27]!.visibility=0;
      emit({width:1000,height:1000,processingMs:mode==='slow'?1900:20,
        frame:{timestampMs:performance.now(),people:mode==='missing'?[]:[{landmarks,worldLandmarks:[]}]}});
    },100);
  }
  stop(){clearInterval(this.timer);}
}
function Smoke(){
  const [open,setOpen]=useState(false);
  const [voices,setVoices]=useState<string[]>([]),[selectedCamera,setSelectedCamera]=useState('');
  const history=useSessionHistory(historyRepository);
  return <><main className="app-shell"><h1>SENTETİK CANLI UI TESTİ</h1><p>Kamera/model/ses açılmaz; gerçek egzersiz değildir.</p>
    <label><input type="checkbox" onChange={event=>{throwOnSourceCreation=event.target.checked;}} /> Kamera kurulum hatasını canlandır</label>
    <label><input type="checkbox" onChange={event=>{throwOnSpeechCreation=event.target.checked;}} /> Ses kurulum hatasını canlandır</label>
    <button onClick={()=>setOpen(true)}>Test oturumunu aç</button>
    <SessionHistoryPanel records={history.records} loading={history.loading} error={history.error}
      onRemove={id=>{void history.remove(id);}} onClear={()=>{void history.clear();}} /></main>
    {createPortal(<details className="smoke-controls" style={{position:'fixed',zIndex:300,bottom:4,left:4,maxWidth:360,background:'#fff',padding:6,border:'2px solid #a63f23',fontSize:12}}>
      <summary>Sentetik test kontrolleri</summary><strong>Kamera/model/ses açılmaz</strong>
      <button onClick={()=>{mode='missing';}}>Takibi kaybet</button><button onClick={()=>{mode='cycle';}}>Döngüyü gönder</button>
      <button onClick={()=>{mode='standing';}}>Ayakta dur</button><button onClick={()=>{mode='front';}}>Önden görünüm</button>
      <button onClick={()=>{mode='ankles';}}>Ayak bileği eksik</button><button onClick={()=>{mode='slow';}}>Yavaş ölçüm</button>
      <button onClick={()=>{failSave=true;}}>Kayıt hatası</button><button onClick={()=>{failSave=false;}}>Kaydı düzelt</button>
      <button onClick={()=>sendCommand('sesi kapat')}>Sentetik ses: sesi kapat</button>
      <button onClick={()=>sendCommand('sesi aç')}>Sentetik ses: sesi aç</button>
      <button onClick={()=>sendCommand('bitir')}>Sentetik ses: bitir</button>
      <p>Seçilen kaynak: {selectedCamera}</p><p data-testid="voice-log">Ses metinleri: {voices.join(' | ')}</p>
    </details>,document.body)}
    {open&&createPortal(<LiveExercisePanel template={template} onClose={()=>setOpen(false)} createSource={(_video,options)=>{
      if (throwOnSourceCreation) throw new Error('Sentetik kamera kurulumu başarısız.');
      setSelectedCamera(`${options.facingMode} / ${options.maxDimension}`);return new ScriptedLiveSource();}}
      bodyProfile={profile} onSave={history.save}
      createVoiceCommands={(command,state)=>new BrowserVoiceCommands(command,state,syntheticRecognition,()=>false,()=>document.hidden)}
      createSpeech={()=>{ if (throwOnSpeechCreation) throw new Error('Sentetik ses kurulumu başarısız.');
        return {available:true,speak(text,onStarted){setVoices(current=>[...current,text].slice(-20));onStarted?.();},cancel(){}}; }}/>,document.body)}</>;
}
createRoot(document.getElementById('root')!).render(<Smoke/>);

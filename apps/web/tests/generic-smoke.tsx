import { LastAttemptReport } from '../src/components/LastAttemptReport.tsx';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import type { CameraPoseObservation, GenericSessionRecord } from '@flexivision/contracts';
import type { LivePoseSource } from '@flexivision/application';
import { genericAcceptedTemplate, genericCycle, genericObservation } from '../../../packages/core/test/fixtures/genericTemplate.ts';
import { GenericLiveExercisePanel } from '../src/components/GenericLiveExercisePanel.tsx';
import { BrowserVoiceCommands, type Recognition } from '../src/adapters/voiceCommands.ts';
import type { CreateVoiceCommands } from '../src/components/VoiceCommandControls.tsx';
import '../src/styles.css';
import '../src/redesign.css';

const template = genericAcceptedTemplate();
let correctionSequence = false;
let slowStartup = false;
let landscapeSource = false;
let missingBody = false;
let ambiguousBody = false;
let holdReference = false;
let holdStart = false;
let delayedSpeech = false;
let returnDifference = false;
let throwOnSourceCreation = false;
let throwOnSpeechCreation = false;
let recoverySequence = false;
let teachingSequence = false;
let voiceQuestionSequence = false;
const syntheticCommands: CreateVoiceCommands = (onCommand, onState) => new BrowserVoiceCommands(onCommand, onState, () => {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const recognition: Recognition = { lang:'',continuous:false,interimResults:false,maxAlternatives:1,
    onstart:null,onresult:null,onerror:null,onend:null,
    start() {
      recognition.onstart?.();
      const questions: [number,string][] = [[7000,'Şimdi ne yapacağım'],[10000,'Doğru yapıyor muyum'],
        [14000,'Kaç tekrar yaptım'],[17000,'Hareketi göster'],[25000,'Doğru yapıyor muyum'],[33000,'Beni duyuyor musun'],[36000,'Bitir']];
      for(const [time,text] of questions) timers.push(setTimeout(()=>recognition.onresult?.({resultIndex:0,results:[{isFinal:true,0:{transcript:text}}]}),time));
    },abort(){timers.forEach(clearTimeout);},
  };
  // Each question is a distinct final result, as in a real continuous recognition session.
  let index = 0;
  const originalStart = recognition.start;
  recognition.start = () => {
    const result = recognition.onresult;
    recognition.onresult = event => {
      const currentIndex = index++;
      result?.({resultIndex:currentIndex,results:Array.from({length:currentIndex+1},()=>event.results[0]!)});
    };
    originalStart();
  };
  return recognition;
}, () => false, () => document.hidden);
function syntheticSource(video: HTMLVideoElement, landscape: boolean, onStartup?: (stage: import('../src/adapters/browserCameraPose.ts').CameraStartupStage) => void): LivePoseSource {
  const values = genericCycle();
  const canvas = document.createElement('canvas');
  canvas.width = landscape ? 1280 : 720;
  canvas.height = landscape ? 720 : 1280;
  const context = canvas.getContext('2d')!;
  const paint = () => {
    context.fillStyle = '#50685e'; context.fillRect(0,0,canvas.width,canvas.height);
    context.strokeStyle = '#9bbbad'; context.lineWidth = 2;
    for(let x=0;x<canvas.width;x+=80){context.beginPath();context.moveTo(x,0);context.lineTo(x,canvas.height);context.stroke();}
    for(let y=0;y<canvas.height;y+=80){context.beginPath();context.moveTo(0,y);context.lineTo(canvas.width,y);context.stroke();}
    context.fillStyle='#eef7ee';context.font='24px sans-serif';context.textAlign='center';
    context.fillText('SENTETİK VİDEO · KAMERA DEĞİL',canvas.width/2,canvas.height*.32);
    context.strokeStyle='#f9d27c';context.lineWidth=10;context.strokeRect(5,5,canvas.width-10,canvas.height-10);
  };
  let stream: MediaStream | null = null;
  let timer:ReturnType<typeof setTimeout>|null=null, stopped=false;
  return { async start(onObservation:(value:CameraPoseObservation)=>void,onError: (error:Error)=>void,onCaptureStarted?: (time:number)=>void){
    stream = canvas.captureStream(10); video.srcObject = stream; paint();
    await video.play();
    if (stopped) { stream.getTracks().forEach(track=>track.stop()); video.srcObject=null; return; }
    let index=0; const startedAt=performance.now();
    const tick=()=>{if(stopped)return;
      try {const now=performance.now();onCaptureStarted?.(now);
        const elapsed=now-startedAt;
        const teachingValue = elapsed < 3500 ? .75 : values[Math.floor((elapsed - 3500) / 250) % values.length]!;
        const correctionValue = elapsed < 3000 ? 0 : elapsed < 19000 ? .3 : elapsed < 22000
          ? .3+.7*(elapsed-19000)/3000 : elapsed < 25000 ? 1-(elapsed-22000)/3000 : 0;
        const reading=genericObservation(holdStart ? 0 : holdReference ? .75 : correctionSequence ? correctionValue : teachingSequence ? teachingValue : recoverySequence && elapsed>=14000 ? 0 : values[Math.min(index,values.length-1)]!,now);
        // Keep the original body's pixel proportions when the sensor shape changes.
        reading.width=canvas.width;reading.height=canvas.height;
        for(const point of reading.frame.people[0]!.landmarks) point.x=.5+(point.x-.5)*(720/1280)/(canvas.width/canvas.height);
        if(correctionSequence && elapsed >= 3500 && elapsed < 16000)
          for(const joint of template.motionIndices.slice(0,-1)) reading.frame.people[0]!.landmarks[joint]!.x+=.2;
        if(returnDifference && elapsed >= 8300 && elapsed < 13200) reading.frame.people[0]!.landmarks[14]!.y+=.08;
        if(missingBody) reading.frame.people[0]!.landmarks.forEach(point=>{point.visibility=0;});
        if(ambiguousBody) reading.frame.people.push(structuredClone(reading.frame.people[0]!));
        if(recoverySequence && elapsed>=4000 && elapsed<14000) reading.frame.people[0]!.landmarks.forEach(point=>{point.visibility=0;});
        if(recoverySequence && elapsed>=18000 && elapsed<27000) reading.frame.people=[];
        if(teachingSequence && !correctionSequence && elapsed >= 24000 && elapsed < 29000) reading.frame.people=[];
        paint();
        onObservation({...reading,processingMs:5});index++;
        timer=setTimeout(tick,180); // Keep sending fresh standing frames during layout checks.
      }catch(error){onError(error instanceof Error?error:new Error('Sentetik test ölçümü hata verdi.'));}
    };onStartup?.('loading_model');timer=setTimeout(tick,slowStartup ? 8000 : 30);
  },stop(){stopped=true;if(timer!==null)clearTimeout(timer);stream?.getTracks().forEach(track=>track.stop());video.pause();video.srcObject=null;} };
}
function Smoke(){const [open,setOpen]=useState(false),[saved,setSaved]=useState(0),[voiceLog,setVoiceLog]=useState<string[]>([]),[voiceEvents,setVoiceEvents]=useState<string[]>([]);
  return <main className="app-shell"><h1>SENTETİK SERBEST HAREKET TESTİ</h1><p>Kamera, mikrofon, model veya kullanıcı depolaması kullanılmaz.</p>
    <LastAttemptReport storageKey="flexivision.smoke.report"/><p data-testid="saved-count">Geçmiş kaydetme çağrısı: {saved}</p>
    <section aria-label="Sentetik ses günlüğü"><h2>Sentetik ses günlüğü</h2>
      <ol data-testid="voice-log">{voiceLog.map((text,index)=><li key={index}>{text}</li>)}</ol></section>
    <ol data-testid="voice-events">{voiceEvents.map((text,index)=><li key={index}>{text}</li>)}</ol>
    <label><input type="checkbox" onChange={event => { delayedSpeech = event.target.checked; }} /> Gecikmeli ses başlangıcı ve tamamlanma günlüğü</label>
    <label><input type="checkbox" onChange={event => { returnDifference = event.target.checked; teachingSequence = event.target.checked; }} /> Dönüşte dirsek farkını canlandır</label>
    <label><input type="checkbox" onChange={event => { correctionSequence = event.target.checked; teachingSequence = event.target.checked; }} /> Kalıcı dirsek farkı, düzeltme ve rapor</label>
    <label><input type="checkbox" onChange={event => { slowStartup = event.target.checked; teachingSequence = event.target.checked; }} /> Model hazırlığını 8 saniye beklet</label>
    <label><input type="checkbox" onChange={event => { teachingSequence = event.target.checked; }} /> Öğretici akış: tekrarlar, süreli ses ve kadraj kaybı</label>
    <label><input type="checkbox" onChange={event => { voiceQuestionSequence = event.target.checked; teachingSequence = event.target.checked; }} /> Sesli soruları canlandır (mikrofon kullanılmaz)</label>
    <label><input type="checkbox" onChange={event => { recoverySequence = event.target.checked; }} /> Başladıktan sonra iki kez takip kaybı ve toparlanma</label>
    <label><input type="checkbox" onChange={event => { throwOnSourceCreation = event.target.checked; }} /> Kamera kurulum hatasını canlandır</label>
    <label><input type="checkbox" onChange={event => { throwOnSpeechCreation = event.target.checked; }} /> Ses kurulum hatasını canlandır</label>
    <label><input type="checkbox" onChange={event => { landscapeSource = event.target.checked; }} /> Yatay kamera görüntüsünü canlandır</label>
    <label><input type="checkbox" onChange={event => { missingBody = event.target.checked; }} /> Vücut görünmüyor</label>
    <label><input type="checkbox" onChange={event => { ambiguousBody = event.target.checked; }} /> Birden çok poz adayı</label>
    <label><input type="checkbox" onChange={event => { holdReference = event.target.checked; }} /> Başlangıç duruşu farklı</label>
    <label><input type="checkbox" onChange={event => { holdStart = event.target.checked; }} /> Başlangıç hazır ama hareket etmiyor</label>
    <button className="primary-button" onClick={()=>setOpen(true)}>Canlı serbest hareket ekranını aç</button>
    {open&&createPortal(<GenericLiveExercisePanel createVoiceCommands={voiceQuestionSequence ? syntheticCommands : undefined} reportStorageKey="flexivision.smoke.report" template={template} onClose={()=>setOpen(false)} createSource={(video,options,onStartup)=>{
      if (throwOnSourceCreation) throw new Error('Sentetik kamera kurulumu başarısız.');
      return syntheticSource(video, landscapeSource && options.facingMode === 'user', onStartup);
    }}
      createSpeech={()=>{ if (throwOnSpeechCreation) throw new Error('Sentetik ses kurulumu başarısız.');
        let finish: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined, startTimer: ReturnType<typeof setTimeout> | undefined;
        let pendingText: string | null = null;
        return {available:recoverySequence || teachingSequence || holdReference || holdStart,speak(text,onStarted){
          setVoiceLog(previous=>[...previous,text]);
          const begin=()=>{onStarted?.();if(delayedSpeech)setVoiceEvents(previous=>[...previous,`Başladı: ${text}`]);};
          if(delayedSpeech)startTimer=setTimeout(begin,180);else begin();
          if(teachingSequence || delayedSpeech) return new Promise<void>(resolve=>{
            pendingText=text;finish=resolve;timer=setTimeout(()=>{
              if(delayedSpeech)setVoiceEvents(previous=>[...previous,`Bitti: ${text}`]);
              pendingText=null;resolve();
            },1800);
          });
        },cancel(){
          if(delayedSpeech && pendingText)setVoiceEvents(previous=>[...previous,`İptal: ${pendingText}`]);
          pendingText=null;clearTimeout(startTimer);clearTimeout(timer);finish?.();
        }}; }}
      onSave={async (summary,reference,endReason):Promise<GenericSessionRecord>=>{
        setSaved(previous=>previous+1);
        return {schemaVersion:2,id:'synthetic',savedAt:new Date().toISOString(),exercise:'generic-cycle',
          reference,endReason,summary};
      }} />,document.body)}</main>;
}
createRoot(document.getElementById('root')!).render(<Smoke/>);

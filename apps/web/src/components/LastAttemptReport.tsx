import { useEffect,useState } from 'react';
import { ATTEMPT_REPORT_EVENT,clearAttemptReport,readAttemptReport } from '../adapters/attemptReport.ts';
import { AggregateReportDownload } from './AggregateReportDownload.tsx';
export function LastAttemptReport({storageKey}:{storageKey?:string}={}){
  const [text,setText]=useState<string|null>(null),[error,setError]=useState('');
  useEffect(()=>{const read=()=>{try{setText(readAttemptReport(undefined,storageKey));setError('');}catch{setText(null);setError('Kaydedilen deneme raporu okunamadı.');}};read();window.addEventListener(ATTEMPT_REPORT_EVENT,read);return()=>window.removeEventListener(ATTEMPT_REPORT_EVENT,read);},[storageKey]);
  if(!text&&!error)return null;
  return <aside className="attempt-report-card"><h3>Son kaydedilen deneme raporu</h3>
    <p>Hareket başlayamasa da serbest hareket denemesinin nedenleri burada kalır. Yeni rapor cihazda saklanamazsa önceki rapor korunur; tarihini dosyanın başında kontrol et.</p>
    {text&&<><AggregateReportDownload text={text} filename="flexivision-son-deneme.txt"/><details><summary>Raporu oku</summary><pre className="attempt-report-text">{text.split('TEKNİK İNCELEME VERİSİ')[0]}</pre></details></>}
    <button className="text-button" onClick={()=>{try{clearAttemptReport(undefined,storageKey);setText(null);setError('');}catch{setError('Rapor silinemedi.');}}}>Deneme raporunu sil</button>
    {error&&<p role="alert">{error}</p>}</aside>;
}

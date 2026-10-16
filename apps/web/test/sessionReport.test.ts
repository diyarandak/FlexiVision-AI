import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CameraPoseObservation, GenericSessionSummary, LiveSessionSummary } from '@flexivision/contracts';
import { TrackLiveGenericSession } from '@flexivision/application';
import { genericSessionReview, genericSessionSummaryData } from '@flexivision/core';
import { genericAcceptedTemplate,genericObservation,genericCycle } from '../../../packages/core/test/fixtures/genericTemplate.ts';
import { staticSummary } from '../../../packages/core/test/fixtures/staticTemplate.ts';
import { genericReportText,genericReportConclusion,genericReportFindings } from '../src/genericSessionReport.ts';
import { squatReportConclusion,staticReportConclusion,staticReportText } from '../src/aggregateSessionReport.ts';
import { GenericSessionSummaryView } from '../src/components/GenericSessionSummaryView.tsx';
import { BrowserSessionHistoryRepository } from '../src/adapters/sessionHistory.ts';
import { saveAttemptReport,readAttemptReport,clearAttemptReport } from '../src/adapters/attemptReport.ts';

async function fixture(){
  let emit!:(o:CameraPoseObservation)=>void;
  const session=new TrackLiveGenericSession({async start(fn){emit=fn;},stop(){}},genericAcceptedTemplate());
  await session.start(()=>{},e=>{throw e;});return {session,emit};
}
function storage(){const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};}

test('simple report targets the dominant setup problem instead of always asking for more body visibility',async()=>{
  const {session,emit}=await fixture();
  for(let time=0;time<2000;time+=200)emit({...genericObservation(0,time),processingMs:600});
  const summary=session.getSummary();
  assert.match(genericSessionReview(summary).next,/zamanında işleyemedi.*Hafif/);
  for(const [reason,pattern] of [
    ['camera_view',/çekim açısını eşleştir/],['find_start',/başlangıç eşleşmedi/],['multiple_people',/çizgileri net ayrılamadı/],
  ] as const){
    const changed={...summary,diagnostics:{...summary.diagnostics!,unknownReasons:{[reason]:summary.unmeasuredFrames}}};
    assert.match(genericSessionReview(changed).next,pattern);
  }
  const {diagnostics: _diagnostics, ...legacy} = summary;
  assert.doesNotMatch(genericSessionReview(legacy).next,/zamanında işleyemedi/);
});

test('a partial workout report shows measured sets and does not claim the target is complete', () => {
  const summary:GenericSessionSummary = {durationMs:10000,repetitionCount:6,sampledFrames:100,trackedFrames:90,
    unmeasuredFrames:10,cueCandidatesCount:0,spokenCuesCount:0,bodyProfileUsed:false,repetitionGoal:{sets:2,repetitionsPerSet:5}};
  const text=genericReportText(summary);
  assert.match(text,/Hedef: 2 set × 5 tekrar/);assert.match(text,/1\/2 set · 6\/10 tekrar/);
  assert.match(text,/Hedef tamamlandı: Hayır/);
  const html=renderToStaticMarkup(createElement(GenericSessionSummaryView,{summary}));
  assert.match(html,/Hedefe kalan tekrarlar var/);
  const completed={...summary,repetitionCount:10};
  assert.match(genericReportText(completed),/Hedef tamamlandı: Evet/);
  assert.match(renderToStaticMarkup(createElement(GenericSessionSummaryView,{summary:completed})),/Hedef tamamlandı/);
});

test('unknown-only attempt explains missing joints and setup without declaring wrong movement',async()=>{
  const {session,emit}=await fixture();
  emit({frame:{timestampMs:1000,people:[]},width:720,height:1280});
  const unseen=genericObservation(0,1200);unseen.frame.people[0]!.landmarks[11]!.visibility=0;emit(unseen);
  const summary=session.getSummary(2000),d=summary.diagnostics!;
  assert.equal(summary.trackedFrames,0);assert.equal(summary.durationMs,0);
  assert.equal(d.elapsedMs,1000);assert.equal(d.measuredStart,false);assert.equal(d.timeToStartMs,null);
  assert.deepEqual(d.unknownReasons,{no_person:1,body_not_visible:1});assert.equal(d.missingJointFrames[11],1);
  assert.equal(genericReportConclusion(summary).title,'Hareket değerlendirilemedi');
  const text=genericReportText(summary);assert.match(text,/Sol omuz: 1 kare/);assert.match(text,/Başlangıç bulunamadı/);
  assert.match(renderToStaticMarkup(createElement(GenericSessionSummaryView,{summary})),/Raporu indir/);
  const history=new BrowserSessionHistoryRepository(()=>storage());
  await assert.rejects(history.saveGeneric(summary,{repetitionId:1,policyVersion:'generic-cycles-v1'},'finished'));
});

test('diagnostic differences are counted even before the first spoken correction and snapshots do not mutate',async()=>{
  const {session,emit}=await fixture();
  emit(genericObservation(0,1000));emit(genericObservation(0,1200));
  const template=genericAcceptedTemplate(),changed=genericObservation(.3,1400);
  for(const i of template.motionIndices.slice(0,-1))changed.frame.people[0]!.landmarks[i]!.x+=.2;
  changed.processingMs=35;emit(changed);
  const summary=session.getSummary(),d=summary.diagnostics!;
  assert.equal(d.incorrectFrames,1);assert.equal(d.errorCodes.motion_path,1);assert.ok(Object.keys(d.deviatingJointFrames).length>0);
  assert.equal(summary.spokenCuesCount,0);assert.match(genericReportConclusion(summary).title,/farklar/);
  assert.deepEqual(d.processing,{samples:1,meanMs:35,maxMs:35});
  assert.equal(d.correctFrames+ d.incorrectFrames,summary.trackedFrames);
  emit({...genericObservation(0,1600),processingMs:700});
  assert.equal(d.unknownReasons.processing_slow,undefined);
  assert.equal(session.getSummary().diagnostics!.unknownReasons.processing_slow,1);
  session.stop();emit(genericObservation(0,1800));assert.equal(session.getSummary().sampledFrames,4);
});

test('multiple pose candidates prompt a framing check without claiming a second person',async()=>{
  const {session,emit}=await fixture();
  const two=genericObservation(0,1200);
  two.frame.people.push(structuredClone(two.frame.people[0]!));
  emit(two);
  const summary=session.getSummary(),findings=genericReportFindings(summary);
  assert.equal(summary.diagnostics?.poseCandidates.multiple,1);
  assert.match(findings.next,/gövden ve hareket eden uzuvların bütünü kadrajda kalsın/);
  assert.match(findings.next,/gerçek kişi sayısı değildir/);
  assert.doesNotMatch(findings.next,/kadrajda tek kişi olsun/);
});

test('measured matching cycles and legacy records get different conclusions; absence of sound is never the verdict',async()=>{
  const {session,emit}=await fixture();genericCycle().forEach((v,i)=>emit(genericObservation(v,1000+i*180)));
  const summary=session.getSummary();assert.equal(summary.repetitionCount,1);
  assert.match(genericReportConclusion(summary).title,/Ölçülen bölümlerde/);
  assert.ok(summary.diagnostics!.postStartPhaseFrames!.return>0);
  assert.match(genericReportText(summary),/BAŞLANGIÇ SONRASI İZLEME/);
  const {diagnostics,...legacy}=summary;assert.ok(diagnostics);
  assert.match(genericReportConclusion(legacy).title,/eski kayıtta/);
  assert.match(genericReportConclusion({...legacy,sampledFrames:0,trackedFrames:0,unmeasuredFrames:0,repetitionCount:0}).title,/ölçümü alınamadı/);
});

test('history preserves bounded diagnostics, drops malformed optional data and strips private attachments',async()=>{
  const {session,emit}=await fixture();genericCycle().forEach((v,i)=>emit(genericObservation(v,1000+i*180)));
  const s=session.getSummary();const memory=storage(),repo=new BrowserSessionHistoryRepository(()=>memory);
  const added=Object.assign(s.diagnostics!,{landmarks:'PRIVATE',video:'PRIVATE'});
  const record=await repo.saveGeneric({...s,diagnostics:added},{repetitionId:1,policyVersion:'generic-cycles-v1'},'finished');
  const restored=(await new BrowserSessionHistoryRepository(()=>memory).list())[0]!;
  assert.deepEqual(restored,record);assert.equal(JSON.stringify(record).includes('PRIVATE'),false);
  for(const value of [{...added,correctFrames:NaN},{...added,unknownReasons:{nonsense:2}}, {...added,missingJointFrames:{99:1}}, {...added,processing:{samples:1,meanMs:50,maxMs:20}}]){
    const sanitized=genericSessionSummaryData({...s,diagnostics:value} as GenericSessionSummary);
    assert.equal(sanitized.diagnostics,undefined);assert.equal(sanitized.repetitionCount,1);
  }
  const badPostStart=genericSessionSummaryData({...s,diagnostics:{...added,postStartUnknownReasons:{no_person:9999}}} as GenericSessionSummary);
  assert.ok(badPostStart.diagnostics);
  assert.equal(badPostStart.diagnostics.postStartUnknownReasons,undefined);
});

test('last failed attempt can be retrieved after close, quota failures stay explicit, download text excludes raw pose',async()=>{
  const {session}=await fixture(),memory=storage();
  const text=genericReportText(Object.assign(session.getSummary(),{video:'PRIVATE',landmarks:'PRIVATE'}),{
    createdAt:'2026-10-12T00:00:00Z',endReason:'interrupted',attemptMs:2200,build:'test',
    camera:{width:1280,height:720,facing:'user',portraitRequested:true,fill:false,mirrored:true,analysisMaxDimension:640},
    viewport:{width:390,height:740},browser:'Android · Chrome',lastMessage:'Kamera bekleniyor',technicalError:'Kamera izni verilmedi.',speechError:'',
    voice:{setupStarted:3,recoveryStarted:2,referenceStarted:1,startStarted:1,nearStarted:1,returnStarted:1,completedStarted:1,failures:1,lastFailureCode:'start_timeout'},
  },genericAcceptedTemplate());
  assert.match(text,/Teknik kesinti: Kamera izni/);assert.match(text,/1280 × 720/);assert.equal(text.includes('PRIVATE'),false);
  assert.match(text,/Egzersiz düzeltme adayı: 0/);
  assert.match(text,/Başlayan yerleşim yönlendirmesi: 3 · İlk başlangıçtan sonra: 2/);
  assert.match(text,/Başlayan referans duruşu sesi: 1/);
  assert.match(text,/Başlayan hareket başlangıcı sesi: 1/);
  assert.match(text,/Başlayan yakın hareket bildirimi: 1/);
  assert.match(text,/Başlayan dönüş yönlendirmesi: 1/);
  assert.match(text,/Başlayan tam tekrar bildirimi: 1/);
  assert.match(text,/Ses hata olayı: 1 · Son hata kodu: start_timeout/);
  assert.match(genericReportText(session.getSummary()),/ses sayısı bu kayıtta ölçülmedi/);
  assert.equal(saveAttemptReport(text,memory),true);assert.equal(readAttemptReport(memory),text);
  const nextAttempt=text.replace('2026-10-12T00:00:00Z','2026-10-12T01:00:00Z');
  assert.equal(saveAttemptReport(nextAttempt,{...memory,setItem(){throw Error('quota');}}),false);
  assert.notEqual(nextAttempt,text);
  assert.equal(readAttemptReport(memory),text);clearAttemptReport(memory);assert.equal(readAttemptReport(memory),null);
});

test('squat and static summaries distinguish no data, partial match, differences and limited success',()=>{
  const s:LiveSessionSummary={durationMs:1000,repetitionCount:0,sampledFrames:5,trackedFrames:0,lostFrames:5,cleanRepetitions:0,spokenCues:[],cueCandidatesCount:0,errorBreakdown:{},trackedMs:0,unmeasuredMs:1000,bodyProfileUsed:false,deviations:{knee:{samples:0,mean:null,max:null},hip:{samples:0,mean:null,max:null}}};
  assert.match(squatReportConclusion(s).title,/değerlendirilemedi/);
  assert.match(squatReportConclusion({...s,trackedFrames:5,lostFrames:0}).title,/Tam bir tekrar/);
  assert.match(squatReportConclusion({...s,trackedFrames:5,errorBreakdown:{insufficient_depth:2}}).title,/farklar/);
  assert.match(staticReportConclusion({...staticSummary(),sampledFrames:0,trackedFrames:0,unmeasuredFrames:0,matchedMs:0,targetReached:false}).title,/ölçümü alınamadı/);
  const partial={...staticSummary(),matchedMs:2000,targetMs:10000,targetReached:false};
  assert.match(staticReportConclusion(partial).title,/hedef tamamlanmadı/);assert.match(staticReportText(partial),/tek başına yanlış/);
});

test('zero frames with diagnostics directs to startup troubleshooting, never exercise technique',async()=>{
  const {session}=await fixture();
  const summary=session.getSummary();
  assert.equal(summary.sampledFrames,0);
  assert.match(genericReportFindings(summary).next,/analizi başlamamış/);
  assert.doesNotMatch(genericReportFindings(summary).next,/Hareketini kendi hızında/);
});

test('sustained correction evidence survives history and becomes a short actionable review without raw data',async()=>{
  const {session,emit}=await fixture();
  emit(genericObservation(0,1000));emit(genericObservation(0,1200));
  for(let time=1400;time<=12000;time+=200){
    const reading=genericObservation(.3,time);
    for(const index of genericAcceptedTemplate().motionIndices.slice(0,-1)) reading.frame.people[0]!.landmarks[index]!.x+=.2;
    emit(reading);
  }
  const summary=session.getSummary();
  const evidence=summary.diagnostics!.corrections!;
  assert.ok(evidence.some(f=>f.jointIndex===14 && f.action==='extend' && f.longestMs>=1500));
  assert.equal(evidence.reduce((sum,f)=>sum+f.frames,0),summary.diagnostics!.incorrectFrames);
  const frozen=structuredClone(evidence);
  const unseen=genericObservation(.3,12200);unseen.frame.people=[];emit(unseen);
  assert.deepEqual(evidence,frozen);
  const memory=storage(),repo=new BrowserSessionHistoryRepository(()=>memory);
  await repo.saveGeneric(summary,{repetitionId:1,policyVersion:'generic-cycles-v1'},'finished');
  const saved=(await repo.list())[0]!;assert.equal(saved.exercise,'generic-cycle');
  if(saved.exercise!=='generic-cycle')return;
  assert.deepEqual(saved.summary.diagnostics?.corrections,evidence);
  const text=genericReportText(saved.summary);
  assert.match(text,/Gidişte sağ dirsek referansa göre daha bükülü kaldı/);
  assert.match(text,/Sağ dirseğini biraz daha aç/);
  assert.match(text,/SONRAKİ DENEME/);
  assert.doesNotMatch(text,/20 derece|%100 doğru/);
  const html=renderToStaticMarkup(createElement(GenericSessionSummaryView,{summary:saved.summary}));
  assert.match(html,/Kısa raporu indir/);assert.match(html,/Geliştirilecekler/);
  assert.match(html,/<details class="review-technical"><summary>Teknik ayrıntılar/);
});

test('malformed correction aggregates are dropped independently and brief observations do not become confident advice',async()=>{
  const {session,emit}=await fixture();emit(genericObservation(0,1000));emit(genericObservation(0,1200));
  const shifted=genericObservation(.3,1400);
  for(const index of genericAcceptedTemplate().motionIndices.slice(0,-1))shifted.frame.people[0]!.landmarks[index]!.x+=.2;
  emit(shifted);const s=session.getSummary();
  assert.doesNotMatch(genericReportText(s).split('AYRINTILI İNCELEME')[0]!,/biraz daha aç/);
  for(const corrections of [
    [{jointIndex:0,action:'bend',phase:'outbound',frames:1,longestMs:0,spokenCount:0}],
    [{jointIndex:14,action:'extend',phase:'outbound',frames:999,longestMs:0,spokenCount:0}],
    [{jointIndex:14,action:'extend',phase:'outbound',frames:1,longestMs:99999,spokenCount:0}],
    [{jointIndex:14,action:'invented',phase:'outbound',frames:1,longestMs:0,spokenCount:0}],
  ]){
    const result=genericSessionSummaryData({...s,diagnostics:{...s.diagnostics!,corrections} as NonNullable<GenericSessionSummary['diagnostics']>});
    assert.ok(result.diagnostics);assert.equal(result.diagnostics.corrections,undefined);
  }
  const valid=s.diagnostics!.corrections![0]!;
  const stripped=genericSessionSummaryData({...s,diagnostics:{...s.diagnostics!,corrections:[Object.assign({...valid},{video:'PRIVATE'})]}});
  assert.equal(JSON.stringify(stripped).includes('PRIVATE'),false);
});

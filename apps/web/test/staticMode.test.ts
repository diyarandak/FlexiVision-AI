import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { staticMap, staticTemplate, staticSummary } from '../../../packages/core/test/fixtures/staticTemplate.ts';
import { acceptedTemplate } from '../../../packages/core/test/fixtures/acceptedTemplate.ts';
import { BrowserReferenceTemplateRepository } from '../src/adapters/referenceLibrary.ts';
import { BrowserSessionHistoryRepository } from '../src/adapters/sessionHistory.ts';
import { MotionResults } from '../src/components/MotionResults.tsx';
import { StaticSessionSummaryView } from '../src/components/StaticSessionSummaryView.tsx';
import { StaticLiveExercisePanel } from '../src/components/StaticLiveExercisePanel.tsx';
import { libraryView } from '../src/libraryView.ts';

function fixture(){
  const data=new Map<string,string>();let id=0;
  const storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};
  const now=()=>new Date('2026-10-11T10:00:00Z'),makeId=()=>`static-${++id}`;
  return {data,storage,library:new BrowserReferenceTemplateRepository(()=>storage,now,makeId),history:new BrowserSessionHistoryRepository(()=>storage,now,makeId)};
}
test('static library survives reload, mixes with squat, filters independently and excludes attachments',async()=>{
  const f=fixture(),template=staticTemplate();Object.assign(template,{video:'private-video'});Object.assign(template.landmarks[11]!,{secret:'private-landmark'});
  const saved=await f.library.save(template,'Duruşum');await f.library.save(acceptedTemplate(),'Squat');
  const restored=await new BrowserReferenceTemplateRepository(()=>f.storage).list();
  assert.deepEqual(libraryView(restored,'','static','recent'),[saved]);
  assert.equal(libraryView(restored,'','free','recent').length,0);
  assert.equal(libraryView(restored,'','squat','recent').length,1);
  assert.equal([...f.data.values()].join('').includes('private'),false);
});
test('static history roundtrip retains durations and strips raw data; invalid summaries never overwrite history',async()=>{
  const f=fixture();const summary=Object.assign(staticSummary(),{video:'private'});
  const record=await f.history.saveStatic(summary,{intervalId:1,policyVersion:'static-pose-v1'},'finished');
  assert.deepEqual(await new BrowserSessionHistoryRepository(()=>f.storage).list(),[record]);
  assert.equal([...f.data.values()].join('').includes('private'),false);
  await assert.rejects(f.history.saveStatic({...summary,matchedMs:10000},{intervalId:1,policyVersion:'static-pose-v1'},'finished'));
  assert.deepEqual(await f.history.list(),[record]);
});
test('static result UI explains hold selection and independent duration without repeat rejection',()=>{
  const html=renderToStaticMarkup(createElement(MotionResults,{mode:'static',map:staticMap(),onPreview(){},onStartLive(){},async onSaveTemplate(){throw Error('unused');}}));
  assert.match(html,/Sabit duruş referansı hazır/);assert.match(html,/Referans aralığı/);assert.match(html,/Kaydet ve süre hedefini seç/);
  assert.match(html,/aynı süre zorunlu değil/);assert.doesNotMatch(html,/Tamamlanmış tekrar yok/);
  const rejected=renderToStaticMarkup(createElement(MotionResults,{mode:'static',map:staticMap(Array.from({length:41},(_,i)=>i%2)),onPreview(){},onStartLive(){}}));
  assert.match(rejected,/En az 2 saniye/);assert.doesNotMatch(rejected,/Kaydet ve süre hedefini seç/);
});
test('static summary uses hold duration and live setup offers a separate target before opening camera',()=>{
  const html=renderToStaticMarkup(createElement(StaticSessionSummaryView,{summary:staticSummary()}));
  assert.match(html,/Süre hedefi tamamlandı/);assert.match(html,/Referansa uyan süre/);assert.doesNotMatch(html,/tekrar/);
  const setup=renderToStaticMarkup(createElement(StaticLiveExercisePanel,{template:staticTemplate(),onClose(){},async onSave(){throw Error('unused');}}));
  assert.match(setup,/Hedef süre \(saniye\)/);assert.match(setup,/min="5" max="600"/);assert.match(setup,/yeniden vücut taraması gerekmez/);
});

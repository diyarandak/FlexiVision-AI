import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisCancelled, PoseWorkerClient } from '../src/adapters/poseWorkerClient.ts';
import type { ModelStartupStage, WorkerReply, WorkerRequest } from '../src/workers/protocol.ts';

function rig(t: import('node:test').TestContext) {
  t.mock.timers.enable({apis:['setTimeout']});
  const descriptors=['window','location','Worker'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
  t.after(()=>descriptors.forEach(([key,d])=>d?Object.defineProperty(globalThis,key,d):Reflect.deleteProperty(globalThis,key)));
  const workers:FakeWorker[]=[];
  class FakeWorker extends EventTarget {
    messages:WorkerRequest[]=[];terminated=false;
    constructor(){super();workers.push(this);}
    postMessage(message:WorkerRequest){this.messages.push(message);}
    terminate(){this.terminated=true;}
    reply(data:WorkerReply){this.dispatchEvent(new MessageEvent('message',{data}));}
  }
  Object.defineProperty(globalThis,'window',{configurable:true,value:{Worker:FakeWorker,OffscreenCanvas:{},createImageBitmap(){}}});
  Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://flexivision.test'}});
  Object.defineProperty(globalThis,'Worker',{configurable:true,value:FakeWorker});
  const client=new PoseWorkerClient();t.after(()=>client.cancel());
  return {client,workers};
}
test('model progress never resolves initialization or creates a measured frame',async t=>{
  const {client,workers}=rig(t);const stages:ModelStartupStage[]=[];let ready=false;
  const work=client.initialize(stage=>stages.push(stage)).then(()=>{ready=true;});
  const worker=workers[0]!,id=worker.messages[0]!.id;
  const init=worker.messages[0]!;
  assert.ok(init.type==='init' && /models\/[a-f0-9]{64}\/pose_landmarker_lite.task$/.test(init.modelUrl));
  worker.reply({id:999,type:'progress',stage:'loading_model'});
  for(const stage of ['loading_library','loading_model','starting_engine'] as const)worker.reply({id,type:'progress',stage});
  await Promise.resolve();assert.equal(ready,false);assert.equal(stages.length,3);
  worker.reply({id,type:'ready'});await work;assert.equal(ready,true);
  t.mock.timers.tick(60000); // watchdog was cleared by actual readiness
});
test('stalled engine times out with technical diagnosis and late progress is ignored',async t=>{
  const {client,workers}=rig(t);const stages:ModelStartupStage[]=[];
  const work=client.initialize(stage=>stages.push(stage));
  const rejected=assert.rejects(work,/Hareket motoru başlatılamadı/);
  const worker=workers[0]!,id=worker.messages[0]!.id;
  worker.reply({id,type:'progress',stage:'starting_engine'});
  t.mock.timers.tick(60000);await rejected;
  worker.reply({id,type:'progress',stage:'loading_model'});assert.deepEqual(stages,['starting_engine']);
});
test('download timeout and cancellation remain distinct and retire pending progress',async t=>{
  const {client,workers}=rig(t);const pending=client.initialize();
  const rejected=assert.rejects(pending,/Analiz dosyaları yüklenemedi/);
  t.mock.timers.tick(60000);await rejected;client.cancel();assert.equal(workers[0]!.terminated,true);
  const next=new PoseWorkerClient();let progress=0;const work=next.initialize(()=>progress++);
  const cancelled=assert.rejects(work,AnalysisCancelled);const worker=workers[1]!;
  next.cancel();await cancelled;worker.reply({id:1,type:'progress',stage:'loading_model'});assert.equal(progress,0);
});
test('preloadPoseModel caches model in CacheStorage when available',async t=>{
  const opened:string[]=[];const cachedUrls:string[]=[];
  const fakeCache={
    match:async(_url:string)=>undefined,
    put:async(url:string,_resp:Response)=>{cachedUrls.push(url);},
  };
  const descriptors=['window','caches','fetch','location'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
  t.after(()=>descriptors.forEach(([key,d])=>d?Object.defineProperty(globalThis,key,d):Reflect.deleteProperty(globalThis,key)));
  Object.defineProperty(globalThis,'window',{configurable:true,value:{caches:{open:async(name:string)=>{opened.push(name);return fakeCache;}}}});
  Object.defineProperty(globalThis,'caches',{configurable:true,value:{open:async(name:string)=>{opened.push(name);return fakeCache;}}});
  Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://flexivision.test'}});
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(_url:string)=>new Response('mock-data',{status:200})});
  const { preloadPoseModel, MODEL_CACHE_NAME } = await import('../src/adapters/poseWorkerClient.ts');
  preloadPoseModel();
  await new Promise(r=>setTimeout(r,10));
  assert.ok(opened.includes(MODEL_CACHE_NAME));
  assert.ok(cachedUrls.some(u=>/pose_landmarker_lite\.task$/.test(u)));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { keepScreenAwake, type ScreenAwakeState } from '../src/adapters/screenAwake.ts';

test('ending a session releases a wake lock granted after the camera already stopped', async () => {
  const states:ScreenAwakeState[]= [];let releases=0;
  let grant!: (lock:Pick<WakeLockSentinel,'release'|'addEventListener'|'released'>)=>void;
  const stop=keepScreenAwake(state=>states.push(state),()=>new Promise(resolve=>{grant=resolve;}));
  stop(); grant({released:false,addEventListener(){},async release(){releases++;}});await Promise.resolve();
  assert.equal(releases,1); assert.deepEqual(states,[]);
});
test('system release and denial report unavailable without preventing tracking or retrying indefinitely', async () => {
  const states:ScreenAwakeState[]=[]; let releases=0;let released!:()=>void;
  const stop=keepScreenAwake(state=>states.push(state),async()=>({released:false,addEventListener(_event:string,callback:EventListenerOrEventListenerObject){released=callback as ()=>void;},async release(){releases++;}}));
  await Promise.resolve();assert.deepEqual(states,['active']);released();assert.deepEqual(states,['active','unavailable']);
  stop();stop();assert.equal(releases,1);
  const denied:ScreenAwakeState[]=[];
  keepScreenAwake(state=>denied.push(state),async()=>{throw new Error('low battery');});await Promise.resolve();
  assert.deepEqual(denied,['unavailable']);
});

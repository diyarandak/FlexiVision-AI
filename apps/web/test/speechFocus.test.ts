import assert from 'node:assert/strict';
import test from 'node:test';
import { speechWithInputPause } from '../src/adapters/speechFocus.ts';

test('superseded speech cannot reopen the microphone during the next instruction',async()=>{
  const pending:(()=>void)[]=[],paused:boolean[]=[];
  const voice=speechWithInputPause({available:true,speak(){return new Promise<void>(resolve=>pending.push(resolve));},cancel(){}},active=>paused.push(active));
  const first=voice.speak('Bir'),second=voice.speak('İki');
  assert.deepEqual(paused,[true,true]);
  pending[0]!();await first;assert.deepEqual(paused,[true,true]);
  pending[1]!();await second;assert.deepEqual(paused,[true,true,false]);
  voice.speak('Üç');voice.cancel();pending[2]!();await Promise.resolve();
  assert.deepEqual(paused,[true,true,false,true,false]);
});
test('failed or unavailable speech cannot leave the microphone held',()=>{
  const paused:boolean[]=[];
  const failed=speechWithInputPause({available:true,speak(){throw Error('audio');},cancel(){}},active=>paused.push(active));
  assert.throws(()=>failed.speak('Bir'));assert.deepEqual(paused,[true,false]);
  const unavailable=speechWithInputPause({available:false,speak(){},cancel(){}},active=>paused.push(active));
  assert.equal(unavailable.available,false);unavailable.speak('İki');assert.deepEqual(paused,[true,false,true,false]);
});

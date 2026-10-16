import assert from 'node:assert/strict';
import test from 'node:test';
import { genericCoachStatus } from '../src/genericCoachStatus.ts';
import type { GenericLiveResult } from '../src/liveGeneric.ts';
const result = (observation: GenericLiveResult['observation'], phase: GenericLiveResult['phase']='outbound', progress=.3) => ({ observation,phase,progress });
test('distance status distinguishes setup, measured matching, difference and framing without relying on colour', () => {
  assert.equal(genericCoachStatus(result({status:'correct'},'outbound',0),true).title,'BAŞLANGIÇ HAZIR');
  const good=genericCoachStatus(result({status:'correct'}),true);
  const different=genericCoachStatus(result({status:'incorrect',errors:[]}),true);
  assert.equal(good.title,'HAREKET UYUYOR'); assert.notEqual(good.symbol,different.symbol);
  assert.equal(different.title,'HAREKETİ DÜZELT');
  assert.equal(genericCoachStatus(result({status:'correct'}),false).tone,'framing');
  for (const reason of ['tracking_lost','find_start','hold_start','no_person','processing_slow'])
    assert.equal(genericCoachStatus(result({status:'unknown',reason}),true).tone,'framing');
  assert.equal(genericCoachStatus(null,false).symbol,'?');
  assert.equal(genericCoachStatus(result({status:'unknown',reason:'tracking_lost'}),false,true).title,'SENİ GÖRÜYORUM');
});

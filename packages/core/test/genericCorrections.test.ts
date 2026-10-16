import assert from 'node:assert/strict';
import test from 'node:test';
import type {JointAngles} from '@flexivision/contracts';
import {angleCorrection,correctionInstruction,correctionKey,positionCorrection} from '../src/genericCorrections.ts';
import {FeedbackPolicy} from '../src/feedback.ts';
const empty: JointAngles = {leftKnee:null,rightKnee:null,leftHip:null,rightHip:null,leftElbow:null,rightElbow:null};

test('signed angle difference selects the largest relevant joint and gives the direction to correct it',()=>{
  const correction=angleCorrection({...empty,leftKnee:170,rightElbow:120},{...empty,leftKnee:140,rightElbow:160},[25,14]);
  assert.equal(correction?.jointIndex,14);assert.equal(correction?.action,'extend');
  assert.equal(correctionInstruction(correction!), 'Sağ dirseğini biraz daha aç.');
  const bend=angleCorrection({...empty,leftKnee:170},{...empty,leftKnee:130},[25]);
  assert.equal(correctionInstruction(bend!), 'Sol dizini biraz daha bük.');
  assert.notEqual(correctionKey(bend!),correctionKey({...bend!,action:'extend'}));
});
test('missing, invalid, irrelevant or small angle differences never produce numeric commands',()=>{
  assert.equal(angleCorrection(empty,empty,[25]),null);
  assert.equal(angleCorrection({...empty,leftKnee:NaN},{...empty,leftKnee:120},[25]),null);
  assert.equal(angleCorrection({...empty,leftKnee:181},{...empty,leftKnee:120},[25]),null);
  assert.equal(angleCorrection({...empty,leftKnee:130},{...empty,leftKnee:120},[25]),null);
  assert.equal(angleCorrection({...empty,leftKnee:170},{...empty,leftKnee:120},[15]),null);
  assert.doesNotMatch(correctionInstruction(angleCorrection({...empty,leftHip:150},{...empty,leftHip:100},[23])!),/derece|bük|öne|geriye/);
});
test('horizontal offsets and their mirrored versions never pretend to measure depth',()=>{
  for(const index of [13,15,23,25,27]) for(const dx of [-.2,.2]) {
    const correction=positionCorrection({index,observed:{x:.5+dx,y:.5},reference:{x:.5,y:.5}});
    assert.equal(correction.action,'align');assert.doesNotMatch(correctionInstruction(correction),/öne|geriye|ileri|arkaya/);
  }
  assert.equal(positionCorrection({index:15,observed:{x:.5,y:.7},reference:{x:.5,y:.5}}).action,'raise');
});
test('switching the affected joint or direction restarts correction persistence without bypassing ten seconds',()=>{
  const policy=new FeedbackPolicy(0);
  const form=(code:string)=>({status:'incorrect' as const,errors:[{code,message:'Güncel düzeltme',severity:.5}]});
  for(let time=0;time<9800;time+=200) assert.equal(policy.observe(time,form('motion_25_bend')),null);
  assert.equal(policy.observe(9800,form('motion_25_extend')),null);
  assert.equal(policy.observe(10000,form('motion_25_extend')),null);
  for(let time=10200;time<11400;time+=200) assert.equal(policy.observe(time,form('motion_25_extend')),null);
  assert.equal(policy.observe(11400,form('motion_25_extend'))?.code,'motion_25_extend');
  for(let time=11600;time<21400;time+=200) assert.equal(policy.observe(time,form('motion_25_extend')),null);
  assert.equal(policy.observe(21400,form('motion_25_extend'))?.code,'motion_25_extend');
});

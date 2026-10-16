import type { GenericCorrectionAction, JointAngles, JointName } from '@flexivision/contracts';
import { JOINT_TRIPLETS } from './motionMap.ts';

export const CORRECTION_JOINT_NAMES: Record<number, string> = {
  11:'Sol omuz',12:'Sağ omuz',13:'Sol dirsek',14:'Sağ dirsek',15:'Sol el bileği',16:'Sağ el bileği',
  23:'Sol kalça',24:'Sağ kalça',25:'Sol diz',26:'Sağ diz',27:'Sol ayak bileği',28:'Sağ ayak bileği',
};
const subjects: Record<number,string> = {
  11:'Sol omzunu',12:'Sağ omzunu',13:'Sol dirseğini',14:'Sağ dirseğini',15:'Sol elini',16:'Sağ elini',
  23:'Sol kalçanı',24:'Sağ kalçanı',25:'Sol dizini',26:'Sağ dizini',27:'Sol ayağını',28:'Sağ ayağını',
};
export interface GenericCorrection {
  jointIndex: number;
  action: GenericCorrectionAction;
  /** Image-plane angles, never a calibrated anatomical measurement. */
  observedDegrees?: number;
  referenceDegrees?: number;
}
export function correctionKey(value: GenericCorrection) { return `motion_${value.jointIndex}_${value.action}`; }
export function correctionInstruction(value: GenericCorrection): string {
  const subject = subjects[value.jointIndex] ?? 'İşaretli eklemini';
  if (value.action === 'align' && [23,24].includes(value.jointIndex))
    return 'Gövde duruşun farklı görünüyor. Başlangıç duruşuna dönüp yeniden dene.';
  return value.action === 'bend' ? `${subject} biraz daha bük.`
    : value.action === 'extend' ? `${subject} biraz daha aç.`
    : value.action === 'raise' ? `${subject} biraz yukarı kaldır.`
    : value.action === 'lower' ? `${subject} biraz aşağı indir.`
    : `${subject} çizimdeki hedef konumuna yaklaştır.`;
}
/** Prefer a signed joint angle over positional guesses; only tracked, visible triplets participate. */
export function angleCorrection(live: JointAngles, reference: JointAngles, tracked: readonly number[]): GenericCorrection | null {
  const candidates = (Object.keys(JOINT_TRIPLETS) as JointName[]).flatMap(name => {
    const indices = JOINT_TRIPLETS[name], observed = live[name], target = reference[name];
    if (!indices.some(index => tracked.includes(index)) || observed === null || target === null
      || !Number.isFinite(observed) || !Number.isFinite(target) || observed < 0 || observed > 180 || target < 0 || target > 180) return [];
    const delta = observed - target;
    if (Math.abs(delta) < 18) return [];
    const jointIndex = indices[1];
    const action: GenericCorrectionAction = name.endsWith('Hip') ? 'align' : delta > 0 ? 'bend' : 'extend';
    return [{jointIndex, action, observedDegrees: observed, referenceDegrees: target, difference: Math.abs(delta)}];
  }).sort((a,b) => b.difference - a.difference);
  const main = candidates[0];
  return main ? {jointIndex:main.jointIndex,action:main.action,observedDegrees:main.observedDegrees,referenceDegrees:main.referenceDegrees} : null;
}
export function positionCorrection(joint: {index:number; observed:{x:number;y:number}; reference:{x:number;y:number}}): GenericCorrection {
  const dy = joint.observed.y-joint.reference.y, dx = joint.observed.x-joint.reference.x;
  // Horizontal pixels cannot identify forward/backward motion in camera depth.
  return {jointIndex:joint.index, action:Math.abs(dy) > .04 && Math.abs(dy) > Math.abs(dx)*1.25
    ? dy > 0 ? 'raise' : 'lower' : 'align'};
}

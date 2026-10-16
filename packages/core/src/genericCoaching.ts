import type { GenericMotionTemplate } from '@flexivision/contracts';

/** Instructions describe only movement visible in the reference's 2D plane. */
export function genericCoachingPlan(template: GenericMotionTemplate) {
  const start = template.samples[0]!.landmarks;
  const wrists = [15,16].map(index => start[index]), shoulders = [11,12].map(index => start[index]);
  const startInstruction = wrists.every(Boolean) && shoulders.every(Boolean)
    ? wrists.every((point,index) => point!.y > shoulders[index]!.y + .35) ? 'Başlangıç için kollarını aşağıda tut.'
      : wrists.every((point,index) => point!.y < shoulders[index]!.y - .25) ? 'Başlangıç için ellerini omuzlarının üstüne kaldır.'
      : wrists.every((point,index) => Math.abs(point!.y - shoulders[index]!.y) < .2 && Math.abs(point!.x - shoulders[index]!.x) > .35)
        ? 'Başlangıç için kollarını iki yana, omuz hizasına aç.' : 'Başlangıçtaki kol ve bacak duruşunu eşleştir.'
    : 'Başlangıçtaki kol ve bacak duruşunu eşleştir.';
  const displacement = (sample: typeof template.samples[number]) => template.motionIndices.reduce((sum, index) => {
    const a = start[index], b = sample.landmarks[index];
    return sum + (a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0);
  }, 0);
  const peakIndex = template.samples.reduce((best, sample, index) =>
    displacement(sample) > displacement(template.samples[best]!) ? index : best, 0);
  const target = template.samples[peakIndex]!.landmarks;
  const groups = [
    { indices: [15, 16], names: ['Sol elini', 'Sağ elini'], both: 'Ellerini' },
    { indices: [27, 28], names: ['Sol ayağını', 'Sağ ayağını'], both: 'Ayaklarını' },
    { indices: [25, 26], names: ['Sol dizini', 'Sağ dizini'], both: 'Dizlerini' },
    { indices: [13, 14], names: ['Sol dirseğini', 'Sağ dirseğini'], both: 'Dirseklerini' },
  ];
  const candidates = groups.flatMap(group => group.indices.map((index, side) => {
    const a = start[index], b = target[index];
    const dx = a && b ? b.x - a.x : 0, dy = a && b ? b.y - a.y : 0;
    return { group, index, side, dx, dy, distance: template.motionIndices.includes(index) ? Math.hypot(dx, dy) : 0 };
  })).sort((a, b) => b.distance - a.distance);
  const main = candidates[0];
  if (!main || main.distance < .08) return { peakIndex, startInstruction, movingIndices: template.motionIndices,
    outbound: 'Çizimdeki hedef duruşa doğru hareket et.', returning: 'Çizimdeki başlangıç duruşuna dön.' };
  const partner = candidates.find(item => item.group === main.group && item.index !== main.index);
  const direction = (dx: number, dy: number) => Math.abs(dy) > Math.abs(dx) * 1.2 ? Math.sign(dy) : 0;
  const vertical = direction(main.dx, main.dy);
  const paired = partner && partner.distance >= main.distance * .65 && direction(partner.dx, partner.dy) === vertical;
  const subject = paired ? main.group.both : main.group.names[main.side]!;
  const movingIndices = paired ? main.group.indices : [main.index];
  // Symmetric separation is visible in 2D; camera-depth directions remain unknown.
  const separation = paired && partner && Math.sign(main.dx) !== Math.sign(partner.dx)
    ? Math.abs(target[main.index]!.x - target[partner.index]!.x) - Math.abs(start[main.index]!.x - start[partner.index]!.x) : 0;
  const startAngles = template.samples[0]!.angles2d, targetAngles = template.samples[peakIndex]!.angles2d;
  const squatLike = ['leftKnee','rightKnee'].every(key => {
    const name = key as 'leftKnee'|'rightKnee', a = startAngles[name], b = targetAngles[name];
    return a !== null && b !== null && a > 145 && a-b > 20;
  }) && [start,target].every(p => [11,12,23,24,25,26,27,28].every(i => p[i])
    && p[11]!.y < p[23]!.y-.15 && p[12]!.y < p[24]!.y-.15
    && p[27]!.y > p[25]!.y && p[28]!.y > p[26]!.y);
  if (squatLike) return {peakIndex,startInstruction:'Başlangıç için ayakta dur; dizlerini rahatça açık tut.',
    movingIndices:[25,26],outbound:'Dizlerini bükerek çömel.',returning:'Ayağa kalkıp başlangıç duruşuna dön.'};
  const action = (reverse: boolean) => {
    const sign = reverse ? -vertical : vertical;
    return sign < 0 ? `${subject} yukarı kaldır.` : sign > 0 ? `${subject} aşağı indir.`
      : Math.abs(separation) > .15 ? `${subject} ${(reverse ? -separation : separation) > 0 ? 'iki yana aç' : 'birbirine yaklaştır'}.`
      : `${subject} çizimdeki ${reverse ? 'başlangıç' : 'turuncu hedef'} konumuna taşı.`;
  };
  return { peakIndex, startInstruction, movingIndices, outbound: action(false), returning: action(true) };
}

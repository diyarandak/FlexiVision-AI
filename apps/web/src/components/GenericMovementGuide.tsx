import { useEffect, useMemo, useRef, useState } from 'react';
import type { GenericMotionTemplate } from '@flexivision/contracts';
import { genericCoachingPlan } from '@flexivision/core';

const edges = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
type Points = GenericMotionTemplate['samples'][number]['landmarks'];
function illustratedHead(points: Points) {
  const left = points[11], right = points[12], hipLeft = points[23], hipRight = points[24];
  if (!left || !right || !hipLeft || !hipRight) return points[0];
  const shoulder = { x:(left.x+right.x)/2,y:(left.y+right.y)/2 }, hip = { x:(hipLeft.x+hipRight.x)/2,y:(hipLeft.y+hipRight.y)/2 };
  return points[0] ?? { x:shoulder.x+(shoulder.x-hip.x)*.38,y:shoulder.y+(shoulder.y-hip.y)*.38 };
}

export function GenericMovementGuide({ template, phase = 'preview', playRequest = 0, onPlaybackChange }: {
  template: GenericMotionTemplate; phase?: 'preview' | 'start' | 'outbound' | 'return';
  playRequest?: number; onPlaybackChange?: (playing: boolean) => void;
}) {
  const plan = useMemo(() => genericCoachingPlan(template), [template]);
  const viewBox = useMemo(() => {
    const points = template.samples.flatMap(sample => [...sample.landmarks, illustratedHead(sample.landmarks)].filter(point => point != null));
    const xs = points.map(point => point.x), ys = points.map(point => point.y);
    const x = Math.min(...xs) - .2, y = Math.min(...ys) - .2;
    return `${x} ${y} ${Math.max(...xs) - x + .2} ${Math.max(...ys) - y + .2}`;
  }, [template]);
  const [step, setStep] = useState(0), [playing, setPlaying] = useState(false);
  const playbackChanged = useRef(onPlaybackChange); playbackChanged.current = onPlaybackChange;
  useEffect(() => { setStep(0); setPlaying(false); }, [template]);
  useEffect(() => {
    if (playRequest > 0) { setStep(0); setPlaying(true); playbackChanged.current?.(true); }
  }, [playRequest]);
  useEffect(() => {
    if (!playing) return;
    let value = 0;
    const timer = setInterval(() => {
      value++;
      if (value > 50) { clearInterval(timer); setPlaying(false); setStep(0); playbackChanged.current?.(false); }
      else setStep(value);
    }, Math.max(70, template.durationMs / 50));
    return () => clearInterval(timer);
  }, [playing, playRequest, template.durationMs]);
  const targetIndex = phase === 'return' || phase === 'start' ? 0 : plan.peakIndex;
  const previewIndex = Math.min(template.samples.length - 1, Math.round(step * (template.samples.length - 1) / 50));
  const target = template.samples[playing ? previewIndex : targetIndex]!.landmarks;
  const origin = template.samples[phase === 'return' ? plan.peakIndex : 0]!.landmarks;
  const pose = (points: typeof target, ghost: boolean) => {
    const head = illustratedHead(points), torso = [11,12,24,23].map(index => points[index]);
    return <g opacity={ghost ? .18 : 1} className="reference-person">
    {torso.every(Boolean) && <polygon data-silhouette="torso" points={torso.map(point => `${point!.x},${point!.y}`).join(' ')} fill={ghost ? '#536961' : '#245c48'} />}
    {head && <circle data-silhouette="head" cx={head.x} cy={head.y} r=".14" fill={ghost ? '#536961' : '#245c48'} />}
    {edges.map(([a,b]) => points[a!] && points[b!] ? <line key={`${a}-${b}`} x1={points[a!]!.x} y1={points[a!]!.y}
      x2={points[b!]!.x} y2={points[b!]!.y} stroke={ghost ? '#536961' : '#245c48'} strokeWidth=".10" strokeLinecap="round" /> : null)}
    {points.map((point,index) => point && index >= 11 ? <circle key={index} cx={point.x} cy={point.y}
      r={plan.movingIndices.includes(index) ? '.095' : '.045'} stroke={!ghost && plan.movingIndices.includes(index) ? '#fff9e7' : 'none'} strokeWidth=".025" fill={!ghost && plan.movingIndices.includes(index) ? '#b34e09' : '#245c48'} /> : null)}
  </g>; };
  return <section className={`generic-movement-guide ${phase === 'preview' ? 'movement-preview' : ''}${playing ? ' playing-example' : ''}`} aria-label="Hareket rehberi">
    <strong>{playing ? 'HAREKETİN ÖRNEĞİ' : phase === 'preview' ? 'HAREKETİ TANI' : phase === 'start' ? 'BAŞLANGIÇ DURUŞU' : phase === 'return' ? 'ŞİMDİ BAŞLANGICA DÖN' : 'ŞİMDİ BU HEDEFE GİT'}</strong>
    <svg viewBox={viewBox} role="img" aria-label={playing ? 'Referans hareketin canlandırması' : 'Ulaşılacak referans duruşu; turuncu noktalar hareket eden eklemler'}>
      {!playing && phase !== 'start' && pose(origin, true)}{pose(target, false)}
    </svg>
    <span>{playing ? 'Bu bir örnek. Kendi hızında yap.' : 'Turuncu eklemleri hareket ettir.'}</span>
    <button type="button" onClick={() => { setStep(0); setPlaying(!playing); playbackChanged.current?.(!playing); }} aria-pressed={playing}>
      {playing ? 'Hedefe dön' : '▶ Hareketi göster'}
    </button>
  </section>;
}

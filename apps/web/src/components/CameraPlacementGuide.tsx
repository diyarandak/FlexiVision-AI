import { cameraBodyChecklist, FULL_BODY_LANDMARKS, isVisible } from '@flexivision/core';
import type { GenericMotionTemplate, PoseFrame } from '@flexivision/contracts';

const links = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
const jointGroups: [number[], string][] = [ [[11,12], 'Omuzların'], [[23,24], 'Kalçan'], [[13,14,15,16], 'Kolların ve ellerin'], [[25,26,27,28], 'Dizlerin ve ayakların'] ];

type CameraGuideViewport = { width: number; height: number; topInset?: number; bottomInset?: number };

export function CameraSetupProgress({ frame, started, loading }: { frame: PoseFrame | undefined; started: boolean; loading: boolean }) {
  const checks = cameraBodyChecklist(loading ? undefined : frame);
  const step = loading || checks.some(check => !check.visible) ? 1 : started ? 3 : 2;
  return <div className="camera-setup-progress" aria-label="Hazırlık adımları">
    <ol>{['Kadraj', 'Başlangıç', 'Hareket'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined}
      data-complete={step > index + 1}><span aria-hidden="true">{step > index + 1 ? '✓' : index + 1}</span> {label}</li>)}</ol>
    {step === 1 && <ul aria-label="Kamerada görülebilen bölgeler">{checks.map(check => <li key={check.label} data-visible={check.visible}>
      <span aria-hidden="true">{check.visible ? '✓' : '○'}</span> {check.label}<span className="sr-only">: {check.visible ? 'görünüyor' : 'ölçüm bekleniyor'}</span>
    </li>)}</ul>}
  </div>;
}

/** The source pixels left visible by centered object-fit: cover / SVG slice. */
export function visibleCameraGuideRect(width: number, height: number, viewport?: CameraGuideViewport, fit: 'cover' | 'contain' = 'cover') {
  if (!viewport || ![viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0))
    return { x: 0, y: 0, width, height };
  const scale = (fit === 'cover' ? Math.max : Math.min)(viewport.width / width, viewport.height / height);
  const visibleWidth = Math.min(width, viewport.width / scale), visibleHeight = Math.min(height, viewport.height / scale);
  const letterboxY = Math.max(0, (viewport.height-height*scale)/2);
  const top = Math.min(visibleHeight*.45, Math.max(0, (viewport.topInset ?? 0) - letterboxY) / scale);
  const bottom = Math.min(visibleHeight*.45, Math.max(0, (viewport.bottomInset ?? 0) - letterboxY) / scale);
  return { x: (width - visibleWidth) / 2, y: (height - visibleHeight) / 2 + top,
    width: visibleWidth, height: visibleHeight - top - bottom };
}

/** A placement hint only. Acceptance always comes from the live comparer. */
export function placementMessage(frame: PoseFrame | undefined, required: readonly number[], reason: string): string {
  if (reason === 'processing_slow') return 'Görüntü gecikiyor. Kamera ayarlarından Hafif görüntüyü seç.';
  if (!frame || !frame.people.length) return 'Seni göremiyorum. Telefonu sabitle; başın ve ayakların kamerada görünsün.';
  if (frame.people.length > 1) return 'Tek bir vücut net seçilemiyor. Telefonu sabitle; gövden ve hareket eden uzuvların görünsün.';
  const points = frame.people[0]!.landmarks;
  if (![0,7,8].some(index => isVisible(points[index])))
    return 'Başın görünmüyor. Telefonu sabitle; başından ayak bileklerine kadar kadraja gir.';
  const needed = new Set([...FULL_BODY_LANDMARKS,...required]);
  let worstGroup: string | null = null;
  let maxMissing = 0;
  for (const [indices,label] of jointGroups) {
    const missingCount = indices.filter(i => needed.has(i) && !isVisible(points[i])).length;
    if (missingCount > maxMissing) {
      maxMissing = missingCount;
      worstGroup = label;
    }
  }
  if (worstGroup) return `${worstGroup} görünmüyor. Telefonu sabitle; başından ayak bileklerine kadar kadraja gir.`;
  if (reason === 'body_not_visible') return 'Gövde ölçümü net değil. Omuz ve kalçanı iyi aydınlat; kameranın karşısında sabit kal.';
  if (reason === 'camera_view') return 'Çekim açısı farklı. Video yandansa sen de yan dur; öndense kameraya dön.';
  if (reason === 'hold_start') return 'Duruş bulundu. Kısa bir an sabit kal.';
  return 'Vücudun görünüyor. Büyük gölgedeki kol ve bacak duruşunu taklit et; tam üstüne oturman gerekmez.';
}

export function CameraPlacementGuide({ template, width, height, fill, showReference, viewport }: {
  template: GenericMotionTemplate; width: number; height: number; fill: boolean; showReference: boolean;
  viewport?: CameraGuideViewport | undefined;
}) {
  // The guide is instructional, so fit it into the visible part of the source.
  // Measured landmarks still use their original source coordinates elsewhere.
  const area = visibleCameraGuideRect(width, height, viewport, fill ? 'cover' : 'contain');
  const points = template.samples[0]!.landmarks;
  const shoulder = points[11] && points[12] ? {x:(points[11].x+points[12].x)/2,y:(points[11].y+points[12].y)/2} : null;
  const hip = points[23] && points[24] ? {x:(points[23].x+points[24].x)/2,y:(points[23].y+points[24].y)/2} : null;
  const head = points[0] ?? (shoulder && hip ? {x:shoulder.x+(shoulder.x-hip.x)*.28,y:shoulder.y+(shoulder.y-hip.y)*.28} : null);
  // Include every drawn joint, including static torso joints omitted from trackedIndices.
  const drawnIndices = [...new Set(links.flat())];
  const known = drawnIndices.flatMap(i => points[i] ? [points[i]!] : []);
  if (head) known.push(head);
  const minX=Math.min(...known.map(p=>p.x)), maxX=Math.max(...known.map(p=>p.x));
  const minY=Math.min(...known.map(p=>p.y)), maxY=Math.max(...known.map(p=>p.y));
  const scale=Math.min(area.width*.64/Math.max(.1,maxX-minX),area.height*(viewport ? .72 : .48)/Math.max(.1,maxY-minY));
  const x=(n:number)=>area.x+area.width/2+(n-(minX+maxX)/2)*scale;
  const y=(n:number)=>area.y+area.height*(viewport ? .5 : .57)+(n-(minY+maxY)/2)*scale;
  const shortestSide = Math.min(area.width, area.height);
  const strokeWidth = Math.min(Math.max(10,area.height*.027), shortestSide*.06);
  const headRadius = Math.min(area.height*.024, shortestSide*.05);
  return <svg className="camera-placement-guide" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio={fill ? 'xMidYMid slice' : 'xMidYMid meet'} role="img"
    aria-label={showReference ? 'Başlangıç duruşu gölgesi: referansın kol ve bacak konumları' : 'Kadraj rehberi: vücudunu bu alanda görünür hale getir'}>
    {showReference ? <g className="reference-ghost" strokeWidth={viewport ? strokeWidth : Math.max(10,height*.027)}>
      {[11,12,24,23].every(index => points[index]) && <polygon className="reference-torso" stroke="none" points={[11,12,24,23].map(index => `${x(points[index]!.x)},${y(points[index]!.y)}`).join(' ')} />}
      {links.map(([a,b])=>points[a!]&&points[b!]&&<line key={`${a}-${b}`} x1={x(points[a!]!.x)} y1={y(points[a!]!.y)} x2={x(points[b!]!.x)} y2={y(points[b!]!.y)}/>)}
      {head && <circle cx={x(head.x)} cy={y(head.y)} r={viewport ? headRadius : height*.024}/>}
    </g> : <g transform={`translate(${area.x+area.width*.5} ${area.y+area.height*.5}) scale(${Math.min(area.width/180,area.height/480)}) translate(-120 -235)`} className="body-ghost">
      <circle cx="120" cy="60" r="25"/>
      <path d="M101 94 Q120 86 139 94 L156 108 L174 183 L184 225 L166 232 L150 188 L140 151 L141 247 L151 359 L161 414 L137 420 L121 341 L117 283 L112 345 L99 420 L75 416 L87 357 L97 247 L98 151 L88 188 L72 232 L53 225 L66 181 L84 107 Z"/>
      <path className="placement-floor" d="M60 435 H178"/>
    </g>}
  </svg>;
}

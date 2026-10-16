import { downloadMotionMap } from '../adapters/motionMapDownload.ts';
import type { ExerciseTemplate } from '@flexivision/contracts';
import type { JointName, MotionMap, PoseFrame } from '@flexivision/contracts';
import { memo, useMemo, useState } from 'react';
import { detectGenericCycles, detectSquatCycles, evaluateGenericReference, evaluateSquatReference, isVisible, motionCoverage } from '@flexivision/core';
import { StaticPoseResults } from './StaticPoseResults.tsx';
import { ReferenceDecisionCard } from './ReferenceDecisionCard.tsx';
import { SquatTemplatePanel } from './SquatTemplatePanel.tsx';
import { GenericReferenceDecisionCard } from './GenericReferenceDecisionCard.tsx';
import { GenericTemplatePanel } from './GenericTemplatePanel.tsx';

const CONNECTIONS = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32]];
export function Skeleton({
  frame,
  width,
  height,
  fill = false,
  deviatingJoints,
}: {
  frame: PoseFrame | undefined;
  width: number;
  height: number;
  fill?: boolean | undefined;
  deviatingJoints?: ReadonlySet<number> | readonly number[] | undefined;
}) {
  if (!frame) return null;
  const deviatingSet = deviatingJoints instanceof Set
    ? deviatingJoints
    : deviatingJoints
      ? new Set(deviatingJoints)
      : null;

  return <svg className="skeleton" preserveAspectRatio={fill ? 'xMidYMid slice' : 'xMidYMid meet'} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    {frame.people.map((person, personIndex) => {
      const isUser = personIndex === 0;
      return <g key={personIndex}>
        {CONNECTIONS.map(([from, to], index) => {
          const a = person.landmarks[from!], b = person.landmarks[to!];
          if (!isVisible(a) || !isVisible(b)) return null;
          const isDeviating = isUser && deviatingSet ? (deviatingSet.has(from!) || deviatingSet.has(to!)) : false;
          const strokeColor = !isUser ? '#ffc578' : isDeviating ? '#ff453a' : '#30d158';
          const strokeW = isDeviating ? Math.max(3.5, width / 170) : Math.max(2, width / 200);
          return <line key={index} x1={a.x * width} y1={a.y * height} x2={b.x * width} y2={b.y * height}
            stroke={strokeColor} strokeWidth={strokeW} strokeLinecap="round" data-bone-deviating={isDeviating} />;
        })}
        {person.landmarks.map((point, index) => {
          if (index < 11 || !isVisible(point)) return null;
          const isDeviating = isUser && deviatingSet ? deviatingSet.has(index) : false;
          const fillColor = !isUser ? '#ffc578' : isDeviating ? '#ff3b30' : '#30d158';
          const strokeColor = !isUser ? '#153e30' : isDeviating ? '#ffffff' : '#0d381e';
          const radius = isDeviating ? Math.max(5, width / 100) : Math.max(3, width / 130);
          return <g key={index}>
            {isDeviating && <circle cx={point.x * width} cy={point.y * height}
              r={Math.max(8, width / 70)} fill="rgba(255, 59, 48, 0.28)"
              stroke="#ff3b30" strokeWidth={1.5} strokeDasharray="3 2" data-joint-alert={index} />}
            <circle cx={point.x * width} cy={point.y * height} r={radius}
              fill={fillColor} stroke={strokeColor} strokeWidth={isDeviating ? 1.5 : 1}
              data-joint-deviating={isDeviating} />
          </g>;
        })}
      </g>;
    })}
  </svg>;
}

function chartPath(map: MotionMap, joint: JointName) {
  let path = '', connected = false;
  for (const sample of map.samples) {
    const angle = sample.angles2d[joint];
    if (angle === null) { connected = false; continue; }
    const x = 38 + sample.timestampMs / map.sequence.durationMs * 520;
    const y = 165 - angle / 180 * 145;
    path += `${connected ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
    connected = true;
  }
  return path;
}


export const MotionResults = memo(function MotionResults({
  map,
  onPreview,
  onStartLive,
  onSaveTemplate,
  savedReferenceIds,
  mode = 'squat',
}: {
  map: MotionMap;
  onPreview: (startMs: number, endMs: number) => void;
  onStartLive?: ((template: ExerciseTemplate) => void) | undefined;
  onSaveTemplate?: ((template: ExerciseTemplate, name: string) => Promise<import('@flexivision/contracts').SavedReferenceTemplate>) | undefined;
  savedReferenceIds?: readonly string[] | undefined;
  mode?: 'free' | 'squat' | 'static';
}) {
  const quality = map.quality;
  const coverage = useMemo(() => motionCoverage(map), [map]);
  const analysis = useMemo(() => mode === 'squat' ? detectSquatCycles(map) : null, [map, mode]);
  const genericAnalysis = useMemo(() => mode === 'free' ? detectGenericCycles(map) : null, [map, mode]);
  const evaluation = useMemo(
    () =>
      mode === 'static' ? null : mode === 'free' ? evaluateGenericReference(map, genericAnalysis!)
      : evaluateSquatReference(map, analysis!),
    [map, analysis, genericAnalysis, mode]
  );
  const [group, setGroup] = useState<'Knee' | 'Hip' | 'Elbow'>('Knee');
  const left: JointName = `left${group}`, right: JointName = `right${group}`;
  const labels = { Knee: 'Diz', Hip: 'Kalça', Elbow: 'Dirsek' };
  const visibleLabels = { shoulders: 'Omuz', hips: 'Kalça', knees: 'Diz', ankles: 'Ayak bileği' };
  const hasAngles = coverage.angles[left] + coverage.angles[right] > 0;
  if (!evaluation) return <StaticPoseResults map={map} onPreview={onPreview} onStartLive={onStartLive} onSaveTemplate={onSaveTemplate} savedReferenceIds={savedReferenceIds} />;
  return <section className="motion-results" aria-labelledby="motion-title">
    <p className="eyebrow">ANALİZ SONUCU</p>
    <h2 id="motion-title">Analiz sonucu</h2>
    {evaluation.decision.status === 'rejected' && <p className="result-explanation">{mode === 'free'
      ? 'Canlı karşılaştırmaya uygun bir hareket döngüsü çıkarılamadı. Aşağıdaki gerekçeleri incele.'
      : map.status === 'extracted'
        ? 'Video işlendi, ancak squat referans kriterleri karşılanmadı. Aşağıdaki gerekçeleri incele.'
        : `Alt gövde açıları ${quality.sampledFrames} karenin ${quality.usableFrames} tanesinde ölçülebildi. Canlı karşılaştırma için görünür ve tamamlanmış bir tekrar gerekir.`}</p>}
    {mode === 'free' ? <>
      <GenericReferenceDecisionCard decision={evaluation.decision} evidence={evaluation.evidence} analysis={genericAnalysis!} />
      <GenericTemplatePanel map={map} analysis={genericAnalysis!} decision={evaluation.decision} onPreview={onPreview} onStartLive={onStartLive} onSaveTemplate={onSaveTemplate} savedReferenceIds={savedReferenceIds} />
    </> : <>
      <ReferenceDecisionCard decision={evaluation.decision} evidence={evaluation.evidence} analysis={analysis!} />
      <SquatTemplatePanel map={map} analysis={analysis!} decision={evaluation.decision} onPreview={onPreview} onStartLive={onStartLive} onSaveTemplate={onSaveTemplate} savedReferenceIds={savedReferenceIds} />
    </>}
    <details className="analysis-details"><summary>Ölçümler ve açı grafiği</summary>
    <div className="metrics">
      <div><strong>{quality.sampledFrames}</strong><span>İncelenen kare</span></div>
      <div><strong>{mode === 'free' ? evaluation.evidence.usableFrames : quality.usableFrames}</strong><span>{mode === 'free' ? 'Hareket izleme karesi' : 'Alt gövde ölçümü'}</span></div>
      <div><strong>{quality.multiPersonFrames}</strong><span>Çoklu kişi karesi</span></div>
    </div>
    {mode === 'squat' && map.status === 'insufficient_data' && <div className="coverage-details">
      <h3>Hangi eklemler görülebildi?</h3>
      <p>Tek kişinin bulunduğu karelerde, sağ veya sol taraftan en az bir eklemin görünürlük eşiğini karşıladığı kare sayısı:</p>
      <dl>{Object.entries(coverage.landmarks).map(([name, count]) => <div key={name}>
        <dt>{visibleLabels[name as keyof typeof visibleLabels]}</dt><dd>{count} / {quality.sampledFrames} kare</dd>
      </div>)}</dl>
      <p>Az görülen eklemler kadraj dışında, örtülü veya model için belirsiz olabilir. Omuz, kalça, diz ve ayak bileğinin hareket boyunca göründüğü, sabit kamerayla yandan çekilmiş bir video dene. Çıkarılabilen diğer açıları aşağıdan inceleyebilirsin.</p>
      {quality.multiPersonFrames > 0 && <p>Birden fazla kişi görülen karelerde açı hesaplanmadı. Tek kişinin göründüğü bir video seç.</p>}
    </div>}
    <div className="chart-heading"><label>Açı grafiği <select value={group} onChange={event => setGroup(event.target.value as typeof group)}>
      <option value="Knee">Diz</option><option value="Hip">Kalça</option><option value="Elbow">Dirsek</option>
    </select></label><span>Sol <i className="legend left" /> Sağ <i className="legend right" /></span></div>
    <p className="implementation-note">{labels[group]} ölçümü: sol {coverage.angles[left]}, sağ {coverage.angles[right]} kare. Boş aralıklar ölçülemeyen kareleri gösterir.</p>
    {!hasAngles ? <p className="message">{labels[group]} açısı ölçülemedi. Başka bir açı seçebilir veya tüm vücudun göründüğü bir video deneyebilirsin.</p> : <svg className="angle-chart" viewBox="0 0 585 198" role="img" aria-label={`Videonun süresi boyunca sol ve sağ ${labels[group].toLowerCase()} açıları. Ölçülemeyen aralıklar boş bırakılır.`}>
      {[0,90,180].map(angle => <g key={angle}><line x1="38" x2="558" y1={165-angle/180*145} y2={165-angle/180*145} stroke="#e1e6dc" /><text x="2" y={169-angle/180*145}>{angle}°</text></g>)}
      {[left, right].map((joint, index) => <g key={joint} fill={index === 0 ? '#2b7850' : '#a47933'}>
        <path d={chartPath(map, joint)} fill="none" stroke={index === 0 ? '#2b7850' : '#a47933'} strokeWidth="2.5" />
        {map.samples.map((sample, i) => sample.angles2d[joint] === null ? null : <circle key={i}
          cx={38 + sample.timestampMs / map.sequence.durationMs * 520}
          cy={165 - sample.angles2d[joint] / 180 * 145} r="2" />)}
      </g>)}
      <text x="38" y="190">0 sn</text><text x="558" y="190" textAnchor="end">{(map.sequence.durationMs/1000).toFixed(1)} sn</text>
    </svg>}
    <p className="implementation-note">Açılar görüntü düzleminde hesaplanır. Görülme skoru ölçüm doğruluğu değildir. JSON dosyası eklem konumlarını, tahmini 3B koordinatları ve açı dizilerini içerir.</p>
    <button className="secondary-button" onClick={() => downloadMotionMap({ ...map, decision: evaluation.decision,
      evidence: evaluation.evidence, qualification: evaluation.decision.status })}>Hareket verisini indir (.json)</button>
    </details>
  </section>;
});

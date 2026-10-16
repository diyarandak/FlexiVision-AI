import type { SavedBodyProfile } from '@flexivision/contracts';

export function BodyProfileDetails({ saved }: { saved: SavedBodyProfile }) {
  const p = saved.profile.proportions;
  const left = -p.hipWidth / 2, right = p.hipWidth / 2, hipY = 1.5;
  const bottom = hipY + Math.max(p.leftThigh + p.leftShin, p.rightThigh + p.rightShin) + .3;
  const width = Math.max(2, p.shoulderWidth + .7, p.hipWidth + .7);
  const joints = [[-p.shoulderWidth / 2, .5], [p.shoulderWidth / 2, .5], [left, hipY], [right, hipY],
    [left, hipY + p.leftThigh], [right, hipY + p.rightThigh], [left, hipY + p.leftThigh + p.leftShin],
    [right, hipY + p.rightThigh + p.rightShin]];
  const lines = [[0,1],[0,2],[1,3],[2,3],[2,4],[4,6],[3,5],[5,7]];
  const rows = [['Omuz genişliği', p.shoulderWidth], ['Kalça genişliği', p.hipWidth], ['Sol üst bacak', p.leftThigh],
    ['Sağ üst bacak', p.rightThigh], ['Sol alt bacak', p.leftShin], ['Sağ alt bacak', p.rightShin]] as const;
  return <section className="card body-profile-details" aria-labelledby="body-details-title"><div className="body-profile-diagram">
    <svg viewBox={`${-width/2} 0 ${width} ${bottom}`} role="img" aria-label="Kaydedilmiş gövde ve bacak oranlarının şeması">
      <circle cx="0" cy="0.2" r="0.16" fill="none" stroke="currentColor" strokeWidth=".045" />
      <line x1="0" y1=".36" x2="0" y2=".5" stroke="currentColor" strokeWidth=".045" />
      {lines.map(([a,b], i) => <line key={i} x1={joints[a!]![0]} y1={joints[a!]![1]} x2={joints[b!]![0]} y2={joints[b!]![1]} stroke="currentColor" strokeWidth=".045" />)}
      {joints.map(([x,y], i) => <circle key={i} cx={x} cy={y} r=".055" fill="#b8df93" stroke="currentColor" strokeWidth=".02" />)}
    </svg><small>Ölçülen oranların şeması.<br />Fotoğraf veya 3B vücut modeli değildir.</small></div>
    <div><p className="eyebrow">BAŞLANGIÇ ÖLÇÜLERİN</p><h2 id="body-details-title">Vücut haritan</h2><p>Gövde uzunluğu 1 birim kabul edilerek kaydedilen göreli ölçüler. Santimetre ölçümü değildir.</p>
      <details className="body-measurement-details"><summary>Sayısal ölçülerimi gör</summary><dl className="body-measurements">{rows.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value.toFixed(2)} birim</dd></div>)}</dl></details>
      <p className="implementation-note">Bu profil canlı konumları ölçeklemek için kullanılır. Kişisel güvenli derinlik veya tıbbi değerlendirme üretmez.</p>
    </div></section>;
}

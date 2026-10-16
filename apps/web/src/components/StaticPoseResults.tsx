import { downloadMotionMap } from '../adapters/motionMapDownload.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExerciseTemplate, MotionMap, SavedReferenceTemplate, StaticPoseTemplate } from '@flexivision/contracts';
import { analyzeStaticPose, STATIC_BONES } from '@flexivision/core';
export function StaticReferenceFigure({ template }: {
    template: StaticPoseTemplate;
}) {
    const p = template.landmarks, visible = p.filter(v => v !== null), minX = Math.min(...visible.map(v => v.x)) - .2, minY = Math.min(...visible.map(v => v.y)) - .2;
    const w = Math.max(...visible.map(v => v.x)) - minX + .2, h = Math.max(...visible.map(v => v.y)) - minY + .2;
    return <svg className="generic-start-pose" viewBox={`${minX} ${minY} ${w} ${h}`} role="img" aria-label="Referans sabit duruş">
    {STATIC_BONES.map(([a, b]) => <line key={`${a}-${b}`} x1={p[a]!.x} y1={p[a]!.y} x2={p[b]!.x} y2={p[b]!.y} stroke="#245c48" strokeWidth=".035" strokeLinecap="round"/>)}
  </svg>;
}
const reasons: Record<string, string> = { invalid_evidence: 'Video ölçümleri tutarsız; yeniden analiz et.', duration_out_of_range: '3–60 saniyelik bir video seç.',
    insufficient_frames: 'Yeterli kare okunamadı. Net bir kayıt seç.', multiple_people: 'Kadrajda tek kişi olmalı.',
    body_not_visible: 'Omuz, kalça, dirsek, el bileği, diz ve ayak bilekleri görünmeli.',
    unsupported_motion: 'En az 2 saniye boyunca korunan bir duruş bulunamadı. Kamerayı sabitle ve hedef duruşu kesintisiz koru.' };
export function StaticPoseResults({ map, onPreview, onStartLive, onSaveTemplate, savedReferenceIds }: {
    map: MotionMap;
    onPreview: (start: number, end: number) => void;
    onStartLive?: ((template: ExerciseTemplate) => void) | undefined;
    onSaveTemplate?: ((template: ExerciseTemplate, name: string) => Promise<SavedReferenceTemplate>) | undefined;
    savedReferenceIds?: readonly string[] | undefined;
}) {
    const analysis = useMemo(() => map.staticAnalysis ?? analyzeStaticPose(map), [map]);
    const [selected, setSelected] = useState(0), [name, setName] = useState('Sabit duruşum'), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [saved, setSaved] = useState<Record<number, string>>({}), pending = useRef(false);
    useEffect(() => { setSelected(0); setSaved({}); setName('Sabit duruşum'); setError(''); }, [map]);
    const template = analysis.holds[selected] ?? analysis.holds[0];
    const id = template && saved[template.interval.id], isSaved = !!id && (!savedReferenceIds || savedReferenceIds.includes(id));
    async function save(start: boolean) {
        if (!template || pending.current)
            return;
        pending.current = true;
        setBusy(true);
        setError('');
        try {
            if (onSaveTemplate && !isSaved) {
                const record = await onSaveTemplate(template, name);
                setSaved(old => ({ ...old, [template.interval.id]: record.id }));
            }
            if (start)
                onStartLive?.(template);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Duruş kaydedilemedi. Tekrar dene.');
        }
        finally {
            pending.current = false;
            setBusy(false);
        }
    }
    return <section className="motion-results"><p className="eyebrow">SABİT DURUŞ ANALİZİ</p>
    <h2>{template ? 'Sabit duruş referansı hazır' : 'Sabit duruş şablonu oluşturulamadı'}</h2>
    {analysis.decision.status === 'rejected' && <div className="qualification-card rejected" role="status">
      {analysis.decision.reasons.map(r => <p key={r}>{reasons[r] ?? 'Bu görüntüden güvenilir bir duruş çıkarılamadı.'}</p>)}
      <p>Bu ret kişinin hareketi yapamadığı anlamına gelmez.</p></div>}
    {template && <><div className="generic-start-card"><StaticReferenceFigure template={template}/><div><h3>Seçilen referans duruş</h3>
      <p>{(template.interval.startMs / 1000).toFixed(1)}–{(template.interval.endMs / 1000).toFixed(1)} sn aralığı. Başlangıçta en uzun kararlı aralık seçilir.</p></div></div>
      <label>Referans aralığı<select value={selected} disabled={busy} onChange={e => setSelected(Number(e.target.value))}>
        {analysis.holds.map((t, i) => <option key={t.interval.id} value={i}>Duruş {i + 1} · {(t.interval.startMs / 1000).toFixed(1)}–{(t.interval.endMs / 1000).toFixed(1)} sn</option>)}</select></label>
      <button className="secondary-button" disabled={busy} onClick={() => onPreview(template.interval.startMs, template.interval.endMs)}>Seçilen duruşu videoda izle</button>
      <p>İstediğin duruşun seçildiğini kontrol et. Egzersizin adını veya güvenli yapılışını otomatik doğrulamıyoruz.</p>
      <label>Egzersiz adı<input value={name} maxLength={80} disabled={busy} onChange={e => setName(e.target.value)}/></label>
      <div className="template-actions">{onStartLive && <button className="primary-button" disabled={busy || !name.trim()} onClick={() => void save(true)}>{busy ? 'Kaydediliyor…' : isSaved ? 'Süre hedefini seç' : 'Kaydet ve süre hedefini seç'}</button>}
      {onSaveTemplate && <button className="secondary-button" disabled={busy || isSaved || !name.trim()} onClick={() => void save(false)}>{isSaved ? 'Koleksiyonda kayıtlı' : 'Yalnızca kaydet'}</button>}</div>
      <p>Canlı oturumda hedef süreyi ayrıca seçersin. Referans videosuyla aynı süre zorunlu değil.</p></>}
    <details className="analysis-details"><summary>Ölçüm verileri</summary>
      <p>{analysis.evidence.usableFrames} / {analysis.evidence.sampledFrames} karede tüm gerekli eklemler ölçülebildi.</p>
      <button className="secondary-button" onClick={() => downloadMotionMap({ ...map, staticAnalysis: analysis, decision: analysis.decision, evidence: analysis.evidence, qualification: analysis.decision.status })}>Hareket verisini indir (.json)</button>
    </details>
    {error && <p className="message error" role="alert">{error}</p>}
  </section>;
}

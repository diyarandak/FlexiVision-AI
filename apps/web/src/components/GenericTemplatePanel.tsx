import { useMemo, useState } from 'react';
import type { GenericCycleAnalysis, GenericMotionTemplate, MotionMap, ReferenceDecision, SavedReferenceTemplate } from '@flexivision/contracts';
import { buildGenericTemplate } from '@flexivision/core';

function seconds(ms: number) { return (ms / 1000).toFixed(1); }

function downloadTemplate(template: GenericMotionTemplate) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `flexivision-motion-template-${template.repetition.id}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function GenericTemplatePanel({ map, analysis, decision, onPreview, onStartLive, onSaveTemplate, savedReferenceIds }: {
  map: MotionMap;
  analysis: GenericCycleAnalysis;
  decision: ReferenceDecision;
  onPreview: (startMs: number, endMs: number) => void;
  onStartLive?: ((template: GenericMotionTemplate) => void) | undefined;
  onSaveTemplate?: ((template: GenericMotionTemplate, name: string) => Promise<SavedReferenceTemplate>) | undefined;
  savedReferenceIds?: readonly string[] | undefined;
}) {
  const [selectedId, setSelectedId] = useState(1);
  const [name, setName] = useState('Hareket referansım');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState<{ id: string; template: GenericMotionTemplate; name: string } | null>(null);
  const selected = analysis.repetitions.find(item => item.id === selectedId) ?? analysis.repetitions[0];
  const template = useMemo(() => {
    if (decision.status !== 'accepted' || !selected) return null;
    try { return buildGenericTemplate(map, selected.id, decision); }
    catch { return null; }
  }, [map, selected, decision]);
  const isSaved = saved?.template === template && saved?.name === name.trim() && (!savedReferenceIds || savedReferenceIds.includes(saved.id));
  async function saveAndMaybeStart(startAfterSave: boolean) {
    if (!template || !onSaveTemplate || saving || !name.trim()) return;
    if (isSaved) { if (startAfterSave) onStartLive?.(template); return; }
    setSaving(true); setSaveError('');
    try {
      const record = await onSaveTemplate(template, name.trim());
      setSaved({ id: record.id, template, name: record.name });
      if (startAfterSave) onStartLive?.(template);
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : 'Egzersiz kaydedilemedi. Tekrar dene.');
    } finally { setSaving(false); }
  }
  return <section className="template-panel" aria-labelledby="generic-template-title">
    <div className="template-heading"><h2 id="generic-template-title">{template ? 'Harekete geç' : 'Hareket şablonu'}</h2>
      <span className={`local-badge ${template ? 'accepted-badge' : ''}`}>{template ? 'Hareket izi hazır' : 'Şablon oluşturulamadı'}</span></div>
    {analysis.repetitions.length > 0 ? <>
      <p className="result-explanation"><strong>{analysis.repetitions.length} tam hareket bulundu.</strong> {selected ? `${selected.id}. tekrar seçildi.` : ''}</p>
    </> : <p className="message">{analysis.reason === 'tracking_gap' ? 'Hareket sırasında izleme kesildi. Tüm eklemlerin kesintisiz göründüğü bir video dene.'
      : analysis.reason === 'body_not_visible' || analysis.reason === 'insufficient_tracked_landmarks' ? 'Hareket eden eklemler yeterince görülemiyor. Kişiyi kadrajın ortasına al ve ışığı iyileştir.'
        : analysis.reason === 'unstable_view' ? 'Kamera açısı veya görüntü hareketi değişiyor. Kamerayı sabitleyerek yeniden çek.'
          : 'Başlangıç duruşundan uzaklaşıp geri dönen belirgin bir tam hareket bulunamadı. Hareketin öncesini ve sonrasını videoya ekle.'}</p>}
    {template && selected && <>
      <p className="pace-note">Canlıda videoyla aynı hızda hareket etmen gerekmez. Hareketin yönü ve görünür eklemler aynı kamera açısından karşılaştırılır.</p>
      {onStartLive && <button className="primary-button live-start-btn template-primary-action" disabled={saving || Boolean(onSaveTemplate && !name.trim())}
        onClick={() => { if (onSaveTemplate) void saveAndMaybeStart(true); else onStartLive(template); }}>
        {saving ? 'Kaydediliyor…' : onSaveTemplate && !isSaved ? 'Kaydet ve başla' : 'Egzersize başla'} <span aria-hidden="true">▶</span>
      </button>}
      {onSaveTemplate && onStartLive && !isSaved && <p className="template-save-note">“{name.trim() || 'Hareket referansım'}” adıyla bu cihazda kaydedilir.</p>}
    </>}
    {saveError && <p className="message error" role="alert">{saveError}</p>}
    {isSaved && <p className="message" role="status">Egzersiz kaydedildi. Sonraki seanslarda Egzersizlerim bölümünden başlayabilirsin.</p>}
    {analysis.repetitions.length > 0 && <details className="template-inspection template-more-options"><summary>Tekrarı seç ve ayrıntıları gör</summary>
      <div className="repetition-options" role="group" aria-label="Hareket döngüsü seç">
        {analysis.repetitions.map(item => <button key={item.id} className={`repetition-option ${item.id === selected?.id ? 'selected' : ''}`}
          aria-pressed={item.id === selected?.id} disabled={saving} onClick={() => setSelectedId(item.id)}>
          <strong>Tekrar {item.id}</strong><span>{seconds(item.startMs)}–{seconds(item.endMs)} sn</span>
        </button>)}
      </div>
      {selected && <div className="template-actions"><button className="secondary-button" onClick={() => onPreview(selected.startMs, selected.endMs)}>Seçili tekrarı videoda izle</button></div>}
      {template && <><dl className="template-details"><div><dt>Tekrar süresi</dt><dd>{seconds(template.durationMs)} sn</dd></div>
        <div><dt>İzlenen eklem</dt><dd>{template.trackedIndices.length}</dd></div>
        <div><dt>Hareket eden eklem</dt><dd>{template.motionIndices.length}</dd></div></dl>
        <button className="secondary-button" onClick={() => downloadTemplate(template)}>Hareket şablonunu indir (.json)</button>
      </>}
      {template && onSaveTemplate && <form className="reference-name-form" onSubmit={event => { event.preventDefault(); void saveAndMaybeStart(false); }}>
        <label>Egzersiz adı<input value={name} onChange={event => setName(event.target.value)} maxLength={80} required disabled={saving} /></label>
        <button className="secondary-button" disabled={saving || !name.trim() || isSaved}>{saving ? 'Kaydediliyor…' : 'Yalnızca kaydet'}</button>
      </form>}
    </details>}
    {analysis.trackingBreaks > 0 && <p className="implementation-note">{analysis.trackingBreaks} takip kesintisi görüldü; eksik aralıklar şablonla doldurulmadı.</p>}
    <p className="implementation-note">Bu şablon egzersizin adını veya kişiye uygunluğunu belirlemez. Kameradaki görünür hareket izini karşılaştırır; güvenli egzersiz değerlendirmesi değildir.</p>
  </section>;
}

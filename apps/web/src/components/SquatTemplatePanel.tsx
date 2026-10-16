import { useMemo, useState } from 'react';
import type { MotionMap, ReferenceDecision, SavedReferenceTemplate, SquatCycleAnalysis, SquatPhase, SquatTemplate } from '@flexivision/contracts';
import { buildSquatTemplate, detectSquatCycles, squatCycleMessage } from '@flexivision/core';

const PHASE_LABELS: Record<SquatPhase, string> = { descent: 'İniş', bottom: 'Dip', ascent: 'Çıkış' };
function seconds(ms: number) { return (ms / 1000).toFixed(1); }
function downloadTemplate(template: SquatTemplate) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `flexivision-squat-template-${template.repetition.id}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SquatTemplatePanel({
  map,
  analysis: providedAnalysis,
  decision,
  onPreview,
  onStartLive,
  onSaveTemplate,
  savedReferenceIds,
}: {
  map: MotionMap;
  analysis?: SquatCycleAnalysis;
  decision?: ReferenceDecision;
  onPreview: (startMs: number, endMs: number) => void;
  onStartLive?: ((template: SquatTemplate) => void) | undefined;
  onSaveTemplate?: ((template: SquatTemplate, name: string) => Promise<SavedReferenceTemplate>) | undefined;
  savedReferenceIds?: readonly string[] | undefined;
}) {
  const analysis = useMemo(() => providedAnalysis ?? detectSquatCycles(map), [providedAnalysis, map]);
  const [selectedId, setSelectedId] = useState(1);
  const [name, setName] = useState('Squat referansım'), [saving, setSaving] = useState(false), [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState<{ id: string; template: SquatTemplate; name: string } | null>(null);
  const template = useMemo(() => analysis.repetitions.some(repetition => repetition.id === selectedId)
    ? buildSquatTemplate(map, selectedId, decision) : null, [map, analysis, selectedId, decision]);
  const repetition = template?.repetition;
  const isAccepted = decision?.status === 'accepted';
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
  return <section className="template-panel" aria-labelledby="template-title">
    <div className="template-heading">
      <h2 id="template-title">{isAccepted ? 'Harekete geç' : 'Tekrar şablonu'}</h2>
      <span className={`local-badge ${isAccepted ? 'accepted-badge' : ''}`}>
        {isAccepted ? 'Squat onaylandı' : 'Squat taslağı'}
      </span>
    </div>
    {analysis.status !== 'ready' ? <p className="message">{analysis.status === 'insufficient_data'
      ? 'Tek bir taraftaki diz ve kalça boyunca yeterli kesintisiz ölçüm yok. Tüm vücudun göründüğü bir video seç.'
      : squatCycleMessage(analysis).guidance}</p>
      : <>
        <p className="result-explanation"><strong>{analysis.repetitions.length} tam tekrar bulundu.</strong> {selectedId}. tekrar seçildi.</p>
        {repetition && <>
          {isAccepted && <p className="pace-note">Kendi hızında yap. Videoyla aynı sürede bitirmen gerekmez; iniş, dip ve çıkışın eşleştirilir.</p>}
          {isAccepted && onStartLive && <button className="primary-button live-start-btn template-primary-action"
            disabled={saving || Boolean(onSaveTemplate && !name.trim())}
            onClick={() => { if (onSaveTemplate) void saveAndMaybeStart(true); else onStartLive(template!); }}>
            {saving ? 'Kaydediliyor…' : onSaveTemplate && !isSaved ? 'Kaydet ve başla' : 'Egzersize başla'} <span aria-hidden="true">▶</span>
          </button>}
          {isAccepted && onSaveTemplate && onStartLive && !isSaved && <p className="template-save-note">“{name.trim() || 'Squat referansım'}” adıyla bu cihazda kaydedilir.</p>}
          {saveError && <p className="message error" role="alert">{saveError}</p>}
          {isSaved && <p className="message" role="status">Egzersiz kaydedildi. Sonraki seanslarda Egzersizlerim bölümünden başlayabilirsin.</p>}
          <details className="template-inspection template-more-options"><summary>Tekrarı seç ve ayrıntıları gör</summary>
          <div className="repetition-options" role="group" aria-label="Referans tekrarı seç">
            {analysis.repetitions.map(item => <button key={item.id} className={`repetition-option ${item.id === selectedId ? 'selected' : ''}`}
              aria-pressed={item.id === selectedId} disabled={saving} onClick={() => setSelectedId(item.id)}>
              <strong>Tekrar {item.id}</strong><span>{seconds(item.startMs)}–{seconds(item.endMs)} sn</span>
            </button>)}
          </div>
          <div className="phase-timeline" aria-label="Seçilen tekrarda iniş, dip ve çıkış fazları">
            {repetition.phases.map(interval => <div key={interval.phase} className={`phase ${interval.phase}`}
              style={{ flexGrow: interval.endMs - interval.startMs }}>
              <strong>{PHASE_LABELS[interval.phase]}</strong><span>{seconds(interval.endMs - interval.startMs)} sn</span>
            </div>)}
          </div>
          <dl className="template-details">
            <div><dt>Tekrar süresi</dt><dd>{seconds(template!.durationMs)} sn</dd></div>
            <div><dt>İzlenen taraf</dt><dd>{repetition.side === 'left' ? 'Sol' : 'Sağ'}</dd></div>
            <div><dt>Diz açı aralığı</dt><dd>{Math.round(repetition.kneeRange.min)}–{Math.round(repetition.kneeRange.max)}°</dd></div>
          </dl>
          <div className="template-actions">
            <button className="secondary-button" onClick={() => onPreview(repetition.startMs, repetition.endMs)}>Seçilen tekrarı videoda izle</button>
            <button className="secondary-button" onClick={() => downloadTemplate(template!)}>Tekrar şablonunu indir (.json)</button>
          </div>
          {isAccepted && onSaveTemplate && <form className="reference-name-form" onSubmit={event => { event.preventDefault(); void saveAndMaybeStart(false); }}>
            <label>Egzersiz adı<input value={name} onChange={event => setName(event.target.value)} maxLength={80} required disabled={saving} /></label>
            <button className="secondary-button" disabled={saving || !name.trim() || isSaved}>
              {saving ? 'Kaydediliyor…' : 'Yalnızca kaydet'}</button>
          </form>}
          </details>
        </>}
      </>}
    {analysis.trackingBreaks > 0 && <p className="implementation-note">{analysis.trackingBreaks} takip kesintisi görüldü. Kesintiyi aşan döngüler şablona alınmadı.</p>}
    <p className="implementation-note">
      {isAccepted
        ? 'Referans hazır. Aynı kamera açısından, kendi hızında çalışabilirsin.'
        : 'Referans kriterleri karşılanmadığı için bu şablon yalnızca taslak olarak tutulur ve canlı egzersiz oturumunda kullanılamaz.'}
    </p>
  </section>;
}

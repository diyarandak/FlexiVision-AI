import type { GenericCycleAnalysis, ReferenceDecision, ReferenceEvidence, RejectionCode } from '@flexivision/contracts';

const REASONS: Record<RejectionCode, { label: string; guidance: string }> = {
  invalid_evidence: { label: 'Analiz verisi tutarsız', guidance: 'Videoyu yeniden analiz et. Sorun sürerse başka bir kayıt dene.' },
  duration_out_of_range: { label: 'Video süresi uygun değil', guidance: '3–60 saniyelik bir video seç.' },
  insufficient_frames: { label: 'Yeterli kare ölçülemedi', guidance: 'Kişinin net ve yeterince büyük göründüğü bir kayıt dene.' },
  multiple_people: { label: 'Birden fazla kişi göründü', guidance: 'Tek kişinin bulunduğu bir video seç.' },
  body_not_visible: { label: 'Hareket eden eklemler görünmüyor', guidance: 'Kolların ve bacakların hareket boyunca kadrajda olduğu bir video dene.' },
  unsupported_view: { label: 'Kamera açısı doğrulanamadı', guidance: 'Kamerayı sabitle, tek açıdan ve tüm hareket görünürken yeniden çek.' },
  unsupported_motion: { label: 'Belirgin tekrarlı hareket bulunamadı', guidance: 'Başlangıç duruşundan uzaklaşıp geri dönen, net bir hareket kaydet.' },
  incomplete_repetition: { label: 'Tam hareket döngüsü bulunamadı', guidance: 'Hareketin başlangıcını, dönüş noktasını ve başlangıç duruşuna dönüşünü videoya ekle.' },
};

export function GenericReferenceDecisionCard({ decision, evidence, analysis }: {
  decision: ReferenceDecision;
  evidence: ReferenceEvidence;
  analysis: GenericCycleAnalysis;
}) {
  const usablePercent = Math.round(evidence.usableFrames / Math.max(1, evidence.sampledFrames) * 100);
  if (decision.status === 'accepted') return <div className="qualification-card accepted" role="region" aria-label="Referans uygunluk sonucu">
    <div className="qualification-header"><span className="qualification-badge accepted" aria-hidden="true">✓ Onaylandı</span></div>
    <h3>Hareket referansı hazır</h3>
    <p className="qualification-desc">Görünür ve tekrarlanan hareketten sayısal bir iz çıkarıldı. Bu onay hareketin türünü, doğru yapıldığını veya kişi için güvenli olduğunu doğrulamaz.</p>
    <details className="qualification-evidence"><summary>Analiz kanıtı</summary><div className="qualification-metrics">
      <div><strong>{analysis.repetitions.length}</strong><span>Tam döngü</span></div>
      <div><strong>{analysis.trackedIndices.length}</strong><span>İzlenen eklem</span></div>
      <div><strong>%{usablePercent}</strong><span>Kullanılabilir kare</span></div>
    </div></details>
  </div>;
  const reasons = decision.reasons.filter(code => !(code === 'unsupported_motion' && decision.reasons.includes('incomplete_repetition'))
    && !(code === 'unsupported_view' && evidence.view === 'unknown' && decision.reasons.includes('body_not_visible')));
  return <div className="qualification-card rejected" role="region" aria-label="Referans uygunluk sonucu">
    <div className="qualification-header"><span className="qualification-badge rejected" aria-hidden="true">✕ Kabul Edilmedi</span></div>
    <h3>Hareket şablonu oluşturulamadı</h3>
    <p className="qualification-desc">Eklem noktaları görülebilir; canlı karşılaştırma için kesintisiz, güvenilir ve tamamlanmış bir hareket gerekir.</p>
    <div className="rejection-reasons" role="list">{reasons.map(code => <div key={code} className="rejection-item" role="listitem">
      <strong>{REASONS[code].label}</strong><p>{REASONS[code].guidance}</p>
    </div>)}</div>
    <p className="rejection-reassurance">Bu sonuç hareketin yanlış yapıldığını göstermez; bu videodan güvenilir bir şablon çıkarılamadığını gösterir.</p>
  </div>;
}

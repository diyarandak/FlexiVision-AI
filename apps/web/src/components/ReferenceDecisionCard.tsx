import type { ReferenceDecision, ReferenceEvidence, SquatCycleAnalysis } from '@flexivision/contracts';
import { REFERENCE_REJECTION_MESSAGES, squatCycleMessage } from '@flexivision/core';

interface ReferenceDecisionCardProps {
  decision: ReferenceDecision;
  evidence: ReferenceEvidence;
  analysis: SquatCycleAnalysis;
}

export function ReferenceDecisionCard({ decision, evidence, analysis }: ReferenceDecisionCardProps) {
  const isAccepted = decision.status === 'accepted';
  const sideLabel = analysis.side === 'left' ? 'Sol taraf' : analysis.side === 'right' ? 'Sağ taraf' : 'Belirsiz';
  const usablePercent = Math.round((evidence.usableFrames / Math.max(1, evidence.sampledFrames)) * 100);
  const cycleMessage = squatCycleMessage(analysis);

  if (isAccepted) {
    return (
      <div className="qualification-card accepted" role="region" aria-label="Referans uygunluk sonucu">
        <div className="qualification-header">
          <span className="qualification-badge accepted" aria-hidden="true">✓ Onaylandı</span>
        </div>
        <h3>Referans video onaylandı</h3>
        <p className="qualification-desc">
          Squat ön ayarında tam döngü, eklem görünürlüğü ve yandan görüntü kriterleri karşılandı. Bu sonuç hareketin güvenli veya kusursuz yapıldığını göstermez.
        </p>
        <details className="qualification-evidence"><summary>Analiz kanıtı</summary><div className="qualification-metrics">
          <div>
            <strong>{evidence.completeRepetitions}</strong>
            <span>Tam tekrar</span>
          </div>
          <div>
            <strong>{sideLabel}</strong>
            <span>İzlenen açı</span>
          </div>
          <div>
            <strong>%{usablePercent}</strong>
            <span>Kullanılabilir kare</span>
          </div>
        </div></details>
      </div>
    );
  }

  // One measured partial-cycle explanation covers both incomplete/unknown motion.
  const reasons = decision.reasons.filter(code => !(code === 'unsupported_motion' && evidence.motion === 'unknown'
    && analysis.incompleteCause && decision.reasons.includes('incomplete_repetition')));
  return (
    <div className="qualification-card rejected" role="region" aria-label="Referans uygunluk sonucu">
      <div className="qualification-header">
        <span className="qualification-badge rejected" aria-hidden="true">✕ Kabul Edilmedi</span>
      </div>
      <h3>{reasons.length === 1 && reasons[0] === 'incomplete_repetition' ? cycleMessage.label : 'Referans şablonu oluşturulamadı'}</h3>
      <p className="qualification-desc">
        İskeletin görünmesi eklemlerin algılandığını gösterir. Canlı egzersiz için ayrıca kesintisiz, tamamlanmış bir squat ve uygun kamera açısı gerekir.
      </p>
      <div className="rejection-reasons" role="list">
        {reasons.map(code => {
          const info = code === 'incomplete_repetition' ? cycleMessage
            : code === 'unsupported_motion' && evidence.motion === 'unknown'
              ? { label: 'Hareket türü doğrulanamadı', guidance: 'Mevcut sürüm yalnızca yandan çekilmiş tam squat döngüsünü destekler. Tam tekrar bulunamadığı için hareket türü doğrulanamadı.' }
              : REFERENCE_REJECTION_MESSAGES[code];
          return (
            <div key={code} className="rejection-item" role="listitem">
              <strong>{info.label}</strong>
              <p>{info.guidance}</p>
            </div>
          );
        })}
      </div>
      <p className="rejection-reassurance">
        Not: Bu durum egzersizin yanlış yapıldığı anlamına gelmez. Sistemin videodan güvenilir bir hareket şablonu çıkaramadığını gösterir.
      </p>
    </div>
  );
}

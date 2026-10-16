import type { LiveSessionSummary } from '@flexivision/contracts';
import { squatReportConclusion, squatReportDifferences, squatReportText } from '../aggregateSessionReport.ts';
import { AggregateReportDownload } from './AggregateReportDownload.tsx';

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} sn`;
const angle = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}°`;

export function SessionSummaryView({ summary }: { summary: LiveSessionSummary }) {
  const conclusion = squatReportConclusion(summary), differences = squatReportDifferences(summary);
  return <div className="session-summary">
    <h3>{conclusion.title}</h3><p>{conclusion.explanation}</p>
    {differences.length > 0 && <ul aria-label="Ölçülen referans farkları">{differences.map(text => <li key={text}>{text}</li>)}</ul>}
    <div className="summary-grid">
      <div><strong>{summary.repetitionCount}</strong><span>Tamamlanan tekrar</span></div>
      <div><strong>{summary.cleanRepetitions}</strong><span>Sapma gözlenmeyen tekrar</span></div>
      <div><strong>{seconds(summary.durationMs)}</strong><span>İlk ölçümden bitişe süre</span></div>
      <div><strong>{seconds(summary.trackedMs)}</strong><span>İzlenebilen süre</span></div>
      <div><strong>{seconds(summary.unmeasuredMs)}</strong><span>Ölçülemeyen süre</span></div>
      <div><strong>{summary.trackedFrames} / {summary.sampledFrames}</strong><span>İzlenebilen / alınan kare</span></div>
    </div>
    <p className="implementation-note">{summary.bodyProfileUsed
      ? 'Kayıtlı vücut profiliyle konumlar ölçeklendi.' : 'Bu oturumda kayıtlı vücut profili kullanılmadı.'}
      {' '}İzlenebilen süre, en fazla 0,5 saniye aralıklı iki geçerli ölçüm arasındaki süredir. Boşluklar doğru hareket sayılmaz.</p>
    <div className="summary-table-wrap"><table className="summary-table">
      <caption>Referansla açı farkı · izlenebilen kareler</caption>
      <thead><tr><th scope="col">Eklem</th><th scope="col">Ortalama fark</th><th scope="col">En büyük fark</th><th scope="col">Ölçüm</th></tr></thead>
      <tbody>{(['knee', 'hip'] as const).map(key => <tr key={key}>
        <th scope="row">{key === 'knee' ? 'Diz' : 'Kalça'}</th>
        <td>{angle(summary.deviations[key].mean)}</td><td>{angle(summary.deviations[key].max)}</td><td>{summary.deviations[key].samples}</td>
      </tr>)}</tbody>
    </table></div>
    <p>Ses adayı: {summary.cueCandidatesCount} · Başlayan sesli uyarı: {summary.spokenCues.length}</p>
    {summary.spokenCues.length > 0 && <ul className="session-cues">{Array.from(new Set(summary.spokenCues.map(c => c.text))).map(text =>
      <li key={text}>{text} <small>({summary.spokenCues.filter(c => c.text === text).length} kez)</small></li>)}</ul>}
    <p className="implementation-note">Açı farkları görüntü düzleminde ölçülür. Sessiz bir oturum doğru form onayı değildir; profil kaydı kişiye özel güvenli derinlik belirlemez.</p>
    <AggregateReportDownload text={squatReportText(summary)} filename="flexivision-squat-raporu.txt" />
  </div>;
}

import { LastAttemptReport } from './LastAttemptReport.tsx';
import { StaticSessionSummaryView } from './StaticSessionSummaryView.tsx';
import { useRef, useState } from 'react';
import { ConfirmDelete } from './ConfirmDelete.tsx';
import type { SessionRecord } from '@flexivision/contracts';
import { GenericSessionSummaryView } from './GenericSessionSummaryView.tsx';
import { SessionSummaryView } from './SessionSummaryView.tsx';

function exportRecord(record: SessionRecord) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `flexivision-session-${record.id}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Props {
  records: SessionRecord[]; loading: boolean; error: string;
  onRemove: (id: string) => void | boolean | Promise<void | boolean>; onClear: () => void | boolean | Promise<void | boolean>; onRetry?: (() => void) | undefined;
}
export function SessionHistoryPanel({ records, loading, error, onRemove, onClear, onRetry }: Props) {
  const [mutating, setMutating] = useState(false);
  const pending = useRef(false);
  const locked = loading || mutating;
  async function mutate(action: Props['onClear']) {
    if (pending.current) return false;
    pending.current = true; setMutating(true);
    try { return await action(); } finally { pending.current = false; setMutating(false); }
  }
  return <section className="card session-history" aria-labelledby="history-title">
    <div className="card-heading"><div><p className="eyebrow">CİHAZINDA SAKLANIR</p><h2 id="history-title">Oturum geçmişi</h2></div>
      {(records.length > 0 || error) && <ConfirmDelete label="Geçmişi temizle" description="Bu cihazdaki tüm oturum özetleri silinecek. Profilin ve egzersizlerin korunur. Bu işlem geri alınamaz." disabled={locked} onConfirm={() => mutate(onClear)} />}</div>
    <p className="implementation-note">Son 50 oturumun özetini burada açabilirsin. Video ve kamera görüntüsü kaydedilmez. Site verileri silinirse geçmiş de silinir.</p>
    <LastAttemptReport />
    {error && <p className="message error" role="alert">{error}</p>}
    {error && onRetry && <button className="secondary-button" disabled={locked} onClick={onRetry}>Geçmişi yeniden oku</button>}
    {loading ? <p role="status">Geçmiş yükleniyor…</p> : error && records.length === 0 ? <p>Geçmiş şu an gösterilemiyor. Mevcut kayıtların değiştirilmedi.</p> : records.length === 0 ? <p>Henüz kaydedilmiş oturum yok. Canlı oturum bitince özeti burada görünür.</p> :
      <div className="history-list">{records.map(record => <details className="history-entry" key={record.id}>
        <summary><span><strong>{record.exercise === 'static-pose' ? `Sabit duruş · ${(record.summary.matchedMs/1000).toFixed(1)} sn` : `${record.exercise === 'squat' ? 'Squat' : 'Serbest hareket'} · ${record.summary.repetitionCount} tekrar`}</strong>
          <small>{new Date(record.savedAt).toLocaleString('tr-TR')} · {record.endReason === 'finished' ? 'Bitirildi' : 'Kesildi'}</small></span>
          <span>{(record.summary.durationMs / 1000).toFixed(1)} sn</span></summary>
        <div className="history-detail"><p>{record.exercise === 'static-pose' ? `Referans duruş ${record.reference.intervalId}` : `Referans tekrar ${record.reference.repetitionId}`}{record.exercise === 'squat'
          ? ` · ${record.reference.side === 'left' ? 'Sol' : 'Sağ'} taraf` : record.exercise === 'static-pose' ? ' · Sabit duruş' : ' · 2B hareket yolu'}</p>
          {record.exercise === 'static-pose' ? <StaticSessionSummaryView summary={record.summary} /> : record.exercise === 'squat' ? <SessionSummaryView summary={record.summary} />
            : <GenericSessionSummaryView summary={record.summary} />}
          <div className="template-actions"><button className="secondary-button" onClick={() => exportRecord(record)}>Özeti indir (.json)</button>
            <ConfirmDelete label="Bu oturumu sil" description="Bu oturumun özeti cihazdan silinecek. Bu işlem geri alınamaz." disabled={locked} onConfirm={() => mutate(() => onRemove(record.id))} /></div>
        </div>
      </details>)}</div>}
  </section>;
}

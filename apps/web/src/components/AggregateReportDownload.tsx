import { useState } from 'react';

export function AggregateReportDownload({ text, filename, label = 'Raporu indir (.txt)' }: { text: string; filename: string; label?: string }) {
  const [error, setError] = useState(false);
  function download() {
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = filename; link.click();
      setError(false);
    } catch { setError(true); }
    finally { if (url) { const objectUrl = url; setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); } }
  }
  return <div><button className="secondary-button" onClick={download}>{label}</button>
    {error && <p className="message error" role="alert">Rapor indirilemedi. Yeniden deneyebilir veya bu ekranın görüntüsünü paylaşabilirsin.</p>}</div>;
}

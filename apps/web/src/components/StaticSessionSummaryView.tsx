import type { StaticSessionSummary } from '@flexivision/contracts';
import { staticReportConclusion, staticReportText } from '../aggregateSessionReport.ts';
import { AggregateReportDownload } from './AggregateReportDownload.tsx';
export function StaticSessionSummaryView({ summary: s }: {
    summary: StaticSessionSummary;
}) {
    const conclusion = staticReportConclusion(s);
    return <div><h3>{conclusion.title}</h3><p>{conclusion.explanation}</p><div className="metrics">
    <div><strong>{(s.matchedMs / 1000).toFixed(1)} sn</strong><span>Referansa uyan süre</span></div>
    <div><strong>{s.targetMs / 1000} sn</strong><span>Seçilen hedef</span></div>
    <div><strong>{(s.durationMs / 1000).toFixed(1)} sn</strong><span>Geçen süre</span></div></div>
    <p>{s.trackedFrames}/{s.sampledFrames} kare izlenebildi. {s.spokenCuesCount} sesli düzeltme başladı.</p>
    <p>Görüş kaybı ve ölçülen sapma sırasında tutma süresi ilerlemedi. Bu sonuç görüntüdeki referans benzerliğidir; kişisel güvenlik onayı değildir.</p>
    <AggregateReportDownload text={staticReportText(s)} filename="flexivision-sabit-durus-raporu.txt" /></div>;
}

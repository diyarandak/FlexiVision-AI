import { useId } from 'react';
import { genericReportConclusion, genericReportFindings, genericReportText } from '../genericSessionReport.ts';
import { AggregateReportDownload } from './AggregateReportDownload.tsx';
import type { GenericSessionSummary } from '@flexivision/contracts';
import { genericSessionReview, genericSimpleReportText, repetitionGoalProgress } from '@flexivision/core';

export function GenericSessionSummaryView({ summary, reportText }: { summary: GenericSessionSummary; reportText?:string|undefined }) {
  const id = useId();
  const review=genericSessionReview(summary), conclusion=genericReportConclusion(summary), findings=genericReportFindings(summary);
  const goal=summary.repetitionGoal, progress=goal ? repetitionGoalProgress(goal,summary.repetitionCount) : null;
  return <div className="session-summary">
    <div className="report-conclusion" role="status"><p className="review-eyebrow">EGZERSİZ ÖZETİN</p>
      <h3>{review.outcome}</h3><p>{review.completion}</p>
      {progress && <strong>{progress.complete ? 'Hedef tamamlandı' : 'Hedefe kalan tekrarlar var'}</strong>}</div>
    <div className="summary-grid">
      <div><strong>{summary.repetitionCount}{progress ? ` / ${progress.target}` : ''}</strong><span>Tamamlanan tekrar</span></div>
      <div><strong>{Math.round(summary.durationMs/1000)} sn</strong><span>Başlangıçtan sonraki süre</span></div>
    </div>
    <section className="review-card" aria-labelledby={`${id}-strengths`}><h4 id={`${id}-strengths`}>İyi gidenler</h4>
      {review.positives.length ? <ul>{review.positives.map(text=><li key={text}>{text}</li>)}</ul>
        : <p>Henüz olumlu hareket değerlendirmesi için yeterli ölçüm yok.</p>}</section>
    <section className="review-card review-focus" aria-labelledby={`${id}-improvements`}><h4 id={`${id}-improvements`}>Geliştirilecekler</h4>
      {review.improvements.length ? <ol>{review.improvements.map(item=><li key={item.finding}><strong>{item.finding}</strong><p>{item.instruction}</p></li>)}</ol>
        : <p>Kalıcı bir hareket düzeltmesi kaydedilmedi. Görünmeyen bölümler için doğru/yanlış kararı veremiyoruz.</p>}</section>
    <section className="review-card"><h4>Kamera seni ne kadar izleyebildi?</h4><p>{review.visibility}</p></section>
    <section className="review-card review-next"><h4>Sonraki denemede tek hedefin</h4><p>{review.next}</p></section>
    <AggregateReportDownload text={genericSimpleReportText(summary)} filename="flexivision-egzersiz-ozeti.txt" label="Kısa raporu indir (.txt)" />
    <p className="implementation-note">{review.scope}</p>
    <details className="review-technical"><summary>Teknik ayrıntılar ve inceleme raporu</summary>
      <h4>{conclusion.title}</h4><p>{conclusion.detail}</p>
      {findings.blocks.length>0 && <><h4>Ölçüm engelleri</h4><ul>{findings.blocks.slice(0,5).map(text=><li key={text}>{text}</li>)}</ul></>}
      {findings.differences.length>0 && <><h4>Referans farkları</h4><ul>{findings.differences.map(text=><li key={text}>{text}</li>)}</ul></>}
      {findings.missing.length>0 && <><h4>Görünmeyen eklemler</h4><ul>{findings.missing.map(text=><li key={text}>{text}</li>)}</ul></>}
      <p>İzlenen / alınan kare: {summary.trackedFrames} / {summary.sampledFrames}. Ölçülemeyen: {summary.unmeasuredFrames}.</p>
      <p>Ses adayı: {summary.cueCandidatesCount} · Başlayan sesli uyarı: {summary.spokenCuesCount}</p>
      <AggregateReportDownload text={reportText??genericReportText(summary)} filename="flexivision-oturum-raporu.txt" />
    </details>
  </div>;
}

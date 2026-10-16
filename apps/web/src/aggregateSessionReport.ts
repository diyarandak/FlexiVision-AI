import type { LiveSessionSummary, StaticSessionSummary } from '@flexivision/contracts';

interface ReportConclusion { title: string; explanation: string }
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} sn`;
const scope = 'Bu sonuç kamerada ölçülebilen referans benzerliğini anlatır. Hareketin anatomik olarak doğru veya kişi için güvenli olduğunu onaylamaz. Sessizlik, doğru hareket kanıtı değildir.';
const missingDetails = 'Bu sayısal özet hazırlıkta gösterilen mesajları, teknik hata nedenini veya kamera boyutlarını içermez. Ölçülemeyen bölümlerde doğru/yanlış kararı verilemez.';

const squatErrorLabels: Record<string, string> = {
  insufficient_depth: 'Çömelme derinliği referanstan az göründü',
  chest_forward: 'Gövde açısı referanstan daha öne eğik göründü',
  knee_deviation: 'Diz açısı referanstan farklı ölçüldü',
};
export function squatReportDifferences(summary: LiveSessionSummary): string[] {
  return Object.entries(summary.errorBreakdown).filter(([, frames]) => frames > 0)
    .map(([code, frames]) => `${squatErrorLabels[code] ?? `Referans farkı (${code})`}: ${frames} kare`);
}

export function squatReportConclusion(summary: LiveSessionSummary): ReportConclusion {
  if (summary.sampledFrames === 0) return { title: 'Kamera ölçümü alınamadı', explanation: 'Bu denemede karşılaştırılabilecek kamera verisi yok. Doğru veya yanlış yaptığını söyleyemiyoruz.' };
  if (summary.trackedFrames === 0) return { title: 'Hareket değerlendirilemedi', explanation: 'Kamera sonuçları geldi ancak karşılaştırma için yeterli görünürlük veya güvenilirlik sağlanmadı. Bu, egzersizi yanlış yaptığın anlamına gelmez.' };
  if (squatReportDifferences(summary).length > 0) return { title: 'Referanstan farklar ölçüldü', explanation: `${summary.repetitionCount > 0 ? `${summary.repetitionCount} tam tekrar ölçüldü.` : 'Tam bir tekrar ölçülemedi.'} Aşağıdaki farklar görülebilen karelere aittir; ölçülemeyen bölümler değerlendirilmedi.` };
  if (summary.repetitionCount === 0) return { title: 'Tam bir tekrar ölçülemedi', explanation: 'Hareketin bazı bölümleri izlendi ancak bir tam döngü doğrulanmadı. Başlangıçtan dönüşe kadar hareketi aynı kamera açısından görünür tutarak dene.' };
  if (summary.cleanRepetitions < summary.repetitionCount) return { title: 'Tekrarlar ölçüldü; tam uyum doğrulanmadı', explanation: 'Kayıt, bütün tekrarların kesintisiz ve sapmasız izlendiğini göstermiyor. Ölçülemeyen kısımları doğru yapılmış saymıyoruz.' };
  return { title: 'Ölçülen tekrarlarda sapma gözlenmedi', explanation: `${summary.repetitionCount} tamamlanmış tekrarın izlenebilen bölümlerinde sistemin kontrol ettiği referans farkları görülmedi. Bu sonuç oturumun tamamını veya bütün teknik ayrıntıları kapsamaz.` };
}

export function staticReportConclusion(summary: StaticSessionSummary): ReportConclusion {
  if (summary.sampledFrames === 0) return { title: 'Kamera ölçümü alınamadı', explanation: 'Bu denemede karşılaştırılabilecek kamera verisi yok. Duruşun hakkında doğru/yanlış kararı verilemiyor.' };
  if (summary.trackedFrames === 0) return { title: 'Duruş değerlendirilemedi', explanation: 'Kamera sonuçları geldi ancak referansla güvenilir karşılaştırma yapılamadı. Bu, duruşu yanlış yaptığın anlamına gelmez.' };
  if (summary.targetReached) return { title: 'Süre hedefi tamamlandı', explanation: `${seconds(summary.matchedMs)} boyunca güvenilir, referansa yakın duruş ölçüldü. Ölçülemeyen veya farklı görünen aralıklar bu süreye eklenmedi.` };
  if (summary.matchedMs > 0) return { title: 'Eşleşme ölçüldü; hedef tamamlanmadı', explanation: `${seconds(summary.targetMs)} hedefin ${seconds(summary.matchedMs)} bölümü ölçüldü. Hedefin bitmemesi tek başına yanlış duruş anlamına gelmez.` };
  return { title: 'Referansa uyan süre ölçülemedi', explanation: 'Bazı kareler karşılaştırıldı ancak sayacı ilerletecek kesintisiz eşleşme oluşmadı. Duruş farkı ile kesintileri bu özetten tam olarak ayıramıyoruz.' };
}

export function squatReportText(summary: LiveSessionSummary): string {
  const conclusion = squatReportConclusion(summary), differences = squatReportDifferences(summary);
  return [
    'FlexiVision · Squat oturum raporu', '', `SONUÇ: ${conclusion.title}`, conclusion.explanation, '',
    'ÖLÇÜLENLER', `Tamamlanan tekrar: ${summary.repetitionCount}`, `Sapma gözlenmeyen tekrar: ${summary.cleanRepetitions}`,
    `İlk ölçümden bitişe: ${seconds(summary.durationMs)}`, `İzlenebilen süre: ${seconds(summary.trackedMs)}`,
    `Ölçülemeyen süre: ${seconds(summary.unmeasuredMs)}`, `İzlenen / alınan kare: ${summary.trackedFrames} / ${summary.sampledFrames}`,
    `Ölçülemeyen kare: ${summary.lostFrames}`, '', 'REFERANS FARKLARI',
    ...(differences.length ? differences : ['Kayıtta bir referans farkı listelenmiyor; bu tek başına doğru hareket kanıtı değildir.']),
    ...(['knee', 'hip'] as const).map(key => {
      const value = summary.deviations[key];
      return `${key === 'knee' ? 'Diz' : 'Kalça'}: ${value.samples} ölçüm; ortalama fark ${value.mean === null ? 'ölçülmedi' : `${value.mean.toFixed(1)}°`}; en büyük fark ${value.max === null ? 'ölçülmedi' : `${value.max.toFixed(1)}°`}`;
    }), '', 'SES', `Düzeltme adayı: ${summary.cueCandidatesCount}`, `Başlayan sesli düzeltme: ${summary.spokenCues.length}`,
    ...summary.spokenCues.map(cue => `- ${cue.text}`), '', `Kayıtlı vücut profili kullanımı: ${summary.bodyProfileUsed ? 'Evet' : 'Hayır'}`,
    '', 'SINIRLAR', scope, missingDetails, 'Raporda kamera görüntüsü, ses kaydı veya vücut eklem koordinatları bulunmaz.',
  ].join('\n');
}

export function staticReportText(summary: StaticSessionSummary): string {
  const conclusion = staticReportConclusion(summary);
  return [
    'FlexiVision · Sabit duruş oturum raporu', '', `SONUÇ: ${conclusion.title}`, conclusion.explanation, '',
    'ÖLÇÜLENLER', `Referansa uyan süre: ${seconds(summary.matchedMs)}`, `Hedef süre: ${seconds(summary.targetMs)}`,
    `Hazırlık sonrası geçen süre: ${seconds(summary.durationMs)}`, `Hedef tamamlandı: ${summary.targetReached ? 'Evet' : 'Hayır'}`,
    `İzlenen / alınan kare: ${summary.trackedFrames} / ${summary.sampledFrames}`, `Ölçülemeyen kare: ${summary.unmeasuredFrames}`,
    '', 'SES', `Düzeltme adayı: ${summary.cueCandidatesCount}`, `Başlayan sesli düzeltme: ${summary.spokenCuesCount}`,
    '', 'SINIRLAR', scope, missingDetails, 'Raporda kamera görüntüsü, ses kaydı veya vücut eklem koordinatları bulunmaz.',
  ].join('\n');
}

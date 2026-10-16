import type { GenericSessionSummary } from '@flexivision/contracts';
import { genericSessionSummaryData } from './sessionRecord.ts';
import { CORRECTION_JOINT_NAMES, correctionInstruction } from './genericCorrections.ts';
import { repetitionGoalProgress } from './repetitionGoal.ts';

/** Every sentence is derived from recorded evidence; unavailable details remain unavailable. */
export function genericSessionReview(summary: GenericSessionSummary) {
  const s = genericSessionSummaryData(summary), d = s.diagnostics;
  const goal = s.repetitionGoal, progress = goal ? repetitionGoalProgress(goal,s.repetitionCount) : null;
  const completion = progress ? `${progress.target} tekrar hedefinin ${progress.total} tanesini tamamladın. ${progress.completedSets}/${goal!.sets} set bitti.`
    : `${s.repetitionCount} tam tekrar tamamlandı.`;
  const positives: string[] = [];
  if (d?.measuredStart) positives.push('Başlangıç duruşun bulundu.');
  if (s.repetitionCount > 0) positives.push(`${s.repetitionCount} kez hareketi tamamlayıp başlangıca döndün.`);
  if (d && d.correctFrames > 0 && d.incorrectFrames === 0) positives.push('Karşılaştırılabilen bölümlerde referanstan belirgin fark görülmedi.');
  const sustained = [...(d?.corrections ?? [])].filter(f => f.longestMs >= 1500 || f.spokenCount > 0)
    .sort((a,b) => b.longestMs-a.longestMs || b.frames-a.frames).slice(0,2);
  const descriptions = {bend:'referansa göre daha açık kaldı',extend:'referansa göre daha bükülü kaldı',
    raise:'referansa göre daha aşağıda kaldı',lower:'referansa göre daha yukarıda kaldı',align:'referanstaki konumdan farklı göründü'};
  const improvements = sustained.map(f => ({
    finding:`${f.phase === 'outbound' ? 'Gidişte' : 'Dönüşte'} ${CORRECTION_JOINT_NAMES[f.jointIndex]!.toLocaleLowerCase('tr-TR')} ${descriptions[f.action]}.`,
    instruction:correctionInstruction(f),
  }));
  if (!improvements.length && d && d.incorrectFrames > 0) {
    const named = Object.entries(d.deviatingJointFrames).sort((a,b) => (b[1]??0)-(a[1]??0))
      .filter(([index,count]) => (count??0)>0 && CORRECTION_JOINT_NAMES[Number(index)]).slice(0,2);
    improvements.push({finding:named.length ? `${named.map(([index]) => CORRECTION_JOINT_NAMES[Number(index)]).join(' ve ')} bölgesinde fark görüldü.`
      : 'Hareketinin bazı bölümleri referanstan farklı ölçüldü.',
      instruction:'Bu kayıtta kalıcı farkın yönü net değil. Hareket örneğini yeniden izle.'});
  }
  const missing = Object.entries(d?.missingJointFrames ?? {}).filter(([,count]) => (count??0)>0)
    .sort((a,b) => (b[1]??0)-(a[1]??0)).slice(0,2)
    .map(([index]) => Number(index) === 0 ? 'Baş' : CORRECTION_JOINT_NAMES[Number(index)]).filter(Boolean);
  const mainUnknown = Object.entries(d?.unknownReasons ?? {}).sort((a,b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
  const setupAdvice: Record<string, string> = {
    camera_view: 'Önce çekim açısını eşleştir: video yandansa yan dur, öndense kameraya dön. Telefon sabit kalsın.',
    processing_slow: 'Telefon görüntüyü zamanında işleyemedi. Kamera seçeneklerinden Hafif görüntüyü seçip yeniden dene.',
    find_start: 'Vücudun görüldü ama başlangıç eşleşmedi. Örnek başlangıcı izle; kol ve bacak duruşunu aynı çekim açısından eşleştir.',
    hold_start: 'Başlangıç duruşunu kısa bir an sabit tut; başlangıç onayını duyunca harekete geç.',
    multiple_people: 'Vücut çizgileri net ayrılamadı. Arka planı sadeleştir ve tüm vücudunun görünmesini sağla.',
    no_person: 'Kamera vücudunu seçemedi. Telefonu sabitle; aydınlıkta başından ayaklarına kadar kadraja gir.',
  };
  const setupNext = mainUnknown && (mainUnknown[1] ?? 0) >= 3
    && (mainUnknown[1] ?? 0) >= s.unmeasuredFrames * .5 ? setupAdvice[mainUnknown[0]] : undefined;
  const visibility = s.sampledFrames === 0 ? 'Kamera analizi başlamadı; hareketin değerlendirilemedi.'
    : s.trackedFrames === 0 ? 'Karşılaştırma için yeterli görünürlük veya başlangıç eşleşmesi oluşmadı.'
    : s.unmeasuredFrames > 0 ? `Görüntünün bazı bölümleri değerlendirilemedi.${missing.length ? ` ${missing.join(' ve ')} görünürlüğü eksikti.` : ''}`
      : 'Bu denemedeki tüm alınan görüntüler karşılaştırmaya girdi.';
  let next: string;
  if (s.sampledFrames === 0) next = 'Önce kamera/model hazırlığını tamamla. Ekrandaki teknik hata varsa onu giderip yeniden başlat.';
  else if (setupNext && s.unmeasuredFrames > s.trackedFrames) next = setupNext;
  else if (s.trackedFrames === 0 || (s.unmeasuredFrames > s.trackedFrames && missing.length))
    next = missing.length ? `Önce ${missing.join(' ve ').toLocaleLowerCase('tr-TR')} hareket boyunca kadrajda kalsın; ardından başlangıç örneğine geç.`
      : 'Telefonu sabitle; başın, ellerin ve ayakların görünsün. Sonra başlangıç örneğine geç.';
  else if (improvements.length) next = `${sustained[0]?.phase === 'return' ? 'Dönüşte' : 'Bir sonraki denemede'} tek bir düzeltmeye odaklan: ${improvements[0]!.instruction}`;
  else if (!s.repetitionCount) next = 'Örnekteki gidişi ve başlangıca dönüşü birlikte tamamla. Kendi hızında ilerleyebilirsin.';
  else next = progress?.complete ? 'Hedefin tamamlandı. İstersen dinlen; sonraki denemede aynı akıcı hareketi koru.'
    : 'Görünür kaldığından emin olup kalan tekrarları kendi hızında tamamla.';
  const outcome = s.sampledFrames === 0 ? 'Önce kamerayı hazırlayalım'
    : s.trackedFrames === 0 ? 'Bu denemeyi değerlendiremedik'
    : d?.incorrectFrames ? 'Tamamladıkların ve geliştirebileceklerin'
    : s.repetitionCount > 0 ? 'Hareketini tamamladın' : 'Henüz tam tekrar oluşmadı';
  return {outcome,completion,positives,improvements,visibility,next,
    scope:'Bu değerlendirme kamerada görülen hareketin referansla benzerliğidir. Görünmeyen bölümler değerlendirilmez.'};
}
export function genericSimpleReportText(summary: GenericSessionSummary): string {
  const r = genericSessionReview(summary);
  return ['FlexiVision · Egzersiz özetin','',r.outcome,r.completion,'','İYİ GİDENLER',
    ...(r.positives.length ? r.positives : ['Henüz olumlu hareket değerlendirmesi için yeterli ölçüm yok.']),
    '', 'GELİŞTİRİLECEKLER', ...(r.improvements.length ? r.improvements.map(f => `${f.finding} ${f.instruction}`)
      : ['Kalıcı bir hareket düzeltmesi kaydedilmedi. Bu, görünmeyen bölümlerin doğru olduğu anlamına gelmez.']),
    '', 'KAMERA TAKİBİ',r.visibility,'','SONRAKİ DENEME',r.next,'',r.scope].join('\n');
}

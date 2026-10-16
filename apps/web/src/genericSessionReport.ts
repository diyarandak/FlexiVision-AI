import type { GenericMotionTemplate, GenericSessionSummary } from '@flexivision/contracts';
import { genericSimpleReportText, genericSessionSummaryData, repetitionGoalProgress } from '@flexivision/core';

export interface AttemptContext {
  createdAt: string; endReason: string; attemptMs: number; build: string;
  camera: { width:number; height:number; facing:string; portraitRequested:boolean; fill:boolean; mirrored:boolean; analysisMaxDimension:number };
  viewport: {width:number;height:number}; browser:string;
  lastMessage:string; technicalError:string; speechError:string;
  startup?: {stage:string;elapsedMs:number}[];
  voice?: { setupStarted:number; recoveryStarted:number; referenceStarted?:number; startStarted?:number;
    nearStarted?:number; returnStarted?:number; completedStarted?:number; failures:number; lastFailureCode:string };
}
const reasons:Record<string,[string,string]>={
  no_person:['Vücut algılanamadı','Telefonu sabitle; gövden ve hareket eden uzuvların kadrajda görünsün.'],
  multiple_people:['Tek bir vücut net seçilemedi','Kamerayı sabitle; gövden ve hareket eden uzuvların bütünü kadrajda kalsın. Arka planı sadeleştir. Poz adayı sayısı gerçek kişi sayısı değildir.'],
  body_not_visible:['Gövde ölçümü alınamadı','Omuz ve kalçanın görünmesini, ışığı ve kamera yüksekliğini kontrol et.'],
  camera_view:['Kamera açısı referansla eşleşmedi','Kameraya referans videodakiyle aynı yönden dön.'],
  tracking_lost:['Gerekli eklemler izlenemedi','Hareket eden eklemleri kadrajda tut; aşağıdaki görünmeyen eklemleri kontrol et.'],
  find_start:['Başlangıç duruşu eşleşmedi','Referans başlangıç çizimine bak; aynı açıdan o duruşa geç. Çizimin tam üstüne oturman gerekmez.'],
  hold_start:['Başlangıç duruşu kararlı bekleniyordu','Başlangıç duruşunda kısa bir an sabit kal.'],
  processing_slow:['Görüntü işleme gecikti','Kamera ayarlarından Hafif görüntüyü seç; diğer yoğun uygulamaları kapat.'],
  cycle_timeout:['Hareket döngüsü tamamlanmadan süre doldu','Başlangıçtan harekete geçip tekrar başlangıca dön; referansla aynı hız şart değil.'],
  motion_too_fast:['Kareler arasında büyük hareket sıçraması görüldü','Hareketi kameranın izleyebileceği akıcı bir hızda dene.'],
  pose_uncertain:['Referans eşleşmesi belirsiz kaldı','Kamera açısını ve hareket eden uzuvların görünürlüğünü kontrol et.'],
  cycle_too_short:['Tam tekrar için hareket süresi yetersizdi','Hareketi kesmeden tamamla; yalnız sonda beklemek eksik hareketi tamamlamaz.'],
  other:['Ölçüm belirsiz kaldı','Raporu inceleme için paylaşabilirsin.'],
};
const joints:Record<string,string>={'0':'Baş','11':'Sol omuz','12':'Sağ omuz','13':'Sol dirsek','14':'Sağ dirsek','15':'Sol el bileği','16':'Sağ el bileği','23':'Sol kalça','24':'Sağ kalça','25':'Sol diz','26':'Sağ diz','27':'Sol ayak bileği','28':'Sağ ayak bileği'};
const sec=(n:number)=>`${(n/1000).toFixed(1)} sn`;
const ranked=(values:Record<string,number|undefined>)=>Object.entries(values).filter((entry):entry is [string,number]=>typeof entry[1]==='number'&&entry[1]>0).sort((a,b)=>b[1]-a[1]);
export function genericReportConclusion(summary:GenericSessionSummary) {
  const s=genericSessionSummaryData(summary), d=s.diagnostics;
  if(s.sampledFrames===0)return {title:'Kamera ölçümü alınamadı',detail:'Karşılaştırılacak veri yok. Doğru veya yanlış yaptığını söyleyemiyoruz.'};
  if(s.trackedFrames===0)return {title:'Hareket değerlendirilemedi',detail:'Başlangıç duruşu veya güvenilir izleme sağlanamadı. Bu, egzersizi yanlış yaptığın anlamına gelmez.'};
  if(!d)return {title:'Ayrıntılı değerlendirme bu eski kayıtta yok',detail:'Tekrar ve izleme sayıları var; bunlardan doğru/yanlış sonucu çıkarılamaz.'};
  if(d.incorrectFrames>0)return {title:'Referanstan farklar görüldü',detail:`${d.incorrectFrames} karede hareket yolu farklı ölçüldü. Aşağıdaki farklar yalnız izlenebilen bölümler için geçerli.`};
  if(s.repetitionCount===0)return {title:'Tam tekrar doğrulanamadı',detail:'Bazı bölümler izlendi, ancak başlangıca dönen tam bir tekrar ölçülmedi.'};
  return {title:'Ölçülen bölümlerde fark görülmedi',detail:`${s.repetitionCount} tam tekrar ölçüldü. Görülemeyen bölümler değerlendirilmedi; bu tüm hareketin doğru yapıldığına onay değildir.`};
}
export function genericReportFindings(summary:GenericSessionSummary) {
  const d=genericSessionSummaryData(summary).diagnostics;
  if(!d)return {blocks:[] as string[],differences:[] as string[],missing:[] as string[],next:summary.sampledFrames===0
    ? 'Ekrandaki teknik hata mesajını ve kamera iznini kontrol et. Rapordaki hata bilgisini inceleme için paylaşabilirsin.'
    : 'Bu eski kayıtta ayrıntılı nedenler yok. Yeni bir denemede ayrıntılar rapora eklenir.'};
  const blocks=ranked(d.unknownReasons);
  return {blocks:blocks.map(([key,n])=>`${reasons[key]?.[0]??'Ölçüm belirsiz'}: ${n} kare`),
    differences:ranked(d.deviatingJointFrames).map(([key,n])=>`${joints[key]??`Eklem ${key}`}: ${n} karede referans farkı`),
    missing:ranked(d.missingJointFrames).map(([key,n])=>`${joints[key]??`Eklem ${key}`}: ${n} karede görünürlük yetersiz`),
    next:summary.sampledFrames === 0 ? 'Hareket analizi başlamamış. Kamera/model hazırlık mesajını ve teknik hatayı kontrol et; bu durum hareketinin yanlış olduğu anlamına gelmez.'
      : blocks.length ? reasons[blocks[0]![0]]?.[1]??reasons.other![1] : 'Hareketini kendi hızında tamamla. Referansla aynı süre şart değil.'};
}
export function genericReportText(summary:GenericSessionSummary, context?:AttemptContext, template?:GenericMotionTemplate):string {
  const s=genericSessionSummaryData(summary),d=s.diagnostics,c=genericReportConclusion(s),f=genericReportFindings(s);
  const goal = s.repetitionGoal, progress = goal ? repetitionGoalProgress(goal, s.repetitionCount) : null;
  const reference=template?{policy:template.policyVersion,source:{width:template.source.width,height:template.source.height,durationMs:template.source.durationMs,engine:template.source.engine},repetitionId:template.repetition.id,cycleMs:template.durationMs,trackedIndices:[...template.trackedIndices]}:undefined;
  return ['FlexiVision · Oturum inceleme raporu',`Rapor tarihi: ${context?.createdAt??'Geçmiş kaydı'}`,'', genericSimpleReportText(s), '', 'AYRINTILI İNCELEME', '',
    `SONUÇ: ${c.title}`,c.detail,...(context?.technicalError?[`Teknik kesinti: ${context.technicalError}`]:[]),'',
    `Ölçülen tam tekrar: ${s.repetitionCount}`,`Alınan / izlenebilen / değerlendirilemeyen kare: ${s.sampledFrames} / ${s.trackedFrames} / ${s.unmeasuredFrames}`,
    ...(goal && progress ? [`Hedef: ${goal.sets} set × ${goal.repetitionsPerSet} tekrar`,
      `Tamamlanan: ${progress.completedSets}/${goal.sets} set · ${progress.total}/${progress.target} tekrar`,
      `Hedef tamamlandı: ${progress.complete ? 'Evet' : 'Hayır'}`] : []),
    `Başlangıç sonrası süre: ${sec(s.durationMs)}`,...(context?[`Kamera başlatma denemesinden bitişe: ${sec(context.attemptMs)}`]:[]),
    ...(context?.startup?.length ? [`Kamera hazırlık adımları: ${context.startup.map(step => `${step.stage} ${sec(step.elapsedMs)}`).join(' → ')}`] : []),
    ...(d?[`Referansa yakın / farklı ölçülen kare: ${d.correctFrames} / ${d.incorrectFrames}`,`Başlangıç duruşu doğrulandı: ${d.measuredStart?'Evet':'Hayır'}`,`İlk kamera ölçümünden başlangıca: ${d.timeToStartMs===null?'Başlangıç bulunamadı':sec(d.timeToStartMs)}`,`İşleme ortalama / en yüksek: ${d.processing.meanMs===null?'Ölçülmedi':`${d.processing.meanMs.toFixed(0)} / ${d.processing.maxMs!.toFixed(0)} ms`}`]:[]),
    ...(d?.postStartPhaseFrames ? [
      '', 'BAŞLANGIÇ SONRASI İZLEME',
      `Gidiş / dönüş / bekleme karesi: ${d.postStartPhaseFrames.outbound} / ${d.postStartPhaseFrames.return} / ${d.postStartPhaseFrames.waiting}`,
      `Aktif hareketi kesen belirsizlik: ${d.cycleInterruptions ?? 0} kez`,
      ...((ranked(d.postStartUnknownReasons ?? {}).map(([key,n])=>`${reasons[key]?.[0]??'Ölçüm belirsiz'}: ${n} kare`)).length
        ? ranked(d.postStartUnknownReasons ?? {}).map(([key,n])=>`${reasons[key]?.[0]??'Ölçüm belirsiz'}: ${n} kare`)
        : ['Başlangıçtan sonra belirsiz kare kaydedilmedi.']),
    ] : []),
    '', 'TAKILDIĞI NOKTALAR',...(f.blocks.length?f.blocks:['Kayıtta ayrıntılı bir engel yok.']),
    '', 'GÖRÜNÜRLÜĞÜ YETERSİZ EKLEMLER',...(f.missing.length?f.missing:['Kayıtta eklem bazında eksik görünürlük yok.']),
    '', 'ÖLÇÜLEN REFERANS FARKLARI',...(f.differences.length?f.differences:['Eklem bazında fark listelenmiyor. Bu tek başına doğru hareket kanıtı değildir.']),
    '', 'SONRAKİ DENEME',f.next,
    '', 'SES',`Egzersiz düzeltme adayı: ${s.cueCandidatesCount} · Başlayan düzeltme: ${s.spokenCuesCount}`,
    ...(context?.voice ? [
      `Başlayan yerleşim yönlendirmesi: ${context.voice.setupStarted} · İlk başlangıçtan sonra: ${context.voice.recoveryStarted}`,
      ...(context.voice.referenceStarted===undefined?[]:[`Başlayan referans duruşu sesi: ${context.voice.referenceStarted}`]),
      ...(context.voice.startStarted===undefined?[]:[`Başlayan hareket başlangıcı sesi: ${context.voice.startStarted}`]),
      ...(context.voice.nearStarted===undefined?[]:[`Başlayan yakın hareket bildirimi: ${context.voice.nearStarted}`]),
      ...(context.voice.returnStarted===undefined?[]:[`Başlayan dönüş yönlendirmesi: ${context.voice.returnStarted}`]),
      ...(context.voice.completedStarted===undefined?[]:[`Başlayan tam tekrar bildirimi: ${context.voice.completedStarted}`]),
      `Ses hata olayı: ${context.voice.failures} · Son hata kodu: ${context.voice.lastFailureCode || 'Yok'}`,
    ] : ['Yerleşim yönlendirmelerinin ses sayısı bu kayıtta ölçülmedi.']),
    ...(context?[`Son ekran mesajı: ${context.lastMessage}`,`Ses durumu: ${context.speechError||'Bir ses hatası bildirilmedi'}`,`Gelen kamera: ${context.camera.width} × ${context.camera.height} · ${context.camera.facing}`,`Görünüm: ${context.camera.fill?'Ekranı doldur (kırpar)':'Tüm kadraj'}`]:[]),
    '', 'KAPSAM','Bu sonuç görülebilen 2B hareketin referansla benzerliğini anlatır; anatomik doğruluk veya güvenli egzersiz onayı değildir. Sessizlik doğruluk kanıtı değildir. Raporda video, ses, eklem koordinatları veya vücut profili ölçüleri bulunmaz.',
    '', 'TEKNİK İNCELEME VERİSİ (aynı dosyayı paylaşabilirsin)',JSON.stringify({reportVersion:1,summary:s,...(context?{context}:{}),...(reference?{reference}:{})},null,2),
  ].join('\n');
}

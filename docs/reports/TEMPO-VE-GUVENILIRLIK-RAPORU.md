# FlexiVision — hız farkı ve güvenilirlik incelemesi

**Tarih:** 11 Ekim 2026  
**Durum:** Kod ve otomatik testler tamamlandı. Değişiklikler 11 Ekim 2026 tarihinde Firebase Hosting’e yayınlandı; kamera arayüzü düzeltmesi de yayında.

## 1. Kısa cevap: Videoyla aynı hızda mı yapmalıyım?

**Hayır.** Sistem kişinin hareketini videonun aynı saniyesindeki görüntüyle karşılaştırmaz. Başlangıç, gidiş ve dönüş aşamalarında benzer duruşu arar. Örneğin referanstaki hareket hızlıyken sen daha yavaş yapabilirsin; dönüşü gidişten farklı hızda da yapabilirsin.

Bunun sınırı kameranın hareketi yeterince izleyebilmesidir. Görünmeyen bir hareketi tamamlanmış saymak veya çok seyrek ölçümlerden doğru yapıldığı sonucunu çıkarmak mümkün değildir. Çok büyük ölçüm sıçramalarında uygulama karşılaştırmayı belirsiz sayar ve yeniden başlangıç ister.

**Bu incelemenin sonucu:** Farklı hızlarda yanlış uyarı ve tekrar sayımı üreten somut hatalar bulundu, düzeltildi ve otomatik testlerle kontrol edildi. Bu, her egzersizin her telefonda doğrulandığı anlamına gelmez.

## 2. Bulunan ve düzeltilen sorunlar

| Sorun | Kullanıcıya etkisi | Yapılan düzeltme |
|---|---|---|
| Referans videoda gidiş hızlı, dönüş yavaş olduğunda dönüş aşamasına erken geçilmesi | Aynı hareket yavaş yapılırken gereksiz kırmızı işaret/uyarı oluşabiliyordu. | Dönüş, şablondaki birkaç örneğin sırasına göre değil, ölçülen uç duruşa yakınlığa göre başlatılıyor. |
| Referans videoda dönüş çok hızlı olduğunda tekrarın erken bitirilmesi | Kişi başlangıca tam yaklaşmadan tekrar sayılabiliyor; kalan hareket yeni tekrar gibi yorumlanabiliyordu. | Tekrar sayımı için kişinin kendi ölçülen başlangıç duruşuna yeterince dönmesi gerekiyor. |
| Başlangıç pozunda beklerken tekrar zaman aşımının işlemesi | Hazır olduktan sonra bekleyen kişi harekete geçtiğinde süre dolabiliyordu. | Tekrarın süre sınırı belirgin hareket başladığında işliyor. Oturumun toplam süresi bundan ayrı. |
| Takip kaybından sonra kişi hâlâ hareket ederken yeni başlangıç alınması | Sonraki doğru tekrar kaçırılabiliyordu. | Yeni başlangıç için kısa ve kararlı bir duruş ölçülüyor. |
| İki kare arasında çok büyük poz sıçraması | Ölçülemeyen geçiş gerçek hareket gibi kullanılabiliyordu. | Bu geçiş belirsiz sayılıyor; yarım tekrar iptal edilip açıklayıcı mesaj gösteriliyor. |
| Bir saniyeden kısa hareketin sonunda bekleyerek süre koşulunu karşılaması | Fazla kısa bir hareket, sonradan geçerli tekrar sayılabiliyordu. | Hareketin dönüşe kadar ölçülen süresi kontrol ediliyor; sonradan beklemek eksik süreyi tamamlamıyor. |
| Geçersiz işlem süresi bilgileri | Hatalı süre bilgisiyle karşılaştırma yapılabiliyordu. | Negatif, sonsuz, sayı olmayan veya aşırı geciken ölçümler belirsiz kabul ediliyor. |

Bu değişiklikler mevcut kayıtlı şablon biçimini değiştirmedi. Önceden kaydedilen egzersizlerin yeniden yüklenmesini zorunlu kılan bir veri geçişi yok.

## 3. Hangi durumlar denendi?

Testler, gerçek kameraya bağlanmadan üretilen eklem ölçümleriyle çalıştırıldı. Böylece beklenen hareket ve tekrar sayısı önceden biliniyordu.

### Farklı hızlar

Dört referans hız düzeni, altı canlı hareket düzeniyle karşılaştırıldı: toplam **24 kombinasyon**.

Referanslarda gidiş/dönüş süreleri:

- 0,5 / 0,5 saniye
- 1 / 1 saniye
- 0,5 / 6 saniye
- 6 / 0,5 saniye

Canlı hareketlerde:

- Hızlı gidiş ve dönüş: 0,7 / 0,7 saniye
- Yavaş gidiş ve dönüş: 6 / 6 saniye
- Hızlı gidiş, yavaş dönüş: 0,5 / 7 saniye; arada 1 saniye bekleme
- Yavaş gidiş, hızlı dönüş: 7 / 0,5 saniye
- Uç duruşta 15 saniye bekleme
- Harekete başlamadan önce 29 saniye bekleme

**Sonuç:** 24 kombinasyonun tamamında bir tam tekrar sayıldı; yalnızca hız farkı nedeniyle yanlış hareket bildirimi oluşmadı. Bunlar test senaryolarıdır, önerilen egzersiz temposu değildir.

### Diğer durumlar

| Senaryo | Doğrulanan davranış |
|---|---|
| Saniyede 5, 10, 20 ve 30 ölçüm; küçük zamanlama dalgalanmaları | Denenen yavaş döngüde tekrar sayısı değişmedi. Bu sonuç gerçek telefon FPS ölçümü değildir. |
| Kullanıcı dönüşü yarıda bırakıyor | Tam tekrar sayılmıyor. |
| Başlangıçta uzun beklemeden sonra tek karelik sıçrama | Sahte tekrar veya form düzeltmesi üretilmiyor. |
| Eklemler kayboluyor, kadraja başka kişi giriyor, uzun kare boşluğu veya yavaş işleme oluşuyor | Yarım tekrar iptal ediliyor; önceki tamamlanmış tekrarlar korunuyor. Yeni başlangıçtan sonraki tam tekrar sayılıyor. |
| Hareket başladıktan sonra 30 saniye içinde döngü bitmiyor | Tekrar uydurulmuyor; başlangıca dönme mesajı gösteriliyor. |
| Bir saniyeden kısa döngüden sonra kullanıcı bekliyor | Bekleme bu hareketi geçerli tekrara dönüştürmüyor. |
| Squat yavaş, hızlı veya farklı iniş/çıkış hızlarıyla yapılıyor | Denenen açı dizilerinde bir tekrar sayıldı; hız farkı hata üretmedi. |
| Uygulama ses açıkken farklı tempolu doğru hareketi izliyor | Denenen uzun beklemeli senaryolarda sesli düzeltme üretilmedi. |
| Sabit duruşta kişi kayboluyor veya referanstan ayrılıyor | Önceki statik mod testleri de tekrar geçti; bu aralıklar eşleşen süreye eklenmiyor. |

## 4. Kullanıcı için anlamı

### Tekrarlı hareket

1. Tam hareketin ve başlangıca dönüşün göründüğü bir referans video seç.
2. Canlı kamerayı referansa benzer açıya yerleştir.
3. Gösterilen başlangıç duruşunda kısa bir an sabit kal.
4. Hareketi kendi hızında yap. Videonun saniyesini yakalamaya çalışma.
5. Takip kesilirse başlangıca dön. Yarım tekrarın sayılmaması, önceki tekrarların silindiği anlamına gelmez.

### Sabit duruş

Referans videodaki bekleme süresi, senin hedef süren değildir. Canlı oturum için ayrı süre seçilir. Sayaç yalnızca ölçülebilen ve referansa yakın duruşta ilerler; sapmada veya görüş kaybında duraklar.

### Renk ve ses

- **Yeşil:** Ölçülen duruş/hareket referans karşılaştırmasının kabul aralığında.
- **Kırmızı:** Güvenilir karşılaştırmada referanstan fark ölçüldü.
- **Gri/belirsiz:** O anda güvenilir karşılaştırma yapılamıyor; egzersiz düzeltmesi üretilmiyor.
- Egzersiz düzeltmesi ilk kez 10. saniyede değerlendirilebilir; sonraki kontroller arasında en az 10 saniye vardır. Doğru harekette sessiz kalır. Kamera yerleşim yönlendirmesi ayrı kurala sahiptir.

Sessizlik, kişinin bütün hareketlerinin kusursuz olduğu anlamına gelmez. Tekrar sayısı da tek başına doğru teknik puanı değildir.

## 5. Kalan sınırlar

- Karşılaştırma görünür eklemlerin iki boyutlu görüntüsüne dayanır. Kamera açısındaki büyük farklar, örtüşen uzuvlar ve derinlik gerektiren hareketler sonucu sınırlayabilir.
- Video kabulü, egzersizin kişiye uygun veya güvenli olduğunun onayı değildir. Sistem bütün egzersiz adlarını ve doğru tekniklerini tanımıyor.
- Referans çıkarımı için bir döngünün desteklenen süresi 1–12 saniyedir. Canlı döngünün ölçülen hareket bölümü için 1–30 saniye sınırı bulunur. Bunlar yazılımın çalışma sınırlarıdır; kişisel antrenman önerisi değildir.
- Aynı başlangıç ve hareket yolunun farklı vücut oranlarında ne kadar iyi eşleştiği daha geniş gerçek kişi testleri gerektiriyor. Bu tur kişiselleştirmenin her vücutta doğru olduğu kanıtlanmadı.
- Gerçek Xiaomi/Chrome kamerası, mikrofonu, konuşma sesi, ısınma ve pil tüketimi bu tur ölçülmedi. Yeni ekranların gerçek tarayıcıdaki görsel/etkileşim doğrulaması da açık iş olarak duruyor.
- Güncel kod Firebase’de yayında. Açık eski sekmede sayfayı yenileyerek yeni sürüme geçebilirsin.

## 6. Doğrulama özeti

| Kontrol | Sonuç |
|---|---|
| Port açmadan çalışan çekirdek, uygulama, web ve mobil adaptör testleri | **294 / 294 geçti** |
| Bu tur eklenen hız/kenar durum testleri | 32 çekirdek testi + 1 oturum/ses testi |
| TypeScript tip kontrolü | Geçti |
| Web üretim derlemesi | Geçti |
| API üretim derlemesi | Geçti |
| API port dinleme testi | Bu tur çalıştırılmadı |
| Gerçek telefon/kamera/mikrofon ve yeni UI etkileşim testi | Bu tur yapılmadı |
| Firebase yayını | 11 Ekim 2026: tempo ve kamera arayüzü düzeltmeleri yayında |

**Sonraki somut kontrol:** İzinli gerçek cihazda aynı referansla hızlı, yavaş ve beklemeli hareketleri karşılaştırmak; yanlış uyarı, kaçan tekrar ve takip kaybını kaydetmek. Bu kontrolün sonuçları alınmadan uygulamayı “her egzersizde hatasız” olarak nitelendirmek doğru olmaz.

---

### Geliştirici için kısa iz

- Eşleştirme: `packages/core/src/liveGeneric.ts`, `packages/core/src/liveSquat.ts`
- Senaryolar: `packages/core/test/tempoEdges.test.ts`, `packages/core/test/fixtures/tempo.ts`
- Sesli oturum doğrulaması: `packages/application/test/trackLiveGenericSession.test.ts`
- Kullanıcı mesajları: `apps/web/src/components/GenericLiveExercisePanel.tsx`
- Güncel davranış kaynağı: `docs/PRODUCT.md`
- Derleme: `index-CH-0FU-k.js` / `index-COa18RdF.css`

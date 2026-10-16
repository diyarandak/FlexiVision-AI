# Vücut profili

Ürün davranışı `PRODUCT.md` içindedir. Kullanıcının güncel kararı: vücut profilini bir kez oluştur, egzersiz videolarından bağımsız sakla. Referans hareketi taklit etme ve zorunlu T/A pozu kaldırıldı. Profil `qualification: not_evaluated` taşır; egzersiz uygunluk kararı üretmez.

## Tarama

Ana sayfadaki **Vücudumu bir kez tara** video seçmeden açılır. Kullanıcı ayakta rahat durup kameraya bakar. Baş, iki omuz/kalça/diz/ayak bileği görünür olmalıdır. Kollar gövdeyi kapatmadığı sürece aşağıda kalabilir. Vücut genişliğine göre sabit oranlarla ön görünüm onayı verilmez.

En az 2,5 saniye geçerli ölçüm ve sekiz geçerli kare gerekir. 300 ms'ye kadar kısa görünürlük kaybında ilerleme duraklar; eksik zaman toplama süresine katılmaz ve eksik kareden profil üretilmez. Daha uzun kayıp, çoklu kişi, kadraj sorunu veya belirgin hareket ölçümü yeniden başlatır.

Yavaş telefonda ardışık analiz süresi kamera kesintisinden ayrılır: bir sonraki kare arasındaki boşluktan önceki karenin ölçülen işleme süresi çıkarılır; kalan boşluk bir saniyeyi aşarsa pencere sıfırlanır. Her geçerli aralık en fazla 250 ms ilerleme kazandırır; seyrek karelerin arasındaki uzun süre duruş kanıtı sayılmaz. Böylece 2 sn/kare cihazda 11 geçerli kareyle yaklaşık 23 saniyede ölçüm tamamlanabilir. Tek kare sekiz saniyeden fazla işlenirse kamera durdurulur ve teknik hata gösterilir.

Web arayüzü sonucun yakalama zamanı yerine alındığı zamanı ve devam eden işlemi izler. İşlem 1,5 saniyeyi geçtiğinde “Görüntü işleniyor” gösterilir; ilerleme korunur. Yeni işlem başlamadan/alınan sonuçtan sonra 1,5 saniye veri yoksa gerçek akış kesintisi olarak sıfırlanır. Tamamlanmış/kayıtlı profil bu kontrolle silinmez.

Tamamlanınca kamera/Worker kapanır, profil kaydedilir ve kullanıcıya yaklaşabileceği söylenir. Kayıt başarısızsa başarı mesajı verilmez; yeniden kaydetme düğmesi gösterilir. Tamamlanmış profil daha sonra kadrajdan ayrılmakla silinmez; canlı görünürlük kontrolü ayrı bir iştir.

## Ölçüm ve saklama

`CalibrationProfile` şema sürümü 2, `policyVersion: body-scan-v2`: göreli omuz/kalça genişlikleri, uyluk/baldır uzunlukları, ayakta başlangıç açıları, o görüntüdeki kalça merkezi ve gövde ölçeği. Referans video, tekrar ID'si, izlenen taraf ve referans kamera görünümü profile bağlanmaz.

`normalizeBodyPose` kalça orta noktasını merkez alır. X/Y önce görüntü piksel ölçeğine çevrilir, sonra omuz orta noktası–kalça orta noktası uzaklığına bölünür. Görünmeyen eklemler `null` kalır; Z bu 2B hesaba katılmaz.

Canlı oturum `normalizePersonalBody` ile kayıtlı ortalama bacak/gövde oranını kişisel birim olarak kullanır. Merkez ve gövde ölçeği her yeni kareden bulunur; kayıtlı piksel merkezi/ölçeği başka kamera konumuna kopyalanmaz. `LiveSquatComparer` diz/kalça açılarını bu koordinatlardan hesaplar. Benzerlik dönüşümü açıları korur; kayıtlı önden başlangıç açıları yandan görüntüye ofset olarak uygulanmaz ve kişiye özel doğru squat derinliği üretilmez. Profilsiz deneme de yapılabilir; rapor profilin gerçekten kullanılıp kullanılmadığını belirtir.

`BodyProfileRepository` ortak kullanım senaryosu portudur. Web adaptörü `localStorage` içinde `flexivision.body-profile.v2` anahtarını kullanır. Yalnızca seçilen profil alanları ve kayıt tarihi yazılır; ham kare, video, eklem dizileri ve mikrofon kaydı saklanmaz. Yenilemede sürüm/sayı/alan doğrulaması yapılır. Bozuk veya eski sürümdeki kayıt geçerli profil sayılmaz.

Profil bu tarayıcı ve origin'de kalır; yeni videoda veya sayfa yenilemede silinmez. Kullanıcı profili silebilir veya yeniden ölçebilir. Site verilerinin temizlenmesi, başka tarayıcı/origin veya başka cihaz kaydı paylaşmaz. Bulut senkronizasyonu ve farklı kişiye ait profiller henüz yoktur.

## Uzaktan kullanım

Tarama, kaydırma gerektirmeyen büyük yönlendirme ekranında açılır; beklenen rahat duruş çizimi gösterilir. Kamera kullanıcı düğmeye basınca açılır. Türkçe sesli kurulum talimatı başlangıçta okunur. Değişen uyarı 600 ms tutarlı kaldığında ve son yönlendirmeden en az yedi saniye sonra okunabilir; aynı sorun en erken yedi saniye sonra yinelenir. Tutma mesajı sürekli tekrarlanmaz. Başarı/teknik hata doğrudan bildirilir. Yeni mesaj eski sesi değiştirir, kuyruk oluşturulmaz. Ses kapatılabilir; destek/çalma hatası metinle gösterilir.

Bu sesler **kurulum yönlendirmesidir**. Egzersiz hatalarının 10 saniyelik sessizlik politikası değişmez; ayrı canlı oturum TTS bağlantısı `LIVE_SESSION.md` içinde açıklanır.

Durdurma, panel kapatma, yeni video, sekmeden ayrılma ve unmount kamera/Worker/sesi kapatır. Geç gelen izin, bitmap veya model sonucu kullanılmaz. Modal odak ve arka plan etkileşimi yönetilir.

## Sınırlar ve sıradaki iş

Profil görüntü izdüşümüdür; fiziksel boy/uzuv ölçümü veya 3B tarama değildir. Perspektif ve farklı kamera açısı ayrıca ele alınmalıdır. Her egzersiz için yeniden vücut taraması istenmez; yeni referansın hareket ve kamera uygunluğu ile canlı kadraj/açı eşlemesi ayrıca doğrulanır.

`calibrationTarget` referans tekrarının başlangıç/bitiş çevresinden izdüşüm medyanı çıkaran ayrı bir yardımcı olarak kalır. Tarama ekranının kapısı değildir, kamera açısını doğruladığı iddia edilmez. Gerçek kamerada yeni rahat duruş akışının başarı oranı, sesin duyulması, ışık/ayna/Safari ve canlı faz eşleme açık işlerdir.

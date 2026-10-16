# Kaia Motion Coach incelemesi — 15 Ekim 2026

## Kaynaklardan doğrulananlar

- [Kaia kullanım rehberi](https://help.kaiahealth.com/article/15-how-to-use-kaia-motion-coach) (7 Ağustos 2025 güncellemesi): kameradan hareket izleme, sesli yönlendirme, tekrar sayma ve duruş süresi. Motion Coach bütün egzersizlerde sunulmuyor.
- [2021 yöntem çalışması](https://www.jmir.org/2021/7/e26658/): cihaz yaklaşık iki metre uzağa, kişiyi görecek biçimde yerleştiriliyor; etkileşimli kurulum rehberi var. Cihazda çalışan poz modeli sonrasında, uzmanların önceden belirlediği geometri/zaman kuralları değerlendiriliyor. Birden fazla hata için öncelik seçiliyor. Çalışma 24 katılımcı ve altı egzersizle sınırlı; bulgular bütün videolara, açılara veya başka bir ürüne aktarılamaz.
- [Ürün açıklaması](https://kaiahealth.com/motion-coach/): telefon/tablet ön kamerası ve görsel/sesli geri bildirim; giyilebilir sensör gerektirmiyor.

Bunlar yayımlanan açıklamalar. Güncel kapalı kaynak algoritmayı incelemedik; canlı Kaia hesabında ürün testi yapmadık. Rastgele yüklenen videoya her açıdan eşleştirme, kalibre edilmiş “tam 20°” baş komutu veya güncel bütün sistemin LLM kullanmadığı iddiası bu kaynaklardan doğrulanmıyor.

## FlexiVision için sonuç

Mevcut kodda referans video yoluna göre karşılaştırma var. Kaia'nın anlatılan egzersize özel uzman kurallarıyla aynı klinik kapsamda değil. Öncelik: anlaşılır yerleşim, mevcut aşama için tek komut, ölçüm kaybında onayı geri çekme, bulguya dayalı kısa rapor. Bu çalışma ücretli LLM veya yeni hizmet gerektirmedi.

İncelemede bulunan ve giderilen sorunlar:

- `GenericLiveExercisePanel` başlangıç/hareket yönünü ilk sekiz saniye sonunda yeniden sunmuyordu; bekleyen kullanıcı sessizlik yaşayabiliyordu. Güncel, kesintisiz ölçümle çalışan hatırlatma eklendi.
- Örnek hareket paneli üstteki komutla aynı konumdaydı; dar ekranda örtüşebiliyordu. Örnek alt köşeye alındı, ana komut büyütüldü.
- Bütün vücut görünürlüğü tek sonuçtu. Bölge görünürlüğü ve kadraj → başlangıç → hareket adımları görünür oldu; bunlar hareket doğruluğu onayı değil.
- Sade rapor, başlangıç eşleşmesi/çekim açısı/işleme yavaşlığı ayrımında genel kadraj önerisi verebiliyordu. Baskın ölçülememe nedenine göre tek sonraki adım seçiliyor.

## Sınır ve sonraki çalışma

Bu değişiklikler poz modelinin hassasiyetini veya kamera açısı kabul eşiklerini değiştirmez. Fiziksel telefonla görünürlük, gerçek ses çıkışı ve farklı egzersizler ayrıca doğrulanmalı. Baş açısı veya farklı bakış açısından eşleştirme için ayrı ölçüm/kalibrasyon ve referans veriyle hata analizi gerekir. Kaia düzeyinde klinik doğruluk iddiası yok.

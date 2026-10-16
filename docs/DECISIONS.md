# Mimari kararlar

## 001 — Web önce, mobil sonra

React + Vite ilk istemci; Expo/React Native mobil hedef. Ortak TypeScript çekirdeği iki istemcide kullanılır. Kullanıcı web önceliğini belirttiği için önceki Flutter varsayımı geçersizdir. Web CSS/DOM ekranları native tarafta yeniden uygulanır; kurallar ve sözleşmeler yeniden yazılmaz.

## 002 — Küçük ve ayrılabilir backend

İlk API yalnızca sağlık ve yetenek bilgisi verir; Node HTTP adaptörü ek framework gerektirmeden çalışır. İleride hesap, şablon ve seans modülleri tek backend içinde bağımsız kullanım senaryolarıyla eklenir. Mikroservise geçiş ölçülmüş işlem yükü, farklı ölçekleme veya ayrı dağıtım ihtiyacıyla gerekçelendirilir. Süreç ayırmak, temiz katman sınırlarının yerine geçmez.

## 003 — Analiz cihazda

Referans ve canlı video webde yerel, mobilde native adaptörlerle işlenir. API canlı geri bildirim döngüsüne girmez. Bulut işçisi ancak cihaz performansı ölçümleri gerektirirse ve veri yükleme davranışı açıkça kararlaştırılırsa eklenir.

## 004 — Ses kararı kurallardan

Uyarı kodu ve metni doğrulanmış hareket analizinden gelir. İlk sürümde LLM veya ücretli API yok. 10 saniye bir LLM çağrı sıklığı değildir; sürekli analizden çıkan güncel hatanın seslendirme aralığıdır. LLM daha sonra yalnızca onaylanmış metni ifade etmek için düşünülebilir ve gecikmiş cevap okunmaz.

## 005 — Gerçeği yansıtan başlangıç

Gerçek poz motoru bağlanmadan video kabulü, canlı skor veya başarı raporu gösterilmez. Referans poz çıkarımı için `BrowserPoseExtractor` eklendi. Üretilen harita ölçüm taslağıdır; `qualification: not_evaluated` olarak saklanır. Nihai kabul kararı için hareket ve kamera açısı doğrulaması ayrıca gereklidir. Birim testlerdeki örnek kanıtlar sentetiktir.

## 006 — Kısa ajan bağlamı

Kökteki `AGENTS.md` kısa, kalıcı çalışma kurallarını içerir. İlgili ayrıntı belgeleri gerektiğinde okunur; aynı bilgi bütün dosyalara kopyalanmaz. `STATUS.md` sonraki oturumun başlangıç noktasıdır. Bu düzen kota artırmaz veya belirli bir tasarruf garantisi vermez.

## 007 — Vücut profili bir kez, video analizi ayrı

Kullanıcı gerçek kamerada eklemlerin çizildiği halde ilerlemenin %0 kaldığını ve uzaklaşınca metni okuyamadığını bildirdi. Güncel isteği vücudu bir kez tarayıp her egzersizde aynı profili korumaktır. Zorunlu T/A pozu ve referansa dönme adımı vücut taramasından kaldırıldı; rahat ayakta duruş, gerekli eklemler ve tutarlı ölçüm izlenir. Vücut genişliği izdüşümünden ön görünüm onayı verilmez. Büyük ekran ve sesli kurulum eklendi. Profil yerel, sürümlü ve video/tekrardan bağımsız saklanır; canlı kadraj ve yeni referansın kamera açısı ayrı değerlendirilir. Kurulum sesi egzersiz hatalarının 10 saniye politikasını değiştirmez.

Kaynak: [OpenAI AGENTS.md rehberi](https://developers.openai.com/codex/guides/agents-md/).

## 008 — Bölümler ve yerel demo giriş

9 Ekim 2026: kullanıcı tarama sonunda ilerleyemediğini bildirdi; “Vücudum” sekmesi ve hesap altında kayıt önerdi. Ardından tek düğmeli demo giriş, verilerin en az aynı sekme boyunca korunması ve gerçek Firebase hesabının sonraya bırakılmasını seçti. Üç gerçek web bölümü eklendi; demo durumu sekmede, mevcut veriler tarayıcıda tutulur. Kimlik doğrulama/bulut senkronizasyonu eklenmez ve yapılmış gibi gösterilmez. Hesap ekranının demo olması analiz sonuçlarını demo yapmaz; üretim kamera motoru yerel gerçek analizini sürdürür.

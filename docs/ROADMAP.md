# Geliştirme sırası

Yüzdeler yerine somut çıkış kriterleri kullanılır. M0 temel yapı aşamasıdır; ürünün tamamlandığı anlamına gelmez.

| Aşama | İş | Bitti sayılması için |
|---|---|---|
| M0 | Monorepo, ortak kurallar, web önizlemesi, belgeler | Tip/test/derleme geçer, eksik motor açıkça belirtilir |
| M1 | Referans videoda gerçek MediaPipe Worker | Gerçek dosyadan zaman damgalı poz çıkarır, iptal edilebilir, UI donmaz |
| M2 | Desteklenen hareket/açı ve uygunluk | Görünmeyen eklem, çoklu kişi, eksik tekrar ve açı testlerinde gerekçeli sonuç |
| M3 | Tekrar şablonu ve canlı kamera | Aynı kamerada farklı hızdaki bir hareket doğru fazla eşleşir |
| M4 | Sapma kuralları, TTS ve yaşam döngüsü | Doğru harekette sessizlik, en az 10 saniye aralık, belirsizlikte düzeltme yok |
| M5 | Seans özeti ve cihazda geçmiş | Tekrar, sapma ve ölçülemeyen süre ayrı gösterilir; kullanıcı silebilir |
| M6 | Expo mobil istemci | Aynı ortak testler, native kamera/poz/TTS; gerçek Android/iOS cihaz testi |
| M7 | İhtiyaç varsa hesap ve senkronizasyon | Erişim kontrolü, silme, saklama ve aynı API sözleşmesi |

## Sıradaki somut iş

M1–M5'in web akışı kodlandı: gerçek poz çıkarımı, serbest tekrarlı hareketin 2B şablonu ve ayrı squat ön ayarı, gerekçeli referans kararı, tek vücut profili, yerel video koleksiyonu, canlı faz/tekrar karşılaştırması, 10 saniyelik ses kuralı ve her iki hareket türünün Geçmiş kaydı. Model/decoder/kamera/depolama hataları başarı veya egzersiz reddi olarak gösterilmez. Hedef Xiaomi cihazı, farklı ışıklar, hareketler ve kişiler üzerinde gerçek kamera, ses, yanlış kabul/ret ve performans değerlendirmesi tamamlanmadı. İlk cihaz senaryosu: tek tarama → serbest referans → video ve şablon kaydı → yenileme → canlı başlangıç/tekrar/ses → Geçmiş. M6 için ortak portlar ve native depolama/ses/kamera iskeletleri test edildi; Expo ekranları, gerçek native poz sürücüsü ve Android/iOS testi gerekli. M7 gerçek hesap ve senkronizasyon kullanıcı kararıyla ertelendi. Tüm egzersizleri tanıma veya tamamlanmış mobil uygulama iddiası yapma. Ayrıntılı kanıtlar `STATUS.md` içindedir.

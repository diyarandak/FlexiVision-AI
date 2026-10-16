# FlexiVision çalışma talimatları

## Önce oku
- `docs/STATUS.md`: mevcut durum ve sıradaki iş.
- Göreve göre yalnızca ilgili belgeyi aç: ürün için `docs/PRODUCT.md`, mimari için `docs/ARCHITECTURE.md`, kabul kriterleri için `docs/TESTING.md`.
- Kullanıcının son kararı: önce web, sonra mobil. Aynı kurallar iki platformda kullanılacak.

## Değişmez ürün kuralları
- Referans video kabul veya gerekçeli ret alır. Teknik arıza ayrı durumdur; sahte onay üretme.
- Egzersiz sırasında hareket sürekli gözlenir. Egzersiz düzeltmesi ilk kez 10. saniyede değerlendirilebilir; sonraki kontroller arasında en az 10 saniye vardır. Kurulum yönlendirmesinin ses politikası ayrıdır.
- Vücut profili bir kez, videodan bağımsız oluşturulup saklanır. Zorunlu T/A pozu veya referans hareketi taklit etme şartı ekleme; yeni video profil kaydını silmez.
- Doğru harekette sessiz kal. İzleme belirsizse egzersiz düzeltmesi üretme. Geçmiş uyarıları kuyruğa alma.
- Tarayıcı/video/SDK nesnelerini ortak çekirdeğe taşıma. Ham video varsayılan olarak cihazda kalır.
- Model yoksa arayüz bunu açıkça söylemeli. Demo verisini gerçek analiz sonucu gibi gösterme.

## Kod sınırları
- `contracts`: veri tipleri. `core`: saf iş kuralları. `application`: kullanım senaryoları ve portlar.
- Web/mobil/API bu paketleri kullanır; ortak paketler uygulamaları import etmez.
- Framework, ağ, depolama, saat ve ses gibi etkileri adaptörlerde tut.
- Yeni servis eklemeden önce somut bağımsız ölçekleme/dağıtım ihtiyacını `docs/DECISIONS.md` içinde kaydet.

## Verimli çalışma
- Önce `rg` ile ilgili dosyayı bul; tüm depoyu, kilit dosyasını veya belgeleri yeniden okuma.
- `node_modules`, `dist`, video dosyaları ve model ağırlıklarını arama/bağlama dahil etme.
- Aynı kuralları farklı belgelerde çoğaltma. `PRODUCT.md` davranışın ana kaynağıdır.
- Küçük, tamamlanabilir bir işi bitir. Başarısız veya yapılmamış doğrulamayı geçmiş gibi yazma.
- Kota/token tasarrufu için doğruluk veya gerekli testlerden vazgeçme; bu dosya hesap kotasını değiştirmez.

## Doğrulama
- Kod değişiminde ilgili davranış testini ve `npm run typecheck` çalıştır.
- İlk kurulum veya platform değişiminde `npm run check` çalıştır.
- İlgili kontroller geçtikten sonra yeni risk yoksa aynı testleri tekrar çalıştırma.
- Tamamlanan işi, sınırlamaları ve sonraki adımı `docs/STATUS.md` içinde güncelle.

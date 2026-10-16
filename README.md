# FlexiVision AI

Önce web, ardından mobil: referans egzersiz videosunu analiz eden; kamera kurulumu, hareket aşamaları ve ölçülen farklar için Türkçe sesli yönlendirme veren uygulama.

**Durum (16 Ekim 2026):** MediaPipe Worker ile cihazda poz/açı analizi, referans şablonu, canlı karşılaştırma, set/tekrar hedefleri, sesli yönlendirme ve sade egzersiz raporu mevcut. Son tam doğrulamada 398 test, tip kontrolü ve web/API derlemesi geçti. Son ses düzeltmeleri sentetik kamera/sesle tarayıcıda doğrulandı; gerçek Android kamera ve hoparlör doğrulaması hâlâ gerekli. Mobil klasöründe sürücü arayüzleri var; çalışan Expo uygulaması yok. [Güncel durum ve eksikler](docs/STATUS.md).

**Web uygulaması:** [FlexiVision AI](https://flexivision-ai-2026.web.app).

Squat ön ayarı artık tam döngüleri ayırıp iniş/dip/çıkış fazlarıyla seçilebilir tekrar taslağı oluşturuyor. Seçilen döngü 51 noktalı JSON şablonuna dönüştürülebilir ve videoda ayrı oynatılabilir. Sınırlar ve mühendislik eşikleri: [tekrar taslağı](docs/REPETITIONS.md).

Vücut profili video seçmeden bir kez oluşturulup bu tarayıcıda saklanır. Ayakta rahat duruş yeterlidir; T/A pozu veya referans egzersizini taklit etme zorunluluğu yoktur. Büyük tarama ekranı, duruş çizimi ve Türkçe sesli yönlendirme eklendi. Yeni video/sayfa yenileme yeniden tarama istemez. Kurallar ve 2B normalizasyon ortak paketlerde çalışır. [Yöntem ve sınırlar](docs/CALIBRATION.md).

## Çalıştırma

Telefondan deneme ve Firebase yayın talimatları: [Hosting](docs/HOSTING.md).

Node.js 24 ve npm kullanılır. Proje kökünde:

```sh
npm ci
npm run models:download
npm run dev
```

Web: `http://127.0.0.1:5173`. Video seçimi yereldir; dosya sunucuya gönderilmez.

Vücut profili için ana sayfada **Vücudumu bir kez tara**, sonra **Kamerayı aç ve tara** düğmesine bas. Kameraya bakarak ayakta rahat dur; başından ayaklarına kadar görün ve en az 2,5 saniye geçerli ölçümü bekle. Tamamlanınca kamera kapanır ve profil kaydedilir. Mikrofon/video kaydı açılmaz. Saklama bu tarayıcı/origin'e özeldir; site verilerini temizlemek kaydı siler. Ardından referans videoyu analiz edip kabul edilen şablonla canlı egzersize başlayabilirsin.

Model indirme komutu Google'ın sabit sürümlü modelini indirip SHA-256 kontrolü yapar. `dev/build` öncesinde SDK, WASM ve klasik Worker yerel sunuma hazırlanır. Paket, model ve WASM çalışma anında aynı origin'den yüklenir. Ayrıntılar: [Model varlıkları](docs/MODELS.md).

İsteğe bağlı API, ayrı terminalde:

```sh
npm run dev:api
```

API: `http://127.0.0.1:3001/healthz`. Web başlangıcı için API zorunlu değildir. Portu değiştirmek için `.env.example` dosyasını `.env` olarak kopyalayın. Üretim derlemesini çalıştırırken ortam değişkenlerini ayrıca sağlayın.

```sh
npm run check
```

Bu komut tip kontrolü, davranış testleri ve web/API derlemesini çalıştırır. Derlemeler `apps/web/dist` ve `services/api/dist` içine çıkar. API derlemesi `npm start --workspace @flexivision/api` ile başlar.

## Yapı

```text
apps/web/               React + Vite web uygulaması ve tarayıcı adaptörleri
apps/mobile/            İleride Expo/React Native için geçiş planı
packages/contracts/    Platformdan bağımsız ortak veri tipleri
packages/core/         Saf iş kuralları ve geometri
packages/application/  Kullanım senaryoları ve adaptör arayüzleri
services/api/          Yerel HTTP API başlangıcı
docs/                  Ürün, mimari, kabul kriterleri ve çalışma durumu
```

## Başlangıç belgeleri

- [Ürün gereksinimleri](docs/PRODUCT.md)
- [Mimari ve veri akışı](docs/ARCHITECTURE.md)
- [Kararlar ve gerekçeler](docs/DECISIONS.md)
- [Geliştirme sırası](docs/ROADMAP.md)
- [Test ve kabul kriterleri](docs/TESTING.md)
- [Güncel durum ve sonraki iş](docs/STATUS.md)
- [Kodlama ajanı talimatları](AGENTS.md)

Bu proje henüz üretime hazır bir egzersiz değerlendirme sistemi değildir. Kabul kararı, videonun sistem tarafından analiz edilebilirliğiyle ilgilidir; bir hareketin belirli bir kişi için tıbben uygun olduğunu göstermez.

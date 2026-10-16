# Poz modeli ve tekrar üretilebilir kurulum

- SDK: `@mediapipe/tasks-vision` **1.1.0**, npm kilit dosyasında sabit.
- Model: Google Pose Landmarker Lite, `float16/1`.
- Kaynak, dosya adı ve SHA-256: `scripts/model-manifest.json`.
- Kurulum: `npm ci`, ardından `npm run models:download`.
- Yerel varlık hazırlama: `npm run vision:prepare`; web `predev/prebuild` bunu otomatik çağırır.
- Worker kaynağı değişirse `npm run vision:prepare` tekrar çalıştırılmalı. Vite, üretilmiş Worker'ı TypeScript kaynağından otomatik yeniden derlemez.

`apps/web/public/models`, `public/vendor` ve `public/workers` içindeki büyük/üretilmiş dosyalar Git'e konmaz. Model indirme checksum eşleşmezse durur. Hazırlama betiği SDK sürümünü kontrol eder; farklı bir WASM sürümünü sessizce kullanmaz. Dağıtım kök URL'yi (`/`) varsayar.

SDK paketinin lisansı Apache-2.0 olarak beyan edilir. Modelin kaynağı ve sürümü sabitlenmiştir; modelin yeniden dağıtım koşulları SDK paket lisansıyla otomatik olarak aynı kabul edilmez. Yayınlama aşamasında modelin ilgili kullanım/dağıtım şartları ayrıca doğrulanmalıdır.

Referans analizi 10 Hz örnekler, görüntüyü en uzun kenarı en fazla 960 piksel olacak şekilde küçültür ve CPU delegate kullanır. Kaydedilen 3B koordinatlar model tahminidir. Görsel açı grafikleri en/boy oranı düzeltilmiş görüntü düzlemindeki 2B açılardır.

Kaynaklar: [Google Web rehberi](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js), [resmî model dosyası](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task).

## Geliştirici testi

`apps/web/tests/pose-smoke.html`, sadece Vite geliştirme sunucusunda kullanılan bir test sayfasıdır; üretim giriş noktası değildir. `tests/fixtures/pose.jpg` dosyası Google'ın [örnek poz görselinden](https://storage.googleapis.com/mediapipe-assets/pose.jpg) indirilmiştir ve Git'e eklenmez. Test sayfası bu sabit görüntüden veya boş tuvalden kısa video oluşturur; model/decoder bağlantısını kontrol eder, gerçek egzersiz veya klinik doğruluk kanıtı sağlamaz.

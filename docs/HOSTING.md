# Firebase Hosting

Proje: `flexivision-ai-2026`. Web adresi: <https://flexivision-ai-2026.web.app>.

## Ücretsiz kurulum

Firebase Hosting'in Spark planı kullanılır. Faturalandırma hesabı bağlanmadı; Cloud Functions, Cloud Run, App Hosting ve Cloud Storage kurulmadı. Web uygulaması için API servisi gerekmez. Referans videosu ve kamera kareleri cihazda analiz edilir; Hosting'e gönderilmez. Vücut profili ve oturum özetleri bu tarayıcının localStorage alanında kalır.

9 Ekim 2026 tarihindeki [Firebase fiyatlandırması](https://firebase.google.com/pricing) Hosting için 10 GB depolama ve 360 MB/gün ücretsiz veri aktarımı listeler. [Hosting kota belgesi](https://firebase.google.com/docs/hosting/usage-quotas-pricing) aktarımı 10 GB/ay olarak açıklar; ücretsiz sınır aşılırsa site duraklatılabilir. Güncel kullanım Firebase konsolundaki Hosting / Usage bölümünden izlenir. Ücretsiz plan sınırsız trafik anlamına gelmez.

İlk yayın paketi 12 dosya, sıkıştırılmadan yaklaşık 45,4 MB. Her cihaz tüm WASM varyantlarını indirmez; SDK desteklenen varyantı seçer. Dosya adı özetli JS/CSS ve sürüm yolu sabit SDK/WASM bir yıl önbelleklenir. HTML, Worker ve model yeniden doğrulanır. Model ilk analiz/tarama sırasında yüklenir.

## Telefondan kullanma

1. Web adresini telefonun güncel tarayıcısında aç → **Demo olarak giriş yap** → **Vücudum**. Gerçek hesap oluşturulmaz; demo giriş aynı sekmede yenilemede korunur.
2. **Vücudumu bir kez tara** → **Kamerayı aç ve tara** düğmelerine bas, kamera iznini ver.
3. Telefonu sabitle, başın ve ayakların kadrajda olacak şekilde ayakta rahat dur. Geçerli ölçüm tamamlanınca profil otomatik kaydedilir.
4. Sonuç ekranından **Vücuduma dön** veya **Egzersizlerime geç**. Egzersizlerim bölümünde videoyu analiz edip onaylanan şablonu kaydet; sonraki seanslarda aynı kayıtla başlayabilirsin. Raporlar **Geçmiş** bölümündedir.

Bilgisayardaki `localhost` kaydı telefona taşınmaz. HTTPS adresindeki tarayıcıda bir kez tarama gerekir; sonraki videolar aynı profili kullanır. Gizli sekme ve site verilerini silmek kalıcı kayıt için uygun değildir. Cihazlar arası profil senkronizasyonu henüz yok. Gerçek iPhone/Android kamera ve ses davranışları kullanıcı cihazında doğrulanmalı.

## Yeni sürüm yayınlama

Firebase CLI kurulu ve doğru hesapla giriş yapılmış olmalı. Proje kökünde:

```sh
npm ci
npm run models:download
npm run check
npm run deploy:web
```

`.firebaserc` varsayılan projeyi seçer. `firebase.json` sadece `apps/web/dist` klasörünü yayınlar ve her yayın öncesi web derlemesini çalıştırır. Test sayfaları, kaynak kod, yerel veriler ve kişisel videolar yayın paketine dahil edilmez. Eksik varlıklar HTML'e yönlendirilmez; 404 döner. WASM MIME türü açıkça ayarlanır. Hosting HTTPS'i otomatik sağlar ([kurulum belgesi](https://firebase.google.com/docs/hosting/quickstart)).

Console: <https://console.firebase.google.com/project/flexivision-ai-2026/hosting>.

## Doğrulama

- Güncel tip/test/derleme ve yayın kanıtları `docs/STATUS.md` içinde kayıtlıdır.
- Faturalandırma API'si `billingEnabled: false` döndürdü.
- `firebase deploy --only hosting` tamamlandı. Canlı HTML yerel derlemeyle aynı; JS/CSS, Worker, model ve üç WASM varyantı HTTP 200 döndürdü. WASM `application/wasm`, model `application/octet-stream` ile sunuluyor; eksik model 404 döndürdü. Önbellek başlıkları doğrulandı.
- Canlı sitede 390×844 görünümde vücut tarama ekranı açıldı: yatay taşma yok; kamera başlatma, ses ve kapatma düğmeleri görünür alanda. Ekran görüntüsü `/tmp/flexivision-firebase-phone.jpg`. Bu kontrolde kamera izni alınmadı, gerçek telefon/model/ses çalışması test edilmedi.

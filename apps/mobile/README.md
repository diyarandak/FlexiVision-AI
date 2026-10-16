# Mobil geçiş planı

Bu klasör henüz bir Expo uygulaması değildir. Kamera/TTS sürücü arayüzleri, profil/geçmiş/referans depolama adaptörleri ve oturum denetleyicisi ortak paketlerle test ediliyor. Gerçek Expo bağımlılıkları, native poz motoru, kamera/TTS sürücü bağlantıları, ekranlar ve cihaz derlemesi eklenmedi.

## Aynen kullanılacaklar

- `@flexivision/contracts`: sonuç ve olay tipleri.
- `@flexivision/core`: video kabulü, geometri ve 10 saniyelik uyarı politikası.
- `@flexivision/application`: kullanım senaryoları ve portlar.
- Aynı paketlerin davranış testleri ve ileride HTTP sözleşmesi.

## Denetleyici bağlantısı

`NativeSessionHistoryRepository` ve `NativeReferenceTemplateRepository`, aynı `NativeStorageDriver` örneğiyle kullanılmalıdır; asenkron işlemler sürücü/anahtar başına sıralanır. Kimlik üreticisi platformdan enjekte edilir. Web ile aynı kayıt doğrulama/alan seçimi kullanılır; farklı cihazlar arasında otomatik paylaşım yoktur.

`MobileSquatSessionController` ikinci argümanda her seans için yeni `LivePoseSource` döndüren bir factory alır. Altıncı argümandaki `bodyProfile`, `history` ve `now` seçenekleri profil/rapor bağlantısını sağlar; `now` kamera zaman damgasıyla aynı monoton saati kullanmalıdır. `start()` önce ortak kadraj hazırlığı/geri sayımdan geçer. `finishAndSave()` kullanıcı bitişi, `interrupt()` arka plan/ekran kapatılması için beklenebilir saklama yoludur. `retrySave()` aynı dondurulmuş raporu tekrar dener; `discardUnsavedReport()` bekleyen yazma yokken açıkça vazgeçer. Saklanmamış rapor varken yeni seans onu sessizce silmez. `saveError` ve teknik `error` ayrı gösterilmelidir.

Bu metotları AppState ve ekranlara bağlamak, hazırlık yönlendirmesinin native sesi/ilerleme görünümü ve sürücü saatini doğrulamak sonraki mobil istemci işidir.

## Mobilde uygulanacaklar

Native video seçimi, kamera, MediaPipe adaptörü, TTS, izinler, uygulama yaşam döngüsü, dosya/şablon saklama ve React Native ekranları. Tarayıcı Worker, DOM ve Web Speech API native uygulamaya taşınmaz. Gerekli native modüller seçildikten sonra Expo development build gereksinimi doğrulanır.

Her iki platformda ölçü birimi, zaman damgası, koordinat sistemi, sağ/sol eşlemesi ve model/politika sürümü aynı sözleşmeye uyar. React Native UI içine iş kuralı kopyalanmaz. Bir paketin paylaşılması model performansının cihazlar arasında aynı olacağını garanti etmez.

Kaynak: [Expo monorepo rehberi](https://docs.expo.dev/guides/monorepos/).

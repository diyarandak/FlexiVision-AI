# Doğrulama

## Koleksiyon ve önizleme regresyonları

`videoPreview.test.ts` duraklatılmış videoda sürekli kare döngüsü olmamasını, oynatmada tek döngüyü, aramada eski iskeletin gizlenmesini ve kapatılmış önizlemeye geç callback gelmemesini doğrular. `libraryView.test.ts` Türkçe/ASCII aramayı, çok sözcüklü sorguyu, tür/sıralamayı ve kaynak kayıtların korunmasını kapsar. Kart testinde okuma hatası yeniden deneme sunar ve boş koleksiyon mesajı göstermez.

`tests/app-smoke.html?readError=1` üç depoda sentetik okuma hatası üretir. Test menüsündeki “Depolama erişimini düzelt” ardından her bölümde yeniden okuma denenebilir; ayrı test anahtarları kullanılır. “Üç arama kaydı ekle” arama için sentetik adlar ekler. Silme → vazgeçme, mobil kart seçeneklerinin alt gezinmeye taşmaması ve video → analiz → koleksiyona dönüş → videoya dönüş akışı kontrol edilir. Sentetik kamera/ses vardır; referans video elle seçilip analiz başlatılırsa gerçek yerel poz modeli çalışır. Test sayfası üretim paketine girmez.

## Çalışan otomatik testler

`repetitionGoal.test.ts` set sınırını, 5 tekrarlı hedefi, kısmi hareket/kadraj kaybında sayının korunmasını ve sayı sesiyle referans uygunluğunun ayrılmasını sınar. `sessionSpeech.test.ts` yeni sayının meşgul talimatı değiştirmesini, rutin karelerin sayı sesini kesmemesini ve sayı kuyruğu oluşmamasını doğrular. Geçmiş/rapor testleri hedefin yeniden yüklenmesini, bozuk ek hedef verisinin atılmasını ve yarım kalan setin tamamlandı gösterilmemesini kapsar. `generic-smoke.html` üzerindeki öğretici akış seçeneği, başlangıç öncesi hedef seçimi → üst set/tekrar sayacı → her tam tekrarda ses → son hedefte otomatik kapanış ve tek özet kaydını sentetik olarak denemek içindir.

```sh
npm run typecheck
npm test
npm run build
```

`npm run check` üçünü birleştirir. Çekirdek testleri sentetik ölçümlerle iş kuralını doğrular; model doğruluğu, klinik geçerlilik veya cihaz performansı göstermez.

Tempo/ses optimizasyon testleri: yüksek kare hızında yarım dereceden küçük farklarla yavaş yükseliş, dipte bekleme, 30 saniyede tamamlanmayan döngünün sıfırlanması, tek kare bükülme sıçraması ve ham haritayı değiştirmeyen şablon filtresi. Referans adaptörü testleri sıradaki kare çözümlemesinin inference ile örtüşmesini, 10 Hz zaman sırasını, tek inference, 640/960 boyutlarını ve iptalde bitmap temizliğini doğrular. Ses testleri Türkçe yerel ses seçimi, başlamayan ses için hata, düzelmiş uyarının iptali/geç makbuzun elenmesi, kesin komut eşleme, yarım/çift/yankı/arka plan sonuçları, izin reddi ve sınırlı yeniden bağlanmayı kapsar. `live-smoke` sentetik tanıma factory'siyle mikrofon açmadan ses aç/kapat ve bitir → rapor kaydını test eder.

`squatCycles.test.ts`: tam döngü ve faz sınırları; baş/son yarım parçalar; kısa ayakta gözlem; sabit/sığ/yalnız diz hareketi; kısa poz sıçraması; eksik ölçüm/zaman boşluğu; taraf değiştirme; yetersiz/çoklu kişi verisi; uzun dip beklemesi; tekrar seçimi ve 51 noktalı JSON; farklı referans hızında aynı açı vektörü. Gerçek kullanıcı dışa aktarımı ayrıca yerel olarak kontrol edildi, kişisel/ham poz dosyası test deposuna eklenmedi.

`genericCycles.test.ts`: düz kolla kol kaldırma gibi squat olmayan hareket için 2B döngü/51 nokta; farklı referans temposu ve kamera ölçeği; sabit/sığ/tek kare sıçrama, görünürlük boşluğu, çoklu kişi ve izdüşüm değişiminde ret. `liveGeneric.test.ts` farklı canlı tempoda tekrar sayımı, durağan poz/takip kaybında sahte tekrar üretmeme ve onaysız şablonu engellemeyi sınar. `trackLiveGenericSession.test.ts` uygulama portundan kaynak temizliği, sessizlik ve yavaş karede belirsizliği sınar. `extractReferenceMap.test.ts` serbest modun indirilen haritaya kendi kararını yazmasını doğrular.

Canlı görsel testleri: `liveGeneric.test.ts` eşleşen referans eklemlerinin mevcut kamera gövdesine, aynalanmış görünümde de hizalanmasını; belirsiz takipte projeksiyon olmamasını; kırmızının yalnız güvenilir yerel 2B farkta görünmesini sınar. `livePoseOverlay.test.ts` squat hazırlık/belirsizlikte kırmızı çizgi olmamasını, diz veya kalça farkında yalnız ilgili izlenen parçanın vurgulanmasını doğrular. 390×844 ve 360×640 sentetik tarayıcı kontrolü kamera alanının yüksekliğini ve yatay taşmayı denetledi; gerçek kamera/model hareketi değildir.

Kısmi squat testleri ayakta başlangıç/dönüş eksikliğini ve çömelmiş → ayakta → çömelmiş sırasını tanılar; eksik döngüden şablon üretilmez. Veri boşluğu önceliklidir; sabit/sığ/yalnız diz hareketi kesilmiş squat gibi etiketlenmez. `motionResults.test.ts` gerçek sonuç bileşeninin kısmi referansta tek somut döngü gerekçesi ve kapalı canlı başlatma, tam referansta kabul ve açık başlatma göstermesini sınar. Bu arayüz testi sunucu render'ıdır; gerçek telefon/model denemesi değildir.

`calibration.test.ts`: video/T pozu gerektirmeyen rahat ayakta duruş, gövde genişliği nedeniyle ret vermeme, kısa görünürlük kaybında süre saymadan duraklama, uzun kayıp ve çoklu kişide sıfırlama, duruş/kadraj/baş görünürlüğü, minimum kare sayısı, tamamlanmış profilin korunması, profil sürüm/sayı doğrulaması ve 2B normalizasyon. Referans izdüşümü yardımcı fonksiyonu ayrı test edilir. Kullanım senaryosu testleri durdurma/geç sonuçları; `browserCameraPose.test.ts` izin gecikmesi/reddi, model hatası, tek karelik işlem sırası, gecikmiş bitmap ve kamera bağlantı kesilmesinde kaynak temizliğini kapsar.

`bodyProfile.test.ts`: yeni repository ile kaydı geri yükleme, silme, bozuk/eski/büyük kaydı reddetme, saklama hatasını başarı saymama ve ham veri/ek alanları yazmama. `calibrationVoice.test.ts` titreyen mesajları, güncel yönlendirmeyi, tekrar aralığını ve geçersiz saati; `speech.test.ts` eski kurulum sesinin değiştirilmesini, iptal ve hata callback'lerini, mevcut egzersiz sesi meşgul davranışının korunmasını kapsar.

`apps/web/tests/calibration-smoke.html` gerçek tarama/profil ekranlarını açıkça etiketlenmiş sentetik poz/ses kaynağıyla çalıştırır. Kamera/model/ses açmaz; ayrı `flexivision.body-profile.smoke.v2` anahtarını kullanır. Arayüzde eksik ayak bileği yönlendirmesi ve ses metni, tek duruşla otomatik kayıt, kamera kapalı sonucu, yenilemede kaydı geri yükleme, kayıt hatasında başarısız sonuç, yeniden kaydetme ve silme doğrulandı. Test kaydı temizlendi. Ana sayfada video seçmeden büyük tarama ekranının açılması, duruş çizimi ve kapatınca odağın geri gelmesi de kontrol edildi. Gerçek kamerada başarı ve sesin fiziksel olarak duyulması ayrıca denenmelidir.

`pose-smoke.html` sabit poz görselinden test videosunu gerçek yerel model/Worker ile işler. Bu testler egzersiz doğruluğunu kanıtlamaz.

Yeni kontroller: `calibrationTiming.test.ts` ve tarama/kamera testleri yavaş ardışık analiz ile kesilmiş/takılmış akışı ayırır. `referenceSquat.test.ts` izlenebilen bir tarafın ön görünümü yanlış onaylamadığını; `liveSquat.test.ts` eksik başlangıç, takip boşluğu, eksik şablon, monoton saat ve iniş sırasında erken derinlik uyarısını sınar. Oturum testleri ilk kamera sonucundan 10 saniyelik sessizliği, ses adayını gerçekten başlamış sesten ayırmayı ve yavaş veride düzeltme üretmemeyi kapsar. Native adaptörler gecikmiş izin ve iptal edilmiş meşguliyet kontrolüyle sınanır. `tests/live-smoke.html` ayrı sentetik kaynakla takip kaybı, açı temizleme, seans özeti ve yeniden başlatmayı test eder; üretime dahil değildir.

## Kritik kabul kriterleri

`demoSession.test.ts`: demo girişin aynı sekme depolamasından geri yüklenmesi, kimlik/şifre üretmemesi, çıkışın profil ve referans kayıtlarını silmemesi, bozuk veri/depolama reddi ve üç URL bölümünün ayrılması. Kamera testinde SDK temizliği hata verse bile track/video bağlantısının bırakılması ve başlangıçtaki asıl hatanın bildirilmesi sınanır. Kullanım senaryosu testi kapatma hatasının asıl teknik hata callback'ini ve geç sonuç korumasını atlamadığını doğrular.

`tests/app-smoke.html` gerçek `App`/demo/bölüm/tarama ekranlarını StrictMode içinde ayrı `flexivision.app-smoke.*` anahtarları ve sentetik kaynakla çalıştırır; kamera/model/ses açılmaz. %100 ölçümde `stop()` hata vermesi önceki ekranda takılmayı üretebildi. Düzeltilen akışta kaydetme, teknik not, sonuçtan egzersizlere dönme, `inert`/kaydırma kilidinin kalkması, üç bölümde gezinme ve yenilemede giriş/profil geri yükleme kontrol edilir. Kaydetme reddi/tekrar deneme ve çıkış/yeniden giriş ayrı sınanır.

`referenceLibrary.test.ts`: çekirdeğin gerçek şablon üreticisinden alınan sentetik 51 noktalı şablonun saklanması/yeniden yüklenmesi, ad değiştirme/silme, 20 kayıt sınırında eski kayıtların korunması, taslak/eksik eklem/geçersiz faz/ad reddi, bozuk kitaplığı üzerine yazmama, depolama reddi ve ham verinin alan seçimiyle dışarıda kalması. Kullanıcının önceki gerçek JSON'undan çıkarılan iki kabul edilmiş şablon da yeni kayıt doğrulamasını geçti; yeni model çalıştırılması değildir.

`referenceVideoRepository.test.ts`: şablon kimliğine bağlı yerel File kaydının dosya adı/MIME/veri korunarak yeniden okunması, Blob yüklemeden varlık kontrolü, silme/temizleme, depolama kotası ve bozuk dosya reddi. `saveExerciseCollection.test.ts` şablon ve video kayıt bariyerini, video yazma hatasında şablonun geri alınmasını ve geri alma hatasının açık bildirilmesini sınar. Bu sentetik IndexedDB testleri gerçek Xiaomi depolama kotasını doğrulamaz.

`tests/video-storage-smoke.html` ayrı sentetik IndexedDB adıyla gerçek Chromium'da File kaydı, yeni depo örneğinde geri okuma ve silmeyi denetler. Gerçek video baytları, kullanıcı dosyası veya kamera kullanmaz; oynatma/codec testi değildir.

`nativeRecords.test.ts`: aynı asenkron sürücüyle iki adaptör örneğinin eşzamanlı yazmaları, 50 rapor/20 referans sınırları, silme/temizleme sırası, depolama reddinden sonra devam etme ve profil anahtarını koruma. `mobileSession.test.ts`: hazırlığı rapordan ayırma, profil kullanımı, ölçülemeyen bitiş kuyruğu, yeni kaynakla yeniden başlama, eski callback'ler, tek rapor kaydı, başarısız saklama/tekrar deneme/açıkça vazgeçme, ölçümsüz kapanış ve teknik hatanın saklama sonrası korunması. Native profil okuma hatası “profil yok” diye gizlenmez. Native SDK/cihaz testi sayılmaz.

`tests/library-smoke.html` yalnızca sentetik şablon ve ayrı `flexivision.references.smoke.v1` anahtarını kullanır. Telefon görünümünde depolama hatası → yeniden deneme → başarı/çift tıklamayı engelleme, yenilemede geri yükleme, ad güncelleme ve ad hatasında eski kaydı koruma, videosuz canlı panel açma, tek kayıt silince tekrar kaydetme ve kitaplığı temizleme kontrol edilir. Test sayfası üretim derlemesine dahil değildir.

`tests/generic-smoke.html` yerel serbest hareket panelini sentetik kol döngüsüyle çalıştırır; kamera, mikrofon, model ve kullanıcı depolaması açılmaz. Geçmiş kaydetme çağrısı bellek içi adaptörle sayılır. Bir farklı tempolu tekrar sonrası özet ve tek kaydetme çağrısı gözlendi. Önceki 390×844 kontrolünde başlangıç duruşu, kırpılmayan kamera alanı ve yatay taşma da incelendi. Gerçek Xiaomi kamerasının görünürlüğü veya hareketin anatomik doğruluğu bu testten çıkmaz.

`liveReadiness.test.ts`: ölçülen ayakta hazırlık, üç saniyelik geri sayım, görünürlük/açı/kadraj/hız yönlendirmeleri, takip kaybı ve uzun boşlukta sıfırlama, seyrek karelerden başlangıç üretmeme. `prepareLiveSession.test.ts`: hazırlık kareleri rapora girmez; ilk düzeltme geri sayım sonrasındaki ilk ölçümden 10 saniye sonra; durdurma, geç kareler ve hatalı zamanlarda kaynak temizliği. Kamera adaptörü testleri ön/arka kamera isteği, mikrofon istememe, portre/yatay görüntü boyutu sınırı ve eşleşmeyen sonuç zamanını teknik hata olarak ele almayı kapsar.

Sentetik canlı UI testinde 390×844 görünümde ön görünüm → yan dön, eksik ayak bileği, yavaş ölçüm, hazırlığı durdururken sıfır geçmiş kaydı, geri sayımın takip kaybında iptali ve yeni hazırlıkla otomatik başlama doğrulandı. İki tam tekrar sayıldı, rapor kaydedildi, doğru takipte sıfır egzersiz ses adayı/başlangıcı gösterildi. Kurulum ses metinleri ayrı test günlüğünde görüldü; gerçek ses duyulması veya fiziksel kamera kanıtı değildir. Ayrı test geçmişi temizlendi.

`personalBody.test.ts` kayıtlı profil ile güncel merkez/ölçek, görüntü en/boy değişimi, kişisel birim değişirken açıların korunması, görünmeyen eklem ve geçersiz profil sınırlarını doğrular. Oturum testleri süre boşluklarını, son ölçümden durdurmaya kadar ölçülemeyen kuyruğu, sapma ortalaması/en büyük değerini ve profilin gerçekten kullanıldığını sınar. Yeni ayakta başlangıç, iptal edilen yarım tekrarın hatasını sonraki tam tekrara taşımaz.

`sessionHistory.test.ts` eski squat v1 ile genel hareket v2 kayıtlarının birlikte okunmasını, yeniden yükleme/silme, sıfır ölçümlü genel kaydın reddi, depolama reddi ve ham video/eklem/ek alanların hariç tutulmasını doğrular. Native test aynı karışık geçmişi ve sıralı yazmayı denetler. Diğer geçmiş testleri biten/kesilen oturum, profil anahtarını koruma, 50 kayıt sınırı ve bozuk/büyük veriyi kapsar. Sentetik canlı UI sayfası ayrı `flexivision.sessions.smoke.v1` anahtarını kullanır. Kaydetme hatası/tekrar deneme, ölçümsüz kapanış, panel kapatırken kesilmiş kayıt, yenilemede açma, JSON indirme ve silme akışları tarayıcıda denendi; test kaydı temizlendi. Bu sonuçlar gerçek cihazda kamera/ses kanıtı değildir.

| Durum | Beklenen |
|---|---|
| Seans boyunca doğru hareket | Sıfır ses adayı |
| Başlangıçtan itibaren sürekli güvenilir hata | İlk aday 10. saniyede, sonra en az 10 saniye aralık |
| Kontrol anından hemen önce başlayan kısa hata | Uyarı yok |
| Hata düzeldikten sonra kontrol | Uyarı yok |
| İzleme belirsiz veya veri kesilmiş | Geçmiş hata seslendirilmez |
| Uzun sekme askısı sonrası geri dönüş | Birikmiş uyarılar okunmaz |
| Desteklenmeyen/belirsiz görünüm | Referans reddedilir |
| Model yok veya analiz çöktü | Teknik durum; sahte kabul/ret yok |
| Taramada gerekli eklem kısa süre kaybolur | İlerleme duraklar, eksik süre sayılmaz, görünürlük mesajı |
| Taramada uzun kayıp veya çoklu kişi | İlerleme sıfırlanır; sahte profil yok |
| Profil tamamlanıp kaydedilir | Kamera kapanır; yenileme/yeni video kaydı silmez |
| Profil saklama işlemi başarısız | Başarı yok; tekrar kaydetme seçeneği |
| Kamera görüntüsü güncellenmez | Kalibrasyon yeniden başlar; eski sonuç hazır sayılmaz |
| Kamera durdurulur veya panel kapanır | Track ve Worker kapanır; geç gelen sonuç yok sayılır |
| Ham video API'ye gönderme girişimi | Böyle bir endpoint yok |

## Gerçek motor eklendiğinde

İzinli test videolarından ayrı bir değerlendirme kümesi oluştur: farklı kişiler, kamera açıları, ışık ve hızlar. Referansla canlı video arasında veri sızıntısı olmadan değerlendirme yap. Veri deposunu ve kişisel videoları Git'e koyma.

Ölç: referans yanlış kabul/retleri, kullanılabilir kare oranı, izleme kaybı, tekrar sayım hatası, faz eşleme, yanlış sesli uyarı/seans, işleme süresi ve bellek. Açı doğruluğu iddiası için bağımsız bir referans ölçüm gerekir. Confidence skorunu yüzde doğruluk diye sunma.

Tarayıcı kabul testi: Chrome/Safari hedef sürümleri, izin reddi, codec hatası, sesin kullanıcı etkileşimi gerektirmesi, sekme görünürlüğü, unmount ve object URL temizliği. Mobil aşamada gerçek cihazlarda kamera yönü, ayna görüntüsü, uygulama arka planı, ısınma ve pil tüketimi ölçülsün.

## Oturum toparlanma regresyonları (11 Ekim)

- `speech.test.ts`: bitiş olayı kaybı, eski native meşguliyet bayraklarıyla yeni oturum, eski sahibin yeni sesi kesmemesi, değiştirilmiş sesin gecikmiş zamanlayıcısı.
- `sessionSpeech.test.ts`: belirsiz takip hazırlık sesini kesmez; düzeltme iptal edilir, ses arızası kamera akışına taşınmaz.
- `voiceCommands.test.ts`: hiç başlamayan tanıma bağlantısının 15 saniyede kapanması, geç olayların yok sayılması ve yalnız açık kullanıcı eylemiyle yeniden deneme.
- `calibrationTiming.test.ts`: bekleyen kare olmadan kesilen akışın zaman aşımı ve kısa kesintiden yeni ölçümle toparlanma.
- Tarayıcı tekrar denemesi: serbest hareketi başlat → ölçüm al → bitir → Geçmiş kaydını bekle → Yeniden başla; kamera yeniden bağlanmalı, tekrar/sayaç temiz olmalı, önceki kayıt çoğalmamalı. Kayıt reddinde önce aynı özeti kaydetmeyi yeniden dene. Bu son React geçişi 11 Ekim yerel incelemesinde tarayıcı izin sınırı nedeniyle henüz çalıştırılmadı.

## Sabit duruş testleri

- `staticPose.test.ts`: kararlı aralıklar; eksik eklem/çoklu kişi/zaman boşluğu/uygunsuz süre reddi; hazırlıkta süre yazmama; takip kaybı ve sapmada duraklama; hedefte sınırlandırma; ayna, ölçek ve uzuv uzunluğu farkı; geçersiz hedef/şablon.
- `staticSession.test.ts`: kabul kararının analiz sonucuna aktarılması, tekrar uydurmama, doğru duruşta sessizlik, ortak ses kontrol aralığı, geç ses ve kare iptali, yanlış zaman damgasında kaynak kapanışı, hedefte özetin sabit kalması.
- `staticMode.test.ts` ve native kayıt testi: karma koleksiyon/geçmiş, yeniden okuma, tür filtresi, ham veriyi kayda almama, geçersiz özetin geçmişi bozmaması; sonuç/özet/hazırlık için sunucu render kontrolü.
- Fiziksel Xiaomi testi ve yeni ekranların tarayıcı etkileşim/görsel kontrolü henüz yapılmadı. Sentetik test sonuçları bütün sabit egzersizler veya farklı kamera açıları için doğruluk kanıtı değildir.

### Sabit oturumun bitiş ve yeniden hazırlığı

`staticSessionArchive.test.ts`: bitir/kapat çakışmasının aynı Promise ve tek yazmayı paylaşması, yazma sırasında vazgeçmeme, ilk özetin/depo argümanlarının mutasyonundan etkilenmeyen yeniden deneme, ölçümsüz oturumu kaydetmeme ve açık vazgeçme. `staticSession.test.ts`: çift başlatmada tek kaynak, durdurma sonrası geç capture/ölçüm olayları, UI stop çağırmasa da hedefte kaynak kapanışı, temizleme hatasında tamamlanan sonucun korunması ve yeni kaynakla sıfırdan süre ölçümü. Bu kontroller DOM odak/kamera izin penceresi/gerçek telefon testi değildir.

## Tempo ve toparlanma regresyonları (11 Ekim)

`tempoEdges.test.ts` dört referans temposunu altı canlı tempo/bekleme düzeniyle karşılaştırır (24 ayrı test); 5/10/20/30 Hz ve zamanlama dalgalanması, erken tekrar sayımı, tek kare sıçraması, eksik eklem/çoklu kişi/gecikme/boşluk sonrası yeniden başlangıç, uzun yarım döngü, squat tempo dizileri, geçersiz işlem süreleri ve kısa hareketin sonunda beklemeyle kabul edilmemesi de sınanır. `trackLiveGenericSession.test.ts` asimetrik referans ve uzun canlı bekleme durumlarında sıfır ses adayı/çıktısı doğrular. Sürekli hareket bağımsız canlı zamanlarında örneklenir; yalnız kayıtlı kareleri daha yavaş beslemekle yetinilmez. Bunlar sentetik yol testleridir, farklı gerçek egzersizler ve kişiler için doğruluk ölçümü değildir. Sade sonuç raporu: `reports/TEMPO-VE-GUVENILIRLIK-RAPORU.md`.

## Kamera kontrollerinin telefon yerleşimi

`tests/generic-smoke.html` kamera/ses/model açmadan serbest canlı paneli çalıştırır. “Yatay kamera görüntüsünü canlandır” seçeneğiyle dikey telefona yatay görüntü gelmesi ve ses kullanılamama uyarısı birlikte denenebilir. Ölçümler arayüz denemesi boyunca sürer. 390×740, 360×640 ve 740×360 kontrolünde ayar penceresinin kaydırılması, sabit Kapat düğmesi, Escape'in oturumu kapatmaması, tüm kadraj/doldurma için video-SVG dönüşümü ve oturum bitiş özeti kontrol edilir. Bu senaryolar fiziksel kamera/ses doğruluğunu kanıtlamaz.

## Dikey çekim ve başlangıç gölgesi

`browserCameraPose.test.ts` dikey format reddinde aynı lensle tek geri dönüşü, izin/lens hatasında yeniden istek olmamasını, iptalden sonra istek açılmamasını ve geç gelen kameranın kapanmasını sınar. `cameraPlacementGuide.test.ts` eksik eklem mesajları, yalnız izlenen uzuv gereksinimi, analizle aynı görünürlük eşiği ve gölgenin sabit gövde/baş dahil çizilen tüm noktalara göre ekrana sığmasını doğrular. Sentetik serbest hareket sayfasında “Vücut görünmüyor”, “Başlangıç duruşu farklı”, “Yatay kamera görüntüsünü canlandır” seçenekleri gerçek kamera/izin/model açmadan bu ekranları üretir. Arka kamera sentetik kaynakta dikey ölçü verir; bu gerçek telefon uyumluluğunun kanıtı değildir.

## 12 Ekim: kamera yönü ve başlangıç rehberi

`browserCameraPose.test.ts` sensörün temel yönünde format seçimi, portreye dönen kaynak, yatay kalan kaynak, aynı lenste tek format fallback ve iptal/izin/geç kaynak temizliğini sınar. `cameraPlacementGuide.test.ts` eksik gövde/uzuv ve belirsiz çoklu poz mesajlarını, cover görünür alanına baş/gövde sığmasını ve denetimler için ayrılan alanı doğrular.

`generic-smoke.html` artık `canvas.captureStream` ile gerçek video öğesine sentetik kareler verir; sadece video boyutlarını taklit etmez. Yatay görüntü, eksik vücut, birden çok poz adayı ve farklı başlangıç seçenekleri vardır. Kamera/mikrofon/model veya gerçek kullanıcı verisi kullanılmaz. 390×740 ve 360×640 kontrollerinde doldurma/contain seçimi, kaynak değiştirme, ayna, gerçek kaynak boyutu metni ve hazırlıkta bitiş kontrol edilir. Bu, fiziksel Xiaomi kamera doğrulaması değildir.

## 12 Ekim: oturum inceleme raporu

`sessionReport.test.ts` ölçümsüz denemenin sahte yanlış/onay vermemesi, eksik eklem nedenleri, ilk ses zamanından önce ölçülen farkın rapora girmesi, değişmeyen özet kopyaları, doğru döngü/eski kayıt ayrımı, isteğe bağlı bozuk tanı alanlarının atılması, kişisel eklerin dışarıda tutulması ve depo kota hatasını sınar. Squat/sabit duruş sonuçları sıfır ses sayısını doğruluk saymaz.

Sentetik telefon tarayıcısında (390×740) eksik gövde → bitir → TXT, teknik kaynak kurulum hatası → ölçümsüz rapor, başlangıç pozu eşleşmedi → Escape → Son deneme raporu kontrol edildi. Yeni rapor kapatma ve sayfa yenilenmesi sonrasında okunabildi; tamamlanmış egzersiz sayacı sıfır kaldı. Gerçek indirilen TXT dosyasının nedenler, kamera ölçüsü, son mesaj ve JSON sayısal bölümünü içerdiği okundu. Bu denemeler ayrı `flexivision.smoke.report` anahtarını kullanır, kamera/mikrofon/poz modeli açmaz. Fiziksel Xiaomi indirme akışı henüz doğrulanmadı.


## 15 Ekim: ekleme göre yönlendirme ve sade rapor

- `genericCorrections.test.ts`: diz/dirsek açısındaki işaretli fark, en büyük ilgili farkın seçilmesi, eksik/geçersiz açı, yatay ve aynalı görüntüde derinlik komutu üretmeme; yön/eklem değişiminde ses kalıcılığının sıfırlanması ve 10 saniyelik aralık.
- `genericCoaching.test.ts`: tek diz hareketini çömelme sanmama. `genericProgressGuidance.test.ts`: dönüşün seçilen referanstan gelmesi, aynı aşamada iki saniyelik toparlanma ve kayıpta onayın silinmesi.
- `sessionReport.test.ts`: gerçek karşılaştırıcıdan gelen kalıcı açı farkının rapor/geçmişe geçmesi, tek kareden kesin öneri üretmeme, bozuk isteğe bağlı veriyi atma ve ham alanları kayda almama; eski rapor başlığının ve indirme uyumluluğunun korunması.
- `tests/generic-smoke.html` içindeki “Kalıcı dirsek farkı, düzeltme ve rapor” seçeneği saf karşılaştırıcı, ses isteği, 392×736 rapor ve kısa TXT indirme akışını test eder. Sentetik veri gerçek cihaz algılama/hoparlör doğrulaması değildir.

## 15 Ekim — uzaktan yönlendirme ve kurulum

`genericCoachReminder.test.ts`: gözlenen 10 saniyelik bekleme, aynı komut anahtarı, 12 saniyelik tekrar aralığı, biriken küçük hareket, aşama/tekrar değişimi, belirsizlik/fark/uzun boşlukta hatırlatmanın iptali. `cameraPlacementGuide.test.ts`: bölge görünürlüğü ile başlangıç kabulünün ayrılması, eksik ayak/çoklu aday/yükleme durumunda hazırlığa dönüş. `sessionReport.test.ts`: baskın açı/başlangıç/yavaş işleme nedeninin sade sonraki adıma taşınması; tanı verisi olmayan eski kayıtta neden uydurmama.

Bu tur ayrı Chrome profilinde 392×736 ve 320×568 görünüm kontrol edildi: bekleyen başlangıca hatırlatma ve otomatik örnek; kabul edilmiş başlangıçta bekleyene güncel komut; eksik vücutta kadraj adımı; tek tekrar hedefinde yön sırası, otomatik bitiş ve tek geçmiş kaydı. Yatay taşma ve komut/örnek örtüşmesi yok. Kaynak `tests/generic-smoke.html`, kamera/ses sentetik. Gerçek model, kamera, mikrofon veya hoparlör doğrulaması değildir.

## 16 Ekim — sessiz düzeltme ve kesilen yön sesi

`policies.test.ts`: 10 saniye sınırında belirsiz karelerin devam eden hatayı sürekli erteleyememesi; konuşma meşgulken sürenin tüketilmemesi; çözülmüş hatanın kuyruğa alınmaması; ilk 10 saniye/1,5 saniye kalıcılık/iki düzeltme arası 10 saniye. `genericCorrectionSpeech.test.ts`: gerçek karşılaştırıcı → ses kanalı → gecikmeli başlangıç → özet sayacı; doğru karede tamamlanma ve belirsizlikte iptal. Başlamış yön cümlesi ilk hatada bitirilebilir; başlamamış/geçersiz yön iptal edilir. Sentetik tarayıcı sayfası gecikmeli başlangıç ve tamamlanma/iptal günlüğü ile hatalı dönüş senaryosu sunar.

# Deneysel canlı squat oturumu

Ürün kuralları `PRODUCT.md` içindedir. Bu akış squat ön ayarına özeldir; genel egzersiz sınıflandırıcısı veya hareket güvenliği değerlendirmesi değildir.

## Referans

`referenceSquat.ts` döngü ve görünürlük kanıtlarını `evaluateReference` politikasına bağlar. Bir tarafın eklemlerinin izlenmesi kamera açısını kanıtlamaz. `cameraView.ts` görünür omuz/kalça çiftlerinin görüntü düzlemindeki genişliğini gövde ölçeğine böler: başlangıç sınırları 0,65 ve 0,5; en az sekiz kare ve %85 desteklenen görünüm gerekir. Belirsiz/ön görünüm reddedilir. Bu muhafazakâr mühendislik sezgisinin farklı kişiler ve açılarla değerlendirilmesi gerekir; kamera dönüş açısı ölçmez. Kabul, yalnızca bu ön ayarda şablonun analiz edilebilirliğidir.

## Canlı karşılaştırma

`LiveSquatComparer` kabul edilmiş ve izlenen diz/kalça ölçümleri tam olan şablon ister. Kamera görünümü ayrıca kontrol edilir. Belirsiz görünüm, görünmeyen eklem, çoklu kişi veya 500 ms'den uzun veri boşluğu tamamlanmamış döngüyü atar; önceki tamamlanmış tekrarlar korunur. Saat monoton ve açılar 0–180° olmalıdır.

Ayakta başlangıç/dönüş en az 200 ms gözlenir. Canlı döngü en az bir saniye, en çok 30 saniye; diz hareket aralığı en az 45°, kalça en az 30° olmalıdır. Bükülü görünüm en az 200 ms gözlenir. Faz, referansın süresini kopyalamak yerine en küçük açıdan/çıkış tepesinden biriken açı değişimine göre izlenir; küçük kare farklarında yavaş çıkış kaybolmaz. İniş sırasında bir dip eşiğinden geçmek derinlik hatası sayılmaz. Şablonla eşlenen diz/kalça sapmaları ve dipte daha sığ açı deneysel uyarı adayları üretir; doğrulukları hedef kamera açısında test edilmelidir.

## Ses ve rapor

`LiveReadiness` ve `PrepareLiveSessionSource` canlı kaynağın önüne eklenmiştir. Omuz/kalça, izlenen bacak, yandan görüntü ve ayakta duruş kontrolünden sonra en az altı kare/1,2 saniye ölçülen hazırlık ve üç saniye ölçülen geri sayım gerekir. Geçerli aralık en fazla 500 ms'dir; eksik/yavaş veri geri sayımı sıfırlar. Başlangıç geçildikten sonra takip kaybını normal canlı karşılaştırıcı yönetir. Aynı kaynak kullanılır; ikinci kamera veya ikinci poz motoru açılmaz. Hazırlık kaynak katmanında süzüldüğünden `TrackLiveSquatSession` sayaçlarına girmez. Ürün davranışı `PRODUCT.md` içindedir.

Web, kurulum için ayrı `CalibrationVoicePolicy` zamanlamasını kullanır; geri sayım sayıları ve başlama talimatı yalnızca kurulum sesidir. Ses başarısızsa durum ekranda görünür. Standart görüntünün uzun kenarı en fazla 640 px, Hafif seçeneğin 480 px'dir; küçük görüntü büyütülmez ve en/boy oranı korunur. Kamera isteği mikrofon istemez. Arka kamera açıkça istenir; desteklenmezse kullanıcı ön kameraya yönlendirilir. Model sonuç zamanının yakalama zamanı ile eşleşmesi adaptörde doğrulanır.

`TrackLiveSquatSession` ilk kamera sonucunda yeni `FeedbackPolicy` başlatır. Model yükleme süresi ilk 10 saniyelik kontrol penceresinden sayılmaz. 500 ms'den uzun işleme süresi belirsiz takip olarak ele alınır; canlı düzeltme üretilmez. Politika adayı ayrı sayılır. `SpeechOutput.speak` isteğine eklenen isteğe bağlı `onStarted` bildirimi gelmeden `spokenCues` artmaz. Web Speech bu bildirimi `onstart` olayından üretir. Native sürücü de gerçek başlangıç bildirimi sağlamalıdır.

Web paneli sekme/sayfa kapanışında kamera/Worker/sesi bırakır; yeni başlatma yeni kaynak/politika kullanır. Sonuç beklenirken eski açılar temizlenir. Rapor aralığı ilk kamera ölçümünden durdurmaya kadardır; son ölçümden sonraki boşluk da kapsama girer. `getSummary(atMs)` bitiş zamanını adaptörden alır. Geçerli ardışık ölçümlerde 500 ms'ye kadar aralıklar izlenebilen süreye eklenir; belirsizlik, uzun boşluk ve son ölçüm sonrası kuyruk ölçülemeyen süreye yazılır. Diz/kalça farklarının örnek sayısı, ortalaması ve en büyük değeri izlenen eşleşmelerden toplanır; veri yoksa `null` kalır.

`BrowserSessionHistoryRepository` `flexivision.sessions.v1` anahtarında doğrulanmış özetleri saklar. Senkron okuma/yazma eşzamanlı kayıt kaybını önler; en yeni 50 kayıt, en fazla bir milyon karakter tutulur. Bozuk kayıt otomatik üzerine yazılmaz; kullanıcı geçmişi temizleyebilir. Yalnızca seçilen rapor alanları yazılır. Canlı panel bitiş/kapanış/arka plan durumunda bir kez kaydeder; sıfır örnekli oturum kaydedilmez. Kaydetme başarısızsa özet ekranda tutulur. Yeniden başlama için başarılı kayıt veya kullanıcının açıkça kaydetmeden kapatması gerekir. Ayrıntılı ürün davranışı `PRODUCT.md` içindedir.

`tests/live-smoke.html` kamera/model/ses açmayan, açıkça işaretlenmiş sentetik arayüz testidir. Üretime yayınlanmaz.

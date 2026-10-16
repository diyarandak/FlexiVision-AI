# Squat tekrar taslağı

`packages/core/src/squatCycles.ts` video veya SDK nesnesi kullanmadan hareket haritasını işler. Web ve mobil aynı dedektörü ve serileştirilebilir sözleşmeleri kullanabilir.

## Tam döngü

`squat-cycles-v1` bir squat ön ayarıdır; genel hareket sınıflandırıcısı veya uygunluk onayı değildir. Bir taraf tüm video için seçilir: önce geçerli diz/kalça sayısı, eşitlikte eklem görünürlüğü. Seçilen tarafta en az %85 geçerli ölçüm gerekir. Tekrar içinde taraf değiştirilmez.

Diz ve kalça açıları, kesintisiz komşu ölçümlerde üç örnekli medyanla yumuşatılır. Veri boşluğu doldurulmaz. Her döngü, en az 200 ms boyunca gözlenen ayakta konumdan başlayıp aynı şekilde doğrulanan ayakta konuma dönmelidir. Başta veya sonda çömelmiş kalan parçalar sayılmaz. Eksik ölçüm veya 250 ms üzerindeki örnek aralığı devam eden döngüyü iptal eder.

Başlangıç mühendislik eşikleri: ayakta diz ≥155°, bükülmüş diz ≤110° en az 200 ms, diz açı değişimi ≥45°, kalça açı değişimi ≥30°, döngü süresi 1–12 sn. Bunlar egzersiz formu veya güvenlik kuralları değildir; farklı çekimlere göre kalibrasyon gerekir. Az çömelme, yavaş hareket ve farklı kamera açıları bu ön ayarla kaçırılabilir.

Dip fazı, minimum diz açısının 8° çevresindeki ölçümlerin kapsadığı aralıktır. Öncesi iniş, sonrası çıkıştır. Faz sınırları ve açı aralıkları yumuşatılmış sinyale dayanır; indirilen açı vektörü kaynağın ölçümlerinden gelir.

## Şablon

Kullanıcı tam döngülerden birini seçer. `buildSquatTemplate` bu aralığı 0–1 ilerleme değerine sahip 51 zaman noktasına örnekler; ara noktalar bitişik ölçümlerden doğrusal hesaplanır. Eksik diğer eklemler `null` kalır. Kaynak motor/sürüm/boyut, seçilen taraf, zaman aralığı, fazlar ve 2B açı vektörleri JSON içinde tutulur. Kaynak video şablon dosyasına dahil edilmez.

Hem hareket haritası hem şablon `qualification: not_evaluated` taşır. Aynı uzunluktaki vektörler canlı faz eşleme için bir temel sağlar; kullanıcının farklı hızdaki hareketini canlı eşleştirme bu sürümde uygulanmadı. Kamera açısı ve hareket türü doğrulanmadan kabul sonucu veya egzersiz oturumu başlatılmaz.

## Gözlenen örnek

Kullanıcının Pexels 8402111 dışa aktarımında iki döngü bulundu: 3,3–7,1 sn ve 8,9–13,0 sn. Video kenarlarındaki yarım parçalar çıkarıldı. Bu tek örnek genel tekrar sayım doğruluğu iddiası oluşturmaz.

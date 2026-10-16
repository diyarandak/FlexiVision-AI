import { BrowserReferenceVideoRepository } from '../src/adapters/referenceVideoRepository.ts';

const name = 'flexivision.video-smoke.v1';
const result = document.getElementById('result')!;
document.getElementById('run')!.addEventListener('click', () => {
  void (async () => {
    result.textContent = 'Kontrol ediliyor…';
    const file = new File(['synthetic-video-bytes'], 'synthetic.mp4', { type: 'video/mp4', lastModified: 123 });
    const stored = new BrowserReferenceVideoRepository(() => indexedDB, name);
    try {
      await stored.save('synthetic-reference', file);
      const reopened = new BrowserReferenceVideoRepository(() => indexedDB, name);
      const found = await reopened.get('synthetic-reference');
      if (!await reopened.has('synthetic-reference') || found?.name !== file.name || found.type !== file.type
        || found.lastModified !== file.lastModified || await found.text() !== 'synthetic-video-bytes') {
        throw new Error('Dosya yeniden okunamadı veya bilgileri değişti.');
      }
      await reopened.remove('synthetic-reference');
      if (await reopened.has('synthetic-reference')) throw new Error('Dosya silinmedi.');
      result.textContent = 'GEÇTİ: File IndexedDB içinde saklandı, yeniden açıldı ve silindi.';
    } catch (error) {
      result.textContent = `HATA: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`;
    } finally {
      indexedDB.deleteDatabase(name);
    }
  })();
});

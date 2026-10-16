import type { ExerciseTemplate } from '@flexivision/contracts';
import { useRef, useState } from 'react';
import { ConfirmDelete } from './ConfirmDelete.tsx';
import { libraryView, type LibraryKind, type LibraryOrder } from '../libraryView.ts';
import type { SavedReferenceTemplate } from '@flexivision/contracts';

type VideoAvailability = 'checking' | 'available' | 'missing' | 'error';

function ReferenceEntry({ record, onStartLive, onOpenVideo, videoAvailability, onRename, onRemove, disabled }: {
  record: SavedReferenceTemplate; onStartLive: (template: ExerciseTemplate) => void;
  onOpenVideo: (id: string) => Promise<void>; videoAvailability: VideoAvailability;
  onRename: (id: string, name: string) => Promise<SavedReferenceTemplate>; onRemove: (id: string) => Promise<boolean | void> | boolean | void; disabled: boolean;
}) {
  const [name, setName] = useState(record.name), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [openingVideo, setOpeningVideo] = useState(false), [videoError, setVideoError] = useState('');
  async function openVideo() {
    setOpeningVideo(true); setVideoError('');
    try { await onOpenVideo(record.id); }
    catch (reason) { setVideoError(reason instanceof Error ? reason.message : 'Video açılamadı. Tekrar dene.'); }
    finally { setOpeningVideo(false); }
  }
  return <article className="reference-entry exercise-tile">
    <div className="exercise-tile-header"><span className="exercise-glyph" aria-hidden="true">↗</span><div><span className="eyebrow">{record.template.kind === 'static-pose-template' ? 'SABİT DURUŞ' : record.template.kind === 'generic-cycle-template' ? 'TEKRARLI HAREKET' : 'SQUAT'}</span>
      <h3>{record.name}</h3></div></div>
    <button className="primary-button exercise-start-action" disabled={disabled || saving || openingVideo} onClick={() => onStartLive(record.template)}>Başla <span aria-hidden="true">▶</span></button>
    {(videoAvailability === 'available' || videoAvailability === 'error') && <button className="exercise-video-action" type="button" disabled={disabled || openingVideo}
      onClick={() => { void openVideo(); }} aria-label={`${record.name} videosunu aç`}>{openingVideo ? 'Video açılıyor…' : videoAvailability === 'error' ? 'Videoyu yeniden dene' : 'Videoyu aç'}</button>}
    {videoAvailability === 'checking' && <p className="exercise-video-status" role="status">Video kontrol ediliyor…</p>}
    {videoAvailability === 'missing' && <p className="exercise-video-status">Bu kaydın videosu yok. Şablonla egzersize başlayabilirsin.</p>}
    {videoAvailability === 'error' && <p className="exercise-video-status" role="status">Video şu an kontrol edilemiyor.</p>}
    {videoError && <p className="message error exercise-video-error" role="alert">{videoError}</p>}
    <details className="exercise-management exercise-more-menu"><summary aria-label={`${record.name} seçenekleri`} title="Egzersiz seçenekleri">⋯</summary><div className="history-detail">
      <p className="implementation-note">{new Date(record.savedAt).toLocaleDateString('tr-TR')} tarihinde kaydedildi. Kayıtlı {record.template.kind === 'static-pose-template' ? 'sabit duruş' : record.template.kind === 'generic-cycle-template' ? '2B eklem yolu' : 'açı şablonu'} ile çalışırsın.</p>
      <p className="implementation-note">{(record.template.durationMs / 1000).toFixed(1)} sn / {record.template.kind === 'static-pose-template' ? 'referans duruş' : 'tekrar'} · {record.template.kind === 'static-pose-template' ? 'Süre hedefli' : record.template.kind === 'generic-cycle-template'
        ? `${record.template.trackedIndices.length} eklem izi` : `${record.template.repetition.side === 'left' ? 'Sol' : 'Sağ'} taraf`}</p>
      <form className="reference-name-form" onSubmit={event => {
        event.preventDefault(); setSaving(true); setError('');
        void onRename(record.id, name).then(updated => setName(updated.name))
          .catch(() => setError('Ad değiştirilemedi. Tekrar dene.')).finally(() => setSaving(false));
      }}>
        <label>Egzersiz adı<input value={name} onChange={event => setName(event.target.value)} maxLength={80} required disabled={disabled || saving} /></label>
        <button className="secondary-button" disabled={disabled || saving || !name.trim() || name.trim() === record.name}>{saving ? 'Kaydediliyor…' : 'Adı güncelle'}</button>
      </form>
      {error && <p className="message error" role="alert">{error}</p>}
      <ConfirmDelete label="Bu egzersizi sil" description={`“${record.name}” ve kayıtlı videosu bu cihazdan silinecek. Bu işlem geri alınamaz.`} disabled={disabled || saving || openingVideo} onConfirm={() => onRemove(record.id)} />
    </div></details>
  </article>;
}

export function ReferenceLibraryPanel({ records, loading, error, onStartLive, onOpenVideo, videoAvailability, onRename, onRemove, onClear, onRetry, disabled = false }: {
  records: SavedReferenceTemplate[]; loading: boolean; error: string; onStartLive: (template: ExerciseTemplate) => void;
  onOpenVideo: (id: string) => Promise<void>; videoAvailability: Record<string, VideoAvailability>;
  onRename: (id: string, name: string) => Promise<SavedReferenceTemplate>; onRemove: (id: string) => Promise<boolean> | boolean | void;
  onClear: () => Promise<boolean> | boolean | void; onRetry?: (() => void) | undefined; disabled?: boolean;
}) {
  const [mutating, setMutating] = useState(false);
  const [query, setQuery] = useState(''), [kind, setKind] = useState<LibraryKind>('all'), [order, setOrder] = useState<LibraryOrder>('recent');
  const visible = libraryView(records, query, kind, order);
  const filtered = !!query.trim() || kind !== 'all';
  const mutationRef = useRef(false);
  const locked = disabled || mutating || loading;
  async function runMutation<T>(action: () => Promise<T> | T): Promise<T> {
    if (mutationRef.current) throw new Error('Koleksiyon işlemi sürüyor.');
    mutationRef.current = true; setMutating(true);
    try { return await action(); }
    finally { mutationRef.current = false; setMutating(false); }
  }
  const rename = (id: string, name: string) => runMutation(() => onRename(id, name));
  const remove = (id: string) => runMutation(() => onRemove(id));
  const clear = () => runMutation(onClear);
  return <section className="card reference-library" aria-labelledby="library-title">
    <div className="card-heading"><div><p className="eyebrow">KAYITLI EGZERSİZLER</p><h2 id="library-title">Hareketlerin</h2></div>
      {records.length > 0 && <span className="local-badge">{records.length}</span>}</div>
    {error && <p className="message error" role="alert">{error}</p>}
    {error && onRetry && <button className="secondary-button" disabled={locked} onClick={onRetry}>Kayıtları yeniden oku</button>}
    {(records.length > 3 || filtered) && <div className="library-filters">
      <label className="library-search">Hareket ara<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Egzersiz adı" maxLength={80} /></label>
      <label>Hareket türü<select value={kind} onChange={event => setKind(event.target.value as LibraryKind)}><option value="all">Tüm hareketler</option><option value="free">Tekrarlı hareket</option><option value="squat">Squat</option><option value="static">Sabit duruş</option></select></label>
      <label>Sıralama<select value={order} onChange={event => setOrder(event.target.value as LibraryOrder)}><option value="recent">En yeni önce</option><option value="name">Ada göre</option></select></label>
      <p role="status">{records.length} hareketten {visible.length} tanesi gösteriliyor.</p>
      {filtered && <button className="text-button" onClick={() => { setQuery(''); setKind('all'); }}>Filtreleri temizle</button>}
    </div>}
    {loading ? <p role="status">Egzersizler yükleniyor…</p> : error && records.length === 0 ? <p>Kayıtlar okunamadığı için koleksiyon gösterilemiyor. Mevcut veriler değiştirilmedi.</p> : records.length === 0 ? <p className="library-empty-state">Henüz kayıtlı hareketin yok. Aşağıdan bir video ekleyerek başlayabilirsin.</p>
      : visible.length === 0 ? <p className="library-empty-state">Aramana uygun hareket bulunamadı. Adı kısaltmayı veya filtreleri temizlemeyi dene.</p> : <div className="exercise-grid">{visible.map(record => <ReferenceEntry key={record.id} record={record} onStartLive={onStartLive}
        onOpenVideo={onOpenVideo} videoAvailability={videoAvailability[record.id] ?? 'checking'}
        onRename={rename} onRemove={remove} disabled={locked} />)}</div>}
    {(records.length > 0 || error) && <details className="library-management library-more-menu"><summary>Kitaplık seçenekleri</summary><p>En fazla 20 egzersiz bu tarayıcıda saklanır.</p>
      <ConfirmDelete label="Egzersizleri temizle" description="Bu cihazdaki tüm egzersizler ve kayıtlı referans videoları silinecek. Profilin ve geçmişin korunur. Bu işlem geri alınamaz." disabled={locked} onConfirm={clear} /></details>}
  </section>;
}

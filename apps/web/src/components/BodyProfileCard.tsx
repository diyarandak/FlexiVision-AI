import { ConfirmDelete } from './ConfirmDelete.tsx';
import type { SavedBodyProfile } from '@flexivision/contracts';

export function BodyProfileCard({ saved, loading, error, busy = false, onScan, onClear, onRetry, onExercises }: {
  saved: SavedBodyProfile | null; loading: boolean; error: string; busy?: boolean;
  onScan: () => void; onClear: () => void | boolean | Promise<void | boolean>; onRetry?: (() => void) | undefined;
  onExercises?: (() => void) | undefined;
}) {
  return <section className="card body-profile-card" aria-labelledby="body-profile-title">
    <div><p className="eyebrow">VÜCUT PROFİLİ</p>
      <h2 id="body-profile-title">{loading ? 'Profil kontrol ediliyor…' : saved ? 'Profilin hazır' : error ? 'Profil okunamadı' : 'Bir kez vücudunu tara'}</h2>
      <p>{saved ? 'Sonraki egzersizlerinde bu profili kullanabilirsin. Tekrar taraman gerekmez.'
        : error ? 'Kayıtlı profilin değiştirilmedi. Erişim düzeldiğinde yeniden okuyabilirsin.' : 'Ayakta rahat durup tüm vücudunu kameraya göster. Referans videosunu taklit etmene gerek yok.'}</p>
      {error && <p className="message error" role="alert">{error}</p>}
    </div>
    <div className="body-profile-actions">
      {error && onRetry ? <button className="primary-button body-primary-action" disabled={loading || busy} onClick={onRetry}>Profili yeniden oku</button> : saved && onExercises
        ? <button className="primary-button body-primary-action" disabled={loading || busy} onClick={onExercises}>Egzersizlerime geç <span aria-hidden="true">→</span></button>
        : <button className="primary-button body-primary-action" disabled={loading || busy} onClick={onScan}>{saved ? 'Profili yeniden ölç' : 'Vücudumu tara'} <span aria-hidden="true">→</span></button>}
      {(saved || error) && <details className="profile-manage-menu"><summary>Profil seçenekleri</summary>
        <div className="profile-manage-content">
          {saved && <small>Son ölçüm: {new Date(saved.savedAt).toLocaleString('tr-TR')} · Bu cihazda saklanır</small>}
          {saved && onExercises && <button className="secondary-button" disabled={loading || busy} onClick={onScan}>Profili yeniden ölç</button>}
          <ConfirmDelete label="Kayıtlı profili sil" description="Vücut profilin bu cihazdan silinecek. Egzersizlerin ve geçmişin korunur. Yeniden ölçüm yapabilirsin." disabled={loading || busy} onConfirm={onClear} />
        </div>
      </details>}
    </div>
  </section>;
}

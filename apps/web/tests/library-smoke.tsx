import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import type { SquatTemplate } from '@flexivision/contracts';
import { referenceMap } from '../../../packages/core/test/fixtures/acceptedTemplate.ts';
import { ReferenceLibraryPanel } from '../src/components/ReferenceLibraryPanel.tsx';
import { SquatTemplatePanel } from '../src/components/SquatTemplatePanel.tsx';
import { LiveExercisePanel } from '../src/components/LiveExercisePanel.tsx';
import { useReferenceLibrary } from '../src/hooks/useReferenceLibrary.ts';
import { BrowserReferenceTemplateRepository } from '../src/adapters/referenceLibrary.ts';
import '../src/styles.css';
import '../src/redesign.css';

// No camera/model/video/user storage. Synthetic template tests only local UI.
let denied = false;
const repository = new BrowserReferenceTemplateRepository(() => ({ getItem: key => localStorage.getItem(key),
  setItem(key, value) { if (denied) throw new Error('Sentetik depolama hatası'); localStorage.setItem(key, value); },
  removeItem: key => localStorage.removeItem(key) }), () => new Date(), () => crypto.randomUUID(), 'flexivision.references.smoke.v1');
const map = referenceMap();
const decision = { status: 'accepted' as const, policyVersion: 'reference-v1' as const };
function Smoke() {
  const library = useReferenceLibrary(repository), [live, setLive] = useState<SquatTemplate | null>(null);
  return <main className="app-shell"><h1>SENTETİK EGZERSİZ KİTAPLIĞI TESTİ</h1><p>Kamera/model/ses açılmaz; video ve gerçek kullanıcı kaydı kullanılmaz.</p>
    <button onClick={() => { denied = true; }}>Kayıt hatası oluştur</button><button onClick={() => { denied = false; }}>Kayıt hatasını kaldır</button>
    <ReferenceLibraryPanel records={library.records} loading={library.loading} error={library.error}
      onStartLive={setLive} onOpenVideo={async () => {}} videoAvailability={Object.fromEntries(library.records.map(record => [record.id, 'missing' as const]))}
      onRename={library.rename} onRemove={id => { void library.remove(id); }} onClear={() => { void library.clear(); }} />
    <section className="card"><SquatTemplatePanel map={map} decision={decision}
      onPreview={() => {}} onStartLive={setLive} onSaveTemplate={library.save} savedReferenceIds={library.records.map(record => record.id)} /></section>
    {live && createPortal(<LiveExercisePanel template={live} onClose={() => setLive(null)}
      createSource={() => ({ async start() {}, stop() {} })} createSpeech={() => ({ available: false, speak() {}, cancel() {} })} />, document.body)}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Smoke />);

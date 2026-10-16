import { useId, useRef, type ReactNode } from 'react';

/** Native modal keeps settings above camera overlays and traps focus until closed. */
export function CameraOptions({ children, notice }: { children: ReactNode; notice?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  return <div className="camera-options-position">
    <button className="camera-options-button" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
      {notice ? 'Ayarlar · Uyarı' : 'Kamera ve ses'}
    </button>
    <dialog ref={dialog} className="camera-settings-sheet" aria-labelledby={title}
      onKeyDown={event => event.stopPropagation()}
      onCancel={event => { event.preventDefault(); dialog.current?.close(); }}>
      <header><h3 id={title}>Kamera ve ses</h3><button autoFocus className="secondary-button" onClick={() => dialog.current?.close()}>Kapat</button></header>
      <div className="camera-settings-content">
        {notice && <p className="camera-settings-notice" role="status">{notice}</p>}
        {children}
      </div>
    </dialog>
  </div>;
}

import { useEffect, useRef, useState } from 'react';

/** Destructive actions require an explicit second tap; failures remain retryable. */
export function ConfirmDelete({ label, description, onConfirm, disabled = false }: {
  label: string; description: string; disabled?: boolean;
  onConfirm: () => void | boolean | Promise<void | boolean>;
}) {
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const inFlight = useRef(false), restoreFocus = useRef(false), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!open && restoreFocus.current) { trigger.current?.focus(); restoreFocus.current = false; } }, [open]);
  const close = () => { restoreFocus.current = true; setOpen(false); setError(''); };
  async function confirm() {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setPending(true); setError('');
    try {
      if (await onConfirm() === false) setError('Silme tamamlanamadı. Yeniden deneyebilirsin.');
      else close();
    } catch { setError('Silme tamamlanamadı. Yeniden deneyebilirsin.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  if (!open) return <button ref={trigger} className="text-button" type="button" disabled={disabled} onClick={() => setOpen(true)}>{label}</button>;
  return <div className="delete-confirmation" role="group" aria-label={label} aria-busy={pending}>
    <p>{description}</p>
    <div className="delete-confirmation-actions">
      <button autoFocus className="secondary-button" type="button" disabled={pending} onClick={close}>Vazgeç</button>
      <button className="secondary-button delete-confirm-button" type="button" disabled={disabled || pending} onClick={() => { void confirm(); }}>{pending ? 'Siliniyor…' : 'Evet, sil'}</button>
    </div>
    {error && <p className="message error" role="alert">{error}</p>}
  </div>;
}

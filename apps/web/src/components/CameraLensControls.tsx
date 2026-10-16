import { useEffect, useRef, useState } from 'react';
import { cameraZoom, setCameraZoom, type CameraZoom } from '../adapters/cameraLens.ts';

export function CameraLensControls({ video, active, disabled = false }: {
  video: HTMLVideoElement | null; active: boolean; disabled?: boolean;
}) {
  const generation = useRef(0), trackRef = useRef<MediaStreamTrack | null>(null);
  const [zoom, setZoom] = useState<CameraZoom | null>(null), [draft, setDraft] = useState(1);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const refresh = () => {
      generation.current++; setPending(false); setError('');
      const stream = video?.srcObject;
      const track = active && stream instanceof MediaStream ? stream.getVideoTracks()[0] ?? null : null;
      trackRef.current = track; const next = track ? cameraZoom(track) : null;
      setZoom(next); setDraft(next?.value ?? 1);
    };
    refresh(); video?.addEventListener('loadedmetadata', refresh); video?.addEventListener('emptied', refresh);
    return () => { generation.current++; trackRef.current = null;
      video?.removeEventListener('loadedmetadata', refresh); video?.removeEventListener('emptied', refresh); };
  }, [video, active]);
  if (!active) return null;
  async function apply(value: number) {
    const track = trackRef.current, current = generation.current;
    if (!track || pending || disabled) return;
    setPending(true); setError('');
    try { const next = await setCameraZoom(track, value); if (current === generation.current) { setZoom(next); setDraft(next.value); } }
    catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : 'Zoom değiştirilemedi.'); }
    finally { if (current === generation.current) setPending(false); }
  }
  return <details className="camera-lens-controls"><summary>Kadraj / zoom {zoom ? `· ${zoom.value.toFixed(1)}×` : ''}</summary>
    {zoom ? <div className="lens-adjustment"><button className="secondary-button" disabled={pending || disabled} onClick={() => { void apply(zoom.min); }}>En geniş kadraj</button>
      <label>Yakınlaştırma <output>{draft.toFixed(1)}×</output><input aria-label="Kamera zoom" type="range" min={zoom.min} max={zoom.max} step={zoom.step}
        value={draft} disabled={pending || disabled} onChange={event => setDraft(Number(event.target.value))} /></label>
      <button className="secondary-button" disabled={pending || disabled} onClick={() => { void apply(draft); }}>{pending ? 'Uygulanıyor…' : 'Uygula'}</button>
      {disabled && <p>Zoom için oturumu bitirip hazırlık ekranına dön.</p>}
    </div> : <p>Bu kamera Chrome’a zoom kontrolü sunmuyor. Arka kamerayı veya Kamera ayarlarında sunulan başka bir lensi deneyebilirsin.</p>}
    <p>Telefonu dik ve sabit, yaklaşık bel hizasında tut. Başın ve ayakların görüntüde kalsın. Ekranı büyütmek lensin görüş açısını değiştirmez.</p>
    {error && <p className="message error" role="alert">{error}</p>}
  </details>;
}

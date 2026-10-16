export interface CameraZoom { min: number; max: number; step: number; value: number }
type ZoomCapabilities = MediaTrackCapabilities & { zoom?: { min?: number; max?: number; step?: number } };
type ZoomSettings = MediaTrackSettings & { zoom?: number };

export function cameraZoom(track: MediaStreamTrack): CameraZoom | null {
  try {
    if (track.readyState === 'ended') return null;
    const range = (track.getCapabilities() as ZoomCapabilities).zoom;
    const value = (track.getSettings() as ZoomSettings).zoom;
    if (!range || ![range.min, range.max, value].every(n => typeof n === 'number' && Number.isFinite(n))
      || range.min! <= 0 || range.max! <= range.min! || value! < range.min! || value! > range.max!) return null;
    const step = typeof range.step === 'number' && Number.isFinite(range.step) && range.step > 0 ? range.step : .1;
    return { min: range.min!, max: range.max!, step, value: value! };
  } catch { return null; }
}

/** Changes the capture track, never crops the preview to imitate a wider lens. */
export async function setCameraZoom(track: MediaStreamTrack, value: number): Promise<CameraZoom> {
  const current = cameraZoom(track);
  if (!current || !Number.isFinite(value)) throw new Error('Bu kamera tarayıcıdan zoom kontrolü sunmuyor.');
  const requested = Math.min(current.max, Math.max(current.min,
    current.min + Math.round((value - current.min) / current.step) * current.step));
  const constraints = track.getConstraints();
  const advanced = constraints.advanced?.map(entry => {
    const clean = { ...entry } as MediaTrackConstraintSet & { zoom?: unknown }; delete clean.zoom; return clean;
  });
  await track.applyConstraints({ ...constraints, ...(advanced ? { advanced } : {}), zoom: { exact: requested } } as MediaTrackConstraints);
  if (track.readyState === 'ended') throw new Error('Kamera kapatıldı.');
  const actual = cameraZoom(track);
  if (!actual || Math.abs(actual.value - requested) > Math.max(.001, current.step / 2)) {
    throw new Error('Kamera zoom isteğini uygulamadı. Mevcut görüş açısı korunuyor.');
  }
  return actual;
}

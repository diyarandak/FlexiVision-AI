import type { CameraOptions } from '../adapters/browserCameraPose.ts';
import { useEffect, useState } from 'react';

export function CameraSettings({ value, disabled, onChange }: { value: CameraOptions; disabled: boolean; onChange: (value: CameraOptions) => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    let live = true;
    void navigator.mediaDevices?.enumerateDevices().then(list => {
      if (live) setDevices(list.filter(device => device.kind === 'videoinput' && device.label && device.deviceId));
    }).catch(() => { /* Lens list is optional; ordinary camera selection stays available. */ });
    return () => { live = false; };
  }, []);
  return <div className="camera-settings">
    <label>Kamera <select aria-label="Kamera seçimi" disabled={disabled} value={value.facingMode}
      onChange={event => onChange({ ...value, deviceId: '', facingMode: event.target.value === 'environment' ? 'environment' : 'user' })}>
      <option value="user">Ön kamera</option><option value="environment">Arka kamera</option>
    </select></label>
    <label>Görüntü <select aria-label="Görüntü işleme seçeneği" disabled={disabled} value={value.maxDimension}
      onChange={event => onChange({ ...value, maxDimension: event.target.value === '480' ? 480 : 640 })}>
      <option value="640">Standart</option><option value="480">Hafif · yavaş telefon için</option>
    </select></label>
    <details className="camera-device-settings"><summary>Lens ve kadraj seçenekleri</summary>
      {devices.length > 1 && <label>Lens <select aria-label="Kamera lensi" disabled={disabled} value={value.deviceId ?? ''}
        onChange={event => onChange({ ...value, deviceId: event.target.value })}><option value="">Otomatik kamera</option>
        {devices.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select></label>}
      <label>Kadraj <select aria-label="Kamera kadrajı" disabled={disabled} value={value.portrait ? 'portrait' : 'landscape'}
        onChange={event => onChange({ ...value, portrait: event.target.value === 'portrait' })}>
        <option value="portrait">Dikey · tam vücut</option><option value="landscape">Yatay</option></select></label>
      <p>İlk kamera izninden sonra mevcut lensler burada listelenir. Geniş açı lensi yalnızca telefon ve tarayıcı sunuyorsa seçilebilir.</p>
    </details>
    <small>{disabled ? 'Değiştirmek için önce kamerayı durdur.' : value.portrait
      ? 'Telefonu dik ve bel hizasında sabitle. Sığmıyorsan arka kamerayı veya en geniş lensi dene.'
      : 'Telefonu yatay ve bel hizasında sabitle. Başın veya ayakların sığmıyorsa dikey kadrajı ya da en geniş lensi dene.'}</small>
  </div>;
}

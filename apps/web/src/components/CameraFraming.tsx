export function CameraFraming({ fill, onChange }: { fill: boolean; onChange: (fill: boolean) => void }) {
  return <label className="camera-framing">Görünüm<select aria-label="Kamera görünümü" value={fill ? 'fill' : 'fit'}
    onChange={event => onChange(event.target.value === 'fill')}>
    <option value="fit">Tüm kadrajı göster</option><option value="fill">Ekranı doldur · kenarları kırpar</option>
  </select><small>{fill ? 'Kenarlar kırpılabilir. Vücudun sığmıyorsa Tüm kadrajı göster seç.' : 'Görüntünün tamamı görünür; kenarlarda boşluk kalabilir.'}</small></label>;
}

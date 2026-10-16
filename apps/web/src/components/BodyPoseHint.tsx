export function BodyPoseHint() {
  return <div className="body-pose-hint">
    <svg viewBox="0 0 240 245" role="img" aria-label="Kameraya dönük ayakta rahat duruş. Kollar gövdeden biraz ayrık, ayaklar hafif açık.">
      <rect x="18" y="8" width="204" height="230" rx="20" fill="#e8f0df" />
      <g stroke="#315e48" strokeWidth="9" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="120" cy="32" r="15" fill="#c5dcac" />
        <path d="M120 49 V60 M94 65 H146 M94 65 L77 98 L65 126 M146 65 L163 98 L175 126 M94 65 L103 135 H137 L146 65 M103 135 L99 175 L94 218 M137 135 L141 175 L146 218" />
      </g>
      <path d="M86 226 H153" stroke="#96b17d" strokeWidth="3" strokeLinecap="round" />
    </svg>
    <h3>Ayakta rahat dur</h3>
    <p>Kameraya bak. Kolların gövdeni kapatmasın. T pozu zorunlu değil.</p>
  </div>;
}

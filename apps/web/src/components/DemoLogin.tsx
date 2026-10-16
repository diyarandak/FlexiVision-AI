export function DemoLogin({ onEnter, error }: { onEnter: () => void; error: string }) {
  return <div className="demo-login-shell"><a className="brand" href="#vucudum"><span className="brand-mark">f.</span>FlexiVision</a>
    <main className="demo-login-card"><span className="local-badge">Demo giriş</span><p className="eyebrow">KİŞİSEL HAREKET ALANIN</p>
      <h1>Vücudunu tanıt.<br /><span>Harekete başla.</span></h1><p>Vücut profilin, kayıtlı egzersizlerin ve seans geçmişin tek yerde.</p>
      <button className="primary-button" onClick={onEnter}>Demo olarak giriş yap <span aria-hidden="true">↗</span></button>
      <p className="demo-login-note">Şifre gerekmez; gerçek hesap oluşturulmaz. Bu tarayıcıdaki kayıtların kullanılır. Demo giriş aynı sekmede yenilemeden sonra da açık kalır; bulut senkronizasyonu yoktur.</p>
      {error && <p className="message error" role="alert">{error}</p>}
    </main><footer>Görüntün cihazında kalır.</footer>
  </div>;
}

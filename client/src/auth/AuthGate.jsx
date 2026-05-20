import { useState } from 'react';
import { useAuth } from './AuthContext';

// AuthGate envuelve toda la app. Muestra:
//   - 'loading'           → spinner mientras Supabase rehidrata sesión
//   - 'signed_out'        → LoginScreen (email + contraseña → código OTP)
//   - 'pending_approval'  → mensaje "tu acceso no está habilitado"
//   - 'signed_in'         → la app
export default function AuthGate({ children }) {
  const { status } = useAuth();
  if (status === 'loading')          return <SplashLoader />;
  if (status === 'signed_out')       return <LoginScreen />;
  if (status === 'pending_approval') return <PendingApprovalScreen />;
  return children;
}

function SplashLoader() {
  return (
    <div style={S.wrap}>
      <div style={{ ...S.brand, marginBottom: 24 }}>DELFINO GAVIÑA</div>
      <div style={S.dim}>Cargando…</div>
    </div>
  );
}

function LoginScreen() {
  const { requestOtp, confirmOtp } = useAuth();

  // step: 'credentials' | 'otp'
  const [step, setStep]         = useState('credentials');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp]           = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState('');

  // Paso 1: verificar email + contraseña → recibir código por mail
  const submitCredentials = async (e) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true); setErr('');
    try {
      await requestOtp(email.trim(), password);
      setStep('otp');
    } catch (ex) {
      setErr(ex.message || 'Credenciales inválidas');
    } finally {
      setBusy(false);
    }
  };

  // Paso 2: verificar el código OTP de 6 dígitos
  const submitOtp = async (e) => {
    e?.preventDefault();
    if (busy || otp.trim().length < 6) return;
    setBusy(true); setErr('');
    try {
      await confirmOtp(email.trim(), otp.trim());
      // El listener de auth en AuthContext detecta la sesión y cambia el status
    } catch (ex) {
      setErr(ex.message || 'Código inválido o expirado');
      setBusy(false);
    }
  };

  const backToCredentials = () => {
    setStep('credentials');
    setOtp('');
    setErr('');
  };

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.brand}>DELFINO GAVIÑA</div>
        <div style={S.sub}>Acceso restringido · Solo usuarios autorizados</div>

        {step === 'credentials' ? (
          <form onSubmit={submitCredentials} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="email"
              placeholder="tu@delfinogavina.com.ar"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={S.input}
              autoComplete="email"
              required
            />
            <input
              type="password"
              placeholder="Contraseña"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={S.input}
              autoComplete="current-password"
              required
            />
            {err && <div style={S.err}>{err}</div>}
            <button
              type="submit"
              disabled={busy || !email || !password}
              style={{ ...S.primaryBtn, opacity: busy || !email || !password ? 0.5 : 1 }}
            >
              {busy ? 'Verificando…' : 'CONTINUAR'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitOtp} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={S.otpHint}>
              Enviamos un código de 6 dígitos a<br />
              <b style={{ color: 'var(--text)' }}>{email}</b>
            </div>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="123456"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ ...S.input, textAlign: 'center', fontSize: 22, letterSpacing: 8, fontFamily: "'Roboto Mono', monospace" }}
              autoFocus
              autoComplete="one-time-code"
            />
            {err && <div style={S.err}>{err}</div>}
            <button
              type="submit"
              disabled={busy || otp.trim().length < 6}
              style={{ ...S.primaryBtn, opacity: busy || otp.trim().length < 6 ? 0.5 : 1 }}
            >
              {busy ? 'Verificando…' : 'INGRESAR'}
            </button>
            <button type="button" onClick={backToCredentials} style={S.linkBtn}>
              ← Volver
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function PendingApprovalScreen() {
  const { session, signOut } = useAuth();
  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.brand}>DELFINO GAVIÑA</div>
        <div style={{ ...S.sub, color: '#f59e0b', marginTop: 16 }}>
          Acceso no habilitado
        </div>
        <div style={{ ...S.dim, lineHeight: 1.6, marginTop: 12 }}>
          Iniciaste sesión correctamente con <b style={{ color: 'var(--text)' }}>{session?.user?.email}</b>,
          pero esta cuenta aún no está aprobada para acceder a la aplicación.
          Pedile al administrador que te habilite.
        </div>
        <button onClick={signOut} style={{ ...S.primaryBtn, marginTop: 20 }}>CERRAR SESIÓN</button>
      </div>
    </div>
  );
}

const S = {
  wrap: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 20, background: 'var(--bg)',
    fontFamily: "'Montserrat', sans-serif",
  },
  card: {
    background: 'var(--bg-card)', border: '1px solid var(--border-neon)', borderRadius: 8,
    padding: 36, width: '100%', maxWidth: 380,
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 18px 48px rgba(0,0,0,0.5)',
  },
  brand: {
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    fontSize: 20, fontWeight: 600, letterSpacing: 6,
    color: 'var(--title-color)', textAlign: 'center', marginBottom: 6,
  },
  sub: {
    fontFamily: "'Roboto Mono', monospace", fontSize: 9, letterSpacing: 2,
    color: 'var(--text-dim)', textAlign: 'center', textTransform: 'uppercase',
    marginBottom: 24,
  },
  dim: { fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' },
  otpHint: {
    fontSize: 12, color: 'var(--text-dim)', textAlign: 'center',
    lineHeight: 1.6, marginBottom: 4,
  },
  input: {
    background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 4,
    padding: '11px 12px', fontSize: 13, color: 'var(--text)',
    fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box',
  },
  primaryBtn: {
    background: 'var(--neon)', color: '#000', border: 'none', borderRadius: 4,
    padding: '11px 14px', fontSize: 11, fontWeight: 700, letterSpacing: 2,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  linkBtn: {
    background: 'none', border: 'none', color: 'var(--text-dim)',
    fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
    textAlign: 'center', padding: '4px 0',
    fontFamily: "'Roboto Mono', monospace", letterSpacing: 1,
  },
  err: {
    color: '#ef4444', fontSize: 11, textAlign: 'center',
    fontFamily: "'Roboto Mono', monospace",
  },
};

import { useState } from 'react';
import { useAuth } from './AuthContext';

export default function AuthGate({ children }) {
  const { status } = useAuth();
  if (status === 'loading')          return <SplashLoader />;
  if (status === 'signed_out')       return <LoginScreen />;
  if (status === 'pending_approval') return <PendingScreen />;
  return children;
}

function SplashLoader() {
  return (
    <div style={S.wrap}>
      <div style={S.brand}>DELFINO GAVIÑA</div>
      <div style={S.dim}>Cargando…</div>
    </div>
  );
}

function LoginScreen() {
  const { signIn } = useAuth();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState('');

  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true); setErr('');
    try {
      await signIn(email.trim(), password);
    } catch (ex) {
      setErr(ex.message || 'Credenciales inválidas');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.brand}>DELFINO GAVIÑA</div>
        <div style={S.sub}>Acceso restringido · Solo usuarios autorizados</div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            type="email"
            placeholder="email@delfinogavina.com.ar"
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
            style={{ ...S.btn, opacity: busy || !email || !password ? 0.5 : 1 }}
          >
            {busy ? 'Ingresando…' : 'INGRESAR'}
          </button>
        </form>
      </div>
    </div>
  );
}

function PendingScreen() {
  const { session, signOut } = useAuth();
  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.brand}>DELFINO GAVIÑA</div>
        <div style={{ ...S.sub, color: '#f59e0b', marginTop: 16 }}>Acceso no habilitado</div>
        <div style={{ ...S.dim, lineHeight: 1.6, marginTop: 12 }}>
          Iniciaste sesión con <b style={{ color: 'var(--text)' }}>{session?.user?.email}</b>,
          pero esta cuenta no tiene acceso. Pedile al administrador que te habilite en Supabase.
        </div>
        <button onClick={signOut} style={{ ...S.btn, marginTop: 20 }}>CERRAR SESIÓN</button>
      </div>
    </div>
  );
}

const S = {
  wrap: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 20, background: 'var(--bg)', fontFamily: "'Montserrat', sans-serif",
  },
  card: {
    background: 'var(--bg-card)', border: '1px solid var(--border-neon)', borderRadius: 8,
    padding: 36, width: '100%', maxWidth: 360,
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
  input: {
    background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 4,
    padding: '11px 12px', fontSize: 13, color: 'var(--text)',
    fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box',
  },
  btn: {
    background: 'var(--neon)', color: '#000', border: 'none', borderRadius: 4,
    padding: '11px 14px', fontSize: 11, fontWeight: 700, letterSpacing: 2,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  err: {
    color: '#ef4444', fontSize: 11, textAlign: 'center',
    fontFamily: "'Roboto Mono', monospace",
  },
};

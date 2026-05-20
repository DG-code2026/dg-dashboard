import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase, getAccessToken } from './supabaseClient';

const API = import.meta.env.VITE_API_URL || '';

// AuthContext expone:
//   session  : { user: {...}, access_token } | null
//   profile  : { email, role, active, full_name } | null  (info del whitelist)
//   status   : 'loading' | 'signed_out' | 'pending_approval' | 'signed_in'
//   requestOtp(email, password)   → paso 1: verifica contraseña y envía código
//   confirmOtp(email, otp)        → paso 2: verifica código y abre sesión
//   signOut()
//
// Flujo de login (2FA):
//  1. requestOtp: el server verifica email+password contra Supabase.
//     Si es válido, Supabase envía un código de 6 dígitos al email.
//  2. confirmOtp: el cliente verifica el código → sesión establecida.
//  3. Supabase rehidrata la sesión → checkProfile → status='signed_in'.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState('loading');

  // Consulta al backend para validar JWT + chequear whitelist + traer perfil.
  const checkProfile = useCallback(async (token) => {
    if (!token) { setProfile(null); setStatus('signed_out'); return; }
    try {
      const r = await fetch(`${API}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 401) { setProfile(null); setStatus('signed_out'); return; }
      if (r.status === 403) { setProfile(null); setStatus('pending_approval'); return; }
      if (!r.ok)            { setProfile(null); setStatus('signed_out'); return; }
      const j = await r.json();
      setProfile(j);
      setStatus('signed_in');
    } catch (e) {
      console.error('[auth] checkProfile failed', e);
      setProfile(null); setStatus('signed_out');
    }
  }, []);

  useEffect(() => {
    let unsub;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      await checkProfile(session?.access_token);

      const { data } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
        setSession(newSession);
        await checkProfile(newSession?.access_token);
      });
      unsub = data?.subscription;
    })();
    return () => { try { unsub?.unsubscribe?.(); } catch {} };
  }, [checkProfile]);

  // Paso 1: verifica contraseña en el server (sin crear sesión en el cliente)
  // y pide a Supabase que envíe el código al email.
  const requestOtp = useCallback(async (email, password) => {
    const r = await fetch(`${API}/api/auth/check-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || 'Credenciales incorrectas');
    }
    // Contraseña válida → Supabase envía código de 6 dígitos al email
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false },
    });
    if (error) throw new Error(error.message || 'No se pudo enviar el código');
  }, []);

  // Paso 2: verifica el código OTP → establece sesión Supabase.
  // El listener de onAuthStateChange lo detecta y hace checkProfile automáticamente.
  const confirmOtp = useCallback(async (email, token) => {
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: 'email',
    });
    if (error) throw new Error(error.message || 'Código inválido o expirado');
  }, []);

  const signOut = useCallback(async () => {
    try {
      // Notificamos al backend para que loguee el evento antes de invalidar la sesión.
      const token = await getAccessToken();
      if (token) await fetch(`${API}/api/auth/sign-out`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    } catch {}
    await supabase.auth.signOut();
    setProfile(null);
    setStatus('signed_out');
  }, []);

  const value = { session, profile, status, requestOtp, confirmOtp, signOut };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside <AuthProvider>');
  return ctx;
}

export { AuthContext };

// Helper para hacer fetch al backend con el JWT actual.
export async function authedFetch(path, opts = {}) {
  const token = await getAccessToken();
  return fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase, getAccessToken } from './supabaseClient';

const API = import.meta.env.VITE_API_URL || '';

// Bypass de auth en desarrollo local — evita tener que loguearse cada vez
// que arranca el dev server. Sólo activo cuando Vite corre en modo dev.
// Para forzar el flow real (testing del login en local), setear
// VITE_FORCE_AUTH=1 en client/.env.local y reiniciar `npm run dev`.
const DEV_BYPASS = import.meta.env.DEV && !import.meta.env.VITE_FORCE_AUTH;
const DEV_PROFILE = { email: 'dev@local', full_name: 'Dev Local', role: 'admin', active: true };

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession]   = useState(null);
  const [profile, setProfile]   = useState(DEV_BYPASS ? DEV_PROFILE : null);
  const [status,  setStatus]    = useState(DEV_BYPASS ? 'signed_in' : 'loading');

  // Valida el JWT contra el backend y verifica que el email esté en allowed_users.
  const checkProfile = useCallback(async (token) => {
    if (!token) { setProfile(null); setStatus('signed_out'); return; }
    try {
      const r = await fetch(`${API}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 401) { setProfile(null); setStatus('signed_out');        return; }
      if (r.status === 403) { setProfile(null); setStatus('pending_approval');  return; }
      if (!r.ok)            { setProfile(null); setStatus('signed_out');        return; }
      setProfile(await r.json());
      setStatus('signed_in');
    } catch {
      setProfile(null); setStatus('signed_out');
    }
  }, []);

  useEffect(() => {
    // En dev no consultamos a Supabase: ya quedamos signed_in con DEV_PROFILE.
    if (DEV_BYPASS) return;

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

  const signIn = useCallback(async (email, password) => {
    if (DEV_BYPASS) return;   // ya estamos "logueados" como Dev Local
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (DEV_BYPASS) return;   // en dev no permitimos desloguearse — recargar la página vuelve al mismo estado
    try {
      const token = await getAccessToken();
      if (token) await fetch(`${API}/api/auth/sign-out`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
    } catch {}
    await supabase.auth.signOut();
    setProfile(null);
    setStatus('signed_out');
  }, []);

  return (
    <AuthContext.Provider value={{ session, profile, status, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside <AuthProvider>');
  return ctx;
}

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

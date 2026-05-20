// Cliente Supabase para auth (login/sesión/Google).
// El anon key + URL vienen de .env via VITE_* (expuestos al bundle).
// El JWT de sesión queda en localStorage; Supabase JS se encarga del refresh
// automático antes de que expire.
import { createClient } from '@supabase/supabase-js';

const url     = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('[auth] Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en el build.');
}

export const supabase = createClient(url || 'http://invalid', anonKey || 'invalid', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,  // captura el callback de OAuth (Google)
  },
});

// Devuelve el access_token actual (JWT) para mandar al backend en Authorization.
export async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

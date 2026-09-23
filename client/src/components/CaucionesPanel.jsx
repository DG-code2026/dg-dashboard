// ─────────────────────────────────────────────────────────────────────────────
//  CAUCIONES EN PESOS — tasas de referencia a 1, 7, 14 y 30 días
//
//  En Primary las cauciones son instrumentos propios ("MERV - XMEV - PESOS -
//  <N>D") y lo que publican como precio ES la tasa (TNA %), no un importe.
//  El server los tiene suscriptos por WebSocket igual que los bonos y los
//  expone ya normalizados en /api/cauciones.
//
//  Se muestra la tasa de la ÚLTIMA OPERACIÓN de cada plazo. Con el mercado
//  cerrado queda el último valor de la rueda, marcado como tal.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const REFRESH_MS = 30_000;
const MONO = "'Roboto Mono',monospace";

// Una caución de 1 día operada a TNA 19,5% no debería mostrarse como "19.5"
// a secas: el formato con coma y un decimal es el que se usa en mesa.
function fmtTasa(t) {
  if (!Number.isFinite(t)) return '—';
  return t.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function fmtHora(ts) {
  if (!ts) return null;
  return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export default function CaucionesPanel() {
  const [items, setItems] = useState([]);
  const [marketOpen, setMarketOpen] = useState(false);
  const [err, setErr] = useState('');
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/cauciones`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setItems(Array.isArray(j.items) ? j.items : []);
      setMarketOpen(!!j.marketOpen);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Error');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    const id = setInterval(cargar, REFRESH_MS);
    return () => clearInterval(id);
  }, [cargar]);

  return (
    <div>
      <div style={S.row}>
        {items.map(i => (
          <div key={i.plazo} style={S.card}>
            <div style={S.plazo}>{i.plazo} {i.plazo === 1 ? 'DÍA' : 'DÍAS'}</div>
            <div className="t-outline" style={S.tasa}>
              {fmtTasa(i.tasa)}<span style={S.pct}>%</span>
            </div>
            <div style={S.pie}>
              {i.tasa == null
                ? <span style={S.sinDato}>sin operaciones</span>
                : <>TNA · última operada{fmtHora(i.updatedAt) ? ` ${fmtHora(i.updatedAt)}` : ''}</>}
            </div>
          </div>
        ))}
        {cargando && items.length === 0 && <div style={S.vacio}>Cargando cauciones…</div>}
        {!cargando && items.length === 0 && <div style={S.vacio}>Sin datos de cauciones.</div>}
      </div>

      <div style={S.nota}>
        {err
          ? <span style={S.err}>No se pudieron actualizar las cauciones: {err}</span>
          : marketOpen
            ? 'Tasa nominal anual de la última operación · se actualiza cada 30 s'
            : 'Mercado cerrado — última tasa operada de la rueda'}
      </div>
    </div>
  );
}

const S = {
  row: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  card: {
    flex: '1 1 150px', minWidth: 140,
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 5,
  },
  plazo: { fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--text-dim)' },
  tasa: { fontFamily: MONO, fontSize: 26, fontWeight: 700, color: 'var(--neon)', lineHeight: 1.1 },
  pct: { fontSize: 14, marginLeft: 2, opacity: 0.75 },
  pie: { fontFamily: MONO, fontSize: 8.5, color: 'var(--text-dim)', letterSpacing: 0.5, opacity: 0.8 },
  sinDato: { opacity: 0.6 },
  vacio: { fontFamily: MONO, fontSize: 11, color: 'var(--text-dim)', padding: '14px 0' },
  nota: { marginTop: 9, fontFamily: MONO, fontSize: 9, color: 'var(--text-dim)', letterSpacing: 0.8, opacity: 0.75 },
  err: { color: '#ef4444', opacity: 1 },
};

// ─────────────────────────────────────────────────────────────────────────────
//  CAUCIONES — tasas de referencia a 1, 7, 14 y 30 días, en pesos y en dólares
//
//  En Primary las cauciones son instrumentos propios, una familia por moneda
//  ("MERV - XMEV - PESOS - <N>D" y "... - DOLAR - <N>D"), y lo que publican
//  como precio ES la tasa (TNA %), no un importe.
//
//  Sobre el plazo: Primary sólo lista los plazos cuyo VENCIMIENTO cae en día
//  hábil — un jueves la lista arranca 1, 4, 5, 6..., porque 2 y 3 vencerían
//  sábado y domingo. O sea que el mercado ya resuelve el problema del día
//  inhábil. El server pide el menor plazo disponible que cubra el objetivo, y
//  acá se muestran los dos: el de referencia y el que realmente se opera. Un
//  viernes, la de "1 día" se opera a 3 y vence el lunes.
//
//  Se muestra la tasa de la ÚLTIMA OPERACIÓN. Con el mercado cerrado queda el
//  último valor de la rueda, marcado como tal.
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

// 'YYYY-MM-DD' → 'lun 28/9'
function fmtVence(ymd) {
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][dt.getDay()];
  return `${dow} ${d}/${m}`;
}

export default function CaucionesPanel() {
  const [monedas, setMonedas] = useState([]);
  const [activa, setActiva] = useState('ARS');
  const [marketOpen, setMarketOpen] = useState(false);
  const [err, setErr] = useState('');
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/cauciones`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setMonedas(Array.isArray(j.monedas) ? j.monedas : []);
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

  const actual = monedas.find(m => m.moneda === activa) || monedas[0] || null;
  const items = actual?.items || [];

  // ¿Algún plazo se está operando corrido respecto del objetivo? Si es así,
  // se explica una sola vez al pie en lugar de repetirlo en cada tarjeta.
  const hayCorridos = items.some(i => i.plazoReal && i.plazoReal !== i.plazo);

  return (
    <div>
      <div style={S.head}>
        <div style={S.switch}>
          {monedas.map(m => (
            <button
              key={m.moneda}
              style={{ ...S.switchBtn, ...(activa === m.moneda ? S.switchBtnOn : {}) }}
              onClick={() => setActiva(m.moneda)}
            >
              {m.moneda === 'ARS' ? 'PESOS' : 'DÓLARES'}
            </button>
          ))}
        </div>
      </div>

      <div style={S.row}>
        {items.map(i => (
          <div key={i.plazo} style={S.card}>
            <div style={S.plazoRow}>
              <span style={S.plazo}>{i.plazo} {i.plazo === 1 ? 'DÍA' : 'DÍAS'}</span>
              {i.plazoReal && i.plazoReal !== i.plazo && (
                <span style={S.plazoReal} title={`El vencimiento a ${i.plazo} día${i.plazo === 1 ? '' : 's'} caía en día inhábil`}>
                  opera {i.plazoReal}d
                </span>
              )}
            </div>
            <div className="t-outline" style={S.tasa}>
              {fmtTasa(i.tasa)}<span style={S.pct}>%</span>
            </div>
            <div style={S.pie}>
              {i.tasa == null
                ? <span style={S.sinDato}>sin operaciones</span>
                : <>TNA · última operada{fmtHora(i.updatedAt) ? ` ${fmtHora(i.updatedAt)}` : ''}</>}
            </div>
            {i.vence && <div style={S.vence}>vence {fmtVence(i.vence)}</div>}
          </div>
        ))}
        {cargando && items.length === 0 && <div style={S.vacio}>Cargando cauciones…</div>}
        {!cargando && items.length === 0 && <div style={S.vacio}>Sin datos de cauciones.</div>}
      </div>

      <div style={S.nota}>
        {err
          ? <span style={S.err}>No se pudieron actualizar las cauciones: {err}</span>
          : (
            <>
              {marketOpen
                ? 'Tasa nominal anual de la última operación · se actualiza cada 30 s'
                : 'Mercado cerrado — última tasa operada de la rueda'}
              {hayCorridos && ' · algún plazo se opera corrido porque el vencimiento caía en día inhábil'}
            </>
          )}
      </div>
    </div>
  );
}

const S = {
  head: { display: 'flex', justifyContent: 'flex-end', marginBottom: 10 },
  switch: { display: 'flex', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' },
  switchBtn: {
    background: 'transparent', border: 'none', cursor: 'pointer',
    fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
    padding: '6px 14px', color: 'var(--text-dim)',
  },
  switchBtnOn: { background: 'var(--bg-card)', color: 'var(--neon)' },

  row: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  card: {
    flex: '1 1 150px', minWidth: 145,
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 5,
  },
  plazoRow: { display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
  plazo: { fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--text-dim)' },
  plazoReal: {
    fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: 0.8,
    color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 3, padding: '1px 4px',
  },
  tasa: { fontFamily: MONO, fontSize: 26, fontWeight: 700, color: 'var(--neon)', lineHeight: 1.1 },
  pct: { fontSize: 14, marginLeft: 2, opacity: 0.75 },
  pie: { fontFamily: MONO, fontSize: 8.5, color: 'var(--text-dim)', letterSpacing: 0.5, opacity: 0.8 },
  vence: { fontFamily: MONO, fontSize: 8.5, color: 'var(--text-dim)', letterSpacing: 0.5, opacity: 0.6 },
  sinDato: { opacity: 0.6 },
  vacio: { fontFamily: MONO, fontSize: 11, color: 'var(--text-dim)', padding: '14px 0' },
  nota: { marginTop: 9, fontFamily: MONO, fontSize: 9, color: 'var(--text-dim)', letterSpacing: 0.8, opacity: 0.75 },
  err: { color: '#ef4444', opacity: 1 },
};

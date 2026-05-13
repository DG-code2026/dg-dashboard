import { useEffect, useMemo, useRef, useState } from 'react';
import FxCalculator from './FxCalculator';
import SharePriceModal from './SharePriceModal';

// Base URL del API. En dev queda '' (proxy de Vite); en producción tomamos
// VITE_API_URL del build. El estado del mercado lo pasa el componente padre
// (App.jsx · FxRoute) vía prop para no duplicar el polling de /api/market/status.
const API_BASE = import.meta.env.VITE_API_URL || '';

// ── Hook: dólar oficial (BNA vía DolarAPI, fallback Bluelytics) ──
//
// Cada 60s pide /api/fx/oficial. El backend ya cachea 30s en memoria, así que
// el costo real de un refresh frecuente es bajo. Pausamos cuando la pestaña
// está en background para no quemar requests al pedo.
function useDolarOficial(intervalMs = 60_000) {
  const [oficial, setOficial] = useState(null); // { compra, venta, fechaActualizacion, source, stale }
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const r = await fetch(`${API_BASE}/api/fx/oficial`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (!cancelled) {
          setOficial(json);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }

    load();
    timerRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, intervalMs);

    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [intervalMs]);

  return { oficial, error };
}

export default function DollarRates({ data, commission, market }) {
  const c = commission;
  const [showCalc, setShowCalc] = useState(false);
  const [shareSpec, setShareSpec] = useState(null);
  const { oficial, error: oficialErr } = useDolarOficial();

  const rates = useMemo(() => {
    const al30 = extract(data?.AL30);
    const al30d = extract(data?.AL30D);
    const al30c = extract(data?.AL30C);
    if (!al30 || !al30d || !al30c) return null;

    // CL = cierre de la rueda anterior (Primary ya omite fines de semana/feriados)
    const prevMep = al30.close && al30d.close ? al30.close / al30d.close : null;
    const prevCcl = al30.close && al30c.close ? al30.close / al30c.close : null;
    const prevCanjeC = al30c.close && al30d.close ? (al30c.close / al30d.close) - 1 : null;
    const prevCanjeV = al30d.close && al30c.close ? (al30d.close / al30c.close) - 1 : null;

    // Convención bancaria (consistente con el dólar oficial):
    //   COMPRA = precio al que el agente COMPRA dólares al cliente
    //           (cliente VENDE → recibe ARS) → usa al30.bid / al30d.offer
    //   VENTA  = precio al que el agente VENDE dólares al cliente
    //           (cliente COMPRA → paga ARS) → usa al30.offer / al30d.bid
    // Así compra < venta (siempre), idéntico a oficial y a todos los sitios
    // financieros AR. Antes estaba invertido (perspectiva del cliente), lo
    // que confundía vs la línea del oficial mostrada arriba.
    const mC_sin = al30.bid / al30d.offer;     // compra MEP (sin comisión)
    const mV_sin = al30.offer / al30d.bid;     // venta MEP (sin comisión)
    const cC_sin = al30.bid / al30c.offer;     // compra CCL
    const cV_sin = al30.offer / al30c.bid;     // venta CCL
    const jC_sin = (al30d.bid / al30c.offer) - 1;   // canje MEP→CCL "compra"
    const jV_sin = (al30c.bid / al30d.offer) - 1;   // canje CCL→MEP "venta"

    // Comisión completa en AMBAS patas (compra de un bono + venta del otro).
    return {
      mep: {
        compra: { sin: mC_sin, con: (al30.bid * (1 - c)) / (al30d.offer * (1 + c)), var: prevMep ? (mC_sin - prevMep) / prevMep : null },
        venta:  { sin: mV_sin, con: (al30.offer * (1 + c)) / (al30d.bid * (1 - c)), var: prevMep ? (mV_sin - prevMep) / prevMep : null },
      },
      ccl: {
        compra: { sin: cC_sin, con: (al30.bid * (1 - c)) / (al30c.offer * (1 + c)), var: prevCcl ? (cC_sin - prevCcl) / prevCcl : null },
        venta:  { sin: cV_sin, con: (al30.offer * (1 + c)) / (al30c.bid * (1 - c)), var: prevCcl ? (cV_sin - prevCcl) / prevCcl : null },
      },
      canje: {
        compra: { sin: jC_sin, con: ((al30d.bid * (1 - c)) / (al30c.offer * (1 + c))) - 1, var: prevCanjeV != null ? jC_sin - prevCanjeV : null },
        venta:  { sin: jV_sin, con: ((al30c.bid * (1 - c)) / (al30d.offer * (1 + c))) - 1, var: prevCanjeC != null ? jV_sin - prevCanjeC : null },
      },
    };
  }, [data, c]);

  if (!rates) return <div style={S.loading}><span style={S.loadingText}>Esperando datos de los 3 tickers...</span></div>;

  return (
    <div style={S.wrapper}>
      <div style={S.toolbar}>
        <MarketStatusBadge status={market} />
        <button
          style={S.calcBtn}
          onClick={() => setShowCalc(true)}
          title="Calculadora FX"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="2" width="16" height="20" rx="2" />
            <line x1="8" y1="6" x2="16" y2="6" />
            <line x1="8" y1="10" x2="8.01" y2="10" />
            <line x1="12" y1="10" x2="12.01" y2="10" />
            <line x1="16" y1="10" x2="16.01" y2="10" />
            <line x1="8" y1="14" x2="8.01" y2="14" />
            <line x1="12" y1="14" x2="12.01" y2="14" />
            <line x1="16" y1="14" x2="16.01" y2="14" />
            <line x1="8" y1="18" x2="8.01" y2="18" />
            <line x1="12" y1="18" x2="12.01" y2="18" />
            <line x1="16" y1="18" x2="16.01" y2="18" />
          </svg>
          <span>CALCULADORA</span>
        </button>
      </div>
      {/* Grilla 2×2: Oficial, MEP, CCL, Canje. Todas las cards comparten el
          mismo alto (alignItems stretch + minHeight) y el mismo ancho (1fr).
          En mobile/tablet pasa a 1 columna por viewport limitado. */}
      <div style={S.grid2x2}>
        <OficialCard oficial={oficial} error={oficialErr} delay={0} />
        <DollarCard title="DÓLAR MEP" pair="AL30 / AL30D" rates={rates.mep} kind="mep" delay={100} onShare={setShareSpec} />
        <DollarCard title="DÓLAR CCL" pair="AL30 / AL30C" rates={rates.ccl} kind="ccl" delay={200} onShare={setShareSpec} />
        <CanjeCard rates={rates.canje} delay={300} onShare={setShareSpec} />
      </div>
      {showCalc && <FxCalculator rates={rates} commission={commission} onClose={() => setShowCalc(false)} />}
      {shareSpec && <SharePriceModal spec={shareSpec} commission={commission} onClose={() => setShareSpec(null)} />}
    </div>
  );
}

function ShareBtn({ onClick, color }) {
  return (
    <button style={{ ...S.shareBtn, color: color || 'var(--text-dim)' }} onClick={onClick} title="Compartir cotización">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>
    </button>
  );
}

function extract(d) {
  if (!d?.marketData) return null;
  const md = d.marketData;
  let bid   = Array.isArray(md.BI) ? md.BI[0]?.price : md.BI?.price;
  let offer = Array.isArray(md.OF) ? md.OF[0]?.price : md.OF?.price;
  const last  = md.LA?.price ?? (Array.isArray(md.LA) ? md.LA[0]?.price : null);
  const close = md.CL?.price ?? (Array.isArray(md.CL) ? md.CL[0]?.price : null);

  // Post-cierre: cuando el mercado cierra Primary deja de mandar BI/OF (no
  // hay book activo) y a veces sólo persiste CL. Para que las cards de
  // dólar sigan mostrando el último valor de cierre conocido en lugar de
  // desaparecer, caemos a LA y luego a CL como punta sintética.
  // Si bid == offer == close, la "var" vs cierre dará 0% — coherente con
  // la realidad: no hay movimiento porque el mercado está cerrado.
  if (bid == null)   bid   = last ?? close;
  if (offer == null) offer = last ?? close;

  if (bid == null || offer == null) return null;
  return { bid, offer, close };
}

function fmtPrice(p) { return Number(p).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtPercent(p) { const v = p * 100; return `${v >= 0 ? '+' : ''}${v.toLocaleString('es-AR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}%`; }

function Var({ value, abs }) {
  if (value == null) return null;
  const pct = value * 100;
  const up = pct >= 0;
  const txt = abs ? `${up ? '+' : ''}${pct.toFixed(3)}pp` : `${up ? '+' : ''}${pct.toFixed(2)}%`;
  return <span style={{ fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 600, color: up ? 'var(--neon)' : 'var(--red)', marginLeft: 6, padding: '1px 5px', borderRadius: 3, background: up ? 'rgba(57,255,20,0.08)' : 'rgba(255,59,59,0.08)', border: `1px solid ${up ? 'rgba(57,255,20,0.2)' : 'rgba(255,59,59,0.2)'}`, whiteSpace: 'nowrap' }}>{txt}</span>;
}

function DollarCard({ title, pair, rates, kind, delay, onShare }) {
  return (
    <div style={{ ...S.card, animationDelay: `${delay}ms` }}>
      <div style={S.cardHeader}><span style={S.cardTitle}>{title}</span><span style={S.cardSub}>{pair}</span></div>
      <div style={S.sidesRow}>
        <div style={S.sideCol}>
          <ShareBtn onClick={() => onShare({ op: kind, side: 'compra', sin: rates.compra.sin, con: rates.compra.con, isPct: false })} color="var(--neon)" />
          <span style={{ ...S.sideLabel, color: 'var(--neon)' }}>COMPRA</span>
          <span style={{ ...S.mainPrice, color: 'var(--neon)' }}>${fmtPrice(rates.compra.con)}</span>
          <div style={S.sinRow}><span style={S.sinLabel}>SIN COM.</span><span style={S.sinValue}>${fmtPrice(rates.compra.sin)}</span><Var value={rates.compra.var} /></div>
        </div>
        <div style={S.sideDivider} />
        <div style={S.sideCol}>
          <ShareBtn onClick={() => onShare({ op: kind, side: 'venta', sin: rates.venta.sin, con: rates.venta.con, isPct: false })} color="var(--red)" />
          <span style={{ ...S.sideLabel, color: 'var(--red)' }}>VENTA</span>
          <span style={{ ...S.mainPrice, color: 'var(--red)' }}>${fmtPrice(rates.venta.con)}</span>
          <div style={S.sinRow}><span style={S.sinLabel}>SIN COM.</span><span style={S.sinValue}>${fmtPrice(rates.venta.sin)}</span><Var value={rates.venta.var} /></div>
        </div>
      </div>
    </div>
  );
}

function CanjeCard({ rates, delay, onShare }) {
  return (
    <div style={{ ...S.card, animationDelay: `${delay}ms` }}>
      <div style={S.cardHeader}><span style={S.cardTitle}>CANJE MEP ↔ CCL</span><span style={S.cardSub}>AL30C / AL30D</span></div>
      <div style={S.sidesRow}>
        <div style={S.sideCol}>
          <ShareBtn onClick={() => onShare({ op: 'canje', side: 'compra', sin: rates.compra.sin, con: rates.compra.con, isPct: true })} color="var(--neon)" />
          <span style={{ ...S.sideLabel, color: 'var(--neon)' }}>COMPRA</span>
          <span style={S.canjeDesc}>MEP → CCL</span>
          <span style={{ ...S.canjePrice, color: 'var(--neon)' }}>{fmtPercent(rates.compra.con)}</span>
          <div style={S.sinRow}><span style={S.sinLabel}>SIN COM.</span><span style={S.sinValue}>{fmtPercent(rates.compra.sin)}</span><Var value={rates.compra.var} abs /></div>
        </div>
        <div style={S.sideDivider} />
        <div style={S.sideCol}>
          <ShareBtn onClick={() => onShare({ op: 'canje', side: 'venta', sin: rates.venta.sin, con: rates.venta.con, isPct: true })} color="var(--red)" />
          <span style={{ ...S.sideLabel, color: 'var(--red)' }}>VENTA</span>
          <span style={S.canjeDesc}>CCL → MEP</span>
          <span style={{ ...S.canjePrice, color: 'var(--red)' }}>{fmtPercent(rates.venta.con)}</span>
          <div style={S.sinRow}><span style={S.sinLabel}>SIN COM.</span><span style={S.sinValue}>{fmtPercent(rates.venta.sin)}</span><Var value={rates.venta.var} abs /></div>
        </div>
      </div>
    </div>
  );
}

function MarketStatusBadge({ status }) {
  if (!status) return null; // primera carga, no mostramos nada
  const { open, reason, nowAR, sessionStart, sessionEnd } = status;
  const reasonLabel =
    reason === 'fin_de_semana' ? 'Fin de semana' :
    reason === 'pre_apertura'  ? 'Pre apertura' :
    reason === 'post_cierre'   ? 'Post cierre'  : null;
  const tooltip = open
    ? `Mercado abierto · sesión ${sessionStart} – ${sessionEnd} (hora AR: ${nowAR})`
    : `Mercado cerrado · próxima rueda ${sessionStart} – ${sessionEnd} (hora AR: ${nowAR})`;
  return (
    <div
      style={open ? S.badgeOpen : S.badgeClosed}
      title={tooltip}
    >
      <span style={open ? S.badgeDotOpen : S.badgeDotClosed} />
      <span>{open ? 'MERCADO ABIERTO' : 'MERCADO CERRADO'}</span>
      {!open && reasonLabel && <span style={S.badgeReason}>· {reasonLabel}</span>}
    </div>
  );
}

function OficialCard({ oficial, error, delay }) {
  // Loading state mientras llega la primera respuesta.
  if (!oficial && !error) {
    return (
      <div style={{ ...S.card, animationDelay: `${delay}ms` }}>
        <div style={S.cardHeader}>
          <span style={S.cardTitle}>DÓLAR OFICIAL</span>
          <span style={S.cardSub}>cargando…</span>
        </div>
        <div style={S.oficialLoading}>—</div>
      </div>
    );
  }

  // Error sin payload cacheado: card chiquita con el error.
  if (error && !oficial) {
    return (
      <div style={{ ...S.card, animationDelay: `${delay}ms` }}>
        <div style={S.cardHeader}>
          <span style={S.cardTitle}>DÓLAR OFICIAL</span>
          <span style={{ ...S.cardSub, color: 'var(--red)' }}>error</span>
        </div>
        <div style={S.oficialErr}>{error}</div>
      </div>
    );
  }

  const { compra, venta, fechaActualizacion, source, stale } = oficial;
  const sub =
    source === 'bluelytics' ? 'BNA · vía Bluelytics' :
    source === 'dolarapi'   ? 'BNA · vía DolarAPI' :
                              'BNA';

  return (
    <div style={{ ...S.card, animationDelay: `${delay}ms` }}>
      <div style={S.cardHeader}>
        <span style={S.cardTitle}>DÓLAR OFICIAL</span>
        <span style={S.cardSub}>{sub}</span>
        {stale && <span style={S.staleBadge}>cache vencido</span>}
      </div>
      <div style={S.sidesRow}>
        <div style={S.sideCol}>
          <span style={{ ...S.sideLabel, color: 'var(--neon)' }}>COMPRA</span>
          <span style={{ ...S.mainPrice, color: 'var(--neon)' }}>${fmtPrice(compra)}</span>
        </div>
        <div style={S.sideDivider} />
        <div style={S.sideCol}>
          <span style={{ ...S.sideLabel, color: 'var(--red)' }}>VENTA</span>
          <span style={{ ...S.mainPrice, color: 'var(--red)' }}>${fmtPrice(venta)}</span>
        </div>
      </div>
      <div style={S.oficialFooter}>
        <span style={S.oficialFooterLabel}>ÚLTIMA ACTUALIZACIÓN</span>
        <span style={S.oficialFooterValue}>{fmtUpdate(fechaActualizacion)}</span>
      </div>
    </div>
  );
}

function fmtUpdate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-AR', {
      day:    '2-digit', month:  '2-digit',
      hour:   '2-digit', minute: '2-digit',
      hour12: false,
    });
  } catch { return '—'; }
}

const S = {
  wrapper: { display: 'flex', flexDirection: 'column', gap: 16 },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },

  // Badge "MERCADO ABIERTO/CERRADO"
  // Badges del estado de mercado: verde-neón si está abierto, ámbar si está
  // cerrado. Los colores vienen de var() para que sigan al theme switch.
  badgeOpen:    { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'rgba(57,255,20,0.06)', border: '1px solid rgba(57,255,20,0.35)', borderRadius: 6, color: 'var(--green)', fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 2, cursor: 'help' },
  badgeClosed:  { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'var(--warn-soft)',     border: '1px solid var(--warn-border)',         borderRadius: 6, color: 'var(--warn)', fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 2, cursor: 'help' },
  badgeDotOpen:   { width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 8px var(--green)' },
  badgeDotClosed: { width: 8, height: 8, borderRadius: '50%', background: 'var(--warn)' },
  badgeReason:    { fontWeight: 400, opacity: 0.85, marginLeft: 4 },

  calcBtn: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 2, cursor: 'pointer', transition: 'all 0.15s' },
  loading: { textAlign: 'center', padding: 40 },
  loadingText: { fontFamily: "'Roboto Mono', monospace", fontSize: 12, color: 'var(--text-dim)', letterSpacing: 1 },
  // Grilla 2×2 que colapsa naturalmente a 1 col cuando el viewport es chico:
  // `auto-fit, minmax(320px, 1fr)` arma 2 columnas si caben (≥640px efectivo)
  // y baja a 1 col debajo. `gridAutoRows: 1fr` mantiene mismo alto entre las
  // filas existentes en cualquier breakpoint.
  grid2x2: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gridAutoRows: '1fr',
    gap: 'var(--grid-gap)',
  },
  // `display: flex` + `flexDirection: column` + minHeight unificado para que
  // las 4 cards tengan exactamente el mismo alto. El footer del Oficial
  // ("última actualización") empuja hacia abajo con marginTop:auto en lugar
  // de fijar margen, así no rompe la equalización.
  // Borde con var --fx-card-border (azul fuerte en light, blanco en dark).
  // containerType: inline-size habilita las unidades cqi/cqw en hijos →
  // la tipografía interna escala con el ANCHO DEL CARD (no del viewport),
  // así con 4-en-fila los precios no se solapan con el divider central.
  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--fx-card-border)',
    borderRadius: 8,
    padding: '18px 22px',
    animation: 'fade-in 0.5s ease forwards',
    opacity: 0,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 200,
    containerType: 'inline-size',
  },
  cardHeader: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
  // Title/sub escalan con el ancho del card (cqi). En cards angostos quedan
  // chicos, en cards anchos crecen — pero nunca se solapan con el contenido.
  cardTitle: { fontFamily: "'Roboto', sans-serif", fontWeight: 700, fontSize: 'clamp(14px, 4cqi, 18px)', letterSpacing: 3, color: 'var(--text)' },
  cardSub:   { fontSize: 'clamp(10px, 2.4cqi, 12px)', color: 'var(--text-dim)', fontWeight: 300 },
  // flex:1 para que el row ocupe todo el espacio restante del card y centre
  // verticalmente las cifras → todas las cards 2×2 quedan equilibradas.
  sidesRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 0 },
  // Divider más finito (margin 12 en lugar de 20) → más espacio para los
  // precios sin que peguen con el divider central.
  sideDivider: { width: 1, background: 'var(--border)', margin: '0 12px', alignSelf: 'stretch', flexShrink: 0 },
  // minWidth:0 permite que el flex item se contraiga (default es content-width)
  // → si el precio fuera demasiado ancho, no fuerza overflow del card.
  sideCol: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, position: 'relative' },
  shareBtn: { position: 'absolute', top: -4, right: -4, background: 'transparent', border: 'none', padding: 4, borderRadius: 4, cursor: 'pointer', opacity: 0.4, transition: 'opacity 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  sideLabel: { fontFamily: "'Roboto Mono', monospace", fontSize: 'clamp(9px, 2.4cqi, 11px)', fontWeight: 700, letterSpacing: 3 },
  // mainPrice escala con el ancho del card: 7cqi (~7% del card width). Con
  // un card de 320px da 22px ; con un card de 480px da ~33px ; nunca pasa
  // de 32px (clamp). Resultado: nunca se solapa con el divider central
  // independientemente del viewport / cantidad de cards en fila.
  mainPrice: { fontFamily: "'Roboto Mono', monospace", fontSize: 'clamp(20px, 7cqi, 32px)', fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap' },
  sinRow: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, flexWrap: 'wrap', justifyContent: 'center' },
  // Sin comisión: un poco más grande para mejor jerarquía visual debajo del
  // precio neto. Aproximadamente 50-55% del tamaño del mainPrice (7cqi)
  // → sinValue 3.6cqi mantiene proporción coherente.
  sinLabel: { fontFamily: "'Roboto Mono', monospace", fontSize: 'clamp(9px, 2.3cqi, 11px)', letterSpacing: 1, color: 'var(--text-dim)', opacity: 0.7 },
  sinValue: { fontFamily: "'Roboto Mono', monospace", fontSize: 'clamp(12px, 3.6cqi, 16px)', color: 'var(--text-dim)', fontWeight: 500 },
  canjeDesc: { fontFamily: "'Roboto Mono', monospace", fontSize: 'clamp(8px, 2cqi, 10px)', color: 'var(--text-dim)', letterSpacing: 1 },
  // canjePrice ligeramente más chico que mainPrice porque el "%" suma ancho.
  canjePrice: { fontFamily: "'Roboto Mono', monospace", fontSize: 'clamp(18px, 6cqi, 28px)', fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap' },

  // ── Dólar oficial ──
  oficialLoading: { textAlign: 'center', padding: '20px 0', fontFamily: "'Roboto Mono', monospace", fontSize: 18, color: 'var(--text-dim)' },
  oficialErr:     { textAlign: 'center', padding: '12px 0', fontFamily: "'Roboto Mono', monospace", fontSize: 11, color: 'var(--red)' },
  // marginTop: 'auto' empuja el footer al fondo del flex column del card,
  // así Oficial queda visualmente alineada con las otras cards 2×2.
  oficialFooter:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--border)' },
  oficialFooterLabel: { fontFamily: "'Roboto Mono', monospace", fontSize: 8, letterSpacing: 1.5, color: 'var(--text-dim)' },
  oficialFooterValue: { fontFamily: "'Roboto Mono', monospace", fontSize: 10, color: 'var(--text-dim)' },
  staleBadge:     { fontFamily: "'Roboto Mono', monospace", fontSize: 8, letterSpacing: 1, color: 'var(--warn)', background: 'var(--warn-soft)', border: '1px solid var(--warn-border)', borderRadius: 3, padding: '2px 6px', marginLeft: 'auto' },
};

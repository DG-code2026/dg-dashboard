import { useMemo, useState } from 'react';
import FxCalculator from './FxCalculator';
import SharePriceModal from './SharePriceModal';

export default function DollarRates({ data, commission }) {
  const c = commission;
  const [showCalc, setShowCalc] = useState(false);
  const [shareSpec, setShareSpec] = useState(null);

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

    const mCS = al30.offer / al30d.bid;
    const mVS = al30.bid / al30d.offer;
    const cCS = al30.offer / al30c.bid;
    const cVS = al30.bid / al30c.offer;
    const jCS = (al30c.bid / al30d.offer) - 1;
    const jVS = (al30d.bid / al30c.offer) - 1;

    // Canje: comisión completa en AMBAS patas (compra de un bono + venta del
    // otro) → idéntico criterio que MEP/CCL y que la calculadora de rotaciones.
    // Antes se usaba media comisión en cada lado, lo que daba comisión total ≈
    // "c" en vez de "2·c", sub-reportando el costo del canje real.
    return {
      mep: {
        compra: { sin: mCS, con: (al30.offer * (1 + c)) / (al30d.bid * (1 - c)), var: prevMep ? (mCS - prevMep) / prevMep : null },
        venta: { sin: mVS, con: (al30.bid * (1 - c)) / (al30d.offer * (1 + c)), var: prevMep ? (mVS - prevMep) / prevMep : null },
      },
      ccl: {
        compra: { sin: cCS, con: (al30.offer * (1 + c)) / (al30c.bid * (1 - c)), var: prevCcl ? (cCS - prevCcl) / prevCcl : null },
        venta: { sin: cVS, con: (al30.bid * (1 - c)) / (al30c.offer * (1 + c)), var: prevCcl ? (cVS - prevCcl) / prevCcl : null },
      },
      canje: {
        compra: { sin: jCS, con: ((al30c.bid * (1 - c)) / (al30d.offer * (1 + c))) - 1, var: prevCanjeC != null ? jCS - prevCanjeC : null },
        venta: { sin: jVS, con: ((al30d.bid * (1 - c)) / (al30c.offer * (1 + c))) - 1, var: prevCanjeV != null ? jVS - prevCanjeV : null },
      },
    };
  }, [data, c]);

  if (!rates) return <div style={S.loading}><span style={S.loadingText}>Esperando datos de los 3 tickers...</span></div>;

  return (
    <div style={S.wrapper}>
      <div style={S.toolbar}>
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
      <div style={S.grid}>
        <DollarCard title="DÓLAR MEP" pair="AL30 / AL30D" rates={rates.mep} kind="mep" delay={0} onShare={setShareSpec} />
        <DollarCard title="DÓLAR CCL" pair="AL30 / AL30C" rates={rates.ccl} kind="ccl" delay={100} onShare={setShareSpec} />
      </div>
      <CanjeCard rates={rates.canje} delay={200} onShare={setShareSpec} />
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
  const bid = Array.isArray(md.BI) ? md.BI[0]?.price : md.BI?.price;
  const offer = Array.isArray(md.OF) ? md.OF[0]?.price : md.OF?.price;
  const close = md.CL?.price ?? (Array.isArray(md.CL) ? md.CL[0]?.price : null);
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

const S = {
  wrapper: { display: 'flex', flexDirection: 'column', gap: 16 },
  toolbar: { display: 'flex', justifyContent: 'flex-end' },
  calcBtn: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 2, cursor: 'pointer', transition: 'all 0.15s' },
  loading: { textAlign: 'center', padding: 40 },
  loadingText: { fontFamily: "'Roboto Mono', monospace", fontSize: 12, color: 'var(--text-dim)', letterSpacing: 1 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 },
  card: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '20px 24px', animation: 'fade-in 0.5s ease forwards', opacity: 0 },
  cardHeader: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 20 },
  cardTitle: { fontFamily: "'Roboto', sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: 3, color: 'var(--text)' },
  cardSub: { fontSize: 11, color: 'var(--text-dim)', fontWeight: 300 },
  sidesRow: { display: 'flex', alignItems: 'stretch' },
  sideDivider: { width: 1, background: 'var(--border)', margin: '0 20px', alignSelf: 'stretch' },
  sideCol: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, position: 'relative' },
  shareBtn: { position: 'absolute', top: -4, right: -4, background: 'transparent', border: 'none', padding: 4, borderRadius: 4, cursor: 'pointer', opacity: 0.4, transition: 'opacity 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  sideLabel: { fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 3 },
  mainPrice: { fontFamily: "'Roboto Mono', monospace", fontSize: 26, fontWeight: 700, lineHeight: 1.2 },
  sinRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' },
  sinLabel: { fontFamily: "'Roboto Mono', monospace", fontSize: 8, letterSpacing: 1, color: 'var(--text-dim)', opacity: 0.6 },
  sinValue: { fontFamily: "'Roboto Mono', monospace", fontSize: 12, color: 'var(--text-dim)' },
  canjeDesc: { fontFamily: "'Roboto Mono', monospace", fontSize: 9, color: 'var(--text-dim)', letterSpacing: 1 },
  canjePrice: { fontFamily: "'Roboto Mono', monospace", fontSize: 24, fontWeight: 700, lineHeight: 1.2 },
};

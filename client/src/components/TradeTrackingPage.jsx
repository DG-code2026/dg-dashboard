import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const DEFAULT_SETTLEMENT = 'A-24HS';

const TAGS = ['JHBV', 'GGA', 'JMD'];
const DEFAULT_BROKERS = [
  { id: 'PPI', label: 'PPI', color: '#3b82f6' },
  { id: 'INVIU', label: 'INVIU', color: '#22c55e' },
];
const BROKER_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#a855f7', '#ef4444', '#14b8a6', '#f97316'];

// Explicit colors — do NOT use var(--neon) for profit/loss because the theme's neon can be cyan, not green.
const GREEN = '#22c55e';
const RED = '#ef4444';

// ── Comisión operativa ──
// Valor por defecto (0,6%) usado cuando el trade no tiene comisión propia seteada.
// La comisión se guarda POR TRADE (columna `commission` en la tabla) y se aplica
// EN LAS DOS PATAS:
//   · Costo de compra por unidad: price × (1 + c)
//   · Ingreso de venta por unidad: price × (1 − c)
// Así el rendimiento neto absorbe 2× la comisión contra el bruto.
const DEFAULT_COMM_PCT = 0.6;
// Derecho de mercado ByMA 24H para soberanos/subsoberanos (valor por defecto).
// Se aplica por trade en AMBAS patas, igual que la comisión:
//   · Costo de compra: price × (1 + comm + drx)
//   · Ingreso de venta: price × (1 − comm − drx)
const DEFAULT_DRX_PCT = 0.01;
// Devuelve la comisión % aplicable a un trade (su valor guardado o el default).
const tradeComm = (t) => (t?.commission != null && !isNaN(Number(t.commission))) ? Number(t.commission) : DEFAULT_COMM_PCT;
// Devuelve el derecho de mercado % aplicable a un trade.
const tradeDrx  = (t) => (t?.market_fee != null && !isNaN(Number(t.market_fee))) ? Number(t.market_fee) : DEFAULT_DRX_PCT;

function loadBrokers() {
  try {
    const custom = JSON.parse(localStorage.getItem('tt_brokers') || '[]');
    return [...DEFAULT_BROKERS, ...(Array.isArray(custom) ? custom : [])];
  } catch { return [...DEFAULT_BROKERS]; }
}
function saveCustomBrokers(list) {
  const custom = list.filter(b => !DEFAULT_BROKERS.find(d => d.id === b.id));
  localStorage.setItem('tt_brokers', JSON.stringify(custom));
}

function fmtN(v, dec = 2) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtPct(v, dec = 2) {
  if (v == null || isNaN(v)) return '—';
  return `${v >= 0 ? '+' : ''}${Number(v).toFixed(dec)}%`;
}
function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('es-AR'); } catch { return '—'; }
}
function daysBetween(a, b) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}
function brokerColor(brokers, id) { return brokers.find(b => b.id === id)?.color || 'var(--border)'; }
function signColor(v) { if (v == null || isNaN(v)) return 'var(--text-dim)'; return v >= 0 ? GREEN : RED; }

// Resolve target to an actual price (yield % target → implied price from entry).
function resolveTargetPrice(t) {
  if (t.target_value == null) return null;
  if (t.target_type === 'yield') {
    if (t.price == null) return null;
    return t.price * (1 + t.target_value / 100);
  }
  return t.target_value;
}

function extractCurrentPrice(md) {
  if (!md) return null;
  const pick = (x) => Array.isArray(x) ? x[0]?.price : x?.price;
  return pick(md.LA) ?? pick(md.CL) ?? (() => {
    const bi = pick(md.BI), of = pick(md.OF);
    if (bi && of) return (bi + of) / 2;
    return bi || of || null;
  })();
}

async function loadH2C() {
  if (window.html2canvas) return window.html2canvas;
  return new Promise((r, j) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'; s.onload = () => r(window.html2canvas); s.onerror = () => j(); document.head.appendChild(s); });
}

// ══════════════════════════════════════════════
//  PAGE
// ══════════════════════════════════════════════
export default function TradeTrackingPage({ marketData = {}, primaryConnected = false }) {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterTag, setFilterTag] = useState('ALL');
  const [showForm, setShowForm] = useState(false);
  const [editTrade, setEditTrade] = useState(null);
  const [detailTrade, setDetailTrade] = useState(null);
  const [flyerTrade, setFlyerTrade] = useState(null);
  const [brokers, setBrokers] = useState(loadBrokers);

  const addBroker = (b) => {
    const next = [...brokers, b];
    saveCustomBrokers(next);
    setBrokers(next);
  };
  const removeBroker = (id) => {
    if (DEFAULT_BROKERS.find(d => d.id === id)) return;
    const next = brokers.filter(b => b.id !== id);
    saveCustomBrokers(next);
    setBrokers(next);
  };

  const fetchTrades = useCallback(async () => {
    try { const r = await fetch(`${API}/api/db/trades`); const d = await r.json(); if (Array.isArray(d)) setTrades(d); } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTrades(); }, [fetchTrades]);

  useEffect(() => {
    if (!trades.length) return;
    const uniq = new Map();
    trades.forEach(t => uniq.set(`${t.ticker}|${t.settlement || DEFAULT_SETTLEMENT}`, { ticker: t.ticker, settlement: t.settlement || DEFAULT_SETTLEMENT }));
    uniq.forEach(({ ticker, settlement }) => {
      fetch(`${API}/api/primary/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker, settlement }) }).catch(() => {});
    });
  }, [trades]);

  const getQuote = useCallback((t) => {
    const key = `${t.ticker}|${t.settlement || DEFAULT_SETTLEMENT}`;
    const entry = marketData[key];
    if (!entry?.marketData) return { price: null, ts: null };
    return { price: extractCurrentPrice(entry.marketData), ts: entry.timestamp };
  }, [marketData]);

  const visibleTrades = useMemo(() => filterTag === 'ALL' ? trades : trades.filter(t => t.tag === filterTag), [trades, filterTag]);

  const handleCreate = async (data) => {
    await fetch(`${API}/api/db/trades`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    setShowForm(false); fetchTrades();
  };
  const handleUpdate = async (id, data) => {
    await fetch(`${API}/api/db/trades/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    setEditTrade(null); fetchTrades();
  };
  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este trade?')) return;
    await fetch(`${API}/api/db/trades/${id}`, { method: 'DELETE' });
    fetchTrades();
  };

  const alerts = trades.filter(t => {
    const q = getQuote(t); if (!q?.price || t.stop_loss == null) return false;
    return q.price <= t.stop_loss;
  });

  return (
    <div>
      {alerts.length > 0 && (
        <div style={S.alertBox}>
          <b>⚠ {alerts.length} trade{alerts.length > 1 ? 's' : ''} bajo stop loss:</b> {alerts.map(a => a.ticker).join(', ')}
        </div>
      )}

      <div style={S.topRow}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={S.filterLbl}>ETIQUETA</span>
          <button style={{ ...S.filterBtn, ...(filterTag === 'ALL' ? S.filterBtnActive : {}) }} onClick={() => setFilterTag('ALL')}>TODAS ({trades.length})</button>
          {TAGS.map(t => {
            const n = trades.filter(x => x.tag === t).length;
            return <button key={t} style={{ ...S.filterBtn, ...(filterTag === t ? S.filterBtnActive : {}) }} onClick={() => setFilterTag(t)}>{t} ({n})</button>;
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ ...S.liveDot, background: primaryConnected ? GREEN : RED }} title={primaryConnected ? 'Conectado a Primary' : 'Desconectado'}>
            <span style={{ ...S.liveDotInner, background: primaryConnected ? GREEN : RED }} />
            {primaryConnected ? 'LIVE' : 'OFFLINE'}
          </span>
          <button style={S.addBtn} onClick={() => setShowForm(true)}>＋ NUEVO TRADE</button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)', fontSize: 12 }}>Cargando...</div>
      ) : !visibleTrades.length ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>📊</div>
          <div style={{ fontSize: 13 }}>Sin trades cargados</div>
          <div style={{ fontSize: 11, marginTop: 4, opacity: 0.6 }}>Agregá un nuevo trade para empezar</div>
        </div>
      ) : (
        <div style={S.rowList}>
          <div style={S.rowHeader}>
            <div style={{ ...S.col, ...S.colTicker }}>TICKER</div>
            <div style={{ ...S.col, ...S.colTag }}>ETIQ.</div>
            <div style={{ ...S.col, ...S.colClient }}>CLIENTE</div>
            <div style={{ ...S.col, ...S.colDate }}>FECHA</div>
            <div style={{ ...S.col, ...S.colNum }}>ENTRADA</div>
            <div style={{ ...S.col, ...S.colNum }}>ACTUAL</div>
            <div style={{ ...S.col, ...S.colNum }}>REND. % B/N</div>
            <div style={{ ...S.col, ...S.colNum }}>RESULT. B/N</div>
            <div style={{ ...S.col, ...S.colNum }}>DÍAS</div>
            <div style={{ ...S.col, ...S.colNum }}>OBJ.</div>
            <div style={{ ...S.col, ...S.colNum }}>STOP</div>
            <div style={{ ...S.col, ...S.colActions }} />
          </div>
          {visibleTrades.map(t => {
            const q = getQuote(t); const m = computeMetrics(t, q.price, tradeComm(t), tradeDrx(t));
            const priceColor = q.price == null ? 'var(--text-dim)' : (q.price >= t.price ? GREEN : RED);
            const grossTotal = m ? m.grossRetAbs * t.quantity : null;
            const netTotal = m ? m.netRetAbs * t.quantity : null;
            const tgtPrice = resolveTargetPrice(t);
            return (
              <div
                key={t.id}
                style={{ ...S.row, borderLeft: `3px solid ${brokerColor(brokers, t.broker)}` }}
                onClick={() => setDetailTrade(t)}
              >
                <div style={{ ...S.col, ...S.colTicker }}>
                  <span style={S.rowTicker}>{t.ticker}</span>
                  <span style={{ ...S.rowBroker, background: `${brokerColor(brokers, t.broker)}22`, color: brokerColor(brokers, t.broker), borderColor: brokerColor(brokers, t.broker) }}>{t.broker}</span>
                </div>
                <div style={{ ...S.col, ...S.colTag }}>
                  {t.tag && <span style={S.tagPill}>{t.tag}</span>}
                </div>
                <div style={{ ...S.col, ...S.colClient }}>
                  <div style={S.rowClient}>{t.client_name || '—'}</div>
                  {t.client_account && <div style={S.rowAcct}>{t.client_account}</div>}
                </div>
                <div style={{ ...S.col, ...S.colDate }}>{fmtDate(t.trade_date)}</div>
                <div style={{ ...S.col, ...S.colNum }}>${fmtN(t.price)}</div>
                <div style={{ ...S.col, ...S.colNum, color: priceColor, fontWeight: 700 }}>{q.price != null ? `$${fmtN(q.price)}` : '…'}</div>
                <div style={{ ...S.col, ...S.colNum }}>
                  <div style={{ color: signColor(m?.grossRetPct), fontWeight: 700 }}>{m ? fmtPct(m.grossRetPct) : '—'}</div>
                  <div style={{ color: signColor(m?.netRetPct), fontSize: 9, opacity: 0.85 }}>{m ? `neto ${fmtPct(m.netRetPct)}` : ''}</div>
                </div>
                <div style={{ ...S.col, ...S.colNum }}>
                  <div style={{ color: signColor(grossTotal), fontWeight: 700 }}>{grossTotal != null ? `${grossTotal >= 0 ? '+' : ''}$${fmtN(grossTotal)}` : '—'}</div>
                  <div style={{ color: signColor(netTotal), fontSize: 9, opacity: 0.85 }}>{netTotal != null ? `neto ${netTotal >= 0 ? '+' : ''}$${fmtN(netTotal)}` : ''}</div>
                </div>
                <div style={{ ...S.col, ...S.colNum }}>{m?.days ?? '—'}</div>
                <div style={{ ...S.col, ...S.colNum }}>{tgtPrice != null ? `$${fmtN(tgtPrice)}` : '—'}</div>
                <div style={{ ...S.col, ...S.colNum, color: t.stop_loss != null ? RED : 'var(--text-dim)' }}>{t.stop_loss != null ? `$${fmtN(t.stop_loss)}` : '—'}</div>
                <div style={{ ...S.col, ...S.colActions }} onClick={e => e.stopPropagation()}>
                  <button style={S.iconBtn} onClick={() => setEditTrade(t)} title="Editar">✎</button>
                  <button style={{ ...S.iconBtn, color: RED }} onClick={() => handleDelete(t.id)} title="Eliminar">×</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && <TradeForm brokers={brokers} addBroker={addBroker} removeBroker={removeBroker} onSave={handleCreate} onClose={() => setShowForm(false)} />}
      {editTrade && <TradeForm brokers={brokers} addBroker={addBroker} removeBroker={removeBroker} trade={editTrade} onSave={(data) => handleUpdate(editTrade.id, data)} onClose={() => setEditTrade(null)} editMode />}
      {detailTrade && <TradeDetail trade={detailTrade} quote={getQuote(detailTrade)} brokers={brokers} onClose={() => setDetailTrade(null)} onFlyer={() => setFlyerTrade(detailTrade)} />}
      {flyerTrade && <TradeFlyer trade={flyerTrade} quote={getQuote(flyerTrade)} brokers={brokers} onClose={() => setFlyerTrade(null)} />}
    </div>
  );
}

// ══════════════════════════════════════════════
//  METRICS
// ══════════════════════════════════════════════
// `commPct` viene en porcentaje (ej. 0.6 = 0,6%). Se aplica por igual a compra y venta:
//   invested = price × (1 + c);  sold = price × (1 − c)
function computeMetrics(t, currentPrice, commPct = DEFAULT_COMM_PCT, drxPct = DEFAULT_DRX_PCT) {
  if (currentPrice == null || t.price == null) return null;
  // fee = comm + drx, aplicado como una sola alícuota en cada punta.
  const fee = ((commPct || 0) + (drxPct || 0)) / 100;
  // Costo efectivo de compra por unidad: precio + fee%.
  const investedPerUnit = t.price * (1 + fee);
  // Monto efectivo recibido por unidad al vender: precio actual − fee%.
  const sellPerUnit = currentPrice * (1 - fee);

  // Bruto: sin comisiones.
  const grossRetAbs = currentPrice - t.price;
  const grossRetPct = (grossRetAbs / t.price) * 100;
  // Neto: absorbe 2× comisión (una en cada pata).
  const netRetAbs = sellPerUnit - investedPerUnit;
  const netRetPct = (netRetAbs / investedPerUnit) * 100;

  const days = daysBetween(t.trade_date, new Date());

  const tgtPrice = resolveTargetPrice(t);
  let targetRemPct = null;
  if (tgtPrice != null) targetRemPct = ((tgtPrice - currentPrice) / currentPrice) * 100;
  const stopHit = t.stop_loss != null && currentPrice <= t.stop_loss;
  const stopDistPct = t.stop_loss != null ? ((currentPrice - t.stop_loss) / currentPrice) * 100 : null;

  // retAbs/retPct se mantienen como alias brutos para compatibilidad.
  return {
    retAbs: grossRetAbs, retPct: grossRetPct,
    grossRetAbs, grossRetPct,
    netRetAbs, netRetPct,
    days, targetRemPct, stopHit, stopDistPct, tgtPrice, investedPerUnit, sellPerUnit,
  };
}

function Metric({ l, v, color }) {
  return (
    <div style={S.metric}>
      <div style={S.metricL}>{l}</div>
      <div style={{ ...S.metricV, color: color || 'var(--text)' }}>{v}</div>
    </div>
  );
}

// ══════════════════════════════════════════════
//  PROGRESS BAR — stop ←→ target with quote marker
// ══════════════════════════════════════════════
function ProgressBar({ trade, quote, compact }) {
  const H = compact ? 14 : 20;
  if (quote == null || trade.price == null) {
    return <div style={{ height: H, background: 'var(--border)', borderRadius: H / 2, margin: '10px 0' }} />;
  }
  const entry = trade.price;
  const stop = trade.stop_loss;
  const target = resolveTargetPrice(trade);

  let lo, hi;
  if (stop != null && target != null) { lo = Math.min(stop, entry); hi = Math.max(target, entry); }
  else if (stop != null) { lo = Math.min(stop, entry); hi = Math.max(entry, quote) + Math.abs(entry - stop); }
  else if (target != null) { lo = Math.min(entry, quote) - Math.abs(target - entry); hi = Math.max(target, entry); }
  else {
    const r = Math.max(Math.abs(quote - entry) * 2, entry * 0.05);
    lo = entry - r; hi = entry + r;
  }
  if (quote < lo) lo = quote; if (quote > hi) hi = quote;
  const span = (hi - lo) || 1;
  const p = v => Math.max(0, Math.min(100, ((v - lo) / span) * 100));

  const qPos = p(quote);
  const ePos = p(entry);
  const profit = quote >= entry;
  const fillLeft = Math.min(qPos, ePos);
  const fillWidth = Math.abs(qPos - ePos);
  const fillColor = profit ? GREEN : RED;

  return (
    <div style={{ position: 'relative', height: H, background: 'var(--border)', borderRadius: H / 2, margin: compact ? '12px 2px 14px' : '18px 4px 22px' }}>
      {fillWidth > 0.01 && (
        <div style={{ position: 'absolute', top: 0, left: `${fillLeft}%`, width: `${fillWidth}%`, height: '100%', background: fillColor, borderRadius: H / 4, transition: 'all 0.3s', boxShadow: `0 0 8px ${fillColor}55` }} />
      )}
      {stop != null && <BarMark pos={p(stop)} color={RED} h={H + 10} label={compact ? null : 'STOP'} labelPos="below" title={`Stop $${fmtN(stop)}`} />}
      <BarMark pos={ePos} color="var(--text)" h={H + 6} dashed label={compact ? null : 'ENTRY'} labelPos="below" title={`Entry $${fmtN(entry)}`} />
      {target != null && <BarMark pos={p(target)} color={GREEN} h={H + 10} label={compact ? null : 'TARGET'} labelPos="below" title={`Target $${fmtN(target)}`} />}
      <BarMark pos={qPos} color={fillColor} h={H + 14} isQuote label={compact ? `$${fmtN(quote)}` : null} labelPos="above" title={`Actual $${fmtN(quote)}`} />
    </div>
  );
}

function BarMark({ pos, color, h, label, labelPos, title, dashed, isQuote }) {
  const style = {
    position: 'absolute',
    left: `${pos}%`,
    top: isQuote ? -((h - 14) / 2) : -((h - 14) / 2 - 1),
    width: isQuote ? 3 : 2,
    height: h,
    background: dashed ? 'transparent' : color,
    borderLeft: dashed ? `2px dashed ${color}` : 'none',
    transform: 'translateX(-50%)',
    borderRadius: 1,
    boxShadow: isQuote ? `0 0 6px ${color}` : 'none',
    zIndex: isQuote ? 3 : 2,
  };
  return (
    <>
      <div style={style} title={title} />
      {label && (
        <div style={{
          position: 'absolute',
          left: `${pos}%`,
          [labelPos === 'above' ? 'bottom' : 'top']: h - 2,
          transform: 'translateX(-50%)',
          fontFamily: "'Roboto Mono',monospace",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 0.5,
          color,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          padding: '1px 4px',
          background: 'var(--bg-card)',
          borderRadius: 2,
        }}>{label}</div>
      )}
    </>
  );
}

// ══════════════════════════════════════════════
//  FORM (create/edit)
// ══════════════════════════════════════════════
function TradeForm({ trade, onSave, onClose, editMode, brokers, addBroker, removeBroker }) {
  const entryPrice = trade?.price;
  const initialStopType = trade?.stop_loss != null && entryPrice ? 'price' : 'price';

  const [f, setF] = useState(() => ({
    tag: trade?.tag || TAGS[0],
    client_name: trade?.client_name || '',
    client_account: trade?.client_account || '',
    broker: trade?.broker || brokers[0]?.id || 'PPI',
    trade_date: trade?.trade_date ? trade.trade_date.slice(0, 10) : new Date().toISOString().slice(0, 10),
    ticker: trade?.ticker || '',
    price: trade?.price ?? '',
    quantity: trade?.quantity ?? 100,
    commission: trade?.commission ?? DEFAULT_COMM_PCT,
    market_fee: trade?.market_fee ?? DEFAULT_DRX_PCT,
    target_type: trade?.target_type || 'price',
    target_value: trade?.target_value ?? '',
    stop_mode: 'price', // 'price' | 'pct' — input helper only, we always save stop_loss as absolute price
    stop_loss: trade?.stop_loss ?? '',
    stop_pct: '',
    notes: trade?.notes || '',
  }));
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState(null);
  const [showAddBroker, setShowAddBroker] = useState(false);
  const [newBroker, setNewBroker] = useState({ label: '', color: BROKER_COLORS[2] });
  const up = (k, v) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => {
    if (editMode) return;
    if (!f.ticker || f.ticker.length < 2) { setValidation(null); return; }
    const h = setTimeout(async () => {
      setValidating(true);
      try {
        const r = await fetch(`${API}/api/primary/validate?ticker=${encodeURIComponent(f.ticker)}&settlement=${DEFAULT_SETTLEMENT}`);
        const d = await r.json();
        setValidation(d);
      } catch { setValidation({ valid: false, error: 'Error validando' }); }
      finally { setValidating(false); }
    }, 400);
    return () => clearTimeout(h);
  }, [f.ticker, editMode]);

  // Derived preview: target price from yield
  const priceNum = Number(f.price) || null;
  const targetPreview = useMemo(() => {
    if (f.target_type !== 'yield' || f.target_value === '' || !priceNum) return null;
    return priceNum * (1 + Number(f.target_value) / 100);
  }, [f.target_type, f.target_value, priceNum]);

  // Derived preview: stop price from pct loss
  const stopPreview = useMemo(() => {
    if (f.stop_mode !== 'pct' || f.stop_pct === '' || !priceNum) return null;
    return priceNum * (1 - Math.abs(Number(f.stop_pct)) / 100);
  }, [f.stop_mode, f.stop_pct, priceNum]);

  const submitAddBroker = () => {
    const label = newBroker.label.trim().toUpperCase();
    if (!label) return;
    if (brokers.find(b => b.id === label)) { alert('Ese broker ya existe.'); return; }
    addBroker({ id: label, label, color: newBroker.color });
    up('broker', label);
    setShowAddBroker(false);
    setNewBroker({ label: '', color: BROKER_COLORS[2] });
  };

  const submit = async e => {
    e?.preventDefault();
    if (!f.ticker || !f.price) return;
    if (!editMode) {
      if (!validation?.valid) { alert(`Ticker "${f.ticker}" no está disponible en Primary en plazo A-24HS.\n\nVerificá que el símbolo sea correcto y exista en el mercado.`); return; }
      await fetch(`${API}/api/primary/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: f.ticker, settlement: DEFAULT_SETTLEMENT }) }).catch(() => {});
    }
    // Compute actual stop price depending on mode
    const stopFinal = (() => {
      if (f.stop_mode === 'pct') {
        if (f.stop_pct === '' || !priceNum) return null;
        return priceNum * (1 - Math.abs(Number(f.stop_pct)) / 100);
      }
      return f.stop_loss === '' ? null : Number(f.stop_loss);
    })();
    const data = {
      tag: f.tag, client_name: f.client_name, client_account: f.client_account, broker: f.broker, trade_date: f.trade_date,
      settlement: DEFAULT_SETTLEMENT, ticker: f.ticker.toUpperCase(),
      price: Number(f.price), quantity: Number(f.quantity),
      commission: f.commission === '' ? 0 : Number(f.commission),
      market_fee: f.market_fee === '' ? 0 : Number(f.market_fee),
      target_type: f.target_type,
      target_value: f.target_value === '' ? null : Number(f.target_value),
      stop_loss: stopFinal,
      notes: f.notes,
    };
    onSave(data);
  };

  const tickerStatus = editMode ? null : validating ? { icon: '⟳', color: 'var(--text-dim)', text: 'Validando...' }
    : validation?.valid ? { icon: '✓', color: GREEN, text: 'Ticker válido' }
    : validation && !validation.valid && f.ticker ? { icon: '✕', color: RED, text: 'No encontrado en Primary A-24HS' }
    : null;

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <form style={S.modal} onSubmit={submit}>
        <div style={S.modalHeader}>
          <span style={S.modalTitle}>{editMode ? 'EDITAR TRADE' : 'NUEVO TRADE'}</span>
          <button type="button" style={S.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={S.modalBody}>
          <div style={S.formRow}>
            <F l="Etiqueta" req><select style={S.input} value={f.tag} onChange={e => up('tag', e.target.value)}>{TAGS.map(t => <option key={t}>{t}</option>)}</select></F>
            <F l="Broker" req>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {brokers.map(b => {
                  const isDefault = !!DEFAULT_BROKERS.find(d => d.id === b.id);
                  const active = f.broker === b.id;
                  return (
                    <div key={b.id} style={{ position: 'relative' }}>
                      <button type="button" onClick={() => up('broker', b.id)} style={{ ...S.brokerBtn, borderColor: active ? b.color : 'var(--border)', color: active ? b.color : 'var(--text-dim)', background: active ? `${b.color}15` : 'transparent', paddingRight: isDefault ? 12 : 22 }}>{b.label}</button>
                      {!isDefault && (
                        <span
                          onClick={(e) => { e.stopPropagation(); if (confirm(`¿Eliminar broker "${b.label}"?`)) { if (f.broker === b.id) up('broker', DEFAULT_BROKERS[0].id); removeBroker(b.id); } }}
                          title="Eliminar broker"
                          style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 11, lineHeight: 1, padding: 2 }}
                        >×</span>
                      )}
                    </div>
                  );
                })}
                <button type="button" onClick={() => setShowAddBroker(v => !v)} style={{ ...S.brokerBtn, borderStyle: 'dashed', color: 'var(--text-dim)' }}>＋</button>
              </div>
              {showAddBroker && (
                <div style={{ marginTop: 8, padding: 10, border: '1px dashed var(--border)', borderRadius: 4, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input style={{ ...S.input, flex: '1 1 120px', textTransform: 'uppercase' }} value={newBroker.label} onChange={e => setNewBroker(p => ({ ...p, label: e.target.value.toUpperCase() }))} placeholder="NOMBRE" />
                  <div style={{ display: 'flex', gap: 4 }}>
                    {BROKER_COLORS.map(c => (
                      <div key={c} onClick={() => setNewBroker(p => ({ ...p, color: c }))} style={{ width: 22, height: 22, borderRadius: 3, background: c, cursor: 'pointer', border: newBroker.color === c ? '2px solid var(--text)' : '2px solid transparent' }} />
                    ))}
                  </div>
                  <button type="button" onClick={submitAddBroker} style={{ ...S.btnPrimary, padding: '6px 14px', fontSize: 10 }}>AGREGAR</button>
                </div>
              )}
            </F>
          </div>
          <div style={S.formRow}>
            <F l="Cliente" req><input style={S.input} value={f.client_name} onChange={e => up('client_name', e.target.value)} placeholder="Nombre" /></F>
            <F l="Nº Cuenta"><input style={S.input} value={f.client_account} onChange={e => up('client_account', e.target.value)} placeholder="001234" /></F>
          </div>
          <div style={S.formRow}>
            <F l="Ticker (Primary A-24HS)" req>
              <div style={{ position: 'relative' }}>
                <input style={{ ...S.input, textTransform: 'uppercase', paddingRight: 40, borderColor: tickerStatus?.color === RED ? RED : tickerStatus?.color === GREEN ? GREEN : 'var(--border)' }} value={f.ticker} onChange={e => up('ticker', e.target.value.toUpperCase())} placeholder="AL30D" disabled={editMode} />
                {tickerStatus && (
                  <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: tickerStatus.color, fontSize: 14, fontWeight: 700 }} title={tickerStatus.text}>{tickerStatus.icon}</span>
                )}
              </div>
              {tickerStatus && <div style={{ fontSize: 10, color: tickerStatus.color, marginTop: 3, fontFamily: "'Roboto Mono',monospace" }}>{tickerStatus.text}{validation?.symbol ? ` · ${validation.symbol}` : ''}</div>}
            </F>
            <F l="Fecha" req><input type="date" style={S.input} value={f.trade_date} onChange={e => up('trade_date', e.target.value)} /></F>
          </div>
          <div style={S.formRow}>
            <F l="Precio entrada" req><input type="number" step="0.01" style={S.input} value={f.price} onChange={e => up('price', e.target.value)} placeholder="0.00" /></F>
            <F l="Cantidad (nominales)"><input type="number" step="1" style={S.input} value={f.quantity} onChange={e => up('quantity', e.target.value)} placeholder="100" /></F>
            <F l="Comisión % (por trade)">
              <div style={{ position: 'relative' }}>
                <input
                  type="number" step="0.05" min="0" max="10"
                  style={{ ...S.input, paddingRight: 24 }}
                  value={f.commission}
                  onChange={e => up('commission', e.target.value === '' ? '' : Math.max(0, Math.min(10, parseFloat(e.target.value) || 0)))}
                  placeholder="0.60"
                />
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace", fontSize: 11 }}>%</span>
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 3, fontFamily: "'Roboto Mono',monospace" }}>se aplica a la compra (+) y a la venta (−)</div>
            </F>
            <F l={<span style={{ display: 'inline-flex', alignItems: 'center' }}>Derecho de mercado %<DrxHelp /></span>}>
              <div style={{ position: 'relative' }}>
                <input
                  type="number" step="0.001" min="0" max="1"
                  style={{ ...S.input, paddingRight: 24 }}
                  value={f.market_fee}
                  onChange={e => up('market_fee', e.target.value === '' ? '' : Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)))}
                  placeholder="0.010"
                />
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace", fontSize: 11 }}>%</span>
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 3, fontFamily: "'Roboto Mono',monospace" }}>ByMA 24H · se suma a la comisión en ambas patas</div>
            </F>
          </div>
          <div style={S.formRow}>
            <F l="Tipo objetivo">
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => up('target_type', 'price')} style={{ ...S.toggleBtn, ...(f.target_type === 'price' ? S.toggleActive : {}) }}>PRECIO</button>
                <button type="button" onClick={() => up('target_type', 'yield')} style={{ ...S.toggleBtn, ...(f.target_type === 'yield' ? S.toggleActive : {}) }}>REND. %</button>
              </div>
            </F>
            <F l={f.target_type === 'price' ? 'Precio objetivo' : 'Rendimiento objetivo (%)'}>
              <input type="number" step="0.01" style={S.input} value={f.target_value} onChange={e => up('target_value', e.target.value)} placeholder={f.target_type === 'price' ? '0.00' : '5.00'} />
              {f.target_type === 'yield' && targetPreview != null && (
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3, fontFamily: "'Roboto Mono',monospace" }}>→ precio objetivo: <b style={{ color: GREEN }}>${fmtN(targetPreview)}</b></div>
              )}
            </F>
          </div>
          <div style={S.formRow}>
            <F l="Tipo stop loss">
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => up('stop_mode', 'price')} style={{ ...S.toggleBtn, ...(f.stop_mode === 'price' ? S.toggleActive : {}) }}>PRECIO ($)</button>
                <button type="button" onClick={() => up('stop_mode', 'pct')} style={{ ...S.toggleBtn, ...(f.stop_mode === 'pct' ? S.toggleActive : {}) }}>% PÉRDIDA</button>
              </div>
            </F>
            <F l={f.stop_mode === 'price' ? 'Stop loss ($)' : 'Pérdida máxima (%)'}>
              {f.stop_mode === 'price'
                ? <input type="number" step="0.01" style={S.input} value={f.stop_loss} onChange={e => up('stop_loss', e.target.value)} placeholder="—" />
                : <input type="number" step="0.01" min="0" style={S.input} value={f.stop_pct} onChange={e => up('stop_pct', e.target.value)} placeholder="3.00" />}
              {f.stop_mode === 'pct' && stopPreview != null && (
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3, fontFamily: "'Roboto Mono',monospace" }}>→ precio stop: <b style={{ color: RED }}>${fmtN(stopPreview)}</b></div>
              )}
            </F>
          </div>
          <F l="Notas"><textarea style={{ ...S.input, resize: 'vertical', minHeight: 56, fontFamily: 'inherit' }} value={f.notes} onChange={e => up('notes', e.target.value)} placeholder="Opcional" /></F>
        </div>
        <div style={S.modalFooter}>
          <button type="button" style={S.btnSecondary} onClick={onClose}>CANCELAR</button>
          <button type="submit" style={{ ...S.btnPrimary, opacity: (!f.ticker || !f.price || (!editMode && !validation?.valid)) ? 0.4 : 1 }} disabled={!f.ticker || !f.price || (!editMode && !validation?.valid)}>{editMode ? 'GUARDAR' : 'CREAR TRADE'}</button>
        </div>
      </form>
    </div>
  );
}

function F({ l, req, children }) {
  return (
    <div style={{ flex: 1, minWidth: 120 }}>
      <label style={S.formLabel}>{l}{req && <span style={{ color: RED }}> *</span>}</label>
      {children}
    </div>
  );
}

// Tooltip con la tabla de derechos de mercado (ByMA) a 24H por tipo de activo.
// El popup se renderiza vía portal a <body> con position: fixed para escapar
// del overflow del modal padre. Sin portal, el modal se pone a hacer scroll
// tratando de "acomodar" el tooltip y rompe el layout.
function DrxHelp() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null); // { top, left } en coords de viewport
  const wrapRef = useRef(null);
  const POP_W = 280;        // debe coincidir con helpPop.width
  const POP_H_APROX = 240;  // alto estimado del popup (p/ decidir si va arriba o abajo)

  const rows = [
    { k: 'Soberanos (Públicos)',    v: '0,01 %',  hint: 'AL30, GD30, etc.' },
    { k: 'Subsoberanos (Públicos)', v: '0,01 %',  hint: 'PBA, CABA, prov.' },
    { k: 'Letras',                  v: '0,001 %', hint: 'LEDES, LECAPs' },
    { k: 'ON (Corporativos)',       v: '0,08 %',  hint: 'Obligaciones negociables' },
    { k: 'CEDEARs / Acciones',      v: '0,05 %',  hint: 'Privados (renta variable)' },
  ];

  // Al abrir, capturamos la posición del botón y decidimos:
  //  - Horizontal: centrado si entra, sino pegamos al borde derecho/izquierdo
  //    del viewport con un margen de 8px.
  //  - Vertical: debajo del botón, pero si no hay espacio abajo lo mandamos
  //    arriba.
  const openWithPos = () => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) {
      const centered = rect.left + rect.width / 2 - POP_W / 2;
      const left = Math.max(8, Math.min(centered, window.innerWidth - POP_W - 8));
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow < POP_H_APROX + 12
        ? Math.max(8, rect.top - POP_H_APROX - 8)
        : rect.bottom + 8;
      setPos({ top, left });
    }
    setOpen(true);
  };
  const close = () => setOpen(false);

  return (
    <span
      ref={wrapRef}
      style={S.helpWrap}
      onMouseEnter={openWithPos}
      onMouseLeave={close}
      onFocus={openWithPos}
      onBlur={close}
      tabIndex={0}
      aria-label="Ver tabla de derechos de mercado"
    >
      <span style={S.helpBtn}>?</span>
      {open && pos && createPortal(
        <div
          style={{ ...S.helpPop, top: pos.top, left: pos.left }}
          role="tooltip"
        >
          <div style={S.helpTitle}>DERECHOS DE MERCADO · PLAZO 24H</div>
          <div style={S.helpTable}>
            {rows.map((r, i) => (
              <div key={i} style={S.helpRow}>
                <div>
                  <div style={S.helpK}>{r.k}</div>
                  <div style={S.helpHint}>{r.hint}</div>
                </div>
                <div style={S.helpV}>{r.v}</div>
              </div>
            ))}
          </div>
          <div style={S.helpFoot}>
            Alícuota aplicada sobre el monto efectivo de cada operación (compra o venta). Valores referenciales de ByMA — pueden variar en otros plazos (48h, 72h).
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}

// ══════════════════════════════════════════════
//  DETAIL
// ══════════════════════════════════════════════
function TradeDetail({ trade, quote, brokers, onClose, onFlyer }) {
  const commPct = tradeComm(trade);
  const drxPct  = tradeDrx(trade);
  const feePct  = commPct + drxPct;
  const m = computeMetrics(trade, quote?.price, commPct, drxPct);
  const priceColor = quote?.price == null ? 'var(--text-dim)' : (quote.price >= trade.price ? GREEN : RED);
  const grossTotal = m ? m.grossRetAbs * trade.quantity : null;
  const netTotal = m ? m.netRetAbs * trade.quantity : null;
  const buyCommAmount  = trade.price != null && trade.quantity != null ? (trade.price * trade.quantity * feePct / 100) : 0;
  const sellCommAmount = quote?.price != null && trade.quantity != null ? (quote.price * trade.quantity * feePct / 100) : null;
  const totalOperado = trade.price != null && trade.quantity != null ? (trade.price * trade.quantity + buyCommAmount) : null;
  const tgtPrice = resolveTargetPrice(trade);
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        <div style={S.modalHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={S.ticker}>{trade.ticker}</span>
            <span style={{ ...S.tagBadge, background: `${brokerColor(brokers, trade.broker)}22`, color: brokerColor(brokers, trade.broker), borderColor: brokerColor(brokers, trade.broker) }}>{trade.broker}</span>
            {trade.tag && <span style={S.tagPill}>{trade.tag}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button style={S.toolBtn} onClick={onFlyer}>📷 FLYER</button>
            <button style={S.closeBtn} onClick={onClose}>✕</button>
          </div>
        </div>
        <div style={S.modalBody}>
          <div style={S.detGrid}>
            <DR l="Cliente" v={trade.client_name} />
            <DR l="Nº Cuenta" v={trade.client_account || '—'} />
            <DR l="Fecha entrada" v={fmtDate(trade.trade_date)} />
            <DR l="Settlement" v={trade.settlement || DEFAULT_SETTLEMENT} />
            <DR l="Precio entrada" v={`$${fmtN(trade.price)}`} />
            <DR l="Precio actual" v={quote?.price != null ? `$${fmtN(quote.price)}` : '...'} color={priceColor} />
            <DR l="Cantidad (nominales)" v={fmtN(trade.quantity, 0)} />
            <DR l="Comisión compra" v={`${fmtN(commPct)}% + ${fmtN(drxPct, 3)}% DRX ($${fmtN(buyCommAmount)})`} />
            <DR l="Comisión venta"  v={sellCommAmount != null ? `${fmtN(commPct)}% + ${fmtN(drxPct, 3)}% DRX ($${fmtN(sellCommAmount)})` : `${fmtN(commPct)}% + ${fmtN(drxPct, 3)}% DRX`} />
            <DR l="Total operado (compra)" v={totalOperado != null ? `$${fmtN(totalOperado)}` : '—'} />
            <DR l="Objetivo" v={tgtPrice != null ? `$${fmtN(tgtPrice)}${trade.target_type === 'yield' ? ` (${fmtN(trade.target_value)}%)` : ''}` : '—'} color={tgtPrice != null ? GREEN : 'var(--text)'} />
            <DR l="Stop loss" v={trade.stop_loss != null ? `$${fmtN(trade.stop_loss)}` : '—'} color={trade.stop_loss != null ? RED : 'var(--text)'} />
          </div>

          {m && (
            <div style={S.sec}>
              <div style={S.secT}>MÉTRICAS DE RENDIMIENTO</div>
              <div style={S.metricsRow}>
                <Metric l="Rend. % bruto" v={fmtPct(m.grossRetPct)} color={signColor(m.grossRetPct)} />
                <Metric l="Rend. % neto" v={fmtPct(m.netRetPct)} color={signColor(m.netRetPct)} />
                <Metric l="Resultado bruto" v={`${grossTotal >= 0 ? '+' : ''}$${fmtN(grossTotal)}`} color={signColor(grossTotal)} />
                <Metric l="Resultado neto" v={`${netTotal >= 0 ? '+' : ''}$${fmtN(netTotal)}`} color={signColor(netTotal)} />
                <Metric l="Días" v={m.days} />
                {m.targetRemPct != null && <Metric l="Falta al objetivo" v={fmtPct(m.targetRemPct)} color={m.targetRemPct > 0 ? 'var(--text)' : GREEN} />}
                {m.stopDistPct != null && <Metric l="Dist. stop" v={fmtPct(m.stopDistPct)} color={m.stopDistPct > 5 ? 'var(--text)' : RED} />}
              </div>
              {m.stopHit && <div style={{ ...S.stopHitBar, marginTop: 12 }}>⚠ STOP LOSS ALCANZADO — Precio actual ${fmtN(quote?.price)} ≤ stop ${fmtN(trade.stop_loss)}</div>}
            </div>
          )}

          <div style={S.sec}>
            <div style={S.secT}>PROGRESO: STOP → ENTRY → TARGET</div>
            <ProgressBar trade={trade} quote={quote?.price} />
          </div>

          {trade.notes && (
            <div style={S.sec}>
              <div style={S.secT}>NOTAS</div>
              <div style={{ fontSize: 12, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{trade.notes}</div>
            </div>
          )}

          {quote?.ts && <div style={S.detFooter}>Cotización WebSocket · última actualización: {new Date(quote.ts).toLocaleTimeString('es-AR')}</div>}
        </div>
      </div>
    </div>
  );
}

function DR({ l, v, color }) {
  return (
    <div style={S.detRow}>
      <span style={S.detL}>{l}</span>
      <span style={{ ...S.detV, color: color || 'var(--text)' }}>{v}</span>
    </div>
  );
}

// ══════════════════════════════════════════════
//  FLYER — single trade
// ══════════════════════════════════════════════
function TradeFlyer({ trade, quote, brokers, onClose }) {
  const commPct = tradeComm(trade);
  const drxPct  = tradeDrx(trade);
  const feePct  = commPct + drxPct;
  const ref = useRef(null);
  const [dl, setDl] = useState(false);
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'dark');
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(document.documentElement.getAttribute('data-theme') || 'dark'));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
  const logoSrc = theme === 'dark' ? '/logos/DG%20tema%20oscuro.png' : '/logos/DG-tema-claro.svg';

  const m = computeMetrics(trade, quote?.price, commPct, drxPct);
  const grossTotal = m ? m.grossRetAbs * trade.quantity : null;
  const netTotal = m ? m.netRetAbs * trade.quantity : null;
  const buyCommAmount = trade.price != null && trade.quantity != null ? (trade.price * trade.quantity * feePct / 100) : 0;
  const totalOperado = trade.price != null && trade.quantity != null ? (trade.price * trade.quantity + buyCommAmount) : null;
  const tgtPrice = resolveTargetPrice(trade);

  const cap = async (a) => {
    setDl(true);
    try {
      const h2c = await loadH2C();
      await new Promise(r => setTimeout(r, 50));
      const canvas = await h2c(ref.current, { backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0a0a0a', scale: 2, useCORS: true, logging: false });
      if (a === 'download') {
        const l = document.createElement('a');
        l.download = `trade-${trade.ticker}-${new Date().toISOString().slice(0, 10)}.png`;
        l.href = canvas.toDataURL('image/png');
        l.click();
      } else {
        canvas.toBlob(b => { if (b) navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); });
      }
    } catch (e) { alert(e.message); } finally { setDl(false); }
  };

  return (
    <div style={S.flyerOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width: '100%', maxWidth: 720 }}>
        <div style={S.flyerControls}>
          <span style={{ color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace", fontSize: 11 }}>{trade.ticker} · {trade.client_name}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={S.flyerBtn} onClick={() => cap('download')} disabled={dl}>{dl ? '...' : '⬇ Descargar'}</button>
            <button style={S.flyerBtn} onClick={() => cap('copy')} disabled={dl}>{dl ? '...' : '📋 Copiar'}</button>
            <button style={{ ...S.flyerBtn, color: RED }} onClick={onClose}>✕</button>
          </div>
        </div>
        <div ref={ref} style={{ background: 'var(--bg)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
          <div style={{ padding: '24px 24px 16px', borderBottom: '2px solid var(--neon)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
              <img src={logoSrc} alt="Delfino Gaviña" crossOrigin="anonymous" style={{ height: 48, width: 'auto', display: 'block', flexShrink: 0 }} />
              <div style={{ fontFamily: "'Roboto Mono',monospace", fontSize: 11, color: 'var(--text-dim)' }}>{new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
            </div>
            <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: 6, color: 'var(--neon)', textAlign: 'center', marginTop: 14 }}>TRADE TRACKING</div>
          </div>

          <div style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
              <span style={{ ...S.ticker, fontSize: 22 }}>{trade.ticker}</span>
              <span style={{ ...S.tagBadge, background: `${brokerColor(brokers, trade.broker)}22`, color: brokerColor(brokers, trade.broker), borderColor: brokerColor(brokers, trade.broker), fontSize: 10 }}>{trade.broker}</span>
              {trade.tag && <span style={{ ...S.tagPill, fontSize: 10 }}>{trade.tag}</span>}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace" }}>{trade.client_name}{trade.client_account ? ` · ${trade.client_account}` : ''}</span>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'Roboto Mono',monospace", fontSize: 12, marginBottom: 16 }}>
              <tbody>
                <tr>
                  <td style={S.flyerKV}>Fecha entrada</td><td style={S.flyerKVv}>{fmtDate(trade.trade_date)}</td>
                  <td style={S.flyerKV}>Precio entrada</td><td style={S.flyerKVv}>${fmtN(trade.price)}</td>
                </tr>
                <tr>
                  <td style={S.flyerKV}>Cantidad</td><td style={S.flyerKVv}>{fmtN(trade.quantity, 0)}</td>
                  <td style={S.flyerKV}>Total operado</td><td style={S.flyerKVv}>{totalOperado != null ? `$${fmtN(totalOperado)}` : '—'}</td>
                </tr>
                <tr>
                  <td style={S.flyerKV}>Precio actual</td><td style={{ ...S.flyerKVv, color: quote?.price != null ? (quote.price >= trade.price ? GREEN : RED) : 'var(--text)', fontWeight: 700 }}>{quote?.price != null ? `$${fmtN(quote.price)}` : '—'}</td>
                  <td style={S.flyerKV}>Días</td><td style={S.flyerKVv}>{m?.days ?? '—'}</td>
                </tr>
                <tr>
                  <td style={S.flyerKV}>Objetivo</td><td style={{ ...S.flyerKVv, color: GREEN }}>{tgtPrice != null ? `$${fmtN(tgtPrice)}${trade.target_type === 'yield' ? ` (${fmtN(trade.target_value)}%)` : ''}` : '—'}</td>
                  <td style={S.flyerKV}>Stop loss</td><td style={{ ...S.flyerKVv, color: trade.stop_loss != null ? RED : 'var(--text)' }}>{trade.stop_loss != null ? `$${fmtN(trade.stop_loss)}` : '—'}</td>
                </tr>
              </tbody>
            </table>

            {m && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 3, color: 'var(--neon)', marginBottom: 10 }}>RENDIMIENTO</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
                  <Metric l="Rend. % bruto" v={fmtPct(m.grossRetPct)} color={signColor(m.grossRetPct)} />
                  <Metric l="Rend. % neto" v={fmtPct(m.netRetPct)} color={signColor(m.netRetPct)} />
                  <Metric l="Resultado bruto" v={`${grossTotal >= 0 ? '+' : ''}$${fmtN(grossTotal)}`} color={signColor(grossTotal)} />
                  <Metric l="Resultado neto" v={`${netTotal >= 0 ? '+' : ''}$${fmtN(netTotal)}`} color={signColor(netTotal)} />
                </div>
                <ProgressBar trade={trade} quote={quote?.price} />
              </>
            )}

            {trade.notes && (
              <div style={{ marginTop: 16, padding: 12, background: 'var(--row-alt)', borderRadius: 4, fontSize: 11, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{trade.notes}</div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 24px', borderTop: '1px solid var(--border)', fontFamily: "'Roboto Mono',monospace", fontSize: 9, color: 'var(--text-dim)' }}>
            <span>Fuente: Primary · WebSocket · A-24HS</span>
            <span>Actualizado: {new Date().toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
//  STYLES
// ══════════════════════════════════════════════
const S = {
  topRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' },
  filterLbl: { fontFamily: "'Roboto Mono',monospace", fontSize: 9, letterSpacing: 2, color: 'var(--text-dim)' },
  filterBtn: { background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace", fontSize: 10, fontWeight: 500, letterSpacing: 1, padding: '6px 12px', cursor: 'pointer' },
  filterBtnActive: { color: 'var(--neon)', borderColor: 'var(--neon)', background: 'rgba(0,255,170,0.05)' },

  liveDot: { display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: "'Roboto Mono',monospace", fontSize: 9, fontWeight: 700, letterSpacing: 1.5, padding: '5px 10px', borderRadius: 3, border: '1px solid', color: 'var(--bg)', background: 'transparent' },
  liveDotInner: { width: 6, height: 6, borderRadius: '50%', animation: 'pulse-neon 1s ease infinite' },

  toolBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace", fontSize: 10, fontWeight: 500, letterSpacing: 1, padding: '6px 12px', cursor: 'pointer' },
  addBtn: { background: 'none', border: '1px solid var(--neon)', borderRadius: 3, color: 'var(--neon)', fontFamily: "'Roboto Mono',monospace", fontSize: 10, fontWeight: 700, letterSpacing: 2, padding: '6px 14px', cursor: 'pointer' },

  alertBox: { background: 'rgba(255,59,59,0.08)', border: '1px solid rgba(255,59,59,0.3)', borderRadius: 4, padding: '10px 16px', fontSize: 12, color: 'var(--red)', marginBottom: 16, fontFamily: "'Roboto Mono',monospace" },

  rowList: { display: 'flex', flexDirection: 'column', gap: 4 },
  rowHeader: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px 8px 15px', borderBottom: '1px solid var(--border-neon)', background: 'var(--th-bg)', fontFamily: "'Roboto',sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--neon)', textTransform: 'uppercase', borderRadius: '4px 4px 0 0' },
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', transition: 'background 0.12s, border-color 0.12s', fontFamily: "'Roboto Mono',monospace", fontSize: 11 },
  col: { overflow: 'hidden', textOverflow: 'ellipsis' },
  colTicker: { flex: '0 0 130px', display: 'flex', alignItems: 'center', gap: 8 },
  colTag: { flex: '0 0 60px' },
  colClient: { flex: '1 1 160px', minWidth: 120 },
  colDate: { flex: '0 0 90px', color: 'var(--text-dim)' },
  colNum: { flex: '1 1 70px', textAlign: 'right', minWidth: 60 },
  colActions: { flex: '0 0 64px', display: 'flex', gap: 4, justifyContent: 'flex-end' },

  rowTicker: { fontFamily: "'Roboto Mono',monospace", fontSize: 13, fontWeight: 700, color: 'var(--neon)', textShadow: 'var(--neon-glow)', letterSpacing: '0.05em' },
  rowBroker: { fontSize: 8, fontWeight: 700, letterSpacing: 1, padding: '2px 5px', borderRadius: 2, border: '1px solid', fontFamily: "'Roboto Mono',monospace" },
  rowClient: { fontSize: 11, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  rowAcct: { fontSize: 9, color: 'var(--text-dim)', marginTop: 1 },

  ticker: { fontFamily: "'Roboto Mono',monospace", fontSize: 15, fontWeight: 700, color: 'var(--neon)', textShadow: 'var(--neon-glow)', letterSpacing: '0.05em' },
  tagBadge: { fontSize: 9, fontWeight: 700, letterSpacing: 1.5, padding: '2px 6px', borderRadius: 3, border: '1px solid', fontFamily: "'Roboto Mono',monospace" },
  tagPill: { fontSize: 9, fontWeight: 700, letterSpacing: 1.5, padding: '2px 6px', borderRadius: 3, background: 'var(--border)', color: 'var(--text)', fontFamily: "'Roboto Mono',monospace" },
  iconBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', fontSize: 11, width: 24, height: 24, cursor: 'pointer', lineHeight: 1 },

  metricsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8, marginBottom: 4 },
  metric: { background: 'var(--row-alt)', borderRadius: 3, padding: '6px 8px', textAlign: 'center' },
  metricL: { fontSize: 8, fontWeight: 700, letterSpacing: 1.5, color: 'var(--text-dim)', marginBottom: 3, textTransform: 'uppercase' },
  metricV: { fontFamily: "'Roboto Mono',monospace", fontSize: 12, fontWeight: 700 },

  stopHitBar: { marginTop: 10, padding: '6px 10px', background: 'rgba(255,59,59,0.12)', border: '1px solid rgba(255,59,59,0.4)', borderRadius: 3, color: 'var(--red)', fontSize: 10, fontWeight: 700, letterSpacing: 1, textAlign: 'center' },

  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto', backdropFilter: 'blur(4px)' },
  modal: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, width: '100%', maxWidth: 720, fontFamily: "'Roboto',sans-serif", boxShadow: '0 20px 60px rgba(0,0,0,0.5)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--th-bg)' },
  modalTitle: { fontSize: 11, fontWeight: 700, letterSpacing: 3, color: 'var(--neon)' },
  closeBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-dim)', fontSize: 12, width: 28, height: 28, cursor: 'pointer' },
  modalBody: { padding: 20, maxHeight: '75vh', overflowY: 'auto' },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--border)' },

  formRow: { display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' },
  formLabel: { display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--text-dim)', marginBottom: 5, textTransform: 'uppercase' },

  helpWrap: { position: 'relative', display: 'inline-flex', alignItems: 'center', marginLeft: 4, cursor: 'help', outline: 'none' },
  helpBtn: { width: 14, height: 14, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace", fontSize: 9, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 },
  // helpPop se renderiza via portal a <body>. position: fixed + top/left
  // inyectados dinámicamente desde DrxHelp vía getBoundingClientRect(). Así
  // el tooltip no hereda el overflow/scroll del modal padre y nunca lo rompe.
  helpPop: { position: 'fixed', zIndex: 10050, width: 280, background: 'var(--bg-card)', border: '1px solid var(--border-neon)', borderRadius: 5, padding: '10px 12px', boxShadow: '0 6px 24px rgba(0,0,0,0.55)', pointerEvents: 'none' },
  helpTitle: { fontFamily: "'Roboto',sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--neon)', textTransform: 'uppercase', marginBottom: 8, textAlign: 'center' },
  helpTable: { display: 'flex', flexDirection: 'column' },
  helpRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '5px 0', borderBottom: '1px solid rgba(128,128,128,0.12)', gap: 10 },
  helpK: { fontFamily: "'Roboto Mono',monospace", fontSize: 10, fontWeight: 700, color: 'var(--text)', letterSpacing: 0.3 },
  helpHint: { fontFamily: "'Roboto Mono',monospace", fontSize: 8, color: 'var(--text-dim)', opacity: 0.7, marginTop: 1 },
  helpV: { fontFamily: "'Roboto Mono',monospace", fontSize: 11, fontWeight: 700, color: 'var(--neon)', whiteSpace: 'nowrap' },
  helpFoot: { fontFamily: "'Roboto Mono',monospace", fontSize: 8, color: 'var(--text-dim)', letterSpacing: 0.3, lineHeight: 1.4, opacity: 0.75, marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(128,128,128,0.15)' },

  input: { width: '100%', background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)', fontFamily: "'Roboto Mono',monospace", fontSize: 12, padding: '8px 10px', outline: 'none', boxSizing: 'border-box' },
  brokerBtn: { background: 'transparent', border: '1.5px solid var(--border)', borderRadius: 3, fontFamily: "'Roboto Mono',monospace", fontSize: 11, fontWeight: 700, letterSpacing: 2, padding: '8px 12px', cursor: 'pointer', transition: 'all 0.15s' },
  toggleBtn: { flex: 1, padding: '8px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1.5, cursor: 'pointer' },
  toggleActive: { color: 'var(--neon)', borderColor: 'var(--neon)', background: 'rgba(0,255,170,0.05)' },

  btnPrimary: { background: 'transparent', color: 'var(--neon)', border: '1px solid var(--neon)', borderRadius: 4, padding: '9px 18px', fontFamily: "'Roboto',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 2, cursor: 'pointer' },
  btnSecondary: { background: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 4, padding: '9px 18px', fontFamily: "'Roboto',sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: 2, cursor: 'pointer' },

  sec: { marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' },
  secT: { fontSize: 10, fontWeight: 700, letterSpacing: 3, color: 'var(--neon)', marginBottom: 10, textTransform: 'uppercase' },
  detGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' },
  detRow: { display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(128,128,128,0.08)', gap: 10 },
  detL: { fontSize: 11, color: 'var(--text-dim)' },
  detV: { fontSize: 12, fontFamily: "'Roboto Mono',monospace", fontWeight: 500, textAlign: 'right' },
  detFooter: { marginTop: 14, fontSize: 10, color: 'var(--text-dim)', textAlign: 'right', letterSpacing: 1, fontFamily: "'Roboto Mono',monospace" },

  flyerOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10001, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 20, overflowY: 'auto', backdropFilter: 'blur(4px)' },
  flyerControls: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap', width: '100%' },
  flyerBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontFamily: "'Roboto Mono',monospace", fontSize: 11, fontWeight: 500, padding: '8px 16px', cursor: 'pointer', whiteSpace: 'nowrap' },
  flyerKV: { padding: '7px 8px', color: 'var(--text-dim)', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', borderBottom: '1px solid rgba(128,128,128,0.08)', width: '22%' },
  flyerKVv: { padding: '7px 8px', color: 'var(--text)', fontSize: 12, fontFamily: "'Roboto Mono',monospace", borderBottom: '1px solid rgba(128,128,128,0.08)', width: '28%' },
};

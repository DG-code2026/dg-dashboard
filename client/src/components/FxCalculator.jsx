import { useState, useEffect, useMemo } from 'react';

export default function FxCalculator({ rates, commission, onClose }) {
  const [pair, setPair] = useState('mep');
  const [dir, setDir] = useState('compra');
  const [inputSide, setInputSide] = useState('from');
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const config = useMemo(() => {
    const map = {
      'mep-compra':   { from: 'ARS',     to: 'USD MEP', mult: 1 / rates.mep.compra.con, displayRate: rates.mep.compra.con, isPct: false },
      'mep-venta':    { from: 'USD MEP', to: 'ARS',     mult: rates.mep.venta.con,      displayRate: rates.mep.venta.con,  isPct: false },
      'ccl-compra':   { from: 'ARS',     to: 'USD CCL', mult: 1 / rates.ccl.compra.con, displayRate: rates.ccl.compra.con, isPct: false },
      'ccl-venta':    { from: 'USD CCL', to: 'ARS',     mult: rates.ccl.venta.con,      displayRate: rates.ccl.venta.con,  isPct: false },
      'canje-compra': { from: 'USD MEP', to: 'USD CCL', mult: 1 + rates.canje.compra.con, displayRate: rates.canje.compra.con, isPct: true },
      'canje-venta':  { from: 'USD CCL', to: 'USD MEP', mult: 1 + rates.canje.venta.con,  displayRate: rates.canje.venta.con,  isPct: true },
    };
    return map[`${pair}-${dir}`];
  }, [pair, dir, rates]);

  const parsed = parseNum(inputValue);
  const mult = config?.mult;
  const other = (isFinite(parsed) && mult && isFinite(mult))
    ? (inputSide === 'from' ? parsed * mult : parsed / mult)
    : null;

  const fromStr = inputSide === 'from' ? inputValue : (other != null ? formatNum(other) : '');
  const toStr   = inputSide === 'to'   ? inputValue : (other != null ? formatNum(other) : '');

  const handleFromChange = e => { setInputSide('from'); setInputValue(sanitize(e.target.value)); };
  const handleToChange   = e => { setInputSide('to');   setInputValue(sanitize(e.target.value)); };
  const swap = () => { setDir(d => d === 'compra' ? 'venta' : 'compra'); };

  const sideColor = dir === 'compra' ? 'var(--neon)' : 'var(--red)';
  const sideBg = dir === 'compra' ? 'rgba(57,255,20,0.08)' : 'rgba(255,59,59,0.08)';

  const canjeLabel = pair === 'canje'
    ? (dir === 'compra' ? 'MEP → CCL' : 'CCL → MEP')
    : null;

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.popup}>
        <div style={S.header}>
          <span style={S.title}>CALCULADORA FX</span>
          <button style={S.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={S.body}>
          <div style={S.tabs}>
            {[
              { k: 'mep', label: 'DÓLAR MEP' },
              { k: 'ccl', label: 'DÓLAR CCL' },
              { k: 'canje', label: 'CANJE' },
            ].map(t => (
              <button
                key={t.k}
                style={{ ...S.tab, ...(pair === t.k ? S.tabActive : {}) }}
                onClick={() => setPair(t.k)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div style={S.dirRow}>
            <button
              style={{ ...S.dirBtn, ...(dir === 'compra' ? { color: 'var(--neon)', borderColor: 'var(--neon)', background: 'rgba(57,255,20,0.08)' } : {}) }}
              onClick={() => setDir('compra')}
            >
              COMPRA{canjeLabel && dir === 'compra' ? ` · ${canjeLabel}` : ''}
            </button>
            <button
              style={{ ...S.dirBtn, ...(dir === 'venta' ? { color: 'var(--red)', borderColor: 'var(--red)', background: 'rgba(255,59,59,0.08)' } : {}) }}
              onClick={() => setDir('venta')}
            >
              VENTA{canjeLabel && dir === 'venta' ? ` · ${canjeLabel}` : ''}
            </button>
          </div>

          <div style={S.field}>
            <span style={S.fieldLabel}>TENÉS</span>
            <div style={S.inputBox}>
              <input
                style={S.input}
                type="text"
                inputMode="decimal"
                value={fromStr}
                onChange={handleFromChange}
                placeholder="0"
              />
              <span style={S.unit}>{config.from}</span>
            </div>
          </div>

          <button style={S.swapBtn} onClick={swap} title="Invertir operación">⇅</button>

          <div style={S.field}>
            <span style={S.fieldLabel}>OBTENÉS</span>
            <div style={{ ...S.inputBox, borderColor: sideColor, background: sideBg }}>
              <input
                style={{ ...S.input, color: sideColor }}
                type="text"
                inputMode="decimal"
                value={toStr}
                onChange={handleToChange}
                placeholder="0"
              />
              <span style={{ ...S.unit, color: sideColor }}>{config.to}</span>
            </div>
          </div>

          <div style={S.rateInfo}>
            <div style={S.rateRow}>
              <span style={S.rateLabel}>Tasa con comisión</span>
              <span style={{ ...S.rateValue, color: sideColor }}>
                {config.isPct
                  ? `${config.displayRate >= 0 ? '+' : ''}${(config.displayRate * 100).toFixed(3)}%`
                  : `$${config.displayRate.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </span>
            </div>
            <div style={S.rateRow}>
              <span style={S.rateLabel}>Comisión aplicada</span>
              {/* Desde que unificamos el criterio, todas las operaciones
                  (MEP/CCL/CANJE) aplican la misma comisión en cada punta. */}
              <span style={S.rateValue}>{`${(commission * 100).toFixed(3)}% c/punta`}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function sanitize(s) {
  return String(s).replace(/[^\d.,]/g, '');
}

function parseNum(s) {
  if (s == null || s === '') return NaN;
  const str = String(s).trim();
  if (!str) return NaN;
  if (str.includes(',')) return parseFloat(str.replace(/\./g, '').replace(',', '.'));
  const periods = (str.match(/\./g) || []).length;
  if (periods > 1) return parseFloat(str.replace(/\./g, ''));
  return parseFloat(str);
}

function formatNum(n) {
  if (!isFinite(n)) return '';
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const S = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(2px)' },
  popup: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, width: '100%', maxWidth: 440, fontFamily: "'Roboto', sans-serif", boxShadow: '0 20px 60px rgba(0,0,0,0.5)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' },
  title: { fontSize: 11, fontWeight: 700, letterSpacing: 3, color: 'var(--neon)' },
  closeBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-dim)', fontSize: 12, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  body: { padding: 20, display: 'flex', flexDirection: 'column', gap: 14 },
  tabs: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 },
  tab: { padding: '8px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 2, cursor: 'pointer', transition: 'all 0.15s' },
  tabActive: { color: 'var(--text)', borderColor: 'var(--text)', background: 'rgba(255,255,255,0.04)' },
  dirRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 },
  dirBtn: { padding: '8px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 2, cursor: 'pointer', transition: 'all 0.15s' },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: { fontFamily: "'Roboto Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--text-dim)' },
  inputBox: { display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 6, padding: '0 12px', background: 'rgba(255,255,255,0.02)' },
  input: { flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontFamily: "'Roboto Mono', monospace", fontSize: 18, fontWeight: 600, padding: '12px 0', width: '100%' },
  unit: { fontFamily: "'Roboto Mono', monospace", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'var(--text-dim)', marginLeft: 8, whiteSpace: 'nowrap' },
  swapBtn: { alignSelf: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', color: 'var(--text-dim)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: -4, marginBottom: -4 },
  rateInfo: { marginTop: 6, padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 4 },
  rateRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  rateLabel: { fontFamily: "'Roboto Mono', monospace", fontSize: 9, letterSpacing: 1, color: 'var(--text-dim)' },
  rateValue: { fontFamily: "'Roboto Mono', monospace", fontSize: 12, fontWeight: 700, color: 'var(--text)' },
};

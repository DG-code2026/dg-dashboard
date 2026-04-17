import { useState, useEffect, useRef, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const PERIODS = [
  { key: '1S', label: '1S', days: 7 },
  { key: '1M', label: '1M', days: 30 },
  { key: '3M', label: '3M', days: 90 },
  { key: '6M', label: '6M', days: 180 },
  { key: '1A', label: '1A', days: 365 },
  { key: 'YTD', label: 'YTD', days: null },
  { key: 'MAX', label: 'MAX', days: null },
];

const SERIES = [
  { key: 'mep_compra', label: 'MEP Compra', color: '#39ff14', group: 'mep' },
  { key: 'mep_venta', label: 'MEP Venta', color: '#22c55e', group: 'mep', dash: '5 3' },
  { key: 'ccl_compra', label: 'CCL Compra', color: '#3b82f6', group: 'ccl' },
  { key: 'ccl_venta', label: 'CCL Venta', color: '#60a5fa', group: 'ccl', dash: '5 3' },
];

function getFromDate(periodKey) {
  const now = new Date();
  if (periodKey === 'MAX') return null;
  if (periodKey === 'YTD') return `${now.getFullYear()}-01-01`;
  const p = PERIODS.find(pp => pp.key === periodKey);
  if (!p || !p.days) return null;
  const d = new Date(now);
  d.setDate(d.getDate() - p.days);
  return d.toISOString().slice(0, 10);
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', fontSize: 11, fontFamily: "'Roboto Mono', monospace", boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
      <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '2px 0' }}>
          <span style={{ color: p.stroke }}>{p.name}</span>
          <span style={{ fontWeight: 700, color: p.stroke }}>${Number(p.value).toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

export default function FxHistoryChart() {
  const [period, setPeriod] = useState('1M');
  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [visibleSeries, setVisibleSeries] = useState(['mep_compra', 'ccl_compra']);
  const [dl, setDl] = useState(false);
  const chartRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const from = getFromDate(period);
        const url = from ? `${API}/api/fx/history?from=${from}` : `${API}/api/fx/history`;
        const res = await fetch(url);
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) setRawData(data);
      } catch (e) { console.error('FX history:', e); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [period]);

  const chartData = useMemo(() =>
    rawData.map(d => ({
      date: new Date(d.date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
      fullDate: d.date,
      mep_compra: d.mep_compra ? +Number(d.mep_compra).toFixed(2) : null,
      mep_venta: d.mep_venta ? +Number(d.mep_venta).toFixed(2) : null,
      ccl_compra: d.ccl_compra ? +Number(d.ccl_compra).toFixed(2) : null,
      ccl_venta: d.ccl_venta ? +Number(d.ccl_venta).toFixed(2) : null,
    })),
  [rawData]);

  const toggleSeries = key => setVisibleSeries(p => p.includes(key) ? p.filter(k => k !== key) : [...p, key]);

  const capture = async (action) => {
    if (!chartRef.current) return;
    setDl(true);
    try {
      if (!window.html2canvas) await new Promise((r, j) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'; s.onload = () => r(); s.onerror = () => j(); document.head.appendChild(s); });
      const canvas = await window.html2canvas(chartRef.current, { backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0a0a0a', scale: 2, useCORS: true, logging: false });
      if (action === 'download') { const l = document.createElement('a'); l.download = `tipo-cambio-${period}-${new Date().toISOString().slice(0, 10)}.png`; l.href = canvas.toDataURL('image/png'); l.click(); }
      else canvas.toBlob(b => { if (b) navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); });
    } catch (e) { alert(e.message); }
    finally { setDl(false); }
  };

  // Calculate variation for visible series
  const variation = useMemo(() => {
    if (chartData.length < 2) return {};
    const first = chartData[0];
    const last = chartData[chartData.length - 1];
    const v = {};
    SERIES.forEach(s => {
      if (first[s.key] && last[s.key]) {
        v[s.key] = ((last[s.key] - first[s.key]) / first[s.key]) * 100;
      }
    });
    return v;
  }, [chartData]);

  return (
    <div style={S.container}>
      <div style={S.header}>
        <h3 style={S.title}>EVOLUCIÓN TIPO DE CAMBIO</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button style={S.capBtn} onClick={() => capture('download')} disabled={dl}>⬇</button>
          <button style={S.capBtn} onClick={() => capture('copy')} disabled={dl}>📋</button>
        </div>
      </div>

      {/* Period + Series selectors */}
      <div style={S.controls}>
        <div style={S.periodRow}>
          {PERIODS.map(p => (
            <button key={p.key} style={{ ...S.periodBtn, ...(period === p.key ? S.periodActive : {}) }} onClick={() => setPeriod(p.key)}>{p.label}</button>
          ))}
        </div>
        <div style={S.seriesRow}>
          {SERIES.map(s => (
            <label key={s.key} style={{ ...S.seriesCheck, opacity: visibleSeries.includes(s.key) ? 1 : 0.4 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color, border: s.dash ? '1px dashed rgba(255,255,255,0.3)' : 'none' }} />
              <input type="checkbox" checked={visibleSeries.includes(s.key)} onChange={() => toggleSeries(s.key)} style={{ display: 'none' }} />
              <span style={S.seriesLabel}>{s.label}</span>
              {variation[s.key] != null && visibleSeries.includes(s.key) && (
                <span style={{ fontSize: 9, fontWeight: 700, color: variation[s.key] >= 0 ? 'var(--neon)' : 'var(--red)', marginLeft: 2 }}>
                  {variation[s.key] >= 0 ? '+' : ''}{variation[s.key].toFixed(2)}%
                </span>
              )}
            </label>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div ref={chartRef} style={S.chartWrap}>
        {loading ? (
          <div style={{ height: 350, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 12 }}>Cargando datos...</div>
        ) : chartData.length === 0 ? (
          <div style={{ height: 350, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 12, flexDirection: 'column', gap: 8 }}>
            <span>Sin datos históricos para este período</span>
            <span style={{ fontSize: 10, opacity: 0.6 }}>Los datos se acumulan automáticamente cada 5 min en horario de mercado</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-dim)', fontSize: 9 }} tickLine={{ stroke: 'var(--border)' }} axisLine={{ stroke: 'var(--border)' }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: 'var(--text-dim)', fontSize: 9 }} tickLine={{ stroke: 'var(--border)' }} axisLine={{ stroke: 'var(--border)' }} domain={['auto', 'auto']} tickFormatter={v => `$${v}`} />
              <Tooltip content={<CustomTooltip />} />
              {SERIES.filter(s => visibleSeries.includes(s.key)).map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={s.dash ? 1.5 : 2} strokeDasharray={s.dash || undefined} dot={false} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
        <div style={S.chartFooter}>
          <span>{chartData.length} ruedas · Período: {period}</span>
          <span>Fuente: Primary API · AL30/AL30D/AL30C · CI</span>
        </div>
      </div>
    </div>
  );
}

const S = {
  container: { marginTop: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid var(--border)' },
  title: { fontFamily: "'Roboto', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: 4, color: 'var(--neon)', textShadow: 'var(--neon-glow)' },
  capBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', fontSize: 12, padding: '4px 8px', cursor: 'pointer' },
  controls: { padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  periodRow: { display: 'flex', gap: 4 },
  periodBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 600, letterSpacing: 1, padding: '5px 10px', cursor: 'pointer', transition: 'all 0.15s' },
  periodActive: { background: 'var(--neon)', color: '#000', borderColor: 'var(--neon)', fontWeight: 700 },
  seriesRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  seriesCheck: { display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', transition: 'opacity 0.15s', padding: '3px 6px', borderRadius: 3, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' },
  seriesLabel: { fontFamily: "'Roboto Mono', monospace", fontSize: 9, color: 'var(--text-dim)', letterSpacing: 0.5 },
  chartWrap: { padding: 16 },
  chartFooter: { display: 'flex', justifyContent: 'space-between', fontFamily: "'Roboto Mono', monospace", fontSize: 9, color: 'var(--text-dim)', letterSpacing: 1, marginTop: 8, padding: '0 4px' },
};

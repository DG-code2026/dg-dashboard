import { useState, useEffect, useCallback, useRef } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function CarterasPage() {
  const [carteras, setCarteras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchCarteras = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/db/carteras`);
      const data = await r.json();
      if (Array.isArray(data)) setCarteras(data);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchCarteras(); }, [fetchCarteras]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await fetch(`${API}/api/db/carteras`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: newName.trim() }) });
      setNewName('');
      fetchCarteras();
    } catch {}
    finally { setCreating(false); }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!confirm('¿Eliminar esta cartera?')) return;
    await fetch(`${API}/api/db/carteras/${id}`, { method: 'DELETE' });
    if (selectedId === id) setSelectedId(null);
    fetchCarteras();
  };

  if (selectedId) return <CarteraDetail id={selectedId} onBack={() => { setSelectedId(null); fetchCarteras(); }} />;

  return (
    <div>
      <div style={S.createRow}>
        <input style={S.createInput} placeholder="Nombre de la nueva cartera..." value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()} />
        <button style={S.createBtn} onClick={handleCreate} disabled={creating || !newName.trim()}>{creating ? '...' : '＋ CREAR CARTERA'}</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)', fontSize: 12 }}>Cargando...</div>
      ) : carteras.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>📁</div>
          <div style={{ fontSize: 13 }}>Sin carteras</div>
          <div style={{ fontSize: 11, marginTop: 4, opacity: 0.6 }}>Creá una cartera y agregá bonos desde las pestañas de renta fija</div>
        </div>
      ) : (
        <div style={S.grid}>
          {carteras.map(c => (
            <div key={c.id} style={S.card} onClick={() => setSelectedId(c.id)}>
              <div style={S.cardTop}>
                <span style={S.cardName}>{c.nombre}</span>
                <button style={S.deleteBtn} onClick={e => handleDelete(c.id, e)} title="Eliminar">×</button>
              </div>
              <div style={S.cardMeta}>
                Creada: {new Date(c.created_at).toLocaleDateString('es-AR')}
                {c.updated_at && ` · Últ. mod: ${new Date(c.updated_at).toLocaleDateString('es-AR')}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
//  CARTERA DETAIL
// ══════════════════════════════════════════════

function CarteraDetail({ id, onBack }) {
  const [cartera, setCartera] = useState(null);
  const [bondData, setBondData] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const fetchDetail = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/db/carteras/${id}`);
      const data = await r.json();
      setCartera(data);
      if (data.items?.length) await fetchBondData(data.items);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [id]);

  const fetchBondData = async (items) => {
    // Group by tipo+settlement for separate batch calls
    const groups = {};
    items.forEach(it => {
      const key = `${it.tipo}|${it.settlement}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(it.ticker);
    });

    const allBonds = {};
    for (const [key, tickers] of Object.entries(groups)) {
      const [tipo, settlement] = key.split('|');
      try {
        const r = await fetch(`${API}/api/ppi/bonds/batch?type=${tipo}&settlement=${settlement}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers }),
        });
        const data = await r.json();
        data.forEach(d => { if (!d.error && d.bond) allBonds[d.ticker] = { ...d.bond, currentPrice: d.price }; });
      } catch {}
    }
    setBondData(allBonds);
  };

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const handleRemoveItem = async (itemId) => {
    await fetch(`${API}/api/db/cartera-items/${itemId}`, { method: 'DELETE' });
    fetchDetail();
  };

  const handleRefresh = () => { setRefreshing(true); fetchDetail(); };

  // ── Portfolio metrics (weighted by market value at purchase price) ──
  // Precio = por cada 100 VN, entonces inversión = precio * VN / 100
  const metrics = (() => {
    if (!cartera?.items?.length) return null;
    let totalValue = 0;
    const entries = [];

    cartera.items.forEach(item => {
      const bond = bondData[item.ticker];
      if (!bond) return;
      const value = item.precio_compra * item.vn / 100;
      totalValue += value;
      entries.push({ item, bond, value });
    });

    if (totalValue === 0 || entries.length === 0) return null;

    let wTir = 0, wMd = 0, wDuration = 0, wConvexity = 0;
    entries.forEach(({ bond, value }) => {
      const w = value / totalValue;
      if (bond.tir != null) wTir += bond.tir * w;
      if (bond.md != null) wMd += bond.md * w;
      if (bond.duration != null) wDuration += bond.duration * w;
      else if (bond.md != null && bond.tir != null) wDuration += (bond.md * (1 + bond.tir)) * w; // Macaulay ≈ MD × (1+TIR)
      if (bond.convexity != null) wConvexity += bond.convexity * w;
    });

    return {
      totalValue,
      currentValue: entries.reduce((s, { item, bond }) => s + (bond.currentPrice || item.precio_compra) * item.vn / 100, 0),
      tir: wTir, md: wMd, duration: wDuration, convexity: wConvexity,
      numBonds: entries.length,
      entries,
    };
  })();

  // ── Aggregate all flows by bond ──
  const allFlows = (() => {
    if (!cartera?.items?.length) return [];
    const flows = [];
    cartera.items.forEach(item => {
      const bond = bondData[item.ticker];
      if (!bond?.flows) return;
      const factor = item.vn / 100; // flows are per 100 VN
      bond.flows.filter(f => new Date(f.cuttingDate) > new Date()).forEach(f => {
        flows.push({
          ticker: item.ticker, date: f.cuttingDate,
          rent: (f.rent || 0) * factor,
          amortization: (f.amortization || 0) * factor,
          total: (f.total || 0) * factor,
        });
      });
    });
    return flows.sort((a, b) => new Date(a.date) - new Date(b.date));
  })();

  // ── PDF export ──
  const handlePdf = async () => {
    setPdfLoading(true);
    try {
      // Build PDF via server-side html2canvas fallback: generate a simple downloadable CSV-like structure
      // For now: generate HTML table and use print
      const win = window.open('', '_blank');
      const fc = v => v != null ? `$${Number(v).toFixed(2)}` : '—';
      const fd = d => d ? new Date(d).toLocaleDateString('es-AR') : '—';
      let html = `<html><head><title>Flujos - ${cartera.nombre}</title><style>
        body{font-family:Arial,sans-serif;padding:30px;color:#222;}
        h1{font-size:18px;letter-spacing:3px;border-bottom:2px solid #1B5E20;padding-bottom:8px;}
        h2{font-size:13px;color:#555;margin:20px 0 8px;letter-spacing:2px;}
        table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:24px;}
        th{background:#f0f0f0;padding:6px 8px;text-align:left;border-bottom:2px solid #ccc;font-size:9px;letter-spacing:1px;text-transform:uppercase;}
        td{padding:5px 8px;border-bottom:1px solid #eee;}
        .right{text-align:right;} .bold{font-weight:700;} .green{color:#1B5E20;}
        .meta{font-size:10px;color:#888;margin-bottom:20px;}
        @media print{body{padding:15px;}}
      </style></head><body>`;
      html += `<h1>FLUJO DE FONDOS — ${cartera.nombre.toUpperCase()}</h1>`;
      html += `<div class="meta">Generado: ${new Date().toLocaleString('es-AR')} · ${cartera.items.length} bonos · Precio de compra</div>`;

      if (metrics) {
        html += `<h2>RESUMEN DE CARTERA</h2><table>`;
        html += `<tr><td>Valor de compra</td><td class="right bold">${fc(metrics.totalValue)}</td><td>Valor actual</td><td class="right bold green">${fc(metrics.currentValue)}</td></tr>`;
        html += `<tr><td>TIR ponderada</td><td class="right bold">${(metrics.tir * 100).toFixed(2)}%</td><td>Duration</td><td class="right bold">${metrics.duration.toFixed(4)}</td></tr>`;
        html += `<tr><td>MD ponderada</td><td class="right bold">${metrics.md.toFixed(4)}</td><td>${metrics.convexity ? 'Convexity' : ''}</td><td class="right bold">${metrics.convexity ? metrics.convexity.toFixed(4) : ''}</td></tr>`;
        html += `</table>`;
      }

      html += `<h2>COMPOSICIÓN</h2><table><tr><th>Ticker</th><th>Tipo</th><th class="right">VN</th><th class="right">Px Compra</th><th class="right">Inversión</th></tr>`;
      cartera.items.forEach(it => {
        html += `<tr><td class="bold">${it.ticker}</td><td>${it.tipo}</td><td class="right">${Number(it.vn).toLocaleString('es-AR')}</td><td class="right">${fc(it.precio_compra)}</td><td class="right bold">${fc(it.precio_compra * it.vn / 100)}</td></tr>`;
      });
      html += `</table>`;

      html += `<h2>FLUJOS DE FONDOS FUTUROS (DESGLOSADOS POR BONO)</h2><table><tr><th>Fecha</th><th>Ticker</th><th class="right">Renta</th><th class="right">Amortización</th><th class="right">Total</th></tr>`;
      allFlows.forEach(f => {
        html += `<tr><td>${fd(f.date)}</td><td class="bold">${f.ticker}</td><td class="right green">${fc(f.rent)}</td><td class="right">${fc(f.amortization)}</td><td class="right bold green">${fc(f.total)}</td></tr>`;
      });
      html += `</table>`;
      html += `<div class="meta" style="margin-top:30px;border-top:1px solid #ccc;padding-top:10px;">DELFINO & GAVIÑA · Wealth Management · Fuente: PPI API · Precios al momento de compra</div>`;
      html += `</body></html>`;

      win.document.write(html);
      win.document.close();
      setTimeout(() => { win.print(); }, 500);
    } catch (e) { alert(e.message); }
    finally { setPdfLoading(false); }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>Cargando cartera...</div>;
  if (!cartera) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--red)' }}>Cartera no encontrada</div>;

  const fc = v => v != null ? `$${Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  const fd = d => d ? new Date(d).toLocaleDateString('es-AR') : '—';

  return (
    <div>
      {/* Header */}
      <div style={S.detailHeader}>
        <div>
          <button style={S.backBtn} onClick={onBack}>← CARTERAS</button>
          <h3 style={S.detailTitle}>{cartera.nombre}</h3>
          <span style={S.detailMeta}>{cartera.items?.length || 0} bonos · Creada {new Date(cartera.created_at).toLocaleDateString('es-AR')}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.toolBtn} onClick={handleRefresh} disabled={refreshing}>{refreshing ? '...' : '↻ ACTUALIZAR'}</button>
          <button style={S.toolBtn} onClick={handlePdf} disabled={pdfLoading}>{pdfLoading ? '...' : '📄 PDF FLUJOS'}</button>
        </div>
      </div>

      {/* Metrics */}
      {metrics && (
        <div style={S.metricsGrid}>
          <MetricCard label="VALOR COMPRA" value={fc(metrics.totalValue)} />
          <MetricCard label="VALOR ACTUAL" value={fc(metrics.currentValue)} highlight />
          <MetricCard label="P&L" value={fc(metrics.currentValue - metrics.totalValue)} highlight={metrics.currentValue >= metrics.totalValue} negative={metrics.currentValue < metrics.totalValue}
            sub={`${((metrics.currentValue / metrics.totalValue - 1) * 100).toFixed(2)}%`} />
          <MetricCard label="TIR PONDERADA" value={`${(metrics.tir * 100).toFixed(2)}%`} highlight />
          <MetricCard label="DURATION" value={metrics.duration.toFixed(4)} />
          <MetricCard label="MD PONDERADA" value={metrics.md.toFixed(4)} />
          {metrics.convexity > 0 && <MetricCard label="CONVEXITY" value={metrics.convexity.toFixed(4)} />}
        </div>
      )}

      {/* Composition table */}
      <div style={S.section}>
        <div style={S.sectionTitle}>COMPOSICIÓN</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}></th>
                <th style={S.th}>Ticker</th>
                <th style={S.th}>Tipo</th>
                <th style={S.th}>VN</th>
                <th style={S.th}>Px Compra</th>
                <th style={S.th}>Px Actual</th>
                <th style={S.th}>Inversión</th>
                <th style={S.th}>Valor Actual</th>
                <th style={S.th}>P&L</th>
                <th style={S.th}>TIR</th>
                <th style={S.th}>Duration</th>
                <th style={S.th}>MD</th>
                <th style={S.th}>Peso</th>
              </tr>
            </thead>
            <tbody>
              {(cartera.items || []).map(item => {
                const bond = bondData[item.ticker];
                const inv = item.precio_compra * item.vn / 100;
                const cur = bond?.currentPrice ? bond.currentPrice * item.vn / 100 : null;
                const pnl = cur ? cur - inv : null;
                const peso = metrics ? (inv / metrics.totalValue * 100) : 0;
                const dur = bond?.duration != null ? bond.duration : (bond?.md != null && bond?.tir != null ? bond.md * (1 + bond.tir) : null);
                return (
                  <tr key={item.id} style={S.tr}>
                    <td style={S.td}><button style={S.removeBtnSm} onClick={() => handleRemoveItem(item.id)}>×</button></td>
                    <td style={{ ...S.td, fontWeight: 700, color: 'var(--neon)' }}>{item.ticker}</td>
                    <td style={S.td}>{item.tipo}</td>
                    <td style={S.td}>{Number(item.vn).toLocaleString('es-AR')}</td>
                    <td style={S.td}>{fc(item.precio_compra)}</td>
                    <td style={{ ...S.td, color: 'var(--neon)' }}>{bond?.currentPrice ? fc(bond.currentPrice) : '...'}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{fc(inv)}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: 'var(--neon)' }}>{cur ? fc(cur) : '...'}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: pnl > 0 ? 'var(--neon)' : pnl < 0 ? 'var(--red)' : 'var(--text)' }}>{pnl != null ? `${pnl >= 0 ? '+' : ''}${fc(pnl)}` : '...'}</td>
                    <td style={S.td}>{bond?.tir != null ? `${(bond.tir * 100).toFixed(2)}%` : '...'}</td>
                    <td style={S.td}>{dur != null ? dur.toFixed(4) : '...'}</td>
                    <td style={S.td}>{bond?.md != null ? bond.md.toFixed(4) : '...'}</td>
                    <td style={S.td}>{peso.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cash flows */}
      {allFlows.length > 0 && (
        <div style={S.section}>
          <div style={S.sectionTitle}>PRÓXIMOS FLUJOS DE FONDOS ({allFlows.length})</div>
          <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
            <table style={S.table}>
              <thead style={{ position: 'sticky', top: 0 }}>
                <tr>
                  <th style={S.th}>Fecha</th>
                  <th style={S.th}>Ticker</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Renta</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Amortización</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {allFlows.slice(0, 100).map((f, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'var(--row-alt)' : 'transparent' }}>
                    <td style={S.td}>{fd(f.date)}</td>
                    <td style={{ ...S.td, fontWeight: 700 }}>{f.ticker}</td>
                    <td style={{ ...S.td, textAlign: 'right', color: 'var(--neon)' }}>{fc(f.rent)}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{fc(f.amortization)}</td>
                    <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, color: 'var(--neon)' }}>{fc(f.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, highlight, negative, sub }) {
  return (
    <div style={S.metricCard}>
      <div style={S.metricLabel}>{label}</div>
      <div style={{ ...S.metricValue, color: negative ? 'var(--red)' : highlight ? 'var(--neon)' : 'var(--text)' }}>{value}</div>
      {sub && <div style={{ ...S.metricSub, color: negative ? 'var(--red)' : 'var(--neon)' }}>{sub}</div>}
    </div>
  );
}

const S = {
  createRow: { display: 'flex', gap: 10, marginBottom: 24 },
  createInput: { flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontFamily: "'Roboto Mono', monospace", fontSize: 13, padding: '10px 14px', outline: 'none' },
  createBtn: { background: 'none', border: '1px solid var(--neon)', borderRadius: 4, color: 'var(--neon)', fontFamily: "'Roboto', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 2, padding: '0 20px', cursor: 'pointer', whiteSpace: 'nowrap' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 },
  card: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px', cursor: 'pointer', transition: 'border-color 0.2s' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardName: { fontFamily: "'Roboto', sans-serif", fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: 1 },
  deleteBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--red-dim)', fontSize: 14, width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  cardMeta: { fontSize: 10, color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace", letterSpacing: 0.5 },

  // Detail
  detailHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 },
  backBtn: { background: 'none', border: 'none', color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace", fontSize: 10, letterSpacing: 2, cursor: 'pointer', padding: 0, marginBottom: 6, display: 'block' },
  detailTitle: { fontFamily: "'Roboto', sans-serif", fontSize: 20, fontWeight: 900, color: 'var(--neon)', textShadow: 'var(--neon-glow)', letterSpacing: 3 },
  detailMeta: { fontSize: 10, color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace", letterSpacing: 1, marginTop: 4, display: 'block' },
  toolBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 500, letterSpacing: 1, padding: '6px 12px', cursor: 'pointer' },

  metricsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 24 },
  metricCard: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '14px 16px', textAlign: 'center' },
  metricLabel: { fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--text-dim)', marginBottom: 6 },
  metricValue: { fontFamily: "'Roboto Mono', monospace", fontSize: 18, fontWeight: 700 },
  metricSub: { fontFamily: "'Roboto Mono', monospace", fontSize: 11, marginTop: 2 },

  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 10, fontWeight: 700, letterSpacing: 3, color: 'var(--neon)', marginBottom: 12, textTransform: 'uppercase' },
  table: { width: '100%', borderCollapse: 'collapse', fontFamily: "'Roboto Mono', monospace", fontSize: 11 },
  th: { padding: '10px 8px', fontFamily: "'Roboto', sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: 'var(--neon)', textTransform: 'uppercase', borderBottom: '1px solid var(--border-neon)', background: 'var(--th-bg)', textAlign: 'center', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid rgba(128,128,128,0.1)' },
  td: { padding: '8px 8px', textAlign: 'center', whiteSpace: 'nowrap', color: 'var(--text)' },
  removeBtnSm: { background: 'none', border: 'none', color: 'var(--red-dim)', fontSize: 14, cursor: 'pointer' },
};

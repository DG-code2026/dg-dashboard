import { useState, useEffect, useCallback, useRef } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─────────────────────────────────────────────────────────────────────────────
//  BRANDING PDF — mismo sistema visual que el flyer de PROPUESTAS (DG dark navy
//  + fondo pluma + tipografía institucional), pero con texto BLANCO en lugar
//  de crema. Copiado in-file para no acoplar este componente a PropuestasPage.
// ─────────────────────────────────────────────────────────────────────────────
const DG_BG = '#0A0F1C';
const DG_WHITE = '#ffffff';
const DG_WHITE_DIM = 'rgba(255,255,255,0.78)';
const DG_WHITE_MUTE = 'rgba(255,255,255,0.52)';
const DG_WHITE_SOFT = 'rgba(255,255,255,0.88)';
const DG_BLUE = '#6386AC';
const DG_LINE50 = 'rgba(255,255,255,0.5)';
const DG_LINE25 = 'rgba(255,255,255,0.25)';
const DG_LINE18 = 'rgba(255,255,255,0.18)';
const DG_LINE08 = 'rgba(255,255,255,0.08)';
const DG_PANEL = 'rgba(26,34,54,0.6)';
const DG_GREEN = '#7FE3B5';       // acento verde para renta (legible sobre navy)

const A4_W = 794;   // 210mm @ 96dpi
const A4_H = 1123;  // 297mm @ 96dpi
const A4_PAD = 42;

// Normaliza la moneda de un bono a un tag corto (USD/ARS/otra). Mismo criterio
// que en HomePage para los chips de próximos pagos.
function currencyTag(c) {
  if (!c) return 'ARS';
  const up = String(c).toUpperCase();
  if (up.includes('USD') || up.includes('DOLAR') || up.includes('DÓLAR')) return 'USD';
  if (up.includes('ARS') || up.includes('PESO')) return 'ARS';
  return up.slice(0, 4);
}

// Paginador simple por presupuesto de píxeles. Arma una lista de páginas,
// cada una con sus bloques (label, head, filas). Nada de medir DOM: se usan
// presupuestos conservadores para garantizar que todo encaje.
function planFlowsPages({ compositionRows, flowRows, totalsByBondRows, totalsByCurrencyRows }) {
  // Heights calibradas midiendo los estilos reales de FSPDF (padding + font*1.2
  // + borders). Incluyen margen de seguridad para que no se solape el footer.
  const ROW_H = 23;           // td: padding 10 + font 10*1.2 + border 1
  const LABEL_H = 40;         // sectionLabel: margin 12+8 + padding 4 + border 1 + font 10*1.2
  const THEAD_H = 28;         // th: padding 14 + font 8*1.2 + border 1
  const DISCLAIMER_H = 180;   // ~8 líneas de texto justificado @ 8px + título + padding
  const FIRST_BUDGET = 740;   // 1039 (content) − 242 (header+hero) − 21 (footer) − ~36 slack
  const CONT_BUDGET = 930;    // 1039 − 57 (cont header) − 21 (footer) − ~31 slack

  const pages = [];
  let page = { isFirst: true, blocks: [], used: 0 };

  const budget = () => (page.isFirst ? FIRST_BUDGET : CONT_BUDGET);
  const pushPage = () => { pages.push(page); page = { isFirst: false, blocks: [], used: 0 }; };

  // ─ Composición ─
  if (compositionRows.length) {
    page.blocks.push({ type: 'compoLabel' });
    page.used += LABEL_H;
    page.blocks.push({ type: 'compoHead' });
    page.used += THEAD_H;
    for (const r of compositionRows) {
      if (page.used + ROW_H > budget()) {
        pushPage();
        page.blocks.push({ type: 'compoLabel', isContinuation: true });
        page.blocks.push({ type: 'compoHead' });
        page.used += LABEL_H + THEAD_H;
      }
      page.blocks.push({ type: 'compoRow', row: r });
      page.used += ROW_H;
    }
  }

  // ─ Flujos ─
  if (flowRows.length) {
    // ¿Entran el label + head + al menos una fila? Si no, siguiente página.
    if (page.used + LABEL_H + THEAD_H + ROW_H > budget()) pushPage();
    page.blocks.push({ type: 'flowsLabel' });
    page.blocks.push({ type: 'flowsHead' });
    page.used += LABEL_H + THEAD_H;
    for (const r of flowRows) {
      if (page.used + ROW_H > budget()) {
        pushPage();
        page.blocks.push({ type: 'flowsLabel', isContinuation: true });
        page.blocks.push({ type: 'flowsHead' });
        page.used += LABEL_H + THEAD_H;
      }
      page.blocks.push({ type: 'flowRow', row: r });
      page.used += ROW_H;
    }
  }

  // ─ Totales por bono ─
  if (totalsByBondRows && totalsByBondRows.length) {
    if (page.used + LABEL_H + THEAD_H + ROW_H > budget()) pushPage();
    page.blocks.push({ type: 'totalsByBondLabel' });
    page.blocks.push({ type: 'totalsByBondHead' });
    page.used += LABEL_H + THEAD_H;
    for (const r of totalsByBondRows) {
      if (page.used + ROW_H > budget()) {
        pushPage();
        page.blocks.push({ type: 'totalsByBondLabel', isContinuation: true });
        page.blocks.push({ type: 'totalsByBondHead' });
        page.used += LABEL_H + THEAD_H;
      }
      page.blocks.push({ type: 'totalsByBondRow', row: r });
      page.used += ROW_H;
    }
  }

  // ─ Totales por moneda (gran total) ─
  if (totalsByCurrencyRows && totalsByCurrencyRows.length) {
    if (page.used + LABEL_H + THEAD_H + ROW_H > budget()) pushPage();
    page.blocks.push({ type: 'totalsByCurrencyLabel' });
    page.blocks.push({ type: 'totalsByCurrencyHead' });
    page.used += LABEL_H + THEAD_H;
    for (const r of totalsByCurrencyRows) {
      if (page.used + ROW_H > budget()) {
        pushPage();
        page.blocks.push({ type: 'totalsByCurrencyLabel', isContinuation: true });
        page.blocks.push({ type: 'totalsByCurrencyHead' });
        page.used += LABEL_H + THEAD_H;
      }
      page.blocks.push({ type: 'totalsByCurrencyRow', row: r });
      page.used += ROW_H;
    }
  }

  // ─ Disclaimer siempre al final; si no entra en la página actual, se abre otra. ─
  if (page.used + DISCLAIMER_H > budget()) pushPage();
  page.blocks.push({ type: 'disclaimer' });
  pushPage();

  return pages;
}

export default function CarterasPage() {
  const [carteras, setCarteras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');  // Surfaceamos el error de POST en la UI.

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
    setCreateErr('');
    try {
      const r = await fetch(`${API}/api/db/carteras`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: newName.trim() }) });
      // Intentamos parsear la respuesta sí o sí: si vino error del server, lo mostramos.
      let data = null;
      try { data = await r.json(); } catch { /* respuesta no-JSON */ }
      if (!r.ok) {
        const msg = (data && (data.error || data.message)) || `HTTP ${r.status}`;
        setCreateErr(`No se pudo crear la cartera: ${msg}`);
        return;
      }
      setNewName('');
      await fetchCarteras();
    } catch (e) {
      setCreateErr(`Error de red: ${e.message || e}`);
    }
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

      {createErr && (
        <div style={S.errBox}>
          {createErr}
          <button style={S.errClose} onClick={() => setCreateErr('')} title="Cerrar">×</button>
        </div>
      )}

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
  const [pdfErr, setPdfErr] = useState('');
  // Array de refs — una por hoja A4 del PDF. Se regenera en cada render y cada
  // A4Page se auto-registra via callback ref durante el commit.
  const pdfPageRefs = useRef([]);
  pdfPageRefs.current = [];

  // Precarga del fondo pluma con el mismo filter horneado que usa el flyer de
  // Propuestas — html2canvas no rasteriza bien SVG + filter CSS, así que lo
  // convertimos a PNG via canvas y usamos ese data URL.
  const [bgDataUrl, setBgDataUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || 960;
        c.height = img.naturalHeight || 540;
        const ctx = c.getContext('2d');
        ctx.filter = 'brightness(1.35) contrast(0.92) saturate(0.95)';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        setBgDataUrl(c.toDataURL('image/png'));
      } catch { setBgDataUrl('/logos/fondo%20pluma.svg'); }
    };
    img.onerror = () => { if (!cancelled) setBgDataUrl('/logos/fondo%20pluma.svg'); };
    img.src = '/logos/fondo%20pluma.svg';
    return () => { cancelled = true; };
  }, []);

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

  // ── Totales por bono y por moneda (para las dos tablas-resumen al pie del PDF) ──
  // Iteramos items en lugar de allFlows porque necesitamos la currency de cada
  // bono (que vive en bondData[ticker].issueCurrency), no en los flujos sueltos.
  const flowTotalsByBond = (() => {
    const out = [];
    (cartera?.items || []).forEach(item => {
      const bond = bondData[item.ticker];
      if (!bond?.flows) return;
      const factor = item.vn / 100;
      const now = new Date();
      let rent = 0, amort = 0, total = 0;
      bond.flows.filter(f => new Date(f.cuttingDate) > now).forEach(f => {
        rent += (f.rent || 0) * factor;
        amort += (f.amortization || 0) * factor;
        total += (f.total || 0) * factor;
      });
      if (rent > 0 || amort > 0) {
        out.push({
          ticker: item.ticker,
          tipo: item.tipo,
          rent, amort, total,
          currency: currencyTag(bond.issueCurrency),
        });
      }
    });
    return out.sort((a, b) => a.ticker.localeCompare(b.ticker));
  })();

  const flowTotalsByCurrency = (() => {
    const map = new Map();
    flowTotalsByBond.forEach(b => {
      const k = b.currency || 'ARS';
      if (!map.has(k)) map.set(k, { currency: k, rent: 0, amort: 0, total: 0 });
      const agg = map.get(k);
      agg.rent += b.rent;
      agg.amort += b.amort;
      agg.total += b.total;
    });
    return [...map.values()];
  })();

  // Plan de paginación A4 para el PDF. Cada bloque se marca con su tipo y el
  // paginador respeta presupuestos conservadores para garantizar que todo encaje
  // en papel sin cortes feos. Se recomputa por render — el costo es trivial.
  const pdfPages = planFlowsPages({
    compositionRows: cartera?.items || [],
    flowRows: allFlows,
    totalsByBondRows: flowTotalsByBond,
    totalsByCurrencyRows: flowTotalsByCurrency,
  });

  // ── PDF export ──
  // Levantamos html2canvas + jsPDF on-demand (misma técnica que el flyer de
  // propuestas). Cada página A4 se captura por separado para que no haya
  // cortes feos al dividir una imagen grande en múltiples hojas.
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
  const ensureHtml2Canvas = async () => { if (!window.html2canvas) await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'); };
  const ensureJsPdf = async () => { if (!window.jspdf) await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js'); };

  const safeFile = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || '—';

  const handlePdf = async () => {
    setPdfLoading(true);
    setPdfErr('');
    try {
      await ensureHtml2Canvas();
      await ensureJsPdf();
      // Esperamos al fondo (si el render del doc quedó antes que la precarga).
      if (!bgDataUrl) await new Promise(r => setTimeout(r, 300));
      const nodes = (pdfPageRefs.current || []).filter(Boolean);
      if (!nodes.length) throw new Error('Documento PDF no disponible');
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageWmm = 210, pageHmm = 297;
      for (let i = 0; i < nodes.length; i++) {
        const canvas = await window.html2canvas(nodes[i], {
          backgroundColor: DG_BG,
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          windowWidth: A4_W,
        });
        if (i > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pageWmm, pageHmm);
      }
      const fileName = `D&G - Flujo de Fondos - ${safeFile(cartera?.nombre)}.pdf`;
      pdf.save(fileName);
    } catch (e) { setPdfErr(e.message || 'Error generando PDF'); }
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

      {pdfErr && (
        <div style={S.errBox}>
          PDF: {pdfErr}
          <button style={S.errClose} onClick={() => setPdfErr('')} title="Cerrar">×</button>
        </div>
      )}

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

      {/* Documento PDF renderizado off-screen — cada página A4 se captura por
          separado con html2canvas y se stitchea en jsPDF. No se ve en pantalla. */}
      <div style={S.pdfStage} aria-hidden="true">
        <FlowsPdfDoc
          cartera={cartera}
          pages={pdfPages}
          bgDataUrl={bgDataUrl}
          pageRefs={pdfPageRefs}
        />
      </div>
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
  createRow: { display: 'flex', gap: 10, marginBottom: 14 },
  createInput: { flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontFamily: "'Roboto Mono', monospace", fontSize: 13, padding: '10px 14px', outline: 'none' },
  createBtn: { background: 'none', border: '1px solid var(--neon)', borderRadius: 4, color: 'var(--neon)', fontFamily: "'Roboto', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 2, padding: '0 20px', cursor: 'pointer', whiteSpace: 'nowrap' },
  errBox: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 4, color: '#ef4444', fontFamily: "'Roboto Mono', monospace", fontSize: 11, padding: '8px 12px', marginBottom: 14 },
  errClose: { background: 'none', border: 'none', color: '#ef4444', fontSize: 16, cursor: 'pointer', padding: 0, lineHeight: 1 },
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

  // Stage off-screen donde se renderiza el documento PDF. No tiene que ser
  // visible, pero sí tiene que estar layouteado (no display:none) para que
  // html2canvas pueda capturar cada página. Fuera de viewport + sin
  // interacción + oculto a screen readers.
  pdfStage: { position: 'fixed', top: -99999, left: -99999, pointerEvents: 'none', opacity: 0 },
};

// ═══════════════════════════════════════════════════════════════════════════
//  FLOWS PDF DOCUMENT
//  Documento A4 off-screen. Mismo sistema visual que el flyer de PROPUESTAS
//  (fondo pluma + logo DG) pero con texto blanco. Muestra COMPOSICIÓN + FLUJOS
//  DE FONDOS — sin resumen/metrics y sin precio de compra.
// ═══════════════════════════════════════════════════════════════════════════

const FLOWS_DISCLAIMER = 'Los importes expuestos corresponden a flujos teóricos de renta y amortización calculados sobre los valores nominales declarados en la cartera, tomando como base el cronograma de pagos vigente al momento de la generación del presente documento. Son estimaciones susceptibles de ser modificadas por eventos corporativos, reestructuraciones, retenciones impositivas, canjes, reinversiones o incumplimientos del emisor, y no constituyen una recomendación de inversión ni una promesa de rendimiento. La composición y los flujos aquí informados se basan en datos provistos por PPI (Portfolio Personal Inversiones) y pueden diferir de fuentes alternativas o de precios efectivamente negociados. Las inversiones en valores negociables — incluidos títulos públicos, subsoberanos y obligaciones negociables — están sujetas a riesgo de mercado, de crédito, de liquidez y de tipo de cambio. Cada inversor debe evaluar en forma independiente la conveniencia de las operaciones y consultar a su asesor antes de operar. DELFINO GAVIÑA INVERSIONES no garantiza la exactitud de los cálculos ni asume responsabilidad por decisiones adoptadas en base a la información contenida en este documento.';

// Agrupa los bloques del paginador en unidades renderables: cada run de
// compoHead+compoRow* se convierte en una tabla, lo mismo con flowsHead+flowRow*.
function groupBlocks(blocks) {
  const out = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === 'compoLabel') { out.push({ kind: 'compoLabel', isContinuation: !!b.isContinuation }); i++; }
    else if (b.type === 'compoHead') {
      const rows = []; i++;
      while (i < blocks.length && blocks[i].type === 'compoRow') { rows.push(blocks[i].row); i++; }
      out.push({ kind: 'compoTable', rows });
    }
    else if (b.type === 'flowsLabel') { out.push({ kind: 'flowsLabel', isContinuation: !!b.isContinuation }); i++; }
    else if (b.type === 'flowsHead') {
      const rows = []; i++;
      while (i < blocks.length && blocks[i].type === 'flowRow') { rows.push(blocks[i].row); i++; }
      out.push({ kind: 'flowsTable', rows });
    }
    else if (b.type === 'totalsByBondLabel') { out.push({ kind: 'totalsByBondLabel', isContinuation: !!b.isContinuation }); i++; }
    else if (b.type === 'totalsByBondHead') {
      const rows = []; i++;
      while (i < blocks.length && blocks[i].type === 'totalsByBondRow') { rows.push(blocks[i].row); i++; }
      out.push({ kind: 'totalsByBondTable', rows });
    }
    else if (b.type === 'totalsByCurrencyLabel') { out.push({ kind: 'totalsByCurrencyLabel', isContinuation: !!b.isContinuation }); i++; }
    else if (b.type === 'totalsByCurrencyHead') {
      const rows = []; i++;
      while (i < blocks.length && blocks[i].type === 'totalsByCurrencyRow') { rows.push(blocks[i].row); i++; }
      out.push({ kind: 'totalsByCurrencyTable', rows });
    }
    else if (b.type === 'disclaimer') { out.push({ kind: 'disclaimer' }); i++; }
    else i++;
  }
  return out;
}

function FlowsPdfDoc({ cartera, pages, bgDataUrl, pageRefs }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const totalPages = pages.length || 1;
  return (
    <>
      {pages.map((pg, pi) => (
        <FPDFPage
          key={pi}
          pg={pg}
          pageNum={pi + 1}
          totalPages={totalPages}
          cartera={cartera}
          dateStr={dateStr}
          bgDataUrl={bgDataUrl}
          onRef={(el) => { if (el) pageRefs.current[pi] = el; }}
        />
      ))}
    </>
  );
}

function FPDFPage({ pg, pageNum, totalPages, cartera, dateStr, bgDataUrl, onRef }) {
  const groups = groupBlocks(pg.blocks);
  return (
    <div ref={onRef} style={FSPDF.page}>
      {bgDataUrl && (
        <div style={{ ...FSPDF.bg, backgroundImage: `url("${bgDataUrl}")` }} />
      )}
      <div style={FSPDF.tint} />
      <div style={FSPDF.content}>
        {pg.isFirst
          ? <FPDFFirstHeader cartera={cartera} dateStr={dateStr} />
          : <FPDFContHeader cartera={cartera} dateStr={dateStr} />}

        <div style={FSPDF.body}>
          {groups.map((g, gi) => {
            if (g.kind === 'compoLabel') {
              return (
                <div key={gi} style={FSPDF.sectionLabel}>
                  <span style={FSPDF.sectionLabelDot}>●</span> COMPOSICIÓN DE CARTERA{g.isContinuation ? ' (CONT.)' : ''}
                </div>
              );
            }
            if (g.kind === 'compoTable') return <FPDFCompoTable key={gi} rows={g.rows} />;
            if (g.kind === 'flowsLabel') {
              return (
                <div key={gi} style={FSPDF.sectionLabel}>
                  <span style={FSPDF.sectionLabelDot}>●</span> FLUJOS DE FONDOS PROYECTADOS{g.isContinuation ? ' (CONT.)' : ''}
                </div>
              );
            }
            if (g.kind === 'flowsTable') return <FPDFFlowsTable key={gi} rows={g.rows} />;
            if (g.kind === 'totalsByBondLabel') {
              return (
                <div key={gi} style={FSPDF.sectionLabel}>
                  <span style={FSPDF.sectionLabelDot}>●</span> TOTAL POR BONO{g.isContinuation ? ' (CONT.)' : ''}
                </div>
              );
            }
            if (g.kind === 'totalsByBondTable') return <FPDFTotalsByBondTable key={gi} rows={g.rows} />;
            if (g.kind === 'totalsByCurrencyLabel') {
              return (
                <div key={gi} style={FSPDF.sectionLabel}>
                  <span style={FSPDF.sectionLabelDot}>●</span> TOTAL POR MONEDA{g.isContinuation ? ' (CONT.)' : ''}
                </div>
              );
            }
            if (g.kind === 'totalsByCurrencyTable') return <FPDFTotalsByCurrencyTable key={gi} rows={g.rows} />;
            if (g.kind === 'disclaimer') {
              return (
                <div key={gi} style={FSPDF.disclaimer}>
                  <div style={FSPDF.disclaimerTitle}>AVISO LEGAL</div>
                  <div style={FSPDF.disclaimerBody}>{FLOWS_DISCLAIMER}</div>
                </div>
              );
            }
            return null;
          })}
        </div>

        <div style={FSPDF.footer}>
          <span>DELFINO GAVIÑA · INVERSIONES</span>
          <span>{dateStr}</span>
          <span>PÁG. {pageNum} / {totalPages}</span>
        </div>
      </div>
    </div>
  );
}

function FPDFFirstHeader({ cartera, dateStr }) {
  const n = cartera?.items?.length || 0;
  return (
    <>
      <div style={FSPDF.firstHeader}>
        <img src="/logos/DG%20tema%20oscuro.png" alt="DG" style={FSPDF.logoBig} crossOrigin="anonymous" />
        <div style={FSPDF.headerDate}>{dateStr}</div>
      </div>
      <div style={FSPDF.hero}>
        <div style={FSPDF.heroEyebrow}>REPORTE INSTITUCIONAL</div>
        <div style={FSPDF.heroTitle}>FLUJO DE FONDOS</div>
        <div style={FSPDF.heroDivider} />
        <div style={FSPDF.heroSub}>{(cartera?.nombre || '—').toUpperCase()}</div>
        <div style={FSPDF.heroMeta}>
          {n} instrumento{n === 1 ? '' : 's'} · Generado el {dateStr}
        </div>
      </div>
    </>
  );
}

function FPDFContHeader({ cartera, dateStr }) {
  return (
    <div style={FSPDF.contHeader}>
      <img src="/logos/DG%20tema%20oscuro.png" alt="DG" style={FSPDF.logoSm} crossOrigin="anonymous" />
      <div style={FSPDF.contTitle}>
        FLUJO DE FONDOS · <span style={{ color: DG_BLUE }}>{(cartera?.nombre || '').toUpperCase()}</span>
      </div>
      <div style={FSPDF.headerDate}>{dateStr}</div>
    </div>
  );
}

function FPDFCompoTable({ rows }) {
  const fmtVN = (v) => Number(v || 0).toLocaleString('es-AR');
  return (
    <table style={FSPDF.table}>
      <thead>
        <tr>
          <th style={FSPDF.th}>Ticker</th>
          <th style={FSPDF.th}>Tipo</th>
          <th style={{ ...FSPDF.th, ...FSPDF.thRight }}>Valor Nominal</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id || i}>
            <td style={{ ...FSPDF.td, ...FSPDF.tdTicker }}>{r.ticker}</td>
            <td style={FSPDF.td}>{r.tipo || '—'}</td>
            <td style={{ ...FSPDF.td, ...FSPDF.tdRight, ...FSPDF.tdNum }}>{fmtVN(r.vn)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FPDFFlowsTable({ rows }) {
  const fc = (v) => v != null
    ? `$${Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';
  const fd = (d) => {
    if (!d) return '—';
    const dt = new Date(d);
    if (isNaN(dt)) return '—';
    return dt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };
  return (
    <table style={FSPDF.table}>
      <thead>
        <tr>
          <th style={FSPDF.th}>Fecha</th>
          <th style={FSPDF.th}>Ticker</th>
          <th style={{ ...FSPDF.th, ...FSPDF.thRight }}>Renta</th>
          <th style={{ ...FSPDF.th, ...FSPDF.thRight }}>Amortización</th>
          <th style={{ ...FSPDF.th, ...FSPDF.thRight }}>Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={FSPDF.td}>{fd(r.date)}</td>
            <td style={{ ...FSPDF.td, ...FSPDF.tdTicker }}>{r.ticker}</td>
            <td style={{ ...FSPDF.td, ...FSPDF.tdRight, ...FSPDF.tdNum, color: DG_GREEN }}>{fc(r.rent)}</td>
            <td style={{ ...FSPDF.td, ...FSPDF.tdRight, ...FSPDF.tdNum }}>{fc(r.amortization)}</td>
            <td style={{ ...FSPDF.td, ...FSPDF.tdRight, ...FSPDF.tdNum, fontWeight: 700 }}>{fc(r.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Tabla resumen: totales acumulados por cada bono de la cartera. Subtle blue
// tint en el <tr> para diferenciar visualmente del detalle de flujos.
function FPDFTotalsByBondTable({ rows }) {
  const fc = (v) => v != null
    ? `$${Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';
  return (
    <table style={FSPDF.table}>
      <thead>
        <tr>
          <th style={FSPDF.th}>Ticker</th>
          <th style={FSPDF.th}>Tipo</th>
          <th style={{ ...FSPDF.th, ...FSPDF.thRight }}>Renta</th>
          <th style={{ ...FSPDF.th, ...FSPDF.thRight }}>Amortización</th>
          <th style={{ ...FSPDF.th, ...FSPDF.thRight }}>R + A</th>
          <th style={FSPDF.th}>Moneda</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={FSPDF.trTotal}>
            <td style={{ ...FSPDF.td, ...FSPDF.tdTicker }}>{r.ticker}</td>
            <td style={FSPDF.td}>{r.tipo || '—'}</td>
            <td style={{ ...FSPDF.td, ...FSPDF.tdRight, ...FSPDF.tdNum, color: DG_GREEN }}>{fc(r.rent)}</td>
            <td style={{ ...FSPDF.td, ...FSPDF.tdRight, ...FSPDF.tdNum }}>{fc(r.amort)}</td>
            <td style={{ ...FSPDF.td, ...FSPDF.tdRight, ...FSPDF.tdNum, fontWeight: 700 }}>{fc(r.total)}</td>
            <td style={{ ...FSPDF.td, color: DG_WHITE_MUTE }}>{r.currency}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Tabla resumen final: gran total agregado por moneda. Más enfática (blue tint
// más fuerte, números bold y el Total ligeramente más grande).
function FPDFTotalsByCurrencyTable({ rows }) {
  const fc = (v) => v != null
    ? `$${Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';
  return (
    <table style={FSPDF.table}>
      <thead>
        <tr>
          <th style={FSPDF.th}>Moneda</th>
          <th style={{ ...FSPDF.th, ...FSPDF.thRight }}>Renta</th>
          <th style={{ ...FSPDF.th, ...FSPDF.thRight }}>Amortización</th>
          <th style={{ ...FSPDF.th, ...FSPDF.thRight }}>R + A</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={FSPDF.trGrandTotal}>
            <td style={{ ...FSPDF.td, ...FSPDF.tdTicker, fontSize: 11 }}>{r.currency}</td>
            <td style={{ ...FSPDF.td, ...FSPDF.tdRight, ...FSPDF.tdNum, color: DG_GREEN, fontWeight: 700 }}>{fc(r.rent)}</td>
            <td style={{ ...FSPDF.td, ...FSPDF.tdRight, ...FSPDF.tdNum, fontWeight: 700 }}>{fc(r.amort)}</td>
            <td style={{ ...FSPDF.td, ...FSPDF.tdRight, ...FSPDF.tdNum, fontWeight: 700, fontSize: 11 }}>{fc(r.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const FSPDF = {
  // Hoja A4: fondo navy sólido + pluma + tint. Todo lo de arriba va `position:
  // absolute` y el contenido real queda en .content con padding uniforme.
  page: {
    position: 'relative',
    width: A4_W, height: A4_H,
    background: DG_BG,
    color: DG_WHITE,
    overflow: 'hidden',
    fontFamily: "'Roboto', sans-serif",
    marginBottom: 24,  // separa visualmente las páginas en el stage off-screen
    boxSizing: 'border-box',
  },
  bg: {
    position: 'absolute', inset: 0,
    backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
    opacity: 0.09, pointerEvents: 'none',
  },
  tint: {
    position: 'absolute', inset: 0, pointerEvents: 'none',
    background: 'radial-gradient(ellipse at top, rgba(99,134,172,0.20) 0%, rgba(10,15,28,0) 45%, rgba(10,15,28,0.7) 100%)',
  },
  content: {
    position: 'relative', zIndex: 1,
    width: '100%', height: '100%',
    padding: A4_PAD,
    display: 'flex', flexDirection: 'column',
    boxSizing: 'border-box',
  },

  // ── Header primera página ──
  firstHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: 8,
  },
  logoBig: { height: 58, width: 'auto', display: 'block' },
  headerDate: {
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 10, color: DG_WHITE_MUTE,
    letterSpacing: 1.5, textAlign: 'right', paddingTop: 16,
  },
  hero: {
    textAlign: 'center',
    margin: '16px 0 24px',
    padding: '18px 0 20px',
    borderTop: `1px solid ${DG_LINE25}`,
    borderBottom: `1px solid ${DG_LINE25}`,
  },
  heroEyebrow: {
    fontFamily: "'Roboto', sans-serif",
    fontSize: 8, fontWeight: 600, letterSpacing: 5,
    color: DG_BLUE, textTransform: 'uppercase', marginBottom: 6,
  },
  heroTitle: {
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    fontSize: 32, fontWeight: 500, letterSpacing: 12,
    color: DG_WHITE, marginBottom: 10,
  },
  heroDivider: {
    width: 60, height: 1, margin: '0 auto 10px',
    background: DG_BLUE,
  },
  heroSub: {
    fontFamily: "'Roboto', sans-serif",
    fontSize: 13, fontWeight: 700, letterSpacing: 4,
    color: DG_WHITE_SOFT, marginBottom: 4,
  },
  heroMeta: {
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 9, letterSpacing: 1.2,
    color: DG_WHITE_MUTE,
  },

  // ── Header páginas siguientes ──
  contHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    gap: 12, paddingBottom: 10, marginBottom: 18,
    borderBottom: `1px solid ${DG_LINE18}`,
  },
  logoSm: { height: 28, width: 'auto', display: 'block' },
  contTitle: {
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    fontSize: 13, fontWeight: 500, letterSpacing: 4,
    color: DG_WHITE, textAlign: 'center', flex: 1,
  },

  // ── Body ──
  // `overflow: hidden` es un net de seguridad: si el paginador se queda corto
  // por alguna razón (texto con wrapping inesperado, fuente que mide más que
  // lo calculado), la cola se clipea en vez de invadir el footer.
  body: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' },

  sectionLabel: {
    display: 'flex', alignItems: 'center', gap: 8,
    fontFamily: "'Roboto', sans-serif",
    fontSize: 10, fontWeight: 700, letterSpacing: 4,
    color: DG_BLUE, textTransform: 'uppercase',
    marginTop: 12, marginBottom: 8,
    paddingBottom: 4,
    borderBottom: `1px solid ${DG_LINE18}`,
  },
  sectionLabelDot: { fontSize: 6, color: DG_BLUE },

  // ── Tablas ──
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 10, color: DG_WHITE,
    marginBottom: 4,
  },
  th: {
    padding: '7px 10px',
    fontFamily: "'Roboto', sans-serif",
    fontSize: 8, fontWeight: 700, letterSpacing: 2,
    color: DG_BLUE, textTransform: 'uppercase',
    borderBottom: `1px solid ${DG_LINE50}`,
    textAlign: 'left', whiteSpace: 'nowrap',
  },
  thRight: { textAlign: 'right' },
  td: {
    padding: '5px 10px',
    fontSize: 10, color: DG_WHITE,
    borderBottom: `1px solid ${DG_LINE08}`,
    whiteSpace: 'nowrap',
  },
  tdRight: { textAlign: 'right' },
  tdTicker: { fontWeight: 700, color: DG_WHITE, letterSpacing: 0.5 },
  tdNum: { fontVariantNumeric: 'tabular-nums' },
  // Filas resumen — tint azul sutil para separarlas visualmente del detalle.
  trTotal: { backgroundColor: 'rgba(99,134,172,0.06)' },
  // Filas del gran total — tint más fuerte + borde superior marcado.
  trGrandTotal: { backgroundColor: 'rgba(99,134,172,0.12)', borderTop: `1px solid ${DG_BLUE}` },

  // ── Disclaimer ──
  disclaimer: {
    marginTop: 14,
    padding: '10px 14px 12px',
    border: `1px solid ${DG_LINE18}`,
    borderLeft: `2px solid ${DG_BLUE}`,
    borderRadius: 2,
    background: DG_PANEL,
  },
  disclaimerTitle: {
    fontFamily: "'Roboto', sans-serif",
    fontSize: 8, fontWeight: 700, letterSpacing: 3,
    color: DG_BLUE, textTransform: 'uppercase',
    marginBottom: 6,
  },
  disclaimerBody: {
    fontFamily: "'Roboto', sans-serif",
    fontSize: 8, lineHeight: 1.6, letterSpacing: 0.2,
    color: DG_WHITE_DIM, textAlign: 'justify',
  },

  // ── Footer ──
  footer: {
    marginTop: 'auto',
    paddingTop: 10,
    borderTop: `1px solid ${DG_LINE18}`,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 8, letterSpacing: 1.5,
    color: DG_WHITE_MUTE,
  },
};

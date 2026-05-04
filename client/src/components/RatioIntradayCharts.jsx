import { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

// ─────────────────────────────────────────────────────────────────────────────
//  EVOLUCIÓN DEL TIPO DE CAMBIO — 3 paneles (MEP, CABLE, CANJE) con selector
//  de temporalidad (DÍA / SEMANA / MES / ANUAL).
//
//  ─ DÍA (intradiario):
//      Vienen del endpoint server `/api/fx/intraday` (tabla `intraday_fx_samples`).
//      El server llama al REST de Primary `/rest/marketdata/get` cada 5 min
//      alineado al wall-clock (10:25, 10:30, ..., 17:05) durante mercado
//      abierto y guarda el LA (último precio operado). Al inicio de cada
//      nueva rueda (primer save del día AR) se purgan los rows de fechas
//      anteriores → arrancamos de cero cada día. Polling cliente 60s.
//
//  ─ SEMANA / MES / ANUAL (histórico):
//      Vienen de `/api/fx/history` (tabla `daily_fx_closes`, 1 fila por rueda).
//
//  Ratios calculados (mismas fórmulas en ambas fuentes):
//      MEP   = P(AL30)  / P(AL30D)
//      CABLE = P(AL30)  / P(AL30C)
//      CANJE = (P(AL30D) / P(AL30C) - 1) × 100   (porcentaje)
//
//      P() = LA (último operado) si hay; si no, mid(bid,offer); si no, close.
//      Esta cascada usa siempre el precio más fidedigno disponible — un
//      trade real es preferible a un mid sintético.
//
//  Settlement: el feed Primary está en CI (Contado Inmediato).
// ─────────────────────────────────────────────────────────────────────────────

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const INTRA_POLL_MS = 60_000;            // refrescamos /api/fx/intraday cada 60s
const MARKET_TZ = 'America/Argentina/Buenos_Aires';
const MARKET_OFFSET = '-03:00';          // AR sin DST

// Cantidad de cierres a mostrar por temporalidad (sobre el set ordenado por
// fecha asc). Si la BDD no tiene tantas ruedas todavía, se muestra lo que haya.
const TIMEFRAMES = [
  { key: 'D', label: 'DÍA',   desc: 'Intradiario · 1 muestra cada 5 min',     tail: null },
  { key: 'M', label: 'MES',   desc: 'Últimas ~22 ruedas (cierre diario)',     tail: 22 },
  { key: 'A', label: 'ANUAL', desc: 'Últimas ~252 ruedas (cierre diario)',    tail: 252 },
];

// `yStep` define la separación de marcas del eje Y para cada panel.
// Pricing → cada $10 ; Canje → cada 1 punto porcentual. La función
// `niceTicks()` lo duplica adaptativamente si el rango es demasiado amplio
// para evitar saturar el eje.
const PANELS = [
  { key: 'mep',   title: 'MEP',   formula: 'AL30 / AL30D',              color: 'var(--neon)', decimals: 2, isPercent: false, yStep: 10 },
  { key: 'ccl',   title: 'CABLE', formula: 'AL30 / AL30C',              color: '#3b82f6',     decimals: 2, isPercent: false, yStep: 10 },
  // CANJE en %: (AL30D/AL30C - 1) × 100. Típicamente entre -2% y +2%.
  { key: 'canje', title: 'CANJE', formula: '(AL30D / AL30C − 1) × 100', color: '#f59e0b',     decimals: 2, isPercent: true,  yStep: 1  },
];

// ─── helpers ───────────────────────────────────────────────────────────────

// Precio "de referencia" desde un row de BDD. Prioridad:
//   1. last (LA — último operado, lo que pide la doc Primary pág. 38)
//   2. mid de bid/offer (si hay punta)
//   3. close (último cierre conocido — sólo en `daily_fx_closes`)
// Esto unifica el cálculo entre intradía (intraday_fx_samples) y diario
// (daily_fx_closes), priorizando el precio operado real cuando está.
function priceFromRow(last, bid, offer, close) {
  const l = Number(last);
  if (Number.isFinite(l) && l > 0) return l;
  const b = Number(bid), o = Number(offer);
  if (Number.isFinite(b) && Number.isFinite(o) && b > 0 && o > 0) return (b + o) / 2;
  const c = Number(close);
  if (Number.isFinite(c) && c > 0) return c;
  return null;
}

// Día calendario en zona AR (YYYY-MM-DD).
function todayARKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const y  = parts.find(p => p.type === 'year').value;
  const mo = parts.find(p => p.type === 'month').value;
  const da = parts.find(p => p.type === 'day').value;
  return `${y}-${mo}-${da}`;
}

// Format HH:MM AR de un timestamp.
function fmtTimeAR(ms) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: MARKET_TZ,
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

function fmtDate(iso) {
  // iso = 'YYYY-MM-DD' → 'DD/MM'
  if (!iso) return '';
  const [, mm, dd] = iso.split('-');
  return `${dd}/${mm}`;
}

function fmtRatio(v, decs = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number(v).toLocaleString('es-AR', { minimumFractionDigits: decs, maximumFractionDigits: decs });
}

// Genera ticks del eje X para DÍA: 1 marca cada 30 min entre 10:30 y 17:00 AR
// del día corriente. Devuelve timestamps ms en UTC.
function dayXTicks() {
  const today = todayARKey();
  const out = [];
  for (let h = 10; h <= 17; h++) {
    for (const m of [0, 30]) {
      if (h === 10 && m === 0) continue; // arrancamos a las 10:30
      if (h === 17 && m > 0) continue;   // terminamos a las 17:00
      const iso = `${today}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00${MARKET_OFFSET}`;
      out.push(Date.parse(iso));
    }
  }
  return out;
}

// Domain del eje X para DÍA: [10:25 AR, 17:05 AR] del día corriente. Así el
// chart mantiene proporciones aunque no tengamos data para todo el día.
function dayXDomain() {
  const today = todayARKey();
  const start = Date.parse(`${today}T10:25:00${MARKET_OFFSET}`);
  const end   = Date.parse(`${today}T17:05:00${MARKET_OFFSET}`);
  return [start, end];
}

// Calcula EXACTAMENTE 5 marcas redondas en el eje Y. El step base es $10
// para precios y 1pp para canje; si el rango de datos no entra en 4×step,
// vamos escalando el step a múltiplos "nice" del base (10, 20, 50, 100,
// 200, 500…) hasta que entre. Resultado: el chart siempre tiene 5 marcas
// equiespaciadas en números redondos, con la data adentro.
function niceTicks5(min, max, baseStep) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || baseStep <= 0) return null;
  // Si rango microscópico (1 sólo punto, o data plana), expandimos para que
  // los 5 ticks no queden todos pegados.
  if (max - min < baseStep * 0.5) {
    max = min + baseStep * 0.5;
  }

  // Multiplicadores nice: 1, 2, 5, 10, 20, 50, 100…
  const niceM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  let step = baseStep;
  let start = Math.floor(min / step) * step;
  for (const m of niceM) {
    step = baseStep * m;
    start = Math.floor(min / step) * step;
    // Tras redondear el min hacia abajo, end = start + 4*step debe abarcar max.
    if (start + 4 * step >= max) break;
  }

  const ticks = [];
  for (let i = 0; i < 5; i++) {
    // toFixed(6) para evitar drift como 1239.9999999.
    ticks.push(+(start + i * step).toFixed(6));
  }
  return { ticks, domain: [start, start + 4 * step] };
}

// ─── componente principal ──────────────────────────────────────────────────

export default function RatioIntradayCharts({ connected }) {
  const [timeframe, setTimeframe] = useState('D'); // D | W | M | A

  // ── Estado intradía (DÍA) — desde server, polling cada 60s ──
  const [intra, setIntra]               = useState([]);
  const [intraLoading, setIntraLoading] = useState(false);
  const [intraErr, setIntraErr]         = useState(null);

  useEffect(() => {
    if (timeframe !== 'D') return;
    let cancelled = false;
    let timer = null;

    const load = async () => {
      try {
        const r = await fetch(`${API}/api/fx/intraday`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const rows = await r.json();
        if (cancelled) return;
        setIntra(Array.isArray(rows) ? rows : []);
        setIntraErr(null);
      } catch (e) {
        if (!cancelled) setIntraErr(e.message || 'No se pudo cargar intradía');
      } finally {
        if (!cancelled) setIntraLoading(false);
      }
    };

    setIntraLoading(true);
    load();
    timer = setInterval(load, INTRA_POLL_MS);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [timeframe]);

  // ── Histórico (SEMANA / MES / ANUAL) ──
  const [hist, setHist]               = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histErr, setHistErr]         = useState(null);

  // Traemos TODOS los cierres y recortamos la cola en cliente — así si la BDD
  // tiene "huecos" igual mostramos los N últimos puntos disponibles.
  useEffect(() => {
    if (timeframe === 'D') return;
    let cancelled = false;
    (async () => {
      setHistLoading(true);
      setHistErr(null);
      try {
        const r = await fetch(`${API}/api/fx/history`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const rows = await r.json();
        if (cancelled) return;
        setHist(Array.isArray(rows) ? rows : []);
      } catch (e) {
        if (!cancelled) setHistErr(e.message || 'No se pudo cargar histórico');
      } finally {
        if (!cancelled) setHistLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [timeframe]);

  // ── Series finales según temporalidad ──
  const series = useMemo(() => {
    if (timeframe === 'D') {
      const valid = [];
      for (const r of intra) {
        // Prioridad: last (REST/Primary) → mid(bid,offer) → null
        const pAl30  = priceFromRow(r.al30_last,  r.al30_bid,  r.al30_offer);
        const pAl30d = priceFromRow(r.al30d_last, r.al30d_bid, r.al30d_offer);
        const pAl30c = priceFromRow(r.al30c_last, r.al30c_bid, r.al30c_offer);
        if (!pAl30 || !pAl30d || !pAl30c) continue;
        const t = Date.parse(r.t); // TIMESTAMPTZ → ms
        if (!Number.isFinite(t)) continue;
        const canjePct = ((pAl30d / pAl30c) - 1) * 100;
        valid.push({
          t,
          xLabel: fmtTimeAR(t),
          mep:   +(pAl30  / pAl30d).toFixed(4),
          ccl:   +(pAl30  / pAl30c).toFixed(4),
          canje: +canjePct.toFixed(4),
        });
      }
      return valid;
    }
    // W / M / A: misma lógica priceFromRow pero el campo `last` no existe en
    // `daily_fx_closes` todavía → cae a mid(bid,offer) o close.
    const tf = TIMEFRAMES.find(t => t.key === timeframe);
    const wantLast = tf?.tail ?? 30;
    const valid = [];
    for (const r of hist) {
      const pAl30  = priceFromRow(r.al30_last,  r.al30_bid,  r.al30_offer,  r.al30_close);
      const pAl30d = priceFromRow(r.al30d_last, r.al30d_bid, r.al30d_offer, r.al30d_close);
      const pAl30c = priceFromRow(r.al30c_last, r.al30c_bid, r.al30c_offer, r.al30c_close);
      if (!pAl30 || !pAl30d || !pAl30c) continue;
      const canjePct = ((pAl30d / pAl30c) - 1) * 100;
      valid.push({
        x: r.date,
        xLabel: fmtDate(r.date),
        mep:   +(pAl30  / pAl30d).toFixed(4),
        ccl:   +(pAl30  / pAl30c).toFixed(4),
        canje: +canjePct.toFixed(4),
      });
    }
    return valid.slice(-wantLast);
  }, [timeframe, intra, hist]);

  const haveData = series.length > 1;
  const first    = haveData ? series[0] : null;
  const last     = haveData ? series[series.length - 1] : null;

  const stats = useMemo(() => {
    if (!haveData) return null;
    const calc = (key) => {
      const v0 = first[key];
      const vN = last[key];
      const delta = vN - v0;
      const deltaPct = v0 ? (delta / v0) * 100 : 0;
      let mn = Infinity, mx = -Infinity;
      for (const s of series) {
        if (s[key] < mn) mn = s[key];
        if (s[key] > mx) mx = s[key];
      }
      return { v0, vN, delta, deltaPct, min: mn, max: mx };
    };
    return { mep: calc('mep'), ccl: calc('ccl'), canje: calc('canje') };
  }, [series, haveData, first, last]);


  return (
    <div style={S.container}>
      <div style={S.header}>
        <h3 style={S.title}>EVOLUCIÓN DEL TIPO DE CAMBIO</h3>
        <div style={S.actions}>
          <div style={S.tfRow}>
            {TIMEFRAMES.map(t => (
              <button
                key={t.key}
                style={{ ...S.tfBtn, ...(timeframe === t.key ? S.tfBtnActive : {}) }}
                onClick={() => setTimeframe(t.key)}
                title={t.desc}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={S.grid}>
        {PANELS.map(p => (
          <RatioPanel
            key={p.key}
            title={p.title}
            formula={p.formula}
            color={p.color}
            dataKey={p.key}
            decimals={p.decimals}
            isPercent={p.isPercent}
            yStep={p.yStep}
            data={series}
            stat={stats?.[p.key]}
            timeframe={timeframe}
            loading={timeframe === 'D' ? (intraLoading && !haveData) : histLoading}
          />
        ))}
      </div>

    </div>
  );
}

function RatioPanel({ title, formula, color, dataKey, decimals, isPercent, yStep, data, stat, timeframe, loading }) {
  const haveData = Array.isArray(data) && data.length > 1;
  const isIntra  = timeframe === 'D';

  // Para DÍA usamos eje X numérico con timestamps + ticks fijos cada 30 min
  // (10:30, 11:00, ..., 17:00) — así queda prolijo y proporcional al horario
  // de la rueda. Para mensual/anual seguimos con eje categórico (1 punto =
  // 1 día, sin necesidad de espaciado temporal).
  const xTicks  = useMemo(() => isIntra ? dayXTicks() : undefined, [isIntra]);
  const xDomain = useMemo(() => isIntra ? dayXDomain() : undefined, [isIntra]);

  // Eje Y: SIEMPRE 5 marcas equiespaciadas, step base $10 / 1pp. niceTicks5
  // escala el step (1×, 2×, 5×, 10×…) si la data no entra en 4×base.
  const yAxis = useMemo(() => {
    if (!stat) return null;
    return niceTicks5(stat.min, stat.max, yStep);
  }, [stat, yStep]);

  // Share-as-image: cuando `capturing` es true, mostramos un header con el
  // logo D&G y un footer "Fuente: BYMA" dentro del panel. Capturamos el
  // panel entero con html2canvas y copiamos el PNG al clipboard.
  const panelRef = useRef(null);
  const [capturing, setCapturing] = useState(false);
  const [shareStatus, setShareStatus] = useState(null); // 'ok' | 'err' | null

  const handleShare = async () => {
    if (!panelRef.current) return;
    setShareStatus(null);
    setCapturing(true);
    try {
      // Esperar 2 frames para que React commitee el DOM con header/footer.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      // Lazy load de html2canvas (mismo pattern que FxHistoryChart).
      if (!window.html2canvas) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
          s.onload = res;
          s.onerror = () => rej(new Error('No se pudo cargar html2canvas'));
          document.head.appendChild(s);
        });
      }
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-card').trim() || '#0d1424';
      const canvas = await window.html2canvas(panelRef.current, {
        backgroundColor: bg,
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('No se pudo generar imagen');
      if (!navigator.clipboard?.write || typeof window.ClipboardItem === 'undefined') {
        throw new Error('Clipboard no soportado');
      }
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      setShareStatus('ok');
    } catch (e) {
      console.error('share fail:', e);
      setShareStatus('err');
    } finally {
      setCapturing(false);
      setTimeout(() => setShareStatus(null), 2000);
    }
  };

  const fmtVal = (v) => {
    if (v == null || !Number.isFinite(v)) return '—';
    const txt = fmtRatio(v, decimals);
    return isPercent ? `${txt}%` : txt;
  };

  const Tip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const v = payload[0]?.value;
    // En DÍA, `label` es un timestamp numérico → formateamos a HH:MM AR.
    // En W/M/A, label es ya el string xLabel categórico (DD/MM).
    const labelTxt = isIntra ? fmtTimeAR(label) : label;
    return (
      <div style={S.tip}>
        <div style={S.tipTime}>{labelTxt}</div>
        <div style={{ ...S.tipValue, color }}>{fmtVal(v)}</div>
      </div>
    );
  };

  return (
    <div ref={panelRef} style={S.panel}>
      {/* Logo D&G arriba — sólo durante captura */}
      {capturing && (
        <div style={S.shareLogoRow}>
          <img src="/logos/DG%20tema%20oscuro.png" alt="D&G DATA" style={S.shareLogo} />
        </div>
      )}

      <div style={S.panelHeader}>
        <div style={{ minWidth: 0 }}>
          <span style={{ ...S.panelTitle, color }}>{title}</span>
          <span style={S.panelSub}>{formula}</span>
        </div>
        <div style={S.panelHeaderRight}>
          {haveData && stat && (
            <div style={S.panelStat}>
              <span style={{ ...S.panelStatVal, color }}>{fmtVal(stat.vN)}</span>
              <span style={{
                ...S.panelStatDelta,
                color: stat.delta >= 0 ? 'var(--neon)' : 'var(--red)',
              }}>
                {/* En paneles % mostramos delta absoluto en pp; en ratios, delta % relativo. */}
                {isPercent
                  ? `${stat.delta >= 0 ? '+' : ''}${stat.delta.toFixed(2)}pp`
                  : `${stat.deltaPct >= 0 ? '+' : ''}${stat.deltaPct.toFixed(2)}%`}
              </span>
            </div>
          )}
          {/* Share button — escondido durante la captura para no aparecer en la PNG */}
          {!capturing && (
            <button
              onClick={handleShare}
              style={{
                ...S.shareBtn,
                ...(shareStatus === 'ok'  ? S.shareBtnOk  : {}),
                ...(shareStatus === 'err' ? S.shareBtnErr : {}),
              }}
              title={
                shareStatus === 'ok'  ? '¡Copiado al portapapeles!' :
                shareStatus === 'err' ? 'Error al copiar' :
                                        'Copiar como imagen'
              }
              aria-label="Copiar como imagen"
            >
              {shareStatus === 'ok' ? '✓' : shareStatus === 'err' ? '×' : '⧉'}
            </button>
          )}
        </div>
      </div>

      <div style={S.chartBox}>
        {loading ? (
          <div style={S.empty}>
            <span>Cargando…</span>
          </div>
        ) : !haveData ? (
          <div style={S.empty}>
            <span>{isIntra ? 'Sin muestras todavía hoy' : 'Sin datos en el rango'}</span>
            <span style={S.emptyHint}>
              {isIntra
                ? 'El server guarda 1 muestra cada 5 min mientras el mercado está abierto.'
                : 'Los cierres diarios se acumulan en el server cada rueda.'}
            </span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              {isIntra ? (
                <XAxis
                  type="number"
                  dataKey="t"
                  domain={xDomain}
                  ticks={xTicks}
                  tickFormatter={fmtTimeAR}
                  tick={{ fill: 'var(--text-dim)', fontSize: 9 }}
                  tickLine={{ stroke: 'var(--border)' }}
                  axisLine={{ stroke: 'var(--border)' }}
                  scale="time"
                />
              ) : (
                <XAxis
                  dataKey="xLabel"
                  tick={{ fill: 'var(--text-dim)', fontSize: 9 }}
                  tickLine={{ stroke: 'var(--border)' }}
                  axisLine={{ stroke: 'var(--border)' }}
                  interval="preserveStartEnd"
                  minTickGap={12}
                />
              )}
              <YAxis
                tick={{ fill: 'var(--text-dim)', fontSize: 9 }}
                tickLine={{ stroke: 'var(--border)' }}
                axisLine={{ stroke: 'var(--border)' }}
                domain={yAxis?.domain || ['auto', 'auto']}
                ticks={yAxis?.ticks}
                allowDataOverflow={false}
                tickFormatter={v => fmtVal(v)}
                width={isPercent ? 50 : 56}
              />
              <Tooltip content={<Tip />} />
              {stat && (
                <ReferenceLine
                  y={stat.v0}
                  stroke={color}
                  strokeOpacity={0.35}
                  strokeDasharray="3 3"
                />
              )}
              <Line
                type={isIntra ? 'linear' : 'monotone'}
                dataKey={dataKey}
                stroke={color}
                strokeWidth={1.6}
                dot={false}
                activeDot={{ r: 3, fill: color, stroke: 'var(--bg-card)', strokeWidth: 1 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {haveData && stat && (
        <div style={S.panelFooter}>
          <span><span style={S.statLabel}>{timeframe === 'D' ? 'APERTURA' : 'INICIO'}</span> {fmtVal(stat.v0)}</span>
          <span><span style={S.statLabel}>MIN</span> {fmtVal(stat.min)}</span>
          <span><span style={S.statLabel}>MAX</span> {fmtVal(stat.max)}</span>
        </div>
      )}

      {/* Pie de captura: aparece sólo cuando se está copiando como imagen */}
      {capturing && (
        <div style={S.shareSourceRow}>Fuente: BYMA</div>
      )}
    </div>
  );
}

const S = {
  container: { marginTop: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', overflow: 'hidden' },
  header:    { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' },
  title:     { fontFamily: "'Roboto', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: 4, color: 'var(--neon)', textShadow: 'var(--neon-glow)', margin: 0 },
  sub:       { fontFamily: "'Roboto Mono', monospace", fontSize: 10, color: 'var(--text-dim)', letterSpacing: 1, marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  discBadge: { padding: '1px 6px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', borderRadius: 3, fontWeight: 700 },

  actions:   { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  tfRow:     { display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' },
  tfBtn:     { background: 'transparent', border: 'none', padding: '6px 12px', fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: 'var(--text-dim)', cursor: 'pointer', transition: 'all 0.15s' },
  tfBtnActive: { background: 'var(--neon)', color: '#000' },
  clearBtn:  { background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: 1.5, padding: '5px 10px', cursor: 'pointer' },

  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, padding: 16 },

  panel:       { position: 'relative', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 },
  panelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  panelHeaderRight: { display: 'flex', alignItems: 'flex-start', gap: 8 },
  panelTitle:  { fontFamily: "'Roboto', sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: 4, display: 'block', textShadow: '0 0 8px rgba(0,255,170,0.15)' },
  panelSub:    { fontFamily: "'Roboto Mono', monospace", fontSize: 10, color: 'var(--text-dim)', letterSpacing: 1, display: 'block', marginTop: 3 },
  panelStat:   { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 },
  panelStatVal:   { fontFamily: "'Roboto Mono', monospace", fontSize: 16, fontWeight: 700 },
  panelStatDelta: { fontFamily: "'Roboto Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: 0.5 },

  // Share: botón en el header del panel, header de logo y footer "Fuente: BYMA"
  // se renderizan SÓLO durante la captura (capturing=true) para que aparezcan
  // en la PNG pero no en la UI normal.
  shareBtn:    { background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, padding: '3px 7px', fontFamily: "'Roboto Mono', monospace", fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', cursor: 'pointer', lineHeight: 1, marginTop: 1, transition: 'all 0.15s' },
  shareBtnOk:  { borderColor: 'var(--neon)', color: 'var(--neon)' },
  shareBtnErr: { borderColor: '#ef4444', color: '#ef4444' },
  shareLogoRow: { display: 'flex', alignItems: 'center', justifyContent: 'flex-start', paddingBottom: 8, borderBottom: '1px solid var(--border)', marginBottom: 4 },
  shareLogo:    { height: 28, width: 'auto', display: 'block' },
  shareSourceRow: { paddingTop: 8, borderTop: '1px solid var(--border)', marginTop: 4, fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 2, color: 'var(--text-dim)', textAlign: 'right' },

  chartBox: { width: '100%', minHeight: 220 },
  empty:    { height: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace", fontSize: 11 },
  emptyHint:{ fontSize: 9, opacity: 0.7, textAlign: 'center', maxWidth: 240, lineHeight: 1.5 },

  panelFooter: { display: 'flex', justifyContent: 'space-between', gap: 8, fontFamily: "'Roboto Mono', monospace", fontSize: 9, color: 'var(--text-dim)', letterSpacing: 0.5, paddingTop: 6, borderTop: '1px dashed var(--border)' },
  statLabel:   { color: 'var(--text-dim)', opacity: 0.6, marginRight: 4, letterSpacing: 1.5 },

  tip:      { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 10px', fontFamily: "'Roboto Mono', monospace", fontSize: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' },
  tipTime:  { color: 'var(--text-dim)', marginBottom: 3, letterSpacing: 1 },
  tipValue: { fontWeight: 700, fontSize: 12 },

  footer: { display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, padding: '10px 20px', borderTop: '1px solid var(--border)', fontFamily: "'Roboto Mono', monospace", fontSize: 9, color: 'var(--text-dim)', letterSpacing: 0.5 },
};

import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

// ─────────────────────────────────────────────────────────────────────────────
//  HOME — DASHBOARD 2×2
//
//  Layout: grilla de 4 cards.
//    ┌─────────────────┬─────────────────┐
//    │ APERTURAS       │ LINKS ÚTILES    │
//    ├─────────────────┼─────────────────┤
//    │ PRÓXIMOS PAGOS  │  (vacía)        │
//    └─────────────────┴─────────────────┘
//
//  - "Aperturas" tiene un interruptor DELFINO/GAVIÑA arriba y 3 sub-cards
//    (INVIU LOCAL / PERSHING / IBKR). Al clickear una sub-card, copia al
//    portapapeles el URL + "Alias asesor: <alias>" según el interruptor.
//  - "Próximos pagos" muestra el calendario bursátil de Bolsar (ICS de Google
//    Calendar), cacheado 6h server-side y 1 día client-side.
// ─────────────────────────────────────────────────────────────────────────────

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const GREEN = '#22c55e';
// Nuevo cache key: v3 = calendario directo de Bolsar (ICS de Google Calendar).
// El server cachea 6h en memoria; el cliente extra-cachea 1 día en localStorage.
const CACHE_KEY = 'hp_bolsar_cal_v1'; // { fetchedOn: 'YYYY-MM-DD', events: [...] }

// Feriados nacionales AR — lista estática 2025-2026.
const HOLIDAYS = {
  '2025-01-01': 'Año Nuevo', '2025-03-03': 'Carnaval', '2025-03-04': 'Carnaval',
  '2025-03-24': 'Memoria', '2025-04-02': 'Malvinas', '2025-04-18': 'Viernes Santo',
  '2025-05-01': 'Día del Trabajador', '2025-05-02': 'Puente turístico',
  '2025-05-25': 'Revolución de Mayo', '2025-06-16': 'Güemes (traslado)',
  '2025-06-20': 'Día de la Bandera', '2025-07-09': 'Independencia',
  '2025-08-17': 'Gral. San Martín', '2025-10-12': 'Diversidad Cultural',
  '2025-11-24': 'Soberanía Nacional', '2025-12-08': 'Inmaculada Concepción',
  '2025-12-25': 'Navidad',
  '2026-01-01': 'Año Nuevo', '2026-02-16': 'Carnaval', '2026-02-17': 'Carnaval',
  '2026-03-24': 'Memoria', '2026-04-02': 'Malvinas', '2026-04-03': 'Viernes Santo',
  '2026-05-01': 'Día del Trabajador', '2026-05-25': 'Revolución de Mayo',
  '2026-06-15': 'Güemes (traslado)', '2026-06-20': 'Día de la Bandera',
  '2026-07-09': 'Independencia', '2026-08-17': 'Gral. San Martín',
  '2026-10-12': 'Diversidad Cultural', '2026-11-23': 'Soberanía (traslado)',
  '2026-12-08': 'Inmaculada Concepción', '2026-12-25': 'Navidad',
};

// ── Helpers ──
function fmtN(v, dec = 2) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}
function todayYmd() { return ymd(new Date()); }
function cuttingYmd(raw) {
  if (!raw) return null;
  const s = String(raw);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d)) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}
function ymdToLocalDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function dayLabel(d) {
  const s = d.toLocaleDateString('es-AR', { weekday: 'short' });
  return s.replace('.', '').toUpperCase();
}
function dateLabel(d) {
  const month = d.toLocaleDateString('es-AR', { month: 'short' }).replace('.', '').toUpperCase();
  return `${String(d.getDate()).padStart(2, '0')} ${month}`;
}
function monthLabelFull(d) {
  const s = d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// Índice Lunes-primero (L=0, M=1, ..., D=6) a partir de Date.getDay() (0=Dom..6=Sáb).
function mondayIndex(d) { return (d.getDay() + 6) % 7; }
function kindLabel(k) {
  switch (k) {
    case 'renta':        return 'Renta';
    case 'amortizacion': return 'Amortización';
    case 'dividendo':    return 'Dividendo';
    case 'feriado':      return 'Feriado';
    case 'vencimiento':  return 'Vencimiento';
    default:             return 'Pago';
  }
}
function currencyTag(c) {
  if (!c) return '';
  const up = String(c).toUpperCase();
  if (up.includes('USD') || up.includes('DOLAR') || up.includes('DÓLAR')) return 'USD';
  if (up.includes('ARS') || up.includes('PESO')) return 'ARS';
  return up.slice(0, 4);
}

export default function HomePage() {
  return (
    <div style={S.grid}>
      <AperturasCard />
      <LinksUtilesCard />
      <ProximosPagosCard />
      <EmptyCard slotIndex={2} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  CARD · PRÓXIMOS PAGOS
// ═══════════════════════════════════════════════════════════════════════════

function ProximosPagosCard() {
  // `events` es la lista cruda del endpoint: [{ date, kind, tickers[], label }]
  // donde kind ∈ amortizacion|renta|dividendo|feriado|vencimiento|otro.
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [hover, setHover] = useState(false);
  // Qué celda tiene su popover abierto (o null). Se levanta a este nivel para
  // que al sacar el mouse del card se cierren TODOS los popovers de una:
  // si el cursor sale rápido por un borde y nunca dispara el onMouseLeave de
  // la celda, el popover quedaba colgado. Desde acá lo apagamos siempre.
  const [openKey, setOpenKey] = useState(null);

  const load = async (force = false) => {
    setErr('');
    const today = todayYmd();
    if (!force) {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached && cached.fetchedOn === today && Array.isArray(cached.events)) {
            setEvents(cached.events);
            setLastUpdate(cached.fetchedAt ? new Date(cached.fetchedAt) : null);
            setLoading(false);
            return;
          }
        }
      } catch { /* cache corrupto: refetch */ }
    }
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/bolsar/calendar`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const evs = Array.isArray(data?.events) ? data.events : [];
      const now = new Date();
      setEvents(evs); setLastUpdate(now);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          fetchedOn: today, fetchedAt: now.toISOString(), events: evs,
        }));
      } catch { /* cuota */ }
    } catch (e) { setErr(e.message || 'Error cargando calendario'); setEvents([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // ── Estado de navegación del calendario ──
  // `monthOffset` = diferencia en meses respecto del mes actual (0 = hoy).
  const [monthOffset, setMonthOffset] = useState(0);

  // Index events por fecha (YYYY-MM-DD). Cada día acumula sus pagos/tickers y
  // los feriados del feed de Bolsar. Los feriados estáticos (HOLIDAYS) sirven
  // como fallback si el ICS todavía no cargó o hay desfasaje.
  const byDate = useMemo(() => {
    const m = new Map();
    for (const e of events) {
      if (!m.has(e.date)) m.set(e.date, { payments: [], feriados: [] });
      const bucket = m.get(e.date);
      if (e.kind === 'feriado') {
        bucket.feriados.push(e.label);
      } else if (Array.isArray(e.tickers) && e.tickers.length) {
        for (const t of e.tickers) bucket.payments.push({ ticker: t, kind: e.kind });
      } else if (e.kind === 'amortizacion' || e.kind === 'renta' || e.kind === 'dividendo') {
        // Evento de pago sin tickers parseados: usa el label como "ticker"
        // (ej. "Pago de amortización" sin detalle).
        bucket.payments.push({ ticker: e.label, kind: e.kind, isLabel: true });
      }
    }
    return m;
  }, [events]);

  // Construye la matriz del mes visible (6 filas × 7 columnas, Lun-primero).
  // Cada celda lleva su fecha, si pertenece al mes visible, si es hoy, si es
  // feriado, si es finde, y los pagos del día (solo tickers — sin montos).
  const { cells, monthTitle, totalPaymentsMonth } = useMemo(() => {
    const today = new Date();
    const todayKey = todayYmd();
    const viewMonth = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    // Primer día del mes → retroceder al lunes de esa semana.
    const firstCell = new Date(viewMonth);
    firstCell.setDate(1 - mondayIndex(firstCell));
    const out = [];
    let monthCount = 0;
    for (let i = 0; i < 42; i++) {
      const d = new Date(firstCell);
      d.setDate(firstCell.getDate() + i);
      const key = ymd(d);
      const inMonth = d.getMonth() === viewMonth.getMonth();
      const wi = mondayIndex(d);
      const isWeekend = wi >= 5; // Sáb / Dom
      const bucket = byDate.get(key);
      const bolsarFeriado = bucket?.feriados?.[0] || null;
      const holiday = bolsarFeriado || HOLIDAYS[key] || null;
      const payments = bucket?.payments || [];
      if (inMonth) monthCount += payments.length;
      out.push({
        date: d, key, inMonth,
        isToday: key === todayKey,
        isWeekend, holiday, payments,
      });
    }
    return { cells: out, monthTitle: monthLabelFull(viewMonth), totalPaymentsMonth: monthCount };
  }, [byDate, monthOffset]);

  const cardStyle = { ...S.card, ...(hover ? S.cardHover : {}) };

  return (
    <div
      style={cardStyle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setOpenKey(null); }}
    >
      <div style={S.cardHeader}>
        <div>
          <div style={S.cardTitle}>PRÓXIMOS PAGOS</div>
          <div style={S.cardSub}>{monthTitle}</div>
        </div>
        <div style={S.cardTools}>
          <button style={S.navBtn} onClick={() => setMonthOffset(o => o - 1)} title="Mes anterior">‹</button>
          <button
            style={{ ...S.navBtn, ...(monthOffset === 0 ? S.navBtnActive : {}) }}
            onClick={() => setMonthOffset(0)}
            title="Volver a hoy"
          >HOY</button>
          <button style={S.navBtn} onClick={() => setMonthOffset(o => o + 1)} title="Mes siguiente">›</button>
          {lastUpdate && (
            <span style={S.ts} title="Los flujos se cachean una vez por día. Refresh fuerza un nuevo fetch a PPI.">
              {lastUpdate.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
            </span>
          )}
          <button
            style={S.refreshBtn}
            onClick={() => load(true)}
            disabled={loading}
            title="Forzar refresh"
          >{loading ? '…' : '↻'}</button>
        </div>
      </div>

      {err && <div style={S.errBox}>{err}</div>}

      {/* Leyenda: color por tipo de cobro (mismas CSS vars que los chips,
          theme-aware). */}
      <div style={S.legend}>
        <LegendItem
          label="Renta"
          colorVar="var(--cal-chip-renta-fg)"
          bg="var(--cal-chip-renta-bg)"
          border="var(--cal-chip-renta-border)"
        />
        <LegendItem
          label="Amortización"
          colorVar="var(--cal-chip-amort-fg)"
          bg="var(--cal-chip-amort-bg)"
          border="var(--cal-chip-amort-border)"
        />
      </div>

      {/* Cabecera de días (Lun-primero, igual que bolsar). */}
      <div style={S.weekHeader}>
        {['L','M','M','J','V','S','D'].map((w, i) => (
          <div key={i} style={{ ...S.weekHeaderCell, color: i >= 5 ? 'var(--text-dim)' : 'var(--neon)' }}>{w}</div>
        ))}
      </div>

      {/* Grilla 6×7 del mes visible. */}
      <div style={S.calGrid}>
        {cells.map(c => (
          <CalCell
            key={c.key}
            c={c}
            isOpen={openKey === c.key}
            onOpen={() => setOpenKey(c.key)}
            onClose={() => setOpenKey(k => (k === c.key ? null : k))}
          />
        ))}
      </div>

      <div style={S.summaryRow}>
        <span>{loading ? 'Cargando…' : `${totalPaymentsMonth} pago${totalPaymentsMonth === 1 ? '' : 's'} · ${monthTitle}`}</span>
        <span>Bolsar · Calendario bursátil</span>
      </div>
    </div>
  );
}

// ── Leyenda de colores por tipo de cobro (arriba del calendario). ──
function LegendItem({ label, colorVar, bg, border }) {
  return (
    <span style={S.legendItem}>
      <span style={{ ...S.legendSwatch, background: bg, borderColor: border }} />
      <span style={{ ...S.legendLabel, color: colorVar }}>{label}</span>
    </span>
  );
}

// ── Celda del calendario ──
// Pinta días fuera de mes con opacidad baja. Fines de semana y feriados quedan
// rellenos de gris. Se listan los tickers con pagos del día (sin montos).
// En hover, si hay pagos, aparece un popover absoluto con TODOS los pagos;
// si exceden el alto del popover hay scroll interno sin scrollbar visible.
function CalCell({ c, isOpen, onOpen, onClose }) {
  // `isOpen` lo controla ProximosPagosCard (openKey). La celda solo dispara
  // onOpen/onClose; así, cuando el mouse sale del card entero, el padre apaga
  // todos los popovers de una sola pasada (evita popovers huérfanos si el
  // cursor sale rápido por un borde y no pasa por el onMouseLeave de la celda).
  const [pos, setPos] = useState(null); // { top, left } en coords de viewport
  const cellRef = useRef(null);
  const muted = c.isWeekend || !!c.holiday;
  const hasPays = c.payments.length > 0;
  const cellStyle = {
    ...S.calCell,
    ...(muted ? S.calCellMuted : {}),
    ...(c.isToday ? S.calCellToday : {}),
    ...(!c.inMonth ? S.calCellOther : {}),
  };
  const dayColor = c.isToday ? 'var(--neon)' : c.inMonth ? 'var(--text)' : 'var(--text-dim)';
  const title = c.holiday ? `${dateLabel(c.date)} · ${c.holiday}` : dateLabel(c.date);

  // Al entrar con el mouse, capturamos la posición absoluta de la celda en el
  // viewport y posicionamos el popover (fixed + portal al body) debajo del
  // número del día. Si no hay espacio a la derecha, lo alineamos a la derecha
  // de la celda. Eso garantiza que nunca quede clipped por el card padre.
  const POP_W = 190; // debe coincidir con calCellPopover.width
  const handleEnter = () => {
    if (!hasPays) { onOpen(); return; }
    const rect = cellRef.current?.getBoundingClientRect();
    if (rect) {
      const spaceRight = window.innerWidth - rect.left;
      const left = spaceRight < POP_W + 12 ? rect.right - POP_W : rect.left;
      setPos({ top: rect.top + 18, left: Math.max(4, left) });
    }
    onOpen();
  };

  // `size` = 'sm' (vista compacta) | 'lg' (popover de hover).
  const renderChip = (p, i, size = 'sm') => {
    const base = size === 'lg' ? S.calTickerChipLg : S.calTickerChip;
    // Los colores vienen de CSS vars (theme-aware): en tema claro resaltan
    // más sobre el fondo cream que los rgba neon del modo oscuro.
    const chipStyle = {
      ...base,
      color: 'var(--cal-chip-renta-fg)',
      background: 'var(--cal-chip-renta-bg)',
      border: '1px solid var(--cal-chip-renta-border)',
      ...(p.kind === 'amortizacion' ? S.chipAmort : {}),
    };
    return (
      <span
        key={`${p.ticker}-${i}`}
        style={chipStyle}
        title={`${p.ticker} · ${kindLabel(p.kind)}`}
      >{p.isLabel ? kindLabel(p.kind) : p.ticker}</span>
    );
  };

  return (
    <div
      ref={cellRef}
      style={cellStyle}
      title={title}
      onMouseEnter={handleEnter}
      onMouseLeave={onClose}
    >
      <div style={S.calCellHead}>
        <span style={{ ...S.calCellDay, color: dayColor }}>{String(c.date.getDate()).padStart(2, '0')}</span>
        {c.isToday && <span style={S.calTodayDot} />}
      </div>
      {c.holiday && <span style={S.calHolidayTag} title={c.holiday}>FER.</span>}

      {/* Vista compacta por defecto: primeros 4 chips + "+N". */}
      {hasPays && !isOpen && (
        <div style={S.calCellPays}>
          {c.payments.slice(0, 4).map((p, i) => renderChip(p, i, 'sm'))}
          {c.payments.length > 4 && (
            <span style={S.calMoreChip}>+{c.payments.length - 4}</span>
          )}
        </div>
      )}

      {/* Hover: popover renderizado en <body> vía portal con position: fixed.
          Nunca queda clipped por el card padre. Scroll sin scrollbar. */}
      {hasPays && isOpen && pos && createPortal(
        <div
          style={{ ...S.calCellPopover, top: pos.top, left: pos.left, width: POP_W }}
          className="no-scrollbar"
          onMouseEnter={onOpen}
          onMouseLeave={onClose}
        >
          {c.payments.map((p, i) => renderChip(p, i, 'lg'))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  CARD · APERTURAS
//
//  Copia al portapapeles el URL de onboarding + "Alias asesor: <alias>" según
//  el interruptor de asesor (DELFINO / GAVIÑA). Muestra feedback "✓ COPIADO"
//  en la sub-card clickeada durante ~1.5s.
// ═══════════════════════════════════════════════════════════════════════════

// Los 3 canales de apertura. El orden refleja la prioridad comercial
// (local → offshore Pershing → offshore IBKR).
const APERTURAS = [
  {
    key: 'local',
    title: 'INVIU LOCAL',
    subtitle: 'Cuenta local · BYMA',
    url: 'https://inversor.inviu.com.ar/register',
    color: '#22C55E', // verde — mismo que backend INVIU en LINKS ÚTILES
  },
  {
    key: 'pershing',
    title: 'INVIU PERSHING',
    subtitle: 'Offshore · Pershing (NY)',
    url: 'https://onboarding.pershing.inviu.com.uy/human',
    color: '#3B82F6', // azul institucional
  },
  {
    key: 'ibkr',
    title: 'INVIU IBKR',
    subtitle: 'Offshore · Interactive Brokers',
    url: 'https://onboarding.ibkr.inviu.com.uy/human',
    color: '#8B5CF6', // violeta — distingue de los otros dos
  },
];

// Alias según asesor. Sin tildes (copy-paste robusto) y en MAYÚSCULAS, como
// se usan en el flow real de onboarding.
const ALIAS_BY_ASESOR = {
  delfino: 'DELFINO.INVIU',
  gavina:  'GAVINA.INVIU',
};

function AperturasCard() {
  const [hover, setHover] = useState(false);
  // Asesor seleccionado: 'delfino' | 'gavina'. Persiste en localStorage para
  // que cada usuario vuelva con su preferencia ya seteada.
  const [asesor, setAsesor] = useState(() => {
    try { return localStorage.getItem('hp_aperturas_asesor') || 'delfino'; }
    catch { return 'delfino'; }
  });
  useEffect(() => {
    try { localStorage.setItem('hp_aperturas_asesor', asesor); } catch {}
  }, [asesor]);

  // Qué sub-card acaba de copiar (muestra "✓ COPIADO" por ~1.5s). Guardamos
  // el timer en un ref para poder cancelarlo si el user hace click en otra.
  const [copiedKey, setCopiedKey] = useState(null);
  const copyTimerRef = useRef(null);

  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

  const alias = ALIAS_BY_ASESOR[asesor];

  const handleCopy = async (cfg) => {
    const text = `${cfg.url}\nAlias asesor: ${alias}`;
    // Preferimos Clipboard API; fallback a textarea + execCommand por si
    // el contexto no es seguro (http://localhost con ciertos browsers).
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedKey(cfg.key);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // Si todo falla, al menos no rompemos: dejamos el "COPIADO" sin setear.
    }
  };

  const cardStyle = { ...S.card, ...(hover ? S.cardHover : {}) };

  return (
    <div
      style={cardStyle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={S.cardHeader}>
        <div>
          <div style={S.cardTitle}>APERTURAS</div>
          <div style={S.cardSub}>Copiar link + alias asesor</div>
        </div>
      </div>

      {/* Interruptor DELFINO / GAVIÑA — segmented control con slider animado. */}
      <div style={S.asesorSwitch} role="tablist" aria-label="Asesor">
        <div
          style={{
            ...S.asesorSwitchThumb,
            transform: asesor === 'gavina' ? 'translateX(100%)' : 'translateX(0%)',
          }}
        />
        <button
          type="button"
          role="tab"
          aria-selected={asesor === 'delfino'}
          style={{ ...S.asesorSwitchBtn, ...(asesor === 'delfino' ? S.asesorSwitchBtnActive : {}) }}
          onClick={() => setAsesor('delfino')}
        >
          DELFINO
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={asesor === 'gavina'}
          style={{ ...S.asesorSwitchBtn, ...(asesor === 'gavina' ? S.asesorSwitchBtnActive : {}) }}
          onClick={() => setAsesor('gavina')}
        >
          GAVIÑA
        </button>
      </div>

      <div style={S.asesorAliasRow}>
        <span style={S.asesorAliasLabel}>ALIAS ACTIVO</span>
        <span style={S.asesorAliasValue}>{alias}</span>
      </div>

      <div style={S.aperturasList}>
        {APERTURAS.map(cfg => (
          <AperturaRow
            key={cfg.key}
            cfg={cfg}
            copied={copiedKey === cfg.key}
            onCopy={() => handleCopy(cfg)}
          />
        ))}
      </div>
    </div>
  );
}

function AperturaRow({ cfg, copied, onCopy }) {
  const [hover, setHover] = useState(false);
  const accent = cfg.color;
  const rowStyle = {
    ...S.aperturaRow,
    borderColor: hover || copied ? accent : 'var(--border)',
    borderLeft: `3px solid ${accent}`,
    ...(hover
      ? {
          background: `linear-gradient(180deg, ${hexToRgba(accent, 0.08)} 0%, var(--bg-card) 70%)`,
          transform: 'translateX(2px)',
        }
      : {}),
    ...(copied
      ? { background: hexToRgba(accent, 0.14) }
      : {}),
  };

  return (
    <button
      type="button"
      style={rowStyle}
      onClick={onCopy}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`${cfg.url}\nClick para copiar`}
    >
      <div style={S.aperturaRowText}>
        <span style={{ ...S.aperturaTitle, color: hover || copied ? accent : 'var(--text)' }}>
          {cfg.title}
        </span>
        <span style={S.aperturaSub}>{cfg.subtitle}</span>
      </div>
      <span style={{ ...S.aperturaStatus, color: accent }}>
        {copied ? '✓ COPIADO' : '⧉ COPIAR'}
      </span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  CARD · LINKS ÚTILES (placeholder)
// ═══════════════════════════════════════════════════════════════════════════

// Links de información: herramientas públicas de consulta.
const INFO_LINKS = [
  { title: 'CURVAS TASA PESOS · FIJA, CER', url: 'https://breakeven.ar/curvas' },
  { title: 'BOND TERMINAL',                 url: 'https://bondterminal.com/' },
];

// Links de gestión: backends operativos de brokers. Cada uno con su color
// corporativo para que el ojo los identifique sin leer. NETX360 combina
// azul (texto/acento) con borde naranja (identidad Pershing).
const GESTION_LINKS = [
  { title: 'BACKEND INVIU',  url: 'https://asesor.inviu.com.ar/cval/BYMA/clients',                 color: '#22C55E' },
  { title: 'BACKEND PPI',    url: 'https://backend.portfoliopersonal.com/',                        color: '#3B82F6' },
  { title: 'BACKEND GLETIR', url: 'https://backend.gletir.com/Cuenta/Login?ReturnUrl=%2fCuenta',   color: '#64748B' },
  { title: 'NETX360',        url: 'https://www2.netx360.com/',                                     color: '#2563EB', borderColor: '#F97316' },
  // TABLEAU: naranja azulado (brand orange Tableau #E8762C apagado hacia el azul).
  { title: 'TABLEAU',        url: 'https://dashboards.portfoliopersonal.com/#/signin',             color: '#CC7A4C' },
];

function LinksUtilesCard() {
  const [hover, setHover] = useState(false);
  const cardStyle = { ...S.card, ...(hover ? S.cardHover : {}) };

  return (
    <div
      style={cardStyle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={S.cardHeader}>
        <div>
          <div style={S.cardTitle}>LINKS ÚTILES</div>
          <div style={S.cardSub}>Accesos rápidos</div>
        </div>
      </div>

      <div style={S.linksGroup}>
        <div style={S.linksGroupLabel}>INFORMACIÓN</div>
        <div style={S.linksList}>
          {INFO_LINKS.map((l, i) => (
            <LinkRow key={i} link={l} />
          ))}
        </div>
      </div>

      <div style={{ ...S.linksGroup, marginTop: 12 }}>
        <div style={S.linksGroupLabel}>GESTIÓN</div>
        <div style={S.linksList}>
          {GESTION_LINKS.map((l, i) => (
            <LinkRow key={i} link={l} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Convierte un hex (#RRGGBB / #RGB) a rgba(...) con el alpha que le pases.
// Si el valor no empieza con "#" lo devuelve tal cual (útil para var(--…)).
function hexToRgba(hex, a = 1) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(v => isNaN(v))) return hex;
  return `rgba(${r},${g},${b},${a})`;
}

function LinkRow({ link }) {
  const [hover, setHover] = useState(false);
  const accent = link.color || 'var(--neon)';
  // Si el link trae borderColor propio (caso NETX360 → naranja Pershing),
  // lo mantenemos fijo incluso en hover. Si no, el borde sólo se enciende
  // al pasar el mouse con el color de acento.
  const persistBorder = link.borderColor;
  const currentBorder = persistBorder ?? (hover ? accent : 'var(--border)');

  const rowStyle = {
    ...S.linkRow,
    borderColor: currentBorder,
    borderLeft: `3px solid ${accent}`,
    ...(hover
      ? {
          background: `linear-gradient(180deg, ${hexToRgba(accent, 0.08)} 0%, var(--bg-card) 70%)`,
          transform: 'translateX(2px)',
        }
      : {}),
  };

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      style={rowStyle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span style={{ ...S.linkTitle, color: hover ? accent : 'var(--text)' }}>{link.title}</span>
      <span style={{ ...S.linkArrow, color: hover ? accent : 'var(--text-dim)' }}>↗</span>
    </a>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  CARD · EMPTY (placeholder sin título aún)
// ═══════════════════════════════════════════════════════════════════════════

function EmptyCard({ slotIndex }) {
  const [hover, setHover] = useState(false);
  const cardStyle = { ...S.card, ...(hover ? S.cardHover : {}) };

  return (
    <div
      style={cardStyle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={S.cardHeader}>
        <div>
          <div style={{ ...S.cardTitle, color: 'var(--text-dim)' }}>SLOT {slotIndex + 1}</div>
          <div style={S.cardSub}>Disponible</div>
        </div>
      </div>

      <div style={S.placeholderBody}>
        <div style={{ ...S.placeholderIcon, opacity: hover ? 0.7 : 0.25, fontSize: 44 }}>＋</div>
        <div style={S.placeholderText}>Card vacía</div>
        <div style={S.placeholderHint}>Por definir — reservá este espacio para un panel adicional.</div>
      </div>
    </div>
  );
}

// ─── Estilos ───
const S = {
  // Grilla 2×2. `minmax(0, ...)` evita que el contenido fuerce overflow horizontal.
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gridAutoRows: 'minmax(360px, auto)',
    gap: 16,
  },

  // Cada card
  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column',
    transition: 'transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease, background 0.22s ease',
    minHeight: 360,
    overflow: 'hidden',
  },
  // Hover: lift + neon glow. Se suma a S.card.
  cardHover: {
    transform: 'translateY(-2px)',
    borderColor: 'var(--neon)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.35), 0 0 18px rgba(0,255,170,0.12), inset 0 0 12px rgba(0,255,170,0.03)',
    background: 'linear-gradient(180deg, rgba(0,255,170,0.035) 0%, var(--bg-card) 70%)',
  },

  cardHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
    gap: 10, flexWrap: 'wrap', marginBottom: 12,
    paddingBottom: 10, borderBottom: '1px solid var(--border)',
  },
  cardTitle: { fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 18, fontWeight: 600, letterSpacing: 4, color: 'var(--neon)', textShadow: 'var(--neon-glow)' },
  cardSub: { fontFamily: "'Roboto Mono',monospace", fontSize: 9, color: 'var(--text-dim)', letterSpacing: 1, marginTop: 3 },
  cardTools: { display: 'flex', alignItems: 'center', gap: 8 },
  ts: { fontFamily: "'Roboto Mono',monospace", fontSize: 9, color: 'var(--text-dim)', letterSpacing: 1 },
  refreshBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--neon-dim)', fontSize: 13, padding: '2px 8px', cursor: 'pointer' },

  errBox: { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 3, padding: '6px 10px', marginBottom: 10, color: '#ef4444', fontFamily: "'Roboto Mono',monospace", fontSize: 10 },

  // ── Botones de navegación del calendario ──
  navBtn: {
    background: 'none', border: '1px solid var(--border)', borderRadius: 3,
    color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace", fontSize: 10,
    fontWeight: 700, letterSpacing: 1, padding: '2px 8px', cursor: 'pointer',
    minWidth: 24, lineHeight: 1.4,
  },
  navBtnActive: { color: 'var(--neon)', borderColor: 'var(--neon)', background: 'rgba(0,255,170,0.06)' },

  // Leyenda de tipos de cobro, arriba del calendario.
  legend: {
    display: 'flex', gap: 18, flexWrap: 'wrap',
    padding: '10px 4px', marginBottom: 8,
    borderBottom: '1px dashed var(--border)',
  },
  legendItem: {
    display: 'inline-flex', alignItems: 'center', gap: 10,
  },
  legendSwatch: {
    width: 28, height: 18, borderRadius: 3, border: '1px solid',
  },
  legendLabel: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 11, fontWeight: 700,
    letterSpacing: 1.5, textTransform: 'uppercase',
  },

  // Cabecera de días de la semana (L M M J V S D).
  weekHeader: {
    display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 3, marginBottom: 4,
  },
  weekHeaderCell: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 9, fontWeight: 700,
    letterSpacing: 1.5, textAlign: 'center', padding: '2px 0',
  },

  // Grilla principal: 6 filas × 7 columnas. `flex: 1` para ocupar todo el alto.
  calGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gridAutoRows: 'minmax(48px, 1fr)',
    gap: 3,
    flex: 1,
  },

  calCell: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 3,
    padding: '3px 4px',
    display: 'flex', flexDirection: 'column',
    gap: 2, overflow: 'hidden',
    transition: 'border-color 0.2s, background 0.2s',
    minHeight: 48,
    // Necesario para que el popover (position: absolute) se posicione contra la celda.
    position: 'relative',
  },
  // Finde + feriados: fondo gris, texto atenuado (mismo tratamiento).
  calCellMuted: {
    background: 'rgba(128,128,128,0.12)',
    borderColor: 'rgba(128,128,128,0.22)',
  },
  calCellToday: {
    borderColor: 'var(--neon)',
    boxShadow: 'var(--cal-today-glow)',
  },
  // Días fuera del mes visible: muy atenuados.
  calCellOther: { opacity: 0.32 },

  calCellHead: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    gap: 4, minHeight: 12,
  },
  calCellDay: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 10, fontWeight: 700,
    letterSpacing: 0.3,
  },
  calTodayDot: {
    width: 5, height: 5, borderRadius: '50%', background: 'var(--neon)',
    boxShadow: '0 0 4px var(--neon)',
  },
  calHolidayTag: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 7, fontWeight: 700,
    letterSpacing: 0.5, color: 'var(--text-dim)',
    padding: '0 3px', borderRadius: 2, background: 'rgba(128,128,128,0.22)',
    alignSelf: 'flex-start',
  },

  // Lista vertical de tickers con pagos en el día.
  calCellPays: { display: 'flex', flexDirection: 'column', gap: 1, marginTop: 1 },
  // Chip compacto (vista por defecto). Sus colores los reemplaza renderChip
  // vía CSS vars; los hardcodeados acá son solo fallback.
  calTickerChip: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 8, fontWeight: 700,
    letterSpacing: 0.3,
    padding: '1px 3px', borderRadius: 2,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    textAlign: 'center', lineHeight: 1.25,
  },
  // Variante por tipo: amortización. Colores desde CSS vars (theme-aware).
  chipAmort: {
    color: 'var(--cal-chip-amort-fg)',
    background: 'var(--cal-chip-amort-bg)',
    border: '1px solid var(--cal-chip-amort-border)',
  },
  calMoreChip: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 7, fontWeight: 700,
    letterSpacing: 0.3, color: 'var(--text-dim)',
    textAlign: 'center', lineHeight: 1.25, marginTop: 1,
  },

  // Popover de hover: fixed + portal al body para escapar el overflow:hidden
  // del card padre. top/left se inyectan dinámicamente desde CalCell usando
  // el boundingRect de la celda (coords de viewport).
  calCellPopover: {
    position: 'fixed',
    zIndex: 9999,
    maxHeight: 260,
    overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 4,
    padding: '6px 6px',
    background: 'var(--bg-card)',
    border: '1px solid var(--neon)',
    borderRadius: 4,
    boxShadow: 'var(--cal-popover-glow)',
  },
  // Chip más grande para la vista expandida (hover).
  // Tamaño fijo (alto + flex-shrink:0) para que no se comprima dentro del
  // contenedor scrolleable — si no, los chips se "aplastan" verticalmente.
  calTickerChipLg: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 11, fontWeight: 700,
    letterSpacing: 0.5, padding: '5px 8px', borderRadius: 3,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    textAlign: 'center', lineHeight: 1.2,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: 24, minHeight: 24, maxHeight: 24,
    flexShrink: 0, flexGrow: 0,
    boxSizing: 'border-box',
  },

  summaryRow: {
    display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6,
    marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)',
    fontFamily: "'Roboto Mono',monospace", fontSize: 9, color: 'var(--text-dim)', letterSpacing: 1,
  },

  // Lista de links útiles.
  // Separamos en grupos (INFORMACIÓN / GESTIÓN), cada uno con su label chico.
  linksGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  linksGroupLabel: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 9, fontWeight: 700,
    letterSpacing: 2, color: 'var(--text-dim)', marginBottom: 2,
  },
  linksList: { display: 'flex', flexDirection: 'column', gap: 8 },
  linkRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    gap: 10, padding: '12px 14px',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 5,
    textDecoration: 'none',
    transition: 'border-color 0.15s, background 0.15s, transform 0.15s',
    cursor: 'pointer',
  },
  linkTitle: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 11, fontWeight: 700,
    letterSpacing: 1.2, color: 'var(--text)',
  },
  linkArrow: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 14, fontWeight: 700,
    transition: 'color 0.15s',
  },

  // ── Aperturas ──
  // Interruptor segmentado DELFINO/GAVIÑA con "thumb" que se desliza al
  // cambiar selección. Los botones son transparentes; el thumb es una capa
  // absoluta con transición suave.
  asesorSwitch: {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: 3,
    marginBottom: 10,
  },
  asesorSwitchThumb: {
    position: 'absolute',
    top: 3, bottom: 3,
    left: 3,
    width: 'calc(50% - 3px)',
    background: 'var(--neon)',
    borderRadius: 4,
    transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
    boxShadow: 'var(--neon-glow)',
    zIndex: 0,
  },
  asesorSwitchBtn: {
    position: 'relative', zIndex: 1,
    background: 'transparent',
    border: 'none',
    padding: '8px 10px',
    fontFamily: "'Roboto Mono',monospace",
    fontSize: 11, fontWeight: 700, letterSpacing: 2,
    color: 'var(--text-dim)',
    cursor: 'pointer',
    transition: 'color 0.18s',
  },
  asesorSwitchBtnActive: {
    color: 'var(--bg)', // texto oscuro sobre el thumb neón (ambos themes)
  },
  asesorAliasRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 10px',
    background: 'var(--input-bg)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    marginBottom: 12,
  },
  asesorAliasLabel: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 9, fontWeight: 700,
    letterSpacing: 2, color: 'var(--text-dim)',
  },
  asesorAliasValue: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 11, fontWeight: 700,
    letterSpacing: 1.5, color: 'var(--neon)',
  },

  aperturasList: { display: 'flex', flexDirection: 'column', gap: 8 },
  aperturaRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    gap: 10,
    padding: '12px 14px',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 5,
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s, transform 0.15s',
    fontFamily: 'inherit',
  },
  aperturaRowText: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  aperturaTitle: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 11, fontWeight: 700,
    letterSpacing: 1.2, color: 'var(--text)',
    transition: 'color 0.15s',
  },
  aperturaSub: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 9, letterSpacing: 1,
    color: 'var(--text-dim)',
  },
  aperturaStatus: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 10, fontWeight: 700,
    letterSpacing: 1.5,
    whiteSpace: 'nowrap',
    transition: 'color 0.15s',
  },

  // Placeholder body para las 3 cards vacías
  placeholderBody: {
    flex: 1,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 10, padding: '20px',
    textAlign: 'center',
  },
  placeholderIcon: { fontSize: 40, transition: 'opacity 0.22s ease, transform 0.22s ease', color: 'var(--neon-dim)' },
  placeholderText: { fontFamily: "'Roboto',sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: 3, color: 'var(--text-dim)' },
  placeholderHint: { fontFamily: "'Roboto Mono',monospace", fontSize: 10, color: 'var(--text-dim)', letterSpacing: 0.5, maxWidth: 280, lineHeight: 1.5, opacity: 0.7 },
};

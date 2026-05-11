// ─────────────────────────────────────────────────────────────────────────────
//  OUT OF OFFICE MODAL — generador de cartel "Fuera de oficina"
//
//  Genera un PNG cuadrado (1080×1080) listo para usar como foto de perfil
//  institucional de WhatsApp. WhatsApp recorta circular, por eso TODO el
//  contenido (logo + textos + pluma de fondo) queda dentro del círculo
//  inscripto. La pluma se clipea con un path circular antes de dibujarse;
//  los corners del canvas quedan en navy puro y nunca se ven en WhatsApp.
//
//  Selector de fechas: calendario propio (MiniCalendar) que soporta modo
//  "rango" o "un día" sin dependencias externas. Click 1 = from, click 2
//  = to (en rango); click 3 reinicia a from.
//
//  Persistencia: persona/fechas seleccionadas en localStorage.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';

// ── Personas configurables ──
// Cambiar acá si rotan los asesores. El orden no importa visualmente: el
// modal siempre muestra a los dos que NO se eligieron como "ausente".
const PERSONAS = [
  { key: 'delfino', name: 'Juan Manuel Delfino',          phone: '+54 9 11 4071-7624' },
  { key: 'hary',    name: 'Julián Hary Beccar Varela',    phone: '+54 9 11 5580-2756' },
  { key: 'gavina',  name: 'Gonzalo Gaviña Alvarado',      phone: '+54 9 11 6373-3920' },
];

const STORAGE_KEY = 'ooo_modal_state_v1';

// ── Helpers ──

const MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MONTHS_ES_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const WEEKDAYS_ES = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function pad(n) { return String(n).padStart(2, '0'); }

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateToIso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Parsea YYYY-MM-DD respetando timezone local (no UTC).
function parseLocalDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Lunes-primero: getDay() devuelve 0=Dom..6=Sáb. Convertir a 0=Lun..6=Dom.
function mondayIndex(d) { return (d.getDay() + 6) % 7; }

// Format "8 de mayo de 2026" / "del 8 al 15 de mayo de 2026" / etc.
function formatDateLabel(mode, fromIso, toIso) {
  if (!fromIso) return '';
  const from = parseLocalDate(fromIso);
  if (!from) return '';

  if (mode === 'single') {
    return `el ${from.getDate()} de ${MONTHS_ES[from.getMonth()]} de ${from.getFullYear()}`;
  }
  if (!toIso) return '';
  const to = parseLocalDate(toIso);
  if (!to) return '';

  if (to.getTime() < from.getTime()) return formatDateLabel('single', fromIso);
  if (from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth()) {
    if (from.getDate() === to.getDate()) return formatDateLabel('single', fromIso);
    return `del ${from.getDate()} al ${to.getDate()} de ${MONTHS_ES[from.getMonth()]} de ${from.getFullYear()}`;
  }
  if (from.getFullYear() === to.getFullYear()) {
    return `del ${from.getDate()} de ${MONTHS_ES[from.getMonth()]} al ${to.getDate()} de ${MONTHS_ES[to.getMonth()]} de ${from.getFullYear()}`;
  }
  const f = `${pad(from.getDate())}/${pad(from.getMonth() + 1)}/${from.getFullYear()}`;
  const t = `${pad(to.getDate())}/${pad(to.getMonth() + 1)}/${to.getFullYear()}`;
  return `del ${f} al ${t}`;
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ─── Drawing ───────────────────────────────────────────────────────────────
// Canvas 1080×1080. WhatsApp aplica crop circular → todo lo importante
// (incluyendo la pluma) queda dentro de un círculo inscripto. Para la
// pluma usamos clip(); para el texto/logo, los posicionamos en y dentro
// del rango seguro.
const W = 1080;
const H = 1080;
const CX = W / 2;          // centro x
const CY = H / 2;          // centro y
const R  = W / 2;          // radio del círculo de WhatsApp (= mitad del canvas)

function drawOOO(canvas, { otros, dateLabel, bgImg, logoImg }) {
  if (!canvas) return;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // 1) Fondo navy en todo el canvas. Los corners no se ven en WhatsApp,
  //    pero queremos que el archivo sea sólido (no transparente) por si
  //    se comparte en otro lado.
  ctx.fillStyle = '#0A0F1C';
  ctx.fillRect(0, 0, W, H);

  // 2) Pluma SVG dentro del círculo. Clipeamos el contexto a un círculo
  //    de radio R y dibujamos la pluma escalada para CUBRIR el círculo
  //    sin dejar bordes navy. ctx.save/restore deja el clip aislado.
  if (bgImg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.clip();

    // Escalar pluma para cubrir el cuadrado (= el círculo, ya clipeado).
    const ratio = bgImg.width / bgImg.height;
    let dw = W, dh = W / ratio;
    if (dh < H) { dh = H; dw = H * ratio; }
    const dx = (W - dw) / 2, dy = (H - dh) / 2;
    ctx.drawImage(bgImg, dx, dy, dw, dh);
    ctx.restore();
  }

  // 3) Layout del contenido — todas las y están elegidas para entrar
  //    cómodas dentro del círculo. Pensamos el círculo como una "pizza"
  //    centrada en (540, 540) con radio 540.
  //
  //    Distancia vertical desde el centro vs. radio horizontal disponible:
  //      |dy|=350 → r≈410 → x∈[130, 950]    (zona del logo)
  //      |dy|=200 → r≈501 → x∈[39,  1041]   (título)
  //      |dy|=0   → r=540 → x∈[0,   1080]   (separador)
  //      |dy|=290 → r≈455 → x∈[85,  995]    (último contacto)
  //
  //    Resultado: contenido entre y=190 y y=890 está siempre dentro del
  //    círculo, con margen de ~80px a cada lado de la línea de texto.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Logo D&G — centrado, bien arriba pero dentro del círculo
  if (logoImg) {
    const logoH = 110;
    const logoW = (logoImg.width / logoImg.height) * logoH;
    const logoY = 200; // top del logo
    ctx.drawImage(logoImg, CX - logoW / 2, logoY, logoW, logoH);
  }

  // Título "Fuera de oficina"
  ctx.fillStyle = '#FEF8E6';
  ctx.font = '600 68px "Cormorant Garamond", "Times New Roman", serif';
  ctx.fillText('Fuera de oficina', CX, 410);

  // Fecha (si está completa)
  if (dateLabel) {
    ctx.font = '400 30px "Montserrat", "Roboto", sans-serif';
    ctx.fillStyle = 'rgba(254,248,230,0.85)';
    ctx.fillText(dateLabel, CX, 478);
  }

  // Separador — más cerca del centro vertical donde el círculo es más ancho
  const lineY = dateLabel ? 540 : 510;
  ctx.strokeStyle = 'rgba(254,248,230,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CX - 200, lineY);
  ctx.lineTo(CX + 200, lineY);
  ctx.stroke();

  // Label "COMUNICARSE CON"
  ctx.font = '700 18px "Montserrat", sans-serif';
  ctx.fillStyle = 'rgba(254,248,230,0.65)';
  ctx.fillText('COMUNICARSE CON', CX, lineY + 38);

  // Contactos (los que NO están ausentes). El gap se ajusta automáticamente
  // para mantenerse dentro del círculo, sin importar si son 1 o 2.
  const contactStartY = lineY + 105;
  const contactGap = otros.length === 1 ? 0 : 145;
  otros.forEach((p, i) => {
    const y = contactStartY + i * contactGap;
    // Nombre
    ctx.font = '600 36px "Cormorant Garamond", "Times New Roman", serif';
    ctx.fillStyle = '#FEF8E6';
    ctx.fillText(p.name, CX, y);
    // Teléfono
    ctx.font = '500 28px "Montserrat", "Roboto Mono", monospace';
    ctx.fillStyle = 'rgba(254,248,230,0.85)';
    ctx.fillText(p.phone, CX, y + 46);
  });
}

// ─── MiniCalendar ──────────────────────────────────────────────────────────
//
// Calendario in-place con soporte para modo single y range. Muestra un mes
// a la vez con navegación prev/next. En modo range, click 1 setea `from`,
// click 2 setea `to` (si es anterior a from, intercambia); click 3 reinicia.

function MiniCalendar({ mode, fromIso, toIso, onChange }) {
  // Mes "anclado" del calendario (por defecto, el del fromIso; si no hay,
  // hoy). El usuario puede cambiarlo con prev/next sin perder selección.
  const initialAnchor = parseLocalDate(fromIso) || new Date();
  const [anchor, setAnchor] = useState(() => new Date(initialAnchor.getFullYear(), initialAnchor.getMonth(), 1));

  const today    = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const fromDate = useMemo(() => parseLocalDate(fromIso), [fromIso]);
  const toDate   = useMemo(() => parseLocalDate(toIso),   [toIso]);

  const handleClick = useCallback((d) => {
    const iso = dateToIso(d);
    if (mode === 'single') {
      onChange({ fromIso: iso, toIso: iso });
      return;
    }
    // RANGE
    // Si no hay from, o ya hay un range completo → empezar de nuevo
    if (!fromDate || (fromDate && toDate && fromDate.getTime() !== toDate.getTime())) {
      onChange({ fromIso: iso, toIso: iso });
      return;
    }
    // Sólo hay from (toIso == fromIso) → setear to
    if (d.getTime() < fromDate.getTime()) {
      // El usuario clickeó una fecha anterior al from → intercambiar
      onChange({ fromIso: iso, toIso: fromIso });
    } else {
      onChange({ fromIso, toIso: iso });
    }
  }, [mode, fromDate, toDate, fromIso, onChange]);

  // Construir grilla del mes (6 filas × 7 columnas)
  const cells = useMemo(() => {
    const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const startCell = new Date(firstOfMonth);
    startCell.setDate(1 - mondayIndex(firstOfMonth));
    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(startCell);
      d.setDate(startCell.getDate() + i);
      out.push(d);
    }
    return out;
  }, [anchor]);

  const monthLabel = `${MONTHS_ES_SHORT[anchor.getMonth()]} ${anchor.getFullYear()}`;

  // Determinar el estado de cada celda — solo se evalúa cuando hay rango
  // completo; si toIso === fromIso no hay "in-between".
  const hasFullRange = fromDate && toDate && fromDate.getTime() !== toDate.getTime();
  const rangeStart = hasFullRange ? Math.min(fromDate.getTime(), toDate.getTime()) : null;
  const rangeEnd   = hasFullRange ? Math.max(fromDate.getTime(), toDate.getTime()) : null;

  return (
    <div style={CS.wrap}>
      <div style={CS.header}>
        <button
          type="button"
          onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}
          style={CS.navBtn}
          aria-label="Mes anterior"
        >‹</button>
        <span style={CS.monthLabel}>{monthLabel}</span>
        <button
          type="button"
          onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}
          style={CS.navBtn}
          aria-label="Mes siguiente"
        >›</button>
      </div>

      <div style={CS.weekRow}>
        {WEEKDAYS_ES.map((w, i) => (
          <div key={i} style={{ ...CS.weekCell, opacity: i >= 5 ? 0.45 : 0.7 }}>{w}</div>
        ))}
      </div>

      <div style={CS.grid}>
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const t = d.getTime();
          const isFrom = fromDate && t === fromDate.getTime();
          const isTo   = toDate   && t === toDate.getTime();
          const isToday = t === today.getTime();
          const isWeekend = mondayIndex(d) >= 5;
          const inRange = hasFullRange && t > rangeStart && t < rangeEnd;
          const isEdge  = isFrom || isTo;

          const cellStyle = {
            ...CS.cell,
            ...(inMonth ? {} : CS.cellOut),
            ...(isWeekend && inMonth ? CS.cellWeekend : {}),
            ...(isToday ? CS.cellToday : {}),
            ...(inRange ? CS.cellInRange : {}),
            ...(isEdge ? CS.cellEdge : {}),
          };
          return (
            <button
              key={i}
              type="button"
              onClick={() => handleClick(d)}
              style={cellStyle}
              tabIndex={inMonth ? 0 : -1}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────

export default function OutOfOfficeModal({ onClose }) {
  const [persona,  setPersona]  = useState(() => loadState().persona  ?? 'delfino');
  const [mode,     setMode]     = useState(() => loadState().mode     ?? 'range');
  const [fromIso,  setFromIso]  = useState(() => loadState().dateFrom ?? todayIso());
  const [toIso,    setToIso]    = useState(() => loadState().dateTo   ?? todayIso());

  const canvasRef = useRef(null);
  const [bgImg, setBgImg] = useState(null);
  const [logoImg, setLogoImg] = useState(null);
  const [status, setStatus] = useState(null);

  // Persistir cambios.
  useEffect(() => {
    saveState({ persona, mode, dateFrom: fromIso, dateTo: toIso });
  }, [persona, mode, fromIso, toIso]);

  // Cargar fondos institucionales.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadImage('/logos/fondo%20pluma.svg'),
      loadImage('/logos/DG%20tema%20oscuro.png'),
    ]).then(([bg, logo]) => {
      if (cancelled) return;
      setBgImg(bg);
      setLogoImg(logo);
    });
    return () => { cancelled = true; };
  }, []);

  // ESC para cerrar.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Cuando cambia de single→range con un solo día seleccionado, dejamos
  // toIso === fromIso (un día). Y cuando cambia de range→single, forzamos
  // toIso = fromIso para que el formato single se renderice bien.
  useEffect(() => {
    if (mode === 'single' && toIso !== fromIso) setToIso(fromIso);
  }, [mode, fromIso, toIso]);

  const ausente = useMemo(() => PERSONAS.find(p => p.key === persona) || PERSONAS[0], [persona]);
  const otros   = useMemo(() => PERSONAS.filter(p => p.key !== persona), [persona]);
  const dateLabel = useMemo(
    () => formatDateLabel(mode, fromIso, mode === 'range' ? toIso : null),
    [mode, fromIso, toIso]
  );

  useEffect(() => {
    drawOOO(canvasRef.current, { otros, dateLabel, bgImg, logoImg });
  }, [otros, dateLabel, bgImg, logoImg]);

  const flash = (kind) => { setStatus(kind); setTimeout(() => setStatus(null), 1800); };

  const filename = useMemo(() => {
    const slug = ausente.key;
    const date = mode === 'range' ? `${fromIso}_${toIso}` : fromIso;
    return `fuera-de-oficina_${slug}_${date}.png`;
  }, [ausente, mode, fromIso, toIso]);

  const onDownload = () => {
    try {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const a = document.createElement('a');
      a.download = filename;
      a.href = canvas.toDataURL('image/png');
      a.click();
      flash('downloaded');
    } catch (e) { console.error(e); flash('err'); }
  };

  const onCopy = async () => {
    try {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('No blob');
      if (!navigator.clipboard?.write || typeof window.ClipboardItem === 'undefined') {
        throw new Error('Clipboard no soportado');
      }
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      flash('copied');
    } catch (e) { console.error(e); flash('err'); }
  };

  // Cambios en el calendario llegan como { fromIso, toIso }.
  const handleCalChange = useCallback(({ fromIso: nf, toIso: nt }) => {
    setFromIso(nf);
    if (mode === 'single') setToIso(nf);
    else setToIso(nt);
  }, [mode]);

  return (
    <div style={S.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={S.modal}>
        <div style={S.header}>
          <div>
            <div style={S.title}>FUERA DE OFICINA</div>
            <div style={S.sub}>Generar foto de perfil de WhatsApp institucional</div>
          </div>
          <button onClick={onClose} style={S.closeBtn} aria-label="Cerrar">✕</button>
        </div>

        <div style={S.body}>
          {/* Form */}
          <div style={S.form}>
            <Field label="¿Quién está fuera?">
              <select value={persona} onChange={e => setPersona(e.target.value)} style={S.input}>
                {PERSONAS.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
            </Field>

            <Field label="Tipo">
              <div style={S.segRow}>
                <button
                  type="button"
                  onClick={() => setMode('range')}
                  style={{ ...S.segBtn, ...(mode === 'range' ? S.segBtnActive : {}) }}
                >RANGO</button>
                <button
                  type="button"
                  onClick={() => setMode('single')}
                  style={{ ...S.segBtn, ...(mode === 'single' ? S.segBtnActive : {}) }}
                >UN DÍA</button>
              </div>
            </Field>

            <Field label={mode === 'range' ? 'Fechas (click inicio → click fin)' : 'Día'}>
              <MiniCalendar
                mode={mode}
                fromIso={fromIso}
                toIso={toIso}
                onChange={handleCalChange}
              />
            </Field>

            <div style={S.dateSummary}>
              {dateLabel
                ? <span><span style={S.dateSummaryLabel}>SELECCIÓN</span> {dateLabel}</span>
                : <span style={{ opacity: 0.6 }}>Seleccioná {mode === 'range' ? 'inicio y fin' : 'una fecha'}</span>}
            </div>

            <div style={S.previewLabel}>
              Mostrando contactos: <b>{otros.map(o => o.name.split(' ')[0]).join(' · ')}</b>
            </div>

            <div style={S.btnRow}>
              <button onClick={onDownload} style={S.primaryBtn}>⬇ DESCARGAR PNG</button>
              <button onClick={onCopy} style={S.secondaryBtn}>📋 COPIAR</button>
            </div>
            {status && (
              <div style={{
                ...S.statusMsg,
                color: status === 'err' ? 'var(--red)' : 'var(--neon)',
              }}>
                {status === 'copied'     && '✓ Copiado al portapapeles'}
                {status === 'downloaded' && '✓ Descargado'}
                {status === 'err'        && '× Error — revisá la consola'}
              </div>
            )}
          </div>

          {/* Preview */}
          <div style={S.previewCol}>
            <div style={S.previewWrap}>
              <canvas ref={canvasRef} style={S.canvas} />
              {/* Overlay decorativo para visualizar el crop circular de WhatsApp */}
              <div style={S.cropOverlay} aria-hidden="true" />
            </div>
            <div style={S.previewCaption}>1080×1080 · vista previa con crop circular</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={S.field}>
      <label style={S.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

// ─── Persistencia ────────────────────────────────────────────────────────
function loadState() {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? (JSON.parse(raw) || {}) : {}; }
  catch { return {}; }
}
function saveState(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

// ─── Estilos del calendario ──────────────────────────────────────────────
const CS = {
  wrap: {
    background: 'var(--input-bg)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: 10,
    userSelect: 'none',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  navBtn: {
    background: 'transparent', border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1, padding: 0,
  },
  monthLabel: {
    fontFamily: "'Roboto Mono', monospace", fontSize: 12, fontWeight: 700,
    letterSpacing: 1.5, color: 'var(--text)', textTransform: 'uppercase',
  },
  weekRow: {
    display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4,
  },
  weekCell: {
    fontFamily: "'Roboto Mono', monospace", fontSize: 9, fontWeight: 700,
    letterSpacing: 1, textAlign: 'center', color: 'var(--text-dim)', padding: '2px 0',
  },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2,
  },
  cell: {
    background: 'transparent', border: '1px solid transparent', borderRadius: 4,
    color: 'var(--text)', fontFamily: "'Roboto Mono', monospace", fontSize: 11,
    fontWeight: 500, padding: '7px 0', cursor: 'pointer', textAlign: 'center',
    transition: 'background 0.12s, border-color 0.12s, color 0.12s',
  },
  cellOut: { color: 'var(--text-dim)', opacity: 0.4 },
  cellWeekend: { color: 'var(--text-dim)' },
  cellToday: { borderColor: 'var(--neon-dim)' },
  cellInRange: { background: 'rgba(99,134,172,0.20)', color: 'var(--text)' },
  cellEdge: {
    background: 'var(--neon)', color: 'var(--bg)', fontWeight: 700,
    borderColor: 'var(--neon)',
  },
};

// ─── Estilos del modal ───────────────────────────────────────────────────
const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 10000,
    background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 'clamp(8px, 2vw, 24px)',
  },
  modal: {
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 10, width: '100%', maxWidth: 1020,
    maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column',
    overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '16px 20px', borderBottom: '1px solid var(--border)',
    background: 'var(--th-bg)', flexShrink: 0,
  },
  title: { fontFamily: "'Roboto', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: 4, color: 'var(--neon)' },
  sub:   { fontFamily: "'Roboto Mono', monospace", fontSize: 10, color: 'var(--text-dim)', marginTop: 4, letterSpacing: 1 },
  closeBtn: {
    background: 'transparent', border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text-dim)', fontSize: 14, width: 32, height: 32, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  body: {
    display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)',
    gap: 24, padding: 20, overflowY: 'auto',
  },

  // Form
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: { fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: 'var(--text-dim)' },
  input: {
    background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text)', fontFamily: "'Montserrat', sans-serif", fontSize: 13,
    padding: '8px 10px', outline: 'none',
  },
  segRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' },
  segBtn: {
    background: 'transparent', border: 'none', padding: '9px 10px',
    fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 2,
    color: 'var(--text-dim)', cursor: 'pointer', transition: 'all 0.15s',
  },
  segBtnActive: { background: 'var(--neon)', color: 'var(--bg)' },

  dateSummary: {
    background: 'rgba(99,134,172,0.06)',
    border: '1px solid var(--border)', borderRadius: 4,
    padding: '8px 10px', fontFamily: "'Montserrat', sans-serif",
    fontSize: 12, color: 'var(--text)', lineHeight: 1.4,
    minHeight: 36, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
  },
  dateSummaryLabel: {
    fontFamily: "'Roboto Mono', monospace", fontSize: 9, fontWeight: 700,
    letterSpacing: 1.5, color: 'var(--text-dim)', marginRight: 4,
  },

  previewLabel: {
    marginTop: 4, fontFamily: "'Roboto Mono', monospace", fontSize: 10,
    color: 'var(--text-dim)', letterSpacing: 0.5, lineHeight: 1.6,
  },

  btnRow: { display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  primaryBtn: {
    flex: 1, padding: '10px 14px', background: 'var(--neon)', color: 'var(--bg)',
    border: 'none', borderRadius: 4, fontFamily: "'Roboto Mono', monospace",
    fontSize: 11, fontWeight: 700, letterSpacing: 2, cursor: 'pointer', minWidth: 140,
  },
  secondaryBtn: {
    padding: '10px 14px', background: 'transparent', color: 'var(--text)',
    border: '1px solid var(--border)', borderRadius: 4,
    fontFamily: "'Roboto Mono', monospace", fontSize: 11, fontWeight: 700,
    letterSpacing: 2, cursor: 'pointer',
  },
  statusMsg: {
    fontFamily: "'Roboto Mono', monospace", fontSize: 11, fontWeight: 700,
    letterSpacing: 1, marginTop: 4,
  },

  // Preview
  previewCol: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'flex-start' },
  previewWrap: {
    position: 'relative', width: 'min(100%, 380px)', aspectRatio: '1 / 1',
    borderRadius: 8, overflow: 'hidden', background: '#0A0F1C',
    border: '1px solid var(--border)',
  },
  canvas: { width: '100%', height: '100%', display: 'block' },
  cropOverlay: {
    position: 'absolute', inset: 0, pointerEvents: 'none',
    background: 'radial-gradient(circle at 50% 50%, transparent 49.5%, rgba(0,0,0,0.45) 50%)',
  },
  previewCaption: { fontFamily: "'Roboto Mono', monospace", fontSize: 9, color: 'var(--text-dim)', letterSpacing: 1 },
};

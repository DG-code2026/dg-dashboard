// ─────────────────────────────────────────────────────────────────────────────
//  BondFlyerModal — flyer institucional para compartir la ficha técnica de un
//  bono (PRECIO / TIR / MD / PARIDAD + información del título).
//
//  Diseño inspirado en el flyer de PropuestasPage: paleta D&G (navy + crema +
//  azul institucional), tipografías Cormorant Garamond + Roboto Mono, y el SVG
//  "fondo pluma" como background. Mantenemos consistencia visual en todos los
//  flyers de la app para que cualquiera que reciba el material lea "D&G" antes
//  de leer el contenido.
//
//  Captura: html2canvas con scale=2 para PNG nítido, mismo flujo que en
//  PropuestasPage (Copiar / Descargar). Botón ✦ FLYER en BondDetailModal abre
//  este componente pasando bond + ticker + price + manualLaw.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { getCompanyInfo } from './companyData';
import { resolveDuration } from './BondDetailModal';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Mapa apiType (interno de BondPage / PPI) → etiqueta humana para el flyer.
// Usamos la misma taxonomía que ASSET_TYPES en PropuestasPage para consistencia.
const ASSET_TYPE_LABELS = {
  BONOS_PUBLICOS: 'Bono Soberano',
  BONOS_CORP:     'Bono Subsoberano',
  ON:             'Obligación Negociable',
  LETRAS:         'Letra',
};

// ── Paleta institucional Delfino Gaviña (idéntica a PropuestasPage) ──
const DG = {
  bg: '#0A0F1C',
  bgMid: '#1A2236',
  blueDeep: '#102f4a',
  blueMid: '#364776',
  blue: '#6386AC',
  cream: '#FEF8E6',
  creamDim: 'rgba(254,248,230,0.72)',
  creamMute: 'rgba(254,248,230,0.48)',
  creamSoft: 'rgba(254,248,230,0.85)',
  disc: 'rgba(254,248,230,0.55)',
  muted: 'rgba(254,248,230,0.38)',
  line10: 'rgba(99,134,172,0.10)',
  line18: 'rgba(99,134,172,0.20)',
  line25: 'rgba(99,134,172,0.28)',
  line35: 'rgba(99,134,172,0.40)',
  line50: 'rgba(99,134,172,0.55)',
  panel: 'rgba(254,248,230,0.04)',
  panelHi: 'rgba(99,134,172,0.08)',
};

// Helpers de formato — locale es-AR consistente con el resto de la app.
const fmtMoney = (v) => v != null && v !== ''
  ? `$${Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : '—';
const fmtPct = (v, dec = 1) => v != null && v !== ''
  ? `${(Number(v) * 100).toFixed(dec)}%`
  : '—';
const fmtNum = (v, dec = 1) => v != null && v !== ''
  ? Number(v).toFixed(dec)
  : '—';
const fmtDate = (v) => {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return String(v); }
};

export default function BondFlyerModal({ bond, ticker, price, manualLaw, assetType, onClose }) {
  const flyerRef = useRef(null);
  const [dl, setDl] = useState(false);
  const [err, setErr] = useState('');
  // Igual que en PropuestasPage: precargamos el SVG fondo pluma a un PNG con el
  // filtro horneado (brightness/contrast/saturate) para que html2canvas pueda
  // rasterizarlo confiablemente. Sin esto, el SVG con clipPath/PNG embebido se
  // exporta blanco o transparente.
  const [bgDataUrl, setBgDataUrl] = useState(null);
  // Descripción institucional del título — la traemos de PPI (mismo endpoint
  // que usa Propuestas al agregar un activo por búsqueda). Se muestra entre el
  // emisor y la grilla de información para que el flyer tenga el "nombre largo"
  // del bono además del ticker (ej: "BONOS REPUBLICA ARG. STEP UP 2030 USD").
  const [ppiDescription, setPpiDescription] = useState(null);

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
      } catch {
        setBgDataUrl('/logos/fondo%20pluma.svg');
      }
    };
    img.onerror = () => { if (!cancelled) setBgDataUrl('/logos/fondo%20pluma.svg'); };
    img.src = '/logos/fondo%20pluma.svg';
    return () => { cancelled = true; };
  }, []);

  // ESC cierra (consistente con BondDetailModal).
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', h);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // Trae la descripción del título desde PPI (SearchInstrument) — mismo
  // endpoint que usa Propuestas al agregar un activo. Si BondPage no nos pasó
  // assetType, intentamos con 'BONOS_PUBLICOS' como fallback razonable porque
  // es el caso más común; si falla, simplemente no mostramos la descripción.
  useEffect(() => {
    let cancelled = false;
    const tryType = assetType || 'BONOS_PUBLICOS';
    if (!ticker) return;
    (async () => {
      try {
        const url = `${API}/api/ppi/asset/info?ticker=${encodeURIComponent(ticker)}&type=${encodeURIComponent(tryType)}`;
        const r = await fetch(url);
        const d = await r.json();
        if (cancelled) return;
        if (d?.found && d.description) setPpiDescription(d.description);
      } catch {
        // Silencioso: la descripción es decorativa, no bloquea el flyer.
      }
    })();
    return () => { cancelled = true; };
  }, [ticker, assetType]);

  const co = getCompanyInfo(ticker);
  const displayLaw = manualLaw || bond?.law || '—';
  const safeFile = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || '—';
  const fileName = `D&G - Ficha Técnica - ${safeFile(ticker)}.png`;

  // Carga dinámica de html2canvas — igual que en PropuestasPage.
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
  const ensureHtml2Canvas = async () => {
    if (!window.html2canvas) await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
  };

  const capture = async (action) => {
    setDl(true); setErr('');
    try {
      await ensureHtml2Canvas();
      // Pequeña espera por si el bg PNG no terminó de generarse en el primer click.
      if (!bgDataUrl) await new Promise(r => setTimeout(r, 300));
      const canvas = await window.html2canvas(flyerRef.current, {
        backgroundColor: DG.bg,
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
      });
      if (action === 'download') {
        const link = document.createElement('a');
        link.download = fileName;
        link.href = canvas.toDataURL('image/png');
        link.click();
      } else {
        canvas.toBlob(b => { if (b) navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); });
      }
    } catch (e) {
      setErr(e.message || 'Error generando imagen');
    } finally {
      setDl(false);
    }
  };

  if (!bond) return null;

  // Duration: usamos el resolver compartido con BondDetailModal — cubre los
  // casos donde PPI devuelve la propiedad con otro casing (Duration vs
  // duration) o directamente no la entrega (en cuyo caso la deriva de
  // MD × (1+TIR), igual que CarterasPage).
  const durationNum = resolveDuration(bond);
  const durationVal = durationNum != null ? fmtNum(durationNum, 1) : null;

  // Tipo de instrumento humano (Bono Soberano / Subsoberano / ON / Letra).
  const instrumentTypeLabel = ASSET_TYPE_LABELS[assetType] || (assetType ? String(assetType) : null);

  // PPI devuelve residualValue y technicalValue por nominal (residualValue es
  // una fracción 0-1; technicalValue es el valor por 1 VN). La convención del
  // mercado argentino expresa estos números cada 100 VN, así que multiplicamos
  // por 100 y rotulamos sin sufijo — la aclaración "100 VN" va una sola vez al
  // pie del flyer.
  // PPI manda 0/-1 como sentinel cuando no calcula esos campos (caso típico
  // ONs y letras): no los mostramos para no exhibir "Paridad: -100%" o
  // residual 0 que no significa nada para el lector.
  const parityClean    = bond.parity != null && Number(bond.parity) > -0.99 ? Number(bond.parity) : null;
  const residualClean  = bond.residualValue != null && Number(bond.residualValue) > 0 ? Number(bond.residualValue) : null;
  const technicalClean = bond.technicalValue != null && Number(bond.technicalValue) > 0 ? Number(bond.technicalValue) : null;
  const residual100 = residualClean != null ? residualClean * 100 : null;
  const tecnico100  = technicalClean != null ? technicalClean * 100 : null;

  // Lista de campos del bloque "INFORMACIÓN DEL TÍTULO" — fiel al modal del
  // bono. Tipo de instrumento arriba, Duration entre Amortización y los dos
  // campos cada-100-VN al final.
  const infoFields = [
    { l: 'Tipo de instrumento', v: instrumentTypeLabel },
    { l: 'Emisor',              v: bond.issuer },
    { l: 'ISIN',                v: bond.isin },
    { l: 'Moneda emisión',      v: bond.issueCurrency },
    { l: 'Moneda pago',         v: bond.abbreviationCurrencyPay },
    { l: 'Fecha emisión',       v: fmtDate(bond.issueDate) },
    { l: 'Vencimiento',         v: fmtDate(bond.expirationDate) },
    { l: 'Ley',                 v: displayLaw },
    { l: 'Lámina mínima',       v: bond.minimalSheet },
    { l: 'Cupón',               v: bond.interests },
    { l: 'Amortización',        v: bond.amortization },
    { l: 'Duration',            v: durationVal },
    { l: 'Valor residual',      v: residual100 != null ? fmtNum(residual100, 1) : null },
    { l: 'Valor técnico',       v: tecnico100 != null ? fmtMoney(tecnico100) : null },
  ];

  const dateStr = new Date().toLocaleDateString('es-AR', {
    day: '2-digit', month: 'long', year: 'numeric',
  }).toUpperCase();

  return (
    <div style={FS.overlay} onClick={onClose}>
      <div style={FS.modalWrap} onClick={e => e.stopPropagation()}>
        <div style={FS.toolbar}>
          <div style={FS.toolbarTitle}>FLYER · FICHA TÉCNICA</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button style={FS.tbBtn} onClick={() => capture('copy')} disabled={dl} title="Copiar imagen al portapapeles">
              📋 COPIAR
            </button>
            <button style={FS.tbPrimary} onClick={() => capture('download')} disabled={dl}>
              {dl ? '⟳ GENERANDO...' : '⬇ DESCARGAR PNG'}
            </button>
            <button style={FS.tbClose} onClick={onClose}>✕</button>
          </div>
        </div>
        {err && <div style={FS.err}>{err}</div>}

        <div style={FS.scroll}>
          {/* ═══════════ FLYER ═══════════ */}
          <div ref={flyerRef} style={FS.flyer}>
            {/* Fondo pluma — PNG con filtro horneado para html2canvas. */}
            <img
              src={bgDataUrl || '/logos/fondo%20pluma.svg'}
              alt=""
              style={FS.bgImg}
              crossOrigin="anonymous"
              aria-hidden="true"
            />
            <div style={FS.bgTint} />

            {/* Contenido */}
            <div style={FS.content}>
              {/* Header — logo D&G a la izquierda, fecha a la derecha */}
              <div style={FS.header}>
                <img
                  src="/logos/DG%20tema%20oscuro.png"
                  alt="Delfino Gaviña"
                  style={FS.logo}
                  crossOrigin="anonymous"
                />
                <div style={FS.headerRight}>
                  <div style={FS.date}>{dateStr}</div>
                </div>
              </div>

              {/* Título */}
              <div style={FS.titleBlock}>
                <div style={FS.hairline} />
                <h1 style={FS.title}>FICHA TÉCNICA</h1>
                <div style={FS.hairline} />
              </div>

              {/* Subtítulo: ticker + emisor + tipo de instrumento.
                  v2: se removió el badge circular coloreado para una estética
                  más limpia y formal — solo ticker en grande, emisor + tipo
                  debajo. */}
              <div style={FS.subtitleBlock}>
                <div style={FS.tickerLine}>
                  <span style={FS.tickerCode}>{ticker}</span>
                </div>
                <div style={FS.issuer}>{bond.issuer || co.name}</div>
                {instrumentTypeLabel && (
                  <div style={FS.instrumentType}>{instrumentTypeLabel}</div>
                )}
                {ppiDescription && (
                  <div style={FS.ppiDescription}>{ppiDescription}</div>
                )}
              </div>

              {/* Resumen: 3 métricas (PRECIO · TIR · PARIDAD).
                  v2: se removió MD (ahora se muestra Duration en la grilla
                  inferior). Los rótulos pasan a blanco y un poco más grandes;
                  el dato de TIR también va en blanco (antes era azul). */}
              <div style={FS.summaryRow}>
                <FMet l="PRECIO"  v={fmtMoney(price)} />
                <FMet l="TIR"     v={fmtPct(bond.tir, 1)} />
                <FMet l="PARIDAD" v={fmtPct(parityClean, 1)} />
              </div>

              {/* Información del título — grid 2 columnas */}
              <div style={FS.infoBlock}>
                <div style={FS.sectionLabel}>INFORMACIÓN DEL TÍTULO</div>
                <div style={FS.infoGrid}>
                  {infoFields.map((f, i) => (
                    <div key={i} style={FS.infoRow}>
                      <span style={FS.infoLabel}>{f.l}</span>
                      <span style={FS.infoValue}>
                        {f.v != null && f.v !== '' ? String(f.v) : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Disclaimer — primero la aclaración de 100 VN para que el lector
                  la asocie a TODOS los números del flyer, después la nota
                  estándar de carácter indicativo / no recomendación. */}
              <div style={FS.disclaimer}>
                Datos correspondientes a 100 valores nominales. Los datos exhibidos son a título informativo y pueden variar según la cotización del mercado. No constituyen recomendación de inversión.
              </div>

              {/* Footer: marca + fuente */}
              <div style={FS.footer}>
                <span>DELFINO GAVIÑA · INVERSIONES</span>
                <span>Fuente: PP Inversiones</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-componente: tarjeta de métrica ──
// v2: rótulo y valor van ambos en crema (blanco institucional). El estilo
// "highlight" del prototipo (azul para TIR) se eliminó por pedido del cliente
// para que toda la fila tenga el mismo nivel visual.
function FMet({ l, v }) {
  return (
    <div style={FS.metCard}>
      <div style={FS.metL}>{l}</div>
      <div style={FS.metV}>{v}</div>
    </div>
  );
}

// ─── Estilos ─────────────────────────────────────────────────────────────────
const FS = {
  // Modal shell — usa variables del tema (consistente con BondDetailModal/Propuestas).
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(4px)',
    zIndex: 10001, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    padding: 20, overflow: 'auto',
  },
  modalWrap: {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
    maxWidth: 980, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  },
  toolbar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px', borderBottom: '1px solid var(--border)',
  },
  toolbarTitle: {
    fontSize: 11, fontWeight: 700, letterSpacing: 3, color: 'var(--neon)',
  },
  tbBtn: {
    background: 'none', border: '1px solid var(--border)', borderRadius: 3,
    color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace", fontSize: 10,
    fontWeight: 500, letterSpacing: 1, padding: '6px 12px', cursor: 'pointer',
  },
  tbPrimary: {
    background: 'transparent', color: 'var(--neon)', border: '1px solid var(--neon)',
    borderRadius: 3, fontFamily: "'Roboto',sans-serif", fontSize: 10, fontWeight: 700,
    letterSpacing: 2, padding: '6px 14px', cursor: 'pointer',
  },
  tbClose: {
    background: 'none', border: '1px solid var(--border)', borderRadius: 3,
    color: 'var(--text-dim)', fontSize: 13, width: 32, height: 30, cursor: 'pointer', lineHeight: 1,
  },
  err: {
    padding: '8px 16px', background: 'rgba(239,68,68,0.1)', color: '#ef4444',
    fontSize: 11, borderBottom: '1px solid rgba(239,68,68,0.3)',
  },
  scroll: { padding: 20, overflow: 'auto', maxHeight: 'calc(100vh - 160px)' },

  // ── Flyer (paleta D&G + fondo pluma) ──
  flyer: {
    position: 'relative', width: 900, margin: '0 auto', background: DG.bg, color: DG.cream,
    fontFamily: "'Roboto', sans-serif", overflow: 'hidden', borderRadius: 4,
    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
  },
  bgImg: {
    position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
    objectPosition: 'center', opacity: 1, zIndex: 0, pointerEvents: 'none',
  },
  bgTint: {
    position: 'absolute', inset: 0,
    background: 'linear-gradient(180deg, rgba(10,15,28,0.10) 0%, rgba(10,15,28,0.38) 55%, rgba(10,15,28,0.62) 100%)',
    zIndex: 1, pointerEvents: 'none',
  },
  content: { position: 'relative', zIndex: 2, padding: '42px 48px 32px' },

  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 },
  logo: { height: 66, width: 'auto', display: 'block' },
  headerRight: { textAlign: 'right' },
  date: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 10, letterSpacing: 3,
    color: DG.blue, opacity: 0.95,
  },

  titleBlock: { display: 'flex', alignItems: 'center', gap: 18, marginBottom: 14 },
  hairline: { flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${DG.line50}, transparent)` },
  title: {
    fontFamily: "'Cormorant Garamond', Georgia, serif", fontWeight: 500, fontStyle: 'italic',
    fontSize: 32, letterSpacing: 8, color: DG.cream, margin: 0, textAlign: 'center',
  },

  subtitleBlock: { textAlign: 'center', marginBottom: 26 },
  tickerLine: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginBottom: 8 },
  tickerCode: {
    fontFamily: "'Roboto Mono', monospace", fontSize: 26, fontWeight: 700,
    color: DG.cream, letterSpacing: 5,
  },
  issuer: {
    fontFamily: "'Roboto', sans-serif", fontSize: 12, letterSpacing: 2,
    color: DG.creamDim, textTransform: 'uppercase',
  },
  // Tipo de instrumento bajo el emisor — discreto, en azul institucional.
  instrumentType: {
    fontFamily: "'Roboto Mono', monospace", fontSize: 10, letterSpacing: 2.5,
    color: DG.blue, marginTop: 6, textTransform: 'uppercase',
  },
  // Descripción larga del título tomada de PPI (SearchInstrument). Va más
  // abajo, en cursiva, para sumar contexto sin competir con el ticker.
  ppiDescription: {
    fontFamily: "'Cormorant Garamond', Georgia, serif", fontStyle: 'italic',
    fontSize: 14, color: DG.creamSoft, marginTop: 8, padding: '0 24px',
    lineHeight: 1.4, letterSpacing: 0.5,
  },

  // 3 tarjetas métricas: PRECIO · TIR · PARIDAD (MD se removió a pedido).
  summaryRow: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 26,
  },
  metCard: {
    background: DG.panelHi, border: `1px solid ${DG.line25}`, borderRadius: 3,
    padding: '16px 14px', textAlign: 'center', display: 'flex', flexDirection: 'column',
    justifyContent: 'center', minHeight: 96,
  },
  // v2: rótulo de la métrica en blanco institucional (crema), un poco más
  // grande y con más tracking para ganar presencia visual.
  metL: {
    fontFamily: "'Roboto', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 3,
    color: DG.cream, marginBottom: 10, textTransform: 'uppercase',
  },
  // Valor de la métrica también en crema — antes TIR iba en azul.
  metV: {
    fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 26, fontWeight: 600,
    color: DG.cream, letterSpacing: 1,
  },

  // Información del título
  infoBlock: { marginBottom: 22 },
  sectionLabel: {
    fontFamily: "'Roboto', sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: 3,
    color: DG.blue, marginBottom: 12, textTransform: 'uppercase', textAlign: 'center',
  },
  infoGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 28px',
    background: DG.panel, border: `1px solid ${DG.line18}`, borderRadius: 3,
    padding: '14px 18px',
  },
  infoRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    padding: '7px 0', borderBottom: `1px solid ${DG.line10}`, gap: 12,
  },
  infoLabel: {
    fontFamily: "'Roboto', sans-serif", fontSize: 11, color: DG.creamDim,
    letterSpacing: 0.5, flexShrink: 0,
  },
  infoValue: {
    fontFamily: "'Roboto Mono', monospace", fontSize: 11.5, color: DG.cream,
    fontWeight: 500, textAlign: 'right', wordBreak: 'break-word',
  },

  disclaimer: {
    fontFamily: "'Roboto', sans-serif", fontSize: 9, lineHeight: 1.5, color: DG.disc,
    textAlign: 'center', padding: '10px 14px', background: 'rgba(10,15,28,0.35)',
    borderTop: `1px solid ${DG.line25}`, borderBottom: `1px solid ${DG.line25}`,
    marginBottom: 14, letterSpacing: 0.3, fontStyle: 'italic',
  },

  footer: {
    display: 'flex', justifyContent: 'space-between', paddingTop: 12,
    borderTop: `1px solid ${DG.line25}`, fontFamily: "'Roboto Mono', monospace",
    fontSize: 8, letterSpacing: 2, color: DG.muted,
  },
};

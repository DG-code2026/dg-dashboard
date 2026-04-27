// ─────────────────────────────────────────────────────────────────────────────
//  AVISO DE SALDO — Generador de tarjetas para clientes con saldo negativo.
//
//  Flujo:
//   1) Usuario sube un CSV/TSV (export de Google Sheets).
//   2) La app valida formato y muestra errores por fila.
//   3) Por cada cliente con saldo < 0, genera una tarjeta visual
//      (canvas → PNG) con la imagen institucional.
//   4) Tap en la tarjeta → copia al portapapeles la imagen + el mensaje
//      pre-formateado para mandar por WhatsApp/mail.
//
//  Sin backend: todo ocurre en el navegador.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect, useCallback } from 'react';
import { looksLikeXlsx, readXlsxToGrid } from '../lib/xlsx.js';

const BG_URL    = '/logos/fondo%20pluma.svg';
const LOGO_URL  = '/logos/DG%20tema%20oscuro.png';

// Paleta institucional (alineada con PropuestasPage)
const DG = {
  bg:        '#0A0F1C',
  bgMid:     '#1A2236',
  cream:     '#FEF8E6',
  creamDim:  'rgba(254,248,230,0.75)',
  red:       '#E84B4B',
  redSoft:   '#FF5C5C',
};

// ── Headers aceptados (case-insensitive, sin acentos / espacios) ──
const HEADER_ALIASES = {
  broker:     ['broker', 'sociedad', 'agente'],
  comitente:  ['numero_comitente', 'numerocomitente', 'comitente', 'cuenta', 'cc', 'numero_cc', 'nrocc', 'cc_numero'],
  nombre:     ['nombre', 'cliente', 'titular'],
  saldo:      ['saldo', 'monto', 'balance'],
  moneda:     ['moneda', 'currency', 'divisa'],   // opcional
};

// ── Brokers válidos ──
const BROKER_NORM = {
  ppi:    'PPI',
  inviu:  'Inviu',
};

// ── Aliases por broker + moneda ──
function aliasFor(broker, moneda) {
  if (broker === 'PPI'   && moneda === 'ARS') return 'pesosappi.bind';
  if (broker === 'PPI'   && moneda === 'USD') return 'dolaresappi.bind';
  if (broker === 'Inviu' && moneda === 'ARS') return 'PESOS.INVIU';
  if (broker === 'Inviu' && moneda === 'USD') return 'DOLARES.INVIU';
  return null;
}


// ─────────────────────────────────────────────────────────────────────────────
//  CSV PARSING + VALIDACIÓN
// ─────────────────────────────────────────────────────────────────────────────

// Normaliza un header: minúsculas, sin acentos, sin espacios ni puntos.
function normHeader(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[\s.°º\-]+/g, '_').replace(/^_+|_+$/g, '');
}

// Heurística rápida para detectar si un buffer decodificado como UTF-8 es
// "texto razonable" (CSV/TSV) o basura binaria. Contamos bytes de control no
// imprimibles distintos de tab/CR/LF en una muestra inicial.
function isProbablyText(s) {
  if (!s) return false;
  const sample = s.slice(0, 2048);
  let bad = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code === 0xFFFD) { bad++; continue; }                    // replacement char (UTF-8 inválido)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) { // controles (excluye \t \n \r)
      bad++;
    }
  }
  return bad / sample.length < 0.05;
}

// Parser CSV/TSV mínimo, respeta comillas dobles y BOM.
function parseDelimited(text) {
  // Quitar BOM si está
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  // Detectar separador: tab > ; > ,
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const sep = firstLine.includes('\t') ? '\t'
            : firstLine.includes(';')  ? ';'
            : ',';
  const rows = [];
  let cur = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === sep) { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c === '\r') {} // ignorar \r
      else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}

// Resuelve el índice de cada columna requerida en el header.
function resolveColumns(headerRow) {
  const norm = headerRow.map(normHeader);
  const idx = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const found = norm.findIndex(h => aliases.includes(h));
    if (found >= 0) idx[key] = found;
  }
  return idx;
}

// Parsea un saldo formateado en AR → número.
// Acepta: "$ -17.843,85", "-17,843.85", "USD 1.234,56", "1234.56", "-89.20"
function parseSaldo(raw) {
  if (raw == null) return { value: NaN, currencyHint: null };
  let s = String(raw).trim();
  if (!s) return { value: NaN, currencyHint: null };

  // Detectar moneda por marcadores en el string
  const upper = s.toUpperCase();
  let currencyHint = null;
  if (/\bUSD\b|U\$S|U\$D|US\$/.test(upper)) currencyHint = 'USD';
  else if (s.includes('$')) currencyHint = 'ARS';

  // Limpiar todo lo que no sea dígito, signo, coma o punto.
  s = s.replace(/[^\d.,\-]/g, '');

  // Detectar si usa formato AR (1.234,56) o US (1,234.56)
  const hasComma = s.includes(',');
  const hasDot   = s.includes('.');
  if (hasComma && hasDot) {
    // El último que aparece es el decimal
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      // formato AR: . miles, , decimal
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // formato US: , miles, . decimal
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    // sólo coma → asumir decimal AR
    s = s.replace(',', '.');
  }
  // sólo punto o sin separadores → ya es número

  const n = Number(s);
  return { value: n, currencyHint };
}

// Determina la moneda final: columna explícita > hint del saldo > default ARS
function resolveCurrency(rawMoneda, hintFromSaldo) {
  if (rawMoneda) {
    const m = String(rawMoneda).trim().toUpperCase();
    if (m === 'USD' || m === 'U$S' || m === 'DOLARES' || m === 'DÓLARES' || m === 'DOLAR' || m === 'DÓLAR') return 'USD';
    if (m === 'ARS' || m === 'PESOS' || m === '$')                                                       return 'ARS';
  }
  if (hintFromSaldo) return hintFromSaldo;
  return 'ARS';
}

function normalizeBroker(raw) {
  const k = String(raw || '').trim().toLowerCase();
  return BROKER_NORM[k] || null;
}

// Validación principal: devuelve { rows, errors, summary }.
// Acepta una grilla ya parseada (string[][]) — el caller resuelve si vino
// de un CSV/TSV o de un XLSX.
function validateAndParseGrid(grid) {
  const errors = [];
  const rows   = [];

  if (!Array.isArray(grid) || grid.length < 2) {
    return { rows, errors: [{ row: 0, msg: 'La planilla está vacía o no tiene filas de datos.' }], summary: null };
  }

  const headerRow = grid[0];
  const idx = resolveColumns(headerRow);
  const missing = ['broker', 'comitente', 'nombre', 'saldo'].filter(k => idx[k] === undefined);
  if (missing.length) {
    const detected = headerRow.map(h => String(h).trim()).filter(Boolean).join(' | ') || '(ninguno)';
    return {
      rows: [],
      errors: [{ row: 0, msg: `Faltan columnas obligatorias: ${missing.join(', ')}. Headers detectados: ${detected}` }],
      summary: null,
    };
  }

  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const lineNum = i + 1; // para mostrar al usuario (la fila 1 es header)

    const broker  = normalizeBroker(r[idx.broker]);
    // El número de comitente puede venir de XLSX como número (ej. "50054.0").
    // Stripeamos sufijo ".0+" — los comitentes son siempre enteros.
    const cuenta  = String(r[idx.comitente] || '').trim().replace(/\.0+$/, '');
    const nombre  = String(r[idx.nombre]    || '').trim();
    const saldoCol = String(r[idx.saldo]    || '').trim();
    const monedaCol = idx.moneda !== undefined ? r[idx.moneda] : '';

    // — Validaciones por fila (no abortamos, acumulamos) —
    const rowErrs = [];
    if (!broker)  rowErrs.push(`broker inválido ("${r[idx.broker] ?? ''}") — sólo PPI o Inviu`);
    if (!cuenta)  rowErrs.push('falta número de comitente');
    if (!nombre)  rowErrs.push('falta nombre');
    const { value: saldo, currencyHint } = parseSaldo(saldoCol);
    if (!Number.isFinite(saldo)) rowErrs.push(`saldo no numérico ("${saldoCol}")`);

    if (rowErrs.length) {
      errors.push({ row: lineNum, msg: rowErrs.join(' · ') });
      continue;
    }

    const moneda = resolveCurrency(monedaCol, currencyHint);
    rows.push({
      lineNum,
      broker,
      cuenta,
      nombre,
      saldo,
      moneda,
      isDeudor: saldo < 0,
    });
  }

  const deudores = rows.filter(r => r.isDeudor).length;
  return {
    rows,
    errors,
    summary: { total: rows.length, deudores, alDia: rows.length - deudores },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  FORMATEO
// ─────────────────────────────────────────────────────────────────────────────

function fmtAmount(absValue, moneda) {
  const n = Math.abs(absValue);
  // Formato AR: "17.843,85"
  const txt = n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (moneda === 'USD') return `USD ${txt}`;
  return `$ ${txt}`;
}

function fmtAmountWithMinus(value, moneda) {
  const sign = value < 0 ? ' - ' : ' ';
  const n = Math.abs(value).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (moneda === 'USD') return `USD${sign}${n}`;
  return `$${sign}${n}`;
}

function brokerLabel(broker) {
  if (broker === 'PPI')   return 'PP Inversiones';
  if (broker === 'Inviu') return 'Inviu';
  return broker;
}

// Capitaliza cada palabra del nombre: "PEREZ JUAN" → "Perez Juan",
// "maría garcía lópez" → "María García López". Soporta acentos vía
// toLocaleUpperCase/toLocaleLowerCase('es-AR').
function titleCaseName(name) {
  return String(name || '')
    .trim()
    .split(/(\s+)/)               // conservar separadores para reconstruir
    .map(tok => {
      if (/^\s+$/.test(tok) || !tok) return tok;
      return tok.charAt(0).toLocaleUpperCase('es-AR')
           + tok.slice(1).toLocaleLowerCase('es-AR');
    })
    .join('');
}

function buildMessage({ nombre, cuenta, broker, saldo, moneda }) {
  const monto = fmtAmount(saldo, moneda);
  const al    = aliasFor(broker, moneda);
  return (
`Hola ${titleCaseName(nombre)},
Te informamos que tu cuenta (CC N°: ${cuenta}, ${brokerLabel(broker)}) registra un saldo negativo de ${monto}. Te recuerdo que podés:
1) Habilitarnos a vender algún activo para que quede cubierto.
2) Transferir al siguiente alias:

${al}

Cualquier duda quedo a disposición, saludos!`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  PRECARGA DE ASSETS (background + logo) en <img> compartidos
// ─────────────────────────────────────────────────────────────────────────────

function useImageAsset(src) {
  const [img, setImg] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload  = () => { if (!cancelled) setImg(i); };
    i.onerror = () => { if (!cancelled) setImg(null); };
    i.src = src;
    return () => { cancelled = true; };
  }, [src]);
  return img;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DIBUJO DE LA TARJETA EN CANVAS
// ─────────────────────────────────────────────────────────────────────────────

function drawCard(canvas, { nombre, cuenta, broker, saldo, moneda }, { bgImg, logoImg }) {
  const W = 1280, H = 720;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Fondo: navy base + SVG de pluma encima.
  ctx.fillStyle = DG.bg;
  ctx.fillRect(0, 0, W, H);
  if (bgImg) {
    // El SVG es 1920x1080 aprox, lo escalamos manteniendo aspecto.
    const ratio = bgImg.width / bgImg.height;
    let dw = W, dh = W / ratio;
    if (dh < H) { dh = H; dw = H * ratio; }
    const dx = (W - dw) / 2, dy = (H - dh) / 2;
    ctx.drawImage(bgImg, dx, dy, dw, dh);
  }

  // Logo top-left
  if (logoImg) {
    const logoH = 110;
    const logoW = (logoImg.width / logoImg.height) * logoH;
    ctx.drawImage(logoImg, 56, 40, logoW, logoH);
  }

  // Título
  ctx.fillStyle = DG.cream;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '500 56px "Cormorant Garamond", "Times New Roman", serif';
  ctx.fillText('Aviso de Saldo Negativo', W / 2, 270);

  // Línea CC + Broker
  ctx.font = '400 38px "Roboto", Arial, sans-serif';
  ctx.fillStyle = DG.creamDim;
  const ccText = `CC N°: ${cuenta}`;
  const brkText = brokerLabel(broker);
  // Dejamos un espacio amplio entre los dos
  const gap = 110;
  ctx.textAlign = 'left';
  const ccW = ctx.measureText(ccText).width;
  const brkW = ctx.measureText(brkText).width;
  const totalW = ccW + gap + brkW;
  const startX = (W - totalW) / 2;
  ctx.fillText(ccText,  startX, 380);
  ctx.fillText(brkText, startX + ccW + gap, 380);

  // Caja roja con el monto
  const monto = fmtAmountWithMinus(saldo, moneda);
  ctx.font = '700 84px "Roboto", Arial, sans-serif';
  const montoW = ctx.measureText(monto).width;
  const boxPadX = 56;
  const boxPadY = 26;
  const boxW = montoW + boxPadX * 2;
  const boxH = 130;
  const boxX = (W - boxW) / 2;
  const boxY = 480;
  ctx.lineWidth = 4;
  ctx.strokeStyle = DG.red;
  ctx.beginPath();
  ctx.rect(boxX, boxY, boxW, boxH);
  ctx.stroke();

  ctx.fillStyle = DG.cream;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(monto, W / 2, boxY + boxH / 2 + 4);

  // Footer: alias en la esquina inferior izquierda
  const al = aliasFor(broker, moneda);
  if (al) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '400 26px "Roboto", Arial, sans-serif';
    ctx.fillStyle = DG.creamDim;
    ctx.fillText('Alias: ', 56, H - 48);
    const labelW = ctx.measureText('Alias: ').width;
    ctx.font = '700 26px "Roboto Mono", "Courier New", monospace';
    ctx.fillStyle = DG.cream;
    ctx.fillText(al, 56 + labelW, H - 48);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PERSISTENCIA (localStorage)
//
//  Guardamos dos cosas separadas:
//    1) dataset → la planilla actualmente cargada (rows + summary + filename).
//       Se reemplaza cuando el usuario sube una planilla nueva.
//    2) marks   → por cada (broker|cuenta), si el aviso ya fue enviado y/o
//       tiene un nombre editado a mano. Persiste entre uploads — si volvés
//       a subir la misma planilla mañana, los flags y nombres siguen ahí.
// ─────────────────────────────────────────────────────────────────────────────
const STORAGE_DATASET = 'avisos_saldo_dataset_v1';
const STORAGE_MARKS   = 'avisos_saldo_marks_v1';

function loadDataset() {
  try {
    const raw = localStorage.getItem(STORAGE_DATASET);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.rows) && parsed.rows.length) return parsed;
    return null;
  } catch { return null; }
}

function saveDataset(payload) {
  try { localStorage.setItem(STORAGE_DATASET, JSON.stringify(payload)); } catch {}
}

function clearDataset() {
  try { localStorage.removeItem(STORAGE_DATASET); } catch {}
}

function loadMarks() {
  try { return JSON.parse(localStorage.getItem(STORAGE_MARKS) || '{}'); }
  catch { return {}; }
}

function saveMarks(marks) {
  try { localStorage.setItem(STORAGE_MARKS, JSON.stringify(marks)); } catch {}
}

// ID estable por fila: broker + número de comitente.
const rowId = (r) => `${r.broker}|${r.cuenta}`;

// ─────────────────────────────────────────────────────────────────────────────
//  PÁGINA
// ─────────────────────────────────────────────────────────────────────────────

export default function AvisosSaldoPage() {
  // — Hidratación inicial desde localStorage —
  const [parseResult, setParseResult] = useState(() => {
    const ds = loadDataset();
    if (!ds) return null;
    return {
      rows: ds.rows,
      errors: [],
      summary: ds.summary || {
        total: ds.rows.length,
        deudores: ds.rows.filter(r => r.isDeudor).length,
        alDia:    ds.rows.filter(r => !r.isDeudor).length,
      },
    };
  });
  const [fileName, setFileName] = useState(() => loadDataset()?.fileName || '');
  const [marks, setMarks]       = useState(() => loadMarks());

  const fileInputRef = useRef(null);

  const bgImg   = useImageAsset(BG_URL);
  const logoImg = useImageAsset(LOGO_URL);
  const assetsReady = !!bgImg && !!logoImg;

  // Persistir dataset cada vez que cambia (sólo si hay rows válidas).
  useEffect(() => {
    if (parseResult && parseResult.rows.length) {
      saveDataset({
        rows: parseResult.rows,
        summary: parseResult.summary,
        fileName,
        loadedAt: Date.now(),
      });
    }
  }, [parseResult, fileName]);

  // Persistir marks cada vez que cambian.
  useEffect(() => { saveMarks(marks); }, [marks]);

  const updateMark = useCallback((id, patch) => {
    setMarks(m => {
      const cur = m[id] || {};
      const next = { ...cur, ...patch };
      // Si todo quedó vacío/falsy, eliminar la entry para no acumular basura.
      if (!next.nombreOverride && !next.sent) {
        const { [id]: _drop, ...rest } = m;
        return rest;
      }
      return { ...m, [id]: next };
    });
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setFileName(file.name);

    const fail = (msg) => setParseResult({ rows: [], errors: [{ row: 0, msg }], summary: null });
    const ok   = (grid) => setParseResult(validateAndParseGrid(grid));

    try {
      // Leemos como ArrayBuffer para inspeccionar magic bytes — así detectamos
      // XLSX aunque venga con extensión equivocada, y evitamos volcar binario
      // a la UI cuando alguien sube un .xlsx pensando que es CSV.
      const buf = await file.arrayBuffer();

      if (looksLikeXlsx(buf)) {
        try {
          const grid = await readXlsxToGrid(buf);
          ok(grid);
        } catch (e) {
          console.error('xlsx parse error:', e);
          fail(`No se pudo leer el archivo XLSX (${e.message || 'error desconocido'}). Probá exportarlo como CSV: en Sheets → Archivo → Descargar → "Valores separados por comas (.csv)".`);
        }
        return;
      }

      // No es XLSX: intentamos como texto (CSV/TSV).
      const text = new TextDecoder('utf-8').decode(buf);
      // Si parece binario (muchos bytes no-imprimibles), abortar con mensaje claro.
      if (!isProbablyText(text)) {
        fail(`El archivo "${file.name}" no parece ser un CSV/TSV ni un XLSX. Subí un archivo CSV o XLSX con las columnas: broker, numero_comitente, nombre, saldo.`);
        return;
      }
      ok(parseDelimited(text));
    } catch (e) {
      console.error('file read error:', e);
      fail(`Error de lectura del archivo: ${e.message || 'desconocido'}.`);
    }
  }, []);

  const onPick = (e) => {
    const f = e.target.files?.[0];
    handleFile(f);
    e.target.value = ''; // permitir resubir el mismo archivo
  };

  const onDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    handleFile(f);
  };

  // "Cargar otra planilla" → abre el file picker; el dataset actual se reemplaza
  // cuando se valide el nuevo archivo. Las marks (enviado / nombres editados)
  // se preservan para que un re-upload no pierda historial.
  const pickAnother = () => fileInputRef.current?.click();

  // "Limpiar todo" → wipe completo (dataset + marks).
  const clearAll = () => {
    if (!window.confirm('¿Borrar la planilla actual y todas las marcas (enviado / nombres editados)?')) return;
    clearDataset();
    saveMarks({});
    setParseResult(null);
    setFileName('');
    setMarks({});
  };

  const deudores = parseResult?.rows.filter(r => r.isDeudor) || [];
  const sentCount = deudores.filter(r => marks[rowId(r)]?.sent).length;

  return (
    <div style={st.wrap}>
      {!parseResult && (
        <DropZone
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.tsv,.txt,.xlsx,text/csv,text/plain,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={onPick}
        style={{ display: 'none' }}
      />

      {parseResult && (
        <ResultPanel
          fileName={fileName}
          parseResult={parseResult}
          sentCount={sentCount}
          onPickAnother={pickAnother}
          onClearAll={clearAll}
        />
      )}

      {parseResult && parseResult.errors.length === 0 && deudores.length === 0 && (
        <div style={st.emptyOk}>
          ✓ Ningún cliente registra saldo negativo en esta planilla.
        </div>
      )}

      {parseResult && deudores.length > 0 && (
        <div style={st.list}>
          {!assetsReady && (
            <div style={st.assetsLoading}>Cargando assets institucionales…</div>
          )}
          {deudores.map((r) => {
            const id = rowId(r);
            const mark = marks[id] || {};
            const effectiveNombre = mark.nombreOverride || r.nombre;
            return (
              <DebtorCard
                key={id}
                data={{ ...r, nombre: effectiveNombre }}
                originalNombre={r.nombre}
                sent={!!mark.sent}
                hasOverride={!!mark.nombreOverride}
                onToggleSent={() => updateMark(id, { sent: !mark.sent })}
                onRenameSave={(newName) => {
                  const trimmed = String(newName || '').trim();
                  if (!trimmed || trimmed === r.nombre) {
                    updateMark(id, { nombreOverride: undefined });
                  } else {
                    updateMark(id, { nombreOverride: trimmed });
                  }
                }}
                bgImg={bgImg}
                logoImg={logoImg}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Componentes
// ─────────────────────────────────────────────────────────────────────────────

function DropZone({ onDrop, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onDragOver={e => { e.preventDefault(); setHover(true); }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => { setHover(false); onDrop(e); }}
      style={{ ...st.drop, ...(hover ? st.dropHover : {}) }}
    >
      <div style={st.dropIcon}>+</div>
      <div style={st.dropTitle}>Cargar planilla</div>
      <div style={st.dropSub}>
        Arrastrá un archivo o hacé clic. Acepta CSV, TSV o XLSX (Excel / Sheets).
      </div>
      <div style={st.dropHint}>
        Columnas requeridas: <b>broker</b>, <b>numero_comitente</b>, <b>nombre</b>, <b>saldo</b> · opcional: <b>moneda</b>
      </div>
    </div>
  );
}

function ResultPanel({ fileName, parseResult, sentCount = 0, onPickAnother, onClearAll }) {
  const { errors, summary } = parseResult;
  const hasFatal = !summary;
  const pendientes = summary ? Math.max(0, summary.deudores - sentCount) : 0;
  return (
    <div style={st.resultPanel}>
      <div style={st.resultRow}>
        <div>
          <div style={st.resultFile}>{fileName || '(planilla restaurada de la sesión anterior)'}</div>
          {summary && (
            <div style={st.resultStats}>
              <Stat label="filas" value={summary.total} />
              <Stat label="deudores" value={summary.deudores} accent />
              <Stat label="enviados" value={sentCount} dim />
              <Stat label="pendientes" value={pendientes} accent />
              {errors.length > 0 && <Stat label="errores" value={errors.length} warn />}
            </div>
          )}
          {hasFatal && (
            <div style={st.fatalErr}>
              {errors.map((e, i) => <div key={i}>· {e.msg}</div>)}
            </div>
          )}
        </div>
        <div style={st.resultActions}>
          <button onClick={onPickAnother} style={st.resetBtn}>Cargar otra planilla</button>
          <button onClick={onClearAll}    style={st.clearBtn}>Limpiar todo</button>
        </div>
      </div>

      {!hasFatal && errors.length > 0 && (
        <details style={st.errDetails}>
          <summary style={st.errSummary}>Ver {errors.length} fila(s) con errores</summary>
          <div style={st.errList}>
            {errors.map((e, i) => (
              <div key={i} style={st.errItem}>
                <span style={st.errRow}>fila {e.row}</span>
                <span>{e.msg}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Stat({ label, value, accent, dim, warn }) {
  return (
    <div style={st.stat}>
      <span style={{
        ...st.statValue,
        ...(accent ? { color: 'var(--neon)' } : {}),
        ...(dim    ? { color: 'var(--text-dim)' } : {}),
        ...(warn   ? { color: '#ef4444' } : {}),
      }}>{value}</span>
      <span style={st.statLabel}>{label}</span>
    </div>
  );
}

// Slug seguro para nombre de archivo: ASCII, sin espacios ni símbolos raros.
function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // sacar acentos
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'aviso';
}

function DebtorCard({
  data,
  originalNombre,
  hasOverride,
  sent,
  onToggleSent,
  onRenameSave,
  bgImg,
  logoImg,
}) {
  const canvasRef = useRef(null);
  const [status, setStatus] = useState(null); // { ok: bool, msg: string }
  const [editing, setEditing] = useState(false);
  const [tempName, setTempName] = useState(data.nombre);

  // Pre-generamos el PNG cada vez que cambia la data, para que dragstart sea
  // inmediato y síncrono (ningún await entre dragstart y setData).
  //  - blobRef    : el Blob crudo, para construir un File real e insertarlo
  //                 en dataTransfer.items (necesario para targets web tipo
  //                 WhatsApp Web / Gmail / Slack que leen dataTransfer.files).
  //  - blobUrlRef : Object URL del mismo Blob, usado por el truco DownloadURL
  //                 que permite soltar el archivo en Explorer/Finder/Desktop.
  const blobRef     = useRef(null);
  const blobUrlRef  = useRef(null);
  const fileNameRef = useRef('aviso.png');

  useEffect(() => { setTempName(data.nombre); }, [data.nombre]);

  // Redibujar cuando cambian los assets o la data (incluye nombre editado).
  // Después del redraw, regeneramos también el Blob + Object URL para drag-out.
  useEffect(() => {
    if (!canvasRef.current || !bgImg || !logoImg) return;
    drawCard(canvasRef.current, data, { bgImg, logoImg });

    canvasRef.current.toBlob((blob) => {
      if (!blob) return;
      // Liberar el URL anterior antes de reemplazar.
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobRef.current    = blob;
      blobUrlRef.current = URL.createObjectURL(blob);
      fileNameRef.current = `aviso_saldo_${slugify(data.nombre)}_${data.cuenta}.png`;
    }, 'image/png');
  }, [bgImg, logoImg, data]);

  // Cleanup final del blob URL.
  useEffect(() => () => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
  }, []);

  // Drag-out del canvas. Acá hay una limitación real del browser que conviene
  // explicar:
  //
  //   - Drop sobre el sistema operativo (Explorer / Finder / Desktop / cualquier
  //     app nativa que acepte un archivo): funciona vía 'DownloadURL', el
  //     browser materializa un PNG real en el target.
  //
  //   - Drop sobre OTRA página web (WhatsApp Web, Gmail, Slack, etc.): NO
  //     funciona confiablemente — Chrome no permite que un File sintetizado
  //     desde JS aparezca en e.dataTransfer.files del destino. Por eso si
  //     ponemos text/plain o text/uri-list como fallback, WhatsApp termina
  //     "pegando el blob URL como texto".
  //
  // Workaround pragmático: al iniciar el drag copiamos también la imagen al
  // clipboard. Si el drop sobre WhatsApp falla, el usuario hace Ctrl+V en el
  // chat y se pega como adjunto real (esto sí lo soporta WhatsApp Web).
  //
  // dragstart NO puede ser async — usamos blobRef ya pre-generado.
  const onDragStart = useCallback((e) => {
    const blob = blobRef.current;
    const url  = blobUrlRef.current;
    if (!blob || !url) {
      e.preventDefault();
      return;
    }
    const fileName = fileNameRef.current;
    try {
      e.dataTransfer.effectAllowed = 'copy';

      // File real → algunos browsers (Firefox) lo aceptan; en Chrome es no-op.
      try {
        const file = new File([blob], fileName, { type: 'image/png' });
        e.dataTransfer.items.add(file);
      } catch {}

      // DownloadURL → habilita drop en file-system targets (Chromium).
      try {
        e.dataTransfer.setData('DownloadURL', `image/png:${fileName}:${url}`);
      } catch {}

      // ⚠ NO seteamos text/plain ni text/uri-list — eso hace que web-targets
      //   peguen la URL del blob como texto (era el bug que veías en WhatsApp).

      if (canvasRef.current && e.dataTransfer.setDragImage) {
        e.dataTransfer.setDragImage(canvasRef.current, 20, 20);
      }
    } catch (err) {
      console.warn('drag-out failed:', err);
    }

    // Paralelo: copiamos al clipboard. dragstart cuenta como gesto del usuario,
    // así que clipboard.write está permitido. Esto NO afecta el drag — sólo
    // deja la imagen lista para Ctrl+V si el drop falla (caso WhatsApp Web).
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        navigator.clipboard
          .write([new ClipboardItem({ 'image/png': blob })])
          .then(() => flash(true, '✓ Arrastrá o pegá con Ctrl+V'))
          .catch(() => {/* silencioso */});
      }
    } catch {}
  }, []);

  const flash = (ok, msg) => {
    setStatus({ ok, msg });
    setTimeout(() => setStatus(null), ok ? 1800 : 2400);
  };

  // Genera el blob de la imagen una sola vez por copia.
  const getImageBlob = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (!canvasRef.current) return reject(new Error('Imagen aún no lista'));
      canvasRef.current.toBlob(b => {
        if (!b) reject(new Error('No se pudo generar la imagen'));
        else resolve(b);
      }, 'image/png');
    });
  }, []);

  const copyImageOnly = useCallback(async (e) => {
    if (e) e.stopPropagation();
    try {
      const blob = await getImageBlob();
      if (!navigator.clipboard || !window.ClipboardItem) {
        throw new Error('Tu navegador no soporta copiar imágenes');
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      flash(true, '✓ Imagen copiada');
    } catch (err) {
      console.error('copyImage:', err);
      flash(false, `× ${err.message || 'No se pudo copiar la imagen'}`);
    }
  }, [getImageBlob]);

  const copyTextOnly = useCallback(async (e) => {
    if (e) e.stopPropagation();
    try {
      const message = buildMessage(data);
      await navigator.clipboard.writeText(message);
      flash(true, '✓ Mensaje copiado');
    } catch (err) {
      console.error('copyText:', err);
      flash(false, `× ${err.message || 'No se pudo copiar el mensaje'}`);
    }
  }, [data]);

  // Nombre mostrado: si el usuario lo editó, verbatim; si no, title-case.
  const displayName = hasOverride ? data.nombre : titleCaseName(data.nombre);

  const startEdit  = (e) => { e.stopPropagation(); setTempName(displayName); setEditing(true); };
  const saveEdit   = () => { onRenameSave?.(tempName); setEditing(false); };
  const cancelEdit = () => { setTempName(displayName); setEditing(false); };
  const resetName  = (e) => { e.stopPropagation(); onRenameSave?.(originalNombre); };

  return (
    <div style={{ ...st.card, ...(sent ? st.cardSent : {}) }}>
      <canvas
        ref={canvasRef}
        style={st.canvas}
        draggable
        onDragStart={onDragStart}
        title="Arrastrá afuera del navegador para guardar el archivo. Para WhatsApp Web: arrastrá y luego pegá con Ctrl+V (la imagen queda en el clipboard)."
      />

      <div style={st.cardSide}>
        {/* Row 1: nombre (izq) + monto (der) */}
        <div style={st.cardRowTop}>
          <div style={st.cardNameRow}>
            {editing ? (
              <>
                <input
                  autoFocus
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit();
                    else if (e.key === 'Escape') cancelEdit();
                  }}
                  style={st.nameInput}
                />
                <button onClick={saveEdit}   style={st.iconBtnOk} title="Guardar">✓</button>
                <button onClick={cancelEdit} style={st.iconBtn}   title="Cancelar">×</button>
              </>
            ) : (
              <>
                <span style={st.cardName}>{displayName}</span>
                <button onClick={startEdit} style={st.iconBtn} title="Editar nombre">✎</button>
                {hasOverride && (
                  <button onClick={resetName} style={st.iconBtnDim} title={`Restaurar nombre original: ${originalNombre}`}>↺</button>
                )}
              </>
            )}
          </div>
          <div style={st.cardAmount}>
            {fmtAmountWithMinus(data.saldo, data.moneda)}
          </div>
        </div>

        {/* Row 2: meta inline (broker · cc · alias) */}
        <div style={st.cardMeta}>
          <span>{brokerLabel(data.broker)}</span>
          <span style={st.dot}>·</span>
          <span>CC {data.cuenta}</span>
          <span style={st.dot}>·</span>
          <span>alias <b style={st.aliasInline}>{aliasFor(data.broker, data.moneda) || '—'}</b>{originalNombre && <span style={st.ownerInline}> · {titleCaseName(originalNombre)}</span>}</span>
        </div>

        {/* Row 3: botones de copia + status + sent toggle */}
        <div style={st.cardRowBottom}>
          <div style={st.copyRow}>
            <button onClick={copyImageOnly} style={st.copyBtn} title="Sólo imagen">🖼 Imagen</button>
            <button onClick={copyTextOnly}  style={st.copyBtn} title="Sólo texto">✉ Mensaje</button>
            {status && (
              <span style={{
                ...st.statusInline,
                ...(status.ok ? st.statusOk : st.statusErr),
              }}>{status.msg}</span>
            )}
          </div>
          <label style={st.sentToggle}>
            <input
              type="checkbox"
              checked={!!sent}
              onChange={onToggleSent}
              style={st.sentCheck}
            />
            <span style={{ ...st.sentLabel, ...(sent ? st.sentLabelOn : {}) }}>
              {sent ? '✓ Enviado' : 'Marcar enviado'}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  ESTILOS
// ─────────────────────────────────────────────────────────────────────────────

const st = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 24, paddingTop: 8 },

  drop: {
    border: '1.5px dashed var(--border-neon)',
    borderRadius: 8,
    padding: '60px 32px',
    textAlign: 'center',
    cursor: 'pointer',
    background: 'var(--bg-card)',
    transition: 'border-color 0.15s, background 0.15s',
  },
  dropHover:  { borderColor: 'var(--neon)', background: 'rgba(0,255,170,0.04)' },
  dropIcon:   { fontSize: 64, color: 'var(--neon)', lineHeight: 1, marginBottom: 12 },
  dropTitle:  { fontFamily: "'Cormorant Garamond', serif", fontSize: 24, color: 'var(--text)', marginBottom: 8 },
  dropSub:    { fontFamily: "'Roboto', sans-serif", fontSize: 12, color: 'var(--text-dim)', marginBottom: 16 },
  dropHint:   { fontFamily: "'Roboto Mono', monospace", fontSize: 10, color: 'var(--text-dim)', letterSpacing: 1 },

  resultPanel: {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
    padding: 16,
  },
  resultRow:   { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  resultFile:  { fontFamily: "'Roboto Mono', monospace", fontSize: 11, color: 'var(--text-dim)', letterSpacing: 1, marginBottom: 6 },
  resultStats: { display: 'flex', gap: 24, flexWrap: 'wrap' },
  stat:        { display: 'flex', flexDirection: 'column', alignItems: 'flex-start' },
  statValue:   { fontFamily: "'Roboto', sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text)' },
  statLabel:   { fontFamily: "'Roboto Mono', monospace", fontSize: 9, letterSpacing: 2, color: 'var(--text-dim)', textTransform: 'uppercase' },
  resultActions: { display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' },
  resetBtn:    { background: 'transparent', color: 'var(--neon)', border: '1px solid var(--neon)', borderRadius: 4, padding: '8px 14px', fontFamily: "'Montserrat', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: 2, cursor: 'pointer' },
  clearBtn:    { background: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 12px', fontFamily: "'Roboto Mono', monospace", fontSize: 9, letterSpacing: 1.5, cursor: 'pointer' },

  fatalErr:   { marginTop: 12, padding: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 4, color: '#ef4444', fontSize: 12, fontFamily: "'Roboto Mono', monospace", lineHeight: 1.5 },
  errDetails: { marginTop: 12 },
  errSummary: { cursor: 'pointer', fontFamily: "'Roboto Mono', monospace", fontSize: 10, color: '#ef4444', letterSpacing: 1 },
  errList:    { marginTop: 8, padding: 12, background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 4 },
  errItem:    { display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 11, lineHeight: 1.6, color: 'var(--text)' },
  errRow:     { fontFamily: "'Roboto Mono', monospace", color: '#ef4444', fontWeight: 700, minWidth: 60 },

  emptyOk:    { padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace", fontSize: 12, letterSpacing: 1 },

  list: { display: 'flex', flexDirection: 'column', gap: 16 },
  assetsLoading: { padding: 16, textAlign: 'center', color: 'var(--text-dim)', fontSize: 11, fontFamily: "'Roboto Mono', monospace", letterSpacing: 1 },

  // ── Card compacta (3 filas en el panel lateral, thumbnail chico) ──
  card: {
    display: 'grid',
    gridTemplateColumns: '180px 1fr',
    gap: 12,
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    overflow: 'hidden',
    transition: 'opacity 0.15s, border-color 0.15s, box-shadow 0.15s',
  },
  cardSent:  { opacity: 0.55, borderColor: 'rgba(0,255,170,0.35)' },
  canvas:    { width: '100%', height: 'auto', display: 'block', background: DG.bg, cursor: 'grab' },
  cardSide:  { padding: '8px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0, gap: 4 },

  // Row 1: nombre (izq) + monto (der)
  cardRowTop:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minWidth: 0 },
  cardNameRow: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 },
  cardName:    { fontFamily: "'Cormorant Garamond', serif", fontSize: 18, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  nameInput:   { fontFamily: "'Roboto', sans-serif", fontSize: 13, color: 'var(--text)', background: 'var(--input-bg)', border: '1px solid var(--neon)', borderRadius: 3, padding: '3px 6px', flex: 1, outline: 'none', minWidth: 0 },
  iconBtn:     { background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', width: 22, height: 22, fontSize: 11, cursor: 'pointer', flexShrink: 0, padding: 0, lineHeight: 1 },
  iconBtnOk:   { background: 'transparent', border: '1px solid var(--neon)',  borderRadius: 3, color: 'var(--neon)',     width: 22, height: 22, fontSize: 11, cursor: 'pointer', flexShrink: 0, padding: 0, lineHeight: 1 },
  iconBtnDim:  { background: 'transparent', border: '1px dashed var(--border)', borderRadius: 3, color: 'var(--text-dim)', width: 22, height: 22, fontSize: 10, cursor: 'pointer', flexShrink: 0, padding: 0, lineHeight: 1, opacity: 0.7 },
  cardAmount:  { fontFamily: "'Roboto', sans-serif", fontSize: 16, fontWeight: 700, color: '#ef4444', flexShrink: 0, whiteSpace: 'nowrap' },

  // Row 2: meta inline
  cardMeta:    { display: 'flex', alignItems: 'center', gap: 6, fontFamily: "'Roboto Mono', monospace", fontSize: 9.5, color: 'var(--text-dim)', letterSpacing: 1, flexWrap: 'wrap' },
  dot:         { color: 'var(--text-dim)', opacity: 0.6 },
  aliasInline: { color: 'var(--text)', fontWeight: 700 },
  ownerInline: { color: 'var(--text-dim)', fontWeight: 400 },

  // Row 3: copia + sent
  cardRowBottom: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  copyRow:       { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  copyBtn:       { background: 'transparent', color: 'var(--neon)', border: '1px solid var(--neon)', borderRadius: 3, padding: '4px 8px', fontFamily: "'Roboto Mono', monospace", fontSize: 9, fontWeight: 700, letterSpacing: 1, cursor: 'pointer' },
  statusInline:  { fontFamily: "'Roboto Mono', monospace", fontSize: 9, letterSpacing: 0.5, padding: '2px 6px', borderRadius: 2 },
  statusOk:      { color: 'var(--neon)' },
  statusErr:     { color: '#ef4444' },

  sentToggle:  { display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', flexShrink: 0 },
  sentCheck:   { width: 14, height: 14, accentColor: 'var(--neon)', cursor: 'pointer', margin: 0 },
  sentLabel:   { fontFamily: "'Roboto Mono', monospace", fontSize: 9, letterSpacing: 1.5, color: 'var(--text-dim)' },
  sentLabelOn: { color: 'var(--neon)', fontWeight: 700 },
};

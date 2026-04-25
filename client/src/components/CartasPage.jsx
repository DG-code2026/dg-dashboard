import { useState, useEffect } from 'react';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// ─────────────────────────────────────────────────────────────────────────────
//  CARTAS — generador de cartas a partir de plantillas (cáscaras).
//
//  Filosofía:
//   - Las cartas NO se persisten. Lo único que vive en el repo son las
//     plantillas .docx ("cáscaras") en `client/public/templates/`, que sirven
//     de referencia humana del layout original.
//   - El PDF se genera 100% client-side con pdf-lib (sin server, sin libreoffice)
//     reconstruyendo el layout a mano para cada tipo. Cada tipo es una entrada
//     en CARTA_TYPES con sus campos y su builder.
//
//  Para sumar un tipo nuevo:
//   - Copiar el .docx a `client/public/templates/`.
//   - Agregar entrada en CARTA_TYPES con { id, label, fields, buildPDF }.
//   - Implementar la función buildPDF correspondiente.
// ─────────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════

// ISO YYYY-MM-DD → DD/MM/YYYY (formato pedido por el usuario).
function fmtFecha(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

// Número → "100.000,00" (estilo es-AR: punto como miles, coma como decimal).
// Acepta strings con coma o punto como separador decimal entrante.
function fmtMonto(v) {
  if (v == null || v === '') return '';
  const norm = String(v).replace(/\./g, '').replace(',', '.');
  const n = Number(norm);
  if (!isFinite(n)) return String(v);
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Limpia un string para usarlo en un nombre de archivo: deja alfanuméricos,
// punto, guion y guion bajo. Colapsa repetidos.
function sanitizeForFilename(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // saca acentos
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Dispara la descarga de un Uint8Array como archivo en el browser.
function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Liberamos la URL del blob un toque después para que Safari no aborte la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// Hoy en formato YYYY-MM-DD para defaultValue del <input type="date">.
function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

// ══════════════════════════════════════════════
//  PDF BUILDER · TRF Pershing → PPI
//
//  Layout reconstruido del .docx original (con ajuste pedido por usuario:
//  el saludo "To whom it may concern," se reubica entre Ref. Account y body):
//
//   ┌──────────────────────┬──────────────────────┐
//   │ PERSHING LLC         │              Date: (f) │
//   │ 1st Pershing Plaza   │                         │
//   │ Jersey City, NJ      │                         │
//   │ 07399 USA            │                         │
//   │                      │                         │
//   │                      │       Ref. Account: (n) │
//   └──────────────────────┴──────────────────────┘
//
//   To whom it may concern,
//
//   Please, transfer from my account (n), the amount of USD (m) according
//   to the following instructions:
//
//   Bank name: The Bank Of New York Mellon
//   City: New York
//   Country: United States
//   SWIFT Address: IRVTUS3N
//   ABA number (FED): 021 000 018
//   Account number: 7887808400
//   Account Name: PP Inversiones S.A.
//   Reference: PP Inversiones S.A. – AGT 262
//   FFC: (cuenta PPI)
//
//   Best regards,
// ══════════════════════════════════════════════

async function buildTrfPshPpiPdf({ fecha, pshAccount, monto, ppiAccount }) {
  const doc = await PDFDocument.create();
  // A4 portrait — 595.28 × 841.89 pt.
  const page = doc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();

  const reg  = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Métricas. El docx usa Calibri 11pt con line-height ~13.5; replicamos.
  const FS = 11;
  const LH = 15;

  // Márgenes: en el original son ~85pt izq / ~92pt der / ~46pt top / ~185pt bottom.
  // Bajamos un poco el bottom porque no necesitamos espacio reservado para firma
  // (el espacio sale solo del flujo de contenido).
  const ML = 70;
  const MR = 70;
  const MT = 50;

  // ── BLOQUE SUPERIOR: dos columnas ──
  // El docx parte la página en 2 columnas iguales. Replicamos con un gap chico.
  const colGap = 30;
  const colW = (width - ML - MR - colGap) / 2;
  const leftX = ML;
  const rightX = ML + colW + colGap;

  let yTop = height - MT;

  // Columna izquierda: dirección de Pershing.
  const addrLines = [
    'PERSHING LLC',
    '1st Pershing Plaza',
    'Jersey City, New Jersey',
    '07399 United States of America',
  ];
  let lyL = yTop;
  for (const line of addrLines) {
    page.drawText(line, { x: leftX, y: lyL, size: FS, font: reg });
    lyL -= LH;
  }

  // Columna derecha:
  //   1) "Date: <fecha>" (right-aligned, alineado con la primera línea de la dir)
  //   2) (gap grande)
  //   3) "Ref. Account: <pshAccount>" (right-aligned)
  //
  // Nota: el saludo "To whom it may concern," se mueve abajo (entre Ref. Account
  // y el párrafo del body) por pedido del usuario.
  let lyR = yTop;

  // Date — bold "Date: " + bold "<fecha>", right-aligned.
  const dateLabel = 'Date: ';
  const dateValue = fmtFecha(fecha);
  const dateLabelW = bold.widthOfTextAtSize(dateLabel, FS);
  const dateValueW = bold.widthOfTextAtSize(dateValue, FS);
  const dateTotalW = dateLabelW + dateValueW;
  const dateX = rightX + colW - dateTotalW;
  page.drawText(dateLabel, { x: dateX, y: lyR, size: FS, font: bold });
  page.drawText(dateValue, { x: dateX + dateLabelW, y: lyR, size: FS, font: bold });

  // Gap grande replicando el "before=2476" del docx (≈ 170 pt).
  lyR -= 170;

  // Ref. Account: regular + bold, right-aligned.
  const refLabel = 'Ref. Account: ';
  const refValue = pshAccount;
  const refLabelW = reg.widthOfTextAtSize(refLabel, FS);
  const refValueW = bold.widthOfTextAtSize(refValue, FS);
  const refTotalW = refLabelW + refValueW;
  const refX = rightX + colW - refTotalW;
  page.drawText(refLabel, { x: refX, y: lyR, size: FS, font: reg });
  page.drawText(refValue, { x: refX + refLabelW, y: lyR, size: FS, font: bold });

  // ── SALUDO + BODY: arrancan debajo del más bajo de las dos columnas + gap. ──
  let y = Math.min(lyL, lyR) - 40;

  // "To whom it may concern," — left-aligned, encima del párrafo del body.
  page.drawText('To whom it may concern,', { x: ML, y, size: FS, font: reg });
  y -= LH * 1.6; // gap entre saludo y párrafo

  // Línea con runs mezclados regular/bold; word-wrap manual.
  const bodyRuns = [
    { text: 'Please, transfer from my account ',                    font: reg  },
    { text: pshAccount,                                              font: bold },
    { text: ', the amount of USD ',                                  font: reg  },
    { text: fmtMonto(monto),                                         font: bold },
    { text: ' according to the following instructions:',             font: reg  },
  ];
  y = drawWrappedRuns(page, bodyRuns, ML, y, width - ML - MR, FS, LH);

  y -= LH; // gap entre el "instructions:" y el bloque del banco

  // ── DATOS DEL BANCO ──
  // Cada entrada: lista de runs que componen la línea (label bold + valor regular,
  // salvo Account Name / Reference / FFC que son enteramente bold).
  const bankLines = [
    [{ text: 'Bank name: ',         font: bold }, { text: 'The Bank Of New York Mellon', font: reg  }],
    [{ text: 'City',                font: bold }, { text: ': New York',                  font: reg  }],
    [{ text: 'Country: ',           font: bold }, { text: 'United States',               font: reg  }],
    [{ text: 'SWIFT Address: ',     font: bold }, { text: 'IRVTUS3N',                    font: reg  }],
    [{ text: 'ABA number (FED): ',  font: bold }, { text: '021 000 018',                 font: reg  }],
    [{ text: 'Account number',      font: bold }, { text: ': 7887808400',                font: reg  }],
    [{ text: 'Account Name: PP Inversiones S.A.',          font: bold }],
    [{ text: 'Reference: PP Inversiones S.A. – AGT 262',   font: bold }],
    [{ text: 'FFC: ',               font: bold }, { text: ppiAccount,                    font: bold }],
  ];

  for (const line of bankLines) {
    drawRunsLine(page, line, ML, y, FS);
    y -= LH;
  }

  y -= LH * 1.5; // gap antes del "Best regards,"
  page.drawText('Best regards,', { x: ML, y, size: FS, font: reg });

  return await doc.save();
}

// ══════════════════════════════════════════════
//  PDF BUILDER · TRF Pershing → Banco Internacional
//
//  Misma cabecera que la PPI (Pershing LLC izq + Date/Ref. Account der + saludo).
//  Difiere en el bloque de instrucciones bancarias:
//    Beneficiary bank · Intermediario · Ciudad · Swift Code · ABA ·
//    Beneficiary Acct No. · Reference (label y valor en negrita).
// ══════════════════════════════════════════════

async function buildTrfPshBancoPdf({
  fecha, pshAccount, monto,
  beneficiaryBank, intermediario, ciudad, swift, aba, beneficiaryAcct, reference,
}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();

  const reg  = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const FS = 11;
  const LH = 15;
  const ML = 70;
  const MR = 70;
  const MT = 50;

  const colGap = 30;
  const colW = (width - ML - MR - colGap) / 2;
  const leftX = ML;
  const rightX = ML + colW + colGap;

  let yTop = height - MT;

  // Columna izquierda: dirección Pershing.
  const addrLines = [
    'PERSHING LLC',
    '1st Pershing Plaza',
    'Jersey City, New Jersey',
    '07399 United States of America',
  ];
  let lyL = yTop;
  for (const line of addrLines) {
    page.drawText(line, { x: leftX, y: lyL, size: FS, font: reg });
    lyL -= LH;
  }

  // Columna derecha: Date + (gap) + Ref. Account, ambos right-aligned.
  let lyR = yTop;

  const dateLabel = 'Date: ';
  const dateValue = fmtFecha(fecha);
  const dLW = bold.widthOfTextAtSize(dateLabel, FS);
  const dVW = bold.widthOfTextAtSize(dateValue, FS);
  const dateX = rightX + colW - (dLW + dVW);
  page.drawText(dateLabel, { x: dateX, y: lyR, size: FS, font: bold });
  page.drawText(dateValue, { x: dateX + dLW, y: lyR, size: FS, font: bold });

  lyR -= 170;

  const refLabel = 'Ref. Account: ';
  const refValue = pshAccount;
  const rLW = reg.widthOfTextAtSize(refLabel, FS);
  const rVW = bold.widthOfTextAtSize(refValue, FS);
  const refX = rightX + colW - (rLW + rVW);
  page.drawText(refLabel, { x: refX, y: lyR, size: FS, font: reg });
  page.drawText(refValue, { x: refX + rLW, y: lyR, size: FS, font: bold });

  // Saludo + body.
  let y = Math.min(lyL, lyR) - 40;
  page.drawText('To whom it may concern,', { x: ML, y, size: FS, font: reg });
  y -= LH * 1.6;

  const bodyRuns = [
    { text: 'Please, transfer from my account ',                    font: reg  },
    { text: pshAccount,                                              font: bold },
    { text: ', the amount of USD ',                                  font: reg  },
    { text: fmtMonto(monto),                                         font: bold },
    { text: ' according to the following instructions:',             font: reg  },
  ];
  y = drawWrappedRuns(page, bodyRuns, ML, y, width - ML - MR, FS, LH);

  y -= LH;

  // Datos del banco — todas las líneas en negrita (label + valor).
  const bankLines = [
    [{ text: 'Beneficiary bank: ',     font: bold }, { text: beneficiaryBank, font: bold }],
    [{ text: 'Intermediario: ',        font: bold }, { text: intermediario,   font: bold }],
    [{ text: 'Ciudad: ',               font: bold }, { text: ciudad,          font: bold }],
    [{ text: 'Swift Code: ',           font: bold }, { text: swift,           font: bold }],
    [{ text: 'ABA: ',                  font: bold }, { text: aba,             font: bold }],
    [{ text: 'Beneficiary Acct No.: ', font: bold }, { text: beneficiaryAcct, font: bold }],
    [{ text: 'Reference: ',            font: bold }, { text: reference,       font: bold }],
  ];

  for (const line of bankLines) {
    drawRunsLine(page, line, ML, y, FS);
    y -= LH;
  }

  y -= LH * 1.5;
  page.drawText('Best regards,', { x: ML, y, size: FS, font: reg });

  return await doc.save();
}

// ── Dibuja una línea con runs sin word-wrap. Asume que entra. ──
function drawRunsLine(page, runs, x, y, size) {
  let cursor = x;
  for (const r of runs) {
    page.drawText(r.text, { x: cursor, y, size, font: r.font });
    cursor += r.font.widthOfTextAtSize(r.text, size);
  }
}

// ── Word-wrap aware de runs con fonts mixtos. Devuelve la nueva y al final. ──
//
// Tokenizamos cada run por palabras y espacios, vamos midiendo, y al exceder
// maxW en una palabra la mandamos a la siguiente línea (descartando el espacio
// que la precede para evitar sangrías raras al inicio de línea).
function drawWrappedRuns(page, runs, x, y, maxW, size, lineHeight) {
  // 1) Tokenizar.
  const tokens = []; // { text, font, isSpace }
  for (const r of runs) {
    const parts = r.text.split(/(\s+)/); // mantiene los whitespace runs
    for (const p of parts) {
      if (p === '') continue;
      tokens.push({ text: p, font: r.font, isSpace: /^\s+$/.test(p) });
    }
  }

  // 2) Acumular en líneas.
  const lines = [[]]; // cada línea = array de { text, font }
  let lineW = 0;
  for (const t of tokens) {
    const tw = t.font.widthOfTextAtSize(t.text, size);
    const cur = lines[lines.length - 1];
    if (lineW + tw > maxW && cur.length > 0) {
      // No entra: cerramos línea actual y arrancamos una nueva.
      // Si el token es whitespace, lo descartamos.
      if (!t.isSpace) {
        // Saco trailing whitespace de la línea cerrada por prolijidad.
        const last = cur[cur.length - 1];
        if (last && /\s+$/.test(last.text)) last.text = last.text.replace(/\s+$/, '');
        lines.push([{ text: t.text, font: t.font }]);
        lineW = tw;
      } else {
        lines.push([]);
        lineW = 0;
      }
    } else {
      // Entra: append al último segmento si comparte font, sino abre uno nuevo.
      if (cur.length > 0 && cur[cur.length - 1].font === t.font) {
        cur[cur.length - 1].text += t.text;
      } else {
        cur.push({ text: t.text, font: t.font });
      }
      lineW += tw;
    }
  }

  // 3) Dibujar.
  let cy = y;
  for (const line of lines) {
    if (line.length === 0) { cy -= lineHeight; continue; }
    drawRunsLine(page, line, x, cy, size);
    cy -= lineHeight;
  }
  return cy;
}

// ══════════════════════════════════════════════
//  CONFIG · Tipos de carta
// ══════════════════════════════════════════════

const CARTA_TYPES = [
  {
    id: 'trf-psh-ppi',
    label: 'Transferencia Pershing → PPI',
    description: 'Carta de orden de transferencia desde una cuenta Pershing hacia PP Inversiones S.A. (FFC).',
    icon: '⇄',
    templateUrl: '/templates/TRF_PSH_a_PPI.docx',
    fields: [
      {
        key: 'fecha',
        label: 'Fecha',
        type: 'date',
        required: true,
        defaultValue: () => todayIso(),
      },
      {
        key: 'pshAccount',
        label: 'Número de cuenta Pershing',
        type: 'text',
        required: true,
        placeholder: 'Ej: ABC-123456',
      },
      {
        key: 'monto',
        label: 'Monto a transferir (USD)',
        type: 'text',
        inputMode: 'decimal',
        required: true,
        placeholder: 'Ej: 100000,00',
        helper: 'Se renderiza en el PDF como "USD 100.000,00"',
      },
      {
        key: 'ppiAccount',
        label: 'Número y nombre de cuenta en PPI',
        type: 'text',
        required: true,
        placeholder: 'Ej: 12345 – PP Inversiones S.A.',
      },
    ],
    buildPDF: buildTrfPshPpiPdf,
    buildFilename: ({ pshAccount }) =>
      `Transferencia_PSH-PPI_${sanitizeForFilename(pshAccount) || 'sin-cuenta'}.pdf`,
  },
  {
    id: 'trf-psh-banco',
    label: 'Transferencia Pershing → Banco Internacional',
    description: 'Carta de orden de transferencia desde una cuenta Pershing hacia un banco internacional (con datos completos de SWIFT/ABA).',
    icon: '⇄',
    templateUrl: '/templates/TRF_PSH_a_Banco_Internacional.docx',
    fields: [
      { key: 'fecha',           label: 'Fecha',                     type: 'date', required: true, defaultValue: () => todayIso() },
      { key: 'pshAccount',      label: 'Número de cuenta Pershing', type: 'text', required: true, placeholder: 'Ej: ABC-123456' },
      { key: 'monto',           label: 'Monto a transferir (USD)',  type: 'text', inputMode: 'decimal', required: true,
        placeholder: 'Ej: 100000,00', helper: 'Se renderiza en el PDF como "USD 100.000,00"' },
      { key: 'beneficiaryBank', label: 'Beneficiary bank',          type: 'text', required: true, placeholder: 'Ej: Banco Itaú Uruguay S.A.' },
      { key: 'intermediario',   label: 'Intermediario',             type: 'text', required: true, placeholder: 'Ej: Citibank N.A.' },
      { key: 'ciudad',          label: 'Ciudad',                    type: 'text', required: true, placeholder: 'Ej: New York' },
      { key: 'swift',           label: 'Swift Code',                type: 'text', required: true, placeholder: 'Ej: CITIUS33' },
      { key: 'aba',             label: 'ABA',                       type: 'text', required: true, placeholder: 'Ej: 021 000 089' },
      { key: 'beneficiaryAcct', label: 'Beneficiary Acct No.',      type: 'text', required: true, placeholder: 'Ej: 001234567890' },
      { key: 'reference',       label: 'Reference',                 type: 'text', required: true,
        placeholder: 'Ej: Juan Perez – 9876543210', helper: 'Nombre y número de cuenta de destino' },
    ],
    buildPDF: buildTrfPshBancoPdf,
    buildFilename: ({ pshAccount }) =>
      `Transferencia_PSH-Banco_${sanitizeForFilename(pshAccount) || 'sin-cuenta'}.pdf`,
  },
];

// ══════════════════════════════════════════════
//  PAGE
// ══════════════════════════════════════════════

export default function CartasPage() {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [hover, setHover] = useState(false);

  return (
    <div style={S.pageWrap}>
      {/* Centro: botón principal sin contenedor padre */}
      <div style={S.centerPane}>
        <button
          style={S.bigAddBtn}
          onClick={() => setWizardOpen(true)}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          <span style={{
            ...S.bigAddPlus,
            transform: hover ? 'scale(1.05)' : 'scale(1)',
            boxShadow: hover ? 'var(--neon-glow), var(--neon-glow)' : 'var(--neon-glow)',
          }}>＋</span>
          <span style={S.bigAddLabel}>NUEVA CARTA</span>
        </button>
      </div>

      {/* Costado derecho: listado de plantillas (solo separador vertical, sin caja) */}
      <aside style={S.sidePane}>
        <ul style={S.tplList}>
          {CARTA_TYPES.map(t => (
            <li key={t.id} style={S.tplItem}>
              <span style={S.tplIcon}>{t.icon}</span>
              <span style={S.tplName}>{t.label}</span>
            </li>
          ))}
        </ul>
      </aside>

      {wizardOpen && (
        <NuevaCartaWizard
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
//  WIZARD
//  Paso 1: elegir tipo. Paso 2: completar datos. Submit: PDF + descarga.
// ══════════════════════════════════════════════

function NuevaCartaWizard({ onClose }) {
  const [stepIdx, setStepIdx] = useState(0); // 0: tipo, 1: datos
  const [typeId, setTypeId] = useState(null);
  const [form, setForm] = useState({});
  const [err, setErr] = useState('');
  const [generating, setGenerating] = useState(false);

  const type = CARTA_TYPES.find(t => t.id === typeId) || null;

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  // Al elegir tipo, inicializamos el form con los defaults de cada campo.
  const handleSelectType = (t) => {
    const init = {};
    for (const f of t.fields) {
      init[f.key] = typeof f.defaultValue === 'function' ? f.defaultValue() : (f.defaultValue ?? '');
    }
    setForm(init);
    setTypeId(t.id);
    setErr('');
    setStepIdx(1);
  };

  const goBack = () => {
    setErr('');
    if (stepIdx === 1) { setStepIdx(0); setTypeId(null); }
  };

  const handleGenerate = async () => {
    if (!type) return;
    // Validación: campos required no vacíos.
    for (const f of type.fields) {
      if (f.required && !String(form[f.key] || '').trim()) {
        setErr(`El campo "${f.label}" es obligatorio.`);
        return;
      }
    }
    setErr('');
    setGenerating(true);
    try {
      const bytes = await type.buildPDF(form);
      const filename = type.buildFilename(form);
      downloadBytes(bytes, filename);
      // Cierre instantáneo tras la descarga.
      onClose();
    } catch (e) {
      console.error(e);
      setErr('No se pudo generar el PDF: ' + (e?.message || e));
      setGenerating(false);
    }
  };

  const stepLabel = stepIdx === 0 ? 'TIPO DE CARTA' : type?.label?.toUpperCase() || 'DATOS';

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        <div style={S.modalHeader}>
          <span style={S.modalTitle}>NUEVA CARTA</span>
          <button style={S.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Stepper */}
        <div style={S.stepper}>
          {['TIPO', 'DATOS'].map((label, i) => {
            const done = i < stepIdx;
            const current = i === stepIdx;
            const dotStyle = {
              ...S.stepDot,
              ...(done ? S.stepDotDone : {}),
              ...(current ? S.stepDotCurrent : {}),
            };
            return (
              <div key={label} style={S.stepItem}>
                <div style={dotStyle}>{done ? '✓' : i + 1}</div>
                <div style={{ ...S.stepLabel, color: current ? 'var(--neon)' : 'var(--text-dim)' }}>
                  {label}
                </div>
                {i < 1 && (
                  <div style={{ ...S.stepLine, background: done ? 'var(--neon)' : 'var(--border)' }} />
                )}
              </div>
            );
          })}
        </div>

        <div style={S.modalBody}>
          <div style={S.stepHeader}>PASO {stepIdx + 1} DE 2 · {stepLabel}</div>

          {stepIdx === 0 && (
            <div style={S.typeList}>
              {CARTA_TYPES.map(t => (
                <button
                  key={t.id}
                  type="button"
                  style={S.typeCard}
                  onClick={() => handleSelectType(t)}
                >
                  <div style={S.typeCardIcon}>{t.icon}</div>
                  <div style={S.typeCardTextWrap}>
                    <div style={S.typeCardLabel}>{t.label}</div>
                    <div style={S.typeCardDesc}>{t.description}</div>
                  </div>
                  <div style={S.typeCardArrow}>›</div>
                </button>
              ))}
            </div>
          )}

          {stepIdx === 1 && type && (
            <div style={S.formGrid}>
              {type.fields.map(f => (
                <FieldRow
                  key={f.key}
                  field={f}
                  value={form[f.key] ?? ''}
                  onChange={v => setForm(p => ({ ...p, [f.key]: v }))}
                />
              ))}
            </div>
          )}

          {err && <div style={S.errBox}>{err}</div>}
        </div>

        <div style={S.modalFooter}>
          <button style={S.footerBtn} onClick={onClose}>CANCELAR</button>
          <div style={{ flex: 1 }} />
          {stepIdx === 1 && (
            <>
              <button style={S.footerBtn} onClick={goBack} disabled={generating}>
                ← ATRÁS
              </button>
              <button
                style={{ ...S.footerBtnPrimary, opacity: generating ? 0.6 : 1 }}
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating ? 'GENERANDO…' : 'GENERAR PDF'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
//  FIELD ROW — input genérico según tipo
// ══════════════════════════════════════════════
function FieldRow({ field, value, onChange }) {
  const inputProps = {
    style: S.wizInput,
    value,
    onChange: e => onChange(e.target.value),
    placeholder: field.placeholder,
    inputMode: field.inputMode,
    required: field.required,
  };
  return (
    <div style={S.wizField}>
      <label style={S.wizLabel}>
        {field.label}{field.required && <span style={{ color: '#ef4444', marginLeft: 4 }}>*</span>}
      </label>
      <input type={field.type || 'text'} {...inputProps} />
      {field.helper && <div style={S.wizHint}>{field.helper}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════
//  STYLES
// ══════════════════════════════════════════════
const S = {
  // ── Layout: centro + costado, sin caja en el botón ──
  pageWrap: {
    display: 'grid',
    gridTemplateColumns: '1fr 320px',
    gap: 0,
    alignItems: 'stretch',
    minHeight: 460,
    paddingTop: 56, // espacio amplio entre título de la sección y el contenido
  },
  centerPane: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: 460,
  },
  bigAddBtn: {
    // Sin border / background / contenedor — el botón es solamente
    // el "+" circular y la etiqueta debajo.
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
    background: 'transparent',
    border: 'none',
    color: 'var(--neon)',
    cursor: 'pointer',
    fontFamily: "'Roboto Mono',monospace",
    padding: 0,
  },
  bigAddPlus: {
    width: 132, height: 132,
    borderRadius: '50%',
    border: '1.5px solid var(--neon)',
    boxShadow: 'var(--neon-glow)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 64, lineHeight: 1, fontWeight: 200,
    transition: 'transform 0.18s ease, box-shadow 0.18s ease',
  },
  bigAddLabel: { fontSize: 13, fontWeight: 700, letterSpacing: 5 },

  sidePane: {
    paddingLeft: 32,
    borderLeft: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', justifyContent: 'center',
  },
  tplList: {
    listStyle: 'none', padding: 0, margin: 0,
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  tplItem: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 14px',
    fontFamily: "'Roboto Mono',monospace", fontSize: 11,
    color: 'var(--text)',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    transition: 'border-color 0.15s, background 0.15s',
  },
  tplIcon: { color: 'var(--neon)', fontSize: 16, width: 18, textAlign: 'center' },
  tplName: { letterSpacing: 1 },

  // ── Modal ──
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
    zIndex: 10000, display: 'flex', alignItems: 'flex-start',
    justifyContent: 'center', padding: '40px 20px', overflowY: 'auto',
    backdropFilter: 'blur(4px)',
  },
  modal: {
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 10, width: '100%', maxWidth: 720,
    fontFamily: "'Roboto',sans-serif",
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    display: 'flex', flexDirection: 'column',
  },
  modalHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px', borderBottom: '1px solid var(--border)',
  },
  modalTitle: {
    fontSize: 12, fontWeight: 700, letterSpacing: 3, color: 'var(--neon)',
    fontFamily: "'Roboto Mono',monospace",
  },
  closeBtn: {
    background: 'none', border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text-dim)', fontSize: 12, width: 28, height: 28,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },

  // ── Stepper ──
  stepper: {
    display: 'flex', alignItems: 'center', gap: 0,
    padding: '16px 20px', borderBottom: '1px solid var(--border)',
    background: 'var(--bg)',
  },
  stepItem: { display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 },
  stepDot: {
    width: 28, height: 28, borderRadius: '50%',
    border: '1px solid var(--border)',
    background: 'var(--bg-card)',
    color: 'var(--text-dim)',
    fontFamily: "'Roboto Mono',monospace", fontSize: 11, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, transition: 'all 0.2s',
  },
  stepDotCurrent: {
    borderColor: 'var(--neon)', color: 'var(--neon)',
    boxShadow: 'var(--neon-glow)',
  },
  stepDotDone: {
    borderColor: 'var(--neon)', background: 'var(--neon)', color: 'var(--bg)',
  },
  stepLabel: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 9, fontWeight: 700,
    letterSpacing: 1.5, marginLeft: 8, whiteSpace: 'nowrap',
  },
  stepLine: {
    flex: 1, height: 1, marginLeft: 12, marginRight: 12,
    transition: 'background 0.2s',
  },

  // ── Body ──
  modalBody: { padding: '20px 24px', minHeight: 220 },
  stepHeader: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 9, fontWeight: 700,
    letterSpacing: 2, color: 'var(--text-dim)', marginBottom: 16,
  },

  // ── Type selector ──
  typeList: { display: 'flex', flexDirection: 'column', gap: 10 },
  typeCard: {
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '14px 16px',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 6, cursor: 'pointer', textAlign: 'left',
    transition: 'border-color 0.15s, background 0.15s, transform 0.15s',
    fontFamily: 'inherit',
  },
  typeCardIcon: {
    fontSize: 24, color: 'var(--neon)', width: 32, textAlign: 'center',
    flexShrink: 0,
  },
  typeCardTextWrap: { flex: 1, minWidth: 0 },
  typeCardLabel: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 12, fontWeight: 700,
    letterSpacing: 1.5, color: 'var(--text)',
  },
  typeCardDesc: {
    fontFamily: "'Roboto',sans-serif", fontSize: 11, color: 'var(--text-dim)',
    marginTop: 4, lineHeight: 1.4,
  },
  typeCardArrow: {
    fontSize: 22, color: 'var(--text-dim)', flexShrink: 0,
  },

  // ── Form ──
  formGrid: { display: 'flex', flexDirection: 'column', gap: 14 },
  wizField: { display: 'flex', flexDirection: 'column', gap: 6 },
  wizLabel: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 9, fontWeight: 700,
    letterSpacing: 2, color: 'var(--text-dim)',
  },
  wizInput: {
    padding: '10px 12px', background: 'var(--input-bg)',
    border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text)', fontFamily: "'Roboto Mono',monospace", fontSize: 12,
    outline: 'none',
  },
  wizHint: {
    fontFamily: "'Roboto Mono',monospace", fontSize: 10,
    color: 'var(--text-dim)', letterSpacing: 0.5, marginTop: 2, opacity: 0.8,
  },

  errBox: {
    marginTop: 14, padding: '8px 12px',
    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 4, color: '#ef4444',
    fontFamily: "'Roboto Mono',monospace", fontSize: 11,
  },

  // ── Footer ──
  modalFooter: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '14px 20px', borderTop: '1px solid var(--border)',
    background: 'var(--bg)',
  },
  footerBtn: {
    background: 'none', border: '1px solid var(--border)', borderRadius: 3,
    color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace",
    fontSize: 10, fontWeight: 700, letterSpacing: 2, padding: '7px 14px',
    cursor: 'pointer',
  },
  footerBtnPrimary: {
    background: 'var(--neon)', border: '1px solid var(--neon)', borderRadius: 3,
    color: 'var(--bg)', fontFamily: "'Roboto Mono',monospace",
    fontSize: 10, fontWeight: 700, letterSpacing: 2, padding: '7px 14px',
    cursor: 'pointer',
    boxShadow: 'var(--neon-glow)',
  },
};

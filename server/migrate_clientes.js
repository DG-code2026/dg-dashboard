// One-shot: lee el xlsx de clientes, normaliza y carga a Supabase.
//
// Uso:
//   node server/migrate_clientes.js [ruta-al-xlsx]
//
// Default: "C:\\Users\\Florencia\\Downloads\\D&G - clientes - bdd.xlsx"
//
// Pre-requisito: correr `server/clientes_schema.sql` en Supabase SQL editor.
// Si la tabla ya tiene filas, las borra antes (re-corrible).

import 'dotenv/config';
import XLSX from 'xlsx';
import path from 'node:path';

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_KEY;
if (!SUPA_URL || !SUPA_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY in .env');
  process.exit(1);
}

const XLSX_PATH = process.argv[2] || 'C:\\Users\\Florencia\\Downloads\\D&G - clientes - bdd.xlsx';

// ─────────────────────────────────────────────────────────────
// Normalización de teléfono
//
// Reglas (en orden de prioridad):
//   1. Si viene más de un número separado por "/" o ";" → quedarse con el
//      primero.
//   2. Strip de todo lo que no sea dígito.
//   3. Si empieza con 54 (cód país) → quitarlo.
//   4. Si empieza con 0 (00 inválido, 0XX código de área con prefijo cero) →
//      quitar el 0 inicial. Esto resuelve "01147..." → "1147...".
//   5. Detectar código de área:
//        - 2-3 dígitos iniciales que matcheen códigos típicos AR (11, 220-299,
//          y triples como 223, 230, etc.) → splitear.
//        - Si arranca con 11 → CABA/AMBA (8 dígitos restantes).
//        - Si arranca con 15 → móvil local sin código → asumimos CABA y
//          producimos +54 11 15-XXXX-XXXX (mantenemos el 15 al frente como
//          la planilla original).
//        - Si tiene 10 dígitos y no arrancó con 11 → asumimos primeros 2 son
//          área.
//        - Si tiene 8 dígitos y nada de prefijo → CABA implícito.
//   6. Output: "+54 <area> <resto>" con espacios; el resto se queda sin
//      guión para no ser opinionado sobre el formato local.
//   7. Si no se puede parsear → null en `telefono` pero se guarda el raw.
// ─────────────────────────────────────────────────────────────

// Códigos de área conocidos AR (3 dígitos). Lista parcial — los más comunes.
const AREA_CODES_3 = new Set([
  '220', '221', '223', '230', '236', '237', '249', '260', '261', '263', '264', '266', '280', '291', '296', '297', '298', '299',
  '336', '341', '342', '343', '345', '348', '351', '353', '358', '362', '364', '370', '371', '376', '379', '381', '383', '385', '387', '388',
]);

function pickFirstPhone(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Split por '/', ';' o '|' y descartar vacíos
  const parts = s.split(/[\/;|]/).map(p => p.trim()).filter(Boolean);
  return parts[0] || null;
}

function normalizePhone(raw) {
  const first = pickFirstPhone(raw);
  if (!first) return null;
  let digits = first.replace(/\D/g, '');
  if (!digits) return null;

  // País
  if (digits.startsWith('54')) digits = digits.slice(2);
  // Prefijo "9" móvil internacional (formato +54 9 ...)
  if (digits.startsWith('9') && digits.length >= 11) digits = digits.slice(1);
  // Prefijo cero de marcación nacional
  while (digits.startsWith('0')) digits = digits.slice(1);
  if (!digits) return null;

  let area = '';
  let rest = digits;

  if (digits.startsWith('11') && digits.length >= 10) {
    area = '11'; rest = digits.slice(2);
  } else if (digits.startsWith('15')) {
    // móvil CABA con prefijo legacy "15"
    area = '11'; rest = digits;  // mantenemos el 15
  } else if (digits.length >= 3 && AREA_CODES_3.has(digits.slice(0, 3))) {
    area = digits.slice(0, 3); rest = digits.slice(3);
  } else if (digits.length === 10) {
    // Asumimos 2 primeros = área (mayormente CABA y GBA si entró sin prefijo)
    area = digits.slice(0, 2); rest = digits.slice(2);
  } else if (digits.length === 8) {
    // Landline CABA sin prefijo
    area = '11'; rest = digits;
  } else if (digits.length >= 7 && digits.length <= 12) {
    // No matchea nada conocido — guardamos sin código de área
    return `+54 ${digits}`;
  } else {
    return null;
  }
  return `+54 ${area} ${rest}`;
}

// ─────────────────────────────────────────────────────────────
// Lectura del xlsx
// ─────────────────────────────────────────────────────────────
function excelDateToISO(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // SheetJS con `cellDates: true` ya devuelve Date; este path es defensivo.
  if (typeof v === 'number') {
    // Serial de Excel (1 = 1900-01-01 con bug). SheetJS expone helper.
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${String(d.y).padStart(4,'0')}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  return isNaN(parsed) ? null : parsed.toISOString().slice(0, 10);
}

function normalizeTipoCuenta(v) {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  if (s === 'PF' || s === 'PJ') return s;
  return null;
}

function normalizeText(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function readClientes() {
  console.log(`Leyendo ${XLSX_PATH} ...`);
  const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  console.log(`  ${rows.length} filas`);

  // Detectar nombres de columnas (header puede variar por encoding)
  const sample = rows[0] || {};
  const keys = Object.keys(sample);
  const find = (re) => keys.find(k => re.test(k));
  const C = {
    broker:      find(/^BROKER$/i),
    comitente:   find(/^Comitente/i),
    nombre:      find(/^Denomin/i),
    asesor:      find(/^Asesor$/i),
    email:       find(/^E.?Mail$/i),
    telefono:    find(/^Tel/i),
    fechaNac:    find(/^Fecha/i),
    tipoCuenta:  find(/^Tipo/i),
  };
  console.log('  cols mapeadas:', C);

  // Fix encoding mojibake en valores ("GAVI�A" → "GAVIÑA")
  const fixMojibake = (s) => s == null ? s : String(s)
    .replace(/GAVI�A/g, 'GAVIÑA')
    .replace(/GAVI\?A/g, 'GAVIÑA');

  return rows.map(r => {
    const rawTel = normalizeText(r[C.telefono]);
    return {
      nombre:           normalizeText(r[C.nombre]),
      email:            normalizeText(r[C.email]),
      comitente:        r[C.comitente] != null ? String(r[C.comitente]).trim() : null,
      broker:           normalizeText(r[C.broker]),
      telefono:         normalizePhone(rawTel),
      telefono_raw:     rawTel,
      tipo_cuenta:      normalizeTipoCuenta(r[C.tipoCuenta]),
      fecha_nacimiento: excelDateToISO(r[C.fechaNac]),
      asesor:           fixMojibake(normalizeText(r[C.asesor])),
    };
  }).filter(r => r.nombre);
}

// ─────────────────────────────────────────────────────────────
// Supabase REST
// ─────────────────────────────────────────────────────────────
async function supa(path, opts = {}) {
  const r = await fetch(`${SUPA_URL}/rest/v1${path}`, {
    method: opts.method || 'GET',
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': opts.prefer || 'return=representation',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Supabase ${r.status}: ${t}`);
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : null;
}

async function main() {
  const data = readClientes();
  console.log(`\nMuestra normalizada (primeras 3 filas):`);
  console.log(JSON.stringify(data.slice(0, 3), null, 2));

  // Stats teléfono
  const okPhones = data.filter(r => r.telefono).length;
  console.log(`\nTeléfonos normalizados ok: ${okPhones}/${data.length}`);
  const sinTel = data.filter(r => !r.telefono && r.telefono_raw);
  if (sinTel.length) {
    console.log(`  no se pudieron parsear ${sinTel.length} (ejemplos):`);
    sinTel.slice(0, 5).forEach(r => console.log(`    raw=${JSON.stringify(r.telefono_raw)}`));
  }

  // Cuántas filas ya hay
  console.log('\nChequeando tabla clientes...');
  const existing = await supa('/clientes?select=id&limit=1');
  if (Array.isArray(existing) && existing.length > 0) {
    console.log('  La tabla ya tiene datos. Borrando todo antes de re-importar...');
    await supa('/clientes?id=gt.0', { method: 'DELETE', prefer: 'return=minimal' });
  }

  // Bulk insert en chunks (Supabase REST acepta hasta ~1k filas, vamos de 200)
  const CHUNK = 200;
  let inserted = 0;
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK);
    await supa('/clientes', { method: 'POST', body: chunk, prefer: 'return=minimal' });
    inserted += chunk.length;
    console.log(`  ${inserted}/${data.length} insertados`);
  }
  console.log(`\n✔ Done. ${inserted} clientes en Supabase.`);
}

main().catch(e => {
  console.error('\n✖ Error:', e.message);
  process.exit(1);
});

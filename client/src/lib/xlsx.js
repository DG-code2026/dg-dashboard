// ─────────────────────────────────────────────────────────────────────────────
//  XLSX reader — sin dependencias externas.
//
//  XLSX = ZIP que contiene XMLs. Adentro nos interesan:
//    - xl/sharedStrings.xml : tabla de strings reutilizables
//    - xl/worksheets/sheet1.xml : el primer worksheet
//
//  Implementamos:
//    1) Un parser de ZIP suficiente para leer entradas DEFLATE (método 8) y
//       STORED (método 0). Usa DecompressionStream('deflate-raw') del browser.
//    2) Lectura del XML con DOMParser nativo.
//
//  Objetivo: devolver una grilla string[][] equivalente a un parseo CSV,
//  con el mismo shape que el parser CSV (headers en row[0], data en row[1+]).
// ─────────────────────────────────────────────────────────────────────────────

// Detecta XLSX por magic bytes ZIP "PK\x03\x04".
export function looksLikeXlsx(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < 4) return false;
  const v = new DataView(arrayBuffer);
  return v.getUint8(0) === 0x50 && v.getUint8(1) === 0x4B
      && v.getUint8(2) === 0x03 && v.getUint8(3) === 0x04;
}

// ── ZIP parsing ──
// Buscamos el End-of-Central-Directory (signature 0x06054b50) desde el final.
async function readZipEntries(arrayBuffer) {
  const buf = arrayBuffer;
  const view = new DataView(buf);
  const total = buf.byteLength;
  const EOCD_SIG = 0x06054b50;
  const CD_SIG   = 0x02014b50;

  let eocdOff = -1;
  // EOCD puede tener un comment de hasta 65535 bytes; arrancamos desde el final.
  const minScan = Math.max(0, total - 65557);
  for (let i = total - 22; i >= minScan; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) { eocdOff = i; break; }
  }
  if (eocdOff < 0) throw new Error('No se encontró el End-of-Central-Directory (¿archivo corrupto?).');

  const cdEntries = view.getUint16(eocdOff + 10, true);
  const cdOffset  = view.getUint32(eocdOff + 16, true);

  const decoder = new TextDecoder('utf-8');
  const entries = [];
  let off = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (view.getUint32(off, true) !== CD_SIG) {
      throw new Error(`Central Directory inválido en entry ${i}.`);
    }
    const compMethod = view.getUint16(off + 10, true);
    const compSize   = view.getUint32(off + 20, true);
    const nameLen    = view.getUint16(off + 28, true);
    const extraLen   = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localOff   = view.getUint32(off + 42, true);
    const name = decoder.decode(new Uint8Array(buf, off + 46, nameLen));
    entries.push({ name, compMethod, compSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return { buf, view, entries };
}

async function inflateEntry({ buf, view }, entry) {
  // Local File Header — el extraLen aquí puede diferir del de la CD.
  const localOff = entry.localOff;
  const lNameLen  = view.getUint16(localOff + 26, true);
  const lExtraLen = view.getUint16(localOff + 28, true);
  const dataOff   = localOff + 30 + lNameLen + lExtraLen;
  const dataBytes = new Uint8Array(buf, dataOff, entry.compSize);

  if (entry.compMethod === 0) return dataBytes; // STORED
  if (entry.compMethod === 8) {
    // DEFLATE puro (sin headers ZLIB) → 'deflate-raw'
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([dataBytes]).stream().pipeThrough(ds);
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    return out;
  }
  throw new Error(`Método de compresión ${entry.compMethod} no soportado.`);
}

async function readZipAsTextFiles(arrayBuffer, names) {
  const zip = await readZipEntries(arrayBuffer);
  const dec = new TextDecoder('utf-8');
  const out = {};
  for (const name of names) {
    const e = zip.entries.find(x => x.name === name);
    if (!e) continue;
    const bytes = await inflateEntry(zip, e);
    out[name] = dec.decode(bytes);
  }
  return out;
}

// Lista todos los sheet*.xml disponibles (por si el archivo no tiene 'sheet1.xml')
async function listSheetFiles(arrayBuffer) {
  const zip = await readZipEntries(arrayBuffer);
  return zip.entries
    .filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .map(e => e.name)
    .sort();
}

// ── XML helpers ──
function parseSharedStrings(xml) {
  if (!xml) return [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return [];
  const sis = doc.getElementsByTagName('si');
  const arr = new Array(sis.length);
  for (let i = 0; i < sis.length; i++) {
    // <si> puede ser <t>text</t> directo, o varios <r><t>…</t></r> (rich text)
    const ts = sis[i].getElementsByTagName('t');
    let s = '';
    for (let j = 0; j < ts.length; j++) s += ts[j].textContent || '';
    arr[i] = s;
  }
  return arr;
}

function colLettersToIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

function parseSheet(xml, sst) {
  if (!xml) return [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('XML del worksheet inválido.');
  }
  const rows = doc.getElementsByTagName('row');
  const grid = [];
  for (let i = 0; i < rows.length; i++) {
    const rEl = rows[i];
    // Si la row trae atributo "r" (1-based row index), respetamos huecos.
    const rowIdxAttr = rEl.getAttribute('r');
    const rowIdx = rowIdxAttr ? parseInt(rowIdxAttr, 10) - 1 : grid.length;

    const cells = rEl.getElementsByTagName('c');
    const rowArr = [];
    for (let j = 0; j < cells.length; j++) {
      const c = cells[j];
      const ref = c.getAttribute('r') || ''; // ej. "B7"
      const colLetters = ref.replace(/\d+/g, '');
      const colIdx = colLetters ? colLettersToIndex(colLetters) : j;
      const t = c.getAttribute('t');
      const vEl = c.getElementsByTagName('v')[0];
      const isEl = c.getElementsByTagName('is')[0];
      let val = '';
      if (t === 's') {
        const idx = parseInt(vEl?.textContent || '-1', 10);
        val = (idx >= 0 && idx < sst.length) ? sst[idx] : '';
      } else if (t === 'inlineStr' && isEl) {
        const ts = isEl.getElementsByTagName('t');
        let s = '';
        for (let k = 0; k < ts.length; k++) s += ts[k].textContent || '';
        val = s;
      } else if (t === 'b') {
        val = vEl?.textContent === '1' ? 'TRUE' : 'FALSE';
      } else {
        // 'n', null, 'str' → valor crudo
        val = vEl?.textContent || '';
      }
      rowArr[colIdx] = val;
    }
    // Rellenar huecos con string vacío
    for (let j = 0; j < rowArr.length; j++) if (rowArr[j] === undefined) rowArr[j] = '';
    grid[rowIdx] = rowArr;
  }
  // Compactar nulls intermedios
  return grid.map(r => r || []);
}

// ── API pública ──
export async function readXlsxToGrid(arrayBuffer) {
  const sheetNames = await listSheetFiles(arrayBuffer);
  if (sheetNames.length === 0) {
    throw new Error('El archivo XLSX no tiene worksheets.');
  }
  const targetSheet = sheetNames[0]; // primer sheet
  const files = await readZipAsTextFiles(arrayBuffer, [
    'xl/sharedStrings.xml',
    targetSheet,
  ]);
  const sst   = parseSharedStrings(files['xl/sharedStrings.xml'] || '');
  const grid  = parseSheet(files[targetSheet], sst);
  // Filtrar filas vacías (todas las celdas blancas/whitespace)
  return grid.filter(r => r.some(c => String(c).trim() !== ''));
}

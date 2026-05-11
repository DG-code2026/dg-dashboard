// Dry-run del parser de migrate_clientes — sólo lee, no toca Supabase.
import XLSX from 'xlsx';

const XLSX_PATH = process.argv[2] || 'C:\\Users\\Florencia\\Downloads\\D&G - clientes - bdd.xlsx';

const AREA_CODES_3 = new Set([
  '220','221','223','230','236','237','249','260','261','263','264','266','280','291','296','297','298','299',
  '336','341','342','343','345','348','351','353','358','362','364','370','371','376','379','381','383','385','387','388',
]);

function pickFirstPhone(raw) {
  if (!raw) return null;
  const parts = String(raw).split(/[\/;|]/).map(p => p.trim()).filter(Boolean);
  return parts[0] || null;
}

function normalizePhone(raw) {
  const first = pickFirstPhone(raw);
  if (!first) return null;
  let digits = first.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('54')) digits = digits.slice(2);
  while (digits.startsWith('0')) digits = digits.slice(1);
  if (!digits) return null;
  let area = '', rest = digits;
  if (digits.startsWith('11') && digits.length >= 10) { area='11'; rest=digits.slice(2); }
  else if (digits.startsWith('15')) { area='11'; rest=digits; }
  else if (digits.length >= 3 && AREA_CODES_3.has(digits.slice(0,3))) { area=digits.slice(0,3); rest=digits.slice(3); }
  else if (digits.length === 10) { area=digits.slice(0,2); rest=digits.slice(2); }
  else if (digits.length === 8) { area='11'; rest=digits; }
  else if (digits.length >= 7 && digits.length <= 12) return `+54 ${digits}`;
  else return null;
  return `+54 ${area} ${rest}`;
}

const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
const telCol = Object.keys(rows[0]).find(k => /^Tel/i.test(k));
console.log('total rows:', rows.length);
console.log('telefono column:', telCol);
let ok=0, fail=0;
const failed = [];
const samples = [];
rows.forEach((r, i) => {
  const raw = r[telCol];
  const n = normalizePhone(raw);
  if (raw && !n) { fail++; failed.push(raw); }
  else if (n) ok++;
  if (i < 15) samples.push({ raw, normalized: n });
});
console.log('\nMuestras:');
samples.forEach(s => console.log(`  ${JSON.stringify(s.raw).padEnd(40)} → ${s.normalized}`));
console.log(`\nNormalizados ok: ${ok}`);
console.log(`Fallidos: ${fail}`);
if (failed.length) {
  console.log('Ejemplos fallidos:');
  failed.slice(0, 10).forEach(f => console.log(`  ${JSON.stringify(f)}`));
}

// Asesores y broker
const aCol = Object.keys(rows[0]).find(k => /^Asesor/i.test(k));
const bCol = Object.keys(rows[0]).find(k => /^BROKER/i.test(k));
const asesores = new Set(rows.map(r => r[aCol]).filter(Boolean));
const brokers = new Set(rows.map(r => r[bCol]).filter(Boolean));
console.log('\nAsesores únicos:', [...asesores]);
console.log('Brokers únicos:', [...brokers]);

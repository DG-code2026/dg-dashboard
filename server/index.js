import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import cron from 'node-cron';
import Parser from 'rss-parser';
import { httpJson, singleflight, HttpError } from './lib/http.js';
import {
  ymdEnAR, sumarDias, lunesDeLaSemana, fmtFechaLarga,
  construirICS, construirHtml, enviarMail, mailConfigurado,
} from './lib/agenda-mail.js';

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;
const PRIMARY_REST_URL = process.env.PRIMARY_REST_URL;
const PRIMARY_WS_URL = process.env.PRIMARY_WS_URL;
const PRIMARY_USER = process.env.PRIMARY_USER;
const PRIMARY_PASS = process.env.PRIMARY_PASS;

// ══════════════════════════════════════════════
//  SUPABASE
// ══════════════════════════════════════════════
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_KEY;
// SERVICE_KEY (opcional pero recomendada): bypassa RLS. Sin ella, el server
// usa el anon key — funciona si las tablas no tienen RLS, pero ahora que
// hay RLS habilitado todas las queries fallarían. Si no está, fallback a
// anon con un log de warning para que se note.
const SUPA_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPA_EFFECTIVE_KEY = SUPA_SERVICE_KEY || SUPA_KEY;
if (!SUPA_SERVICE_KEY) {
  console.warn('⚠️  SUPABASE_SERVICE_KEY no seteada — usando anon key. Con RLS habilitado, los inserts/updates fallarán. Setear SUPABASE_SERVICE_KEY en .env de Render.');
}

async function supa(path, opts = {}) {
  // Timeout duro de 8s para que Supabase no cuelgue requests del cliente.
  // Reintento implícito una vez en errores 5xx / network / timeout.
  const { status, data } = await httpJson(`${SUPA_URL}/rest/v1${path}`, {
    method: opts.method || 'GET',
    headers: {
      'apikey': SUPA_EFFECTIVE_KEY,
      'Authorization': `Bearer ${SUPA_EFFECTIVE_KEY}`,
      'Prefer': opts.prefer || 'return=representation',
    },
    body: opts.body,
    timeoutMs: 8000,
    retries: 1,
  });
  // httpJson sólo lanza para 5xx — PostgREST devuelve 4xx con body { code,
  // message, ... } que silenciosamente se nos colaba como "data válida".
  // Lo elevamos a excepción para que los handlers de arriba puedan reaccionar.
  if (status >= 400) {
    const msg = (data && (data.message || data.error)) || `Supabase HTTP ${status}`;
    const err = new Error(msg);
    err.status = status;
    err.body = data;
    throw err;
  }
  return data;
}

// ── Generic CRUD factory for favorites/soberanos tables ──
function createCrudRoutes(tableName, routePrefix) {
  app.get(`/api/db/${routePrefix}`, async (req, res) => {
    try { const data = await supa(`/${tableName}?activo=eq.true&order=ticker`); res.json(Array.isArray(data) ? data : []); }
    catch (e) { console.error(`DB GET ${tableName}:`, e); res.json([]); }
  });

  app.post(`/api/db/${routePrefix}`, async (req, res) => {
    try {
      const { ticker, empresa, ley } = req.body;
      if (!ticker) return res.status(400).json({ error: 'ticker required' });
      const existing = await supa(`/${tableName}?ticker=eq.${ticker}`);
      if (Array.isArray(existing) && existing.length > 0) {
        return res.json(await supa(`/${tableName}?ticker=eq.${ticker}`, { method: 'PATCH', body: { activo: true, empresa: empresa || existing[0].empresa, updated_at: new Date().toISOString() } }));
      }
      res.json(await supa(`/${tableName}`, { method: 'POST', body: { ticker, empresa: empresa || ticker, ley: ley || '', activo: true } }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete(`/api/db/${routePrefix}/:ticker`, async (req, res) => {
    try { res.json(await supa(`/${tableName}?ticker=eq.${req.params.ticker}`, { method: 'PATCH', body: { activo: false, updated_at: new Date().toISOString() } })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.patch(`/api/db/${routePrefix}/:ticker/law`, async (req, res) => {
    try { res.json(await supa(`/${tableName}?ticker=eq.${req.params.ticker}`, { method: 'PATCH', body: { ley: req.body.ley, updated_at: new Date().toISOString() } })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
}

createCrudRoutes('favorites', 'favorites');
createCrudRoutes('soberanos', 'soberanos');
createCrudRoutes('subsoberanos', 'subsoberanos');

// ── Settings CRUD ──
app.get('/api/db/settings', async (req, res) => {
  try { const data = await supa('/settings'); const obj = {}; if (Array.isArray(data)) data.forEach(s => { obj[s.key] = s.value; }); res.json(obj); }
  catch (e) { res.json({}); }
});

app.put('/api/db/settings/:key', async (req, res) => {
  try {
    const { value } = req.body;
    const existing = await supa(`/settings?key=eq.${req.params.key}`);
    if (Array.isArray(existing) && existing.length > 0) return res.json(await supa(`/settings?key=eq.${req.params.key}`, { method: 'PATCH', body: { value, updated_at: new Date().toISOString() } }));
    res.json(await supa('/settings', { method: 'POST', body: { key: req.params.key, value } }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════
//  CARTERAS CRUD
// ══════════════════════════════════════════════

// List all carteras
app.get('/api/db/carteras', async (req, res) => {
  try {
    const data = await supa('/carteras?order=nombre');
    res.json(Array.isArray(data) ? data : []);
  } catch (e) { res.json([]); }
});

// Get single cartera with items
app.get('/api/db/carteras/:id', async (req, res) => {
  try {
    const [cartera, items] = await Promise.all([
      supa(`/carteras?id=eq.${req.params.id}`),
      supa(`/cartera_items?cartera_id=eq.${req.params.id}&order=ticker`),
    ]);
    const c = Array.isArray(cartera) ? cartera[0] : null;
    if (!c) return res.status(404).json({ error: 'not found' });
    c.items = Array.isArray(items) ? items : [];
    res.json(c);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create cartera
// Sólo mandamos a Supabase las columnas que vienen en el body — si la tabla
// no tiene `descripcion` (u otra columna opcional), no forzamos el insert.
app.post('/api/db/carteras', async (req, res) => {
  try {
    const { nombre, descripcion } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre required' });
    const body = { nombre };
    if (descripcion != null && descripcion !== '') body.descripcion = descripcion;
    const r = await supa('/carteras', { method: 'POST', body });
    // Si Supabase devolvió string (error en texto plano) o un objeto con `message`/`code`,
    // lo surfaceamos para que el cliente pueda mostrarlo.
    if (typeof r === 'string') return res.status(500).json({ error: r });
    if (r && !Array.isArray(r) && (r.message || r.code)) return res.status(500).json({ error: r.message || r.code, detail: r });
    res.json(Array.isArray(r) ? r[0] : r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete cartera (cascade deletes items)
app.delete('/api/db/carteras/:id', async (req, res) => {
  try {
    await supa(`/carteras?id=eq.${req.params.id}`, { method: 'DELETE' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rename cartera
app.patch('/api/db/carteras/:id', async (req, res) => {
  try {
    const r = await supa(`/carteras?id=eq.${req.params.id}`, { method: 'PATCH', body: { ...req.body, updated_at: new Date().toISOString() } });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Add item to cartera
app.post('/api/db/carteras/:id/items', async (req, res) => {
  try {
    const { ticker, tipo, settlement, vn, precio_compra, lamina_minima } = req.body;
    if (!ticker || !precio_compra) return res.status(400).json({ error: 'ticker and precio_compra required' });
    const r = await supa('/cartera_items', { method: 'POST', body: {
      cartera_id: parseInt(req.params.id), ticker, tipo: tipo || 'ON',
      settlement: settlement || 'A-24HS', vn: vn || 1,
      precio_compra, lamina_minima: lamina_minima || '1',
    }});
    // Update cartera timestamp
    await supa(`/carteras?id=eq.${req.params.id}`, { method: 'PATCH', body: { updated_at: new Date().toISOString() } });
    res.json(Array.isArray(r) ? r[0] : r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Remove item from cartera
app.delete('/api/db/cartera-items/:itemId', async (req, res) => {
  try {
    await supa(`/cartera_items?id=eq.${req.params.itemId}`, { method: 'DELETE' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update item VN
app.patch('/api/db/cartera-items/:itemId', async (req, res) => {
  try {
    const r = await supa(`/cartera_items?id=eq.${req.params.itemId}`, { method: 'PATCH', body: req.body });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════
//  TRADES (trade tracking)
// ══════════════════════════════════════════════
app.get('/api/db/trades', async (req, res) => {
  try { const data = await supa('/trades?order=created_at.desc'); res.json(Array.isArray(data) ? data : []); }
  catch (e) { res.json([]); }
});

// Si Supabase rechaza por columna inexistente (PostgREST 42703), reintentamos
// sin esa columna. Permite operar contra tablas que aún no migraron `market_fee`.
async function supaInsertTolerant(tableUrl, row) {
  try {
    return await supa(tableUrl, { method: 'POST', body: row });
  } catch (e) {
    const msg = String(e?.message || '');
    const m = msg.match(/column "?(\w+)"? of relation|Could not find the '(\w+)' column/i);
    const missing = m?.[1] || m?.[2];
    if (missing && missing in row) {
      const { [missing]: _drop, ...rest } = row;
      console.warn(`[supaInsertTolerant] columna '${missing}' no existe en la tabla, reintento sin ella`);
      return supa(tableUrl, { method: 'POST', body: rest });
    }
    throw e;
  }
}

async function supaPatchTolerant(tableUrl, row) {
  try {
    return await supa(tableUrl, { method: 'PATCH', body: row });
  } catch (e) {
    const msg = String(e?.message || '');
    const m = msg.match(/column "?(\w+)"? of relation|Could not find the '(\w+)' column/i);
    const missing = m?.[1] || m?.[2];
    if (missing && missing in row) {
      const { [missing]: _drop, ...rest } = row;
      console.warn(`[supaPatchTolerant] columna '${missing}' no existe, reintento sin ella`);
      return supa(tableUrl, { method: 'PATCH', body: rest });
    }
    throw e;
  }
}

app.post('/api/db/trades', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.ticker) return res.status(400).json({ error: 'ticker required' });
    const row = {
      tag: body.tag || '',
      client_name: body.client_name || '',
      client_account: body.client_account || '',
      broker: body.broker || 'PPI',
      trade_date: body.trade_date || new Date().toISOString().slice(0, 10),
      ticker: String(body.ticker).toUpperCase(),
      settlement: body.settlement || 'A-24HS',
      price: body.price != null ? Number(body.price) : null,
      quantity: body.quantity != null ? Number(body.quantity) : 100,
      target_type: body.target_type || 'price',
      target_value: body.target_value != null ? Number(body.target_value) : null,
      stop_loss: body.stop_loss != null ? Number(body.stop_loss) : null,
      commission: body.commission != null ? Number(body.commission) : 0,
      market_fee: body.market_fee != null ? Number(body.market_fee) : 0.01,
      notes: body.notes || '',
    };
    const r = await supaInsertTolerant('/trades', row);
    res.json(Array.isArray(r) ? r[0] : r);
  } catch (e) {
    console.error('POST /api/db/trades:', e);
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/db/trades/:id', async (req, res) => {
  try {
    const r = await supaPatchTolerant(`/trades?id=eq.${req.params.id}`, { ...req.body, updated_at: new Date().toISOString() });
    res.json(Array.isArray(r) ? r[0] : r);
  } catch (e) {
    console.error('PATCH /api/db/trades:', e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/db/trades/:id', async (req, res) => {
  try { await supa(`/trades?id=eq.${req.params.id}`, { method: 'DELETE' }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════
//  PROPUESTAS DE INVERSIÓN
// ══════════════════════════════════════════════
app.get('/api/db/propuestas', async (req, res) => {
  try { const data = await supa('/propuestas?order=created_at.desc'); res.json(Array.isArray(data) ? data : []); }
  catch (e) { res.json([]); }
});

// Detecta si la respuesta de Supabase es un error de PostgREST. Si la tabla
// no tiene una columna mandada (PGRST204), reintentamos sin esas columnas;
// esto evita que la UI quede "guardando ok" mientras el INSERT falla en silencio.
const OPTIONAL_PROPUESTA_COLS = ['override_count_enabled', 'override_count_label', 'override_count_value', 'perfil', 'notes'];

// PGRST204 / 42703 = columna inexistente. supa() los eleva como Error con
// err.body conteniendo el {code, message} de PostgREST, así que chequeamos
// tanto el throw como la respuesta directa para ser robustos frente a cambios
// futuros del helper.
function isPgrstSchemaError(e) {
  const code = e && (e.code || e.body?.code);
  return code === 'PGRST204' || code === '42703';
}

function stripUnknownCol(obj, errMsg) {
  // El mensaje de PGRST204 es: "Could not find the 'foo' column of 'bar' in the schema cache"
  const m = /'([^']+)' column/.exec(errMsg || '');
  if (m && obj && Object.prototype.hasOwnProperty.call(obj, m[1])) {
    const { [m[1]]: _drop, ...rest } = obj;
    return { stripped: m[1], obj: rest };
  }
  return null;
}

// Estrategia de retry: supa() lanza en 4xx, así que envolvemos cada intento en
// try/catch. Si el error es de columna desconocida, la sacamos del payload y
// reintentamos — hasta agotar las columnas mandadas (cota: una vuelta por
// columna del body, +1 de seguridad).
async function supaInsertPropuesta(row) {
  let cur = { ...row };
  const maxAttempts = Object.keys(cur).length + 1;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await supa('/propuestas', { method: 'POST', body: cur });
      if (Array.isArray(r)) return { ok: true, data: r[0] };
      return { ok: false, err: r };
    } catch (e) {
      if (isPgrstSchemaError(e)) {
        const s = stripUnknownCol(cur, e.message);
        if (s) {
          console.warn(`[propuestas] columna inexistente "${s.stripped}" — descartada del INSERT`);
          cur = s.obj;
          continue;
        }
      }
      return { ok: false, err: { message: e.message, code: e.body?.code, body: e.body } };
    }
  }
  return { ok: false, err: { message: 'too many schema retries' } };
}

async function supaPatchPropuesta(id, body) {
  let cur = { ...body };
  const maxAttempts = Object.keys(cur).length + 1;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await supa(`/propuestas?id=eq.${id}`, { method: 'PATCH', body: cur });
      if (Array.isArray(r)) return { ok: true, data: r[0] };
      return { ok: false, err: r };
    } catch (e) {
      if (isPgrstSchemaError(e)) {
        const s = stripUnknownCol(cur, e.message);
        if (s) {
          console.warn(`[propuestas] columna inexistente "${s.stripped}" — descartada del PATCH`);
          cur = s.obj;
          continue;
        }
      }
      return { ok: false, err: { message: e.message, code: e.body?.code, body: e.body } };
    }
  }
  return { ok: false, err: { message: 'too many schema retries' } };
}

app.post('/api/db/propuestas', async (req, res) => {
  try {
    const body = req.body || {};
    const row = {
      client_name: body.client_name || '',
      client_account: body.client_account || '',
      broker: body.broker || '',
      asesor: body.asesor || '',
      plazo: body.plazo || 'MEDIANO',
      perfil: body.perfil || 'MODERADO',
      amount_total: body.amount_total != null ? Number(body.amount_total) : null,
      currency: body.currency || 'ARS',
      items: Array.isArray(body.items) ? body.items : [],
      notes: body.notes || '',
    };
    // Overrides de display opcionales. Si Supabase no tiene la columna, supaInsertPropuesta
    // las strippea automáticamente y reintenta — la UI sigue funcionando aunque la migración
    // no esté corrida (la persistencia se añade cuando se sume la columna).
    if (body.override_count_enabled != null) row.override_count_enabled = !!body.override_count_enabled;
    if (body.override_count_label != null) row.override_count_label = body.override_count_label;
    if (body.override_count_value != null) row.override_count_value = body.override_count_value;
    const r = await supaInsertPropuesta(row);
    if (!r.ok) {
      console.error('POST propuesta failed:', r.err);
      return res.status(500).json({ error: r.err?.message || 'unknown', detail: r.err });
    }
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/db/propuestas/:id', async (req, res) => {
  try {
    const r = await supaPatchPropuesta(req.params.id, { ...req.body, updated_at: new Date().toISOString() });
    if (!r.ok) {
      console.error('PATCH propuesta failed:', r.err);
      return res.status(500).json({ error: r.err?.message || 'unknown', detail: r.err });
    }
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/db/propuestas/:id', async (req, res) => {
  try { await supa(`/propuestas?id=eq.${req.params.id}`, { method: 'DELETE' }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════
//  FONDOS PERSHING — listado compartido (todos los usuarios ven lo mismo)
//  PK = isin. Validación mínima en el servidor; el cliente ya valida formato.
// ══════════════════════════════════════════════
app.get('/api/db/fondos-pershing', async (req, res) => {
  try {
    const data = await supa('/fondos_pershing?order=casa.asc,nombre.asc');
    res.json(Array.isArray(data) ? data : []);
  } catch (e) { res.json([]); }
});

app.post('/api/db/fondos-pershing', async (req, res) => {
  try {
    const body = req.body || {};
    const isin = String(body.isin || '').trim().toUpperCase();
    const casa = String(body.casa || '').trim();
    const nombre = String(body.nombre || '').trim();
    if (!isin || !casa || !nombre) return res.status(400).json({ error: 'isin, casa y nombre son obligatorios' });
    if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return res.status(400).json({ error: 'formato de ISIN inválido' });
    // Upsert idempotente: si el ISIN ya existe, falla con 409 para que el cliente muestre un mensaje claro.
    const existing = await supa(`/fondos_pershing?isin=eq.${encodeURIComponent(isin)}`);
    if (Array.isArray(existing) && existing.length > 0) return res.status(409).json({ error: `ya existe un fondo con ISIN ${isin}` });
    const r = await supa('/fondos_pershing', { method: 'POST', body: { isin, casa, nombre } });
    res.json(Array.isArray(r) ? r[0] : r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/db/fondos-pershing/:isin', async (req, res) => {
  try {
    const isin = String(req.params.isin || '').toUpperCase();
    const patch = { updated_at: new Date().toISOString() };
    if (req.body?.casa != null) patch.casa = String(req.body.casa).trim();
    if (req.body?.nombre != null) patch.nombre = String(req.body.nombre).trim();
    const r = await supa(`/fondos_pershing?isin=eq.${encodeURIComponent(isin)}`, { method: 'PATCH', body: patch });
    res.json(Array.isArray(r) ? r[0] : r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/db/fondos-pershing/:isin', async (req, res) => {
  try {
    const isin = String(req.params.isin || '').toUpperCase();
    await supa(`/fondos_pershing?isin=eq.${encodeURIComponent(isin)}`, { method: 'DELETE' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════
//  VACACIONES — participantes + registros de ausencia
//
//  Dos tablas en Supabase:
//    - `vacaciones_personas`: las etiquetas (JMD/GGA/FD/JH son primarias y
//      vienen sembradas; el resto se crean desde la UI para gente sin login).
//    - `vacaciones`: un registro por período, con rango desde/hasta, tipo y
//      descripción. Los rangos SÍ pueden solaparse entre personas — mostrar
//      esos solapamientos es el punto de la vista timeline.
//
//  Permisos: cualquier usuario del dashboard carga/edita/borra por cualquier
//  persona (equipo chico, sin flujo de aprobación). Se guarda `creado_por`
//  con el email del que cargó, sólo como rastro de auditoría.
// ══════════════════════════════════════════════

// 'evento' es lo que carga D&G (la firma): reuniones, licitaciones, cierres.
// El resto son ausencias de una persona. Tiene que coincidir con el CHECK de
// la tabla `vacaciones`.
const VAC_TIPOS = ['vacaciones', 'licencia', 'estudio', 'home_office', 'personal', 'evento'];
const VAC_ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Normaliza una hora a "HH:MM". Devuelve null para vacío o formato inválido,
// así el campo queda en null (= día completo) en lugar de romper el insert.
function normHora(v) {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

// ── Personas ──

app.get('/api/db/vacaciones-personas', async (req, res) => {
  try {
    const data = await supa('/vacaciones_personas?activo=eq.true&order=orden.asc,etiqueta.asc');
    res.json(Array.isArray(data) ? data : []);
  } catch (e) { console.error('DB GET vacaciones_personas:', e); res.json([]); }
});

app.post('/api/db/vacaciones-personas', async (req, res) => {
  try {
    const body = req.body || {};
    const etiqueta = String(body.etiqueta || '').trim().toUpperCase();
    const nombre   = String(body.nombre   || '').trim();
    if (!etiqueta || !nombre) return res.status(400).json({ error: 'etiqueta y nombre son obligatorios' });
    if (!/^[A-Z0-9]{2,6}$/.test(etiqueta)) return res.status(400).json({ error: 'la etiqueta debe ser de 2 a 6 caracteres alfanuméricos' });

    const existing = await supa(`/vacaciones_personas?etiqueta=eq.${encodeURIComponent(etiqueta)}`);
    if (Array.isArray(existing) && existing.length > 0) {
      // Si la etiqueta existe pero está dada de baja, la reactivamos en lugar
      // de rechazar el alta — evita el callejón sin salida de "ya existe"
      // para algo que el usuario no ve en la lista.
      if (existing[0].activo === false) {
        const r = await supa(`/vacaciones_personas?etiqueta=eq.${encodeURIComponent(etiqueta)}`, {
          method: 'PATCH',
          body: { activo: true, nombre, color: body.color || existing[0].color, updated_at: new Date().toISOString() },
        });
        return res.json(Array.isArray(r) ? r[0] : r);
      }
      return res.status(409).json({ error: `ya existe una persona con etiqueta ${etiqueta}` });
    }

    const r = await supa('/vacaciones_personas', {
      method: 'POST',
      body: {
        etiqueta,
        nombre,
        email:    body.email ? String(body.email).trim() : null,
        color:    body.color || '#8b95a5',
        primaria: false,
        orden:    Number.isFinite(+body.orden) ? +body.orden : 100,
      },
    });
    res.json(Array.isArray(r) ? r[0] : r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/db/vacaciones-personas/:id', async (req, res) => {
  try {
    const patch = { updated_at: new Date().toISOString() };
    if (req.body?.nombre != null) patch.nombre = String(req.body.nombre).trim();
    if (req.body?.color  != null) patch.color  = String(req.body.color).trim();
    if (req.body?.email  != null) patch.email  = String(req.body.email).trim() || null;
    if (req.body?.orden  != null) patch.orden  = +req.body.orden;
    const r = await supa(`/vacaciones_personas?id=eq.${encodeURIComponent(req.params.id)}`, { method: 'PATCH', body: patch });
    res.json(Array.isArray(r) ? r[0] : r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Baja lógica: las primarias no se pueden dar de baja (son el equipo fijo), y
// borrar una persona con registros se llevaría puestas sus vacaciones por el
// ON DELETE CASCADE. Por eso siempre desactivamos en vez de borrar.
app.delete('/api/db/vacaciones-personas/:id', async (req, res) => {
  try {
    const id = encodeURIComponent(req.params.id);
    const rows = await supa(`/vacaciones_personas?id=eq.${id}`);
    const persona = Array.isArray(rows) ? rows[0] : null;
    if (!persona) return res.status(404).json({ error: 'persona no encontrada' });
    if (persona.primaria) return res.status(400).json({ error: 'las etiquetas primarias no se pueden dar de baja' });
    await supa(`/vacaciones_personas?id=eq.${id}`, { method: 'PATCH', body: { activo: false, updated_at: new Date().toISOString() } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Registros ──

// GET acepta ?from=YYYY-MM-DD&to=YYYY-MM-DD para acotar al rango visible.
// El filtro trae todo lo que SOLAPA la ventana (hasta>=from && desde<=to), no
// sólo lo que empieza adentro — si no, un período que arranca en diciembre y
// termina en enero desaparecería de la vista de enero.
app.get('/api/db/vacaciones', async (req, res) => {
  try {
    const qs = ['order=desde.desc'];
    const from = String(req.query.from || '');
    const to   = String(req.query.to   || '');
    if (VAC_ISO_DATE.test(from)) qs.push(`hasta=gte.${from}`);
    if (VAC_ISO_DATE.test(to))   qs.push(`desde=lte.${to}`);
    const data = await supa(`/vacaciones?${qs.join('&')}`);
    res.json(Array.isArray(data) ? data : []);
  } catch (e) { console.error('DB GET vacaciones:', e); res.json([]); }
});

app.post('/api/db/vacaciones', async (req, res) => {
  try {
    const body = req.body || {};
    const persona_id = String(body.persona_id || '').trim();
    const desde = String(body.desde || '').trim();
    const hasta = String(body.hasta || '').trim();
    const tipo  = String(body.tipo  || 'vacaciones').trim();

    if (!persona_id) return res.status(400).json({ error: 'persona_id es obligatorio' });
    if (!VAC_ISO_DATE.test(desde) || !VAC_ISO_DATE.test(hasta)) return res.status(400).json({ error: 'desde y hasta deben ser fechas YYYY-MM-DD' });
    if (hasta < desde) return res.status(400).json({ error: 'la fecha de fin no puede ser anterior a la de inicio' });
    if (!VAC_TIPOS.includes(tipo)) return res.status(400).json({ error: `tipo inválido (${VAC_TIPOS.join(', ')})` });

    const r = await supa('/vacaciones', {
      method: 'POST',
      body: {
        persona_id, desde, hasta, tipo,
        // Las horas son opcionales: sólo los eventos las usan, las ausencias
        // son de día completo. Si viene fin sin inicio, se descarta el fin.
        hora_desde: normHora(body.hora_desde),
        hora_hasta: normHora(body.hora_desde) ? normHora(body.hora_hasta) : null,
        descripcion: body.descripcion ? String(body.descripcion).trim() : null,
        creado_por:  body.creado_por ? String(body.creado_por).trim() : null,
      },
    });
    res.json(Array.isArray(r) ? r[0] : r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/db/vacaciones/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const patch = { updated_at: new Date().toISOString() };
    if (b.persona_id  != null) patch.persona_id  = String(b.persona_id).trim();
    if (b.descripcion != null) patch.descripcion = String(b.descripcion).trim() || null;
    if (b.hora_desde  !== undefined) {
      patch.hora_desde = normHora(b.hora_desde);
      // Sin hora de inicio no puede quedar una hora de fin colgada.
      if (!patch.hora_desde) patch.hora_hasta = null;
    }
    if (b.hora_hasta !== undefined && patch.hora_hasta === undefined) {
      patch.hora_hasta = normHora(b.hora_hasta);
    }
    if (b.desde != null) {
      if (!VAC_ISO_DATE.test(String(b.desde))) return res.status(400).json({ error: 'desde inválido' });
      patch.desde = String(b.desde);
    }
    if (b.hasta != null) {
      if (!VAC_ISO_DATE.test(String(b.hasta))) return res.status(400).json({ error: 'hasta inválido' });
      patch.hasta = String(b.hasta);
    }
    if (b.tipo != null) {
      if (!VAC_TIPOS.includes(String(b.tipo))) return res.status(400).json({ error: 'tipo inválido' });
      patch.tipo = String(b.tipo);
    }
    // Si sólo llega una de las dos puntas, validamos contra la guardada.
    if (patch.desde || patch.hasta) {
      const rows = await supa(`/vacaciones?id=eq.${encodeURIComponent(req.params.id)}`);
      const actual = Array.isArray(rows) ? rows[0] : null;
      if (!actual) return res.status(404).json({ error: 'registro no encontrado' });
      const d = patch.desde || actual.desde;
      const h = patch.hasta || actual.hasta;
      if (h < d) return res.status(400).json({ error: 'la fecha de fin no puede ser anterior a la de inicio' });
    }
    const r = await supa(`/vacaciones?id=eq.${encodeURIComponent(req.params.id)}`, { method: 'PATCH', body: patch });
    res.json(Array.isArray(r) ? r[0] : r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/db/vacaciones/:id', async (req, res) => {
  try {
    await supa(`/vacaciones?id=eq.${encodeURIComponent(req.params.id)}`, { method: 'DELETE' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════
//  AGENDA · AVISOS POR MAIL
//
//  Dos envíos automáticos a los usuarios activos de `allowed_users`:
//    - Víspera:  todos los días 18:00 AR, con lo que arranca mañana.
//    - Semanal:  domingos 20:00 AR, con la semana que viene (lun a dom).
//
//  Ambos traen links de Google Calendar por registro y un .ics con todo.
//  Endpoints de preview (sin enviar nada) para poder mirarlos en el browser.
// ══════════════════════════════════════════════

// Destinatarios: los usuarios habilitados del dashboard. Se lee de la base en
// cada envío, así dar de alta a alguien en `allowed_users` ya lo suscribe.
async function destinatariosAgenda() {
  try {
    const rows = await supa('/allowed_users?active=eq.true&select=email');
    const mails = (Array.isArray(rows) ? rows : []).map(r => r.email).filter(Boolean);
    return [...new Set(mails)];
  } catch (e) {
    console.error('[agenda] no pude leer destinatarios:', e.message);
    return [];
  }
}

// Registros que SOLAPAN la ventana [desde, hasta], con las personas resueltas.
async function registrosEntre(desde, hasta) {
  const [regs, pers] = await Promise.all([
    supa(`/vacaciones?hasta=gte.${desde}&desde=lte.${hasta}&order=desde.asc`),
    supa('/vacaciones_personas?activo=eq.true'),
  ]);
  const nombre   = new Map();
  const etiqueta = new Map();
  (Array.isArray(pers) ? pers : []).forEach(p => {
    nombre.set(p.id, p.nombre);
    etiqueta.set(p.id, p.etiqueta);
  });
  return { registros: Array.isArray(regs) ? regs : [], nombre, etiqueta };
}

// URL pública del server, para el link de descarga del .ics dentro del mail.
function baseUrlServer() {
  return process.env.RENDER_EXTERNAL_URL || process.env.SELF_PING_URL?.replace(/\/api\/health$/, '') || `http://localhost:${PORT}`;
}

// Arma el mail diario: lo que hay HOY.
//
// Sale a las 7 de la mañana, así que habla del día que arranca — no del
// siguiente. Incluye todo lo que está vigente hoy, tanto lo que empieza como
// lo que ya venía corriendo: si alguien está en la mitad de sus vacaciones,
// sigue sin estar, y el mail tiene que decirlo.
async function armarDiario(hoyYmd) {
  const { registros, nombre, etiqueta } = await registrosEntre(hoyYmd, hoyYmd);
  const fecha = fmtFechaLarga(hoyYmd);
  return {
    hay: registros.length > 0,
    registros,
    nombre, etiqueta,
    asunto: registros.length
      ? `Agenda · hoy ${fecha}`
      : `Agenda · hoy ${fecha} — sin eventos`,
    html: construirHtml({
      titulo: 'Hoy en la agenda',
      bajada: fecha.replace(/^\w/, c => c.toUpperCase()),
      registros,
      nombrePorPersona: nombre,
      etiquetaPorPersona: etiqueta,
      vacioTxt: 'No hay eventos ni ausencias para hoy.',
      linkIcs: registros.length ? `${baseUrlServer()}/api/agenda/ics?desde=${hoyYmd}&hasta=${hoyYmd}` : null,
    }),
    ics: construirICS(registros, nombre),
  };
}

// Arma el resumen semanal: la semana que viene, lunes a domingo.
async function armarSemanal(hoyYmd) {
  const lunes   = lunesDeLaSemana(hoyYmd, 1);
  const domingo = sumarDias(lunes, 6);
  const { registros, nombre, etiqueta } = await registrosEntre(lunes, domingo);
  return {
    hay: registros.length > 0,
    registros, nombre, etiqueta,
    asunto: `Agenda · semana del ${fmtFechaLarga(lunes)}`,
    html: construirHtml({
      titulo: 'La semana que viene',
      bajada: `Del ${fmtFechaLarga(lunes)} al ${fmtFechaLarga(domingo)}`,
      registros,
      nombrePorPersona: nombre,
      etiquetaPorPersona: etiqueta,
      linkIcs: `${baseUrlServer()}/api/agenda/ics?desde=${lunes}&hasta=${domingo}`,
    }),
    ics: construirICS(registros, nombre),
  };
}

// Descarga .ics de un rango. Lo usan los botones "Agregar todo al calendario"
// de los mails y el de la propia sección Agenda.
app.get('/api/agenda/ics', async (req, res) => {
  try {
    const desde = String(req.query.desde || '');
    const hasta = String(req.query.hasta || desde);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      return res.status(400).json({ error: 'desde/hasta deben ser YYYY-MM-DD' });
    }
    const { registros, nombre } = await registrosEntre(desde, hasta);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="agenda-${desde}.ics"`);
    res.send(construirICS(registros, nombre));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Preview en el browser, sin mandar nada. ?tipo=diario|semanal
app.get('/api/agenda/preview', async (req, res) => {
  try {
    const tipo = req.query.tipo === 'semanal' ? 'semanal' : 'diario';
    // ?hoy=YYYY-MM-DD permite pararse en otra fecha para probar.
    const hoy = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.hoy)) ? String(req.query.hoy) : ymdEnAR();
    const m = tipo === 'semanal' ? await armarSemanal(hoy) : await armarDiario(hoy);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(m.html);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Envío manual, para probar de verdad una vez cargadas las credenciales.
// ?tipo=diario|semanal  ·  ?para=mail@dominio (por defecto, allowed_users)
app.post('/api/agenda/enviar', async (req, res) => {
  try {
    if (!mailConfigurado()) {
      return res.status(400).json({ error: 'falta configurar GMAIL_USER y GMAIL_APP_PASSWORD en el .env' });
    }
    const tipo = req.query.tipo === 'semanal' ? 'semanal' : 'diario';
    const hoy = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.hoy)) ? String(req.query.hoy) : ymdEnAR();
    const m = tipo === 'semanal' ? await armarSemanal(hoy) : await armarDiario(hoy);
    const para = req.query.para ? [String(req.query.para)] : await destinatariosAgenda();
    const resultados = await enviarMail({ para, asunto: m.asunto, html: m.html, adjuntoIcs: m.ics });
    const fallaron = resultados.filter(r => !r.ok);
    res.json({
      ok: fallaron.length === 0,
      tipo,
      asunto: m.asunto,
      registros: m.registros.length,
      enviados: resultados.filter(r => r.ok).map(r => r.para),
      fallaron,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Corre un envío automático, con guard de "una vez por día".
let ultimoDiario = null;
let ultimaSemanal = null;

async function correrAviso(tipo) {
  const hoy = ymdEnAR();
  try {
    const m = tipo === 'semanal' ? await armarSemanal(hoy) : await armarDiario(hoy);
    // Los dos salen siempre, tengan o no registros: el diario sin nada dice
    // explícitamente que no hay eventos, que es información útil (confirma
    // que el sistema está vivo y que nadie se olvidó de cargar algo).
    if (!mailConfigurado()) {
      console.warn(`[agenda] ${tipo}: SMTP sin configurar, no se envía`);
      return { ok: false, motivo: 'sin_smtp' };
    }
    const para = await destinatariosAgenda();
    const resultados = await enviarMail({ para, asunto: m.asunto, html: m.html, adjuntoIcs: m.ics });
    const ok = resultados.filter(r => r.ok).length;
    const mal = resultados.filter(r => !r.ok);
    console.log(`[agenda] ${tipo}: ${ok}/${para.length} enviados (${m.registros.length} registros)`);
    if (mal.length) console.warn(`[agenda] ${tipo}: fallaron ${mal.map(r => r.para).join(', ')}`);
    return { ok: mal.length === 0, enviado: ok > 0, resultados };
  } catch (e) {
    console.error(`[agenda] ${tipo} falló:`, e.message);
    return { ok: false, error: e.message };
  }
}

// Scheduler: diario 7:00 AR todos los días, semanal domingos 20:00 AR.
// Se chequea en el tick de un minuto en lugar de usar node-cron para no
// depender de que el proceso esté vivo exactamente a esa hora: si el server
// arranca entre 7:00 y 7:10, el diario igual sale.
setInterval(() => {
  const { weekday, hour, minute } = getBuenosAiresParts();
  const m = hour * 60 + minute;
  const hoy = ymdEnAR();

  if (ultimoDiario !== hoy && m >= 7 * 60 && m < 7 * 60 + 10) {
    ultimoDiario = hoy;
    correrAviso('diario');
  }
  if (weekday === 'Sun' && ultimaSemanal !== hoy && m >= 20 * 60 && m < 20 * 60 + 10) {
    ultimaSemanal = hoy;
    correrAviso('semanal');
  }
}, 60_000);


// ══════════════════════════════════════════════
//  AUTH — Supabase Auth multi-usuario con whitelist (allowed_users)
//
//  - El cliente se autentica contra Supabase Auth (email/pass o Google).
//    Recibe un JWT que mete en `Authorization: Bearer <jwt>` en cada request.
//  - Este middleware valida el JWT contra Supabase (vía /auth/v1/user) y
//    verifica que el email esté en `allowed_users` con `active=true`. Si no
//    pasa una de las dos cosas → 401/403.
//  - Endpoint `GET /api/auth/me` devuelve el perfil (email, role, active)
//    al cliente para decidir si mostrar la app o "pendiente de aprobación".
//  - Cada sign-in y sign-out se loguea en `auth_log` para auditoría.
//
//  Decisión de diseño: validamos el JWT contra Supabase REST en cada request
//  (con cache breve), en vez de verificar la firma con la JWT secret. Razón:
//  rotamos sin tocar el server, y nos asegura que un usuario "desactivado en
//  Supabase" no pueda seguir usando un token viejo.
// ══════════════════════════════════════════════
const SUPA_AUTH_URL = SUPA_URL ? `${SUPA_URL}/auth/v1` : '';

// Cache de validación de JWT → user payload. TTL corto para no martillar a
// Supabase si el mismo cliente hace muchas requests seguidas.
const jwtCache = new Map();   // token → { user, expiresAt }
const JWT_CACHE_TTL_MS = 60_000;

async function verifySupabaseJwt(token) {
  if (!token || !SUPA_AUTH_URL) return null;
  const cached = jwtCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  try {
    const { status, data } = await httpJson(`${SUPA_AUTH_URL}/user`, {
      method: 'GET',
      // apikey: cualquier key válida del proyecto autoriza el gateway de auth.
      // Usamos el effective key (service || anon) para no depender de que
      // SUPABASE_KEY esté seteada — si sólo está el service key, igual valida.
      headers: { apikey: SUPA_KEY || SUPA_EFFECTIVE_KEY, Authorization: `Bearer ${token}` },
      timeoutMs: 5000,
      retries: 0,
    });
    if (status !== 200 || !data?.email) return null;
    const user = { id: data.id, email: data.email.toLowerCase(), raw: data };
    jwtCache.set(token, { user, expiresAt: Date.now() + JWT_CACHE_TTL_MS });
    return user;
  } catch {
    return null;
  }
}

// Cache del whitelist: refresca cada 30s. Si querés que un alta/baja sea
// inmediata, llamá a /api/auth/refresh-whitelist (admin only).
let whitelistCache = { items: new Map(), fetchedAt: 0 };
const WL_CACHE_TTL_MS = 30_000;

async function getWhitelist() {
  const now = Date.now();
  if (now - whitelistCache.fetchedAt < WL_CACHE_TTL_MS && whitelistCache.items.size > 0) {
    return whitelistCache.items;
  }
  try {
    const rows = await supa('/allowed_users?select=email,full_name,role,active');
    const map = new Map();
    if (Array.isArray(rows)) {
      for (const r of rows) map.set(String(r.email).toLowerCase(), r);
    }
    whitelistCache = { items: map, fetchedAt: now };
    return map;
  } catch (e) {
    console.warn('[auth] getWhitelist fail:', e.message);
    return whitelistCache.items;  // fallback al cache aunque sea viejo
  }
}

function extractBearer(req) {
  const auth = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1] : null;
}

// Middleware: requiere JWT válido + email en whitelist. Adjunta `req.auth`.
async function requireAuth(req, res, next) {
  const token = extractBearer(req);
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  const user = await verifySupabaseJwt(token);
  if (!user) return res.status(401).json({ error: 'invalid token' });
  const wl = await getWhitelist();
  const entry = wl.get(user.email);
  if (!entry || !entry.active) {
    return res.status(403).json({ error: 'not whitelisted', email: user.email });
  }
  req.auth = { user, profile: entry };
  next();
}

// Variant para endpoints admin-only.
async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (req.auth?.profile?.role !== 'admin') {
      return res.status(403).json({ error: 'admin only' });
    }
    next();
  });
}

async function logAuthEvent(event, user, req, meta = null) {
  try {
    await supa('/auth_log', {
      method: 'POST',
      body: {
        user_id: user?.id || null,
        email: user?.email || null,
        event,
        ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim() || null,
        user_agent: (req.headers['user-agent'] || '').toString().slice(0, 500),
        meta,
      },
    });
  } catch (e) { /* log audit no debería tirar el request */ }
}

// GET /api/auth/me — valida JWT + whitelist y devuelve perfil. El cliente lo
// usa al arrancar (y tras cada cambio de sesión) para decidir el flow.
app.get('/api/auth/me', async (req, res) => {
  const token = extractBearer(req);
  if (!token) return res.status(401).json({ error: 'no token' });
  const user = await verifySupabaseJwt(token);
  if (!user) return res.status(401).json({ error: 'invalid token' });
  const wl = await getWhitelist();
  const entry = wl.get(user.email);
  if (!entry || !entry.active) {
    await logAuthEvent('sign_in_blocked', user, req, { reason: !entry ? 'not_whitelisted' : 'inactive' });
    return res.status(403).json({ error: 'not whitelisted', email: user.email });
  }
  // Log sign_in la primera vez por sesión (cache de JWT → ya está en jwtCache,
  // si el cache estaba frío significa que es un login nuevo).
  await logAuthEvent('sign_in', user, req);
  res.json({
    email: user.email,
    full_name: entry.full_name || null,
    role: entry.role || 'user',
    active: !!entry.active,
  });
});

app.post('/api/auth/sign-out', async (req, res) => {
  const token = extractBearer(req);
  const user = token ? await verifySupabaseJwt(token) : null;
  if (user) await logAuthEvent('sign_out', user, req);
  jwtCache.delete(token);
  res.json({ ok: true });
});

// Forzar refresh del whitelist (útil cuando un admin agrega/quita gente).
app.post('/api/auth/refresh-whitelist', requireAdmin, async (_req, res) => {
  whitelistCache = { items: new Map(), fetchedAt: 0 };
  await getWhitelist();
  res.json({ ok: true, count: whitelistCache.items.size });
});


// Self-ping para que Render free tier no duerma el servicio. Cada 13 min
// hacemos un GET a /api/health → resetea el contador de inactividad.
// Render setea RENDER_EXTERNAL_URL automáticamente cuando estás deployado.
// Localmente esto no se activa.
const SELF_PING_URL = process.env.RENDER_EXTERNAL_URL
  ? `${process.env.RENDER_EXTERNAL_URL}/api/health`
  : process.env.SELF_PING_URL || null;
if (SELF_PING_URL) {
  console.log(`[self-ping] activado: ${SELF_PING_URL} cada 13 min`);
  cron.schedule('*/13 * * * *', async () => {
    try { await fetch(SELF_PING_URL); }
    catch (e) { console.warn('[self-ping] error:', e.message); }
  });
}

// ══════════════════════════════════════════════
//  NEWS — agrega varios RSS y devuelve titulares unificados
//
//  Polea N feeds en paralelo, mergea por fecha, cachea 5 min en memoria.
//  Si un feed falla, los otros siguen. El cliente refresca cada 2-3 min;
//  como el cache es de 5 min, varios clientes comparten la misma respuesta.
// ══════════════════════════════════════════════
const rssParser = new Parser({
  timeout: 6000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DGDashboard/1.0)' },
});

// Cada feed declara su peso editorial (0-10) y el sesgo de categoría que
// asumimos por default. El categorizador después afina por keywords del
// título y puede sobrescribirlo. Bloomberg/Reuters/WSJ no exponen RSS
// público abierto, los traemos vía Google News con `site:`.
const NEWS_FEEDS = [
  // Mundo — prestigio top (mercados/economía/política internacional)
  { name: 'Bloomberg',   url: 'https://news.google.com/rss/search?q=site:bloomberg.com&hl=es-419&gl=US&ceid=US:es-419', weight: 10, country: 'WORLD', defaultCat: 'markets' },
  { name: 'Reuters',     url: 'https://news.google.com/rss/search?q=site:reuters.com&hl=es-419&gl=US&ceid=US:es-419',   weight: 10, country: 'WORLD', defaultCat: 'markets' },
  { name: 'WSJ',         url: 'https://news.google.com/rss/search?q=site:wsj.com&hl=es-419&gl=US&ceid=US:es-419',       weight: 9,  country: 'WORLD', defaultCat: 'markets' },
  { name: 'Financial Times', url: 'https://news.google.com/rss/search?q=site:ft.com&hl=es-419&gl=US&ceid=US:es-419',    weight: 9,  country: 'WORLD', defaultCat: 'markets' },
  { name: 'BBC Mundo',   url: 'https://feeds.bbci.co.uk/mundo/rss.xml',                                                 weight: 7,  country: 'WORLD', defaultCat: 'general' },
  // Argentina — economía/mercados primero (prestigio editorial alto)
  { name: 'Cronista',    url: 'https://news.google.com/rss/search?q=site:cronista.com&hl=es-419&gl=AR&ceid=AR:es-419',  weight: 8,  country: 'AR',    defaultCat: 'markets' },
  { name: 'Ámbito',      url: 'https://www.ambito.com/rss/pages/economia.xml',                                          weight: 8,  country: 'AR',    defaultCat: 'markets' },
  { name: 'BAE',         url: 'https://news.google.com/rss/search?q=site:baenegocios.com&hl=es-419&gl=AR&ceid=AR:es-419', weight: 7, country: 'AR',  defaultCat: 'markets' },
  // Argentina — generales (filtramos deporte/farándula por título)
  { name: 'La Nación',   url: 'https://www.lanacion.com.ar/arc/outboundfeeds/rss/',                                     weight: 6,  country: 'AR',    defaultCat: 'general' },
  { name: 'Infobae',     url: 'https://news.google.com/rss/search?q=site:infobae.com&hl=es-419&gl=AR&ceid=AR:es-419',   weight: 6,  country: 'AR',    defaultCat: 'general' },
  { name: 'Perfil',      url: 'https://www.perfil.com/feed',                                                            weight: 5,  country: 'AR',    defaultCat: 'politics' },
  // Búsquedas temáticas (mercados/política AR) — más ranking, menos ruido
  { name: 'Mercados AR', url: 'https://news.google.com/rss/search?q=mercados+OR+bolsa+OR+merval+OR+bonos+OR+d%C3%B3lar&hl=es-419&gl=AR&ceid=AR:es-419',    weight: 7, country: 'AR', defaultCat: 'markets' },
  { name: 'Política AR', url: 'https://news.google.com/rss/search?q=Milei+OR+gobierno+OR+congreso+OR+senado&hl=es-419&gl=AR&ceid=AR:es-419',                weight: 6, country: 'AR', defaultCat: 'politics' },
];

// Patrones para filtrar deporte/farándula/policiales y para detectar política /
// mercados. Aplicados al título minúscula.
const RE_EXCLUDE = /\b(f[uú]tbol|f[uú]tbolista|gol(es)?|partid[oa]|jugador|jugadora|tenis|f[oó]rmula\s?1|f1|moto\s?gp|atleta|atletismo|nba|nfl|olimp|mundial\s?(\d|sub|fifa)|copa\s?(am[eé]rica|libertadores|sudamericana|davis)|liga\s?(profesional|premier|italiana|española|argentina|mx)|boca\b|river\b|racing\b|independiente\b|messi\b|maradona\b|farandula|far[aá]ndula|chimentos?|gran\s?hermano|reality|trending|recetas?|hor[oó]scopo|recital|cantante|actriz|netflix|spotify|telenovela|hincha|polic[ií]a|crimen|crimin|asesin|homicid|robo\b|muerte\b|fallec|verificaci[oó]n|fact[\s-]?check|chequeo|desinformaci[oó]n)/i;
const RE_POLITICS = /\b(milei|cristina|kicillof|caputo|gobierno|congreso|senado|diputado|elecci[oó]n|kirchner|macri|massa|cfk|presidente|presidencial|pliego|ministr|peronist|libertari|kirchnerist|opositor|oficialis|fmi|fondo\s?monetario)\b/i;
const RE_MARKETS  = /\b(d[oó]lar|blue|mep|ccl|merval|bolsa|bonos?|riesgo\s?pa[ií]s|inflaci[oó]n|fed|tasa|wall\s?street|nasdaq|s&p|sp500|dow\s?jones|cedear|ypf|galicia|pampa|tesla|nvidia|petr[oó]leo|oro|cripto|bitcoin|eth|btc|acci[oó]n|emisi[oó]n|reservas?|bcra|d[eé]ficit|super[aá]vit|cny|yuan|euro|brent|wti)\b/i;

let newsCache = { fetchedAt: 0, items: [] };
const NEWS_CACHE_MS = 5 * 60 * 1000;

// Para feeds temáticos (Mercados AR / Política AR) exigimos que el título
// matchee su tema — si no, es ruido del agregador y lo descartamos.
const TOPIC_REQUIRED = {
  'Mercados AR': RE_MARKETS,
  'Política AR': RE_POLITICS,
};

// Determina la categoría final. El default del feed se usa si el título no
// matchea ningún tema. Para feeds de prestigio internacional, las notas que
// no son de mercado/política igual se mantienen como 'general' (no se tiran).
function categorize(title, defaultCat) {
  const t = title.toLowerCase();
  if (RE_MARKETS.test(t))  return 'markets';
  if (RE_POLITICS.test(t)) return 'politics';
  // Si el feed dice "markets" pero el título no es de mercado, mejor 'general'
  // para no ensuciar la sección de markets con ruido.
  return defaultCat === 'markets' ? 'general' : (defaultCat || 'general');
}

async function fetchOneFeed(feed) {
  try {
    const parsed = await rssParser.parseURL(feed.url);
    const required = TOPIC_REQUIRED[feed.name];
    return (parsed.items || []).map(it => {
      const title = (it.title || '').trim();
      const t = title.toLowerCase();
      if (!title || !it.link) return null;
      if (RE_EXCLUDE.test(t)) return null;
      if (required && !required.test(t)) return null;  // feed temático sin match → descartar
      const cat = categorize(title, feed.defaultCat);
      const catBonus = cat === 'markets' ? 4 : cat === 'politics' ? 3 : 0;
      return {
        title,
        link:    it.link || '',
        source:  feed.name,
        country: feed.country,
        category: cat,
        date:    it.isoDate || it.pubDate || null,
        _baseScore: (feed.weight || 5) + catBonus,
      };
    }).filter(Boolean);
  } catch (e) {
    console.warn(`[news] ${feed.name} falló: ${e.message}`);
    return [];
  }
}

async function refreshNews() {
  const lists = await Promise.all(NEWS_FEEDS.map(fetchOneFeed));
  const now = Date.now();
  const HOUR_MS = 3600_000;

  // HARD CUTOFF de antigüedad. Empezamos pidiendo 24h, si quedan pocas
  // ampliamos a 48h, etc. Items sin fecha O con fechas absurdas (>30 días
  // atrás, o más de 1h en el futuro por TZ) se descartan siempre.
  const withDate = lists.flat().filter(x => {
    if (!x.date) return false;
    const t = new Date(x.date).getTime();
    if (!Number.isFinite(t)) return false;
    const ageH = (now - t) / HOUR_MS;
    return ageH > -1 && ageH < 24 * 30;  // -1h (futuro chico) a 30 días
  });

  let maxAgeH = 24;
  let pool = withDate.filter(x => (now - new Date(x.date).getTime()) / HOUR_MS <= maxAgeH);
  if (pool.length < 10) { maxAgeH = 48; pool = withDate.filter(x => (now - new Date(x.date).getTime()) / HOUR_MS <= maxAgeH); }
  if (pool.length < 10) { maxAgeH = 72; pool = withDate.filter(x => (now - new Date(x.date).getTime()) / HOUR_MS <= maxAgeH); }

  // Score final: base (fuente+categoría) + bonus de recencia.
  for (const it of pool) {
    const ageH = Math.max(0, (now - new Date(it.date).getTime()) / HOUR_MS);
    const recencyBonus = Math.max(0, 5 - ageH / 5);
    it.score = it._baseScore + recencyBonus;
    delete it._baseScore;
  }
  const all = pool;

  // Dedup por título + cap por fuente: max 6 items por medio para forzar
  // diversidad (sino un solo feed con muchas notas opaca a los prestigiosos).
  const seenKeys = new Set();
  const perSource = {};
  const PER_SOURCE_CAP = 6;
  const dedup = [];
  for (const it of all.sort((a, b) => b.score - a.score)) {
    const key = it.title.toLowerCase().replace(/\W+/g, '').slice(0, 60);
    if (seenKeys.has(key)) continue;
    if ((perSource[it.source] || 0) >= PER_SOURCE_CAP) continue;
    seenKeys.add(key);
    perSource[it.source] = (perSource[it.source] || 0) + 1;
    dedup.push(it);
  }

  newsCache = { fetchedAt: now, items: dedup.slice(0, 60) };
  return newsCache.items;
}

app.get('/api/news', async (_req, res) => {
  try {
    const age = Date.now() - newsCache.fetchedAt;
    if (newsCache.items.length === 0 || age > NEWS_CACHE_MS) {
      await refreshNews();
    }
    res.json({ items: newsCache.items, fetchedAt: newsCache.fetchedAt });
  } catch (e) {
    console.error('[news] fatal:', e);
    res.status(500).json({ error: e.message, items: [] });
  }
});

// Pre-warm al boot para que el primer cliente no espere
refreshNews().catch(() => {});

// ══════════════════════════════════════════════
//  PPI API
// ══════════════════════════════════════════════
const PPI_BASE = 'https://clientapi.portfoliopersonal.com';
const PPI_V = '1.0';
const PPI_AC = process.env.PPI_AUTHORIZED_CLIENT;
const PPI_CK = process.env.PPI_CLIENT_KEY;
const PPI_AK = process.env.PPI_API_KEY;
const PPI_AS = process.env.PPI_API_SECRET;

let ppiToken = null, ppiRefreshTk = null, ppiExp = null;
function ppiExpired() { return !ppiToken || !ppiExp || new Date() >= new Date(ppiExp); }

// Wrapper sobre httpJson: mantiene la misma firma de retorno { status, data }
// que tenía la versión vieja basada en https.request.
function ppiFetch(path, opts = {}) {
  const url = new URL(path, PPI_BASE).toString();
  return httpJson(url, {
    method: opts.method || 'GET',
    headers: opts.headers,
    body: opts.body,
    timeoutMs: opts.timeoutMs ?? 10000,  // 10s — PPI a veces tarda
    retries: opts.retries ?? 1,
  }).catch(err => {
    // Para que callers que esperaban { status } sigan funcionando ante errores
    // que vienen con status (HTTP 4xx/5xx), retornamos un objeto en vez de tirar
    // sólo si fue un 5xx final tras retries; el resto sigue tirando para forzar
    // a que el handler los maneje.
    if (err instanceof HttpError && err.kind === 'http') {
      return { status: err.status, data: null };
    }
    throw err;
  });
}

async function ppiLogin() {
  console.log('🔑 PPI login...');
  const r = await ppiFetch(`/api/${PPI_V}/Account/LoginApi`, {
    method: 'POST',
    headers: { AuthorizedClient: PPI_AC, ClientKey: PPI_CK, ApiKey: PPI_AK, ApiSecret: PPI_AS },
  });
  if (r.status !== 200) throw new Error(`PPI Login ${r.status}`);
  const s = Array.isArray(r.data) ? r.data[0] : r.data;
  ppiToken = s.accessToken; ppiRefreshTk = s.refreshToken; ppiExp = s.expirationDate;
  console.log('✅ PPI ok');
}

async function ppiRefresh() {
  try {
    const r = await ppiFetch(`/api/${PPI_V}/Account/RefreshToken`, {
      method: 'POST',
      headers: { AuthorizedClient: PPI_AC, ClientKey: PPI_CK },
      body: { refreshToken: ppiRefreshTk },
    });
    if (r.status !== 200) throw new Error(`PPI Refresh ${r.status}`);
    const s = Array.isArray(r.data) ? r.data[0] : r.data;
    ppiToken = s.accessToken; ppiRefreshTk = s.refreshToken; ppiExp = s.expirationDate;
  } catch {
    // Si el refresh falla (ej. refresh token expirado), caemos al login completo.
    return ppiLogin();
  }
}

// Singleton-flight: si dos requests con token expirado caen en paralelo, sólo
// un refresh corre; los otros esperan al mismo Promise y reusan el token nuevo.
// Resuelve el race condition #2 detectado en la auditoría.
const refreshPpiToken = singleflight(async () => {
  if (!ppiToken) return ppiLogin();
  if (ppiExpired()) return ppiRefresh();
});

async function getPPIToken() {
  if (ppiToken && !ppiExpired()) return ppiToken;
  await refreshPpiToken();
  return ppiToken;
}

function ppiH() { return { Authorization: `Bearer ${ppiToken}`, AuthorizedClient: PPI_AC, ClientKey: PPI_CK }; }

// ── PPI Cache & Concurrency ──
const ppiCache = new Map(); // key → { data, ts }
const PPI_CACHE_TTL = 45 * 1000; // 45s cache
const PPI_CONCURRENCY = 5;

function getCached(key) {
  const c = ppiCache.get(key);
  if (!c) return null;
  const ttl = c.ttl || PPI_CACHE_TTL;
  if (Date.now() - c.ts < ttl) return c.data;
  return null;
}
function setCache(key, data, ttl) { ppiCache.set(key, { data, ts: Date.now(), ttl }); }

async function ppiConcurrent(tasks, limit = PPI_CONCURRENCY) {
  const results = [];
  for (let i = 0; i < tasks.length; i += limit) {
    const batch = tasks.slice(i, i + limit);
    const batchResults = await Promise.allSettled(batch.map(fn => fn()));
    results.push(...batchResults);
  }
  return results;
}

async function fetchBondWithCache(ticker, instrumentType, settlement) {
  const cacheKey = `${ticker}|${instrumentType}|${settlement}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const md = await ppiFetch(`/api/${PPI_V}/MarketData/Current?${new URLSearchParams({ Ticker: ticker, Type: instrumentType, Settlement: settlement })}`, { headers: ppiH() });
  const data = md.data || {};
  const price = data.price;
  if (!price) { const r = { ticker, error: 'No price' }; return r; }

  const be = await ppiFetch(`/api/${PPI_V}/MarketData/Bonds/Estimate?${new URLSearchParams({ Ticker: ticker, Date: new Date().toISOString(), QuantityType: 'PAPELES', Quantity: '100', AmountOfMoney: '0', Price: String(price), ExchangeRate: '1', EquityRate: '0', ExchangeRateAmortization: '0', RateAdjustmentAmortization: '0' })}`, { headers: ppiH() });
  const bond = Array.isArray(be.data) ? be.data[0] : be.data;

  // Variación diaria. PPI devuelve `marketChangePercent` como string ("-0.49%")
  // comparando contra `previousClose`. El usuario pidió comparar contra el
  // OPENING, así que computamos también esa variante. Exponemos ambas y que
  // el cliente elija (default UI: vs opening, según pedido).
  const opening = Number(data.openingPrice);
  const prevClose = Number(data.previousClose);
  const dailyVarOpenPct = Number.isFinite(opening) && opening > 0
    ? ((price - opening) / opening) * 100
    : null;
  const dailyVarPrevClosePct = Number.isFinite(prevClose) && prevClose > 0
    ? ((price - prevClose) / prevClose) * 100
    : null;

  const result = {
    ticker, price, bond,
    openingPrice:        Number.isFinite(opening) ? opening : null,
    previousClose:       Number.isFinite(prevClose) ? prevClose : null,
    dailyVar:            dailyVarOpenPct,        // vs apertura (lo que pidió el user)
    dailyVarPrevClose:   dailyVarPrevClosePct,   // vs cierre anterior (estándar de mercado)
  };
  setCache(cacheKey, result);
  return result;
}

// Market data (single ticker)
app.get('/api/ppi/market-data/current', async (req, res) => {
  try {
    await getPPIToken();
    const { ticker, type, settlement } = req.query;
    const r = await ppiFetch(`/api/${PPI_V}/MarketData/Current?${new URLSearchParams({ Ticker: ticker, Type: type || 'ON', Settlement: settlement || 'A-24HS' })}`, { headers: ppiH() });
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bonds estimate (single ticker)
// Acepta query params extras (Currency, ExchangeRate, etc.) que se inyectan
// al request a PPI sin tocar el código — útil para testing rápido sin
// redeploys. Cualquier param que NO sea ticker/price y empiece con mayúscula
// pasa directo (PPI usa PascalCase).
app.get('/api/ppi/bonds/estimate', async (req, res) => {
  try {
    await getPPIToken();
    const { ticker, price, ...rest } = req.query;
    const params = {
      Ticker: ticker,
      Date: new Date().toISOString(),
      QuantityType: 'PAPELES',
      Quantity: '100',
      AmountOfMoney: '0',
      Price: price,
      ExchangeRate: '1',
      EquityRate: '0',
      ExchangeRateAmortization: '0',
      RateAdjustmentAmortization: '0',
    };
    // Override / add cualquier param que llegue en la query (case-sensitive,
    // PascalCase como espera PPI).
    for (const [k, v] of Object.entries(rest)) {
      params[k] = String(v);
    }
    const r = await ppiFetch(`/api/${PPI_V}/MarketData/Bonds/Estimate?${new URLSearchParams(params)}`, { headers: ppiH() });
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Batch: cached + concurrent (max 5 parallel PPI calls)
app.post('/api/ppi/bonds/batch', async (req, res) => {
  try {
    await getPPIToken();
    const { tickers } = req.body;
    const instrumentType = req.query.type || 'ON';
    const settlement = req.query.settlement || 'A-24HS';
    if (!Array.isArray(tickers) || !tickers.length) return res.status(400).json({ error: 'tickers required' });

    const tasks = tickers.map(t => () => fetchBondWithCache(t, instrumentType, settlement).catch(e => ({ ticker: t, error: e.message })));
    const results = await ppiConcurrent(tasks);
    res.json(results.map((r, i) => r.status === 'fulfilled' ? r.value : (r.value || { ticker: tickers[i], error: r.reason?.message })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════
//  GRILLAS DE RENTA FIJA — poller con último valor bueno
//
//  El problema que resuelve: antes cada apertura de la grilla disparaba ~2
//  llamadas a PPI por ticker (MarketData/Current + Bonds/Estimate), de a 5 en
//  paralelo, y el cliente pintaba lo que volviera. Si una fallaba, esa fila
//  volvía como {error} y desaparecía de la tabla; al minuto siguiente
//  reaparecía. Con 25-50 instrumentos por categoría, que las ~100 llamadas
//  salieran todas bien cada vez era poco probable.
//
//  Cómo funciona ahora:
//    - El server refresca cada categoría por su cuenta, en background.
//    - Guarda el ÚLTIMO VALOR BUENO de cada ticker. Un refresh que falla no
//      borra nada: la fila conserva el valor anterior y queda marcada como
//      desactualizada, con su antigüedad en segundos.
//    - El cliente pide un snapshot ya armado y lo recibe al instante, sin
//      esperar a PPI. Las filas son siempre TODAS las de la tabla en la base.
//
//  Y para que las llamadas a PPI se rompan menos:
//    - Bonds/Estimate sólo se vuelve a pedir si el precio se movió más de
//      0.05% desde el último cálculo. Con el mercado quieto eso baja las
//      llamadas casi a la mitad (la TIR no cambia si el precio no cambió).
//    - Las tandas van espaciadas 250ms, en vez de golpear de a 5 sin pausa.
//    - Un ticker que falla entra en backoff creciente (1, 2, 4... hasta 10
//      ciclos) en lugar de reintentarse cada minuto para siempre.
//    - Las categorías se refrescan escalonadas, no las tres juntas.
// ══════════════════════════════════════════════

const GRID_CATS = {
  soberanos:    { tabla: 'soberanos',    tipo: 'BONOS', settlement: 'A-48HS' },
  subsoberanos: { tabla: 'subsoberanos', tipo: 'BONOS', settlement: 'A-48HS' },
  favorites:    { tabla: 'favorites',    tipo: 'ON',    settlement: 'A-24HS' },
};

// route → { updatedAt, refreshing, rows: Map<ticker, fila> }
// fila = { data, okAt, err, errAt, fallos, saltear }
const gridStore = new Map();
Object.keys(GRID_CATS).forEach(r => gridStore.set(r, { updatedAt: null, refreshing: false, rows: new Map() }));

const GRID_MAX_FALLOS = 10;       // tope del backoff por ticker
const GRID_PRECIO_EPS = 0.0005;   // 0.05% — umbral para recalcular la TIR

function pausa(ms) { return new Promise(r => setTimeout(r, ms)); }

// Trae precio + estimación de un ticker reusando la TIR anterior si el precio
// prácticamente no se movió. Devuelve la fila nueva o tira.
async function fetchFilaGrid(ticker, tipo, settlement, previa) {
  const md = await ppiFetch(
    `/api/${PPI_V}/MarketData/Current?${new URLSearchParams({ Ticker: ticker, Type: tipo, Settlement: settlement })}`,
    { headers: ppiH(), retries: 2 },
  );
  const data = md.data || {};
  const price = Number(data.price);
  if (!Number.isFinite(price) || price === 0) throw new Error('sin precio');

  // ¿Hace falta recalcular la TIR? Sólo si el precio se movió de verdad.
  const precioPrevio = Number(previa?.data?.price);
  const sinCambio = Number.isFinite(precioPrevio) && precioPrevio > 0
    && Math.abs(price - precioPrevio) / precioPrevio < GRID_PRECIO_EPS
    && previa?.data?.bond;

  let bond = previa?.data?.bond ?? null;
  if (!sinCambio) {
    const be = await ppiFetch(
      `/api/${PPI_V}/MarketData/Bonds/Estimate?${new URLSearchParams({
        Ticker: ticker, Date: new Date().toISOString(), QuantityType: 'PAPELES',
        Quantity: '100', AmountOfMoney: '0', Price: String(price), ExchangeRate: '1',
        EquityRate: '0', ExchangeRateAmortization: '0', RateAdjustmentAmortization: '0',
      })}`,
      { headers: ppiH(), retries: 2 },
    );
    const b = Array.isArray(be.data) ? be.data[0] : be.data;
    // Si la estimación falla pero el precio vino bien, preferimos publicar el
    // precio nuevo con la TIR vieja antes que descartar la fila entera.
    bond = b || previa?.data?.bond || null;
  }

  const opening = Number(data.openingPrice);
  const prevClose = Number(data.previousClose);
  return {
    ticker, price, bond,
    openingPrice:      Number.isFinite(opening) ? opening : null,
    previousClose:     Number.isFinite(prevClose) ? prevClose : null,
    dailyVar:          Number.isFinite(opening) && opening > 0 ? ((price - opening) / opening) * 100 : null,
    dailyVarPrevClose: Number.isFinite(prevClose) && prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : null,
    tirReusada:        !!sinCambio,
  };
}

async function refreshGrid(route) {
  const cat = GRID_CATS[route];
  const store = gridStore.get(route);
  if (!cat || !store || store.refreshing) return;
  store.refreshing = true;

  try {
    await getPPIToken();

    // La lista de instrumentos es la tabla en la base: se muestran TODOS,
    // tengan o no cotización.
    let tickers = [];
    try {
      const favs = await supa(`/${cat.tabla}?activo=eq.true&order=ticker`);
      tickers = (Array.isArray(favs) ? favs : []).map(f => f.ticker).filter(Boolean);
    } catch (e) {
      console.warn(`[grid ${route}] no pude leer la tabla: ${e.message}`);
      return; // sin lista no tocamos nada; el snapshot anterior sigue sirviendo
    }

    // Sacamos del store los que ya no están en la base.
    for (const t of [...store.rows.keys()]) {
      if (!tickers.includes(t)) store.rows.delete(t);
    }

    // Los que están en backoff se saltean en este ciclo.
    const pendientes = tickers.filter(t => {
      const f = store.rows.get(t);
      if (!f || !f.fallos) return true;
      f.saltear = (f.saltear || 0) - 1;
      return f.saltear <= 0;
    });

    let ok = 0, err = 0;
    for (let i = 0; i < pendientes.length; i += PPI_CONCURRENCY) {
      const tanda = pendientes.slice(i, i + PPI_CONCURRENCY);
      const res = await Promise.allSettled(
        tanda.map(t => fetchFilaGrid(t, cat.tipo, cat.settlement, store.rows.get(t))),
      );
      res.forEach((r, j) => {
        const t = tanda[j];
        const previa = store.rows.get(t) || {};
        if (r.status === 'fulfilled') {
          store.rows.set(t, { data: r.value, okAt: Date.now(), err: null, errAt: null, fallos: 0, saltear: 0 });
          ok++;
        } else {
          const fallos = Math.min((previa.fallos || 0) + 1, GRID_MAX_FALLOS);
          store.rows.set(t, {
            ...previa,
            err: r.reason?.message || 'error',
            errAt: Date.now(),
            fallos,
            saltear: fallos, // backoff: espera tantos ciclos como fallos lleva
          });
          err++;
        }
      });
      if (i + PPI_CONCURRENCY < pendientes.length) await pausa(250);
    }

    store.updatedAt = Date.now();
    if (err) console.log(`[grid ${route}] ${ok} ok, ${err} con error (conservan el valor anterior), ${tickers.length} en total`);
  } catch (e) {
    console.error(`[grid ${route}] refresh falló:`, e.message);
  } finally {
    store.refreshing = false;
  }
}

// Snapshot para el cliente: SIEMPRE todas las filas, con su antigüedad.
app.get('/api/ppi/bonds/grid', (req, res) => {
  const route = String(req.query.route || '');
  const store = gridStore.get(route);
  if (!store) return res.status(400).json({ error: 'route inválida' });

  const ahora = Date.now();
  const rows = [...store.rows.entries()].map(([ticker, f]) => ({
    ticker,
    ...(f.data || {}),
    // `stale` = el último refresh de ESTA fila falló. La fila se sigue
    // mostrando con el valor viejo; la UI lo marca en vez de esconderla.
    stale: !!f.err,
    error: f.err || null,
    ageSeconds: f.okAt ? Math.round((ahora - f.okAt) / 1000) : null,
  }));

  res.json({
    route,
    updatedAt: store.updatedAt,
    ageSeconds: store.updatedAt ? Math.round((ahora - store.updatedAt) / 1000) : null,
    refreshing: store.refreshing,
    marketOpen: isMarketOpen(),
    rows,
  });
});

// Fuerza un refresh (para testear sin esperar el ciclo).
app.post('/api/ppi/bonds/grid/refresh', async (req, res) => {
  const route = String(req.query.route || '');
  if (!GRID_CATS[route]) return res.status(400).json({ error: 'route inválida' });
  await refreshGrid(route);
  const store = gridStore.get(route);
  res.json({ ok: true, route, filas: store.rows.size, updatedAt: store.updatedAt });
});

// Ciclo: cada minuto con el mercado abierto; con el mercado cerrado, 1 de
// cada 5 vueltas (los precios no se mueven y así no gastamos cuota de PPI).
// Las tres categorías arrancan separadas 20s para no dispararlas juntas.
const gridVueltas = {};
Object.keys(GRID_CATS).forEach((route, i) => {
  gridVueltas[route] = 0;
  setTimeout(() => {
    refreshGrid(route);
    setInterval(() => {
      gridVueltas[route]++;
      if (isMarketOpen() || gridVueltas[route] % 5 === 0) refreshGrid(route);
    }, 60_000);
  }, 4_000 + i * 20_000);
});


// Clear cache (manual)
app.post('/api/ppi/cache/clear', (req, res) => { ppiCache.clear(); res.json({ ok: true }); });

app.get('/api/ppi/status', async (req, res) => { res.json({ authenticated: !!ppiToken, tokenExpired: ppiExpired(), supabase: !!SUPA_URL }); });

// ══════════════════════════════════════════════
//  BOLSAR · Calendario Bursátil
//
//  bolsar.info/calendario.php embebe el Calendario Bursátil como iframe de
//  Google Calendar. El ID del calendario (base64 en el src del iframe)
//  decodificado es:
//    22d993bb43ba85c1611ae5d81c6de27dbd0c4904725e417d80db4b77d46ff302
//      @group.calendar.google.com
//
//  El feed público ICS no requiere API key. Cacheamos 6h en memoria para no
//  martillar al calendar de Google (el ICS pesa ~1MB). El endpoint acepta
//  ?from=YYYY-MM-DD&to=YYYY-MM-DD para filtrar (opcional).
//
//  Respuesta: [{ date, kind, tickers[], raw }]
//    kind ∈ 'amortizacion' | 'renta' | 'dividendo' | 'feriado' | 'otro'
// ══════════════════════════════════════════════
const BOLSAR_CAL_ID = '22d993bb43ba85c1611ae5d81c6de27dbd0c4904725e417d80db4b77d46ff302@group.calendar.google.com';
const BOLSAR_CAL_URL = `https://calendar.google.com/calendar/ical/${encodeURIComponent(BOLSAR_CAL_ID)}/public/basic.ics`;
const BOLSAR_TTL = 6 * 60 * 60 * 1000; // 6h
let bolsarCache = { fetchedAt: 0, events: null };

// Desescapa valores ICS: `\,` → `,`, `\;` → `;`, `\n` → LF, `\\` → `\`.
function unescapeICS(s) {
  return String(s).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

// Parser mínimo de VEVENTs. El ICS envuelve líneas largas con `\r\n ` (folding).
function parseICS(text) {
  // Unfold líneas: CRLF + espacio/tab continúa la línea previa.
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; }
    else if (cur) {
      // clave con params: e.g. DTSTART;VALUE=DATE:20251225
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const rawKey = line.slice(0, idx);
      const value = line.slice(idx + 1);
      const key = rawKey.split(';')[0].toUpperCase();
      if (key === 'DTSTART' || key === 'DTEND') {
        // Formato: YYYYMMDD o YYYYMMDDTHHMMSSZ
        const m = value.match(/^(\d{4})(\d{2})(\d{2})/);
        cur[key] = m ? `${m[1]}-${m[2]}-${m[3]}` : value;
      } else if (key === 'SUMMARY') {
        cur.SUMMARY = unescapeICS(value);
      }
    }
  }
  return events;
}

// Clasifica un SUMMARY y extrae tickers. Separadores observados: `;` (luego
// del unescape) y `,`. Algunos summaries vienen con espacios dobles.
function classifySummary(summary) {
  const s = String(summary || '').trim();
  const lower = s.toLowerCase();

  if (lower.startsWith('feriado')) return { kind: 'feriado', tickers: [], label: s };
  if (lower.includes('vencimiento')) return { kind: 'vencimiento', tickers: [], label: s };

  // Detecta tipo de pago.
  let kind = 'otro';
  if (/amortizaci[oó]n/i.test(s))     kind = 'amortizacion';
  else if (/renta/i.test(s))          kind = 'renta';
  else if (/dividendo/i.test(s))      kind = 'dividendo';

  // Extrae la parte después del separador (– / - / :).
  const sep = s.search(/[–\-:]/);
  const tail = sep >= 0 ? s.slice(sep + 1) : '';
  const tickers = tail
    .split(/[;,]/)
    .map(t => t.trim().toUpperCase())
    .filter(t => t && /^[A-Z0-9.]+$/.test(t) && t.length <= 10);

  return { kind, tickers, label: s };
}

async function fetchBolsarICS() {
  // Caché en memoria.
  if (bolsarCache.events && Date.now() - bolsarCache.fetchedAt < BOLSAR_TTL) {
    return bolsarCache.events;
  }
  const res = await fetch(BOLSAR_CAL_URL);
  if (!res.ok) throw new Error(`Bolsar ICS ${res.status}`);
  const text = await res.text();
  const raw = parseICS(text);
  const out = [];
  for (const ev of raw) {
    const date = ev.DTSTART;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const { kind, tickers, label } = classifySummary(ev.SUMMARY);
    // Para feriados sin tickers, emitimos un evento con `tickers: []`.
    // Para pagos sin tickers parseados, emitimos igual (fallback al label).
    out.push({ date, kind, tickers, label });
  }
  bolsarCache = { fetchedAt: Date.now(), events: out };
  return out;
}

app.get('/api/bolsar/calendar', async (req, res) => {
  try {
    const events = await fetchBolsarICS();
    const from = req.query.from;
    const to = req.query.to;
    const filtered = events.filter(e => {
      if (from && e.date < from) return false;
      if (to   && e.date > to)   return false;
      return true;
    });
    res.json({ events: filtered, fetchedAt: bolsarCache.fetchedAt });
  } catch (e) {
    res.status(500).json({ error: e.message, events: [] });
  }
});

app.post('/api/bolsar/cache/clear', (req, res) => { bolsarCache = { fetchedAt: 0, events: null }; res.json({ ok: true }); });

// ══════════════════════════════════════════════
//  PPI · SearchInstrument (fuente única de identidad)
//  Endpoint confirmado: /api/1.0/MarketData/SearchInstrument?ticker=X&type=X
//  Devuelve: ticker, description, type, market, currency
//
//  PPI NO expone endpoints públicos para lista de FCI, portfolio de FCI,
//  tipo de fondo, mínimo de suscripción ni manager. Esos datos se
//  capturan como input manual en el cliente (AssetPicker).
// ══════════════════════════════════════════════
const DESC_TTL = 60 * 60 * 1000; // 1 hora

// Raw fetch — nunca tira; útil para diagnósticos donde queremos status crudo.
async function ppiFetchRaw(path, opts = {}) {
  const url = new URL(path, PPI_BASE).toString();
  try {
    const { status, data } = await httpJson(url, {
      method: opts.method || 'GET',
      headers: opts.headers,
      body: opts.body,
      timeoutMs: opts.timeoutMs ?? 10000,
      retries: 0,           // raw = sin retry, queremos ver el primer status
      parseAs: 'text',      // no asumimos JSON
    });
    let parsed = null;
    try { parsed = data ? JSON.parse(data) : null; } catch {}
    return { status, data: parsed, body: data || '' };
  } catch (err) {
    if (err instanceof HttpError && err.kind === 'http') {
      return { status: err.status, data: null, body: '' };
    }
    return { status: 0, data: null, body: '', error: err.message };
  }
}

// Mapeo tipo interno (app) → tipo PPI (SearchInstrument).
// PPI solo acepta: BONOS, LETRAS, ON, ACCIONES, CEDEARS, FCI, CAUCIONES, OPCIONES, FUTUROS, ETF, NOBAC, LEBAC.
// Nuestros BONOS_PUBLICOS / BONOS_CORP mapean a BONOS (PPI no distingue soberano vs subsoberano en la identidad).
const PPI_TYPE_MAP = {
  BONOS_PUBLICOS: 'BONOS',
  BONOS_CORP: 'BONOS',
  // El resto es idéntico: ON, LETRAS, ACCIONES, CEDEARS, FCI, ETF, CAUCIONES, etc.
};
function mapToPpiType(t) { return PPI_TYPE_MAP[t] || t; }

// Fuente de identidad única para cualquier instrumento. Cachea por (ticker, type).
// Estrategia: primero intenta con type mapeado; si falla o no encuentra, cae a búsqueda sin type.
async function searchInstrument(ticker, type) {
  const T = String(ticker).toUpperCase();
  const ppiType = type ? mapToPpiType(type) : null;
  const key = `search|${T}|${ppiType || ''}`;
  const cached = getCached(key);
  if (cached !== null && cached !== undefined) return cached;

  // Atajo de una query: primero typed, si no, ticker-only.
  const attempts = [];
  if (ppiType) attempts.push({ label: ppiType, qs: new URLSearchParams({ ticker: T, type: ppiType }) });
  attempts.push({ label: '*', qs: new URLSearchParams({ ticker: T }) });

  for (const { label, qs } of attempts) {
    const path = `/api/${PPI_V}/MarketData/SearchInstrument?${qs}`;
    const r = await ppiFetchRaw(path, { headers: ppiH() });
    if (r.status === 200 && r.data != null) {
      const arr = Array.isArray(r.data) ? r.data : (r.data.data || r.data.instruments || [r.data]);
      const match = arr.find(x => String(x.ticker || x.symbol || x.code || '').toUpperCase() === T) || arr[0] || null;
      if (match) {
        const desc = match.description || match.name || match.denomination || '—';
        console.log(`[PPI] search ${T}/${label} → "${desc}"`);
        setCache(key, match, DESC_TTL);
        return match;
      }
      const preview = (r.body || '').slice(0, 160).replace(/\s+/g, ' ');
      console.log(`[PPI] search ${T}/${label} → HTTP 200 pero sin match · body: ${preview}`);
    } else {
      const preview = (r.body || '').slice(0, 120).replace(/\s+/g, ' ');
      console.log(`[PPI] search ${T}/${label} → HTTP ${r.status} ${preview}`);
    }
  }
  // Todos los intentos fallaron → miss
  setCache(key, null, 10 * 60 * 1000);
  return null;
}

async function fetchInstrumentDescription(ticker, type) {
  const info = await searchInstrument(ticker, type);
  if (!info) return null;
  return info.description || info.name || info.longName || info.denomination || info.shortDescription || null;
}

// FCI: PPI solo expone nombre + moneda vía SearchInstrument.
// El resto (tipo de fondo, mínimo, composición) es input manual en el cliente.
async function fetchFciInfo(ticker) {
  const T = String(ticker).toUpperCase();
  const info = await searchInstrument(T, 'FCI');
  if (!info) {
    return { found: false, ticker: T, type: 'FCI', error: `FCI "${T}" no encontrado en PPI (SearchInstrument no devolvió resultados).` };
  }
  const name = info.description || info.name || info.denomination || info.fundName || T;
  return {
    found: true,
    ticker: T,
    type: 'FCI',
    price: null,
    variation: null,
    currency: info.currency || info.denominationCurrency || info.fundCurrency || null,
    description: name,
    fci: {
      name,
      // PPI no expone estos campos → el asesor los ingresa manualmente en el AssetPicker.
      fundType: null,
      horizon: null,
      profile: null,
      minInvestment: null,
      manager: null,
      portfolio: [],
    },
    snapshot_at: new Date().toISOString(),
  };
}

// Endpoint FCI: resuelve identidad (nombre + moneda) vía SearchInstrument.
app.get('/api/ppi/fci/info', async (req, res) => {
  try {
    await getPPIToken();
    const { ticker } = req.query;
    if (!ticker) return res.status(400).json({ error: 'ticker required' });
    const r = await fetchFciInfo(String(ticker).toUpperCase());
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lista de FCI: PPI no expone endpoint público → devolvemos vacío.
// El cliente resuelve nombre/moneda por ticker directo vía /api/ppi/fci/info.
app.get('/api/ppi/fci/list', async (req, res) => {
  res.json([]);
});

// ══════════════════════════════════════════════
//  PPI · universal asset info (Propuestas)
//  Solo identidad vía SearchInstrument: ticker + descripción + moneda + tipo.
//  Sin precio, sin TIR/MD — para la sección Propuestas alcanza con eso.
// ══════════════════════════════════════════════
async function fetchAssetInfo(ticker, type, settlement = 'A-24HS') {
  if (type === 'FCI') return fetchFciInfo(ticker);

  const info = await searchInstrument(ticker, type);
  if (!info) {
    return { found: false, ticker: String(ticker).toUpperCase(), type, settlement, error: 'No encontrado en PPI (SearchInstrument)' };
  }
  return {
    found: true,
    ticker: String(ticker).toUpperCase(),
    type,
    settlement,
    description: info.description || info.name || info.longName || info.denomination || null,
    currency: info.currency || info.denominationCurrency || null,
    snapshot_at: new Date().toISOString(),
  };
}

app.get('/api/ppi/asset/info', async (req, res) => {
  try {
    await getPPIToken();
    const { ticker, type, settlement } = req.query;
    if (!ticker || !type) return res.status(400).json({ error: 'ticker and type required' });
    const r = await fetchAssetInfo(String(ticker).toUpperCase(), type, settlement || 'A-24HS');
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ppi/asset/batch', async (req, res) => {
  try {
    await getPPIToken();
    const { items } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items required' });
    const tasks = items.map(it => () => fetchAssetInfo(String(it.ticker).toUpperCase(), it.type, it.settlement || 'A-24HS').catch(e => ({ ticker: it.ticker, type: it.type, found: false, error: e.message })));
    const results = await ppiConcurrent(tasks);
    res.json(results.map((r, i) => r.status === 'fulfilled' ? r.value : (r.value || { ticker: items[i].ticker, type: items[i].type, found: false, error: r.reason?.message })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════
//  PRIMARY API (WebSocket for tipo de cambio)
// ══════════════════════════════════════════════
const TK = ['AL30', 'AL30D', 'AL30C'];
let authToken = null, primaryWs = null, latestData = {}, resolved = [], symMap = {};
let allInstruments = [];
// Plazo con el que quedó suscripto cada ticker FX ('CI', '24hs', ...). Se
// expone en /api/market/status para que la UI lo muestre y se note al toque
// si alguna vez dejamos de estar en contado inmediato.
let fxSettlement = {};

// ── Cauciones en pesos ──
// En Primary son instrumentos propios: "MERV - XMEV - PESOS - <N>D". Se
// suscriben por WS igual que los bonos; el precio que publican ES la tasa
// (TNA %), no un precio en pesos.
const CAUCION_PLAZOS = [1, 7, 14, 30];
const caucionKey = (d) => `CAUCION${d}`;

// Settlement aliases: app-facing → Primary symbol suffix
const SETTLEMENT_MAP = { 'A-24HS': '24hs', 'A-48HS': '48hs', 'INMEDIATA': 'CI', 'CI': 'CI', '24HS': '24hs', '48HS': '48hs' };

// Primary REST GET — usa httpJson con timeout 10s + 1 retry.
async function fetchJSON(path) {
  const url = new URL(path, PRIMARY_REST_URL).toString();
  const { data } = await httpJson(url, {
    method: 'GET',
    headers: { 'X-Auth-Token': authToken },
    timeoutMs: 10000,
    retries: 1,
  });
  return data;
}

// Auth contra Primary — el token llega en el response header 'x-auth-token'.
// Wrappeado con singleflight para que múltiples reconnects en paralelo
// no disparen N logins simultáneos contra Primary (race-condition #2 audit).
const authPrimary = singleflight(async () => {
  const url = new URL('/auth/getToken', PRIMARY_REST_URL).toString();
  const { headers } = await httpJson(url, {
    method: 'POST',
    headers: { 'X-Username': PRIMARY_USER, 'X-Password': PRIMARY_PASS },
    timeoutMs: 10000,
    retries: 1,
    parseAs: 'text',  // /auth/getToken puede devolver body vacío
  });
  const t = headers.get('x-auth-token');
  if (!t) throw new Error('Primary auth: x-auth-token header missing');
  authToken = t;
  console.log('✅ Primary auth ok');
  return t;
});

async function discover() {
  try {
    const d = await fetchJSON('/rest/instruments/all');
    if (d.status !== 'OK') return;
    allInstruments = Array.isArray(d.instruments) ? d.instruments : [];
    const al30 = allInstruments.filter(i => TK.some(k => (i.instrumentId?.symbol || '').includes(k)));
    resolved = []; symMap = {};
    fxSettlement = {};
    for (const k of TK) {
      // Contado inmediato explícito: el símbolo TERMINA en "- CI". El match
      // suelto anterior (includes('CI')) podía enganchar cualquier otra cosa,
      // y sobre todo caía a 24hs sin que nadie se enterara. Si no hay CI
      // seguimos con lo que haya, pero queda logueado y expuesto en la API.
      const ci    = al30.find(i => (i.instrumentId.symbol || '').match(new RegExp(`- ${k} - CI$`)));
      const otro  = al30.find(i => (i.instrumentId.symbol || '').includes(`- ${k} -`));
      const m = ci || otro;
      if (!m) { console.warn(`⚠️  ${k}: no se encontró ningún instrumento en Primary`); continue; }
      if (!ci) console.warn(`⚠️  ${k}: sin contado inmediato en Primary, usando ${m.instrumentId.symbol}`);
      resolved.push(m.instrumentId);
      symMap[m.instrumentId.symbol] = k;
      // Plazo real con el que quedó suscripto, para mostrarlo en la UI.
      fxSettlement[k] = (m.instrumentId.symbol.split(' - ').pop() || '').trim();
    }
    const plazos = TK.map(k => `${k}:${fxSettlement[k] || '?'}`).join(' ');

    // Cauciones en pesos a los plazos de referencia.
    let cauc = 0;
    for (const d of CAUCION_PLAZOS) {
      const sym = `MERV - XMEV - PESOS - ${d}D`;
      const m = allInstruments.find(i => i.instrumentId?.symbol === sym);
      if (!m) { console.warn(`⚠️  caución ${d}D: no está en el catálogo de Primary`); continue; }
      resolved.push(m.instrumentId);
      symMap[sym] = caucionKey(d);
      cauc++;
    }

    console.log(`📋 Instruments: ${allInstruments.length} total, ${resolved.length - cauc} AL30-series (${plazos}), ${cauc} cauciones`);
  } catch (e) { console.error('discover error:', e.message); }
}

function findInstrument(ticker, settlement) {
  if (!ticker) return null;
  const t = String(ticker).toUpperCase();
  const s = SETTLEMENT_MAP[settlement] || settlement || '24hs';
  // Match "- TICKER -" and trailing "- SETTLEMENT"
  const exact = allInstruments.find(i => {
    const sym = i.instrumentId?.symbol || '';
    return sym.includes(`- ${t} -`) && (sym.endsWith(`- ${s}`) || sym.endsWith(` ${s}`));
  });
  if (exact) return exact;
  // Fallback: looser match
  return allInstruments.find(i => {
    const sym = i.instrumentId?.symbol || '';
    return sym.includes(` ${t} `) && sym.toLowerCase().includes(s.toLowerCase());
  }) || null;
}

function subscribeDynamic(ticker, settlement) {
  const inst = findInstrument(ticker, settlement);
  if (!inst) return { ok: false, error: 'Ticker no encontrado en Primary' };
  const key = `${String(ticker).toUpperCase()}|${settlement}`;
  if (symMap[inst.instrumentId.symbol]) return { ok: true, symbol: key, already: true };
  symMap[inst.instrumentId.symbol] = key;
  resolved.push(inst.instrumentId);
  if (primaryWs?.readyState === WebSocket.OPEN) {
    try {
      primaryWs.send(JSON.stringify({
        type: 'smd', level: 1,
        entries: ['BI','OF','LA','CL','HI','LO','TV','OI','EV','NV'],
        products: [{ symbol: inst.instrumentId.symbol, marketId: inst.instrumentId.marketId }],
        depth: 1,
      }));
    } catch (e) { console.error('smd send:', e.message); }
  }
  console.log(`📡 Subscribed: ${key} (${inst.instrumentId.symbol})`);
  return { ok: true, symbol: key, primarySymbol: inst.instrumentId.symbol };
}

// ── WS heartbeat: si Primary deja de mandar bytes, ping/pong nos avisa ──
let primaryHeartbeat = null;
function startPrimaryHeartbeat() {
  if (primaryHeartbeat) clearInterval(primaryHeartbeat);
  primaryHeartbeat = setInterval(() => {
    if (!primaryWs || primaryWs.readyState !== WebSocket.OPEN) return;
    if (primaryWs.isAlive === false) {
      // No respondió al ping anterior → reconnect.
      console.warn('⚠️ Primary WS no respondió ping, terminando…');
      try { primaryWs.terminate(); } catch {}
      return;
    }
    primaryWs.isAlive = false;
    try { primaryWs.ping(); } catch {}
  }, 30000);
}

function connectPrimary() {
  if (!authToken) return;
  primaryWs = new WebSocket(`${PRIMARY_WS_URL}/`, [], { headers: { 'X-Auth-Token': authToken } });
  primaryWs.isAlive = true;
  primaryWs.on('open', () => {
    console.log('✅ Primary WS connected');
    if (resolved.length) primaryWs.send(JSON.stringify({
      type: 'smd', level: 1,
      entries: ['BI','OF','LA','CL','HI','LO','TV','OI','EV','NV'],
      products: resolved.map(i => ({ symbol: i.symbol, marketId: i.marketId })),
      depth: 1,
    }));
    startPrimaryHeartbeat();
  });
  primaryWs.on('pong', () => { primaryWs.isAlive = true; });
  primaryWs.on('message', raw => {
    try {
      const m = JSON.parse(raw.toString());
      if (m.type === 'Md') {
        const s = symMap[m.instrumentId?.symbol] || m.instrumentId?.symbol;
        // Merge en lugar de reemplazar: Primary suele mandar refresheos
        // incrementales (sólo los entries que cambiaron). Si reemplazáramos,
        // un update con sólo CL borraría BI/OF y las cards quedarían "SIN
        // DATOS" post-cierre. Con merge, los últimos BI/OF/LA conocidos
        // sobreviven hasta que Primary mande explícitamente otros valores.
        const prevMd = latestData[s]?.marketData || {};
        const mergedMd = { ...prevMd, ...m.marketData };
        latestData[s] = { symbol: s, marketData: mergedMd, timestamp: Date.now() };
        // Mandamos al cliente sólo el delta — el cliente hace su propio merge
        // (en useMarketData), así nuevos navegadores reciben el estado completo
        // vía 'snapshot' y los ya conectados aplican incrementales.
        const p = JSON.stringify({ type: 'md_update', symbol: s, marketData: m.marketData, timestamp: Date.now() });
        wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(p); });
      }
    } catch {}
  });
  primaryWs.on('close', () => {
    if (primaryHeartbeat) { clearInterval(primaryHeartbeat); primaryHeartbeat = null; }
    setTimeout(reconnect, 5000);
  });
  primaryWs.on('error', e => { console.warn('Primary WS error:', e.message); });
}

async function reconnect() { try { await authPrimary(); await discover(); connectPrimary(); setTimeout(resubscribeAllTrades, 3000); } catch { setTimeout(reconnect, 10000); } }

async function resubscribeAllTrades() {
  try {
    const trades = await supa('/trades?select=ticker,settlement');
    if (!Array.isArray(trades)) return;
    const uniq = new Map();
    trades.forEach(t => { const k = `${t.ticker}|${t.settlement || 'A-24HS'}`; uniq.set(k, { ticker: t.ticker, settlement: t.settlement || 'A-24HS' }); });
    for (const { ticker, settlement } of uniq.values()) subscribeDynamic(ticker, settlement);
    console.log(`🔁 Resubscribed ${uniq.size} trade tickers`);
  } catch (e) { console.error('Resubscribe trades:', e.message); }
}

// Browser WS clients — heartbeat ping/pong para detectar conexiones zombi
// (típico cuando el cliente cierra el laptop o cambia de red).
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const snap = Object.values(latestData);
  if (snap.length) ws.send(JSON.stringify({ type: 'snapshot', data: snap }));
  ws.send(JSON.stringify({ type: 'status', connected: primaryWs?.readyState === WebSocket.OPEN, tickers: TK }));

  // Si la data está stale (más de 60s sin update durante mercado abierto)
  // y el WS Primary dice OPEN, asumimos zombie y forzamos reconnect.
  // Soluciona el caso típico de "después de cold-start de Render": el WS
  // reconectó pero la subscripción smd se perdió, y nos quedamos sin Md
  // hasta que alguien entra a la app y dispara este check.
  if (isMarketOpen() && primaryWs?.readyState === WebSocket.OPEN) {
    const now = Date.now();
    const allStale = TK.every(t => {
      const ts = latestData[t]?.timestamp;
      return !ts || (now - ts) > 60_000;
    });
    if (allStale) {
      console.warn('⚠️  Browser conectó con data stale (>60s) — forzando reconnect Primary');
      try { primaryWs.close(); } catch {}
    }
  }
});

const browserHeartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch {}
      return;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, 30000);
wss.on('close', () => clearInterval(browserHeartbeat));

app.get('/api/health', (req, res) => res.json({ status: 'ok', primary: primaryWs?.readyState === WebSocket.OPEN, supabase: !!SUPA_URL, commit: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null }));

// Diagnóstico del estado del WS Primary y antigüedad del último Md por ticker.
// Útil para detectar "WS zombie": readyState=OPEN pero Primary no manda Md.
app.get('/api/diag/primary', (req, res) => {
  const now = Date.now();
  const states = ['CONNECTING','OPEN','CLOSING','CLOSED'];
  const tickers = {};
  for (const [sym, k] of Object.entries(symMap)) {
    const d = latestData[k];
    const lastMd = d?.timestamp || null;
    tickers[k] = {
      primarySymbol: sym,
      lastMdAt: lastMd ? new Date(lastMd).toISOString() : null,
      ageSeconds: lastMd ? Math.round((now - lastMd) / 1000) : null,
      hasBid: d?.marketData?.BI != null,
      hasOffer: d?.marketData?.OF != null,
      hasLast: d?.marketData?.LA != null,
    };
  }
  res.json({
    wsState: primaryWs ? states[primaryWs.readyState] : 'NONE',
    isAlive: primaryWs?.isAlive ?? null,
    resolvedCount: resolved.length,
    instrumentsLoaded: allInstruments.length,
    browserClients: wss?.clients?.size || 0,
    tickers,
  });
});

// Forzar reconexión del WS de Primary (cierra y deja que el handler de close
// re-autentique + re-suscriba). Útil para destrabar WS zombies sin redeploy.
app.post('/api/diag/primary/reconnect', (req, res) => {
  try {
    if (primaryWs && primaryWs.readyState === WebSocket.OPEN) {
      primaryWs.close();
      res.json({ ok: true, action: 'closed (reconnect en 5s)' });
    } else {
      reconnect();
      res.json({ ok: true, action: 'reconnect disparado' });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Watchdog: si pasamos >60s sin recibir Md durante mercado abierto, asumimos
// que el WS está zombi (readyState dice OPEN pero Primary no manda nada) y
// forzamos reconnect. Pasa típicamente tras un cold-start de Render o si
// Primary cortó la sesión sin avisar. Chequeo cada 20s.
const MD_STALE_THRESHOLD_MS = 60_000;
let lastZombieReconnectAt = 0;
setInterval(() => {
  if (!isMarketOpen()) return;
  if (!primaryWs || primaryWs.readyState !== WebSocket.OPEN) return;
  const now = Date.now();
  // Cooldown: no disparar reconnect más de 1 vez cada 60s (evita storm si el
  // reconnect en sí tarda).
  if (now - lastZombieReconnectAt < 60_000) return;
  const fresh = TK.some(t => {
    const ts = latestData[t]?.timestamp;
    return ts && (now - ts) < MD_STALE_THRESHOLD_MS;
  });
  if (!fresh) {
    const ages = TK.map(t => {
      const ts = latestData[t]?.timestamp;
      return `${t}:${ts ? Math.round((now - ts) / 1000) + 's' : 'n/a'}`;
    }).join(' ');
    console.warn(`⚠️  WS Primary zombie (mercado abierto, sin Md en 60s) — forzando reconnect. Ages: ${ages}`);
    lastZombieReconnectAt = now;
    try { primaryWs.close(); } catch {}
  }
}, 20_000);

// Primary instrument validation + subscription
app.get('/api/primary/validate', (req, res) => {
  const { ticker, settlement = 'A-24HS' } = req.query;
  if (!ticker) return res.status(400).json({ valid: false, error: 'ticker required' });
  if (!allInstruments.length) return res.json({ valid: false, error: 'Instruments not loaded yet' });
  const inst = findInstrument(String(ticker).toUpperCase(), settlement);
  if (!inst) return res.json({ valid: false });
  res.json({ valid: true, symbol: inst.instrumentId.symbol, marketId: inst.instrumentId.marketId });
});

app.post('/api/primary/subscribe', (req, res) => {
  const { ticker, settlement = 'A-24HS' } = req.body || {};
  if (!ticker) return res.status(400).json({ error: 'ticker required' });
  res.json(subscribeDynamic(String(ticker).toUpperCase(), settlement));
});

// ══════════════════════════════════════════════
//  HORARIO DE MERCADO + PERSISTENCIA DE SNAPSHOT
//
//  Problema: Primary deja de mandar `Md` fuera de horario. Mientras el server
//  esté vivo, `latestData` mantiene el último valor recibido (cierre). Pero si
//  el server se reinicia (deploy, crash) durante off-hours, latestData queda
//  vacío y el browser no ve nada hasta el próximo open.
//
//  Solución: persistimos `latestData` en Supabase (tabla settings, key
//  `fx_market_snapshot`) cada N segundos en horario, y lo restauramos al boot.
//  Así, si arrancás un domingo, el browser igual ve los precios de cierre del
//  viernes.
// ══════════════════════════════════════════════

// Mercado argentino (BYMA) — lunes a viernes, 10:25 a 17:05 hora local AR.
// Usamos Intl.DateTimeFormat con timeZone para que funcione independientemente
// del TZ del host (Render corre en UTC).
const MARKET_TZ = 'America/Argentina/Buenos_Aires';
const MARKET_OPEN_MIN  = 10 * 60 + 25; // 10:25
const MARKET_CLOSE_MIN = 17 * 60 + 5;  // 17:05

function getBuenosAiresParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MARKET_TZ,
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const part = (t) => fmt.find(p => p.type === t)?.value;
  return {
    weekday: part('weekday'),    // 'Mon' .. 'Sun'
    hour:    parseInt(part('hour'), 10),
    minute:  parseInt(part('minute'), 10),
  };
}

function isMarketOpen(now = new Date()) {
  const { weekday, hour, minute } = getBuenosAiresParts(now);
  if (!['Mon','Tue','Wed','Thu','Fri'].includes(weekday)) return false;
  const m = hour * 60 + minute;
  return m >= MARKET_OPEN_MIN && m <= MARKET_CLOSE_MIN;
}

function marketStatusPayload(now = new Date()) {
  const { weekday, hour, minute } = getBuenosAiresParts(now);
  const open = isMarketOpen(now);
  const m = hour * 60 + minute;
  const isWeekday = ['Mon','Tue','Wed','Thu','Fri'].includes(weekday);
  let reason = null;
  if (!open) {
    if (!isWeekday) reason = 'fin_de_semana';
    else if (m < MARKET_OPEN_MIN)  reason = 'pre_apertura';
    else if (m > MARKET_CLOSE_MIN) reason = 'post_cierre';
  }
  return {
    open,
    reason,                                  // null si está abierto
    timezone: MARKET_TZ,
    nowAR: `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`,
    weekday,
    sessionStart: '10:25',
    sessionEnd:   '17:05',
    // Plazo real de los tickers FX ({ AL30: 'CI', ... }). La UI lo muestra
    // para que se vea a simple vista si estamos en contado inmediato.
    fxSettlement,
  };
}

// ── Cauciones en pesos ──
// Devuelve la tasa de la última operación (TNA %) por plazo. Primary publica
// la tasa en el campo de precio, así que LA es directamente la tasa operada.
app.get('/api/cauciones', (req, res) => {
  const items = CAUCION_PLAZOS.map(d => {
    const k = caucionKey(d);
    const md = latestData[k]?.marketData || null;
    const tasa = extractPrice(k, 'LA');
    return {
      plazo: d,
      tasa: Number.isFinite(tasa) ? tasa : null,
      volumen: md?.TV?.size ?? md?.TV ?? null,
      updatedAt: latestData[k]?.timestamp || null,
      suscripto: !!latestData[k],
    };
  });
  res.json({ items, marketOpen: isMarketOpen() });
});

// ── Persistencia (Supabase / settings) ──
const SNAPSHOT_KEY = 'fx_market_snapshot';

async function saveMarketSnapshot(reason = 'periodic') {
  if (!Object.keys(latestData).length) return;
  const payload = {
    savedAt:  Date.now(),
    savedReason: reason,
    marketOpen: isMarketOpen(),
    data: latestData,        // { AL30: {...}, AL30D: {...}, AL30C: {...}, ... }
  };
  try {
    const existing = await supa(`/settings?key=eq.${SNAPSHOT_KEY}`);
    if (Array.isArray(existing) && existing.length) {
      await supa(`/settings?key=eq.${SNAPSHOT_KEY}`, {
        method: 'PATCH',
        body: { value: payload, updated_at: new Date().toISOString() },
      });
    } else {
      await supa('/settings', {
        method: 'POST',
        body: { key: SNAPSHOT_KEY, value: payload },
      });
    }
  } catch (e) {
    console.warn('[snapshot] save fallo:', e.message);
  }
}

async function loadMarketSnapshot() {
  try {
    const data = await supa(`/settings?key=eq.${SNAPSHOT_KEY}`);
    if (!Array.isArray(data) || !data[0]?.value?.data) return;
    const snap = data[0].value;
    Object.assign(latestData, snap.data);
    const tickers = Object.keys(snap.data).join(', ');
    const ageH = ((Date.now() - snap.savedAt) / 3_600_000).toFixed(1);
    console.log(`💾 Snapshot restaurado: [${tickers}] · guardado hace ${ageH}h (${snap.savedReason})`);
  } catch (e) {
    console.warn('[snapshot] load fallo:', e.message);
  }
}

// Save periódico cada 60s. Sólo escribimos cuando el mercado está abierto
// (durante off-hours los datos no cambian y sería gasto al pedo de DB writes).
// Excepción: el primer save fuera de horario después del cierre — para no
// perder la actualización justo del cierre, hacemos un "save final" cada vez
// que detectamos transición open→close.
//
// Mismo tick aprovechamos para guardar el cierre diario en `daily_fx_closes`:
//   - Transición open→close → 1 save (es el momento canónico del cierre).
//   - Si arrancamos post-close y no guardamos hoy todavía → catch-up en el
//     próximo tick mientras `latestData` esté fresco (ver maybeSaveFxClose).
let lastMarketOpen = false;
const SNAPSHOT_PERIODIC_MS = 60_000;
setInterval(() => {
  const open = isMarketOpen();
  // Fotos de apertura (10:35) y cierre (16:55) para el gráfico de evolución.
  maybeSnapFx();
  if (open) {
    saveMarketSnapshot('periodic');
  } else if (lastMarketOpen) {
    // Justo cerró el mercado → forzar save final con el último estado.
    saveMarketSnapshot('post_cierre');
    // FX daily close: idempotente, así que es seguro fire-and-forget.
    maybeSaveFxClose('on_close_transition');
  } else {
    // Mercado cerrado y sin transición. Si arrancamos el server post-cierre
    // (deploy/restart), todavía no guardamos hoy y `latestData` es fresco
    // (gracias al snapshot persistido en `settings`), tiramos un save de
    // catch-up. `maybeSaveFxClose` hace el guard de día y de freshness, así
    // que en feriados o sin data simplemente no escribe.
    const { weekday, hour, minute } = getBuenosAiresParts();
    const isWeekday = ['Mon','Tue','Wed','Thu','Fri'].includes(weekday);
    const m = hour * 60 + minute;
    if (isWeekday && m > MARKET_CLOSE_MIN) {
      maybeSaveFxClose('post_close_catchup');
    }
  }
  lastMarketOpen = open;
}, SNAPSHOT_PERIODIC_MS);

app.get('/api/market/status', (req, res) => {
  res.json(marketStatusPayload());
});

// ══════════════════════════════════════════════
//  FX DAILY CLOSES — auto-save a Supabase
//
//  Estrategia "óptima" (1 escritura por rueda):
//    1. Al detectar transición open→close en el scheduler de snapshots (que
//       ya corre cada 60s), llamamos a maybeSaveFxClose('on_close').
//    2. Si el server arranca DESPUÉS del cierre (deploy/restart post-17:05) y
//       todavía no guardamos hoy, hacemos un "catch-up" en el siguiente tick.
//    3. Idempotencia:
//        - Flag in-memory `lastFxSaveDate` evita reintentos en el mismo proceso.
//        - El upsert en BDD evita duplicados si dos procesos guardan a la vez.
//    4. Antifaz para feriados / WS caído: requerimos que `latestData` tenga
//       timestamp del día AR. Si BYMA estuvo cerrado todo el día, no hay
//       updates frescos y SKIPPEAMOS el save (evitamos cargar una fila con
//       precios de la rueda anterior).
//    5. Fecha en zona AR (no UTC) — evita escribir el día equivocado en
//       transiciones nocturnas raras.
// ══════════════════════════════════════════════

function extractPrice(sym, entry) {
  const d = latestData[sym];
  if (!d?.marketData) return null;
  const md = d.marketData;
  if (entry === 'BI') return Array.isArray(md.BI) ? md.BI[0]?.price : md.BI?.price;
  if (entry === 'OF') return Array.isArray(md.OF) ? md.OF[0]?.price : md.OF?.price;
  if (entry === 'CL') return md.CL?.price ?? (Array.isArray(md.CL) ? md.CL[0]?.price : null);
  if (entry === 'LA') return md.LA?.price ?? (Array.isArray(md.LA) ? md.LA[0]?.price : null);
  return null;
}

// Día calendario en zona AR (YYYY-MM-DD). 'en-CA' formatea ISO-style por default.
function todayKeyAR(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// `latestData` está fresco si al menos 1 de los 3 tickers FX tiene timestamp
// del día AR de hoy. En feriados o caídas del WS, los timestamps quedan en
// días viejos (o vacíos al arrancar el server) → devolvemos false.
function isFxLatestDataFresh() {
  const today = todayKeyAR();
  for (const sym of ['AL30', 'AL30D', 'AL30C']) {
    const ts = latestData[sym]?.timestamp;
    if (Number.isFinite(ts) && todayKeyAR(new Date(ts)) === today) return true;
  }
  return false;
}

let lastFxSaveDate = null;

async function saveDailyFxClose(reason = 'manual') {
  try {
    const al30b = extractPrice('AL30', 'BI'),  al30o  = extractPrice('AL30', 'OF'),  al30c  = extractPrice('AL30', 'CL');
    const al30db = extractPrice('AL30D', 'BI'), al30do = extractPrice('AL30D', 'OF'), al30dc = extractPrice('AL30D', 'CL');
    const al30cb = extractPrice('AL30C', 'BI'), al30co = extractPrice('AL30C', 'OF'), al30cc = extractPrice('AL30C', 'CL');

    if (!al30b || !al30o || !al30db || !al30do || !al30cb || !al30co) {
      console.log(`⏳ FX save (${reason}): not enough data yet`);
      return { ok: false, reason: 'no_data' };
    }

    const today = todayKeyAR();
    // Bid/offer ya no se almacenan (son parte del book momentáneo, no del cierre).
    // Los seguimos usando *transitoriamente* para computar mep_compra/venta y
    // ccl_compra/venta — buy-side al offer, sell-side al bid — pero sólo el
    // resultado calculado (y los CL) van a parar a la fila.
    // Los *_close los escribe la foto de las 16:55 con el último operado.
    // Acá sólo los completamos si esa foto no salió (server caído a esa hora,
    // o ningún trade en los tres bonos) — así la fila nunca queda sin cierre.
    const cierreYaTomado = lastFxCloseSnapDate === today;
    const row = {
      date: today,
      ...(cierreYaTomado ? {} : {
        al30_close:  al30c,
        al30d_close: al30dc,
        al30c_close: al30cc,
      }),
      mep_compra:   al30o  / al30db,
      mep_venta:    al30b  / al30do,
      ccl_compra:   al30o  / al30cb,
      ccl_venta:    al30b  / al30co,
      canje_compra: (al30cb / al30do) - 1,
      canje_venta:  (al30db / al30co) - 1,
    };

    // Upsert (insert or patch si la fecha ya existe).
    const existing = await supa(`/daily_fx_closes?date=eq.${today}`);
    if (Array.isArray(existing) && existing.length > 0) {
      await supa(`/daily_fx_closes?date=eq.${today}`, { method: 'PATCH', body: row });
    } else {
      await supa('/daily_fx_closes', { method: 'POST', body: row });
    }
    lastFxSaveDate = today;
    console.log(`💾 FX saved (${reason}): ${today} MEP ${row.mep_compra.toFixed(2)} / CCL ${row.ccl_compra.toFixed(2)}`);
    return { ok: true, date: today, mep: row.mep_compra, ccl: row.ccl_compra };
  } catch (e) {
    console.error('❌ FX save error:', e.message);
    return { ok: false, reason: 'error', error: e.message };
  }
}

// Wrapper idempotente: 1 save por día calendario AR, exigiendo data fresca.
// ── Fotos de apertura y cierre (último operado) ──
//
// El gráfico de evolución no usa el cierre de la rueda ni un mid sintético:
// toma dos fotos del ÚLTIMO OPERADO, a 10 minutos de la apertura y a 10
// minutos del cierre. En esas dos ventanas el book ya está armado y el
// precio es representativo; en los bordes de la rueda no.
const FX_OPEN_SNAP_MIN  = 10 * 60 + 35; // 10:35 (abre 10:25)
const FX_CLOSE_SNAP_MIN = 16 * 60 + 55; // 16:55 (cierra 17:05)

let lastFxOpenSnapDate  = null;
let lastFxCloseSnapDate = null;

// Guarda en la fila del día las columnas que se le pasen, sin pisar el resto.
async function upsertFxRow(today, fields) {
  const existing = await supa(`/daily_fx_closes?date=eq.${today}`);
  if (Array.isArray(existing) && existing.length > 0) {
    await supa(`/daily_fx_closes?date=eq.${today}`, { method: 'PATCH', body: fields });
  } else {
    await supa('/daily_fx_closes', { method: 'POST', body: { date: today, ...fields } });
  }
}

// `punta` ∈ 'open' | 'close'. Lee LA (último operado) de los tres bonos y
// escribe al30_open/al30d_open/al30c_open o los *_close correspondientes.
async function snapFxOperado(punta) {
  const today = todayKeyAR();
  const la = {
    al30:  extractPrice('AL30',  'LA'),
    al30d: extractPrice('AL30D', 'LA'),
    al30c: extractPrice('AL30C', 'LA'),
  };
  // Si algún bono no operó todavía, no escribimos una foto a medias: se
  // reintenta en el próximo tick mientras siga abierta la ventana.
  if (!la.al30 || !la.al30d || !la.al30c) {
    console.log(`⏳ FX ${punta}: sin último operado en los 3 bonos todavía`);
    return { ok: false, reason: 'no_trades' };
  }
  const sufijo = punta === 'open' ? '_open' : '_close';
  try {
    await upsertFxRow(today, {
      [`al30${sufijo}`]:  la.al30,
      [`al30d${sufijo}`]: la.al30d,
      [`al30c${sufijo}`]: la.al30c,
    });
    if (punta === 'open') lastFxOpenSnapDate = today; else lastFxCloseSnapDate = today;
    console.log(`📸 FX ${punta} ${today}: AL30 ${la.al30} · AL30D ${la.al30d} · AL30C ${la.al30c} (MEP ${(la.al30 / la.al30d).toFixed(2)})`);
    return { ok: true, date: today, ...la };
  } catch (e) {
    console.error(`❌ FX ${punta} save:`, e.message);
    return { ok: false, reason: 'error', error: e.message };
  }
}

// Se llama desde el tick de 60s. La ventana es de 10 minutos desde la hora
// objetivo: si el server estaba reiniciando justo a las 10:35, igual alcanza
// a tomar la foto. Una vez tomada, el flag de fecha no deja repetirla.
function maybeSnapFx() {
  const { weekday, hour, minute } = getBuenosAiresParts();
  if (!['Mon','Tue','Wed','Thu','Fri'].includes(weekday)) return;
  const m = hour * 60 + minute;
  const today = todayKeyAR();

  if (lastFxOpenSnapDate !== today && m >= FX_OPEN_SNAP_MIN && m < FX_OPEN_SNAP_MIN + 10) {
    snapFxOperado('open');
  }
  if (lastFxCloseSnapDate !== today && m >= FX_CLOSE_SNAP_MIN && m < FX_CLOSE_SNAP_MIN + 10) {
    snapFxOperado('close');
  }
}

// Disparo manual, para testear sin esperar a la hora.
app.post('/api/fx/snap/:punta', async (req, res) => {
  const punta = req.params.punta === 'open' ? 'open' : 'close';
  res.json(await snapFxOperado(punta));
});

// `force` saltea el guard de `lastFxSaveDate` (lo usa el endpoint manual).
async function maybeSaveFxClose(reason, { force = false } = {}) {
  const today = todayKeyAR();
  if (!force && lastFxSaveDate === today) return { ok: false, reason: 'already_saved' };
  if (!isFxLatestDataFresh()) {
    console.log(`⏸ FX save (${reason}): WS data stale (probablemente feriado o WS caído)`);
    return { ok: false, reason: 'stale_data' };
  }
  return saveDailyFxClose(reason);
}

// Manual save trigger (útil para testing y para forzar un save fuera del
// horario habitual). Acepta ?force=1 para saltear el flag de "ya guardamos hoy".
app.post('/api/fx/save', async (req, res) => {
  const force = req.query.force === '1' || req.body?.force === true;
  const result = await maybeSaveFxClose('manual', { force });
  res.json(result);
});

// GET historical FX data
app.get('/api/fx/history', async (req, res) => {
  try {
    const { from } = req.query;
    let path = '/daily_fx_closes?order=date.asc';
    if (from) path += `&date=gte.${from}`;
    path += '&limit=500';
    const data = await supa(path);
    res.json(Array.isArray(data) ? data : []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════
//  FX INTRADAY SAMPLES — sampler 5min alineado al reloj
//
//  Estrategia (v2 — usa REST en lugar de WS para el sample):
//   - Cada 5 min en wall-clock (10:25, 10:30, 10:35, ...) durante mercado
//     abierto, GET `/rest/marketdata/get` por cada uno de AL30/AL30D/AL30C,
//     extraemos LA (último operado) y guardamos a `intraday_fx_samples`.
//     Esto es más confiable que el WS para snapshots periódicos: siempre
//     trae el último precio cerrado por trade real (no mid sintético) y no
//     depende del estado de la conexión WS.
//   - Si REST falla por algún ticker, completamos el row con bid/offer del
//     WS (`latestData`) como fallback — así el row no se pierde.
//   - El primer save de un día nuevo (detectado por cambio de `lastIntraSaveDate`)
//     dispara un purge de TODOS los rows de fechas distintas a la de hoy.
//     Así arrancamos cada rueda "de cero" pero conservamos los samples del
//     último día de mercado durante fines de semana / feriados.
// ══════════════════════════════════════════════

const INTRA_SAMPLE_INTERVAL_MS = 5 * 60_000; // 5 min
let lastIntraSaveDate = null;

// Backoff por rate limit de Primary REST. Cuando recibimos 429, dejamos de
// llamar a REST por 1 hora — durante ese tiempo el sampler usa solamente
// el cache del WebSocket (que ya tiene LA en tiempo real, así que en la
// práctica no perdemos nada).
let restRateLimitedUntil = 0;
const REST_BACKOFF_MS = 60 * 60_000; // 1 hora

// Llamada REST a Primary para traer market data del símbolo dado. Devuelve
// el objeto `marketData` (mismo shape que el WS) o null si falla.
//
// Notas de encoding:
//  - Usamos encodeURIComponent en lugar de URLSearchParams porque algunas
//    instalaciones de Primary parsean estricto y no aceptan `+` para espacios
//    (URLSearchParams default) — sólo `%20`. Y para `entries` queremos que las
//    comas queden literales (no `%2C`).
//  - Si la respuesta no es JSON, logueamos un fragmento del body crudo para
//    poder diagnosticar (por ej. una página HTML de error de proxy / WAF).
async function fetchPrimaryMarketData(symbol, marketId = 'ROFX') {
  // Si el plan de Primary nos rate-limiteó hace poco, no volvemos a llamar
  // hasta que se cumpla el backoff. El sampler usará WS en su lugar.
  if (Date.now() < restRateLimitedUntil) return null;

  if (!authToken) {
    try { await authPrimary(); } catch { return null; }
  }
  const path = `/rest/marketdata/get`
    + `?marketId=${encodeURIComponent(marketId)}`
    + `&symbol=${encodeURIComponent(symbol)}`
    + `&entries=BI,OF,LA,CL`
    + `&depth=1`;
  const url = new URL(path, PRIMARY_REST_URL).toString();
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: { 'X-Auth-Token': authToken, 'Accept': 'application/json' },
    });
    const text = await r.text();
    // 429 = rate limit. Activamos backoff global de 1h y devolvemos null;
    // el sampler caerá al WS sin ruido.
    if (r.status === 429) {
      restRateLimitedUntil = Date.now() + REST_BACKOFF_MS;
      console.warn(`[intra] REST rate-limited (429); usando sólo WebSocket por 1h`);
      return null;
    }
    if (!r.ok) {
      console.warn(`[intra] REST ${r.status} for ${symbol}: ${text.slice(0, 160)}`);
      return null;
    }
    let d;
    try { d = JSON.parse(text); }
    catch {
      console.warn(`[intra] non-JSON for ${symbol} (${r.status}): ${text.slice(0, 160)}`);
      return null;
    }
    if (d?.status === 'OK' && d.marketData) return d.marketData;
    // Status no-OK: logueamos pero no como warning ruidoso (sucede cuando no
    // hubo trade aún en el día, p.ej.).
    if (d?.status && d.status !== 'OK') {
      console.log(`[intra] REST status=${d.status} for ${symbol}: ${d.description || ''}`);
    }
    return null;
  } catch (e) {
    console.warn(`[intra] REST fetch fail for ${symbol}:`, e.message);
    return null;
  }
}

// Extrae LA / BI / OF de un payload de marketData (sirve tanto para REST como WS).
function extractFromMd(md, entry) {
  if (!md) return null;
  const v = md[entry];
  if (!v) return null;
  if (Array.isArray(v)) return v[0]?.price ?? null;
  return v.price ?? null;
}

// Devuelve el símbolo Primary completo (ej. "MERV - XMEV - AL30 - CI") para
// uno de nuestros tickers cortos (AL30/AL30D/AL30C). Lo sacamos del symMap
// inverso ya construido en `discover()`.
function primarySymbolFor(shortTicker) {
  for (const [primarySym, k] of Object.entries(symMap)) {
    if (k === shortTicker) return primarySym;
  }
  return null;
}

async function saveIntraFxSample() {
  try {
    if (!isMarketOpen()) return { ok: false, reason: 'market_closed' };

    // Estrategia v4: precio = MID(bid, offer) si hay puntas vivas, sino LA.
    // Antes usaba sólo LA, pero LA no se mueve si no hubo trades nuevos en
    // la rueda — y AL30/D/C pueden quedar horas sin operar — lo que producía
    // un gráfico plano de "evolución". El mid de las puntas refleja el
    // movimiento real-time del mercado aunque no se haya tradeado.
    const wsPrice = (t) => {
      const md = latestData[t]?.marketData;
      const bid   = extractFromMd(md, 'BI');
      const offer = extractFromMd(md, 'OF');
      if (Number.isFinite(bid) && Number.isFinite(offer) && bid > 0 && offer > 0) {
        return (bid + offer) / 2;
      }
      const la = extractFromMd(md, 'LA');
      return Number.isFinite(la) && la > 0 ? la : null;
    };

    let al30_last  = wsPrice('AL30');
    let al30d_last = wsPrice('AL30D');
    let al30c_last = wsPrice('AL30C');

    // Para los que falten en WS, probamos REST (uno por uno; sólo los que
    // realmente hacen falta — minimiza la cantidad de llamadas).
    const missing = [];
    if (!al30_last)  missing.push('AL30');
    if (!al30d_last) missing.push('AL30D');
    if (!al30c_last) missing.push('AL30C');

    for (const t of missing) {
      const sym = primarySymbolFor(t);
      if (!sym) continue;
      const inst = resolved.find(i => symMap[i.symbol] === t);
      const md = await fetchPrimaryMarketData(sym, inst?.marketId || 'ROFX');
      // Mismo criterio: priorizar mid sobre LA
      let v = null;
      const b = extractFromMd(md, 'BI'), o = extractFromMd(md, 'OF');
      if (Number.isFinite(b) && Number.isFinite(o) && b > 0 && o > 0) v = (b + o) / 2;
      else {
        const la = extractFromMd(md, 'LA');
        if (Number.isFinite(la) && la > 0) v = la;
      }
      if (v != null) {
        if (t === 'AL30')  al30_last  = v;
        else if (t === 'AL30D') al30d_last = v;
        else if (t === 'AL30C') al30c_last = v;
      }
    }

    // Si después de WS + REST aún falta algún LA, abortamos. Suele pasar
    // los primeros segundos tras un restart (WS aún no llegó) o si Primary
    // no operó todavía hoy en alguno de los 3.
    if (!al30_last || !al30d_last || !al30c_last) {
      return { ok: false, reason: 'no_last_price' };
    }

    const today = todayKeyAR();

    if (lastIntraSaveDate !== today) {
      try {
        await supa(`/intraday_fx_samples?ar_date=neq.${today}`, { method: 'DELETE' });
        console.log(`🧹 Intraday FX: purgados samples de días anteriores (rueda ${today})`);
      } catch (e) { console.warn('[intra] purge fail:', e.message); }
    }

    await supa('/intraday_fx_samples', { method: 'POST', body: {
      ar_date: today,
      al30_last, al30d_last, al30c_last,
    }});
    lastIntraSaveDate = today;
    return {
      ok: true,
      mep:   +(al30_last  / al30d_last).toFixed(2),
      ccl:   +(al30_last  / al30c_last).toFixed(2),
      canje: +(((al30d_last / al30c_last) - 1) * 100).toFixed(2),
    };
  } catch (e) {
    console.warn('[intra] save fail:', e.message);
    return { ok: false, reason: 'error', error: e.message };
  }
}

// Schedule del próximo sample alineado al wall-clock 5-min siguiente.
// Ej: si arrancamos a las 11:32:14, el primer save cae a las 11:35:00.
// El "+150ms" es para asegurarnos de cruzar el boundary y no caer en :04:59
// por jitter del setTimeout.
function scheduleNextIntraSample() {
  const now = Date.now();
  const next = Math.ceil(now / INTRA_SAMPLE_INTERVAL_MS) * INTRA_SAMPLE_INTERVAL_MS;
  const delay = Math.max(1000, next - now + 150);
  setTimeout(async () => {
    try { await saveIntraFxSample(); } catch {}
    scheduleNextIntraSample();
  }, delay);
}
scheduleNextIntraSample();

// GET intraday samples del día corriente AR.
app.get('/api/fx/intraday', async (req, res) => {
  try {
    const today = todayKeyAR();
    const data = await supa(`/intraday_fx_samples?ar_date=eq.${today}&order=t.asc&limit=200`);
    res.json(Array.isArray(data) ? data : []);
  } catch (e) {
    console.error('[intra] fetch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Trigger manual de un sample intradiario (testing). Acepta ?force=1 para
// saltearse el guard de mercado abierto. Igual exige tener algún LA válido
// (REST o WS) para los 3 tickers — sin precio último no hay nada que guardar.
app.post('/api/fx/intraday/save', async (req, res) => {
  const force = req.query.force === '1';
  if (force) {
    // Bypass del isMarketOpen(): llamamos directo al sampler salteándonos
    // ese guard. Por eso parchamos isMarketOpen temporalmente.
    const orig = isMarketOpen;
    // eslint-disable-next-line no-global-assign
    global.__forceMarketOpen = true;
  }
  try {
    const result = force
      // Llamada directa que ignora isMarketOpen — replicamos la lógica corta
      ? await (async () => {
          const tickers = ['AL30', 'AL30D', 'AL30C'];
          const restMd = await Promise.all(tickers.map(async (t) => {
            const sym = primarySymbolFor(t);
            if (!sym) return null;
            const inst = resolved.find(i => symMap[i.symbol] === t);
            return fetchPrimaryMarketData(sym, inst?.marketId || 'ROFX');
          }));
          const get = (idx, t, entry) => {
            const fromRest = extractFromMd(restMd[idx], entry);
            if (Number.isFinite(fromRest) && fromRest > 0) return fromRest;
            const fromWs = extractFromMd(latestData[t]?.marketData, entry);
            return Number.isFinite(fromWs) && fromWs > 0 ? fromWs : null;
          };
          // Mismo criterio que saveIntraFxSample: priorizar MID sobre LA
          // para reflejar movimiento intradiario aunque no haya trades nuevos.
          const priceOf = (idx, t) => {
            const bid   = get(idx, t, 'BI');
            const offer = get(idx, t, 'OF');
            if (Number.isFinite(bid) && Number.isFinite(offer) && bid > 0 && offer > 0) return (bid + offer) / 2;
            return get(idx, t, 'LA');
          };
          const al30_last  = priceOf(0, 'AL30');
          const al30d_last = priceOf(1, 'AL30D');
          const al30c_last = priceOf(2, 'AL30C');
          if (!al30_last || !al30d_last || !al30c_last) return { ok: false, reason: 'no_last_price' };
          const today = todayKeyAR();
          if (lastIntraSaveDate !== today) {
            await supa(`/intraday_fx_samples?ar_date=neq.${today}`, { method: 'DELETE' });
          }
          await supa('/intraday_fx_samples', { method: 'POST', body: {
            ar_date: today,
            al30_last, al30d_last, al30c_last,
          }});
          lastIntraSaveDate = today;
          return {
            ok: true, forced: true, date: today,
            mep:   +(al30_last  / al30d_last).toFixed(2),
            ccl:   +(al30_last  / al30c_last).toFixed(2),
            canje: +(((al30d_last / al30c_last) - 1) * 100).toFixed(2),
          };
        })()
      : await saveIntraFxSample();
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  Dólar oficial Argentina — DolarAPI con fallback a Bluelytics.
//
//  - Cache en memoria de 30s (el oficial no se mueve más rápido que eso).
//  - Singleflight para deduplicar concurrencia.
//  - DolarAPI scrappea BNA y otros bancos. Si falla o devuelve algo raro,
//    caemos a Bluelytics que es otra API libre con la misma referencia.
// ─────────────────────────────────────────────────────────────────────────────
const DOLAR_TTL_MS = 30_000;
let dolarCache = { fetchedAt: 0, payload: null };

async function fetchDolarOficialRaw() {
  // 1) DolarAPI (primario)
  try {
    const { data } = await httpJson('https://dolarapi.com/v1/dolares/oficial', {
      timeoutMs: 5000,
      retries: 1,
    });
    if (data && Number.isFinite(+data.compra) && Number.isFinite(+data.venta)) {
      return {
        compra: +data.compra,
        venta:  +data.venta,
        fechaActualizacion: data.fechaActualizacion || new Date().toISOString(),
        source: 'dolarapi',
      };
    }
    throw new Error('payload inválido de DolarAPI');
  } catch (e1) {
    console.warn('[fx/oficial] DolarAPI falló:', e1.message);
    // 2) Bluelytics (fallback)
    const { data } = await httpJson('https://api.bluelytics.com.ar/v2/latest', {
      timeoutMs: 5000,
      retries: 1,
    });
    if (data?.oficial && Number.isFinite(+data.oficial.value_buy) && Number.isFinite(+data.oficial.value_sell)) {
      return {
        compra: +data.oficial.value_buy,
        venta:  +data.oficial.value_sell,
        fechaActualizacion: data.last_update || new Date().toISOString(),
        source: 'bluelytics',
      };
    }
    throw new Error('Ningún proveedor de dólar oficial respondió correctamente.');
  }
}

// Singleflight: si llegan N requests concurrentes con cache vencido, sólo
// disparamos UNA llamada upstream y todos los callers comparten el resultado.
const fetchDolarOficial = singleflight(fetchDolarOficialRaw);

app.get('/api/fx/oficial', async (req, res) => {
  // Cache hit
  const age = Date.now() - dolarCache.fetchedAt;
  if (dolarCache.payload && age < DOLAR_TTL_MS) {
    return res.json({ ...dolarCache.payload, cachedAgeMs: age });
  }
  try {
    const payload = await fetchDolarOficial();
    dolarCache = { fetchedAt: Date.now(), payload };
    res.json({ ...payload, cachedAgeMs: 0 });
  } catch (e) {
    console.error('[fx/oficial]', e.message);
    // Si tenemos algo cacheado aunque sea vencido, lo devolvemos (graceful degradation).
    if (dolarCache.payload) {
      return res.json({ ...dolarCache.payload, stale: true, cachedAgeMs: age });
    }
    res.status(502).json({ error: 'No se pudo obtener la cotización oficial.' });
  }
});

server.listen(PORT, async () => {
  console.log(`🚀 Server :${PORT}`);
  // Restauramos snapshot ANTES de conectar al WS Primary, así si arrancamos
  // fuera de horario los browsers que se conectan ya reciben los precios de
  // cierre vía el `snapshot` que enviamos en `wss.on('connection')`.
  await loadMarketSnapshot();
  lastMarketOpen = isMarketOpen();
  try {
    await authPrimary();
    await discover();
    connectPrimary();
    setTimeout(resubscribeAllTrades, 3000);
  } catch (e) {
    console.error('Init error:', e.message);
    setTimeout(reconnect, 10000);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  Graceful shutdown — SIGTERM / SIGINT
//  Importante para que el deploy en Render/Railway/etc no corte conexiones
//  WS abruptamente, y que los clientes reconecten en orden.
// ─────────────────────────────────────────────────────────────────────────────
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n📴 ${signal} recibido — cerrando con elegancia…`);

  // 0) Save final del snapshot — para no perder el cierre en deploys que
  //    caen justo cuando el mercado cerró pero no tuvimos chance de save aún.
  try { await saveMarketSnapshot('shutdown'); console.log('💾 Snapshot final guardado'); }
  catch (e) { console.warn('snapshot shutdown:', e.message); }

  // 1) Dejar de aceptar nuevas conexiones HTTP.
  server.close(err => {
    if (err) console.error('server.close error:', err.message);
    else console.log('✅ HTTP server cerrado');
  });

  // 2) Cerrar WS browser clients.
  try {
    wss.clients.forEach(ws => {
      try { ws.send(JSON.stringify({ type: 'shutdown' })); } catch {}
      try { ws.close(1001, 'server shutdown'); } catch {}
    });
    wss.close(() => console.log('✅ WS server cerrado'));
  } catch (e) { console.warn('wss.close:', e.message); }

  // 3) Cerrar Primary WS upstream.
  try {
    if (primaryWs && primaryWs.readyState === WebSocket.OPEN) {
      primaryWs.close(1001, 'server shutdown');
    }
  } catch (e) { console.warn('primaryWs.close:', e.message); }

  // 4) Forzar exit si algo cuelga >5s.
  setTimeout(() => {
    console.warn('⚠️ Forzando exit tras 5s');
    process.exit(0);
  }, 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// No matar el proceso por errores no manejados; loguearlos. Si el server queda
// inestable, el orquestador (Render/Docker) lo reiniciará por healthcheck.
process.on('unhandledRejection', (reason) => {
  console.error('🔥 unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('🔥 uncaughtException:', err);
});

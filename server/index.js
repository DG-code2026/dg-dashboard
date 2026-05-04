import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { httpJson, singleflight, HttpError } from './lib/http.js';

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

async function supa(path, opts = {}) {
  // Timeout duro de 8s para que Supabase no cuelgue requests del cliente.
  // Reintento implícito una vez en errores 5xx / network / timeout.
  const { data } = await httpJson(`${SUPA_URL}/rest/v1${path}`, {
    method: opts.method || 'GET',
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Prefer': opts.prefer || 'return=representation',
    },
    body: opts.body,
    timeoutMs: 8000,
    retries: 1,
  });
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
    const r = await supa('/trades', { method: 'POST', body: row });
    res.json(Array.isArray(r) ? r[0] : r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/db/trades/:id', async (req, res) => {
  try {
    const r = await supa(`/trades?id=eq.${req.params.id}`, { method: 'PATCH', body: { ...req.body, updated_at: new Date().toISOString() } });
    res.json(Array.isArray(r) ? r[0] : r);
  } catch (e) { res.status(500).json({ error: e.message }); }
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

function isPgrstSchemaError(r) {
  return r && !Array.isArray(r) && (r.code === 'PGRST204' || r.code === '42703');
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

async function supaInsertPropuesta(row) {
  let cur = { ...row };
  // Hasta 5 reintentos por columnas faltantes (uno por cada OPTIONAL col).
  for (let i = 0; i < 6; i++) {
    const r = await supa('/propuestas', { method: 'POST', body: cur });
    if (Array.isArray(r)) return { ok: true, data: r[0] };
    if (isPgrstSchemaError(r)) {
      const s = stripUnknownCol(cur, r.message);
      if (s) { cur = s.obj; continue; }
    }
    return { ok: false, err: r };
  }
  return { ok: false, err: { message: 'too many schema retries' } };
}

async function supaPatchPropuesta(id, body) {
  let cur = { ...body };
  for (let i = 0; i < 6; i++) {
    const r = await supa(`/propuestas?id=eq.${id}`, { method: 'PATCH', body: cur });
    if (Array.isArray(r)) return { ok: true, data: r[0] };
    if (isPgrstSchemaError(r)) {
      const s = stripUnknownCol(cur, r.message);
      if (s) { cur = s.obj; continue; }
    }
    return { ok: false, err: r };
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
  const price = md.data?.price;
  if (!price) { const r = { ticker, error: 'No price' }; return r; }

  const be = await ppiFetch(`/api/${PPI_V}/MarketData/Bonds/Estimate?${new URLSearchParams({ Ticker: ticker, Date: new Date().toISOString(), QuantityType: 'PAPELES', Quantity: '100', AmountOfMoney: '0', Price: String(price), ExchangeRate: '1', EquityRate: '0', ExchangeRateAmortization: '0', RateAdjustmentAmortization: '0' })}`, { headers: ppiH() });
  const bond = Array.isArray(be.data) ? be.data[0] : be.data;
  const result = { ticker, price, bond };
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
app.get('/api/ppi/bonds/estimate', async (req, res) => {
  try {
    await getPPIToken();
    const { ticker, price } = req.query;
    const r = await ppiFetch(`/api/${PPI_V}/MarketData/Bonds/Estimate?${new URLSearchParams({ Ticker: ticker, Date: new Date().toISOString(), QuantityType: 'PAPELES', Quantity: '100', AmountOfMoney: '0', Price: price, ExchangeRate: '1', EquityRate: '0', ExchangeRateAmortization: '0', RateAdjustmentAmortization: '0' })}`, { headers: ppiH() });
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
    for (const k of TK) {
      const m = al30.find(i => i.instrumentId.symbol.includes(`- ${k} -`) && i.instrumentId.symbol.includes('CI')) || al30.find(i => i.instrumentId.symbol.includes(`- ${k} -`));
      if (m) { resolved.push(m.instrumentId); symMap[m.instrumentId.symbol] = k; }
    }
    console.log(`📋 Instruments: ${allInstruments.length} total, ${resolved.length} AL30-series resolved`);
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

app.get('/api/health', (req, res) => res.json({ status: 'ok', primary: primaryWs?.readyState === WebSocket.OPEN, supabase: !!SUPA_URL }));

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
  };
}

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
    const row = {
      date: today,
      al30_bid: al30b, al30_offer: al30o, al30_close: al30c,
      al30d_bid: al30db, al30d_offer: al30do, al30d_close: al30dc,
      al30c_bid: al30cb, al30c_offer: al30co, al30c_close: al30cc,
      mep_compra: al30o / al30db,
      mep_venta: al30b / al30do,
      ccl_compra: al30o / al30cb,
      ccl_venta: al30b / al30co,
      canje_compra: (al30cb / al30do) - 1,
      canje_venta: (al30db / al30co) - 1,
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

    // 1) Pedimos LA por REST a los 3 tickers en paralelo. Si el símbolo
    //    Primary no está resuelto todavía (discover no corrió), saltamos.
    const tickers = ['AL30', 'AL30D', 'AL30C'];
    const restMd = await Promise.all(tickers.map(async (t) => {
      const sym = primarySymbolFor(t);
      if (!sym) return null;
      // marketId del instrumento resuelto:
      const inst = resolved.find(i => symMap[i.symbol] === t);
      return fetchPrimaryMarketData(sym, inst?.marketId || 'ROFX');
    }));

    // 2) Por cada ticker, preferimos LA del REST. Como fallback caemos al
    //    último valor del WS (`latestData[t].marketData`), que sirve si
    //    el REST devolvió error pero el WS sí tiene un LA cargado.
    const get = (idx, t, entry) => {
      const md  = restMd[idx];
      const fromRest = extractFromMd(md, entry);
      if (Number.isFinite(fromRest) && fromRest > 0) return fromRest;
      const fromWs = extractFromMd(latestData[t]?.marketData, entry);
      return Number.isFinite(fromWs) && fromWs > 0 ? fromWs : null;
    };

    const al30_last  = get(0, 'AL30',  'LA');
    const al30d_last = get(1, 'AL30D', 'LA');
    const al30c_last = get(2, 'AL30C', 'LA');

    // Si no tenemos NINGÚN LA (ni REST ni WS) para los 3, abortamos. Eso
    // suele pasar la primera vez que se carga el server fuera de horario o
    // si Primary no devolvió nada todavía.
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
          const al30_last  = get(0, 'AL30',  'LA');
          const al30d_last = get(1, 'AL30D', 'LA');
          const al30c_last = get(2, 'AL30C', 'LA');
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

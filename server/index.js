import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import https from 'https';

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
  const res = await fetch(`${SUPA_URL}/rest/v1${path}`, {
    method: opts.method || 'GET',
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', 'Prefer': opts.prefer || 'return=representation' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
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
app.post('/api/db/carteras', async (req, res) => {
  try {
    const { nombre, descripcion } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre required' });
    const r = await supa('/carteras', { method: 'POST', body: { nombre, descripcion: descripcion || '' } });
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
    const r = await supa('/propuestas', { method: 'POST', body: row });
    res.json(Array.isArray(r) ? r[0] : r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/db/propuestas/:id', async (req, res) => {
  try {
    const r = await supa(`/propuestas?id=eq.${req.params.id}`, { method: 'PATCH', body: { ...req.body, updated_at: new Date().toISOString() } });
    res.json(Array.isArray(r) ? r[0] : r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/db/propuestas/:id', async (req, res) => {
  try { await supa(`/propuestas?id=eq.${req.params.id}`, { method: 'DELETE' }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
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

function ppiFetch(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, PPI_BASE);
    const req = https.request({ method: opts.method || 'GET', hostname: url.hostname, port: 443, path: url.pathname + url.search, headers: { 'Content-Type': 'application/json', ...opts.headers } }, res => {
      let body = ''; res.on('data', c => body += c); res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(body) }); } catch { reject(new Error('PPI JSON')); } });
    }); req.on('error', reject); if (opts.body) req.write(JSON.stringify(opts.body)); req.end();
  });
}

async function ppiLogin() {
  console.log('🔑 PPI login...');
  const r = await ppiFetch(`/api/${PPI_V}/Account/LoginApi`, { method: 'POST', headers: { AuthorizedClient: PPI_AC, ClientKey: PPI_CK, ApiKey: PPI_AK, ApiSecret: PPI_AS } });
  if (r.status !== 200) throw new Error(`PPI Login ${r.status}`);
  const s = Array.isArray(r.data) ? r.data[0] : r.data;
  ppiToken = s.accessToken; ppiRefreshTk = s.refreshToken; ppiExp = s.expirationDate;
  console.log('✅ PPI ok');
}
async function ppiRefresh() { try { const r = await ppiFetch(`/api/${PPI_V}/Account/RefreshToken`, { method: 'POST', headers: { AuthorizedClient: PPI_AC, ClientKey: PPI_CK }, body: { refreshToken: ppiRefreshTk } }); if (r.status !== 200) throw new Error(); const s = Array.isArray(r.data) ? r.data[0] : r.data; ppiToken = s.accessToken; ppiRefreshTk = s.refreshToken; ppiExp = s.expirationDate; } catch { return ppiLogin(); } }
async function getPPIToken() { if (!ppiToken) return ppiLogin(); if (ppiExpired()) return ppiRefresh(); }
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
//  PPI · SearchInstrument (fuente única de identidad)
//  Endpoint confirmado: /api/1.0/MarketData/SearchInstrument?ticker=X&type=X
//  Devuelve: ticker, description, type, market, currency
//
//  PPI NO expone endpoints públicos para lista de FCI, portfolio de FCI,
//  tipo de fondo, mínimo de suscripción ni manager. Esos datos se
//  capturan como input manual en el cliente (AssetPicker).
// ══════════════════════════════════════════════
const DESC_TTL = 60 * 60 * 1000; // 1 hora

// Raw fetch — no rompe si la respuesta no es JSON (útil para diagnósticos).
function ppiFetchRaw(path, opts = {}) {
  return new Promise((resolve) => {
    const url = new URL(path, PPI_BASE);
    const req = https.request({ method: opts.method || 'GET', hostname: url.hostname, port: 443, path: url.pathname + url.search, headers: { 'Content-Type': 'application/json', ...opts.headers } }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(body); } catch {}
        resolve({ status: res.statusCode, data, body });
      });
    });
    req.on('error', e => resolve({ status: 0, data: null, body: '', error: e.message }));
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
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

function fetchJSON(path) { return new Promise((res, rej) => { const url = new URL(path, PRIMARY_REST_URL); const req = https.request({ method: 'GET', hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search, headers: { 'X-Auth-Token': authToken } }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch { rej(new Error('JSON')); } }); }); req.on('error', rej); req.end(); }); }

async function authPrimary() { return new Promise((res, rej) => { const url = new URL('/auth/getToken', PRIMARY_REST_URL); const req = https.request({ method: 'POST', hostname: url.hostname, port: url.port || 443, path: url.pathname, headers: { 'X-Username': PRIMARY_USER, 'X-Password': PRIMARY_PASS } }, r => { const t = r.headers['x-auth-token']; if (t) { authToken = t; console.log('✅ Primary'); res(t); } else rej(new Error('Auth fail')); }); req.on('error', rej); req.end(); }); }

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

function connectPrimary() { if (!authToken) return; primaryWs = new WebSocket(`${PRIMARY_WS_URL}/`, [], { headers: { 'X-Auth-Token': authToken } }); primaryWs.on('open', () => { console.log('✅ WS'); if (resolved.length) primaryWs.send(JSON.stringify({ type: 'smd', level: 1, entries: ['BI','OF','LA','CL','HI','LO','TV','OI','EV','NV'], products: resolved.map(i => ({ symbol: i.symbol, marketId: i.marketId })), depth: 1 })); }); primaryWs.on('message', raw => { try { const m = JSON.parse(raw.toString()); if (m.type === 'Md') { const s = symMap[m.instrumentId?.symbol] || m.instrumentId?.symbol; latestData[s] = { symbol: s, marketData: m.marketData, timestamp: Date.now() }; const p = JSON.stringify({ type: 'md_update', symbol: s, marketData: m.marketData, timestamp: Date.now() }); wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(p); }); } } catch {} }); primaryWs.on('close', () => setTimeout(reconnect, 5000)); primaryWs.on('error', () => {}); }

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

wss.on('connection', ws => { const snap = Object.values(latestData); if (snap.length) ws.send(JSON.stringify({ type: 'snapshot', data: snap })); ws.send(JSON.stringify({ type: 'status', connected: primaryWs?.readyState === WebSocket.OPEN, tickers: TK })); });

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
//  FX DAILY CLOSES — auto-save to Supabase
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

async function saveDailyFxClose() {
  try {
    const al30b = extractPrice('AL30', 'BI'), al30o = extractPrice('AL30', 'OF'), al30c = extractPrice('AL30', 'CL');
    const al30db = extractPrice('AL30D', 'BI'), al30do = extractPrice('AL30D', 'OF'), al30dc = extractPrice('AL30D', 'CL');
    const al30cb = extractPrice('AL30C', 'BI'), al30co = extractPrice('AL30C', 'OF'), al30cc = extractPrice('AL30C', 'CL');

    if (!al30b || !al30o || !al30db || !al30do || !al30cb || !al30co) {
      console.log('⏳ FX save: not enough data yet');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
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

    // Upsert (insert or update if date exists)
    const existing = await supa(`/daily_fx_closes?date=eq.${today}`);
    if (Array.isArray(existing) && existing.length > 0) {
      await supa(`/daily_fx_closes?date=eq.${today}`, { method: 'PATCH', body: row });
    } else {
      await supa('/daily_fx_closes', { method: 'POST', body: row });
    }
    console.log(`💾 FX saved: ${today} MEP ${row.mep_compra.toFixed(2)} / CCL ${row.ccl_compra.toFixed(2)}`);
  } catch (e) {
    console.error('❌ FX save error:', e.message);
  }
}

// FX auto-save disabled per user request.
// Manual save trigger (kept for backwards compatibility but disabled)
app.post('/api/fx/save', async (req, res) => {
  res.json({ ok: false, disabled: true });
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

server.listen(PORT, async () => { console.log(`🚀 :${PORT}`); try { await authPrimary(); await discover(); connectPrimary(); setTimeout(resubscribeAllTrades, 3000); } catch (e) { console.error('Init:', e.message); setTimeout(reconnect, 10000); } });

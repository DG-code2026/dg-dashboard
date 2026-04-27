// ─────────────────────────────────────────────────────────────────────────────
//  HTTP helper — fetch con timeout duro y retry con backoff exponencial.
//
//  Reemplaza el callback-hell de `https.request` y, lo más importante,
//  garantiza que ninguna llamada a una API externa pueda colgar el server
//  para siempre (problema #1 detectado en la auditoría).
//
//  Uso:
//    const { status, data } = await httpJson('https://api.x.com/v1/foo', {
//      method: 'POST',
//      headers: { Authorization: 'Bearer abc' },
//      body: { hello: 'world' },
//      timeoutMs: 8000,   // default 8s
//      retries: 1,        // default 1 (= hasta 2 intentos en total)
//    });
//
//  Comportamiento:
//   - Aborta con AbortController si pasa `timeoutMs`.
//   - Reintenta sólo errores de red / 5xx / timeouts (NO 4xx).
//   - Backoff: 200ms, 400ms, 800ms... (cap a 2s).
//   - Devuelve `{ status, data }` con `data` parseada como JSON cuando se puede.
//   - Tira `HttpError` con `.kind` ∈ {'timeout', 'network', 'http', 'parse'}.
// ─────────────────────────────────────────────────────────────────────────────

export class HttpError extends Error {
  constructor(message, { kind, status, cause } = {}) {
    super(message);
    this.name = 'HttpError';
    this.kind = kind;            // 'timeout' | 'network' | 'http' | 'parse'
    this.status = status;        // status HTTP si la respuesta llegó
    if (cause) this.cause = cause;
  }
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 1;
const RETRY_BACKOFF_BASE_MS = 200;
const RETRY_BACKOFF_CAP_MS = 2000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function shouldRetry(err) {
  if (!err) return false;
  if (err.kind === 'timeout' || err.kind === 'network') return true;
  if (err.kind === 'http' && err.status >= 500) return true;
  return false;
}

export async function httpJson(url, opts = {}) {
  const {
    method = 'GET',
    headers,
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    parseAs = 'json',  // 'json' | 'text'
  } = opts;

  const finalHeaders = {
    'Content-Type': 'application/json',
    ...(headers || {}),
  };

  // Si no hay body, no mandamos Content-Type por las dudas (algunas APIs son quisquillosas).
  let bodyStr;
  if (body !== undefined && body !== null) {
    bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers: finalHeaders,
        body: bodyStr,
        signal: ctl.signal,
      });

      const text = await res.text();
      let data;
      if (parseAs === 'text') {
        data = text;
      } else {
        try { data = text ? JSON.parse(text) : null; }
        catch (e) {
          throw new HttpError(`Invalid JSON from ${url}`, { kind: 'parse', status: res.status, cause: e });
        }
      }

      if (res.status >= 500) {
        // Lo tratamos como retry-able. Tiramos para que entre al catch de abajo.
        throw new HttpError(`HTTP ${res.status} from ${url}`, { kind: 'http', status: res.status });
      }

      return { status: res.status, data, headers: res.headers };
    } catch (err) {
      // Normalizamos a HttpError para el caller.
      let normalized;
      if (err instanceof HttpError) {
        normalized = err;
      } else if (err.name === 'AbortError') {
        normalized = new HttpError(`Timeout (${timeoutMs}ms) calling ${url}`, { kind: 'timeout', cause: err });
      } else {
        normalized = new HttpError(`Network error calling ${url}: ${err.message}`, { kind: 'network', cause: err });
      }
      lastErr = normalized;

      if (attempt < retries && shouldRetry(normalized)) {
        const delay = Math.min(RETRY_BACKOFF_BASE_MS * 2 ** attempt, RETRY_BACKOFF_CAP_MS);
        await sleep(delay);
        continue;
      }
      throw normalized;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Singleton-flight — coalescing de llamadas async concurrentes.
//
//  Si N callers piden lo mismo "al mismo tiempo" (típicamente un refresh de
//  token), sólo se ejecuta UNA vez y todos comparten el mismo Promise.
//  Cuando termina (resolve o reject), el slot queda libre para la próxima.
//
//  Uso:
//    const refreshToken = singleflight(async () => { ... });
//    await refreshToken();   // todos los callers concurrentes esperan la misma promise
// ─────────────────────────────────────────────────────────────────────────────
export function singleflight(fn) {
  let inflight = null;
  return function singleflightWrapped(...args) {
    if (inflight) return inflight;
    inflight = Promise.resolve()
      .then(() => fn(...args))
      .finally(() => { inflight = null; });
    return inflight;
  };
}

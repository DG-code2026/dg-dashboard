import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
//  CALCULADORA DE ROTACIONES
//  Conecta al WebSocket Primary. Dados dos títulos (A vende, B compra),
//  el bid del A y el offer del B en vivo, cantidad de nominales a vender, una
//  comisión (seteable) y derechos de mercado (seteable) — ambos aplicados en
//  LAS DOS PATAS (compra y venta) — calcula:
//     · Proceeds netos de la venta de A
//     · Nominales comprables de B (redondeados a múltiplo de LÁMINA MÍNIMA)
//     · Costo total de la compra de B
//     · Sobrante (dinero no reinvertido por rounding a lámina mínima)
//
//  Universo: bonos cargados en las tablas del dashboard
//  (favorites / soberanos / subsoberanos). Cada uno trae su type/settlement.
//  Los precios vienen expresados por cada 100 VN (convención ByMA).
//  La lámina mínima se obtiene desde PPI (`bond.minimalSheet`) y se interpreta
//  como la unidad mínima negociable (se parsea extrayendo dígitos, mínimo 1).
// ─────────────────────────────────────────────────────────────────────────────

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const GREEN = '#22c55e';
const RED = '#ef4444';

const UNIVERSES = [
  { dbRoute: 'favorites',    type: 'ON',    settlement: 'A-24HS', group: 'ONs' },
  { dbRoute: 'soberanos',    type: 'BONOS', settlement: 'A-48HS', group: 'Soberanos' },
  { dbRoute: 'subsoberanos', type: 'BONOS', settlement: 'A-48HS', group: 'Subsoberanos' },
];

function fmtN(v, dec = 2) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Parser de lámina mínima — PPI devuelve strings tipo "1", "1.000", "VN 10.000".
// Extraemos todos los dígitos y devolvemos entero ≥ 1.
function parseLamina(raw) {
  if (raw == null || raw === '' || raw === '-') return 1;
  const digits = String(raw).replace(/[^\d]/g, '');
  const n = parseInt(digits, 10);
  return isNaN(n) || n < 1 ? 1 : n;
}

// Extrae bid/offer del payload del WebSocket (misma convención que el resto del dashboard).
function pickPrice(x) { return Array.isArray(x) ? x[0]?.price : x?.price; }
function getBidOfferFromEntry(mdEntry) {
  const md = mdEntry?.marketData;
  if (!md) return { bid: null, offer: null, ts: mdEntry?.timestamp || null };
  return {
    bid:   pickPrice(md.BI) ?? null,
    offer: pickPrice(md.OF) ?? null,
    ts:    mdEntry?.timestamp || null,
  };
}

// Plazos que probamos en el WebSocket para cada ticker. Primary suele tener
// más liquidez en 24hs que en 48hs para soberanos dolarizados (AL30D, GD30D,
// etc.), mientras que PPI devuelve estimates en A-48HS (convención MEP). Por
// eso nos suscribimos a LOS DOS y tomamos el que tenga datos primero.
// Orden de preferencia: el settlement "nativo" del bono primero, después 24hs.
function feedSettlements(nativeSettlement) {
  const arr = [nativeSettlement, 'A-24HS', 'A-48HS'];
  return Array.from(new Set(arr.filter(Boolean)));
}

// Busca bid/offer para un ticker probando varios settlements; devuelve el
// primero que tenga AL MENOS uno de los dos (bid u offer) con valor real.
function resolveQuote(marketData, ticker, settlements) {
  for (const s of settlements) {
    const entry = marketData[`${ticker}|${s}`];
    const q = getBidOfferFromEntry(entry);
    if (q.bid != null || q.offer != null) return { ...q, usedSettlement: s };
  }
  // Si nada tiene datos, devolvemos el primer settlement como referencia (para timestamps).
  const fallback = marketData[`${ticker}|${settlements[0]}`];
  return { ...getBidOfferFromEntry(fallback), usedSettlement: settlements[0] };
}

export default function CalculadoraRotaciones({ marketData = {}, primaryConnected = false }) {
  const [universe, setUniverse] = useState([]); // [{ ticker, type, settlement, group }]
  const [loadingUniv, setLoadingUniv] = useState(true);
  const [univErr, setUnivErr] = useState('');

  const [tickerA, setTickerA] = useState('');   // el que se vende
  const [tickerB, setTickerB] = useState('');   // el que se compra
  const [nominalesA, setNominalesA] = useState(100);
  const [commPct, setCommPct] = useState(0.6);  // comisión del broker, aplicada en compra y venta
  const [drxPct, setDrxPct]   = useState(0.01); // derechos de mercado (ByMA) — default para públicos (soberanos/subsoberanos) a 24H
  // Lámina mínima por ticker, fetcheada on-demand desde PPI (bond.minimalSheet).
  const [minSheets, setMinSheets] = useState({}); // { ticker: number }
  const fetchedSheets = useRef(new Set());

  // 1) Cargar universo de bonos (unión de los 3 paneles)
  useEffect(() => {
    (async () => {
      try {
        setLoadingUniv(true); setUnivErr('');
        const results = await Promise.all(
          UNIVERSES.map(async (u) => {
            const r = await fetch(`${API}/api/db/${u.dbRoute}`);
            if (!r.ok) return [];
            const rows = await r.json();
            if (!Array.isArray(rows)) return [];
            return rows.map(row => ({ ticker: row.ticker, type: u.type, settlement: u.settlement, group: u.group }));
          })
        );
        const flat = results.flat();
        // Dedupe: puede haber solapamientos; priorizamos el primer grupo en el orden de UNIVERSES.
        const seen = new Set();
        const uniq = [];
        for (const item of flat) {
          if (seen.has(item.ticker)) continue;
          seen.add(item.ticker);
          uniq.push(item);
        }
        uniq.sort((a, b) => a.ticker.localeCompare(b.ticker));
        setUniverse(uniq);
      } catch (e) { setUnivErr(e.message || 'Error cargando universo de bonos'); setUniverse([]); }
      finally { setLoadingUniv(false); }
    })();
  }, []);

  const findItem = useCallback((t) => universe.find(u => u.ticker === t), [universe]);

  // 2) Suscribir al WebSocket cuando cambia una selección. El backend cachea suscripciones,
  //    así que repetir no es caro. Suscribimos a VARIOS plazos (nativo + 24hs) porque
  //    Primary suele tener liquidez distribuida de forma irregular (p. ej. AL30D a 48hs
  //    puede estar vacío pero a 24hs tener bid/offer activos).
  const subscribed = useRef(new Set());
  const subscribe = useCallback((item) => {
    if (!item) return;
    for (const s of feedSettlements(item.settlement)) {
      const key = `${item.ticker}|${s}`;
      if (subscribed.current.has(key)) continue;
      subscribed.current.add(key);
      fetch(`${API}/api/primary/subscribe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: item.ticker, settlement: s }),
      }).catch(() => {});
    }
  }, []);

  // Trae lámina mínima desde PPI (batch con un solo ticker — el backend cachea 45s).
  // Se llama una sola vez por ticker en la sesión.
  const fetchMinSheet = useCallback(async (item) => {
    if (!item || fetchedSheets.current.has(item.ticker)) return;
    fetchedSheets.current.add(item.ticker);
    try {
      const r = await fetch(`${API}/api/ppi/bonds/batch?type=${item.type}&settlement=${item.settlement}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: [item.ticker] }),
      });
      if (!r.ok) return;
      const data = await r.json();
      const entry = Array.isArray(data) ? data.find(x => x.ticker === item.ticker) : null;
      const raw = entry?.bond?.minimalSheet;
      const n = parseLamina(raw);
      setMinSheets(prev => ({ ...prev, [item.ticker]: n }));
    } catch { /* dejamos que caiga al default 1 */ }
  }, []);

  useEffect(() => { if (tickerA) { const it = findItem(tickerA); subscribe(it); fetchMinSheet(it); } }, [tickerA, findItem, subscribe, fetchMinSheet]);
  useEffect(() => { if (tickerB) { const it = findItem(tickerB); subscribe(it); fetchMinSheet(it); } }, [tickerB, findItem, subscribe, fetchMinSheet]);

  // 3) Leer bid/offer en vivo del marketData, probando varios settlements.
  const itemA = findItem(tickerA);
  const itemB = findItem(tickerB);
  const quoteA = itemA ? resolveQuote(marketData, itemA.ticker, feedSettlements(itemA.settlement)) : null;
  const quoteB = itemB ? resolveQuote(marketData, itemB.ticker, feedSettlements(itemB.settlement)) : null;

  // 4) Cálculo principal
  //    Comisión y derechos de mercado se suman y se aplican en ambas patas.
  //    Los nominales de B se redondean a la baja al múltiplo de su lámina mínima.
  const laminaA = minSheets[tickerA] || 1;
  const laminaB = minSheets[tickerB] || 1;
  const calc = useMemo(() => {
    const N = Number(nominalesA);
    const bidA = quoteA?.bid;
    const offerB = quoteB?.offer;
    const comm = (Number(commPct) || 0) / 100;
    const drx  = (Number(drxPct)  || 0) / 100;
    const fee  = comm + drx; // total aplicado por pata
    if (!N || N <= 0 || bidA == null || offerB == null) return null;

    // Precios expresados por cada 100 VN → dividir por 100 para llevar a "por 1 nominal".
    const saleUnit = bidA / 100 * (1 - fee);
    const buyUnit  = offerB / 100 * (1 + fee);

    const saleGross       = (bidA / 100) * N;
    const saleCommAmount  = saleGross * comm;
    const saleDrxAmount   = saleGross * drx;
    const saleFeeTotal    = saleCommAmount + saleDrxAmount;
    const proceeds        = saleGross - saleFeeTotal;

    if (buyUnit <= 0) return null;
    // Cantidad teórica (flotante) que encajaría con el dinero disponible.
    const nominalesBRaw   = proceeds / buyUnit;
    // Ajuste a lámina mínima: floor al múltiplo de laminaB.
    const lam             = laminaB > 0 ? laminaB : 1;
    const nominalesB      = Math.floor(nominalesBRaw / lam) * lam;

    const buyGross        = (offerB / 100) * nominalesB;
    const buyCommAmount   = buyGross * comm;
    const buyDrxAmount    = buyGross * drx;
    const buyFeeTotal     = buyCommAmount + buyDrxAmount;
    const totalBuy        = buyGross + buyFeeTotal;
    // Sobrante: lo que queda sin reinvertir por el rounding a lámina mínima.
    const sobrante        = proceeds - totalBuy;

    const priceRatio      = offerB > 0 ? bidA / offerB : null;
    const effectiveRatio  = N > 0 ? nominalesB / N : null;

    // Chequeo: N debería ser múltiplo de laminaA. Si no, flagueamos aviso.
    const laminaAWarning  = (laminaA > 1) && (N % laminaA !== 0);

    return {
      N, bidA, offerB, comm, drx, fee,
      saleUnit, buyUnit,
      saleGross, saleCommAmount, saleDrxAmount, saleFeeTotal, proceeds,
      nominalesBRaw, nominalesB, buyGross, buyCommAmount, buyDrxAmount, buyFeeTotal, totalBuy, sobrante,
      priceRatio, effectiveRatio,
      laminaA, laminaB, laminaAWarning,
    };
  }, [nominalesA, quoteA, quoteB, commPct, drxPct, laminaA, laminaB, tickerA, tickerB]);

  const canInvertSelection = !!(tickerA && tickerB);
  const swap = () => { if (!canInvertSelection) return; const a = tickerA; setTickerA(tickerB); setTickerB(a); };

  return (
    <div>
      {/* Barra superior: comisión + derechos de mercado + estado del WS */}
      <div style={S.topBar}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={S.commCtrl} title="Comisión del broker — aplicada en compra y venta (el total efectivo es el doble de lo seteado)">
            <span style={S.commCtrlLbl}>COMISIÓN</span>
            <input
              type="number" step="0.05" min="0" max="5"
              value={commPct}
              onChange={e => setCommPct(Math.max(0, Math.min(5, parseFloat(e.target.value) || 0)))}
              style={S.commCtrlInput}
            />
            <span style={S.commCtrlPct}>%</span>
            <span style={S.commCtrlTotal} title="Total aplicado en venta + compra">× 2 = {fmtN(commPct * 2, 2)}%</span>
          </div>
          <div style={S.commCtrl} title="Derechos de mercado (ByMA) — aplicados en compra y venta, adicionales a la comisión">
            <span style={S.commCtrlLbl}>DRX. MERCADO</span>
            <input
              type="number" step="0.01" min="0" max="2"
              value={drxPct}
              onChange={e => setDrxPct(Math.max(0, Math.min(2, parseFloat(e.target.value) || 0)))}
              style={S.commCtrlInput}
            />
            <span style={S.commCtrlPct}>%</span>
            <span style={S.commCtrlTotal} title="Total aplicado en venta + compra">× 2 = {fmtN(drxPct * 2, 2)}%</span>
            <DrxHelp />
          </div>
          <span style={S.commCtrlNote}>ambos valores se aplican tanto en la venta de A como en la compra de B</span>
        </div>
        <span style={{ ...S.liveDot, borderColor: primaryConnected ? GREEN : RED, color: primaryConnected ? GREEN : RED }}>
          <span style={{ ...S.liveDotInner, background: primaryConnected ? GREEN : RED }} />
          {primaryConnected ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>

      {univErr && (
        <div style={S.errBox}>No se pudo cargar el universo de bonos: {univErr}</div>
      )}

      {/* Layout de dos títulos */}
      <div style={S.legsRow}>
        <Leg
          side="sell"
          title="VENDO"
          universe={universe}
          disabled={loadingUniv}
          tickerOther={tickerB}
          ticker={tickerA}
          onChange={setTickerA}
          price={quoteA?.bid}
          priceLabel="BID"
          showNominales
          nominales={nominalesA}
          onNominalesChange={setNominalesA}
          item={itemA}
          ts={quoteA?.ts}
          lamina={laminaA}
          usedSettlement={quoteA?.usedSettlement}
          primaryConnected={primaryConnected}
        />
        <div style={S.swapWrap}>
          <button style={{ ...S.swapBtn, opacity: canInvertSelection ? 1 : 0.4 }} onClick={swap} disabled={!canInvertSelection} title="Invertir compra y venta">⇄</button>
        </div>
        <Leg
          side="buy"
          title="COMPRO"
          universe={universe}
          disabled={loadingUniv}
          tickerOther={tickerA}
          ticker={tickerB}
          onChange={setTickerB}
          price={quoteB?.offer}
          priceLabel="OFFER"
          item={itemB}
          ts={quoteB?.ts}
          lamina={laminaB}
          usedSettlement={quoteB?.usedSettlement}
          primaryConnected={primaryConnected}
        />
      </div>

      {/* Resultado */}
      <div style={S.resultWrap}>
        {!tickerA || !tickerB ? (
          <div style={S.placeholder}>Seleccioná ambos títulos para ver el cálculo.</div>
        ) : !calc ? (
          <div style={S.placeholder}>
            {quoteA?.bid == null && `Sin bid de ${tickerA}. `}
            {quoteB?.offer == null && `Sin offer de ${tickerB}. `}
            {(!nominalesA || nominalesA <= 0) && 'Ingresá nominales a vender. '}
            Esperando datos de mercado…
          </div>
        ) : (
          <>
            {calc.laminaAWarning && (
              <div style={{ ...S.errBox, background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.35)', color: '#f59e0b', marginBottom: 14 }}>
                ⚠ Los nominales de {tickerA} ({fmtN(calc.N, 0)}) no son múltiplo de su lámina mínima ({fmtN(laminaA, 0)}). Ajustá la cantidad para que sea operable.
              </div>
            )}
            <div style={S.resultGrid}>
              <ResRow label="Bruto venta A" sub={`${fmtN(calc.N, 0)} nominales × $${fmtN(calc.bidA, 2)}/100`} value={`$${fmtN(calc.saleGross, 2)}`} />
              <ResRow label={`Comisión venta (${fmtN(commPct, 2)}%)`} value={`− $${fmtN(calc.saleCommAmount, 2)}`} valueColor={RED} />
              <ResRow label={`Drx. mercado venta (${fmtN(drxPct, 2)}%)`} value={`− $${fmtN(calc.saleDrxAmount, 2)}`} valueColor={RED} />
              <ResRow label="Proceeds venta" sub="bruto − comisión − derechos" value={`$${fmtN(calc.proceeds, 2)}`} strong valueColor="var(--neon)" />
              <div style={S.resDivider} />
              <ResRow
                label={`Nominales comprables de B`}
                sub={laminaB > 1 ? `redondeado a múltiplo de lámina mín. (${fmtN(laminaB, 0)})` : `redondeado a entero (lámina 1)`}
                value={fmtN(calc.nominalesB, 0)}
                strong
                valueColor="var(--neon)"
              />
              <ResRow
                label="Nominales teóricos (sin lámina)"
                sub="proceeds / (offer × (1 + comm + drx))"
                value={fmtN(calc.nominalesBRaw, 2)}
                valueColor="var(--text-dim)"
              />
              <ResRow label="Bruto compra B" sub={`${fmtN(calc.nominalesB, 0)} × $${fmtN(calc.offerB, 2)}/100`} value={`$${fmtN(calc.buyGross, 2)}`} />
              <ResRow label={`Comisión compra (${fmtN(commPct, 2)}%)`} value={`+ $${fmtN(calc.buyCommAmount, 2)}`} valueColor={RED} />
              <ResRow label={`Drx. mercado compra (${fmtN(drxPct, 2)}%)`} value={`+ $${fmtN(calc.buyDrxAmount, 2)}`} valueColor={RED} />
              <ResRow label="Costo total compra" value={`$${fmtN(calc.totalBuy, 2)}`} />
              <div style={S.resDivider} />
              <ResRow
                label="SOBRANTE"
                sub={laminaB > 1 ? `dinero no reinvertido por rounding a lámina mín. (${fmtN(laminaB, 0)})` : 'diferencia entre proceeds y costo de compra'}
                value={`$${fmtN(calc.sobrante, 2)}`}
                strong
                valueColor={calc.sobrante >= 0 ? GREEN : RED}
              />
            </div>

            <div style={S.kpiRow}>
              <Kpi label="Ratio de precios" v={calc.priceRatio != null ? fmtN(calc.priceRatio, 4) : '—'} sub="bid(A) / offer(B)" />
              <Kpi label="Ratio efectivo" v={calc.effectiveRatio != null ? fmtN(calc.effectiveRatio, 4) : '—'} sub="nominales(B) / nominales(A)" />
              <Kpi label="Lámina mínima B" v={fmtN(laminaB, 0)} sub={tickerB || '—'} />
            </div>

            {/* Totales desglosados: comisiones del broker vs. derechos de mercado. */}
            <div style={S.totalsRow}>
              <div style={{ ...S.totalsBox, borderColor: 'rgba(239,68,68,0.35)' }}>
                <div style={S.totalsLbl}>GENERADO POR COMISIÓN DEL BROKER ({fmtN(commPct, 2)}%)</div>
                <div style={S.totalsRowSplit}>
                  <div><span style={S.totalsK}>Venta A</span><span style={S.totalsV}>${fmtN(calc.saleCommAmount, 2)}</span></div>
                  <div><span style={S.totalsK}>Compra B</span><span style={S.totalsV}>${fmtN(calc.buyCommAmount, 2)}</span></div>
                </div>
                <div style={S.totalsTotal}>
                  <span>TOTAL</span>
                  <b>${fmtN(calc.saleCommAmount + calc.buyCommAmount, 2)}</b>
                </div>
              </div>
              <div style={{ ...S.totalsBox, borderColor: 'rgba(245,158,11,0.35)' }}>
                <div style={S.totalsLbl}>GENERADO POR DERECHOS DE MERCADO ({fmtN(drxPct, 2)}%)</div>
                <div style={S.totalsRowSplit}>
                  <div><span style={S.totalsK}>Venta A</span><span style={S.totalsV}>${fmtN(calc.saleDrxAmount, 2)}</span></div>
                  <div><span style={S.totalsK}>Compra B</span><span style={S.totalsV}>${fmtN(calc.buyDrxAmount, 2)}</span></div>
                </div>
                <div style={S.totalsTotal}>
                  <span>TOTAL</span>
                  <b>${fmtN(calc.saleDrxAmount + calc.buyDrxAmount, 2)}</b>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div style={S.footnote}>
        Fuente: precios en vivo del WebSocket Primary · lámina mínima desde API PPI · precios expresados por cada 100 VN (convención ByMA) · comisión ({fmtN(commPct, 2)}%) y derechos de mercado ({fmtN(drxPct, 2)}%) se aplican en venta Y en compra · los nominales comprables de B se redondean a la baja al múltiplo de lámina mínima; el dinero no reinvertido figura como SOBRANTE.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  UI helpers
// ─────────────────────────────────────────────────────────────────────────────

function Leg({ title, side, universe, disabled, tickerOther, ticker, onChange, price, priceLabel, showNominales, nominales, onNominalesChange, item, ts, lamina, usedSettlement, primaryConnected }) {
  // Agrupamos por `group` para renderizar con <optgroup>.
  const groups = useMemo(() => {
    const byGroup = {};
    for (const u of universe) {
      if (!byGroup[u.group]) byGroup[u.group] = [];
      byGroup[u.group].push(u);
    }
    return byGroup;
  }, [universe]);

  const priceColor = side === 'sell' ? GREEN : '#ff7ac6';

  return (
    <div style={{ ...S.legBox, borderColor: ticker ? priceColor : 'var(--border)' }}>
      <div style={{ ...S.legHeader, color: priceColor }}>{title}</div>
      <div style={S.legRow}>
        <select
          style={S.legSelect}
          value={ticker}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        >
          <option value="">— Seleccionar —</option>
          {Object.entries(groups).map(([g, items]) => (
            <optgroup key={g} label={g}>
              {items.map(u => (
                <option key={u.ticker} value={u.ticker} disabled={u.ticker === tickerOther}>
                  {u.ticker}{u.ticker === tickerOther ? ' (ya seleccionado)' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div style={S.quoteRow}>
        <div style={S.quoteBlock}>
          <div style={S.quoteLbl}>{priceLabel}</div>
          <div style={{ ...S.quoteVal, color: price != null ? priceColor : 'var(--text-dim)' }}>
            {price != null ? `$${fmtN(price, 2)}` : (ticker ? '…' : '—')}
          </div>
          <div style={S.quoteSub}>
            {ticker && price == null
              ? (primaryConnected ? 'suscribiendo · esperando WebSocket' : 'WebSocket desconectado')
              : 'por cada 100 VN'}
          </div>
        </div>
        {showNominales && (
          <div style={S.nomBlock}>
            <div style={S.quoteLbl}>NOMINALES</div>
            <input
              type="number" min="0" step="1"
              value={nominales}
              onChange={e => onNominalesChange(Math.max(0, parseInt(e.target.value) || 0))}
              style={S.nomInput}
            />
          </div>
        )}
      </div>

      <div style={S.legMeta}>
        {item ? `${item.type} · ${item.settlement}` : ' '}
        {usedSettlement && usedSettlement !== item?.settlement
          ? <span style={{ marginLeft: 6, color: 'var(--neon-dim,#86efac)' }}>· precio de {usedSettlement}</span>
          : null}
        {item && lamina != null ? <span style={{ marginLeft: 6 }}>· lámina mín. <b style={{ color: 'var(--text)' }}>{lamina.toLocaleString('es-AR')}</b></span> : null}
        {ts ? <span style={{ opacity: 0.6, marginLeft: 6 }}>· {new Date(ts).toLocaleTimeString('es-AR')}</span> : null}
      </div>
    </div>
  );
}

function ResRow({ label, sub, value, strong, valueColor }) {
  return (
    <div style={S.resRow}>
      <div>
        <div style={{ ...S.resLabel, fontWeight: strong ? 700 : 500, color: strong ? 'var(--text)' : 'var(--text-dim)' }}>{label}</div>
        {sub && <div style={S.resSub}>{sub}</div>}
      </div>
      <div style={{ ...S.resValue, fontWeight: strong ? 700 : 500, color: valueColor || 'var(--text)' }}>{value}</div>
    </div>
  );
}

function Kpi({ label, v, sub }) {
  return (
    <div style={S.kpi}>
      <div style={S.kpiLbl}>{label}</div>
      <div style={S.kpiVal}>{v}</div>
      {sub && <div style={S.kpiSub}>{sub}</div>}
    </div>
  );
}

// Tooltip con la tabla de derechos de mercado (ByMA) a 24H por tipo de activo.
// Los valores de referencia surgen del tarifario ByMA/operador vigente.
function DrxHelp() {
  const [open, setOpen] = useState(false);
  const rows = [
    { k: 'Soberanos (Públicos)',    v: '0,01 %',  hint: 'AL30, GD30, etc.' },
    { k: 'Subsoberanos (Públicos)', v: '0,01 %',  hint: 'PBA, CABA, prov.' },
    { k: 'Letras',                  v: '0,001 %', hint: 'LEDES, LECAPs' },
    { k: 'ON (Corporativos)',       v: '0,08 %',  hint: 'Obligaciones negociables' },
    { k: 'CEDEARs / Acciones',      v: '0,05 %',  hint: 'Privados (renta variable)' },
  ];
  return (
    <span
      style={S.helpWrap}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
      aria-label="Ver tabla de derechos de mercado"
    >
      <span style={S.helpBtn}>?</span>
      {open && (
        <div style={S.helpPop} role="tooltip">
          <div style={S.helpTitle}>DERECHOS DE MERCADO · PLAZO 24H</div>
          <div style={S.helpTable}>
            {rows.map((r, i) => (
              <div key={i} style={S.helpRow}>
                <div>
                  <div style={S.helpK}>{r.k}</div>
                  <div style={S.helpHint}>{r.hint}</div>
                </div>
                <div style={S.helpV}>{r.v}</div>
              </div>
            ))}
          </div>
          <div style={S.helpFoot}>
            Alícuota aplicada sobre el monto efectivo de cada operación (compra o venta). Valores referenciales de ByMA — pueden variar en otros plazos (48h, 72h).
          </div>
        </div>
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────
const S = {
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' },
  commCtrl: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 3 },
  commCtrlLbl: { fontFamily: "'Roboto Mono',monospace", fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: 'var(--text-dim)' },
  commCtrlInput: { fontFamily: "'Roboto Mono',monospace", fontSize: 13, fontWeight: 700, color: 'var(--neon)', background: 'transparent', border: 'none', outline: 'none', width: 50, textAlign: 'right' },
  commCtrlPct: { fontFamily: "'Roboto Mono',monospace", fontSize: 11, color: 'var(--neon)' },
  commCtrlTotal: { fontFamily: "'Roboto Mono',monospace", fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', marginLeft: 4, padding: '2px 6px', background: 'rgba(0,255,170,0.06)', border: '1px solid rgba(0,255,170,0.2)', borderRadius: 2, letterSpacing: 0.5 },
  commCtrlNote: { marginLeft: 8, fontSize: 9, color: 'var(--text-dim)', letterSpacing: 0.5, fontStyle: 'italic' },
  liveDot: { display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: "'Roboto Mono',monospace", fontSize: 9, fontWeight: 700, letterSpacing: 1.5, padding: '5px 10px', borderRadius: 3, border: '1px solid' },
  liveDotInner: { width: 6, height: 6, borderRadius: '50%' },

  errBox: { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 3, padding: '8px 12px', marginBottom: 16, color: RED, fontFamily: "'Roboto Mono',monospace", fontSize: 11 },

  legsRow: { display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap', marginBottom: 20 },
  legBox: { flex: '1 1 320px', minWidth: 260, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: 16, transition: 'border-color 0.2s' },
  legHeader: { fontFamily: "'Roboto',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 10 },
  legRow: { marginBottom: 12 },
  legSelect: { width: '100%', background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)', fontFamily: "'Roboto Mono',monospace", fontSize: 13, padding: '10px 10px', outline: 'none', cursor: 'pointer' },
  quoteRow: { display: 'flex', gap: 12, alignItems: 'flex-end' },
  quoteBlock: { flex: 1 },
  nomBlock: { flex: '0 0 130px' },
  quoteLbl: { fontFamily: "'Roboto Mono',monospace", fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--text-dim)', marginBottom: 4 },
  quoteVal: { fontFamily: "'Roboto Mono',monospace", fontSize: 22, fontWeight: 700, letterSpacing: 0.5 },
  quoteSub: { fontFamily: "'Roboto Mono',monospace", fontSize: 9, color: 'var(--text-dim)', marginTop: 2, opacity: 0.7 },
  nomInput: { width: '100%', background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--neon)', fontFamily: "'Roboto Mono',monospace", fontSize: 16, fontWeight: 700, padding: '8px 10px', outline: 'none', textAlign: 'right' },
  legMeta: { marginTop: 10, fontFamily: "'Roboto Mono',monospace", fontSize: 9, color: 'var(--text-dim)', letterSpacing: 0.5, minHeight: 12 },

  swapWrap: { flex: '0 0 44px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  swapBtn: { width: 40, height: 40, border: '1px solid var(--border)', borderRadius: 20, background: 'var(--bg-card)', color: 'var(--neon)', fontSize: 18, cursor: 'pointer', transition: 'all 0.15s' },

  resultWrap: { background: 'var(--bg-card)', border: '1px solid var(--border-neon)', borderRadius: 6, padding: 20 },
  placeholder: { textAlign: 'center', padding: '24px 16px', color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace", fontSize: 12 },
  resultGrid: { display: 'flex', flexDirection: 'column' },
  resRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 4px', borderBottom: '1px solid rgba(128,128,128,0.08)', gap: 16 },
  resLabel: { fontSize: 11, letterSpacing: 0.5 },
  resSub: { fontFamily: "'Roboto Mono',monospace", fontSize: 9, color: 'var(--text-dim)', marginTop: 2, opacity: 0.7 },
  resValue: { fontFamily: "'Roboto Mono',monospace", fontSize: 13, textAlign: 'right', whiteSpace: 'nowrap' },
  resDivider: { height: 1, background: 'linear-gradient(90deg, transparent, var(--border-neon), transparent)', margin: '8px 0' },

  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' },
  kpi: { textAlign: 'center', padding: '10px 8px', background: 'var(--row-alt)', borderRadius: 4 },
  kpiLbl: { fontFamily: "'Roboto',sans-serif", fontSize: 8, fontWeight: 700, letterSpacing: 1.5, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 4 },
  kpiVal: { fontFamily: "'Roboto Mono',monospace", fontSize: 14, fontWeight: 700, color: 'var(--text)' },
  kpiSub: { fontFamily: "'Roboto Mono',monospace", fontSize: 8, color: 'var(--text-dim)', marginTop: 3, opacity: 0.7 },

  totalsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 14 },
  totalsBox: { background: 'var(--row-alt)', border: '1px solid var(--border)', borderRadius: 5, padding: '12px 14px' },
  totalsLbl: { fontFamily: "'Roboto',sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 10 },
  totalsRowSplit: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 },
  totalsK: { display: 'block', fontFamily: "'Roboto Mono',monospace", fontSize: 9, color: 'var(--text-dim)', letterSpacing: 1, marginBottom: 2 },
  totalsV: { display: 'block', fontFamily: "'Roboto Mono',monospace", fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  totalsTotal: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 8, borderTop: '1px solid var(--border)', fontFamily: "'Roboto Mono',monospace", fontSize: 11, color: 'var(--text)', letterSpacing: 1.5, fontWeight: 700 },

  footnote: { marginTop: 16, fontFamily: "'Roboto Mono',monospace", fontSize: 9, color: 'var(--text-dim)', letterSpacing: 0.5, lineHeight: 1.5, opacity: 0.75 },

  helpWrap: { position: 'relative', display: 'inline-flex', alignItems: 'center', marginLeft: 4, cursor: 'help', outline: 'none' },
  helpBtn: { width: 16, height: 16, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace", fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 },
  helpPop: { position: 'absolute', top: '125%', left: '50%', transform: 'translateX(-50%)', zIndex: 50, width: 280, background: 'var(--bg-card, #0f1115)', border: '1px solid var(--border-neon, #22c55e)', borderRadius: 5, padding: '10px 12px', boxShadow: '0 6px 24px rgba(0,0,0,0.55)', pointerEvents: 'none' },
  helpTitle: { fontFamily: "'Roboto',sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--neon, #22c55e)', textTransform: 'uppercase', marginBottom: 8, textAlign: 'center' },
  helpTable: { display: 'flex', flexDirection: 'column' },
  helpRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '5px 0', borderBottom: '1px solid rgba(128,128,128,0.12)', gap: 10 },
  helpK: { fontFamily: "'Roboto Mono',monospace", fontSize: 10, fontWeight: 700, color: 'var(--text)', letterSpacing: 0.3 },
  helpHint: { fontFamily: "'Roboto Mono',monospace", fontSize: 8, color: 'var(--text-dim)', opacity: 0.7, marginTop: 1 },
  helpV: { fontFamily: "'Roboto Mono',monospace", fontSize: 11, fontWeight: 700, color: 'var(--neon, #22c55e)', whiteSpace: 'nowrap' },
  helpFoot: { fontFamily: "'Roboto Mono',monospace", fontSize: 8, color: 'var(--text-dim)', letterSpacing: 0.3, lineHeight: 1.4, opacity: 0.75, marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(128,128,128,0.15)' },
};

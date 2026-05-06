import { useState, useEffect, useRef } from 'react';

export default function TickerCard({ ticker, label, data, marketOpen, delay }) {
  const [flash, setFlash] = useState(null); // 'bid' | 'offer' | null
  const prevData = useRef(null);

  // Flash effect on price change
  useEffect(() => {
    if (!data || !prevData.current) {
      prevData.current = data;
      return;
    }
    const prevBid = getBid(prevData.current);
    const prevOffer = getOffer(prevData.current);
    const newBid = getBid(data);
    const newOffer = getOffer(data);

    if (newBid !== prevBid) {
      setFlash('bid');
      setTimeout(() => setFlash(null), 600);
    }
    if (newOffer !== prevOffer) {
      setFlash('offer');
      setTimeout(() => setFlash(null), 600);
    }
    prevData.current = data;
  }, [data]);

  const liveBid   = getBid(data);
  const liveOffer = getOffer(data);
  const last      = getLast(data);
  const close     = getClose(data);

  // Fallback post-cierre: si Primary dejó de mandar punta (mercado cerrado)
  // mostramos CL — ergo last → close — para que la card siga teniendo info
  // útil en lugar de "—". `usingClose` activa el badge "CIERRE".
  const bid       = liveBid   ?? last ?? close;
  const offer     = liveOffer ?? last ?? close;
  const bidSize   = getBidSize(data);
  const offerSize = getOfferSize(data);

  // Antes el badge LIVE se decidía sólo por la presencia de bid/offer en
  // `latestData`. Pero después de la corrección del merge en useMarketData,
  // los BI/OF persisten en cache aunque el mercado esté cerrado — entonces
  // se mostraba "LIVE" indefinidamente. Ahora respetamos el estado real del
  // mercado: si está cerrado, NUNCA es LIVE (a lo sumo CIERRE).
  const hasAnyData    = bid !== null || offer !== null;
  const hasLiveBookOK = liveBid !== null || liveOffer !== null;
  // `marketOpen` puede ser undefined la primera vez (status aún no cargó).
  // Con undefined respetamos el comportamiento legacy (LIVE si hay book).
  const isMarketOpen  = marketOpen !== false;
  const hasLive       = isMarketOpen && hasLiveBookOK;
  const usingClose    = !hasLive && hasAnyData;
  const spread        = isMarketOpen && liveBid != null && liveOffer != null
    ? (liveOffer - liveBid).toFixed(2)
    : null;

  const badgeColor = hasLive ? 'var(--green)' : (usingClose ? '#f59e0b' : 'var(--text-dim)');
  const badgeLabel = hasLive ? 'LIVE' : (usingClose ? 'CIERRE' : 'SIN DATOS');

  return (
    <div
      style={{
        ...styles.card,
        animationDelay: `${delay}ms`,
      }}
    >
      {/* Header compacto: ticker + label a la izq, badge a la der */}
      <div style={styles.cardHeader}>
        <div style={styles.titleGroup}>
          <span style={styles.ticker}>{ticker}</span>
          <span style={styles.label}>{label}</span>
        </div>
        <div style={styles.liveIndicator}>
          <div style={{
            ...styles.liveDot,
            backgroundColor: badgeColor,
            boxShadow: hasLive ? 'var(--green-glow)' : 'none',
          }} />
          <span style={{ ...styles.liveText, color: badgeColor }}>{badgeLabel}</span>
        </div>
      </div>

      {/* Bid / Offer (compactos, sin spread separado) */}
      <div style={styles.priceRow}>
        <div style={{
          ...styles.priceBox,
          borderColor: flash === 'bid' ? 'var(--green)' : 'var(--border)',
          boxShadow: flash === 'bid' ? 'var(--green-glow)' : 'none',
        }}>
          <span style={{ ...styles.priceLabel, color: 'var(--green)' }}>BID</span>
          <span style={{ ...styles.priceValue, color: 'var(--green)' }}>
            {bid !== null ? formatPrice(bid) : '—'}
          </span>
        </div>

        <div style={{
          ...styles.priceBox,
          borderColor: flash === 'offer' ? 'var(--red)' : 'var(--border)',
          boxShadow: flash === 'offer' ? '0 0 8px var(--red-dim)' : 'none',
        }}>
          <span style={{ ...styles.priceLabel, color: 'var(--red)' }}>OFFER</span>
          <span style={{ ...styles.priceValue, color: 'var(--red)' }}>
            {offer !== null ? formatPrice(offer) : '—'}
          </span>
        </div>
      </div>

      {/* Footer en una sola línea: spread · último · hora */}
      {(spread != null || last != null || data?.timestamp) && (
        <div style={styles.metaRow}>
          {spread != null && <span><span style={styles.metaLabel}>Sp</span> {spread}</span>}
          {last != null    && <span><span style={styles.metaLabel}>Últ</span> {formatPrice(last)}</span>}
          {data?.timestamp && (
            <span style={{ marginLeft: 'auto' }}>
              {new Date(data.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──

function getBid(d) {
  if (!d?.marketData?.BI) return null;
  const bi = d.marketData.BI;
  if (Array.isArray(bi)) return bi[0]?.price ?? null;
  return bi.price ?? null;
}

function getOffer(d) {
  if (!d?.marketData?.OF) return null;
  const of_ = d.marketData.OF;
  if (Array.isArray(of_)) return of_[0]?.price ?? null;
  return of_.price ?? null;
}

function getBidSize(d) {
  if (!d?.marketData?.BI) return null;
  const bi = d.marketData.BI;
  if (Array.isArray(bi)) return bi[0]?.size ?? null;
  return bi.size ?? null;
}

function getOfferSize(d) {
  if (!d?.marketData?.OF) return null;
  const of_ = d.marketData.OF;
  if (Array.isArray(of_)) return of_[0]?.size ?? null;
  return of_.size ?? null;
}

function getLast(d) {
  if (!d?.marketData?.LA) return null;
  const la = d.marketData.LA;
  if (Array.isArray(la)) return la[0]?.price ?? null;
  return la.price ?? null;
}

function getClose(d) {
  if (!d?.marketData?.CL) return null;
  const cl = d.marketData.CL;
  if (Array.isArray(cl)) return cl[0]?.price ?? null;
  return cl.price ?? null;
}

function formatPrice(p) {
  return Number(p).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSize(s) {
  if (s >= 1_000_000) return (s / 1_000_000).toFixed(1) + 'M';
  if (s >= 1_000) return (s / 1_000).toFixed(0) + 'K';
  return String(s);
}

// ── Styles ──

const styles = {
  // Card compacta: misma info que antes pero ~50% más chica vertical.
  // El padding pasa de 20×24 a 10×12, los bid/offer dejan de tener su propio
  // box gigante (ahora son chips planos), y el footer condensa "Sp · Últ ·
  // hora" en una sola línea.
  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '10px 12px',
    animation: 'fade-in 0.5s ease forwards',
    opacity: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  titleGroup: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    minWidth: 0,
  },
  ticker: {
    fontFamily: "'Roboto Mono', monospace",
    fontWeight: 700,
    fontSize: 15,
    color: 'var(--neon)',
    textShadow: '0 0 6px #39ff1440',
    letterSpacing: 0.5,
  },
  label: {
    fontSize: 10,
    color: 'var(--text-dim)',
    fontWeight: 300,
    letterSpacing: 0.5,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  liveIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    animation: 'pulse-neon 2s ease-in-out infinite',
  },
  liveText: {
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 9,
    letterSpacing: 1.5,
    fontWeight: 700,
  },
  priceRow: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 6,
  },
  priceBox: {
    flex: 1,
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '6px 8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    background: 'var(--input-bg, #0d0d0d)',
    transition: 'all 0.3s ease',
  },
  priceLabel: {
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 2,
  },
  priceValue: {
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.1,
  },
  // Footer: "Sp 0.44 · Últ 1234.78 · 16:42" en una sola línea
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    paddingTop: 4,
    borderTop: '1px solid var(--border)',
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 10,
    color: 'var(--text-dim)',
    flexWrap: 'wrap',
  },
  metaLabel: {
    color: 'var(--text-dim)',
    opacity: 0.55,
    marginRight: 3,
    letterSpacing: 0.5,
  },
};

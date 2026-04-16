import { useState, useEffect, useRef } from 'react';

export default function TickerCard({ ticker, label, data, delay }) {
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

  const bid = getBid(data);
  const offer = getOffer(data);
  const bidSize = getBidSize(data);
  const offerSize = getOfferSize(data);
  const last = getLast(data);
  const hasData = bid !== null || offer !== null;
  const spread = bid && offer ? (offer - bid).toFixed(2) : null;

  return (
    <div
      style={{
        ...styles.card,
        animationDelay: `${delay}ms`,
      }}
    >
      {/* Header */}
      <div style={styles.cardHeader}>
        <div>
          <span style={styles.ticker}>{ticker}</span>
          <span style={styles.label}>{label}</span>
        </div>
        <div style={styles.liveIndicator}>
          <div
            style={{
              ...styles.liveDot,
              backgroundColor: hasData ? 'var(--neon)' : 'var(--text-dim)',
              boxShadow: hasData ? 'var(--neon-glow)' : 'none',
            }}
          />
          <span style={{ ...styles.liveText, color: hasData ? 'var(--neon)' : 'var(--text-dim)' }}>
            {hasData ? 'LIVE' : 'SIN DATOS'}
          </span>
        </div>
      </div>

      {/* Bid / Offer */}
      <div style={styles.priceRow}>
        {/* BID */}
        <div
          style={{
            ...styles.priceBox,
            borderColor: flash === 'bid' ? 'var(--neon)' : 'var(--border)',
            boxShadow: flash === 'bid' ? 'var(--neon-glow)' : 'none',
            transition: 'all 0.3s ease',
          }}
        >
          <span style={styles.priceLabel}>BID</span>
          <span style={styles.priceValue}>
            {bid !== null ? formatPrice(bid) : '—'}
          </span>
          {bidSize !== null && (
            <span style={styles.sizeText}>{formatSize(bidSize)} nom.</span>
          )}
        </div>

        {/* Spread */}
        <div style={styles.spreadCol}>
          <span style={styles.spreadLabel}>SPREAD</span>
          <span style={styles.spreadValue}>{spread ?? '—'}</span>
        </div>

        {/* OFFER */}
        <div
          style={{
            ...styles.priceBox,
            borderColor: flash === 'offer' ? 'var(--red)' : 'var(--border)',
            boxShadow: flash === 'offer' ? '0 0 8px var(--red-dim)' : 'none',
            transition: 'all 0.3s ease',
          }}
        >
          <span style={{ ...styles.priceLabel, color: 'var(--red)' }}>OFFER</span>
          <span style={{ ...styles.priceValue, color: 'var(--red)' }}>
            {offer !== null ? formatPrice(offer) : '—'}
          </span>
          {offerSize !== null && (
            <span style={styles.sizeText}>{formatSize(offerSize)} nom.</span>
          )}
        </div>
      </div>

      {/* Last price footer */}
      {last !== null && (
        <div style={styles.lastRow}>
          <span style={styles.lastLabel}>Último</span>
          <span style={styles.lastValue}>{formatPrice(last)}</span>
        </div>
      )}

      {/* Timestamp */}
      {data?.timestamp && (
        <div style={styles.tsRow}>
          <span style={styles.tsText}>
            Actualizado: {new Date(data.timestamp).toLocaleTimeString('es-AR')}
          </span>
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
  return la.price ?? null;
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
  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '20px 24px',
    animation: 'fade-in 0.5s ease forwards',
    opacity: 0,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  ticker: {
    fontFamily: "'Roboto Mono', monospace",
    fontWeight: 700,
    fontSize: 20,
    color: 'var(--neon)',
    textShadow: '0 0 6px #39ff1440',
    marginRight: 10,
  },
  label: {
    fontSize: 12,
    color: 'var(--text-dim)',
    fontWeight: 300,
    letterSpacing: 0.5,
  },
  liveIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    animation: 'pulse-neon 2s ease-in-out infinite',
  },
  liveText: {
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: 500,
  },
  priceRow: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 12,
  },
  priceBox: {
    flex: 1,
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    background: '#0d0d0d',
  },
  priceLabel: {
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: 3,
    color: 'var(--neon)',
  },
  priceValue: {
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--neon)',
  },
  sizeText: {
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 10,
    color: 'var(--text-dim)',
  },
  spreadCol: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minWidth: 56,
  },
  spreadLabel: {
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 8,
    letterSpacing: 2,
    color: 'var(--text-dim)',
  },
  spreadValue: {
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-dim)',
  },
  lastRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 10,
    borderTop: '1px solid var(--border)',
  },
  lastLabel: {
    fontSize: 11,
    color: 'var(--text-dim)',
    letterSpacing: 1,
  },
  lastValue: {
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text)',
  },
  tsRow: {
    marginTop: 8,
    textAlign: 'right',
  },
  tsText: {
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 9,
    color: 'var(--text-dim)',
  },
};

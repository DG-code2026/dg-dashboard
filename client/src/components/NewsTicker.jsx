import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';

const API = import.meta.env.VITE_API_URL || '';
const REFRESH_MS = 2 * 60 * 1000;          // 2 min en background
const SCROLL_SPEED_PX_PER_SEC = 48;        // velocidad del marquee

// Strip horizontal de titulares estilo ticker financiero. Sin scroll
// manual: animación CSS infinita pausada al hover. Los items se duplican
// (x2) en el DOM para que el loop sea continuo sin saltos visibles.
// La label "NOTICIAS" abre un modal con el listado completo filtrable.
export default function NewsTicker() {
  const [items, setItems] = useState([]);
  const [err, setErr] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const trackRef = useRef(null);

  // Fetch + refresh periódico. Si tab está oculto, no refresca (ahorra cuota).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`${API}/api/news`);
        if (!r.ok) throw new Error('http ' + r.status);
        const j = await r.json();
        if (!cancelled) {
          setItems(Array.isArray(j.items) ? j.items : []);
          setErr(false);
        }
      } catch {
        if (!cancelled) setErr(true);
      }
    }
    load();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Ajusta la duración de la animación a la cantidad real de items: si hay
  // más texto, el ciclo es más largo. Mantiene velocidad ~constante.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || items.length === 0) return;
    const halfWidth = el.scrollWidth / 2;
    const dur = halfWidth / SCROLL_SPEED_PX_PER_SEC;
    el.style.animationDuration = `${dur}s`;
  }, [items]);

  if (items.length === 0) {
    return (
      <div style={st.bar}>
        <button style={st.labelBtn} onClick={() => setModalOpen(true)} disabled>NOTICIAS</button>
        <div style={st.placeholder}>{err ? 'no se pudieron cargar las noticias' : 'cargando…'}</div>
      </div>
    );
  }

  const looped = [...items, ...items];

  return (
    <>
      <div style={st.bar}>
        <button
          style={st.labelBtn}
          onClick={() => setModalOpen(true)}
          title="Ver todas las noticias"
        >
          NOTICIAS <span style={st.labelArrow}>↗</span>
        </button>
        <div style={st.viewport} className="news-viewport">
          <div ref={trackRef} className="news-track" style={st.track}>
            {looped.map((it, i) => (
              <a key={`${it.link}-${i}`} href={it.link} target="_blank" rel="noopener noreferrer" style={st.item} title={it.title}>
                <span style={st.dot} />
                <span style={st.source}>{it.source}</span>
                <span style={st.titleText}>{it.title}</span>
                <span style={st.time}>{relTime(it.date)}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
      {modalOpen && <NewsModal items={items} onClose={() => setModalOpen(false)} />}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
//  MODAL — listado completo con filtros
// ═══════════════════════════════════════════════════════════════
function NewsModal({ items, onClose }) {
  const [filter, setFilter] = useState('all');   // all | markets | politics | general
  const [search, setSearch] = useState('');

  // Cerrar con Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const counts = useMemo(() => {
    const c = { all: items.length, markets: 0, politics: 0, general: 0 };
    for (const it of items) c[it.category] = (c[it.category] || 0) + 1;
    return c;
  }, [items]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(it => {
      if (filter !== 'all' && it.category !== filter) return false;
      if (q && !it.title.toLowerCase().includes(q) && !it.source.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, filter, search]);

  const TABS = [
    { id: 'all',      label: 'TODAS',    count: counts.all },
    { id: 'markets',  label: 'MERCADOS', count: counts.markets },
    { id: 'politics', label: 'POLÍTICA', count: counts.politics },
    { id: 'general',  label: 'OTRAS',    count: counts.general },
  ];

  return createPortal(
    <div style={st.backdrop} onClick={onClose}>
      <div style={st.modal} onClick={e => e.stopPropagation()}>
        <div style={st.modalHead}>
          <div style={st.modalTitle}>NOTICIAS · {visible.length} de {items.length}</div>
          <button onClick={onClose} style={st.modalX}>✕</button>
        </div>

        <div style={st.modalTabs}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setFilter(t.id)}
              style={{ ...st.tab, ...(filter === t.id ? st.tabActive : {}) }}
            >
              {t.label} <span style={st.tabCount}>{t.count}</span>
            </button>
          ))}
          <input
            type="text"
            placeholder="Buscar título o medio…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={st.search}
          />
        </div>

        <div style={st.list}>
          {visible.length === 0 && (
            <div style={st.empty}>Sin resultados.</div>
          )}
          {visible.map(it => (
            <a key={it.link} href={it.link} target="_blank" rel="noopener noreferrer" style={st.listItem}>
              <div style={st.itemHead}>
                <span style={st.itemSource}>{it.source}</span>
                <span style={{ ...st.catChip, ...catStyles[it.category] }}>{catLabels[it.category]}</span>
                <span style={st.itemTime}>{relTime(it.date)}</span>
              </div>
              <div style={st.itemTitle}>{it.title}</div>
            </a>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

function relTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1)   return 'ahora';
  if (m < 60)  return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

const catLabels = { markets: 'MERCADOS', politics: 'POLÍTICA', general: 'GENERAL' };
const catStyles = {
  markets:  { color: '#22c55e', borderColor: '#22c55e60' },
  politics: { color: '#f59e0b', borderColor: '#f59e0b60' },
  general:  { color: 'var(--text-dim)', borderColor: 'var(--border)' },
};

const st = {
  // ─── strip ───
  bar: {
    display: 'flex', alignItems: 'center', gap: 0,
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 16,
    fontFamily: "'Roboto Mono', monospace",
    height: 36,
  },
  labelBtn: {
    flex: '0 0 auto',
    padding: '0 14px', height: '100%',
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontSize: 9, fontWeight: 700, letterSpacing: 2,
    color: 'var(--neon)',
    background: 'rgba(99,134,172,0.08)',
    border: 'none', borderRight: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: "'Roboto Mono', monospace",
    transition: 'background 0.15s',
  },
  labelArrow: { fontSize: 11, opacity: 0.7 },
  viewport: { flex: 1, overflow: 'hidden', height: '100%', position: 'relative' },
  track: {
    display: 'inline-flex', alignItems: 'center', gap: 0,
    height: '100%', willChange: 'transform',
    animation: 'news-marquee linear infinite',
  },
  item: {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '0 18px',
    textDecoration: 'none', color: 'var(--text)',
    fontSize: 11, whiteSpace: 'nowrap',
    borderRight: '1px solid var(--border)',
    height: '100%',
  },
  dot: {
    width: 5, height: 5, borderRadius: '50%',
    background: 'var(--neon)', boxShadow: '0 0 6px var(--neon)',
    flexShrink: 0,
  },
  source: { fontSize: 9, fontWeight: 700, letterSpacing: 1, color: 'var(--neon)', textTransform: 'uppercase' },
  titleText: { color: 'var(--text)', fontFamily: 'inherit' },
  time: { fontSize: 9, color: 'var(--text-dim)', marginLeft: 4 },
  placeholder: { padding: '0 14px', fontSize: 10, color: 'var(--text-dim)' },

  // ─── modal ───
  backdrop: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 20,
  },
  modal: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-neon)',
    borderRadius: 8,
    width: '100%', maxWidth: 880, maxHeight: '90vh',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
  },
  modalHead: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 22px',
    borderBottom: '1px solid var(--border)',
  },
  modalTitle: {
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    fontSize: 18, letterSpacing: 3, color: 'var(--title-color)',
  },
  modalX: { background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 18, cursor: 'pointer' },

  modalTabs: {
    display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
    padding: '12px 22px',
    borderBottom: '1px solid var(--border)',
  },
  tab: {
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '6px 12px',
    color: 'var(--text-dim)',
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
    cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  },
  tabActive: { borderColor: 'var(--neon)', color: 'var(--neon)', background: 'rgba(99,134,172,0.08)' },
  tabCount: { fontSize: 9, opacity: 0.7, fontWeight: 400 },
  search: {
    marginLeft: 'auto', flex: '1 1 200px',
    background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 4,
    padding: '7px 10px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit',
    minWidth: 160,
  },

  list: {
    overflowY: 'auto', flex: 1,
    padding: '8px 0',
  },
  empty: { padding: 40, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 },
  listItem: {
    display: 'block',
    padding: '12px 22px',
    textDecoration: 'none',
    borderBottom: '1px solid var(--border)',
    transition: 'background 0.1s',
  },
  itemHead: {
    display: 'flex', alignItems: 'center', gap: 10,
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 9, marginBottom: 4,
  },
  itemSource: { color: 'var(--neon)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' },
  catChip: {
    border: '1px solid', borderRadius: 3, padding: '1px 6px',
    fontSize: 8, fontWeight: 700, letterSpacing: 1,
  },
  itemTime: { color: 'var(--text-dim)', marginLeft: 'auto' },
  itemTitle: {
    color: 'var(--text)', fontSize: 13, lineHeight: 1.4,
    fontFamily: "'Montserrat', sans-serif",
  },
};

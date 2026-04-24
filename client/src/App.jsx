import { useState, useEffect, useRef } from 'react';
import { useMarketData } from './hooks/useMarketData';
import TickerCard from './components/TickerCard';
import DollarRates from './components/DollarRates';
import StatusBar from './components/StatusBar';
import RentaFijaCorporativa from './components/RentaFijaCorporativa';
import BonosSoberanos from './components/BonosSoberanos';
import BonosSubsoberanos from './components/BonosSubsoberanos';
import CarterasPage from './components/CarterasPage';
import TradeTrackingPage from './components/TradeTrackingPage';
import PropuestasPage from './components/PropuestasPage';
import FondosPershing from './components/FondosPershing';
import HomePage from './components/HomePage';
import CalculadoraRotaciones from './components/CalculadoraRotaciones';

const TICKERS = ['AL30', 'AL30D', 'AL30C'];

// El orden define cómo aparecen en el menú desplegable.
const TABS = [
  { id: 'home', label: 'INICIO', group: 'Principal' },
  { id: 'fx', label: 'TIPO DE CAMBIO', group: 'Mercado' },
  { id: 'rf', label: 'RENTA FIJA CORP.', group: 'Mercado' },
  { id: 'sob', label: 'BONOS SOBERANOS', group: 'Mercado' },
  { id: 'sub', label: 'SUBSOBERANOS', group: 'Mercado' },
  { id: 'rot', label: 'CALCULADORA DE ROTACIONES', group: 'Herramientas' },
  { id: 'trades', label: 'TRADE TRACKING', group: 'Herramientas' },
  { id: 'cart', label: 'CARTERAS', group: 'Gestión' },
  { id: 'prop', label: 'PROPUESTAS', group: 'Gestión' },
  { id: 'pershing', label: 'FONDOS PERSHING', group: 'Gestión' },
];

export default function App() {
  const { data, connected, primaryConnected } = useMarketData();
  const [commission, setCommission] = useState(0.6);
  // Home es la landing por defecto — antes era 'fx'.
  const [activeTab, setActiveTab] = useState('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('theme') || 'dark'; } catch { return 'dark'; } });
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); try { localStorage.setItem('theme', theme); } catch {} }, [theme]);

  // Cerrar el menú con click afuera o Escape.
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const activeTabLabel = TABS.find(t => t.id === activeTab)?.label || '';
  // Agrupamos las tabs conservando el orden de aparición de cada grupo.
  const grouped = TABS.reduce((acc, t) => {
    const g = t.group || '—';
    if (!acc.find(x => x.name === g)) acc.push({ name: g, items: [] });
    acc.find(x => x.name === g).items.push(t);
    return acc;
  }, []);

  const selectTab = (id) => { setActiveTab(id); setMenuOpen(false); };

  return (
    <div style={st.container}>
      <header style={st.header}>
        <div style={st.headLeft} ref={menuRef}>
          <button
            style={{ ...st.menuBtn, ...(menuOpen ? st.menuBtnOpen : {}) }}
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Abrir menú"
            aria-expanded={menuOpen}
          >
            <span style={st.hamburger}>
              <span style={{ ...st.hamLine, top: 0,  ...(menuOpen ? st.hamLineTop : {}) }} />
              <span style={{ ...st.hamLine, top: 5,  ...(menuOpen ? st.hamLineMid : {}) }} />
              <span style={{ ...st.hamLine, top: 10, ...(menuOpen ? st.hamLineBot : {}) }} />
            </span>
            <span style={st.menuBtnLabel}>{activeTabLabel}</span>
            <span style={st.menuBtnCaret}>{menuOpen ? '▴' : '▾'}</span>
          </button>

          {menuOpen && (
            <div style={st.dropdown} role="menu">
              {grouped.map((g, gi) => (
                <div key={g.name} style={{ ...st.dropdownGroup, ...(gi > 0 ? st.dropdownGroupSep : {}) }}>
                  <div style={st.dropdownGroupHead}>{g.name}</div>
                  {g.items.map(tab => {
                    const active = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        role="menuitem"
                        onClick={() => selectTab(tab.id)}
                        style={{ ...st.dropdownItem, ...(active ? st.dropdownItemActive : {}) }}
                      >
                        <span style={st.dropdownItemDot}>{active ? '●' : '○'}</span>
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={st.logoArea}>
          <img
            src={theme === 'dark' ? '/logos/DG%20tema%20oscuro.png' : '/logos/DG-tema-claro.svg'}
            alt="Delfino Gaviña"
            style={st.logoImg}
          />
        </div>

        <div style={st.headRight}>
          <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} style={st.themeBtn}>{theme === 'dark' ? '☀' : '☾'}</button>
          <StatusBar connected={connected} primaryConnected={primaryConnected} />
        </div>
      </header>

      {activeTab === 'home' && (
        <section>
          <SH title="INICIO" />
          <p style={st.sectionSub}>Panel general · próximos pagos · accesos rápidos</p>
          <HomePage />
        </section>
      )}

      {activeTab === 'fx' && (<>
        <section><SH title="COTIZACIONES AL30" /><p style={st.sectionSub}>CI · Contado Inmediato</p><div style={st.grid3}>{TICKERS.map((t, i) => <TickerCard key={t} ticker={t} label={({ AL30: 'Pesos (ARS)', AL30D: 'Dólar MEP (USD-D)', AL30C: 'Dólar Cable (USD-C)' })[t]} data={data[t]} delay={i * 100} />)}</div></section>
        <section style={{ marginTop: 48 }}><SH title="DÓLARES FINANCIEROS" /><div style={st.commRow}><span style={st.commLabel}>COMISIÓN</span><div style={st.commWrap}><input type="number" step="0.1" min="0" max="10" value={commission} onChange={e => setCommission(parseFloat(e.target.value) || 0)} style={st.commInput} /><span style={st.commPct}>%</span></div><span style={st.commNote}>por operación (se aplica a cada pata: compra y venta de bonos)</span></div><DollarRates data={data} commission={commission / 100} /></section>
      </>)}

      {activeTab === 'rf' && <section><SH title="OBLIGACIONES NEGOCIABLES" /><p style={st.sectionSub}>API PPI · Settlement A-24HS</p><RentaFijaCorporativa /></section>}

      {activeTab === 'sob' && <section><SH title="BONOS SOBERANOS" /><p style={st.sectionSub}>API PPI · Settlement A-48HS (MEP)</p><BonosSoberanos /></section>}

      {activeTab === 'sub' && <section><SH title="BONOS SUBSOBERANOS" /><p style={st.sectionSub}>API PPI · Settlement A-48HS (MEP)</p><BonosSubsoberanos /></section>}

      {activeTab === 'rot' && <section><SH title="CALCULADORA DE ROTACIONES" /><p style={st.sectionSub}>Bid/offer en vivo · WebSocket Primary · comisión aplicada en compra y venta</p><CalculadoraRotaciones marketData={data} primaryConnected={primaryConnected} /></section>}

      {activeTab === 'cart' && <section><SH title="CARTERAS" /><p style={st.sectionSub}>Gestión de carteras de inversión</p><CarterasPage /></section>}

      {activeTab === 'trades' && <section><SH title="TRADE TRACKING" /><p style={st.sectionSub}>Seguimiento de operaciones con cotización en tiempo real · WebSocket Primary · A-24HS</p><TradeTrackingPage marketData={data} primaryConnected={primaryConnected} /></section>}

      {activeTab === 'prop' && <section><SH title="PROPUESTAS DE INVERSIÓN" /><p style={st.sectionSub}>Armado de carteras y flyer institucional</p><PropuestasPage /></section>}

      {activeTab === 'pershing' && <section><SH title="FONDOS PERSHING" /><p style={st.sectionSub}>Listado de fondos disponibles · ISIN copiable · filtros por nombre y casa</p><FondosPershing /></section>}

      <footer style={st.footer}><span style={st.footerText}>DELFINO GAVIÑA · Inversiones · Primary API · MATBA ROFEX · ByMA · PPI</span></footer>
    </div>
  );
}
function SH({ title }) { return <div style={st.sh}><div style={st.shLine} /><h2 style={st.shTitle}>{title}</h2><div style={st.shLine} /></div>; }
const st = {
  container: { minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: '24px 32px', maxWidth: 1400, margin: '0 auto' },
  header: { display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', paddingBottom: 20, marginBottom: 32, borderBottom: '1px solid var(--border)', gap: 16 },
  headLeft: { position: 'relative', justifySelf: 'start', display: 'flex', alignItems: 'center' },
  headRight: { justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 12 },
  logoArea: { display: 'flex', alignItems: 'center', justifySelf: 'center' },
  logoImg: { height: 64, width: 'auto', display: 'block' },
  themeBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 18, padding: '6px 10px', cursor: 'pointer', lineHeight: 1 },

  // ── Botón hamburger + dropdown ──
  menuBtn: {
    display: 'flex', alignItems: 'center', gap: 12,
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '10px 14px', cursor: 'pointer',
    fontFamily: "'Montserrat', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 2.5,
    color: 'var(--neon)',
    transition: 'border-color 0.15s, background 0.15s',
    minWidth: 210,
  },
  menuBtnOpen: { borderColor: 'var(--neon)', background: 'rgba(0,255,170,0.04)' },
  menuBtnLabel: { flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  menuBtnCaret: { fontSize: 9, color: 'var(--text-dim)' },

  // Animación hamburger → X
  hamburger: { position: 'relative', width: 16, height: 12, flexShrink: 0 },
  hamLine: { position: 'absolute', left: 0, width: 16, height: 2, background: 'var(--neon)', borderRadius: 1, transition: 'all 0.22s ease' },
  hamLineTop: { transform: 'translateY(5px) rotate(45deg)' },
  hamLineMid: { opacity: 0 },
  hamLineBot: { transform: 'translateY(-5px) rotate(-45deg)' },

  dropdown: {
    position: 'absolute', top: 'calc(100% + 8px)', left: 0,
    background: 'var(--bg-card)', border: '1px solid var(--border-neon)', borderRadius: 6,
    padding: '8px 0', minWidth: 280,
    boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
    zIndex: 200, maxHeight: '70vh', overflowY: 'auto',
  },
  dropdownGroup: { padding: '6px 0' },
  dropdownGroupSep: { borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 8 },
  dropdownGroupHead: {
    padding: '4px 16px 6px', fontFamily: "'Roboto Mono',monospace",
    fontSize: 8, fontWeight: 700, letterSpacing: 3,
    color: 'var(--text-dim)', textTransform: 'uppercase',
  },
  dropdownItem: {
    display: 'flex', alignItems: 'center', gap: 10,
    width: '100%', padding: '8px 16px',
    background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
    fontFamily: "'Montserrat', sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: 2,
    color: 'var(--text-dim)',
    transition: 'background 0.1s, color 0.1s',
  },
  dropdownItemActive: { color: 'var(--neon)', background: 'rgba(0,255,170,0.06)' },
  dropdownItemDot: { fontSize: 8, color: 'inherit', width: 10, textAlign: 'center' },

  sh: { display: 'flex', alignItems: 'center', gap: 20, marginBottom: 8 }, shLine: { flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, var(--border-neon), transparent)' },
  shTitle: { fontFamily: "'Cormorant Garamond', Georgia, serif", fontWeight: 600, fontSize: 16, letterSpacing: 6, color: 'var(--neon)', whiteSpace: 'nowrap' },
  sectionSub: { textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', marginBottom: 24, letterSpacing: 1 },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 },
  commRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 24 },
  commLabel: { fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 500, letterSpacing: 2, color: 'var(--text-dim)' },
  commWrap: { display: 'flex', alignItems: 'center', gap: 4, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px' },
  commInput: { fontFamily: "'Roboto Mono', monospace", fontSize: 14, fontWeight: 700, color: 'var(--neon)', background: 'transparent', border: 'none', outline: 'none', width: 50, textAlign: 'right' },
  commPct: { fontFamily: "'Roboto Mono', monospace", fontSize: 12, color: 'var(--neon)' },
  commNote: { fontFamily: "'Montserrat', sans-serif", fontSize: 9, color: 'var(--text-dim)', opacity: 0.7, maxWidth: 200, lineHeight: 1.4 },
  footer: { marginTop: 48, paddingTop: 20, borderTop: '1px solid var(--border)', textAlign: 'center' },
  footerText: { fontSize: 10, color: 'var(--text-dim)', letterSpacing: 2 },
};

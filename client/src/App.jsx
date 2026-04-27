import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import {
  BrowserRouter, Routes, Route, Outlet,
  useNavigate, useLocation, useOutletContext,
} from 'react-router-dom';
import { useMarketData } from './hooks/useMarketData';
import StatusBar from './components/StatusBar';
import TickerCard from './components/TickerCard';
import DollarRates from './components/DollarRates';

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTING + LAZY LOADING
//
//  Cada página vive en su propio chunk (code-splitting con `lazy()`):
//  el bundle inicial sólo trae el shell + Home + FX (los más usados).
//  El resto se descarga la primera vez que el usuario entra a esa ruta.
//  La data del WS de Primary se inicializa una sola vez en `Layout` y se
//  comparte con las rutas que la necesitan vía `useOutletContext()`.
// ─────────────────────────────────────────────────────────────────────────────

const HomePage              = lazy(() => import('./components/HomePage'));
const RentaFijaCorporativa  = lazy(() => import('./components/RentaFijaCorporativa'));
const BonosSoberanos        = lazy(() => import('./components/BonosSoberanos'));
const BonosSubsoberanos     = lazy(() => import('./components/BonosSubsoberanos'));
const CarterasPage          = lazy(() => import('./components/CarterasPage'));
const TradeTrackingPage     = lazy(() => import('./components/TradeTrackingPage'));
const PropuestasPage        = lazy(() => import('./components/PropuestasPage'));
const CartasPage            = lazy(() => import('./components/CartasPage'));
const FondosPershing        = lazy(() => import('./components/FondosPershing'));
const CalculadoraRotaciones = lazy(() => import('./components/CalculadoraRotaciones'));
const AvisosSaldoPage       = lazy(() => import('./components/AvisosSaldoPage'));

const TICKERS = ['AL30', 'AL30D', 'AL30C'];

// El orden define cómo aparecen en el menú desplegable.
const TABS = [
  { path: '/',             label: 'INICIO',                    group: 'Principal' },
  { path: '/fx',           label: 'TIPO DE CAMBIO',            group: 'Mercado' },
  { path: '/renta-fija',   label: 'RENTA FIJA CORP.',          group: 'Mercado' },
  { path: '/soberanos',    label: 'BONOS SOBERANOS',           group: 'Mercado' },
  { path: '/subsoberanos', label: 'SUBSOBERANOS',              group: 'Mercado' },
  { path: '/pershing',     label: 'FONDOS PERSHING',           group: 'Mercado' },
  { path: '/rotaciones',   label: 'CALCULADORA DE ROTACIONES', group: 'Herramientas' },
  { path: '/trades',       label: 'TRADE TRACKING',            group: 'Herramientas' },
  { path: '/carteras',     label: 'CARTERAS',                  group: 'Gestión' },
  { path: '/propuestas',   label: 'PROPUESTAS',                group: 'Gestión' },
  { path: '/cartas',       label: 'CARTAS',                    group: 'Gestión' },
  { path: '/avisos-saldo', label: 'AVISO DE SALDO',            group: 'Gestión' },
];

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index               element={<HomeRoute />} />
          <Route path="fx"           element={<FxRoute />} />
          <Route path="renta-fija"   element={<RfRoute />} />
          <Route path="soberanos"    element={<SobRoute />} />
          <Route path="subsoberanos" element={<SubRoute />} />
          <Route path="rotaciones"   element={<RotRoute />} />
          <Route path="trades"       element={<TradesRoute />} />
          <Route path="carteras"     element={<CartRoute />} />
          <Route path="propuestas"   element={<PropRoute />} />
          <Route path="cartas"       element={<CartasRoute />} />
          <Route path="pershing"     element={<PershingRoute />} />
          <Route path="avisos-saldo" element={<AvisosRoute />} />
          <Route path="*"            element={<NotFoundRoute />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

// ══════════════════════════════════════════════
//  LAYOUT
//
//  Header con menú desplegable + Outlet para la ruta activa.
//  Todo lo "pesado" del Outlet (lazy imports) cae bajo un Suspense compartido.
// ══════════════════════════════════════════════
function Layout() {
  const { data, connected, primaryConnected } = useMarketData();
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('theme') || 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch {}
  }, [theme]);

  const navigate = useNavigate();
  const location = useLocation();
  const menuRef = useRef(null);

  // Cerrar el menú con click afuera o Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey  = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Match exacto del path. Para "/" activa Home; para el resto, comparación directa.
  const activePath = location.pathname || '/';
  const activeTab = TABS.find(t => t.path === activePath) || TABS[0];

  // Agrupamos las tabs conservando el orden de aparición de cada grupo.
  const grouped = TABS.reduce((acc, t) => {
    const g = t.group || '—';
    if (!acc.find(x => x.name === g)) acc.push({ name: g, items: [] });
    acc.find(x => x.name === g).items.push(t);
    return acc;
  }, []);

  const goTo = (path) => { navigate(path); setMenuOpen(false); };

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
            <span style={st.menuBtnLabel}>{activeTab.label}</span>
            <span style={st.menuBtnCaret}>{menuOpen ? '▴' : '▾'}</span>
          </button>

          {menuOpen && (
            <div style={st.dropdown} role="menu">
              {grouped.map((g, gi) => (
                <div key={g.name} style={{ ...st.dropdownGroup, ...(gi > 0 ? st.dropdownGroupSep : {}) }}>
                  <div style={st.dropdownGroupHead}>{g.name}</div>
                  {g.items.map(tab => {
                    const active = activePath === tab.path;
                    return (
                      <button
                        key={tab.path}
                        role="menuitem"
                        onClick={() => goTo(tab.path)}
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

      {/* Suspense compartido para todas las rutas lazy. */}
      <Suspense fallback={<RouteLoader />}>
        <Outlet context={{ data, connected, primaryConnected }} />
      </Suspense>

      <footer style={st.footer}>
        <span style={st.footerText}>DELFINO GAVIÑA · Inversiones · Primary API · MATBA ROFEX · ByMA · PPI</span>
      </footer>
    </div>
  );
}

// Helper para que las rutas accedan al market data sin prop drilling.
function useShellCtx() { return useOutletContext(); }

// ══════════════════════════════════════════════
//  ROUTES (un wrapper liviano por cada página)
// ══════════════════════════════════════════════

function HomeRoute() {
  return (
    <section>
      <SH title="INICIO" />
      <p style={st.sectionSub}>Panel general · próximos pagos · accesos rápidos</p>
      <HomePage />
    </section>
  );
}

function FxRoute() {
  const { data } = useShellCtx();
  const [commission, setCommission] = useState(0.6);
  return (
    <>
      <section>
        <SH title="COTIZACIONES AL30" />
        <p style={st.sectionSub}>CI · Contado Inmediato</p>
        <div style={st.grid3}>
          {TICKERS.map((t, i) => (
            <TickerCard
              key={t}
              ticker={t}
              label={({ AL30: 'Pesos (ARS)', AL30D: 'Dólar MEP (USD-D)', AL30C: 'Dólar Cable (USD-C)' })[t]}
              data={data[t]}
              delay={i * 100}
            />
          ))}
        </div>
      </section>
      <section style={{ marginTop: 48 }}>
        <SH title="DÓLARES FINANCIEROS" />
        <div style={st.commRow}>
          <span style={st.commLabel}>COMISIÓN</span>
          <div style={st.commWrap}>
            <input
              type="number" step="0.1" min="0" max="10"
              value={commission}
              onChange={e => setCommission(parseFloat(e.target.value) || 0)}
              style={st.commInput}
            />
            <span style={st.commPct}>%</span>
          </div>
          <span style={st.commNote}>por operación (se aplica a cada pata: compra y venta de bonos)</span>
        </div>
        <DollarRates data={data} commission={commission / 100} />
      </section>
    </>
  );
}

function RfRoute() {
  return <section><SH title="OBLIGACIONES NEGOCIABLES" /><p style={st.sectionSub}>API PPI · Settlement A-24HS</p><RentaFijaCorporativa /></section>;
}
function SobRoute() {
  return <section><SH title="BONOS SOBERANOS" /><p style={st.sectionSub}>API PPI · Settlement A-48HS (MEP)</p><BonosSoberanos /></section>;
}
function SubRoute() {
  return <section><SH title="BONOS SUBSOBERANOS" /><p style={st.sectionSub}>API PPI · Settlement A-48HS (MEP)</p><BonosSubsoberanos /></section>;
}
function RotRoute() {
  const { data, primaryConnected } = useShellCtx();
  return <section><SH title="CALCULADORA DE ROTACIONES" /><p style={st.sectionSub}>Bid/offer en vivo · WebSocket Primary · comisión aplicada en compra y venta</p><CalculadoraRotaciones marketData={data} primaryConnected={primaryConnected} /></section>;
}
function TradesRoute() {
  const { data, primaryConnected } = useShellCtx();
  return <section><SH title="TRADE TRACKING" /><p style={st.sectionSub}>Seguimiento de operaciones con cotización en tiempo real · WebSocket Primary · A-24HS</p><TradeTrackingPage marketData={data} primaryConnected={primaryConnected} /></section>;
}
function CartRoute() {
  return <section><SH title="CARTERAS" /><p style={st.sectionSub}>Gestión de carteras de inversión</p><CarterasPage /></section>;
}
function PropRoute() {
  return <section><SH title="PROPUESTAS DE INVERSIÓN" /><p style={st.sectionSub}>Armado de carteras y flyer institucional</p><PropuestasPage /></section>;
}
function CartasRoute() {
  return <section><SH title="CARTAS" /><CartasPage /></section>;
}
function PershingRoute() {
  return <section><SH title="FONDOS PERSHING" /><p style={st.sectionSub}>Listado de fondos disponibles · ISIN copiable · filtros por nombre y casa</p><FondosPershing /></section>;
}
function AvisosRoute() {
  return <section><SH title="AVISO DE SALDO" /><p style={st.sectionSub}>Cargá una planilla de Sheets · generá tarjetas con la imagen institucional + mensaje listo para copiar</p><AvisosSaldoPage /></section>;
}

function NotFoundRoute() {
  const navigate = useNavigate();
  return (
    <section style={{ textAlign: 'center', padding: '60px 20px' }}>
      <SH title="404" />
      <p style={st.sectionSub}>Esta página no existe.</p>
      <button onClick={() => navigate('/')} style={st.themeBtn}>← Volver al inicio</button>
    </section>
  );
}

function RouteLoader() {
  return (
    <div style={{
      padding: '80px 20px', textAlign: 'center', color: 'var(--text-dim)',
      fontFamily: "'Roboto Mono',monospace", fontSize: 11, letterSpacing: 3,
    }}>
      CARGANDO…
    </div>
  );
}

function SH({ title }) {
  return <div style={st.sh}><div style={st.shLine} /><h2 style={st.shTitle}>{title}</h2><div style={st.shLine} /></div>;
}

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

  sh: { display: 'flex', alignItems: 'center', gap: 20, marginBottom: 8 },
  shLine: { flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, var(--border-neon), transparent)' },
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

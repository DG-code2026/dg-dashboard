import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import {
  BrowserRouter, Routes, Route, Outlet,
  useNavigate, useLocation, useOutletContext,
} from 'react-router-dom';
import { useMarketData } from './hooks/useMarketData';
import StatusBar from './components/StatusBar';
import TickerCard from './components/TickerCard';
import DollarRates from './components/DollarRates';
import RatioIntradayCharts from './components/RatioIntradayCharts';

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
            <span className="menu-btn-label" style={st.menuBtnLabel}>{activeTab.label}</span>
            <span className="menu-btn-caret" style={st.menuBtnCaret}>{menuOpen ? '▴' : '▾'}</span>
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

// Hook compartido para el estado de mercado (BYMA abierto/cerrado). Pollea
// cada 60s sólo cuando la pestaña está visible. Vive acá para que múltiples
// componentes de la página de FX (TickerCard, DollarRates) puedan reusar el
// mismo poll sin disparar requests redundantes.
const FX_API_BASE = import.meta.env.VITE_API_URL || '';
function useMarketStatusShared(intervalMs = 60_000) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`${FX_API_BASE}/api/market/status`);
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setStatus(j);
      } catch { /* silencioso */ }
    }
    load();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [intervalMs]);
  return status;
}

// ══════════════════════════════════════════════
//  ROUTES (un wrapper liviano por cada página)
// ══════════════════════════════════════════════

function HomeRoute() {
  return (
    <section>
      <SH title="INICIO" />
      <HomePage />
    </section>
  );
}

function FxRoute() {
  const { data, primaryConnected } = useShellCtx();
  const [commission, setCommission] = useState(0.6);
  const market = useMarketStatusShared();
  const marketOpen = !!market?.open;
  return (
    <>
      <section>
        <SH title="COTIZACIONES AL30" />
        <div style={st.grid3}>
          {TICKERS.map((t, i) => (
            <TickerCard
              key={t}
              ticker={t}
              label={({ AL30: 'Pesos (ARS)', AL30D: 'Dólar MEP (USD-D)', AL30C: 'Dólar Cable (USD-C)' })[t]}
              data={data[t]}
              marketOpen={marketOpen}
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
        <DollarRates data={data} commission={commission / 100} market={market} />
      </section>
      <section style={{ marginTop: 32 }}>
        <SH title="EVOLUCIÓN DEL TIPO DE CAMBIO" />
        <RatioIntradayCharts connected={primaryConnected} />
      </section>
    </>
  );
}

function RfRoute() {
  return <section><SH title="OBLIGACIONES NEGOCIABLES" /><RentaFijaCorporativa /></section>;
}
function SobRoute() {
  return <section><SH title="BONOS SOBERANOS" /><BonosSoberanos /></section>;
}
function SubRoute() {
  return <section><SH title="BONOS SUBSOBERANOS" /><BonosSubsoberanos /></section>;
}
function RotRoute() {
  const { data, primaryConnected } = useShellCtx();
  return <section><SH title="CALCULADORA DE ROTACIONES" /><CalculadoraRotaciones marketData={data} primaryConnected={primaryConnected} /></section>;
}
function TradesRoute() {
  const { data, primaryConnected } = useShellCtx();
  return <section><SH title="TRADE TRACKING" /><TradeTrackingPage marketData={data} primaryConnected={primaryConnected} /></section>;
}
function CartRoute() {
  return <section><SH title="CARTERAS" /><CarterasPage /></section>;
}
function PropRoute() {
  return <section><SH title="PROPUESTAS DE INVERSIÓN" /><PropuestasPage /></section>;
}
function CartasRoute() {
  return <section><SH title="CARTAS" /><CartasPage /></section>;
}
function PershingRoute() {
  return <section><SH title="FONDOS PERSHING" /><FondosPershing /></section>;
}
function AvisosRoute() {
  return <section><SH title="AVISO DE SALDO" /><AvisosSaldoPage /></section>;
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
  // Padding lateral y vertical responsivos (vars en index.css que cambian
  // a 1024px y 720px). El maxWidth absoluto se mantiene para no estirar
  // demás en monitores de 1440+.
  container: { minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: 'var(--page-pad-y) var(--page-pad-x)', maxWidth: 1400, margin: '0 auto' },
  header: { display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', paddingBottom: 16, marginBottom: 'var(--section-gap)', borderBottom: '1px solid var(--border)', gap: 12 },
  headLeft: { position: 'relative', justifySelf: 'start', display: 'flex', alignItems: 'center' },
  headRight: { justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 12 },
  logoArea: { display: 'flex', alignItems: 'center', justifySelf: 'center' },
  // El logo escala con --logo-h (64px desktop / 44px mobile).
  logoImg: { height: 'var(--logo-h)', width: 'auto', display: 'block' },
  themeBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 18, padding: '6px 10px', cursor: 'pointer', lineHeight: 1 },

  // ── Botón hamburger + dropdown ──
  // En móvil --menu-min-w cae a 56px y el label/caret se ocultan via CSS
  // (className "menu-btn-label" / "menu-btn-caret" en index.css), así el
  // botón pasa a ser sólo el ícono — más espacio para el logo y el theme btn.
  menuBtn: {
    display: 'flex', alignItems: 'center', gap: 12,
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '10px 14px', cursor: 'pointer',
    fontFamily: "'Montserrat', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 2.5,
    color: 'var(--neon)',
    transition: 'border-color 0.15s, background 0.15s',
    minWidth: 'var(--menu-min-w)',
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

  // marginBottom 24 (antes 8): da más aire entre el título y el contenido
  // de cada página → jerarquía visual más clara.
  sh: { display: 'flex', alignItems: 'center', gap: 20, marginBottom: 24 },
  shLine: { flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, var(--border-neon), transparent)', minWidth: 8 },
  // shTitle usa --title-color (white en dark, navy en light) en lugar de
  // --neon. El neon queda reservado para chips/links/borders.
  shTitle: { fontFamily: "'Cormorant Garamond', Georgia, serif", fontWeight: 600, fontSize: 'clamp(13px, 3.5vw, 16px)', letterSpacing: 'clamp(2px, 1vw, 6px)', color: 'var(--title-color)', whiteSpace: 'nowrap', textAlign: 'center' },
  sectionSub: { textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', marginBottom: 24, letterSpacing: 1 },
  // Las 3 cards de cotización AL30 son compactas (TickerCard "compact mode"),
  // así que les damos columnas de mismo tamaño que ocupen menos espacio
  // vertical. minmax 220px permite 3-en-fila en desktop y wrap en móvil.
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 },
  // flexWrap permite que en mobile el "comisión + input + nota" caigan en
   // varias líneas en vez de overflow horizontal.
  commRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' },
  commLabel: { fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 500, letterSpacing: 2, color: 'var(--text-dim)' },
  commWrap: { display: 'flex', alignItems: 'center', gap: 4, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px' },
  commInput: { fontFamily: "'Roboto Mono', monospace", fontSize: 14, fontWeight: 700, color: 'var(--neon)', background: 'transparent', border: 'none', outline: 'none', width: 50, textAlign: 'right' },
  commPct: { fontFamily: "'Roboto Mono', monospace", fontSize: 12, color: 'var(--neon)' },
  commNote: { fontFamily: "'Montserrat', sans-serif", fontSize: 9, color: 'var(--text-dim)', opacity: 0.7, maxWidth: 200, lineHeight: 1.4 },
  footer: { marginTop: 48, paddingTop: 20, borderTop: '1px solid var(--border)', textAlign: 'center' },
  footerText: { fontSize: 10, color: 'var(--text-dim)', letterSpacing: 2 },
};

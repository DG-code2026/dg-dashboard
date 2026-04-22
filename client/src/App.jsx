import { useState, useEffect } from 'react';
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

const TICKERS = ['AL30', 'AL30D', 'AL30C'];
const TABS = [{ id: 'fx', label: 'TIPO DE CAMBIO' }, { id: 'rf', label: 'RENTA FIJA CORP.' }, { id: 'sob', label: 'BONOS SOBERANOS' }, { id: 'sub', label: 'SUBSOBERANOS' }, { id: 'cart', label: 'CARTERAS' }, { id: 'trades', label: 'TRADE TRACKING' }, { id: 'prop', label: 'PROPUESTAS' }, { id: 'pershing', label: 'FONDOS PERSHING' }];

export default function App() {
  const { data, connected, primaryConnected } = useMarketData();
  const [commission, setCommission] = useState(0.6);
  const [activeTab, setActiveTab] = useState('fx');
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('theme') || 'dark'; } catch { return 'dark'; } });
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); try { localStorage.setItem('theme', theme); } catch {} }, [theme]);

  return (
    <div style={st.container}>
      <header style={st.header}>
        <div style={st.logoArea}><img src={theme === 'dark' ? '/logos/DG%20tema%20oscuro.png' : '/logos/DG-tema-claro.svg'} alt="Delfino Gaviña" style={st.logoImg} /></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} style={st.themeBtn}>{theme === 'dark' ? '☀' : '☾'}</button><StatusBar connected={connected} primaryConnected={primaryConnected} /></div>
      </header>
      <nav style={st.tabBar}>{TABS.map(tab => <button key={tab.id} style={{ ...st.tab, ...(activeTab === tab.id ? st.tabActive : {}) }} onClick={() => setActiveTab(tab.id)}>{tab.label}{activeTab === tab.id && <div style={st.tabInd} />}</button>)}</nav>

      {activeTab === 'fx' && (<>
        <section><SH title="COTIZACIONES AL30" /><p style={st.sectionSub}>CI · Contado Inmediato</p><div style={st.grid3}>{TICKERS.map((t, i) => <TickerCard key={t} ticker={t} label={({ AL30: 'Pesos (ARS)', AL30D: 'Dólar MEP (USD-D)', AL30C: 'Dólar Cable (USD-C)' })[t]} data={data[t]} delay={i * 100} />)}</div></section>
        <section style={{ marginTop: 48 }}><SH title="DÓLARES FINANCIEROS" /><div style={st.commRow}><span style={st.commLabel}>COMISIÓN</span><div style={st.commWrap}><input type="number" step="0.1" min="0" max="10" value={commission} onChange={e => setCommission(parseFloat(e.target.value) || 0)} style={st.commInput} /><span style={st.commPct}>%</span></div><span style={st.commNote}>por operación (se aplica a cada pata: compra y venta de bonos)</span></div><DollarRates data={data} commission={commission / 100} /></section>
      </>)}

      {activeTab === 'rf' && <section><SH title="OBLIGACIONES NEGOCIABLES" /><p style={st.sectionSub}>API PPI · Settlement A-24HS</p><RentaFijaCorporativa /></section>}

      {activeTab === 'sob' && <section><SH title="BONOS SOBERANOS" /><p style={st.sectionSub}>API PPI · Settlement A-48HS (MEP)</p><BonosSoberanos /></section>}

      {activeTab === 'sub' && <section><SH title="BONOS SUBSOBERANOS" /><p style={st.sectionSub}>API PPI · Settlement A-48HS (MEP)</p><BonosSubsoberanos /></section>}

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
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 24, borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 16 },
  logoArea: { display: 'flex', alignItems: 'center' },
  logoImg: { height: 64, width: 'auto', display: 'block' },
  themeBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 18, padding: '6px 10px', cursor: 'pointer', lineHeight: 1 },
  tabBar: { display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 32 },
  tab: { position: 'relative', background: 'none', border: 'none', fontFamily: "'Montserrat', sans-serif", fontSize: 10, fontWeight: 600, letterSpacing: 3, color: 'var(--text-dim)', padding: '16px 24px', cursor: 'pointer' },
  tabActive: { color: 'var(--neon)' }, tabInd: { position: 'absolute', bottom: -1, left: 0, right: 0, height: 2, background: 'var(--neon)', boxShadow: 'var(--neon-glow)', borderRadius: 1 },
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

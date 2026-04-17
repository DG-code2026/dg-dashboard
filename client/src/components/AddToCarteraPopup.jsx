import { useState, useEffect, useRef } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function AddToCarteraPopup({ ticker, precio, tipo, settlement, laminaMinima, onClose }) {
  const [carteras, setCarteras] = useState([]);
  const [selected, setSelected] = useState(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [vnStr, setVnStr] = useState('');
  const vnNum = parseInt(vnStr) || 0;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const ref = useRef(null);

  // Parse lamina minima
  const minVN = (() => {
    if (!laminaMinima || laminaMinima === '-') return 1;
    const n = parseInt(String(laminaMinima).replace(/[^\d]/g, ''));
    return n > 0 ? n : 1;
  })();

  useEffect(() => {
    fetch(`${API}/api/db/carteras`).then(r => r.json()).then(d => { if (Array.isArray(d)) setCarteras(d); }).catch(() => {});
  }, []);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`${API}/api/db/carteras`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: newName.trim() }) });
      const c = await res.json();
      if (c?.id) { setCarteras(p => [...p, c]); setSelected(c.id); setNewName(''); }
    } catch {}
    finally { setCreating(false); }
  };

  const handleSave = async () => {
    if (!selected || vnNum < minVN) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`${API}/api/db/carteras/${selected}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, tipo: tipo || 'ON', settlement: settlement || 'A-24HS', vn: vnNum, precio_compra: precio, lamina_minima: String(laminaMinima || '1') }),
      });
      const data = await res.json();
      if (data?.error || data?.code) { setError(data.message || data.details || 'Ya existe en esa cartera'); }
      else { setSuccess(true); setTimeout(onClose, 1200); }
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div ref={ref} style={S.popup}>
        <div style={S.header}>
          <span style={S.title}>AGREGAR A CARTERA</span>
          <button style={S.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Bond info */}
        <div style={S.bondInfo}>
          <span style={S.bondTicker}>{ticker}</span>
          <span style={S.bondPrice}>Precio: ${Number(precio).toFixed(2)}</span>
          <span style={S.bondMeta}>{tipo} · {settlement} · Lámina mín: {laminaMinima || '1'}</span>
        </div>

        {success ? (
          <div style={S.successBox}>✓ Agregado exitosamente</div>
        ) : (
          <>
            {/* Select cartera */}
            <div style={S.section}>
              <div style={S.sectionLabel}>SELECCIONAR CARTERA</div>
              <div style={S.carteraList}>
                {carteras.map(c => (
                  <button key={c.id} style={{ ...S.carteraBtn, ...(selected === c.id ? S.carteraBtnActive : {}) }} onClick={() => setSelected(c.id)}>
                    {c.nombre}
                  </button>
                ))}
                {carteras.length === 0 && <span style={S.emptyText}>Sin carteras — creá una nueva</span>}
              </div>
            </div>

            {/* Create new */}
            <div style={S.createRow}>
              <input style={S.createInput} placeholder="Nueva cartera..." value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()} />
              <button style={S.createBtn} onClick={handleCreate} disabled={creating || !newName.trim()}>{creating ? '...' : '＋'}</button>
            </div>

            {/* VN input */}
            <div style={S.section}>
              <div style={S.sectionLabel}>VALOR NOMINAL (mín: {minVN.toLocaleString('es-AR')})</div>
              <input type="text" inputMode="numeric" style={{ ...S.vnInput, borderColor: vnStr !== '' && vnNum > 0 && vnNum < minVN ? 'var(--red)' : 'var(--border)' }} value={vnStr} placeholder="Ingresá el VN" onChange={e => { const raw = e.target.value.replace(/[^\d]/g, ''); setVnStr(raw); }} />
              {vnStr !== '' && vnNum > 0 && vnNum < minVN && <div style={{ fontSize: 10, color: 'var(--red)', fontFamily: "'Roboto Mono', monospace", marginTop: 4, textAlign: 'center' }}>VN inferior a la lámina mínima ({minVN.toLocaleString('es-AR')})</div>}
              {vnNum > 0 && <div style={S.vnCalc}>
                Inversión: <b>${(precio * vnNum / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
                <span style={{ fontSize: 9, color: 'var(--text-dim)', marginLeft: 6 }}>(precio por cada 100 VN)</span>
              </div>}
            </div>

            {error && <div style={S.errorBox}>{error}</div>}

            <button style={{ ...S.saveBtn, opacity: !selected || saving || vnNum < minVN ? 0.4 : 1 }} onClick={handleSave} disabled={!selected || saving || vnNum < minVN}>
              {saving ? 'GUARDANDO...' : 'AGREGAR A CARTERA'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const S = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(2px)' },
  popup: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, width: '100%', maxWidth: 420, fontFamily: "'Roboto', sans-serif", boxShadow: '0 20px 60px rgba(0,0,0,0.5)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' },
  title: { fontSize: 11, fontWeight: 700, letterSpacing: 3, color: 'var(--neon)' },
  closeBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-dim)', fontSize: 12, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  bondInfo: { padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  bondTicker: { fontFamily: "'Roboto Mono', monospace", fontSize: 14, fontWeight: 700, color: 'var(--neon)', letterSpacing: '0.08em' },
  bondPrice: { fontFamily: "'Roboto Mono', monospace", fontSize: 12, color: 'var(--text)' },
  bondMeta: { fontSize: 10, color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace" },
  section: { padding: '12px 20px' },
  sectionLabel: { fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--text-dim)', marginBottom: 8 },
  carteraList: { display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 120, overflowY: 'auto' },
  carteraBtn: { background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace", fontSize: 11, padding: '6px 12px', cursor: 'pointer', transition: 'all 0.15s' },
  carteraBtnActive: { borderColor: 'var(--neon)', color: 'var(--neon)', background: 'rgba(57,255,20,0.05)' },
  emptyText: { fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' },
  createRow: { display: 'flex', gap: 8, padding: '0 20px 12px' },
  createInput: { flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontFamily: "'Roboto Mono', monospace", fontSize: 11, padding: '6px 10px', outline: 'none' },
  createBtn: { background: 'none', border: '1px solid var(--neon)', borderRadius: 4, color: 'var(--neon)', fontFamily: "'Roboto Mono', monospace", fontSize: 14, fontWeight: 700, padding: '4px 12px', cursor: 'pointer' },
  vnInput: { width: '100%', background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--neon)', fontFamily: "'Roboto Mono', monospace", fontSize: 16, fontWeight: 700, padding: '8px 12px', outline: 'none', textAlign: 'center' },
  vnCalc: { fontSize: 11, color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace", marginTop: 6, textAlign: 'center' },
  errorBox: { margin: '0 20px 12px', padding: '8px 12px', background: 'rgba(255,59,59,0.05)', border: '1px solid rgba(255,59,59,0.2)', borderRadius: 4, fontSize: 11, color: 'var(--red)', fontFamily: "'Roboto Mono', monospace" },
  successBox: { padding: '24px 20px', textAlign: 'center', fontSize: 14, fontWeight: 700, color: 'var(--neon)', fontFamily: "'Roboto Mono', monospace" },
  saveBtn: { width: 'calc(100% - 40px)', margin: '4px 20px 16px', padding: '10px', background: 'transparent', border: '1px solid var(--neon)', borderRadius: 4, color: 'var(--neon)', fontFamily: "'Roboto', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 3, cursor: 'pointer', textAlign: 'center' },
};

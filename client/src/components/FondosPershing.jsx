import { useEffect, useMemo, useState } from 'react';

// Todos los fondos viven en Supabase (tabla `fondos_pershing`) y llegan a todos los
// usuarios del dashboard: alta/baja es global y persistente. El API está expuesto
// bajo `/api/db/fondos-pershing` en el server Express.
const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Validación de ISIN: 12 caracteres, 2 letras (país) + 9 alfanuméricos + 1 dígito.
// No computamos el check digit, alcanza con formato y largo.
function isValidIsin(s) {
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(String(s || '').trim().toUpperCase());
}

// Normaliza para búsqueda tolerante a acentos y mayúsculas.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export default function FondosPershing() {
  const [qNombre, setQNombre] = useState('');
  const [qCasa, setQCasa] = useState('');
  const [copiedIsin, setCopiedIsin] = useState(null);

  // Todos los fondos vienen del backend. Estado: array + flags de loading/error.
  const [funds, setFunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  // Estado del form de alta. `showForm` colapsa el bloque para no ensuciar la UI.
  const [showForm, setShowForm] = useState(false);
  const [fIsin, setFIsin] = useState('');
  const [fCasa, setFCasa] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fErr, setFErr] = useState('');
  const [saving, setSaving] = useState(false);

  // Fetch inicial
  const reload = async () => {
    setLoading(true); setLoadErr('');
    try {
      const r = await fetch(`${API}/api/db/fondos-pershing`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setFunds(Array.isArray(data) ? data : []);
    } catch (e) {
      setLoadErr(e.message || 'Error cargando fondos');
      setFunds([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(); }, []);

  // Lista única de casas para el selector.
  const casas = useMemo(() => {
    const set = new Set(funds.map(f => f.casa).filter(Boolean));
    return ['', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [funds]);

  const filtered = useMemo(() => {
    const nN = norm(qNombre.trim());
    const nC = norm(qCasa.trim());
    return funds.filter(f => {
      if (nN && !norm(f.nombre).includes(nN)) return false;
      if (nC && norm(f.casa) !== nC) return false;
      return true;
    });
  }, [funds, qNombre, qCasa]);

  // Alta: POST al backend. El server valida ISIN/duplicado; acá replicamos la
  // validación para feedback inmediato antes de hacer el request.
  const addFund = async () => {
    setFErr('');
    const isin = fIsin.trim().toUpperCase();
    const casa = fCasa.trim();
    const desc = fDesc.trim();
    if (!isin || !casa || !desc) { setFErr('Completá ISIN, casa y descripción.'); return; }
    if (!isValidIsin(isin)) { setFErr('ISIN inválido: debe tener 12 caracteres (2 letras de país + 10 alfanuméricos, último dígito).'); return; }
    if (funds.some(f => f.isin.toUpperCase() === isin)) {
      setFErr(`Ya existe un fondo con ISIN ${isin}.`); return;
    }
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/db/fondos-pershing`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isin, casa, nombre: desc }),
      });
      const js = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(js.error || `HTTP ${r.status}`);
      setFIsin(''); setFCasa(''); setFDesc('');
      setShowForm(false);
      await reload();
    } catch (e) {
      setFErr(e.message || 'Error guardando fondo');
    } finally {
      setSaving(false);
    }
  };

  // Baja: DELETE al backend + reload. Confirm previo porque la acción es global.
  const removeFund = async (isin) => {
    if (!confirm(`¿Eliminar el fondo ${isin} del listado?\nEsta acción afecta a todos los usuarios del dashboard.`)) return;
    try {
      const r = await fetch(`${API}/api/db/fondos-pershing/${encodeURIComponent(isin)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await reload();
    } catch (e) {
      alert(`Error eliminando fondo: ${e.message}`);
    }
  };

  const copyIsin = async (isin) => {
    try {
      await navigator.clipboard.writeText(isin);
      setCopiedIsin(isin);
      setTimeout(() => setCopiedIsin(prev => (prev === isin ? null : prev)), 1400);
    } catch {
      // Fallback: seleccionar el texto si clipboard API no está disponible
      try {
        const ta = document.createElement('textarea');
        ta.value = isin; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        setCopiedIsin(isin);
        setTimeout(() => setCopiedIsin(prev => (prev === isin ? null : prev)), 1400);
      } catch {}
    }
  };

  const clearFilters = () => { setQNombre(''); setQCasa(''); };
  const hasFilters = qNombre.trim() || qCasa.trim();

  return (
    <div>
      {/* Barra de filtros */}
      <div style={S.toolbar}>
        <div style={S.filterGroup}>
          <label style={S.filterLabel}>BUSCAR NOMBRE</label>
          <input
            type="text"
            value={qNombre}
            onChange={e => setQNombre(e.target.value)}
            placeholder="Ej: EQUITY, INCOME, TECHNOLOGY..."
            style={S.input}
          />
        </div>
        <div style={S.filterGroup}>
          <label style={S.filterLabel}>CASA</label>
          <select value={qCasa} onChange={e => setQCasa(e.target.value)} style={S.select}>
            {casas.map(c => (
              <option key={c} value={c}>{c === '' ? 'Todas' : c}</option>
            ))}
          </select>
        </div>
        <div style={S.counter}>
          <span style={S.counterNum}>{filtered.length}</span>
          <span style={S.counterTxt}>/ {funds.length} fondos</span>
        </div>
        {hasFilters && (
          <button style={S.clearBtn} onClick={clearFilters} title="Limpiar filtros">LIMPIAR</button>
        )}
        <button
          style={{ ...S.addBtn, ...(showForm ? S.addBtnActive : {}) }}
          onClick={() => { setShowForm(s => !s); setFErr(''); }}
          title="Agregar un fondo que no esté en el listado"
        >
          {showForm ? '✕ CANCELAR' : '+ AGREGAR FONDO'}
        </button>
      </div>

      {/* Formulario de alta — colapsable */}
      {showForm && (
        <div style={S.formBox}>
          <div style={S.formRow}>
            <div style={S.formField}>
              <label style={S.filterLabel}>ISIN *</label>
              <input
                type="text"
                value={fIsin}
                onChange={e => setFIsin(e.target.value.toUpperCase())}
                placeholder="Ej: LU1234567890"
                maxLength={12}
                style={{ ...S.input, fontWeight: 700, letterSpacing: 1.5 }}
              />
            </div>
            <div style={S.formField}>
              <label style={S.filterLabel}>CASA *</label>
              <input
                type="text"
                value={fCasa}
                onChange={e => setFCasa(e.target.value)}
                placeholder="Ej: Franklin Templeton"
                style={S.input}
                list="casas-existentes"
              />
              <datalist id="casas-existentes">
                {casas.filter(Boolean).map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div style={{ ...S.formField, flex: '2 1 320px' }}>
              <label style={S.filterLabel}>DESCRIPCIÓN *</label>
              <input
                type="text"
                value={fDesc}
                onChange={e => setFDesc(e.target.value)}
                placeholder="Nombre completo del fondo"
                style={S.input}
                onKeyDown={e => { if (e.key === 'Enter' && !saving) addFund(); }}
                disabled={saving}
              />
            </div>
            <div style={S.formActions}>
              <button
                style={{ ...S.saveBtn, ...(saving ? S.saveBtnDisabled : {}) }}
                onClick={addFund}
                disabled={saving}
              >
                {saving ? 'GUARDANDO…' : 'GUARDAR'}
              </button>
            </div>
          </div>
          {fErr && <div style={S.formErr}>{fErr}</div>}
          <div style={S.formHint}>
            Los fondos se guardan en la base compartida: el alta es global y le llega a todos los usuarios del dashboard. La baja también es global — confirmá antes de eliminar.
          </div>
        </div>
      )}

      {/* Banner de error de carga (solo si falló el fetch inicial) */}
      {loadErr && !loading && (
        <div style={S.loadErrBox}>
          No se pudo cargar el listado de fondos: {loadErr}
          <button style={S.retryBtn} onClick={reload}>Reintentar</button>
        </div>
      )}

      {/* Grilla */}
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={{ ...S.th, width: 170 }}>ISIN</th>
              <th style={S.th}>NOMBRE</th>
              <th style={{ ...S.th, width: 200 }}>CASA</th>
              <th style={{ ...S.th, width: 44, textAlign: 'center' }} aria-label="Acciones"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} style={S.empty}>Cargando fondos…</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={4} style={S.empty}>
                  {funds.length === 0
                    ? 'No hay fondos cargados todavía.'
                    : 'No hay fondos que coincidan con los filtros.'}
                </td>
              </tr>
            ) : (
              filtered.map((f, i) => (
                <tr key={f.isin} style={i % 2 ? S.rowAlt : S.row}>
                  <td style={{ ...S.td, ...S.tdIsin }}>
                    <button
                      style={{ ...S.copyBtn, ...(copiedIsin === f.isin ? S.copyBtnOk : {}) }}
                      onClick={() => copyIsin(f.isin)}
                      title="Copiar ISIN"
                    >
                      <span style={S.isinText}>{f.isin}</span>
                      <span style={S.copyIcon}>{copiedIsin === f.isin ? '✓' : '⎘'}</span>
                    </button>
                  </td>
                  <td style={{ ...S.td, ...S.tdNombre }}>{f.nombre}</td>
                  <td style={{ ...S.td, ...S.tdCasa }}>{f.casa}</td>
                  <td style={{ ...S.td, ...S.tdAction }}>
                    <button
                      style={S.delBtn}
                      onClick={() => removeFund(f.isin)}
                      title="Eliminar fondo (afecta a todos los usuarios)"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={S.footnote}>
        Fuente: listado Pershing · base compartida Supabase · los ISIN se pueden copiar al portapapeles clickeando el código.
      </div>
    </div>
  );
}

const S = {
  toolbar: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 14,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  filterGroup: { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px', minWidth: 180 },
  filterLabel: {
    fontFamily: "'Roboto',sans-serif",
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 2,
    color: 'var(--text-dim)',
    textTransform: 'uppercase',
  },
  input: {
    background: 'var(--input-bg)',
    border: '1px solid var(--border)',
    borderRadius: 3,
    color: 'var(--text)',
    fontFamily: "'Roboto Mono',monospace",
    fontSize: 12,
    padding: '8px 10px',
    outline: 'none',
  },
  select: {
    background: 'var(--input-bg)',
    border: '1px solid var(--border)',
    borderRadius: 3,
    color: 'var(--text)',
    fontFamily: "'Roboto Mono',monospace",
    fontSize: 12,
    padding: '8px 10px',
    outline: 'none',
    cursor: 'pointer',
  },
  counter: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    padding: '8px 14px',
    border: '1px solid var(--border)',
    borderRadius: 3,
    background: 'var(--bg-card)',
  },
  counterNum: {
    fontFamily: "'Roboto Mono',monospace",
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--neon)',
    letterSpacing: 1,
  },
  counterTxt: {
    fontFamily: "'Roboto Mono',monospace",
    fontSize: 10,
    color: 'var(--text-dim)',
    letterSpacing: 1,
  },
  clearBtn: {
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 3,
    color: 'var(--text-dim)',
    fontFamily: "'Roboto Mono',monospace",
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: 2,
    padding: '8px 14px',
    cursor: 'pointer',
  },
  addBtn: {
    background: 'transparent',
    border: '1px solid var(--neon)',
    borderRadius: 3,
    color: 'var(--neon)',
    fontFamily: "'Roboto',sans-serif",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 2,
    padding: '8px 14px',
    cursor: 'pointer',
  },
  addBtnActive: {
    color: 'var(--text-dim)',
    borderColor: 'var(--border)',
  },

  // Formulario de alta — panel colapsable
  formBox: {
    border: '1px solid var(--border-neon)',
    borderRadius: 4,
    background: 'var(--bg-card)',
    padding: 14,
    marginBottom: 14,
    boxShadow: '0 0 0 1px rgba(0,255,170,0.04) inset',
  },
  formRow: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 10,
    flexWrap: 'wrap',
  },
  formField: { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 160px', minWidth: 140 },
  formActions: { display: 'flex', gap: 8, alignItems: 'flex-end' },
  saveBtn: {
    background: 'transparent',
    border: '1px solid var(--neon)',
    borderRadius: 3,
    color: 'var(--neon)',
    fontFamily: "'Roboto',sans-serif",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 2,
    padding: '8px 16px',
    cursor: 'pointer',
  },
  saveBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  loadErrBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '10px 14px',
    marginBottom: 12,
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 3,
    color: '#ef4444',
    fontFamily: "'Roboto Mono',monospace",
    fontSize: 11,
    letterSpacing: 0.5,
  },
  retryBtn: {
    background: 'transparent',
    border: '1px solid #ef4444',
    borderRadius: 3,
    color: '#ef4444',
    fontFamily: "'Roboto',sans-serif",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 2,
    padding: '5px 12px',
    cursor: 'pointer',
  },
  formErr: {
    marginTop: 10,
    padding: '6px 10px',
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 3,
    color: '#ef4444',
    fontFamily: "'Roboto Mono',monospace",
    fontSize: 10.5,
    letterSpacing: 0.5,
  },
  formHint: {
    marginTop: 10,
    fontFamily: "'Roboto Mono',monospace",
    fontSize: 9,
    color: 'var(--text-dim)',
    letterSpacing: 0.5,
    lineHeight: 1.5,
  },

  // Columna de acción + botón eliminar
  tdAction: { width: 44, textAlign: 'center', padding: '4px' },
  delBtn: {
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 3,
    color: '#ef4444',
    fontFamily: "'Roboto Mono',monospace",
    fontSize: 12,
    fontWeight: 700,
    width: 28,
    height: 28,
    cursor: 'pointer',
    lineHeight: 1,
    opacity: 0.75,
  },

  // Tabla
  tableWrap: {
    border: '1px solid var(--border)',
    borderRadius: 4,
    overflow: 'hidden',
    background: 'var(--bg-card)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  th: {
    padding: '12px 10px',
    fontFamily: "'Roboto',sans-serif",
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 2,
    color: 'var(--neon)',
    textTransform: 'uppercase',
    borderBottom: '1px solid var(--border-neon)',
    background: 'var(--th-bg)',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  },
  row: { background: 'var(--bg-card)' },
  rowAlt: { background: 'var(--row-alt)' },
  td: {
    padding: '8px 10px',
    fontFamily: "'Roboto Mono',monospace",
    fontSize: 11,
    color: 'var(--text)',
    borderBottom: '1px solid var(--border)',
    verticalAlign: 'middle',
  },
  tdIsin: { width: 170, padding: '6px 10px' },
  tdNombre: { lineHeight: 1.45 },
  tdCasa: {
    width: 180,
    whiteSpace: 'nowrap',
    fontWeight: 600,
    color: 'var(--neon)',
    letterSpacing: 0.5,
  },
  empty: {
    padding: 28,
    textAlign: 'center',
    color: 'var(--text-dim)',
    fontFamily: "'Roboto Mono',monospace",
    fontSize: 11,
    background: 'var(--bg-card)',
  },

  // Botón ISIN copiable
  copyBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 3,
    color: 'var(--text)',
    fontFamily: "'Roboto Mono',monospace",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.8,
    padding: '5px 9px',
    cursor: 'pointer',
    transition: 'all 0.18s ease',
  },
  copyBtnOk: {
    borderColor: 'var(--green, #22c55e)',
    color: 'var(--green, #22c55e)',
    boxShadow: '0 0 8px rgba(34,197,94,0.35)',
  },
  isinText: { letterSpacing: 1 },
  copyIcon: {
    fontSize: 12,
    opacity: 0.7,
  },

  footnote: {
    marginTop: 10,
    fontFamily: "'Roboto Mono',monospace",
    fontSize: 9,
    color: 'var(--text-dim)',
    letterSpacing: 1,
    textAlign: 'right',
    opacity: 0.75,
  },
};

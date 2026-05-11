import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const TOKEN_KEY = 'clientes_token_v1';

// Columnas: key, label, sortable, render
const COLUMNS = [
  { key: 'nombre',           label: 'NOMBRE',          align: 'left' },
  { key: 'email',            label: 'EMAIL',           align: 'left' },
  { key: 'comitente',        label: 'COMITENTE',       align: 'right' },
  { key: 'broker',           label: 'BROKER',          align: 'center' },
  { key: 'telefono',         label: 'TELÉFONO',        align: 'left' },
  { key: 'tipo_cuenta',      label: 'TIPO',            align: 'center' },
  { key: 'edad',             label: 'EDAD',            align: 'right' },
  { key: 'fecha_nacimiento', label: 'NACIMIENTO',      align: 'center' },
  { key: 'asesor',           label: 'ASESOR',          align: 'center' },
];

// Edad calculada a partir de la fecha de nacimiento (sin guardarla, así
// no se desactualiza).
function calcEdad(fechaISO) {
  if (!fechaISO) return null;
  const d = new Date(fechaISO);
  if (isNaN(d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return '—'; }
}

function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}
function setToken(t) {
  try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch {}
}

// Fetch helper con auth y manejo de 401 (limpia token y dispara re-login).
async function api(path, opts = {}, onUnauth) {
  const token = getToken();
  const r = await fetch(`${API}${path}`, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401) {
    setToken(null);
    onUnauth?.();
    throw new Error('unauthorized');
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || `HTTP ${r.status}`);
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : null;
}

// ═══════════════════════════════════════════════════════════════
//  PAGE
// ═══════════════════════════════════════════════════════════════
export default function ClientesPage() {
  const [authed, setAuthed] = useState(() => !!getToken());

  // Al montar, valida que el token guardado siga vivo
  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    fetch(`${API}/api/clientes/me`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(r => { if (!cancelled && r.status === 401) { setToken(null); setAuthed(false); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!authed) return <LoginGate onAuth={() => setAuthed(true)} />;
  return <ClientesTable onLogout={() => { setToken(null); setAuthed(false); }} />;
}

// ═══════════════════════════════════════════════════════════════
//  LOGIN GATE
// ═══════════════════════════════════════════════════════════════
function LoginGate({ onAuth }) {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async (e) => {
    e?.preventDefault();
    if (!pass || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API}/api/clientes/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass }),
      });
      if (r.status === 429) {
        const j = await r.json().catch(() => ({}));
        setErr(`Demasiados intentos. Probá en ${j.retryAfterSeconds || '?'}s.`);
      } else if (!r.ok) {
        setErr('Contraseña incorrecta');
      } else {
        const { token } = await r.json();
        setToken(token);
        onAuth();
      }
    } catch (e) {
      setErr('Error de conexión');
    } finally { setBusy(false); }
  };

  return (
    <div style={st.loginWrap}>
      <form onSubmit={submit} style={st.loginCard}>
        <div style={st.loginTitle}>ACCESO RESTRINGIDO</div>
        <div style={st.loginSub}>Esta sección contiene datos confidenciales de clientes.</div>
        <input
          ref={inputRef}
          type="password"
          value={pass}
          onChange={e => setPass(e.target.value)}
          placeholder="Contraseña"
          style={st.loginInput}
          autoComplete="current-password"
        />
        {err && <div style={st.loginErr}>{err}</div>}
        <button type="submit" disabled={busy || !pass} style={{ ...st.btnPrimary, opacity: busy || !pass ? 0.5 : 1 }}>
          {busy ? 'Verificando…' : 'INGRESAR'}
        </button>
      </form>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  MAIN TABLE
// ═══════════════════════════════════════════════════════════════
function ClientesTable({ onLogout }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ broker: '', asesor: '', tipo_cuenta: '' });
  const [sort, setSort] = useState({ key: 'nombre', dir: 'asc' });
  const [editing, setEditing] = useState(null);     // null | 'new' | cliente object
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await api('/api/db/clientes', {}, onLogout);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e.message !== 'unauthorized') setError(e.message);
    } finally { setLoading(false); }
  }, [onLogout]);

  useEffect(() => { load(); }, [load]);

  // Opciones de filtros derivadas de los datos
  const opts = useMemo(() => ({
    broker:      [...new Set(rows.map(r => r.broker).filter(Boolean))].sort(),
    asesor:      [...new Set(rows.map(r => r.asesor).filter(Boolean))].sort(),
    tipo_cuenta: [...new Set(rows.map(r => r.tipo_cuenta).filter(Boolean))].sort(),
  }), [rows]);

  // Filtrado + búsqueda + ordenamiento (todo client-side para snappiness)
  const visible = useMemo(() => {
    let v = rows;
    if (filters.broker)      v = v.filter(r => r.broker === filters.broker);
    if (filters.asesor)      v = v.filter(r => r.asesor === filters.asesor);
    if (filters.tipo_cuenta) v = v.filter(r => r.tipo_cuenta === filters.tipo_cuenta);

    const q = search.trim().toLowerCase();
    if (q) {
      v = v.filter(r => (
        (r.nombre || '').toLowerCase().includes(q) ||
        (r.email || '').toLowerCase().includes(q) ||
        (r.comitente || '').toLowerCase().includes(q) ||
        (r.telefono || '').toLowerCase().includes(q) ||
        (r.asesor || '').toLowerCase().includes(q) ||
        (r.broker || '').toLowerCase().includes(q)
      ));
    }

    const { key, dir } = sort;
    const mult = dir === 'asc' ? 1 : -1;
    v = [...v].sort((a, b) => {
      let av = a[key], bv = b[key];
      if (key === 'edad') { av = calcEdad(a.fecha_nacimiento); bv = calcEdad(b.fecha_nacimiento); }
      if (key === 'comitente') { av = av != null ? Number(av) : null; bv = bv != null ? Number(bv) : null; }
      const an = av == null || av === '';
      const bn = bv == null || bv === '';
      if (an && bn) return 0;
      if (an) return 1;   // nulls siempre al final
      if (bn) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      if (key === 'fecha_nacimiento') return (new Date(av) - new Date(bv)) * mult;
      return String(av).localeCompare(String(bv), 'es', { sensitivity: 'base' }) * mult;
    });
    return v;
  }, [rows, filters, search, sort]);

  const toggleSort = (key) => {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  const onSave = async (cliente, id) => {
    try {
      if (id) await api(`/api/db/clientes/${id}`, { method: 'PATCH', body: cliente }, onLogout);
      else    await api('/api/db/clientes',         { method: 'POST', body: cliente }, onLogout);
      setEditing(null);
      load();
    } catch (e) { alert('Error: ' + e.message); }
  };

  const onDelete = async (cliente) => {
    if (!confirm(`¿Eliminar a "${cliente.nombre}"?`)) return;
    try {
      await api(`/api/db/clientes/${cliente.id}`, { method: 'DELETE' }, onLogout);
      load();
    } catch (e) { alert('Error: ' + e.message); }
  };

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const headers = [['nombre','email','comitente','broker','telefono','tipo_cuenta','fecha_nacimiento','asesor']];
    const sample = [['JUAN PEREZ', 'juan@mail.com', '152090', 'PPI', '+54 11 47303727', 'PF', '1972-04-07', 'DELFINO']];
    const ws = XLSX.utils.aoa_to_sheet([...headers, ...sample]);
    ws['!cols'] = [{wch:35},{wch:30},{wch:12},{wch:10},{wch:22},{wch:6},{wch:14},{wch:12}];
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
    XLSX.writeFile(wb, 'plantilla_clientes.xlsx');
  };

  const onImportFile = async (file) => {
    if (!file) return;
    setImporting(true); setImportResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
      const cleaned = data.map(r => {
        // El header puede venir de la plantilla o de un xlsx propio.
        const get = (...keys) => {
          for (const k of keys) {
            for (const dk of Object.keys(r)) {
              if (dk.trim().toLowerCase() === k.toLowerCase()) return r[dk];
            }
          }
          return null;
        };
        const fn = get('fecha_nacimiento', 'FechaNacimiento', 'nacimiento');
        let fechaISO = null;
        if (fn instanceof Date) fechaISO = fn.toISOString().slice(0,10);
        else if (fn) {
          const d = new Date(fn);
          fechaISO = isNaN(d) ? null : d.toISOString().slice(0,10);
        }
        return {
          nombre:           get('nombre', 'Denominación', 'Denominacion'),
          email:            get('email', 'EMail', 'mail'),
          comitente:        get('comitente', 'Comitente número', 'Comitente numero')?.toString(),
          broker:           get('broker', 'BROKER'),
          telefono:         get('telefono', 'Teléfono', 'Telefono'),
          tipo_cuenta:      get('tipo_cuenta', 'Tipo de cuenta', 'tipo'),
          fecha_nacimiento: fechaISO,
          asesor:           get('asesor', 'Asesor'),
        };
      }).filter(r => r.nombre);

      if (cleaned.length === 0) {
        setImportResult({ ok: false, msg: 'No se encontraron filas válidas (la columna "nombre" es obligatoria).' });
        return;
      }
      const res = await api('/api/db/clientes/bulk', { method: 'POST', body: { rows: cleaned } }, onLogout);
      setImportResult({ ok: true, msg: `Se importaron ${res.inserted} clientes.` });
      load();
    } catch (e) {
      setImportResult({ ok: false, msg: 'Error: ' + e.message });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div>
      {/* Toolbar */}
      <div style={st.toolbar}>
        <div style={st.toolbarLeft}>
          <input
            type="text"
            placeholder="Buscar (nombre, email, comitente, teléfono…)"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={st.search}
          />
          <Select label="Broker" value={filters.broker} onChange={v => setFilters(f => ({...f, broker: v}))} options={opts.broker} />
          <Select label="Asesor" value={filters.asesor} onChange={v => setFilters(f => ({...f, asesor: v}))} options={opts.asesor} />
          <Select label="Tipo"   value={filters.tipo_cuenta} onChange={v => setFilters(f => ({...f, tipo_cuenta: v}))} options={opts.tipo_cuenta} />
          {(search || filters.broker || filters.asesor || filters.tipo_cuenta) && (
            <button onClick={() => { setSearch(''); setFilters({broker:'',asesor:'',tipo_cuenta:''}); }} style={st.btnGhost}>
              ✕ limpiar
            </button>
          )}
        </div>
        <div style={st.toolbarRight}>
          <button onClick={() => setEditing('new')} style={st.btnPrimary}>+ NUEVO</button>
          <button onClick={downloadTemplate}       style={st.btnSecondary}>↓ PLANTILLA</button>
          <button onClick={() => fileInputRef.current?.click()} disabled={importing} style={st.btnSecondary}>
            {importing ? 'IMPORTANDO…' : '↑ IMPORTAR XLSX'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={e => onImportFile(e.target.files?.[0])}
            style={{ display: 'none' }}
          />
          <button onClick={onLogout} style={st.btnGhost} title="Cerrar sesión">⎋</button>
        </div>
      </div>

      {importResult && (
        <div style={{ ...st.banner, background: importResult.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', borderColor: importResult.ok ? '#22c55e' : '#ef4444' }}>
          <span>{importResult.msg}</span>
          <button onClick={() => setImportResult(null)} style={st.bannerClose}>✕</button>
        </div>
      )}

      <div style={st.countRow}>
        {loading ? 'Cargando…' : `${visible.length} de ${rows.length} clientes`}
        {error && <span style={{ color: '#ef4444', marginLeft: 12 }}>· {error}</span>}
      </div>

      {/* Table — `table-layout: fixed` + col widths para que NUNCA haya scroll
          horizontal: cada columna se ajusta al ancho disponible, y los textos
          largos (email, nombre) se truncan con ellipsis. El scroll vertical
          existe pero la scrollbar va oculta (clase `no-scrollbar`). */}
      <div style={st.tableWrap} className="no-scrollbar">
        <table style={st.table}>
          <colgroup>
            <col style={{ width: 38 }} />                    {/* # */}
            <col style={{ width: '20%' }} />                  {/* nombre */}
            <col style={{ width: '17%' }} />                  {/* email */}
            <col style={{ width: 78 }} />                     {/* comitente */}
            <col style={{ width: 70 }} />                     {/* broker */}
            <col style={{ width: '14%' }} />                  {/* telefono */}
            <col style={{ width: 56 }} />                     {/* tipo */}
            <col style={{ width: 50 }} />                     {/* edad */}
            <col style={{ width: 96 }} />                     {/* nacimiento */}
            <col style={{ width: 78 }} />                     {/* asesor */}
            <col style={{ width: 64 }} />                     {/* acciones */}
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...st.th, textAlign: 'right', color: 'var(--text-dim)' }}>#</th>
              {COLUMNS.map(c => {
                const active = sort.key === c.key;
                return (
                  <th key={c.key}
                      onClick={() => toggleSort(c.key)}
                      style={{ ...st.th, textAlign: c.align, color: active ? 'var(--neon)' : 'var(--text-dim)' }}>
                    <span style={st.thLabel}>{c.label}</span>
                    <span style={{ marginLeft: 4, opacity: active ? 1 : 0.3 }}>
                      {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </th>
                );
              })}
              <th style={{ ...st.th, textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={r.id} style={st.tr}>
                <td style={{ ...st.td, textAlign: 'right', fontFamily: "'Roboto Mono',monospace", fontSize: 10, color: 'var(--text-dim)' }}>{i + 1}</td>
                <td style={{ ...st.td, fontWeight: 600, ...st.tdEllipsis }} title={r.nombre || ''}>{r.nombre || '—'}</td>
                <td style={{ ...st.td, fontSize: 10, color: 'var(--text-dim)', ...st.tdEllipsis }} title={r.email || ''}>{r.email || '—'}</td>
                <td style={{ ...st.td, textAlign: 'right', fontFamily: "'Roboto Mono',monospace", fontSize: 11 }}>{r.comitente || '—'}</td>
                <td style={{ ...st.td, textAlign: 'center' }}>{r.broker ? <span style={st.chip}>{r.broker}</span> : '—'}</td>
                <td style={{ ...st.td, fontFamily: "'Roboto Mono',monospace", fontSize: 11, ...st.tdEllipsis }} title={r.telefono || ''}>{r.telefono || '—'}</td>
                <td style={{ ...st.td, textAlign: 'center' }}>{r.tipo_cuenta ? <span style={{...st.chip, ...(r.tipo_cuenta === 'PJ' ? st.chipPJ : {})}}>{r.tipo_cuenta}</span> : '—'}</td>
                <td style={{ ...st.td, textAlign: 'right', fontFamily: "'Roboto Mono',monospace" }}>{calcEdad(r.fecha_nacimiento) ?? '—'}</td>
                <td style={{ ...st.td, textAlign: 'center', fontFamily: "'Roboto Mono',monospace", fontSize: 11 }}>{fmtDate(r.fecha_nacimiento)}</td>
                <td style={{ ...st.td, textAlign: 'center', fontSize: 11, ...st.tdEllipsis }} title={r.asesor || ''}>{r.asesor || '—'}</td>
                <td style={{ ...st.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => setEditing(r)} style={st.iconBtn} title="Editar">✎</button>
                  <button onClick={() => onDelete(r)}   style={{ ...st.iconBtn, color: '#ef4444' }} title="Eliminar">🗑</button>
                </td>
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={COLUMNS.length + 2} style={{ ...st.td, textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>
                Sin resultados
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing !== null && (
        <ClienteModal
          cliente={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={onSave}
          asesorOpts={opts.asesor}
          brokerOpts={opts.broker}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  EDIT / NEW MODAL
// ═══════════════════════════════════════════════════════════════
function ClienteModal({ cliente, onClose, onSave, asesorOpts, brokerOpts }) {
  const isNew = !cliente;
  const [form, setForm] = useState({
    nombre:           cliente?.nombre || '',
    email:            cliente?.email || '',
    comitente:        cliente?.comitente || '',
    broker:           cliente?.broker || '',
    telefono:         cliente?.telefono || '',
    tipo_cuenta:      cliente?.tipo_cuenta || '',
    fecha_nacimiento: cliente?.fecha_nacimiento || '',
    asesor:           cliente?.asesor || '',
  });
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) { alert('El nombre es obligatorio.'); return; }
    setBusy(true);
    try { await onSave(form, cliente?.id); } finally { setBusy(false); }
  };

  return createPortal(
    <div style={st.modalBackdrop} onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} style={st.modal}>
        <div style={st.modalHead}>
          <div style={st.modalTitle}>{isNew ? 'NUEVO CLIENTE' : 'EDITAR CLIENTE'}</div>
          <button type="button" onClick={onClose} style={st.modalX}>✕</button>
        </div>
        <div style={st.modalBody}>
          <Field label="Nombre *">
            <input value={form.nombre} onChange={e => set('nombre', e.target.value)} style={st.input} required autoFocus />
          </Field>
          <Field label="Email">
            <input type="text" value={form.email || ''} onChange={e => set('email', e.target.value)} style={st.input} placeholder="varios separados con ;" />
          </Field>
          <div style={st.row2}>
            <Field label="N° Comitente">
              <input value={form.comitente || ''} onChange={e => set('comitente', e.target.value)} style={st.input} />
            </Field>
            <Field label="Broker">
              <SelectFree value={form.broker} onChange={v => set('broker', v)} options={brokerOpts} placeholder="PPI / INVIU / …" />
            </Field>
          </div>
          <Field label="Teléfono">
            <input value={form.telefono || ''} onChange={e => set('telefono', e.target.value)} style={st.input} placeholder="+54 11 ..." />
          </Field>
          <div style={st.row2}>
            <Field label="Tipo de cuenta">
              <select value={form.tipo_cuenta || ''} onChange={e => set('tipo_cuenta', e.target.value)} style={st.input}>
                <option value="">—</option>
                <option value="PF">PF (Persona Física)</option>
                <option value="PJ">PJ (Persona Jurídica)</option>
              </select>
            </Field>
            <Field label="Fecha de nacimiento">
              <input type="date" value={form.fecha_nacimiento || ''} onChange={e => set('fecha_nacimiento', e.target.value)} style={st.input} />
            </Field>
          </div>
          <Field label="Asesor">
            <SelectFree value={form.asesor} onChange={v => set('asesor', v)} options={asesorOpts} placeholder="DELFINO / GAVIÑA / …" />
          </Field>
        </div>
        <div style={st.modalFoot}>
          <button type="button" onClick={onClose} style={st.btnGhost}>Cancelar</button>
          <button type="submit" disabled={busy} style={{ ...st.btnPrimary, opacity: busy ? 0.5 : 1 }}>
            {busy ? 'Guardando…' : (isNew ? 'CREAR' : 'GUARDAR')}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

// ─────────── pequeños helpers de UI ───────────
function Field({ label, children }) {
  return (
    <label style={st.field}>
      <span style={st.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={st.filterSelect}>
      <option value="">{label}: todos</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// Combo: dropdown de opciones existentes pero permitiendo tipear uno nuevo.
function SelectFree({ value, onChange, options, placeholder }) {
  return (
    <input
      list={`opts-${placeholder}`}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={st.input}
      autoComplete="off"
    />
  );
  // NB: <datalist> es más limpio pero da problemas de styling. El input plain
  // alcanza para este caso; las opciones se muestran en los filtros igual.
}

// ─────────── styles ───────────
const st = {
  loginWrap: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', padding: 20 },
  loginCard: { background: 'var(--bg-card)', border: '1px solid var(--border-neon)', borderRadius: 8, padding: 32, width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 14 },
  loginTitle: { fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 18, letterSpacing: 4, color: 'var(--title-color)', textAlign: 'center' },
  loginSub: { fontFamily: "'Roboto Mono',monospace", fontSize: 10, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.5 },
  loginInput: { background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '10px 12px', fontSize: 14, color: 'var(--text)', fontFamily: "'Roboto Mono',monospace", letterSpacing: 2, textAlign: 'center' },
  loginErr: { color: '#ef4444', fontFamily: "'Roboto Mono',monospace", fontSize: 10, textAlign: 'center' },

  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' },
  toolbarLeft: { display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap', alignItems: 'center' },
  toolbarRight: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  search: { background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '8px 12px', fontSize: 12, color: 'var(--text)', minWidth: 260, flex: '1 1 260px', fontFamily: 'inherit' },
  filterSelect: { background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '8px 10px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer' },

  btnPrimary: { background: 'var(--neon)', color: '#000', border: 'none', borderRadius: 4, padding: '8px 14px', fontSize: 10, fontWeight: 700, letterSpacing: 1.5, cursor: 'pointer', fontFamily: "'Montserrat',sans-serif" },
  btnSecondary: { background: 'transparent', color: 'var(--neon)', border: '1px solid var(--border-neon)', borderRadius: 4, padding: '8px 14px', fontSize: 10, fontWeight: 700, letterSpacing: 1.5, cursor: 'pointer', fontFamily: "'Montserrat',sans-serif" },
  btnGhost: { background: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 4, padding: '8px 12px', fontSize: 10, letterSpacing: 1.5, cursor: 'pointer', fontFamily: "'Montserrat',sans-serif" },

  banner: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', border: '1px solid', borderRadius: 4, marginBottom: 12, fontSize: 12 },
  bannerClose: { background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 14, cursor: 'pointer' },

  countRow: { fontFamily: "'Roboto Mono',monospace", fontSize: 10, color: 'var(--text-dim)', letterSpacing: 1, marginBottom: 8 },

  tableWrap: { border: '1px solid var(--border)', borderRadius: 6, overflowY: 'auto', overflowX: 'hidden', maxHeight: 'calc(100vh - 320px)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' },
  th: { padding: '10px 8px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-card)', fontFamily: "'Roboto Mono',monospace", fontSize: 9, letterSpacing: 1.5, fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', overflow: 'hidden' },
  thLabel: { display: 'inline' },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '8px', verticalAlign: 'middle', overflow: 'hidden', textOverflow: 'ellipsis' },
  tdEllipsis: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  chip: { display: 'inline-block', padding: '2px 8px', border: '1px solid var(--border-neon)', borderRadius: 3, fontSize: 9, fontFamily: "'Roboto Mono',monospace", fontWeight: 700, letterSpacing: 1, color: 'var(--neon)' },
  chipPJ: { borderColor: '#f59e0b', color: '#f59e0b' },
  iconBtn: { background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: '4px 6px', fontSize: 13 },

  modalBackdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  modal: { background: 'var(--bg-card)', border: '1px solid var(--border-neon)', borderRadius: 8, width: '100%', maxWidth: 480, maxHeight: '90vh', display: 'flex', flexDirection: 'column' },
  modalHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' },
  modalTitle: { fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 16, letterSpacing: 3, color: 'var(--title-color)' },
  modalX: { background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 18, cursor: 'pointer' },
  modalBody: { padding: 20, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' },
  modalFoot: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--border)' },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLabel: { fontFamily: "'Roboto Mono',monospace", fontSize: 9, color: 'var(--text-dim)', letterSpacing: 1.5, textTransform: 'uppercase' },
  input: { background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '8px 10px', fontSize: 12, color: 'var(--text)', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
};

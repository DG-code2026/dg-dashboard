// ─────────────────────────────────────────────────────────────────────────────
//  VACACIONES — calendario de ausencias del equipo
//
//  Dos vistas sobre los mismos datos:
//    - Timeline: una franja por persona, barras de colores sobre los días.
//      En vista MES la grilla son los días del mes; en vista AÑO, los 12 meses.
//      Es donde se ven los solapamientos de un vistazo.
//    - Tabla: el detalle de cada registro, editable y borrable.
//
//  Los datos viven en Supabase (`vacaciones_personas` + `vacaciones`) y se
//  acceden vía el server Express bajo `/api/db/vacaciones*`.
//
//  El selector de fechas es el MiniCalendar que ya usa el modal "Fuera de
//  oficina" — mismo comportamiento de rango (click 1 = inicio, click 2 = fin).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  MiniCalendar, MONTHS_ES, MONTHS_ES_SHORT,
  pad, todayIso, dateToIso, parseLocalDate,
} from './OutOfOfficeModal';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Tipos de ausencia. El `key` es lo que viaja a la base (constraint CHECK en
// la tabla), el resto es presentación.
const TIPOS = [
  { key: 'vacaciones',  label: 'Vacaciones',    abbr: 'VAC', color: '#22c55e' },
  { key: 'licencia',    label: 'Licencia',      abbr: 'LIC', color: '#ef4444' },
  { key: 'estudio',     label: 'Estudio',       abbr: 'EST', color: '#3b82f6' },
  { key: 'home_office', label: 'Home office',   abbr: 'HO',  color: '#a855f7' },
  { key: 'personal',    label: 'Personal',      abbr: 'PER', color: '#f59e0b' },
];
const tipoDef = (k) => TIPOS.find(t => t.key === k) || TIPOS[0];

// Paleta para personas nuevas: se ofrece la primera que no esté tomada.
const PALETA = ['#4aa3ff', '#ffb347', '#ff6b9d', '#a78bfa', '#2dd4bf', '#f472b6', '#facc15', '#60a5fa', '#34d399', '#fb923c'];

// ── Helpers de fecha ──

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

// Días corridos, ambas puntas incluidas.
function diasCorridos(desdeIso, hastaIso) {
  const a = parseLocalDate(desdeIso), b = parseLocalDate(hastaIso);
  if (!a || !b) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

// Días hábiles: descuenta fines de semana y los feriados que le pasemos
// (set de ISO strings, viene de /api/bolsar/calendar).
function diasHabiles(desdeIso, hastaIso, feriados) {
  const a = parseLocalDate(desdeIso), b = parseLocalDate(hastaIso);
  if (!a || !b) return 0;
  let n = 0;
  for (let d = new Date(a); d <= b; d = addDays(d, 1)) {
    if (isWeekend(d)) continue;
    if (feriados && feriados.has(dateToIso(d))) continue;
    n++;
  }
  return n;
}

// Formato corto para la tabla: "3 mar" / "3 mar 2027" si no es el año en curso.
function fmtFecha(iso) {
  const d = parseLocalDate(iso);
  if (!d) return '—';
  const base = `${d.getDate()} ${MONTHS_ES_SHORT[d.getMonth()].toLowerCase()}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

// Solapamiento entre dos rangos cerrados.
const solapan = (aDesde, aHasta, bDesde, bHasta) => aDesde <= bHasta && bDesde <= aHasta;

export default function VacacionesPage() {
  const { profile } = useAuth();

  const [personas, setPersonas] = useState([]);
  const [registros, setRegistros] = useState([]);
  const [feriados, setFeriados] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  // Ventana visible: 'mes' o 'anio', anclada a un mes/año concreto.
  const [vista, setVista] = useState('mes');
  const hoy = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const [anchor, setAnchor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  // Filtros de la tabla
  const [fPersona, setFPersona] = useState('');
  const [fTipo, setFTipo] = useState('');

  // ── Form de alta / edición ──
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId]     = useState(null);
  const [fmPersona, setFmPersona] = useState('');
  const [fmTipo, setFmTipo]       = useState('vacaciones');
  // Arrancan vacías a propósito: MiniCalendar interpreta el primer click como
  // "cerrar el rango" cuando ya hay un from cargado. Si prellenáramos con hoy,
  // el primer click del usuario pondría el otro extremo en vez de empezar de
  // cero, que es exactamente lo que espera al abrir el form.
  const [fmDesde, setFmDesde]     = useState('');
  const [fmHasta, setFmHasta]     = useState('');
  const [fmDesc, setFmDesc]       = useState('');
  const [fmErr, setFmErr]         = useState('');
  const [saving, setSaving]       = useState(false);

  // Confirmación de borrado en dos pasos, dentro de la página. No usamos
  // window.confirm: Chrome lo suprime en silencio cuando una pestaña abre
  // varios diálogos seguidos (el "impedir que esta página cree más cuadros
  // de diálogo"), y entonces devuelve false siempre — el botón queda muerto
  // sin ningún aviso. Con esto el borrado nunca depende del navegador.
  const [confirmando, setConfirmando] = useState(null); // id del registro
  const [filaErr, setFilaErr] = useState('');

  // ── Alta de persona nueva ──
  const [showPersona, setShowPersona] = useState(false);
  const [pEtiqueta, setPEtiqueta] = useState('');
  const [pNombre, setPNombre]     = useState('');
  const [pColor, setPColor]       = useState(PALETA[0]);
  const [pErr, setPErr]           = useState('');

  // Rango visible en ISO, según la vista.
  const ventana = useMemo(() => {
    if (vista === 'anio') {
      const y = anchor.getFullYear();
      return { from: `${y}-01-01`, to: `${y}-12-31`, y };
    }
    const y = anchor.getFullYear(), m = anchor.getMonth();
    const ultimo = new Date(y, m + 1, 0).getDate();
    return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(ultimo)}`, y };
  }, [vista, anchor]);

  // ── Carga ──

  const cargarPersonas = useCallback(async () => {
    const r = await fetch(`${API}/api/db/vacaciones-personas`);
    if (!r.ok) throw new Error(`personas HTTP ${r.status}`);
    const data = await r.json();
    setPersonas(Array.isArray(data) ? data : []);
  }, []);

  const cargarRegistros = useCallback(async () => {
    const r = await fetch(`${API}/api/db/vacaciones?from=${ventana.from}&to=${ventana.to}`);
    if (!r.ok) throw new Error(`vacaciones HTTP ${r.status}`);
    const data = await r.json();
    setRegistros(Array.isArray(data) ? data : []);
  }, [ventana.from, ventana.to]);

  // Feriados del calendario BOLSAR, para el cómputo de días hábiles. Si el
  // endpoint falla no rompemos nada: se cuentan sólo los fines de semana.
  const cargarFeriados = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/bolsar/calendar?from=${ventana.y}-01-01&to=${ventana.y}-12-31`);
      if (!r.ok) return;
      const ev = await r.json();
      const set = new Set();
      (Array.isArray(ev) ? ev : []).forEach(e => { if (e?.kind === 'feriado' && e.date) set.add(e.date); });
      setFeriados(set);
    } catch { /* sin feriados, seguimos */ }
  }, [ventana.y]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setLoading(true); setLoadErr('');
      try {
        await Promise.all([cargarPersonas(), cargarRegistros()]);
        if (vivo) cargarFeriados();
      } catch (e) {
        if (vivo) setLoadErr(e.message || 'Error cargando vacaciones');
      } finally {
        if (vivo) setLoading(false);
      }
    })();
    return () => { vivo = false; };
  }, [cargarPersonas, cargarRegistros, cargarFeriados]);

  const personaPorId = useMemo(() => {
    const m = new Map();
    personas.forEach(p => m.set(p.id, p));
    return m;
  }, [personas]);

  // ── Derivados para las vistas ──

  // Quién está ausente hoy (banner superior).
  const ausentesHoy = useMemo(() => {
    const iso = todayIso();
    return registros
      .filter(r => r.desde <= iso && r.hasta >= iso)
      .map(r => ({ reg: r, persona: personaPorId.get(r.persona_id) }))
      .filter(x => x.persona);
  }, [registros, personaPorId]);

  // Pares de personas cuyos períodos se pisan dentro de la ventana visible.
  const solapamientos = useMemo(() => {
    const out = [];
    for (let i = 0; i < registros.length; i++) {
      for (let j = i + 1; j < registros.length; j++) {
        const a = registros[i], b = registros[j];
        if (a.persona_id === b.persona_id) continue;
        if (!solapan(a.desde, a.hasta, b.desde, b.hasta)) continue;
        const pa = personaPorId.get(a.persona_id), pb = personaPorId.get(b.persona_id);
        if (pa && pb) out.push({ a: pa.etiqueta, b: pb.etiqueta });
      }
    }
    // Deduplicamos por par de etiquetas.
    const vistos = new Set();
    return out.filter(({ a, b }) => {
      const k = [a, b].sort().join('|');
      if (vistos.has(k)) return false;
      vistos.add(k); return true;
    });
  }, [registros, personaPorId]);

  const registrosFiltrados = useMemo(() => {
    return registros
      .filter(r => !fPersona || r.persona_id === fPersona)
      .filter(r => !fTipo || r.tipo === fTipo)
      .slice()
      .sort((a, b) => a.desde.localeCompare(b.desde));
  }, [registros, fPersona, fTipo]);

  // Total de días por persona en la ventana, para la columna de la izquierda.
  const totalPorPersona = useMemo(() => {
    const m = new Map();
    registros.forEach(r => {
      if (r.tipo !== 'vacaciones') return;
      // Recortamos el período a la ventana visible para no contar de más.
      const d = r.desde < ventana.from ? ventana.from : r.desde;
      const h = r.hasta > ventana.to   ? ventana.to   : r.hasta;
      m.set(r.persona_id, (m.get(r.persona_id) || 0) + diasHabiles(d, h, feriados));
    });
    return m;
  }, [registros, ventana, feriados]);

  // ── Acciones ──

  const abrirAlta = () => {
    setEditId(null);
    setFmPersona(personas[0]?.id || '');
    setFmTipo('vacaciones');
    setFmDesde(''); setFmHasta('');
    setFmDesc(''); setFmErr('');
    setShowForm(true);
  };

  const abrirEdicion = (r) => {
    setEditId(r.id);
    setFmPersona(r.persona_id);
    setFmTipo(r.tipo);
    setFmDesde(r.desde); setFmHasta(r.hasta);
    setFmDesc(r.descripcion || ''); setFmErr('');
    setShowForm(true);
  };

  const guardar = async () => {
    setFmErr('');
    if (!fmPersona) { setFmErr('Elegí una persona.'); return; }
    if (!fmDesde || !fmHasta) { setFmErr('Elegí el rango de días en el calendario.'); return; }
    if (fmHasta < fmDesde) { setFmErr('La fecha de fin no puede ser anterior a la de inicio.'); return; }
    setSaving(true);
    try {
      const body = {
        persona_id: fmPersona, tipo: fmTipo,
        desde: fmDesde, hasta: fmHasta,
        descripcion: fmDesc.trim() || null,
        creado_por: profile?.email || null,
      };
      const url = editId ? `${API}/api/db/vacaciones/${editId}` : `${API}/api/db/vacaciones`;
      const r = await fetch(url, {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setShowForm(false);
      await cargarRegistros();
    } catch (e) {
      setFmErr(e.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const borrar = async (r) => {
    setFilaErr('');
    try {
      const resp = await fetch(`${API}/api/db/vacaciones/${r.id}`, { method: 'DELETE' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setConfirmando(null);
      // Si el form estaba abierto editando justo este registro, lo cerramos:
      // quedaría apuntando a algo que ya no existe.
      if (editId === r.id) setShowForm(false);
      await cargarRegistros();
    } catch (e) {
      setFilaErr(`No se pudo borrar: ${e.message}`);
    }
  };

  const crearPersona = async () => {
    setPErr('');
    const etiqueta = pEtiqueta.trim().toUpperCase();
    const nombre = pNombre.trim();
    if (!etiqueta || !nombre) { setPErr('Completá etiqueta y nombre.'); return; }
    if (!/^[A-Z0-9]{2,6}$/.test(etiqueta)) { setPErr('La etiqueta debe tener de 2 a 6 caracteres (letras o números).'); return; }
    if (personas.some(p => p.etiqueta === etiqueta)) { setPErr(`Ya existe la etiqueta ${etiqueta}.`); return; }
    try {
      const r = await fetch(`${API}/api/db/vacaciones-personas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etiqueta, nombre, color: pColor }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setPEtiqueta(''); setPNombre(''); setShowPersona(false);
      await cargarPersonas();
      if (data?.id) setFmPersona(data.id);
    } catch (e) {
      setPErr(e.message || 'No se pudo crear la persona');
    }
  };

  const bajaPersona = async (p) => {
    if (p.primaria) return;
    setFilaErr('');
    try {
      const r = await fetch(`${API}/api/db/vacaciones-personas/${p.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setConfirmando(null);
      await cargarPersonas();
    } catch (e) {
      setFilaErr(`No se pudo dar de baja a ${p.etiqueta}: ${e.message}`);
    }
  };

  // La confirmación se desarma sola a los 6s, para no dejar un botón rojo
  // "armado" si el usuario se distrae y vuelve más tarde.
  useEffect(() => {
    if (!confirmando) return;
    const t = setTimeout(() => setConfirmando(null), 6000);
    return () => clearTimeout(t);
  }, [confirmando]);

  // Color libre sugerido para la próxima persona.
  useEffect(() => {
    const usados = new Set(personas.map(p => p.color));
    setPColor(PALETA.find(c => !usados.has(c)) || PALETA[0]);
  }, [personas]);

  // ── Navegación de la ventana ──
  const mover = (delta) => {
    setAnchor(a => vista === 'anio'
      ? new Date(a.getFullYear() + delta, 0, 1)
      : new Date(a.getFullYear(), a.getMonth() + delta, 1));
  };
  const irHoy = () => setAnchor(new Date(hoy.getFullYear(), hoy.getMonth(), 1));

  const tituloVentana = vista === 'anio'
    ? String(anchor.getFullYear())
    : `${MONTHS_ES[anchor.getMonth()]} ${anchor.getFullYear()}`;

  return (
    <div style={S.page}>
      {/* ── Barra de control ── */}
      <div style={S.toolbar}>
        <div style={S.navGroup}>
          <button type="button" style={S.navBtn} onClick={() => mover(-1)} aria-label="Anterior">‹</button>
          <span style={S.ventanaTitulo}>{tituloVentana}</span>
          <button type="button" style={S.navBtn} onClick={() => mover(1)} aria-label="Siguiente">›</button>
          <button type="button" style={S.hoyBtn} onClick={irHoy}>HOY</button>
        </div>

        <div style={S.navGroup}>
          <div style={S.toggle}>
            {['mes', 'anio'].map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setVista(v)}
                style={{ ...S.toggleBtn, ...(vista === v ? S.toggleBtnOn : null) }}
              >
                {v === 'mes' ? 'MES' : 'AÑO'}
              </button>
            ))}
          </div>
          <button type="button" style={S.primaryBtn} onClick={abrirAlta}>+ CARGAR AUSENCIA</button>
        </div>
      </div>

      {loadErr && <div style={S.error}>{loadErr}</div>}

      {/* ── Estado de hoy ── */}
      <div style={S.hoyBanner}>
        <span style={S.hoyLabel}>HOY</span>
        {ausentesHoy.length === 0
          ? <span style={S.hoyVacio}>Todo el equipo disponible</span>
          : ausentesHoy.map(({ reg, persona }) => (
              <span key={reg.id} style={{ ...S.chip, borderColor: persona.color, color: persona.color }}>
                {persona.etiqueta}
                <span style={S.chipTipo}>{tipoDef(reg.tipo).abbr}</span>
                <span style={S.chipHasta}>hasta {fmtFecha(reg.hasta)}</span>
              </span>
            ))}
      </div>

      {solapamientos.length > 0 && (
        <div style={S.warn}>
          <b>Solapamientos en {vista === 'anio' ? 'el año' : 'el mes'}:</b>{' '}
          {solapamientos.map(s => `${s.a}↔${s.b}`).join(' · ')}
        </div>
      )}

      {/* ── Timeline ── */}
      <Timeline
        vista={vista}
        anchor={anchor}
        ventana={ventana}
        personas={personas}
        registros={registros}
        feriados={feriados}
        totalPorPersona={totalPorPersona}
        hoy={hoy}
        onClickRegistro={abrirEdicion}
        loading={loading}
      />

      {/* ── Leyenda ── */}
      <div style={S.leyenda}>
        {TIPOS.map(t => (
          <span key={t.key} style={S.leyendaItem}>
            <span style={{ ...S.leyendaDot, background: t.color }} />{t.label}
          </span>
        ))}
        <span style={S.leyendaSep} />
        <span style={S.leyendaNota}>Los días se cuentan hábiles (sin fines de semana ni feriados)</span>
      </div>

      {/* ── Form de alta / edición ── */}
      {showForm && (
        <div style={S.formCard}>
          <div style={S.formHead}>
            <span style={S.formTitulo}>{editId ? 'EDITAR AUSENCIA' : 'NUEVA AUSENCIA'}</span>
            <button type="button" style={S.closeBtn} onClick={() => setShowForm(false)}>✕</button>
          </div>

          <div style={S.formGrid}>
            <div style={S.formCol}>
              <label style={S.label}>PERSONA</label>
              <div style={S.rowGap}>
                <select style={S.select} value={fmPersona} onChange={e => setFmPersona(e.target.value)}>
                  <option value="">— elegir —</option>
                  {personas.map(p => (
                    <option key={p.id} value={p.id}>{p.etiqueta} · {p.nombre}</option>
                  ))}
                </select>
                <button type="button" style={S.ghostBtn} onClick={() => setShowPersona(v => !v)}>
                  {showPersona ? 'CANCELAR' : '+ NUEVA'}
                </button>
              </div>

              {showPersona && (
                <div style={S.subCard}>
                  <div style={S.rowGap}>
                    <input
                      style={{ ...S.input, width: 90 }}
                      placeholder="ETIQUETA"
                      value={pEtiqueta}
                      maxLength={6}
                      onChange={e => setPEtiqueta(e.target.value.toUpperCase())}
                    />
                    <input
                      style={{ ...S.input, flex: 1 }}
                      placeholder="Nombre y apellido"
                      value={pNombre}
                      onChange={e => setPNombre(e.target.value)}
                    />
                  </div>
                  <div style={S.rowGap}>
                    <span style={S.labelInline}>COLOR</span>
                    {PALETA.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setPColor(c)}
                        style={{ ...S.swatch, background: c, outline: pColor === c ? '2px solid var(--text)' : 'none' }}
                        aria-label={`Color ${c}`}
                      />
                    ))}
                  </div>
                  {pErr && <div style={S.errorInline}>{pErr}</div>}
                  <button type="button" style={S.primaryBtn} onClick={crearPersona}>CREAR PERSONA</button>
                </div>
              )}

              <label style={S.label}>TIPO</label>
              <div style={S.tipoRow}>
                {TIPOS.map(t => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setFmTipo(t.key)}
                    style={{
                      ...S.tipoBtn,
                      ...(fmTipo === t.key ? { borderColor: t.color, color: t.color, background: `${t.color}14` } : null),
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <label style={S.label}>DESCRIPCIÓN</label>
              <input
                style={S.input}
                placeholder="Opcional — ej. viaje a Bariloche, curso CFA"
                value={fmDesc}
                onChange={e => setFmDesc(e.target.value)}
              />

              <div style={S.resumen}>
                {fmDesde && fmHasta ? (
                  <>
                    <b>{diasCorridos(fmDesde, fmHasta)}</b> días corridos ·{' '}
                    <b>{diasHabiles(fmDesde, fmHasta, feriados)}</b> hábiles
                    <span style={S.resumenFechas}>{fmtFecha(fmDesde)} → {fmtFecha(fmHasta)}</span>
                  </>
                ) : (
                  <span style={S.dim}>Elegí el rango en el calendario de la derecha</span>
                )}
              </div>

              {fmErr && <div style={S.errorInline}>{fmErr}</div>}

              <div style={S.rowGap}>
                <button type="button" style={S.primaryBtn} disabled={saving} onClick={guardar}>
                  {saving ? 'GUARDANDO…' : (editId ? 'GUARDAR CAMBIOS' : 'CARGAR')}
                </button>
                <button type="button" style={S.ghostBtn} onClick={() => setShowForm(false)}>CANCELAR</button>
              </div>
            </div>

            <div style={S.formCol}>
              <label style={S.label}>RANGO DE DÍAS</label>
              <MiniCalendar
                mode="range"
                fromIso={fmDesde}
                toIso={fmHasta}
                onChange={({ fromIso, toIso }) => { setFmDesde(fromIso); setFmHasta(toIso); }}
              />
              <div style={S.calNota}>Click en el día de inicio, después en el de fin.</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tabla ── */}
      <div style={S.tablaHead}>
        <span style={S.seccionTitulo}>REGISTROS {vista === 'anio' ? `DE ${anchor.getFullYear()}` : `DE ${MONTHS_ES[anchor.getMonth()].toUpperCase()}`}</span>
        <div style={S.rowGap}>
          <select style={S.selectSm} value={fPersona} onChange={e => setFPersona(e.target.value)}>
            <option value="">Todas las personas</option>
            {personas.map(p => <option key={p.id} value={p.id}>{p.etiqueta}</option>)}
          </select>
          <select style={S.selectSm} value={fTipo} onChange={e => setFTipo(e.target.value)}>
            <option value="">Todos los tipos</option>
            {TIPOS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {filaErr && <div style={S.error}>{filaErr}</div>}

      <div style={S.tablaWrap}>
        <table style={S.tabla}>
          <thead>
            <tr>
              <th style={S.th}>PERSONA</th>
              <th style={S.th}>TIPO</th>
              <th style={S.th}>DESDE</th>
              <th style={S.th}>HASTA</th>
              <th style={{ ...S.th, textAlign: 'right' }}>DÍAS</th>
              <th style={S.th}>DESCRIPCIÓN</th>
              <th style={{ ...S.th, textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} style={S.empty}>Cargando…</td></tr>
            )}
            {!loading && registrosFiltrados.length === 0 && (
              <tr><td colSpan={7} style={S.empty}>Sin registros en este período.</td></tr>
            )}
            {!loading && registrosFiltrados.map(r => {
              const p = personaPorId.get(r.persona_id);
              const t = tipoDef(r.tipo);
              return (
                <tr key={r.id} style={S.tr}>
                  <td style={S.td}>
                    <span style={{ ...S.personaTag, borderColor: p?.color, color: p?.color }}>{p?.etiqueta || '—'}</span>
                    <span style={S.personaNombre}>{p?.nombre || ''}</span>
                  </td>
                  <td style={S.td}><span style={{ ...S.tipoTag, background: `${t.color}1f`, color: t.color }}>{t.label}</span></td>
                  <td style={S.tdMono}>{fmtFecha(r.desde)}</td>
                  <td style={S.tdMono}>{fmtFecha(r.hasta)}</td>
                  <td style={{ ...S.tdMono, textAlign: 'right' }}>
                    {diasHabiles(r.desde, r.hasta, feriados)}
                    <span style={S.diasCorridos}>/{diasCorridos(r.desde, r.hasta)}</span>
                  </td>
                  <td style={S.tdDesc}>{r.descripcion || <span style={S.dim}>—</span>}</td>
                  <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {confirmando === r.id ? (
                      <>
                        <button type="button" style={S.confirmBtn} onClick={() => borrar(r)}>SÍ, BORRAR</button>
                        <button type="button" style={S.iconBtn} onClick={() => setConfirmando(null)}>NO</button>
                      </>
                    ) : (
                      <>
                        <button type="button" style={S.iconBtn} onClick={() => abrirEdicion(r)} title="Editar">✎</button>
                        <button type="button" style={S.iconBtnDanger} onClick={() => setConfirmando(r.id)} title="Borrar">🗑</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Personas ── */}
      <div style={S.personasCard}>
        <span style={S.seccionTitulo}>PARTICIPANTES</span>
        <div style={S.personasRow}>
          {personas.map(p => (
            <span key={p.id} style={{ ...S.personaChip, borderColor: p.color }}>
              <span style={{ ...S.personaChipTag, color: p.color }}>{p.etiqueta}</span>
              <span style={S.personaChipNombre}>{p.nombre}</span>
              {p.primaria
                ? <span style={S.primariaTag}>fija</span>
                : confirmando === p.id
                  ? <button type="button" style={S.confirmBtnSm} onClick={() => bajaPersona(p)}>¿BAJA?</button>
                  : <button type="button" style={S.chipX} onClick={() => setConfirmando(p.id)} title="Dar de baja">✕</button>}
            </span>
          ))}
        </div>
      </div>

      <div style={S.footnote}>
        Los registros son compartidos: lo que carga cualquiera lo ven todos.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  TIMELINE — una fila por persona, barras sobre la grilla de días o meses.
//
//  Se posiciona con porcentajes sobre un contenedor relativo: la barra arranca
//  en (díaInicio / totalDías)% y mide (duración / totalDías)%. Los períodos que
//  se salen de la ventana se recortan a los bordes.
// ─────────────────────────────────────────────────────────────────────────────
function Timeline({ vista, anchor, ventana, personas, registros, feriados, totalPorPersona, hoy, onClickRegistro, loading }) {
  const inicio = parseLocalDate(ventana.from);
  const fin    = parseLocalDate(ventana.to);
  const totalDias = Math.round((fin - inicio) / 86400000) + 1;

  // Columnas de la cabecera: días (vista mes) o meses (vista año).
  const columnas = useMemo(() => {
    if (vista === 'anio') {
      return MONTHS_ES_SHORT.map((label, i) => {
        const primero = new Date(anchor.getFullYear(), i, 1);
        const offset = Math.round((primero - inicio) / 86400000);
        const dias = new Date(anchor.getFullYear(), i + 1, 0).getDate();
        return { label, offset, dias, finde: false, feriado: false };
      });
    }
    const out = [];
    for (let i = 0; i < totalDias; i++) {
      const d = addDays(inicio, i);
      out.push({
        label: String(d.getDate()),
        offset: i,
        dias: 1,
        finde: isWeekend(d),
        feriado: feriados.has(dateToIso(d)),
      });
    }
    return out;
  }, [vista, anchor, inicio, totalDias, feriados]);

  // Posición de la línea de "hoy", si cae dentro de la ventana.
  const hoyPct = useMemo(() => {
    const off = Math.round((hoy - inicio) / 86400000);
    if (off < 0 || off >= totalDias) return null;
    return ((off + 0.5) / totalDias) * 100;
  }, [hoy, inicio, totalDias]);

  // Barras por persona, ya recortadas a la ventana.
  const barrasPorPersona = useMemo(() => {
    const m = new Map();
    registros.forEach(r => {
      const d = parseLocalDate(r.desde), h = parseLocalDate(r.hasta);
      if (!d || !h) return;
      const ini = Math.max(0, Math.round((d - inicio) / 86400000));
      const f   = Math.min(totalDias - 1, Math.round((h - inicio) / 86400000));
      if (f < 0 || ini > totalDias - 1) return;
      const arr = m.get(r.persona_id) || [];
      arr.push({
        reg: r,
        left:  (ini / totalDias) * 100,
        width: ((f - ini + 1) / totalDias) * 100,
        cortadaIzq: d < inicio,
        cortadaDer: h > fin,
      });
      m.set(r.persona_id, arr);
    });
    return m;
  }, [registros, inicio, fin, totalDias]);

  if (personas.length === 0 && !loading) {
    return <div style={S.timelineVacio}>No hay participantes cargados.</div>;
  }

  return (
    <div style={S.timelineWrap}>
      {/* Cabecera de columnas */}
      <div style={S.tlRow}>
        <div style={S.tlLabelCol} />
        <div style={S.tlGrid}>
          {columnas.map((c, i) => (
            <div
              key={i}
              style={{
                ...S.tlHeadCell,
                left: `${(c.offset / totalDias) * 100}%`,
                width: `${(c.dias / totalDias) * 100}%`,
                color: c.feriado ? 'var(--red, #ef4444)' : (c.finde ? 'var(--text-dim)' : 'var(--text)'),
                opacity: c.finde && !c.feriado ? 0.45 : 1,
              }}
            >
              {c.label}
            </div>
          ))}
        </div>
      </div>

      {/* Una fila por persona */}
      {personas.map(p => {
        const barras = barrasPorPersona.get(p.id) || [];
        const total = totalPorPersona.get(p.id) || 0;
        return (
          <div key={p.id} style={S.tlRow}>
            <div style={S.tlLabelCol}>
              <span style={{ ...S.tlTag, borderColor: p.color, color: p.color }}>{p.etiqueta}</span>
              {total > 0 && <span style={S.tlTotal}>{total}d</span>}
            </div>
            <div style={S.tlGrid}>
              {/* Fondo: fines de semana y feriados sombreados (sólo vista mes) */}
              {vista === 'mes' && columnas.map((c, i) => (
                (c.finde || c.feriado) ? (
                  <div
                    key={`bg${i}`}
                    style={{
                      ...S.tlBgCell,
                      left: `${(c.offset / totalDias) * 100}%`,
                      width: `${(1 / totalDias) * 100}%`,
                      background: c.feriado ? 'rgba(239,68,68,0.10)' : 'rgba(127,127,127,0.10)',
                    }}
                  />
                ) : null
              ))}

              {/* Línea de hoy */}
              {hoyPct != null && <div style={{ ...S.tlHoy, left: `${hoyPct}%` }} />}

              {/* Barras */}
              {barras.map(b => {
                const t = tipoDef(b.reg.tipo);
                return (
                  <button
                    key={b.reg.id}
                    type="button"
                    onClick={() => onClickRegistro(b.reg)}
                    title={`${p.nombre} · ${t.label}\n${fmtFecha(b.reg.desde)} → ${fmtFecha(b.reg.hasta)}${b.reg.descripcion ? `\n${b.reg.descripcion}` : ''}`}
                    style={{
                      ...S.tlBar,
                      left: `${b.left}%`,
                      width: `${b.width}%`,
                      background: `${t.color}2e`,
                      borderColor: t.color,
                      borderLeftStyle: b.cortadaIzq ? 'dashed' : 'solid',
                      borderRightStyle: b.cortadaDer ? 'dashed' : 'solid',
                      color: t.color,
                    }}
                  >
                    <span style={S.tlBarLabel}>{t.abbr}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Estilos — mismas variables CSS que el resto del dashboard.
// ─────────────────────────────────────────────────────────────────────────────
const MONO = "'Roboto Mono',monospace";

const S = {
  page: { display: 'flex', flexDirection: 'column', gap: 14 },

  toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  navGroup: { display: 'flex', alignItems: 'center', gap: 8 },
  navBtn: {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text)', fontSize: 16, lineHeight: 1, padding: '4px 11px', cursor: 'pointer',
  },
  ventanaTitulo: {
    fontFamily: MONO, fontSize: 13, fontWeight: 700, letterSpacing: 1.5,
    color: 'var(--text)', textTransform: 'uppercase', minWidth: 150, textAlign: 'center',
  },
  hoyBtn: {
    background: 'transparent', border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text-dim)', fontFamily: MONO, fontSize: 9, fontWeight: 700,
    letterSpacing: 1.5, padding: '5px 10px', cursor: 'pointer',
  },
  toggle: { display: 'flex', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' },
  toggleBtn: {
    background: 'transparent', border: 'none', color: 'var(--text-dim)',
    fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
    padding: '6px 13px', cursor: 'pointer',
  },
  toggleBtnOn: { background: 'var(--bg-card)', color: 'var(--neon)' },
  primaryBtn: {
    background: 'transparent', border: '1px solid var(--neon)', borderRadius: 4,
    color: 'var(--neon)', fontFamily: MONO, fontSize: 10, fontWeight: 700,
    letterSpacing: 1.5, padding: '7px 14px', cursor: 'pointer',
  },
  ghostBtn: {
    background: 'transparent', border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text-dim)', fontFamily: MONO, fontSize: 10, fontWeight: 700,
    letterSpacing: 1.5, padding: '7px 12px', cursor: 'pointer',
  },

  hoyBanner: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '9px 13px',
  },
  hoyLabel: { fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--text-dim)' },
  hoyVacio: { fontFamily: MONO, fontSize: 11, color: 'var(--text-dim)', opacity: 0.8 },
  chip: {
    display: 'inline-flex', alignItems: 'center', gap: 7,
    border: '1px solid', borderRadius: 4, padding: '3px 9px',
    fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: 1,
  },
  chipTipo: { fontSize: 8, opacity: 0.75, letterSpacing: 1 },
  chipHasta: { fontSize: 9, color: 'var(--text-dim)', fontWeight: 400, letterSpacing: 0 },

  warn: {
    background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.45)',
    borderRadius: 6, padding: '8px 13px',
    fontFamily: MONO, fontSize: 10, letterSpacing: 0.5, color: 'var(--text)',
  },
  error: {
    background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.45)',
    borderRadius: 6, padding: '8px 13px', fontFamily: MONO, fontSize: 11, color: '#ef4444',
  },
  errorInline: { fontFamily: MONO, fontSize: 10, color: '#ef4444', letterSpacing: 0.3 },

  // ── Timeline ──
  timelineWrap: {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '10px 13px', display: 'flex', flexDirection: 'column', gap: 3, overflowX: 'auto',
  },
  timelineVacio: {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
    padding: 24, textAlign: 'center', fontFamily: MONO, fontSize: 11, color: 'var(--text-dim)',
  },
  tlRow: { display: 'flex', alignItems: 'center', gap: 10, minHeight: 26 },
  tlLabelCol: { width: 74, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 },
  tlTag: {
    border: '1px solid', borderRadius: 3, padding: '2px 6px',
    fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: 1,
  },
  tlTotal: { fontFamily: MONO, fontSize: 9, color: 'var(--text-dim)', opacity: 0.8 },
  tlGrid: { position: 'relative', flex: 1, height: 22, minWidth: 320 },
  tlHeadCell: {
    position: 'absolute', top: 0, textAlign: 'center',
    fontFamily: MONO, fontSize: 8.5, letterSpacing: 0.3, lineHeight: '22px',
  },
  tlBgCell: { position: 'absolute', top: 0, bottom: 0, borderRadius: 2 },
  tlHoy: { position: 'absolute', top: -2, bottom: -2, width: 1, background: 'var(--neon)', opacity: 0.75, zIndex: 3 },
  tlBar: {
    position: 'absolute', top: 2, height: 18,
    border: '1px solid', borderRadius: 3, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, overflow: 'hidden', zIndex: 2,
  },
  tlBarLabel: { fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: 0.8, whiteSpace: 'nowrap' },

  leyenda: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  leyendaItem: { display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MONO, fontSize: 9, color: 'var(--text-dim)', letterSpacing: 0.8 },
  leyendaDot: { width: 9, height: 9, borderRadius: 2, display: 'inline-block' },
  leyendaSep: { flex: 1 },
  leyendaNota: { fontFamily: MONO, fontSize: 9, color: 'var(--text-dim)', opacity: 0.7 },

  // ── Form ──
  formCard: {
    background: 'var(--bg-card)', border: '1px solid var(--border-neon, var(--border))',
    borderRadius: 6, padding: 16,
  },
  formHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  formTitulo: { fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: 2, color: 'var(--neon)' },
  closeBtn: { background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 15, cursor: 'pointer', lineHeight: 1 },
  formGrid: { display: 'flex', gap: 24, flexWrap: 'wrap' },
  formCol: { flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 280 },
  label: { fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: 1.8, color: 'var(--text-dim)', marginTop: 4 },
  labelInline: { fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: 'var(--text-dim)' },
  rowGap: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  select: {
    flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text)', fontFamily: MONO, fontSize: 11, padding: '7px 9px', minWidth: 160,
  },
  selectSm: {
    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text)', fontFamily: MONO, fontSize: 10, padding: '5px 8px',
  },
  input: {
    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text)', fontFamily: MONO, fontSize: 11, padding: '7px 9px',
  },
  subCard: {
    border: '1px dashed var(--border)', borderRadius: 5, padding: 10,
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  swatch: { width: 17, height: 17, borderRadius: 3, border: 'none', cursor: 'pointer', padding: 0 },
  tipoRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  tipoBtn: {
    background: 'transparent', border: '1px solid var(--border)', borderRadius: 4,
    color: 'var(--text-dim)', fontFamily: MONO, fontSize: 9.5, fontWeight: 600,
    letterSpacing: 0.8, padding: '6px 10px', cursor: 'pointer',
  },
  resumen: {
    fontFamily: MONO, fontSize: 11, color: 'var(--text)',
    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4,
    padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  },
  resumenFechas: { marginLeft: 'auto', fontSize: 10, color: 'var(--text-dim)' },
  calNota: { fontFamily: MONO, fontSize: 9, color: 'var(--text-dim)', opacity: 0.75, textAlign: 'center' },

  // ── Tabla ──
  tablaHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 6 },
  seccionTitulo: { fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: 2, color: 'var(--text-dim)' },
  tablaWrap: { border: '1px solid var(--border)', borderRadius: 6, overflowX: 'auto', background: 'var(--bg-card)' },
  tabla: { width: '100%', borderCollapse: 'collapse', minWidth: 720 },
  th: {
    textAlign: 'left', fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: 1.5,
    color: 'var(--text-dim)', padding: '9px 11px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  },
  tr: { borderBottom: '1px solid var(--border)' },
  td: { padding: '8px 11px', fontSize: 12, color: 'var(--text)', verticalAlign: 'middle' },
  tdMono: { padding: '8px 11px', fontFamily: MONO, fontSize: 11, color: 'var(--text)', whiteSpace: 'nowrap' },
  tdDesc: { padding: '8px 11px', fontSize: 11.5, color: 'var(--text-dim)', maxWidth: 260 },
  diasCorridos: { color: 'var(--text-dim)', opacity: 0.6, fontSize: 9.5 },
  dim: { opacity: 0.4 },
  empty: { padding: 20, textAlign: 'center', fontFamily: MONO, fontSize: 11, color: 'var(--text-dim)' },
  personaTag: {
    border: '1px solid', borderRadius: 3, padding: '2px 6px', marginRight: 8,
    fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: 1,
  },
  personaNombre: { fontSize: 11, color: 'var(--text-dim)' },
  tipoTag: { borderRadius: 3, padding: '3px 8px', fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: 0.5 },
  iconBtn: {
    background: 'transparent', border: '1px solid var(--border)', borderRadius: 3,
    color: 'var(--text-dim)', fontSize: 11, padding: '3px 8px', cursor: 'pointer', marginLeft: 5,
  },
  iconBtnDanger: {
    background: 'transparent', border: '1px solid var(--border)', borderRadius: 3,
    color: '#ef4444', fontSize: 11, padding: '3px 8px', cursor: 'pointer', marginLeft: 5,
  },
  confirmBtn: {
    background: 'rgba(239,68,68,0.14)', border: '1px solid #ef4444', borderRadius: 3,
    color: '#ef4444', fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: 1,
    padding: '4px 9px', cursor: 'pointer', marginLeft: 5,
  },
  confirmBtnSm: {
    background: 'rgba(239,68,68,0.14)', border: '1px solid #ef4444', borderRadius: 3,
    color: '#ef4444', fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: 0.8,
    padding: '2px 6px', cursor: 'pointer',
  },

  // ── Participantes ──
  personasCard: {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 9,
  },
  personasRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  personaChip: {
    display: 'inline-flex', alignItems: 'center', gap: 7,
    border: '1px solid', borderRadius: 4, padding: '4px 9px',
  },
  personaChipTag: { fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: 1 },
  personaChipNombre: { fontSize: 11, color: 'var(--text)' },
  primariaTag: { fontFamily: MONO, fontSize: 8, color: 'var(--text-dim)', opacity: 0.6, letterSpacing: 1 },
  chipX: { background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 10, cursor: 'pointer', padding: 0, lineHeight: 1 },

  footnote: {
    fontFamily: MONO, fontSize: 9, color: 'var(--text-dim)',
    letterSpacing: 1, textAlign: 'right', opacity: 0.7,
  },
};

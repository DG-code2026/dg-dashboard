import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const ASESORES = ['Juan Manuel Delfino', 'Gonzalo Gaviña Alvarado'];
const PLAZOS = ['CORTO', 'MEDIANO', 'LARGO'];
const PERFILES = ['CONSERVADOR', 'MODERADO', 'AGRESIVO'];
const CURRENCIES = ['ARS', 'USD-MEP', 'USD-CCL'];
const ASSET_TYPES = [
  { id: 'BONOS_PUBLICOS', label: 'Bono Soberano', bondLike: true },
  { id: 'BONOS_CORP', label: 'Bono Subsoberano', bondLike: true },
  { id: 'ON', label: 'Obligación Negociable', bondLike: true },
  { id: 'LETRAS', label: 'Letra', bondLike: true },
  { id: 'ACCIONES', label: 'Acción', bondLike: false },
  { id: 'CEDEARS', label: 'CEDEAR', bondLike: false },
  { id: 'FCI', label: 'FCI', bondLike: false },
];

const GREEN = '#22c55e';
const RED = '#ef4444';

function fmtN(v, dec = 2) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtDate(d) { if (!d) return '—'; try { return new Date(d).toLocaleDateString('es-AR'); } catch { return '—'; } }
function typeLabel(id) { return ASSET_TYPES.find(t => t.id === id)?.label || id; }

// Etiqueta que va en la columna TIPO de las tablas: "{tipo} · {descripción}" si hay desc.
function assetDisplayType(it) {
  if (it.is_manual) {
    const base = it.manual_type_label || 'Manual';
    const rc = it.manual_risk_class === 'variable' ? 'RV' : 'RF';
    const desc = it.snapshot_description;
    return desc ? `${base} · ${desc} · ${rc}` : `${base} · ${rc}`;
  }
  if (it.type === 'FCI') {
    const fundType = it.snapshot_fci?.fundType;
    const name = it.snapshot_fci?.name || it.snapshot_description;
    return fundType && name ? `FCI ${fundType} · ${name}` : (name ? `FCI · ${name}` : (fundType ? `FCI · ${fundType}` : 'FCI'));
  }
  const base = typeLabel(it.type);
  const desc = it.snapshot_description;
  return desc ? `${base} · ${desc}` : base;
}

// ══════════════════════════════════════════════
//  PAGE
// ══════════════════════════════════════════════
export default function PropuestasPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null); // null | { propuesta to edit, or {} for new }

  const fetchList = useCallback(async () => {
    try { const r = await fetch(`${API}/api/db/propuestas`); const d = await r.json(); if (Array.isArray(d)) setList(d); } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar esta propuesta?')) return;
    await fetch(`${API}/api/db/propuestas/${id}`, { method: 'DELETE' });
    fetchList();
  };

  if (editor) {
    return <PropuestaEditor
      initial={editor}
      onCancel={() => setEditor(null)}
      onSaved={() => { setEditor(null); fetchList(); }}
    />;
  }

  return (
    <div>
      <div style={S.topRow}>
        <div style={{ color: 'var(--text-dim)', fontSize: 11, fontFamily: "'Roboto Mono',monospace" }}>
          {list.length} propuesta{list.length !== 1 ? 's' : ''} guardada{list.length !== 1 ? 's' : ''}
        </div>
        <button style={S.addBtn} onClick={() => setEditor({})}>＋ NUEVA PROPUESTA</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)', fontSize: 12 }}>Cargando...</div>
      ) : !list.length ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>📋</div>
          <div style={{ fontSize: 13 }}>Sin propuestas guardadas</div>
          <div style={{ fontSize: 11, marginTop: 4, opacity: 0.6 }}>Creá una nueva para empezar</div>
        </div>
      ) : (
        <div style={S.rowList}>
          <div style={S.rowHeader}>
            <div style={{ ...S.col, ...S.colClient }}>CLIENTE</div>
            <div style={{ ...S.col, ...S.colAcct }}>CUENTA</div>
            <div style={{ ...S.col, ...S.colBroker }}>BROKER</div>
            <div style={{ ...S.col, ...S.colAsesor }}>ASESOR</div>
            <div style={{ ...S.col, ...S.colPlazo }}>PLAZO</div>
            <div style={{ ...S.col, ...S.colNum }}>MONTO</div>
            <div style={{ ...S.col, ...S.colNum }}># ACTIVOS</div>
            <div style={{ ...S.col, ...S.colDate }}>FECHA</div>
            <div style={{ ...S.col, ...S.colActions }} />
          </div>
          {list.map(p => (
            <div key={p.id} style={S.row} onClick={() => setEditor(p)}>
              <div style={{ ...S.col, ...S.colClient, fontWeight: 700, color: 'var(--neon)' }}>{p.client_name || '—'}</div>
              <div style={{ ...S.col, ...S.colAcct }}>{p.client_account || '—'}</div>
              <div style={{ ...S.col, ...S.colBroker }}>{p.broker || '—'}</div>
              <div style={{ ...S.col, ...S.colAsesor }}>{p.asesor || '—'}</div>
              <div style={{ ...S.col, ...S.colPlazo }}><span style={S.plazoPill}>{p.plazo}</span></div>
              <div style={{ ...S.col, ...S.colNum }}>{p.amount_total != null ? `${p.currency} ${fmtN(p.amount_total, 0)}` : '—'}</div>
              <div style={{ ...S.col, ...S.colNum }}>{Array.isArray(p.items) ? p.items.length : 0}</div>
              <div style={{ ...S.col, ...S.colDate }}>{fmtDate(p.created_at)}</div>
              <div style={{ ...S.col, ...S.colActions }} onClick={e => e.stopPropagation()}>
                <button style={S.iconBtn} onClick={() => setEditor(p)} title="Editar">✎</button>
                <button style={{ ...S.iconBtn, color: RED }} onClick={() => handleDelete(p.id)} title="Eliminar">×</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════
//  EDITOR
// ══════════════════════════════════════════════
function PropuestaEditor({ initial, onCancel, onSaved }) {
  const isEdit = !!initial.id;
  const [form, setForm] = useState(() => ({
    client_name: initial.client_name || '',
    client_account: initial.client_account || '',
    broker: initial.broker || '',
    asesor: initial.asesor || ASESORES[0],
    plazo: initial.plazo || 'MEDIANO',
    perfil: initial.perfil || 'MODERADO',
    amount_total: initial.amount_total ?? '',
    currency: initial.currency || 'ARS',
    notes: initial.notes || '',
    // Override del KPI "Cantidad de activos": cuando enabled, se reemplaza
    // el valor (y el label) de esa tarjeta por un texto libre definido por el usuario.
    override_count_enabled: !!initial.override_count_enabled,
    override_count_label: initial.override_count_label || '',
    override_count_value: initial.override_count_value || '',
  }));
  const [items, setItems] = useState(() => Array.isArray(initial.items) ? initial.items : []);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [flyerOpen, setFlyerOpen] = useState(false);

  const up = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const totalAmount = Number(form.amount_total) || 0;

  const addItem = (asset) => {
    setItems(prev => [...prev, {
      ticker: asset.ticker,
      type: asset.type,
      settlement: asset.settlement || (asset.is_manual ? null : 'A-24HS'),
      snapshot_currency: asset.currency ?? null,
      snapshot_description: asset.description || asset.fci?.name || null,
      snapshot_fci: asset.fci || null,
      snapshot_at: asset.snapshot_at || new Date().toISOString(),
      alloc_pct: 0,
      // Nominales manuales — opcional. null = no especificado.
      // Se muestra en el flyer cuando el toggle "Mostrar nominales" está activo.
      nominales: null,
      // Campos para carga manual (fuera de PPI): el usuario declara tipo, nombre y clase RF/RV.
      is_manual: !!asset.is_manual,
      manual_type_label: asset.manual_type_label || null,
      manual_risk_class: asset.manual_risk_class || null, // 'fija' | 'variable' | null
    }]);
  };

  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

  // Actualiza los nominales manuales del ítem i. Vacío = null (no especificado).
  const updateItemNominales = (idx, raw) => {
    const v = raw === '' ? null : Math.max(0, Number(raw) || 0);
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, nominales: v } : it));
  };

  const updateItemPct = (idx, pct) => {
    const raw = Math.max(0, Number(pct) || 0);
    setItems(prev => {
      const sumOthers = prev.reduce((s, it, i) => s + (i === idx ? 0 : (Number(it.alloc_pct) || 0)), 0);
      const available = Math.max(0, 100 - sumOthers);
      const capped = Math.min(raw, available);
      return prev.map((it, i) => i === idx ? { ...it, alloc_pct: capped } : it);
    });
  };

  // Reparte 100% en partes iguales entre todos los activos.
  // El último absorbe el residuo para que la suma cierre exactamente en 100.
  const distributeEvenly = () => {
    setItems(prev => {
      const n = prev.length;
      if (!n) return prev;
      const share = Number((100 / n).toFixed(2));
      return prev.map((it, i) => ({
        ...it,
        alloc_pct: i === n - 1 ? Number((100 - share * (n - 1)).toFixed(2)) : share,
      }));
    });
  };

  // Asigna a este ítem el % libre restante (100 - suma del resto).
  const useFreePct = (idx) => {
    setItems(prev => {
      const sumOthers = prev.reduce((s, it, i) => s + (i === idx ? 0 : (Number(it.alloc_pct) || 0)), 0);
      const available = Math.max(0, Number((100 - sumOthers).toFixed(2)));
      return prev.map((it, i) => i === idx ? { ...it, alloc_pct: available } : it);
    });
  };

  const refreshQuotes = async () => {
    if (!items.length) return;
    // Los ítems manuales no están en PPI: los salteamos y mapeamos la respuesta por índice original.
    const refreshable = items.map((it, i) => ({ it, i })).filter(x => !x.it.is_manual);
    if (!refreshable.length) return;
    setRefreshing(true);
    try {
      const r = await fetch(`${API}/api/ppi/asset/batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: refreshable.map(x => ({ ticker: x.it.ticker, type: x.it.type, settlement: x.it.settlement })) }) });
      const data = await r.json();
      setItems(prev => {
        const next = [...prev];
        refreshable.forEach((x, k) => {
          const d = data[k];
          if (!d || !d.found) return;
          next[x.i] = { ...next[x.i], snapshot_currency: d.currency ?? null, snapshot_description: d.description || d.fci?.name || next[x.i].snapshot_description || null, snapshot_fci: d.fci || next[x.i].snapshot_fci || null, snapshot_at: d.snapshot_at };
        });
        return next;
      });
    } catch (e) { alert('Error refrescando datos: ' + e.message); }
    finally { setRefreshing(false); }
  };

  const handleSave = async () => {
    if (!form.client_name.trim()) { alert('Falta el nombre del cliente.'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        amount_total: form.amount_total === '' ? null : Number(form.amount_total),
        items,
        // Los overrides van al top-level; el server los whitelistea antes de hablar con Supabase.
        override_count_enabled: !!form.override_count_enabled,
        override_count_label: form.override_count_label || '',
        override_count_value: form.override_count_value || '',
      };
      const url = isEdit
        ? `${API}/api/db/propuestas/${initial.id}`
        : `${API}/api/db/propuestas`;
      const method = isEdit ? 'PATCH' : 'POST';
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try { const d = await r.json(); msg = d.error || d.message || msg; } catch {}
        alert('Error guardando: ' + msg);
        return;
      }
      onSaved();
    } catch (e) { alert('Error guardando: ' + e.message); }
    finally { setSaving(false); }
  };

  // Aggregate metrics
  const agg = useMemo(() => computeAggregates(items), [items]);
  const pctSum = items.reduce((s, it) => s + (Number(it.alloc_pct) || 0), 0);

  return (
    <div>
      <div style={S.editorHead}>
        <button style={S.backBtn} onClick={onCancel}>← VOLVER</button>
        <div style={S.editorTitle}>{isEdit ? 'EDITAR PROPUESTA' : 'NUEVA PROPUESTA'}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.btnSecondary} onClick={onCancel}>CANCELAR</button>
          <button style={S.btnFlyer} onClick={() => setFlyerOpen(true)} disabled={!items.length} title={!items.length ? 'Agregá activos primero' : 'Generar flyer institucional'}>✦ FLYER</button>
          <button style={S.btnPrimary} onClick={handleSave} disabled={saving}>{saving ? 'GUARDANDO...' : 'GUARDAR'}</button>
        </div>
      </div>

      {flyerOpen && <FlyerModal form={form} items={items} agg={agg} onClose={() => setFlyerOpen(false)} />}

      {/* Datos del cliente + propuesta */}
      <div style={S.section}>
        <div style={S.secT}>DATOS DEL CLIENTE</div>
        <div style={S.formGrid}>
          <F l="Nombre cliente" req><input style={S.input} value={form.client_name} onChange={e => up('client_name', e.target.value)} placeholder="Juan Pérez" /></F>
          <F l="Nº Cuenta"><input style={S.input} value={form.client_account} onChange={e => up('client_account', e.target.value)} placeholder="001234" /></F>
          <F l="Broker"><input style={S.input} value={form.broker} onChange={e => up('broker', e.target.value)} placeholder="PPI / INVIU / …" /></F>
          <F l="Asesor">
            <select style={S.input} value={form.asesor} onChange={e => up('asesor', e.target.value)}>
              {ASESORES.map(a => <option key={a}>{a}</option>)}
            </select>
          </F>
          <F l="Plazo" style={{ gridColumn: 'span 2', minWidth: 260 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PLAZOS.map(pl => (
                <button key={pl} type="button" onClick={() => up('plazo', pl)} style={{ ...S.toggleBtn, ...(form.plazo === pl ? S.toggleActive : {}) }}>{pl}</button>
              ))}
            </div>
          </F>
          <F l="Perfil de inversión" style={{ gridColumn: 'span 2', minWidth: 320 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PERFILES.map(pf => (
                <button key={pf} type="button" onClick={() => up('perfil', pf)} style={{ ...S.toggleBtn, ...(form.perfil === pf ? S.toggleActive : {}), minWidth: 90 }} title={pf}>{pf}</button>
              ))}
            </div>
          </F>
          <F l="Monto estimado (cualquier moneda)">
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" step="1000" style={{ ...S.input, flex: 2 }} value={form.amount_total} onChange={e => up('amount_total', e.target.value)} placeholder="1000000" />
              <select style={{ ...S.input, flex: 1 }} value={form.currency} onChange={e => up('currency', e.target.value)}>
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </F>
        </div>
      </div>

      {/* Asset picker */}
      <AssetPicker onAdd={addItem} />

      {/* Tabla de items */}
      <div style={S.section}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={S.secT}>ACTIVOS SELECCIONADOS ({items.length})</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={S.toolBtn} onClick={distributeEvenly} disabled={!items.length} title="Dividir 100% en partes iguales entre los activos">⚖ DISTRIBUIR 100%</button>
            <button style={S.toolBtn} onClick={refreshQuotes} disabled={!items.length || refreshing}>{refreshing ? '↻ ...' : '↻ REFRESCAR'}</button>
          </div>
        </div>

        {!items.length ? (
          <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-dim)', fontSize: 11, border: '1px dashed var(--border)', borderRadius: 4 }}>
            Agregá activos usando el buscador de arriba
          </div>
        ) : (
          <>
            <div style={S.itemsTable}>
              <div style={S.itemHead}>
                <div style={{ ...S.itemCol, ...S.iColTicker }}>TICKER</div>
                <div style={{ ...S.itemCol, ...S.iColTypeWide }}>TIPO / DESCRIPCIÓN</div>
                <div style={{ ...S.itemCol, ...S.iColNum }}>MONEDA</div>
                <div style={{ ...S.itemCol, ...S.iColInput }}>%</div>
                <div style={{ ...S.itemCol, ...S.iColNominales }} title="Cantidad de nominales (opcional)">NOMINALES</div>
                <div style={{ ...S.itemCol, ...S.iColAction }} />
              </div>
              {items.map((it, i) => {
                const typeCell = assetDisplayType(it);
                // Cupo libre disponible si asignáramos el 100% - suma del resto a este ítem.
                const sumOthers = items.reduce((s, ot, j) => s + (i === j ? 0 : (Number(ot.alloc_pct) || 0)), 0);
                const availableHere = Math.max(0, Number((100 - sumOthers).toFixed(2)));
                const canUseFree = (Number(it.alloc_pct) || 0) === 0 && availableHere > 0;
                return (
                <div key={i} style={S.itemRow}>
                  <div style={{ ...S.itemCol, ...S.iColTicker, fontWeight: 700, color: 'var(--neon)' }}>{it.ticker}</div>
                  <div style={{ ...S.itemCol, ...S.iColTypeWide, fontSize: 10, color: 'var(--text-dim)' }} title={typeCell}>{typeCell}</div>
                  <div style={{ ...S.itemCol, ...S.iColNum }}>{it.snapshot_currency || '—'}</div>
                  <div style={{ ...S.itemCol, ...S.iColInput, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <input type="number" step="0.1" min="0" style={S.smallInput} value={it.alloc_pct} onChange={e => updateItemPct(i, e.target.value)} />
                    {canUseFree && (
                      <button
                        type="button"
                        style={S.freeBtn}
                        onClick={() => useFreePct(i)}
                        title={`Asignar el ${fmtN(availableHere)}% libre restante a ${it.ticker}`}
                      >
                        USAR LIBRE {fmtN(availableHere)}%
                      </button>
                    )}
                  </div>
                  <div style={{ ...S.itemCol, ...S.iColNominales }}>
                    <input
                      type="number" step="1" min="0"
                      style={S.smallInput}
                      value={it.nominales ?? ''}
                      onChange={e => updateItemNominales(i, e.target.value)}
                      placeholder="—"
                      title="Cantidad de nominales (opcional). Se muestra en el flyer cuando está habilitado 'Mostrar nominales'."
                    />
                  </div>
                  <div style={{ ...S.itemCol, ...S.iColAction }}>
                    <button style={{ ...S.iconBtn, color: RED }} onClick={() => removeItem(i)} title="Quitar">×</button>
                  </div>
                </div>
              );
              })}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, fontFamily: "'Roboto Mono',monospace", color: pctSum === 100 ? GREEN : 'var(--text-dim)' }}>
              Suma de %: <b>{fmtN(pctSum)}%</b>
            </div>
          </>
        )}
      </div>

      {/* Métricas agregadas */}
      {items.length > 0 && (
        <div style={S.section}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
            <div style={S.secT}>MÉTRICAS AGREGADAS</div>
            {/* Override del KPI "Cantidad de activos".
                Cuando enabled, la tarjeta "Activos" se reemplaza por un dato libre tipeado por el usuario
                — útil para reportes donde no tiene sentido mostrar cantidad de líneas (ej. "3 clases de riesgo"). */}
            <label style={S.overrideToggle} title="Reemplazar la tarjeta 'Activos' por un dato tipeado a mano">
              <input
                type="checkbox"
                checked={!!form.override_count_enabled}
                onChange={e => up('override_count_enabled', e.target.checked)}
                style={{ margin: 0 }}
              />
              <span>USAR DATO MANUAL EN LUGAR DE CANTIDAD DE ACTIVOS</span>
            </label>
          </div>
          {form.override_count_enabled && (
            <div style={S.overrideRow}>
              <F l="Etiqueta" style={{ flex: 1 }}>
                <input
                  style={S.input}
                  value={form.override_count_label}
                  onChange={e => up('override_count_label', e.target.value)}
                  placeholder="Ej: Clases de riesgo · Internacionales · Emisores distintos…"
                />
              </F>
              <F l="Valor" style={{ flex: 1 }}>
                <input
                  style={S.input}
                  value={form.override_count_value}
                  onChange={e => up('override_count_value', e.target.value)}
                  placeholder="Ej: 3 · Investment grade · Tres regiones…"
                />
              </F>
            </div>
          )}
          <div style={S.metricsGrid}>
            <AggCard
              l={form.override_count_enabled && form.override_count_label ? form.override_count_label : 'Activos'}
              v={form.override_count_enabled ? (form.override_count_value || '—') : items.length}
            />
            <AggCard l="% Renta Fija" v={`${fmtN(agg.pctFija)}%`} />
            <AggCard l="% Renta Variable" v={`${fmtN(agg.pctVariable)}%`} />
          </div>
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <MixCard title="Mix por tipo" rows={agg.byType} />
            <MixCard title="Mix por moneda" rows={agg.byCurrency} />
          </div>
        </div>
      )}

      <div style={S.section}>
        <div style={S.secT}>NOTAS</div>
        <textarea style={{ ...S.input, minHeight: 70, fontFamily: 'inherit', resize: 'vertical' }} value={form.notes} onChange={e => up('notes', e.target.value)} placeholder="Observaciones, estrategia, contexto de mercado…" />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
//  ASSET PICKER
// ══════════════════════════════════════════════
function AssetPicker({ onAdd }) {
  // Modo de carga: 'API' busca en PPI, 'MANUAL' permite declarar tipo/nombre/RF-RV a mano.
  const [mode, setMode] = useState('API');
  const [ticker, setTicker] = useState('');
  const [type, setType] = useState('BONOS_PUBLICOS');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { found, ticker, ..., error }
  // Campos manuales para FCI (PPI no expone fundType / mínimo / composición vía API pública).
  const [fciManual, setFciManual] = useState({ fundType: '', minInvestment: '', composition: '' });
  // Entrada totalmente manual (fondos / activos no cubiertos por PPI).
  const [manualForm, setManualForm] = useState({
    ticker: '',
    type_label: '',
    description: '',
    currency: 'ARS',
    risk_class: 'fija', // 'fija' | 'variable'
  });

  const search = async () => {
    if (!ticker || ticker.length < 2) return;
    setLoading(true); setResult(null);
    setFciManual({ fundType: '', minInvestment: '', composition: '' });
    try {
      const endpoint = type === 'FCI'
        ? `${API}/api/ppi/fci/info?ticker=${encodeURIComponent(ticker.toUpperCase())}`
        : `${API}/api/ppi/asset/info?ticker=${encodeURIComponent(ticker.toUpperCase())}&type=${type}`;
      const r = await fetch(endpoint);
      const d = await r.json();
      setResult(d);
    } catch (e) { setResult({ found: false, error: e.message }); }
    finally { setLoading(false); }
  };

  const confirmAdd = () => {
    if (!result?.found) return;
    // Para FCI: mergeamos los inputs manuales en fci antes de agregar.
    if (result.type === 'FCI') {
      const merged = {
        ...result,
        fci: {
          ...(result.fci || {}),
          fundType: fciManual.fundType.trim() || null,
          minInvestment: fciManual.minInvestment === '' ? null : Number(fciManual.minInvestment),
          portfolio: fciManual.composition.trim()
            ? [{ ticker: null, type: null, description: fciManual.composition.trim(), percentage: null }]
            : (result.fci?.portfolio || []),
        },
      };
      onAdd(merged);
    } else {
      onAdd(result);
    }
    setTicker(''); setResult(null);
    setFciManual({ fundType: '', minInvestment: '', composition: '' });
  };

  const mup = (k, v) => setManualForm(p => ({ ...p, [k]: v }));
  const addManual = () => {
    const t = manualForm.ticker.trim().toUpperCase();
    const lbl = manualForm.type_label.trim();
    if (!t) { alert('Ingresá un ticker o código corto para el activo.'); return; }
    if (!lbl) { alert('Ingresá el tipo de activo (ej: Plazo Fijo, Caución, Fondo Común).'); return; }
    onAdd({
      ticker: t,
      type: 'MANUAL',
      is_manual: true,
      manual_type_label: lbl,
      manual_risk_class: manualForm.risk_class,
      description: manualForm.description.trim() || null,
      currency: manualForm.currency || null,
      settlement: null,
      snapshot_at: new Date().toISOString(),
    });
    setManualForm({ ticker: '', type_label: '', description: '', currency: 'ARS', risk_class: 'fija' });
  };

  const isFci = type === 'FCI';

  return (
    <div style={S.section}>
      <div style={S.secT}>AGREGAR ACTIVO</div>

      {/* Selector de modo: API de PPI vs carga manual */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button type="button" onClick={() => setMode('API')} style={{ ...S.toggleBtn, flex: 0, padding: '6px 14px', ...(mode === 'API' ? S.toggleActive : {}) }}>🔍 BÚSQUEDA PPI</button>
        <button type="button" onClick={() => setMode('MANUAL')} style={{ ...S.toggleBtn, flex: 0, padding: '6px 14px', ...(mode === 'MANUAL' ? S.toggleActive : {}) }}>✎ MANUAL</button>
      </div>

      {mode === 'API' ? (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <F l="Ticker">
              <input
                style={{ ...S.input, textTransform: 'uppercase', minWidth: 160 }}
                value={ticker}
                onChange={e => setTicker(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
                placeholder={isFci ? 'Ej: DELTAREMA' : 'AL30'}
                autoComplete="off"
              />
            </F>
            <F l="Tipo">
              <select style={{ ...S.input, minWidth: 180 }} value={type} onChange={e => { setType(e.target.value); setResult(null); }}>
                {ASSET_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </F>
            <button style={S.toolBtn} onClick={search} disabled={loading || !ticker}>{loading ? '⟳' : '🔍'} BUSCAR</button>
          </div>

          {result && (
            <div style={{ marginTop: 10, padding: 10, borderRadius: 4, background: 'var(--row-alt)', border: `1px solid ${result.found ? GREEN : RED}33` }}>
              {result.found ? (
                result.type === 'FCI' ? (
                  <FciResult result={result} manual={fciManual} setManual={setFciManual} onAdd={confirmAdd} />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <span style={{ color: GREEN, fontSize: 12, fontWeight: 700 }}>✓ Encontrado</span>
                    <span style={{ fontFamily: "'Roboto Mono',monospace", color: 'var(--neon)', fontWeight: 700, fontSize: 13 }}>{result.ticker}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{typeLabel(result.type)}</span>
                    {result.description && <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{result.description}</span>}
                    {result.currency && <span style={{ fontFamily: "'Roboto Mono',monospace", fontSize: 11, color: 'var(--text-dim)' }}>Moneda: <b style={{ color: 'var(--text)' }}>{result.currency}</b></span>}
                    <button style={{ ...S.btnPrimary, marginLeft: 'auto', padding: '6px 14px', fontSize: 10 }} onClick={confirmAdd}>＋ AGREGAR A PROPUESTA</button>
                  </div>
                )
              ) : (
                <span style={{ color: RED, fontSize: 12 }}>✕ {result.error || 'No encontrado'}</span>
              )}
            </div>
          )}
        </>
      ) : (
        <ManualEntryForm form={manualForm} up={mup} onAdd={addManual} />
      )}
    </div>
  );
}

// Formulario de carga manual: para fondos o activos no cubiertos por PPI.
// El usuario declara tipo (libre), nombre y si es renta fija o variable.
function ManualEntryForm({ form, up, onAdd }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace", letterSpacing: 1, marginBottom: 8, lineHeight: 1.5 }}>
        Usá esta opción para activos o fondos fuera de PPI (plazos fijos, cauciones, fondos privados, etc.).
        Vos declarás el tipo, el nombre y si es RF o RV.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <F l="Ticker / Código" req>
          <input
            style={{ ...S.input, textTransform: 'uppercase' }}
            value={form.ticker}
            onChange={e => up('ticker', e.target.value.toUpperCase())}
            placeholder="Ej: PF-90D, CAUCION-1D"
            autoComplete="off"
          />
        </F>
        <F l="Tipo de activo" req>
          <input
            style={S.input}
            value={form.type_label}
            onChange={e => up('type_label', e.target.value)}
            placeholder="Ej: Plazo Fijo, Caución, Fondo privado"
            autoComplete="off"
          />
        </F>
        <F l="Nombre / Descripción">
          <input
            style={S.input}
            value={form.description}
            onChange={e => up('description', e.target.value)}
            placeholder="Ej: PF Banco XYZ 90 días"
            autoComplete="off"
          />
        </F>
        <F l="Moneda">
          <select style={S.input} value={form.currency} onChange={e => up('currency', e.target.value)}>
            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </F>
        <F l="Clase de renta" req>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => up('risk_class', 'fija')} style={{ ...S.toggleBtn, ...(form.risk_class === 'fija' ? S.toggleActive : {}) }}>RENTA FIJA</button>
            <button type="button" onClick={() => up('risk_class', 'variable')} style={{ ...S.toggleBtn, ...(form.risk_class === 'variable' ? S.toggleActive : {}) }}>RENTA VARIABLE</button>
          </div>
        </F>
      </div>
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <button style={{ ...S.btnPrimary, padding: '6px 14px', fontSize: 10 }} onClick={onAdd}>＋ AGREGAR A PROPUESTA</button>
      </div>
    </div>
  );
}

function FciResult({ result, manual, setManual, onAdd }) {
  const f = result.fci || {};
  const up = (k, v) => setManual(p => ({ ...p, [k]: v }));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ color: GREEN, fontSize: 12, fontWeight: 700 }}>✓ FCI encontrado</span>
        <span style={{ fontFamily: "'Roboto Mono',monospace", color: 'var(--neon)', fontWeight: 700, fontSize: 13 }}>{result.ticker}</span>
        <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{f.name}</span>
        <span style={{ fontFamily: "'Roboto Mono',monospace", fontSize: 11, color: 'var(--text-dim)' }}>Moneda: <b style={{ color: 'var(--text)' }}>{result.currency || '—'}</b></span>
        <button style={{ ...S.btnPrimary, marginLeft: 'auto', padding: '6px 14px', fontSize: 10 }} onClick={onAdd}>＋ AGREGAR A PROPUESTA</button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace", letterSpacing: 1, marginBottom: 6 }}>
        DATOS ADICIONALES (opcionales · PPI no los expone vía API, completalos a mano si querés verlos en el flyer):
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
        <F l="Tipo de fondo">
          <input style={S.input} value={manual.fundType} onChange={e => up('fundType', e.target.value)} placeholder="Ej: Renta Fija · T+1" />
        </F>
        <F l={`Mín. suscripción (${result.currency || ''})`}>
          <input type="number" style={S.input} value={manual.minInvestment} onChange={e => up('minInvestment', e.target.value)} placeholder="1000" />
        </F>
        <F l="Composición / activos">
          <input style={S.input} value={manual.composition} onChange={e => up('composition', e.target.value)} placeholder="Ej: LECAPs, plazos fijos, ONs cortas" />
        </F>
      </div>
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div>
      <span style={{ color: 'var(--text-dim)' }}>{k}: </span>
      <b>{v}</b>
    </div>
  );
}

// ══════════════════════════════════════════════
//  AGGREGATES
// ══════════════════════════════════════════════
// Clasificación de riesgo por tipo de activo: CEDEARS = externo, el resto = argentino.
// (Los CEDEARS replican acciones extranjeras; el resto expone al mercado / emisor argentino.)
function riskRegion(type) { return type === 'CEDEARS' ? 'externo' : 'argentino'; }

function computeAggregates(items) {
  if (!items.length) return { pctFija: 0, pctVariable: 0, byType: [], byCurrency: [] };
  let totalPct = 0, fijaPct = 0;
  // typeMap: key es "MANUAL:<label>" para ítems manuales, o el ASSET_TYPE id para ítems PPI.
  const typeMap = new Map(); const currMap = new Map();
  for (const it of items) {
    const w = Number(it.alloc_pct) || 0;
    totalPct += w;
    const typeKey = it.is_manual ? `MANUAL:${it.manual_type_label || 'Otros'}` : it.type;
    typeMap.set(typeKey, (typeMap.get(typeKey) || 0) + w);
    const cur = it.snapshot_currency || 'ARS';
    currMap.set(cur, (currMap.get(cur) || 0) + w);
    // Clasificación RF/RV: manual manda sobre bondLike.
    const isFija = it.is_manual
      ? (it.manual_risk_class === 'fija')
      : !!ASSET_TYPES.find(t => t.id === it.type)?.bondLike;
    if (isFija) fijaPct += w;
  }
  const base = totalPct > 0 ? totalPct : 100;
  const pctFija = (fijaPct / base) * 100;
  const pctVariable = ((base - fijaPct) / base) * 100;
  const byType = [...typeMap.entries()].map(([k, v]) => ({
    label: k.startsWith('MANUAL:') ? k.slice(7) : typeLabel(k),
    pct: v,
  })).sort((a, b) => b.pct - a.pct);
  const byCurrency = [...currMap.entries()].map(([k, v]) => ({ label: k, pct: v })).sort((a, b) => b.pct - a.pct);
  return { pctFija, pctVariable, byType, byCurrency };
}

function AggCard({ l, v }) {
  return (
    <div style={S.aggCard}>
      <div style={S.aggLbl}>{l}</div>
      <div style={S.aggVal}>{v}</div>
    </div>
  );
}

function MixCard({ title, rows }) {
  return (
    <div style={{ background: 'var(--row-alt)', borderRadius: 4, padding: 12 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase' }}>{title}</div>
      {rows.map((r, i) => {
        const w = Math.max(0, Math.min(100, Number(r.pct) || 0));
        return (
          <div key={i} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: "'Roboto Mono',monospace", marginBottom: 2 }}>
              <span>{r.label}</span>
              <span style={{ fontWeight: 700 }}>{fmtN(r.pct)}%</span>
            </div>
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${w}%`, background: 'var(--neon)', boxShadow: '0 0 4px var(--neon)' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function F({ l, req, children, style }) {
  return (
    <div style={{ flex: 1, minWidth: 120, ...(style || {}) }}>
      <label style={S.formLabel}>{l}{req && <span style={{ color: RED }}> *</span>}</label>
      {children}
    </div>
  );
}

// ══════════════════════════════════════════════
//  FLYER MODAL
// ══════════════════════════════════════════════
function FlyerModal({ form, items, agg, onClose }) {
  const flyerRef = useRef(null);
  // Array de refs, una por página A4. Se limpia en cada render y cada A4Page
  // se auto-registra vía callback ref durante el commit.
  const pageRefs = useRef([]);
  pageRefs.current = [];
  const [dl, setDl] = useState(false);
  const [err, setErr] = useState('');
  // Opción: mostrar el monto estimado ($) al lado de cada % de activo. Solo tiene sentido si hay monto total.
  const [showAmounts, setShowAmounts] = useState(false);
  // Opción independiente: mostrar la cantidad de nominales (tipeada a mano en cada ítem).
  // Puede combinarse con MOSTRAR MONTOS — ambos aparecen en la línea de cada activo.
  const [showNominales, setShowNominales] = useState(false);
  // ¿Algún ítem tiene nominales cargados? Si no, el toggle queda deshabilitado.
  const anyNominales = Array.isArray(items) && items.some(it => Number(it?.nominales) > 0);
  // Modo de vista del modal: 'flyer' (PNG institucional) | 'a4' (hoja A4 con tortas, PDF).
  const [viewMode, setViewMode] = useState('flyer');
  // html2canvas no rasteriza confiablemente el SVG con PNG embebido + clipPath + filter CSS.
  // Solución: precargamos el SVG, lo dibujamos a un canvas aplicando el filtro vía ctx.filter,
  // y usamos el data URL PNG resultante como src del <img>. El PNG es trivial para html2canvas.
  const [bgDataUrl, setBgDataUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || 960;
        c.height = img.naturalHeight || 540;
        const ctx = c.getContext('2d');
        // Filtro equivalente al CSS de FS.bgImg, horneado al PNG.
        ctx.filter = 'brightness(1.35) contrast(0.92) saturate(0.95)';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        setBgDataUrl(c.toDataURL('image/png'));
      } catch {
        // Si por CORS no se puede exportar, caemos al src original.
        setBgDataUrl('/logos/fondo%20pluma.svg');
      }
    };
    img.onerror = () => { if (!cancelled) setBgDataUrl('/logos/fondo%20pluma.svg'); };
    img.src = '/logos/fondo%20pluma.svg';
    return () => { cancelled = true; };
  }, []);

  const safeFile = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || '—';
  const baseName = `D&G - Propuesta de Inversión - ${safeFile(form.client_name)} - ${safeFile(form.broker)}`;
  const fileName = `${baseName}.png`;
  const pdfFileName = `${baseName}.pdf`;

  // Carga dinámica de scripts: html2canvas + jsPDF.
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
  const ensureHtml2Canvas = async () => { if (!window.html2canvas) await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'); };
  const ensureJsPdf = async () => { if (!window.jspdf) await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js'); };

  const capture = async (action) => {
    setDl(true); setErr('');
    try {
      await ensureHtml2Canvas();
      // Esperamos a que el PNG base esté listo (evita race en el primer click).
      if (!bgDataUrl) await new Promise(r => setTimeout(r, 300));
      const canvas = await window.html2canvas(flyerRef.current, {
        backgroundColor: DG.bg,
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
      });
      if (action === 'download') {
        const link = document.createElement('a');
        link.download = fileName;
        link.href = canvas.toDataURL('image/png');
        link.click();
      } else {
        canvas.toBlob(b => { if (b) navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); });
      }
    } catch (e) { setErr(e.message || 'Error generando imagen'); }
    finally { setDl(false); }
  };

  // Exporta cada página A4 como una hoja independiente del PDF.
  // Capturamos cada A4Page por separado — así cada hoja del PDF tiene su propio
  // header/footer prolijo en lugar de cortar una imagen gigante en franjas.
  const exportPdf = async () => {
    setDl(true); setErr('');
    try {
      await ensureHtml2Canvas();
      await ensureJsPdf();
      if (!bgDataUrl) await new Promise(r => setTimeout(r, 300));
      const nodes = (pageRefs.current || []).filter(n => n);
      if (!nodes.length) throw new Error('Layout A4 no disponible');
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageWmm = 210, pageHmm = 297;
      for (let i = 0; i < nodes.length; i++) {
        const canvas = await window.html2canvas(nodes[i], {
          backgroundColor: DG.bg,
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          windowWidth: A4_W,
        });
        if (i > 0) pdf.addPage();
        // Cada A4Page ya tiene proporción A4 exacta (794×1123px), así que la imagen
        // ocupa la hoja completa sin tener que escalar por altura.
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pageWmm, pageHmm);
      }
      pdf.save(pdfFileName);
    } catch (e) { setErr(e.message || 'Error generando PDF'); }
    finally { setDl(false); }
  };

  // Dos líneas balanceadas para que nada quede "viudo" cuando hay muchos campos.
  const subtitleLine1 = [
    form.client_name && `Cliente: ${form.client_name}`,
    form.client_account && `Cuenta: ${form.client_account}`,
  ].filter(Boolean).join('  ·  ');
  const subtitleLine2 = [
    form.broker && `Broker: ${form.broker}`,
    form.plazo && `Plazo: ${form.plazo}`,
    form.perfil && `Perfil: ${form.perfil}`,
  ].filter(Boolean).join('  ·  ');

  const totalAmount = Number(form.amount_total) || 0;

  return (
    <div style={FS.overlay} onClick={onClose}>
      <div style={FS.modalWrap} onClick={e => e.stopPropagation()}>
        <div style={FS.toolbar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={FS.toolbarTitle}>VISTA PREVIA</div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button style={{ ...FS.tbTab, ...(viewMode === 'flyer' ? FS.tbTabActive : {}) }} onClick={() => setViewMode('flyer')}>FLYER</button>
              <button style={{ ...FS.tbTab, ...(viewMode === 'a4' ? FS.tbTabActive : {}) }} onClick={() => setViewMode('a4')}>A4 / PDF</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label
              style={{ ...FS.tbBtn, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: totalAmount > 0 ? 'pointer' : 'not-allowed', opacity: totalAmount > 0 ? 1 : 0.5 }}
              title={totalAmount > 0 ? 'Muestra el monto estimado ($) al lado del % de cada activo' : 'Cargá un monto total en la propuesta para habilitar esta opción'}
            >
              <input
                type="checkbox"
                checked={showAmounts && totalAmount > 0}
                onChange={e => setShowAmounts(e.target.checked)}
                disabled={totalAmount <= 0}
                style={{ margin: 0 }}
              />
              MOSTRAR MONTOS
            </label>
            <label
              style={{ ...FS.tbBtn, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: anyNominales ? 'pointer' : 'not-allowed', opacity: anyNominales ? 1 : 0.5 }}
              title={anyNominales ? 'Muestra la cantidad de nominales (cargada en la tabla de activos) al lado del % de cada activo' : 'Cargá nominales en al menos un ítem de la propuesta para habilitar esta opción'}
            >
              <input
                type="checkbox"
                checked={showNominales && anyNominales}
                onChange={e => setShowNominales(e.target.checked)}
                disabled={!anyNominales}
                style={{ margin: 0 }}
              />
              MOSTRAR NOMINALES
            </label>
            {viewMode === 'flyer' ? (
              <>
                <button style={FS.tbBtn} onClick={() => capture('copy')} disabled={dl} title="Copiar imagen al portapapeles">📋 COPIAR</button>
                <button style={FS.tbPrimary} onClick={() => capture('download')} disabled={dl}>{dl ? '⟳ GENERANDO...' : '⬇ DESCARGAR PNG'}</button>
              </>
            ) : (
              <button style={FS.tbPrimary} onClick={exportPdf} disabled={dl} title="Descargar como PDF tamaño A4">{dl ? '⟳ GENERANDO...' : '⬇ DESCARGAR PDF A4'}</button>
            )}
            <button style={FS.tbClose} onClick={onClose}>✕</button>
          </div>
        </div>
        {err && <div style={FS.err}>{err}</div>}

        <div style={FS.scroll}>
          {/* A4 preview: visible cuando viewMode='a4'; siempre montado en DOM para que la captura sea inmediata.
              Cada A4Page registra su nodo en pageRefs.current durante el commit. */}
          <div style={{ display: viewMode === 'a4' ? 'flex' : 'none', justifyContent: 'center' }}>
            <FlyerA4
              pageRefs={pageRefs}
              form={form}
              items={items}
              agg={agg}
              bgDataUrl={bgDataUrl}
              totalAmount={totalAmount}
              showAmounts={showAmounts && totalAmount > 0}
              showNominales={showNominales && anyNominales}
              subtitleLine1={subtitleLine1}
              subtitleLine2={subtitleLine2}
            />
          </div>

          {/* ═══════════ FLYER (PNG) ═══════════ */}
          <div style={{ display: viewMode === 'flyer' ? 'block' : 'none' }}>
          <div ref={flyerRef} style={FS.flyer}>
            {/* Fondo pluma — precargado a PNG con el filtro horneado (html2canvas-safe). */}
            <img src={bgDataUrl || '/logos/fondo%20pluma.svg'} alt="" style={FS.bgImg} crossOrigin="anonymous" aria-hidden="true" />
            <div style={FS.bgTint} />

            {/* Contenido */}
            <div style={FS.content}>
              {/* Header */}
              <div style={FS.header}>
                <img src="/logos/DG%20tema%20oscuro.png" alt="Delfino Gaviña" style={FS.logo} crossOrigin="anonymous" />
                <div style={FS.headerRight}>
                  <div style={FS.date}>{new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase()}</div>
                </div>
              </div>

              {/* Título */}
              <div style={FS.titleBlock}>
                <div style={FS.hairline} />
                <h1 style={FS.title}>PROPUESTA DE INVERSIÓN</h1>
                <div style={FS.hairline} />
              </div>

              {/* Subtítulo — dos líneas balanceadas: identificación y contexto */}
              <div style={FS.subtitleBlock}>
                {subtitleLine1 && <div style={FS.subtitle}>{subtitleLine1}</div>}
                {subtitleLine2 && <div style={{ ...FS.subtitle, marginTop: 2 }}>{subtitleLine2}</div>}
                {form.asesor && <div style={FS.asesor}>Asesor: <b>{form.asesor}</b></div>}
              </div>

              {/* Resumen en tres tarjetas alineadas: Monto · Activos (o dato manual) · Tipo de renta */}
              <div style={FS.summaryRow}>
                <FMet l="MONTO ESTIMADO" v={totalAmount > 0 ? `${form.currency} ${fmtN(totalAmount, 0)}` : '—'} />
                <FMet
                  l={form.override_count_enabled && form.override_count_label ? form.override_count_label.toUpperCase() : 'ACTIVOS'}
                  v={form.override_count_enabled ? (form.override_count_value || '—') : items.length}
                />
                <FRFRVSplit pctFija={agg.pctFija} pctVariable={agg.pctVariable} />
              </div>

              {/* Distribución por tipo de activo (agrupada con listado) */}
              <FTypeDistribution
                items={items}
                totalAmount={totalAmount}
                currency={form.currency}
                showAmounts={showAmounts && totalAmount > 0}
                showNominales={showNominales && anyNominales}
              />

              {/* Notas (si hay) */}
              {form.notes && form.notes.trim() && (
                <div style={FS.notesBlock}>
                  <div style={FS.sectionLabel}>COMENTARIOS</div>
                  <div style={FS.notesText}>{form.notes}</div>
                </div>
              )}

              {/* Disclaimer */}
              <div style={FS.disclaimer}>
                Los porcentajes indicados son estimativos y no exactos.
              </div>

              {/* Footer */}
              <div style={FS.footer}>
                <span>DELFINO GAVIÑA · INVERSIONES</span>
                <span>{new Date().toLocaleDateString('es-AR')}</span>
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
//  FLYER A4 — multi-página. Cada página es 794×1123px (A4 @ 96dpi) con
//  el mismo header/footer. exportPdf captura cada A4Page por separado, por
//  eso no hay cortes feos: un A4Page ⇒ una hoja del PDF.
// ══════════════════════════════════════════════

// Presupuestos de altura (en px @ 96dpi) para paginar sin tener que medir el DOM.
// Son estimaciones intencionalmente conservadoras; si un bloque no entra, va a la
// página siguiente. Cualquier desborde residual queda oculto por `overflow: hidden`
// del shell de página.
const A4_H = 1123;
const A4_PAGE_VPAD = 36 + 28;        // padding vertical del content
const A4_FOOTER_BLOCK = 44;          // footer + borde + gap
const A4_FIRST_HEADER_H = 300;       // header + título + subtítulos + summary + margen
const A4_CONT_HEADER_H = 70;         // header compacto en páginas 2+
const A4_SECTION_LABEL_H = 26;
const A4_GROUP_HEAD_H = 46;          // encabezado de grupo + márgenes
const A4_GROUP_ITEM_H = 26;          // cada activo dentro de un grupo
const A4_PIES_H = 470;               // sección completa de tortas (2 filas)
const A4_DISCLAIMER_H = 60;
const A4_ITEMS_PER_GROUP_SLICE = 18; // si un grupo tiene más, se parte en rebanadas

function estimateNotesHeight(notes) {
  if (!notes || !notes.trim()) return 0;
  // Aproximación: ~80 caracteres por línea, 18px por línea + 46px de marco/label.
  const lines = Math.max(1, Math.ceil(notes.length / 80) + notes.split('\n').length - 1);
  return Math.min(280, 46 + lines * 18);
}

function buildGroupsForA4(items) {
  const groups = new Map();
  for (const it of items) {
    const cat = flyerCategoryOf(it);
    if (!groups.has(cat)) groups.set(cat, { cat, catLabel: flyerCategoryLabel(cat), totalPct: 0, items: [] });
    const g = groups.get(cat);
    g.totalPct += Number(it.alloc_pct) || 0;
    g.items.push(it);
  }
  for (const g of groups.values()) g.items.sort((a, b) => (Number(b.alloc_pct) || 0) - (Number(a.alloc_pct) || 0));
  const ordered = [];
  for (const cat of FLYER_CATEGORY_ORDER) if (groups.has(cat)) ordered.push(groups.get(cat));
  for (const g of groups.values()) if (!FLYER_CATEGORY_ORDER.includes(g.cat)) ordered.push(g);
  return ordered;
}

// Parte cada grupo en rebanadas para que ningún bloque sea más grande que una página.
function buildTypeDistBlocks(items) {
  const groups = buildGroupsForA4(items);
  const blocks = [];
  for (const g of groups) {
    if (g.items.length === 0) continue;
    if (g.items.length <= A4_ITEMS_PER_GROUP_SLICE) {
      blocks.push({ type: 'typeGroup', group: g, items: g.items, isContinuation: false });
    } else {
      for (let i = 0; i < g.items.length; i += A4_ITEMS_PER_GROUP_SLICE) {
        blocks.push({
          type: 'typeGroup',
          group: g,
          items: g.items.slice(i, i + A4_ITEMS_PER_GROUP_SLICE),
          isContinuation: i > 0,
        });
      }
    }
  }
  return blocks;
}

// Distribuye los bloques a lo largo de páginas A4 respetando presupuestos de altura.
// Orden de contenido: distribución por tipo → tortas → notas → disclaimer.
function planA4Pages({ items, form }) {
  const typeBlocks = buildTypeDistBlocks(items);
  const hasNotes = !!(form.notes && form.notes.trim());
  const notesH = estimateNotesHeight(form.notes);
  const pageBodyMax = A4_H - A4_PAGE_VPAD - A4_FOOTER_BLOCK;

  const pages = [];
  let current = {
    isFirst: true,
    blocks: [],
    hasTypeDistLabel: false,
    used: A4_FIRST_HEADER_H,
  };
  const pushPage = () => {
    pages.push(current);
    current = { isFirst: false, blocks: [], hasTypeDistLabel: false, used: A4_CONT_HEADER_H };
  };
  const ensureSpace = (needed) => {
    if (current.used + needed > pageBodyMax && current.blocks.length > 0) pushPage();
  };

  // 1) Bloques de distribución por tipo de activo
  for (const b of typeBlocks) {
    const blockH = A4_GROUP_HEAD_H + b.items.length * A4_GROUP_ITEM_H;
    // Si esta página no tenía sección de tipo aún, añadimos también el label.
    const extraLabel = current.hasTypeDistLabel ? 0 : A4_SECTION_LABEL_H;
    if (current.used + blockH + extraLabel > pageBodyMax && current.blocks.length > 0) {
      pushPage();
    }
    if (!current.hasTypeDistLabel) {
      current.used += A4_SECTION_LABEL_H;
      current.hasTypeDistLabel = true;
      current.blocks.push({ type: 'typeDistLabel', isContinuation: !current.isFirst });
    }
    current.blocks.push(b);
    current.used += blockH;
  }

  // 2) Tortas (DISTRIBUCIÓN GRÁFICA) — debajo de la distribución por activo
  ensureSpace(A4_PIES_H);
  current.blocks.push({ type: 'pies' });
  current.used += A4_PIES_H;

  // 3) Notas
  if (hasNotes) {
    ensureSpace(notesH);
    current.blocks.push({ type: 'notes' });
    current.used += notesH;
  }

  // 4) Disclaimer
  ensureSpace(A4_DISCLAIMER_H);
  current.blocks.push({ type: 'disclaimer' });
  current.used += A4_DISCLAIMER_H;

  pushPage();
  // El último pushPage dejó un "current" vacío que no nos sirve.
  return pages;
}

function FlyerA4({ form, items, agg, bgDataUrl, totalAmount, showAmounts, showNominales, subtitleLine1, subtitleLine2, pageRefs }) {
  const pages = useMemo(() => planA4Pages({ items, form }), [items, form]);
  const totalPages = pages.length;

  // Datos para las tres tortas (se computan una vez y se pasan a la página que las contiene).
  const rfrvData = useMemo(() => [
    { label: 'Renta Fija', value: agg.pctFija, color: DG_PIE_RF },
    { label: 'Renta Variable', value: agg.pctVariable, color: DG_PIE_RV },
  ].filter(d => d.value > 0), [agg.pctFija, agg.pctVariable]);
  const typeData = useMemo(() =>
    (agg.byType || []).filter(t => (Number(t.pct) || 0) > 0).map(t => ({ label: t.label, value: t.pct })),
    [agg.byType]
  );
  const assetData = useMemo(() =>
    (items || [])
      .map(it => ({ label: it.ticker, value: Number(it.alloc_pct) || 0 }))
      .filter(a => a.value > 0)
      .sort((a, b) => b.value - a.value),
    [items]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {pages.map((pg, i) => (
        <A4Page
          key={i}
          pageRef={(el) => {
            if (el) pageRefs.current[i] = el;
          }}
          pageIdx={i}
          totalPages={totalPages}
          page={pg}
          form={form}
          items={items}
          agg={agg}
          bgDataUrl={bgDataUrl}
          totalAmount={totalAmount}
          showAmounts={showAmounts}
          showNominales={showNominales}
          subtitleLine1={subtitleLine1}
          subtitleLine2={subtitleLine2}
          rfrvData={rfrvData}
          typeData={typeData}
          assetData={assetData}
        />
      ))}
    </div>
  );
}

function A4Page({
  pageRef, pageIdx, totalPages, page,
  form, items, agg, bgDataUrl, totalAmount, showAmounts, showNominales,
  subtitleLine1, subtitleLine2, rfrvData, typeData, assetData,
}) {
  const amountCurrency = (form.currency === 'USD-MEP' || form.currency === 'USD-CCL') ? 'USD' : form.currency;
  const amountFor = (pct) => (Number(pct) || 0) * totalAmount / 100;

  // Header compacto (páginas 2+): cliente + broker en una sola línea, logo chico.
  const compactSub = [
    form.client_name && `Cliente: ${form.client_name}`,
    form.broker && `Broker: ${form.broker}`,
    form.perfil && `Perfil: ${form.perfil}`,
  ].filter(Boolean).join('  ·  ');

  return (
    <div ref={pageRef} style={FSA4.page}>
      <img src={bgDataUrl || '/logos/fondo%20pluma.svg'} alt="" style={FSA4.bgImg} crossOrigin="anonymous" aria-hidden="true" />
      <div style={FSA4.bgTint} />
      <div style={FSA4.content}>
        <div style={FSA4.body}>
          {page.isFirst ? (
            <>
              <div style={FSA4.header}>
                <img src="/logos/DG%20tema%20oscuro.png" alt="Delfino Gaviña" style={FSA4.logo} crossOrigin="anonymous" />
                <div style={FSA4.date}>{new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase()}</div>
              </div>
              <div style={FSA4.titleBlock}>
                <div style={FSA4.hairline} />
                <h1 style={FSA4.title}>PROPUESTA DE INVERSIÓN</h1>
                <div style={FSA4.hairline} />
              </div>
              <div style={FSA4.subtitleBlock}>
                {subtitleLine1 && <div style={FSA4.subtitle}>{subtitleLine1}</div>}
                {subtitleLine2 && <div style={{ ...FSA4.subtitle, marginTop: 2 }}>{subtitleLine2}</div>}
                {form.asesor && <div style={FSA4.asesor}>Asesor: <b>{form.asesor}</b></div>}
              </div>
              <div style={FSA4.summaryRow}>
                <FMet l="MONTO ESTIMADO" v={totalAmount > 0 ? `${form.currency} ${fmtN(totalAmount, 0)}` : '—'} />
                <FMet
                  l={form.override_count_enabled && form.override_count_label ? form.override_count_label.toUpperCase() : 'ACTIVOS'}
                  v={form.override_count_enabled ? (form.override_count_value || '—') : items.length}
                />
                <FRFRVSplit pctFija={agg.pctFija} pctVariable={agg.pctVariable} />
              </div>
            </>
          ) : (
            <div style={FSA4.contHeader}>
              <img src="/logos/DG%20tema%20oscuro.png" alt="Delfino Gaviña" style={FSA4.contLogo} crossOrigin="anonymous" />
              <div style={FSA4.contHeaderMid}>
                <div style={FSA4.contHeaderTitle}>PROPUESTA DE INVERSIÓN</div>
                {compactSub && <div style={FSA4.contHeaderSub}>{compactSub}</div>}
              </div>
              <div style={FSA4.contHeaderDate}>
                {new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase()}
              </div>
            </div>
          )}

          {page.blocks.map((b, i) => {
            if (b.type === 'typeDistLabel') {
              return (
                <div key={i} style={FSA4.sectionLabel}>
                  DISTRIBUCIÓN POR TIPO DE ACTIVO{b.isContinuation ? ' (cont.)' : ''}
                </div>
              );
            }
            if (b.type === 'typeGroup') {
              const g = b.group;
              return (
                <div key={i} style={FS.typeGroup}>
                  <div style={FS.typeGroupHead}>
                    <span style={FS.typeGroupName}>
                      {g.catLabel}{b.isContinuation ? ' (cont.)' : ''}
                      <span style={FS.typeGroupPct}>
                        {' '}({fmtN(g.totalPct)}%{showAmounts ? ` · ${amountCurrency} ${fmtN(amountFor(g.totalPct), 0)}` : ''})
                      </span>
                    </span>
                  </div>
                  <div style={FS.typeGroupList}>
                    {b.items.map((it, j) => (
                      <div key={j} style={FS.typeGroupItem}>
                        <span style={FS.typeGroupTicker}>
                          <b style={{ color: DG.blue }}>{it.ticker}</b>
                          {it.snapshot_description ? <span style={{ color: DG.creamDim }}> · {it.snapshot_description}</span> : null}
                        </span>
                        <span style={FS.typeGroupItemPct}>
                          {fmtN(it.alloc_pct)}%
                          {showAmounts && (
                            <span style={FS.typeGroupItemAmount}> · {amountCurrency} {fmtN(amountFor(it.alloc_pct), 0)}</span>
                          )}
                          {showNominales && Number(it.nominales) > 0 && (
                            <span style={FS.typeGroupItemAmount}> · {fmtN(Number(it.nominales), 0)} nom.</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
            if (b.type === 'pies') {
              return (
                <div key={i} style={FSA4.piesSection}>
                  <div style={FSA4.sectionLabel}>DISTRIBUCIÓN GRÁFICA</div>
                  <div style={FSA4.pieRow}>
                    <PieBlock title="Renta Fija / Renta Variable" data={rfrvData} size={140} />
                    <PieBlock title="Por tipo de activo" data={typeData} size={140} />
                  </div>
                  <div style={FSA4.pieRowFull}>
                    <PieBlock
                      title="Por activo"
                      data={assetData}
                      size={170}
                      legendColumns={assetData.length > 6 ? 2 : 1}
                      legendMaxRows={assetData.length > 18 ? 16 : null}
                    />
                  </div>
                </div>
              );
            }
            if (b.type === 'notes') {
              return (
                <div key={i} style={FSA4.notesBlock}>
                  <div style={FSA4.sectionLabel}>COMENTARIOS</div>
                  <div style={FSA4.notesText}>{form.notes}</div>
                </div>
              );
            }
            if (b.type === 'disclaimer') {
              return (
                <div key={i} style={FSA4.disclaimer}>
                  Los porcentajes indicados son estimativos y no exactos.
                </div>
              );
            }
            return null;
          })}
        </div>

        {/* Footer — siempre pegado al fondo de la hoja */}
        <div style={FSA4.footer}>
          <span>DELFINO GAVIÑA · INVERSIONES</span>
          <span style={FSA4.footerMid}>{new Date().toLocaleDateString('es-AR')}</span>
          <span>{pageIdx + 1} / {totalPages}</span>
        </div>
      </div>
    </div>
  );
}

function FMet({ l, v }) {
  return (
    <div style={FS.metCard}>
      <div style={FS.metL}>{l}</div>
      <div style={FS.metV}>{v}</div>
    </div>
  );
}

// Distribución Renta Fija / Renta Variable — tarjeta compacta alineada con MONTO/ACTIVOS
function FRFRVSplit({ pctFija, pctVariable }) {
  const f = Math.max(0, Math.min(100, Number(pctFija) || 0));
  const v = Math.max(0, Math.min(100, Number(pctVariable) || 0));
  return (
    <div style={FS.metCard}>
      <div style={FS.metL}>TIPO DE RENTA</div>
      <div style={FS.rfrvInlineRow}>
        <span style={FS.rfrvInlineLabel}>RF</span>
        <span style={FS.rfrvInlineVal}>{fmtN(f)}%</span>
        <span style={FS.rfrvInlineSep}>·</span>
        <span style={FS.rfrvInlineLabel}>RV</span>
        <span style={FS.rfrvInlineVal}>{fmtN(v)}%</span>
      </div>
      <div style={FS.rfrvBarTrack}>
        <div style={{ ...FS.rfrvBarFija, width: `${f}%` }} />
        <div style={{ ...FS.rfrvBarVar, width: `${v}%` }} />
      </div>
    </div>
  );
}

// Categorización para el flyer: bonos soberanos + subsoberanos se muestran bajo "Bonos"
const FLYER_CATEGORY_OF = { BONOS_PUBLICOS: 'BONOS', BONOS_CORP: 'BONOS' };
// Ítems manuales arman su propia categoría usando el label tipeado por el usuario (prefijo MANUAL:).
function flyerCategoryOf(it) {
  if (it && it.is_manual) return `MANUAL:${(it.manual_type_label || 'Otros').trim() || 'Otros'}`;
  const t = typeof it === 'string' ? it : it?.type;
  return FLYER_CATEGORY_OF[t] || t;
}
const FLYER_CATEGORY_LABEL = {
  ACCIONES: 'Acciones',
  BONOS: 'Bonos',
  ON: 'Obligaciones Negociables',
  CEDEARS: 'CEDEARs',
  FCI: 'FCI',
  LETRAS: 'Letras',
};
function flyerCategoryLabel(cat) {
  if (typeof cat === 'string' && cat.startsWith('MANUAL:')) return cat.slice(7);
  return FLYER_CATEGORY_LABEL[cat] || cat;
}
// Orden fijo de categorías pedido por el usuario
const FLYER_CATEGORY_ORDER = ['ACCIONES', 'BONOS', 'ON', 'CEDEARS', 'FCI', 'LETRAS'];

function FTypeDistribution({ items, totalAmount = 0, currency = 'ARS', showAmounts = false, showNominales = false }) {
  if (!items.length) return null;
  const groups = new Map();
  for (const it of items) {
    const cat = flyerCategoryOf(it);
    if (!groups.has(cat)) groups.set(cat, { total: 0, items: [] });
    const g = groups.get(cat);
    g.total += Number(it.alloc_pct) || 0;
    g.items.push(it);
  }
  // Ordenar según FLYER_CATEGORY_ORDER; categorías desconocidas (incluye manuales) al final
  const ordered = [];
  for (const cat of FLYER_CATEGORY_ORDER) if (groups.has(cat)) ordered.push([cat, groups.get(cat)]);
  for (const [cat, g] of groups.entries()) if (!FLYER_CATEGORY_ORDER.includes(cat)) ordered.push([cat, g]);

  // Monto estimado = porcentaje × monto total.
  const amountFor = (pct) => (Number(pct) || 0) * totalAmount / 100;
  // En montos por activo y por tipo se muestra "USD" en lugar de "USD-MEP" / "USD-CCL".
  // La tarjeta "MONTO ESTIMADO" del flyer conserva la etiqueta original (viene del form.currency).
  const amountCurrency = (currency === 'USD-MEP' || currency === 'USD-CCL') ? 'USD' : currency;

  return (
    <div style={FS.typeDistBlock}>
      <div style={FS.sectionLabel}>DISTRIBUCIÓN POR TIPO DE ACTIVO</div>
      {ordered.map(([cat, g]) => (
        <div key={cat} style={FS.typeGroup}>
          <div style={FS.typeGroupHead}>
            <span style={FS.typeGroupName}>
              {flyerCategoryLabel(cat)}
              <span style={FS.typeGroupPct}>
                {' '}({fmtN(g.total)}%{showAmounts ? ` · ${amountCurrency} ${fmtN(amountFor(g.total), 0)}` : ''})
              </span>
            </span>
          </div>
          <div style={FS.typeGroupList}>
            {g.items
              .sort((a, b) => (Number(b.alloc_pct) || 0) - (Number(a.alloc_pct) || 0))
              .map((it, i) => (
                <div key={i} style={FS.typeGroupItem}>
                  <span style={FS.typeGroupTicker}>
                    <b style={{ color: DG.blue }}>{it.ticker}</b>
                    {it.snapshot_description ? <span style={{ color: DG.creamDim }}> · {it.snapshot_description}</span> : null}
                  </span>
                  <span style={FS.typeGroupItemPct}>
                    {fmtN(it.alloc_pct)}%
                    {showAmounts && (
                      <span style={FS.typeGroupItemAmount}> · {amountCurrency} {fmtN(amountFor(it.alloc_pct), 0)}</span>
                    )}
                    {showNominales && Number(it.nominales) > 0 && (
                      <span style={FS.typeGroupItemAmount}> · {fmtN(Number(it.nominales), 0)} nom.</span>
                    )}
                  </span>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Paleta institucional Delfino Gaviña (azules + crema) ──
// #0A0F1C · #1A2236 · #364776 · #6386AC · #FEF8E6
const DG = {
  bg: '#0A0F1C',           // navy profundo (base flyer)
  bgMid: '#1A2236',        // navy medio (paneles)
  blueDeep: '#102f4a',     // navy del SVG de fondo
  blueMid: '#364776',      // azul medio
  blue: '#6386AC',         // azul claro institucional (acento)
  cream: '#FEF8E6',        // crema (texto principal)
  creamDim: 'rgba(254,248,230,0.72)',
  creamMute: 'rgba(254,248,230,0.48)',
  creamSoft: 'rgba(254,248,230,0.85)',
  disc: 'rgba(254,248,230,0.55)',
  muted: 'rgba(254,248,230,0.38)',
  line10: 'rgba(99,134,172,0.10)',
  line18: 'rgba(99,134,172,0.20)',
  line25: 'rgba(99,134,172,0.28)',
  line35: 'rgba(99,134,172,0.40)',
  line50: 'rgba(99,134,172,0.55)',
  panel: 'rgba(254,248,230,0.04)',
  panelHi: 'rgba(99,134,172,0.08)',
};

// Paleta para gráficos de torta — tintes + sombras dentro de la identidad D&G.
// Orden pensado para maximizar contraste entre rebanadas vecinas.
const DG_PIE_COLORS = [
  '#6386AC', // azul institucional
  '#FEF8E6', // crema
  '#2D5B89', // azul oscuro
  '#C9D6E8', // azul pálido
  '#364776', // azul medio
  '#E8DCB5', // crema oscuro
  '#88A3C2', // azul cielo
  '#4A6A90', // azul pizarra
  '#A8B5D1', // lavanda tenue
  '#F5ECC7', // crema claro
  '#1E3F5E', // azul profundo
  '#B8C8DE', // azul polvo
];
const DG_PIE_RF = '#6386AC';  // Renta Fija
const DG_PIE_RV = '#FEF8E6';  // Renta Variable

// Gráfico de torta SVG hand-rolled (más predecible con html2canvas que Recharts).
function Pie({ data, size = 150, stroke = DG.bg, colors = DG_PIE_COLORS }) {
  const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0);
  if (total <= 0) return null;
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  let cumA = -Math.PI / 2; // empieza arriba
  const slices = [];
  data.forEach((d, i) => {
    const v = Number(d.value) || 0;
    if (v <= 0) return;
    const frac = v / total;
    const color = d.color || colors[i % colors.length];
    if (frac >= 0.9999) {
      slices.push(<circle key={i} cx={cx} cy={cy} r={r} fill={color} stroke={stroke} strokeWidth={1} />);
      return;
    }
    const startA = cumA;
    const endA = cumA + frac * 2 * Math.PI;
    cumA = endA;
    const x1 = cx + r * Math.cos(startA);
    const y1 = cy + r * Math.sin(startA);
    const x2 = cx + r * Math.cos(endA);
    const y2 = cy + r * Math.sin(endA);
    const large = frac > 0.5 ? 1 : 0;
    const path = `M ${cx} ${cy} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`;
    slices.push(<path key={i} d={path} fill={color} stroke={stroke} strokeWidth={0.8} />);
  });
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>{slices}</svg>;
}

function PieLegend({ data, colors = DG_PIE_COLORS, columns = 1, maxRows = null }) {
  const rows = maxRows ? data.slice(0, maxRows) : data;
  const hidden = maxRows && data.length > maxRows ? data.length - maxRows : 0;
  const hiddenPct = hidden > 0 ? data.slice(maxRows).reduce((s, d) => s + (Number(d.value) || 0), 0) : 0;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 14px', fontFamily: "'Roboto Mono',monospace", fontSize: 9.5, color: DG.cream, flex: 1, minWidth: 0 }}>
      {rows.map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: columns === 1 ? '1 1 100%' : `1 1 calc(${100 / columns}% - 14px)`, minWidth: 110 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: d.color || colors[i % colors.length], flexShrink: 0, border: `1px solid ${DG.line25}` }} />
          <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</span>
          <span style={{ color: DG.creamDim, fontWeight: 700 }}>{fmtN(d.value)}%</span>
        </div>
      ))}
      {hidden > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 100%', color: DG.creamMute, fontStyle: 'italic' }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: DG.creamMute, flexShrink: 0 }} />
          <span>+ {hidden} más</span>
          <span style={{ color: DG.creamMute, fontWeight: 700 }}>{fmtN(hiddenPct)}%</span>
        </div>
      )}
    </div>
  );
}

function PieBlock({ title, data, size = 150, colors = DG_PIE_COLORS, legendColumns = 1, legendMaxRows = null }) {
  if (!data.length) {
    return (
      <div style={FSA4.pieBlock}>
        <div style={FSA4.pieTitle}>{title}</div>
        <div style={{ color: DG.creamMute, fontSize: 10, padding: '12px 8px' }}>Sin datos</div>
      </div>
    );
  }
  return (
    <div style={FSA4.pieBlock}>
      <div style={FSA4.pieTitle}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Pie data={data} size={size} colors={colors} />
        <PieLegend data={data} colors={colors} columns={legendColumns} maxRows={legendMaxRows} />
      </div>
    </div>
  );
}

const FS = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflow: 'auto' },
  modalWrap: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, maxWidth: 980, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' },
  toolbarTitle: { fontSize: 11, fontWeight: 700, letterSpacing: 3, color: 'var(--neon)' },
  tbBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace", fontSize: 10, fontWeight: 500, letterSpacing: 1, padding: '6px 12px', cursor: 'pointer' },
  tbPrimary: { background: 'transparent', color: 'var(--neon)', border: '1px solid var(--neon)', borderRadius: 3, fontFamily: "'Roboto',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: 2, padding: '6px 14px', cursor: 'pointer' },
  tbClose: { background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', fontSize: 13, width: 32, height: 30, cursor: 'pointer', lineHeight: 1 },
  err: { padding: '8px 16px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: 11, borderBottom: '1px solid rgba(239,68,68,0.3)' },
  scroll: { padding: 20, overflow: 'auto', maxHeight: 'calc(100vh - 160px)' },

  // ── Flyer: branding D&G (azules + crema) ──
  // El SVG "fondo pluma" ya trae el navy institucional + pluma; lo usamos como fondo
  // y brillamos el conjunto para que la pluma se lea más clara.
  flyer: { position: 'relative', width: 900, margin: '0 auto', background: DG.bg, color: DG.cream, fontFamily: "'Roboto', sans-serif", overflow: 'hidden', borderRadius: 4, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' },
  bgImg: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', opacity: 1, zIndex: 0, pointerEvents: 'none' },
  bgTint: { position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(10,15,28,0.10) 0%, rgba(10,15,28,0.38) 55%, rgba(10,15,28,0.62) 100%)', zIndex: 1, pointerEvents: 'none' },
  content: { position: 'relative', zIndex: 2, padding: '42px 48px 32px' },

  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 },
  logo: { height: 66, width: 'auto', display: 'block' },
  headerRight: { textAlign: 'right' },
  date: { fontFamily: "'Roboto Mono',monospace", fontSize: 10, letterSpacing: 3, color: DG.blue, opacity: 0.95 },

  titleBlock: { display: 'flex', alignItems: 'center', gap: 18, marginBottom: 12 },
  hairline: { flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${DG.line50}, transparent)` },
  title: { fontFamily: "'Cormorant Garamond', Georgia, serif", fontWeight: 500, fontStyle: 'italic', fontSize: 30, letterSpacing: 7, color: DG.cream, margin: 0, textAlign: 'center' },

  subtitleBlock: { textAlign: 'center', marginBottom: 24 },
  subtitle: { fontFamily: "'Roboto Mono', monospace", fontSize: 12, letterSpacing: 1.5, color: DG.cream, marginBottom: 6 },
  asesor: { fontFamily: "'Roboto', sans-serif", fontSize: 11, letterSpacing: 1.2, color: DG.creamDim },

  // Tres tarjetas alineadas en una sola fila: Monto · Activos · Tipo de renta
  summaryRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 22 },
  metCard: { background: DG.panelHi, border: `1px solid ${DG.line25}`, borderRadius: 3, padding: '12px 12px', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 78 },
  metL: { fontFamily: "'Roboto', sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: 2, color: DG.blue, marginBottom: 6, textTransform: 'uppercase' },
  metV: { fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 20, fontWeight: 600, color: DG.cream, letterSpacing: 1 },

  // Tarjeta compacta RF/RV (misma métrica/altura que MONTO y ACTIVOS)
  rfrvInlineRow: { display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: 8, fontFamily: "'Roboto Mono', monospace", fontSize: 12, color: DG.cream, marginBottom: 6 },
  rfrvInlineLabel: { color: DG.creamDim, fontSize: 10, letterSpacing: 1 },
  rfrvInlineVal: { fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 16, fontWeight: 600, color: DG.cream },
  rfrvInlineSep: { color: DG.blue, opacity: 0.7 },
  rfrvBarTrack: { display: 'flex', height: 6, borderRadius: 2, overflow: 'hidden', background: 'rgba(254,248,230,0.08)', border: `1px solid ${DG.line18}` },
  rfrvBarFija: { height: '100%', background: DG.blue },
  rfrvBarVar: { height: '100%', background: DG.creamMute },

  // Distribución por tipo de activo (agrupada)
  typeDistBlock: { marginBottom: 22 },
  typeGroup: { marginBottom: 10, padding: '10px 14px', background: DG.panel, border: `1px solid ${DG.line18}`, borderRadius: 3 },
  typeGroupHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  typeGroupName: { fontFamily: "'Roboto', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 2, color: DG.cream, textTransform: 'uppercase' },
  typeGroupPct: { fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 15, fontWeight: 600, color: DG.blue, letterSpacing: 0.5 },
  typeGroupList: { paddingLeft: 6 },
  typeGroupItem: { display: 'flex', justifyContent: 'space-between', padding: '3px 4px', fontFamily: "'Roboto Mono',monospace", fontSize: 11.5, lineHeight: 1.45 },
  typeGroupTicker: { overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', marginRight: 10 },
  typeGroupItemPct: { color: DG.creamSoft, fontWeight: 700, flex: '0 0 auto' },
  typeGroupItemAmount: { color: DG.creamDim, fontWeight: 400, fontSize: 10.5, letterSpacing: 0.5 },

  sectionLabel: { fontFamily: "'Roboto', sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: 3, color: DG.blue, marginBottom: 8, textTransform: 'uppercase' },

  notesBlock: { marginBottom: 18 },
  notesText: { fontFamily: "'Roboto', sans-serif", fontSize: 11, lineHeight: 1.55, color: DG.cream, background: DG.panel, border: `1px solid ${DG.line18}`, borderRadius: 3, padding: '10px 14px', whiteSpace: 'pre-wrap' },

  disclaimer: { fontFamily: "'Roboto', sans-serif", fontSize: 9, lineHeight: 1.5, color: DG.disc, textAlign: 'center', padding: '10px 14px', background: 'rgba(10,15,28,0.35)', borderTop: `1px solid ${DG.line25}`, borderBottom: `1px solid ${DG.line25}`, marginBottom: 14, letterSpacing: 0.3, fontStyle: 'italic' },

  footer: { display: 'flex', justifyContent: 'space-between', paddingTop: 12, borderTop: `1px solid ${DG.line25}`, fontFamily: "'Roboto Mono', monospace", fontSize: 8, letterSpacing: 2, color: DG.muted },

  // ── Botones/tabs de modo de vista en la toolbar ──
  tbTab: { background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', fontFamily: "'Roboto',sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: 2, padding: '6px 12px', cursor: 'pointer' },
  tbTabActive: { color: 'var(--neon)', borderColor: 'var(--neon)', background: 'rgba(0,255,170,0.05)' },

  // ── Contenedor oculto para capturar el A4 con html2canvas sin mostrarlo en el modal ──
  offscreen: { position: 'fixed', top: 0, left: -99999, pointerEvents: 'none', zIndex: -1 },
};

// ══════════════════════════════════════════════
//  A4 LAYOUT — página vertical 210×297mm @ ~96dpi (794×1123px)
//  Se usa para exportar a PDF con jsPDF. Paleta D&G, tipografía igual al flyer.
// ══════════════════════════════════════════════
const A4_W = 794;  // 210mm @ 96dpi
const A4_PAD = 42; // padding lateral en px

const FSA4 = {
  // Dimensiones A4 fijas: 794×1123px @ 96dpi. overflow:hidden garantiza que nada
  // se escape del área que va a ser capturada por html2canvas.
  page: { position: 'relative', width: A4_W, height: 1123, background: DG.bg, color: DG.cream, fontFamily: "'Roboto',sans-serif", overflow: 'hidden', boxSizing: 'border-box', boxShadow: '0 12px 40px rgba(0,0,0,0.5)', borderRadius: 2 },
  bgImg: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', opacity: 0.9, zIndex: 0, pointerEvents: 'none' },
  bgTint: { position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(10,15,28,0.20) 0%, rgba(10,15,28,0.50) 50%, rgba(10,15,28,0.75) 100%)', zIndex: 1, pointerEvents: 'none' },
  // Content es flex-column con el footer al final: el body crece y ocupa el resto.
  content: { position: 'relative', zIndex: 2, padding: `36px ${A4_PAD}px 28px`, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' },
  body: { flex: 1, minHeight: 0, overflow: 'hidden' },

  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  logo: { height: 60, width: 'auto', display: 'block' },
  date: { fontFamily: "'Roboto Mono',monospace", fontSize: 9.5, letterSpacing: 3, color: DG.blue, textAlign: 'right' },

  // ── Header compacto en páginas 2+ ──
  contHeader: { display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 10, marginBottom: 14, borderBottom: `1px solid ${DG.line25}` },
  contLogo: { height: 30, width: 'auto', display: 'block' },
  contHeaderMid: { flex: 1, minWidth: 0 },
  contHeaderTitle: { fontFamily: "'Cormorant Garamond', Georgia, serif", fontWeight: 500, fontStyle: 'italic', fontSize: 15, letterSpacing: 3.5, color: DG.cream, margin: 0, lineHeight: 1.2 },
  contHeaderSub: { fontFamily: "'Roboto Mono',monospace", fontSize: 9, letterSpacing: 1.2, color: DG.creamDim, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  contHeaderDate: { fontFamily: "'Roboto Mono',monospace", fontSize: 8.5, letterSpacing: 2, color: DG.blue, textAlign: 'right', flexShrink: 0 },

  titleBlock: { display: 'flex', alignItems: 'center', gap: 18, marginBottom: 10 },
  hairline: { flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${DG.line50}, transparent)` },
  title: { fontFamily: "'Cormorant Garamond', Georgia, serif", fontWeight: 500, fontStyle: 'italic', fontSize: 28, letterSpacing: 6, color: DG.cream, margin: 0, textAlign: 'center' },

  subtitleBlock: { textAlign: 'center', marginBottom: 18 },
  subtitle: { fontFamily: "'Roboto Mono',monospace", fontSize: 11, letterSpacing: 1.5, color: DG.cream },
  asesor: { fontFamily: "'Roboto',sans-serif", fontSize: 10.5, letterSpacing: 1.2, color: DG.creamDim, marginTop: 4 },

  summaryRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 18 },

  // Sección de gráficos de torta
  piesSection: { marginBottom: 16 },
  pieRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 },
  pieRowFull: { display: 'grid', gridTemplateColumns: '1fr', gap: 10 },
  pieBlock: { background: DG.panel, border: `1px solid ${DG.line18}`, borderRadius: 3, padding: '12px 14px' },
  pieTitle: { fontFamily: "'Roboto',sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: 2.5, color: DG.blue, textTransform: 'uppercase', marginBottom: 10 },

  sectionLabel: { fontFamily: "'Roboto',sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: 3, color: DG.blue, marginBottom: 8, textTransform: 'uppercase' },

  notesBlock: { marginBottom: 12 },
  notesText: { fontFamily: "'Roboto',sans-serif", fontSize: 10.5, lineHeight: 1.55, color: DG.cream, background: DG.panel, border: `1px solid ${DG.line18}`, borderRadius: 3, padding: '10px 14px', whiteSpace: 'pre-wrap' },

  disclaimer: { fontFamily: "'Roboto',sans-serif", fontSize: 9, lineHeight: 1.5, color: DG.disc, textAlign: 'center', padding: '8px 14px', background: 'rgba(10,15,28,0.35)', borderTop: `1px solid ${DG.line25}`, borderBottom: `1px solid ${DG.line25}`, marginBottom: 10, letterSpacing: 0.3, fontStyle: 'italic' },

  // Footer con 3 columnas: marca (izq) · fecha (centro) · paginación (der).
  footer: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: `1px solid ${DG.line25}`, fontFamily: "'Roboto Mono',monospace", fontSize: 8, letterSpacing: 2, color: DG.muted, flexShrink: 0 },
  footerMid: { textAlign: 'center', flex: 1 },
};

// ══════════════════════════════════════════════
//  STYLES
// ══════════════════════════════════════════════
const S = {
  topRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' },
  addBtn: { background: 'none', border: '1px solid var(--neon)', borderRadius: 3, color: 'var(--neon)', fontFamily: "'Roboto Mono',monospace", fontSize: 10, fontWeight: 700, letterSpacing: 2, padding: '6px 14px', cursor: 'pointer' },
  toolBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace", fontSize: 10, fontWeight: 500, letterSpacing: 1, padding: '6px 12px', cursor: 'pointer' },

  rowList: { display: 'flex', flexDirection: 'column', gap: 4 },
  rowHeader: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border-neon)', background: 'var(--th-bg)', fontFamily: "'Roboto',sans-serif", fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--neon)', textTransform: 'uppercase', borderRadius: '4px 4px 0 0' },
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontFamily: "'Roboto Mono',monospace", fontSize: 11 },
  col: { overflow: 'hidden', textOverflow: 'ellipsis' },
  colClient: { flex: '1 1 160px', minWidth: 120 },
  colAcct: { flex: '0 0 100px' },
  colBroker: { flex: '0 0 90px' },
  colAsesor: { flex: '1 1 160px', minWidth: 140 },
  colPlazo: { flex: '0 0 80px' },
  colNum: { flex: '1 1 80px', textAlign: 'right' },
  colDate: { flex: '0 0 90px', color: 'var(--text-dim)' },
  colActions: { flex: '0 0 64px', display: 'flex', gap: 4, justifyContent: 'flex-end' },
  plazoPill: { fontSize: 9, fontWeight: 700, letterSpacing: 1.5, padding: '2px 6px', borderRadius: 3, background: 'var(--border)', color: 'var(--text)' },
  iconBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', fontSize: 11, width: 24, height: 24, cursor: 'pointer', lineHeight: 1 },

  editorHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20, padding: '12px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, flexWrap: 'wrap' },
  backBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace", fontSize: 10, fontWeight: 500, letterSpacing: 1, padding: '6px 12px', cursor: 'pointer' },
  editorTitle: { fontSize: 12, fontWeight: 700, letterSpacing: 4, color: 'var(--neon)' },

  section: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: 16, marginBottom: 16 },
  secT: { fontSize: 10, fontWeight: 700, letterSpacing: 3, color: 'var(--neon)', marginBottom: 12, textTransform: 'uppercase' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  formLabel: { display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'var(--text-dim)', marginBottom: 5, textTransform: 'uppercase' },
  input: { width: '100%', background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)', fontFamily: "'Roboto Mono',monospace", fontSize: 12, padding: '8px 10px', outline: 'none', boxSizing: 'border-box' },
  smallInput: { width: '100%', background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text)', fontFamily: "'Roboto Mono',monospace", fontSize: 11, padding: '4px 6px', outline: 'none', boxSizing: 'border-box', textAlign: 'right' },
  toggleBtn: { flex: 1, padding: '8px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-dim)', fontFamily: "'Roboto Mono',monospace", fontSize: 10, fontWeight: 700, letterSpacing: 1.5, cursor: 'pointer' },
  toggleActive: { color: 'var(--neon)', borderColor: 'var(--neon)', background: 'rgba(0,255,170,0.05)' },

  btnPrimary: { background: 'transparent', color: 'var(--neon)', border: '1px solid var(--neon)', borderRadius: 4, padding: '8px 16px', fontFamily: "'Roboto',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 2, cursor: 'pointer' },
  btnSecondary: { background: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 4, padding: '8px 16px', fontFamily: "'Roboto',sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: 2, cursor: 'pointer' },
  btnFlyer: { background: 'transparent', color: '#d4a373', border: '1px solid #d4a373', borderRadius: 4, padding: '8px 16px', fontFamily: "'Roboto',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 2, cursor: 'pointer' },

  itemsTable: { display: 'flex', flexDirection: 'column', gap: 3 },
  itemHead: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--th-bg)', borderRadius: 3, fontFamily: "'Roboto',sans-serif", fontSize: 8, fontWeight: 700, letterSpacing: 2, color: 'var(--neon)', textTransform: 'uppercase' },
  itemRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--row-alt)', borderRadius: 3, fontFamily: "'Roboto Mono',monospace", fontSize: 11 },
  itemCol: { overflow: 'hidden' },
  iColTicker: { flex: '0 0 90px' },
  iColType: { flex: '1 1 140px', minWidth: 100 },
  iColTypeWide: { flex: '1 1 260px', minWidth: 180, whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
  iColNum: { flex: '0 0 80px', textAlign: 'right' },
  iColInput: { flex: '0 0 110px' },
  iColNominales: { flex: '0 0 110px' },
  iColAction: { flex: '0 0 28px' },
  freeBtn: { background: 'transparent', border: '1px dashed var(--neon)', borderRadius: 2, color: 'var(--neon)', fontFamily: "'Roboto Mono',monospace", fontSize: 8, fontWeight: 700, letterSpacing: 1, padding: '3px 4px', cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1.2 },

  metricsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 },
  aggCard: { background: 'var(--row-alt)', borderRadius: 4, padding: '10px 12px', textAlign: 'center' },
  aggLbl: { fontSize: 8, fontWeight: 700, letterSpacing: 1.5, color: 'var(--text-dim)', marginBottom: 4, textTransform: 'uppercase' },
  aggVal: { fontFamily: "'Roboto Mono',monospace", fontSize: 14, fontWeight: 700, color: 'var(--neon)' },

  // Override del KPI de cantidad de activos
  overrideToggle: { display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: "'Roboto Mono',monospace", fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: 'var(--text-dim)', cursor: 'pointer', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--input-bg)' },
  overrideRow: { display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', padding: '10px 12px', background: 'rgba(0,255,170,0.04)', border: '1px dashed rgba(0,255,170,0.25)', borderRadius: 4 },
};

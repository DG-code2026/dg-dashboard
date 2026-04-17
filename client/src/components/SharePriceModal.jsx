import { useState, useEffect, useRef } from 'react';

const TITLES = {
  'mep-compra': { main: 'COMPRA', sub: 'DÓLAR MEP' },
  'mep-venta':  { main: 'VENTA',  sub: 'DÓLAR MEP' },
  'ccl-compra': { main: 'COMPRA', sub: 'DÓLAR CCL' },
  'ccl-venta':  { main: 'VENTA',  sub: 'DÓLAR CCL' },
  'canje-compra': { main: 'CANJE', sub: 'MEP → CCL' },
  'canje-venta':  { main: 'CANJE', sub: 'CCL → MEP' },
};

const BG = '#F7F5F0';
const NAVY = '#102F4A';
const NAVY_DIM = '#6386AC';
const W = 1080, H = 1080;

export default function SharePriceModal({ spec, commission, onClose }) {
  const [mode, setMode] = useState('neto');
  const [copied, setCopied] = useState(false);
  const [copyErr, setCopyErr] = useState(false);
  const canvasRef = useRef(null);

  const key = `${spec.op}-${spec.side}`;
  const title = TITLES[key];
  const value = mode === 'neto' ? spec.con : spec.sin;
  const valueStr = spec.isPct
    ? `${value >= 0 ? '+' : ''}${(value * 100).toLocaleString('es-AR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}%`
    : `$${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => { draw(); }, [mode, spec, commission]);

  async function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    try { await document.fonts.ready; } catch {}

    let logoBottom = 280;
    try {
      const img = await loadImg('/logos/DG-tema-claro.svg');
      const logoW = 640;
      const aspect = img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : (239 / 723);
      const logoH = logoW * aspect;
      const logoX = (W - logoW) / 2;
      const logoY = 110;
      ctx.drawImage(img, logoX, logoY, logoW, logoH);
      logoBottom = logoY + logoH;
    } catch {}

    const dividerY = logoBottom + 90;
    ctx.strokeStyle = NAVY_DIM + '55';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 180, dividerY);
    ctx.lineTo(W / 2 + 180, dividerY);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = NAVY_DIM;
    ctx.font = '600 24px Montserrat, sans-serif';
    ctx.fillText(spaced(title.main), W / 2, dividerY + 70);

    ctx.fillStyle = NAVY;
    ctx.font = '700 56px "Cormorant Garamond", Georgia, serif';
    ctx.fillText(title.sub, W / 2, dividerY + 140);

    ctx.fillStyle = NAVY;
    const priceSize = valueStr.length > 10 ? 120 : 150;
    ctx.font = `700 ${priceSize}px "Roboto Mono", ui-monospace, monospace`;
    ctx.fillText(valueStr, W / 2, dividerY + 320);

    ctx.strokeStyle = NAVY_DIM + '33';
    ctx.beginPath();
    ctx.moveTo(120, 950);
    ctx.lineTo(W - 120, 950);
    ctx.stroke();

    const now = new Date();
    const date = now.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

    ctx.fillStyle = NAVY;
    ctx.font = '500 18px Montserrat, sans-serif';
    ctx.fillText('Fuente: BYMA a través de Primary API', W / 2, 995);
    ctx.fillStyle = NAVY_DIM;
    ctx.font = '400 16px "Roboto Mono", ui-monospace, monospace';
    ctx.fillText(`${date} · ${time} hs`, W / 2, 1030);
  }

  async function handleDownload() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dg-${key}-${mode}-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  async function handleCopy() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(async blob => {
      if (!blob) return;
      try {
        if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') throw new Error('clipboard unsupported');
        await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
        setCopied(true);
        setCopyErr(false);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setCopyErr(true);
        setTimeout(() => setCopyErr(false), 2500);
      }
    }, 'image/png');
  }

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.popup}>
        <div style={S.header}>
          <span style={S.title}>COMPARTIR COTIZACIÓN</span>
          <button style={S.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={S.body}>
          <div style={S.previewWrap}>
            <canvas ref={canvasRef} style={S.preview} />
          </div>

          <div style={S.toggleRow}>
            <button style={{ ...S.toggleBtn, ...(mode === 'bruto' ? S.toggleActive : {}) }} onClick={() => setMode('bruto')}>BRUTO (sin com.)</button>
            <button style={{ ...S.toggleBtn, ...(mode === 'neto' ? S.toggleActive : {}) }} onClick={() => setMode('neto')}>NETO (con com.)</button>
          </div>

          <div style={S.actions}>
            <button style={S.actionBtn} onClick={handleDownload}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>DESCARGAR PNG</span>
            </button>
            <button style={S.actionBtn} onClick={handleCopy}>
              {copied ? (
                <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg><span>COPIADO</span></>
              ) : copyErr ? (
                <span>NO SOPORTADO</span>
              ) : (
                <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg><span>COPIAR IMAGEN</span></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function spaced(s) {
  return s.split('').join('\u2009');
}

const S = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(3px)' },
  popup: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 480, fontFamily: "'Roboto', sans-serif", boxShadow: '0 20px 60px rgba(0,0,0,0.55)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' },
  title: { fontSize: 11, fontWeight: 700, letterSpacing: 3, color: 'var(--neon)' },
  closeBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-dim)', fontSize: 12, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  body: { padding: 20, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' },
  previewWrap: { background: '#F7F5F0', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', aspectRatio: '1 / 1' },
  preview: { width: '100%', height: '100%', display: 'block' },
  toggleRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 },
  toggleBtn: { padding: '10px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 2, cursor: 'pointer', transition: 'all 0.15s' },
  toggleActive: { color: 'var(--text)', borderColor: 'var(--text)', background: 'rgba(255,255,255,0.04)' },
  actions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  actionBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 14px', background: 'var(--neon)', border: 'none', borderRadius: 6, color: 'var(--bg)', fontFamily: "'Roboto Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: 2, cursor: 'pointer', transition: 'opacity 0.15s' },
};

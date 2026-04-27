import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getCompanyInfo } from './companyData';
import BondDetailModal from './BondDetailModal';
import TirMdChart from './TirMdChart';
import AddToCarteraPopup from './AddToCarteraPopup';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const HISTORY_KEY_PREFIX = 'rf-history-';
const REFRESH_MS = 60000;
const MONTH_LABELS = ['EN','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

function loadJSON(k,fb){try{return JSON.parse(localStorage.getItem(k))||fb;}catch{return fb;}}
function saveJSON(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}
function extractMonths(flows){if(!flows?.length)return'—';const now=new Date();const m=new Set();for(const f of flows){if(!f.rent||f.rent<=0)continue;const d=new Date(f.cuttingDate);if(isNaN(d)||d<=now)continue;m.add(d.getMonth());}return m.size?[...m].sort((a,b)=>a-b).map(i=>MONTH_LABELS[i]).join(' - '):'—';}
function extractCoupon(s){if(!s)return'—';const m=s.match(/([\d.,]+\s*%)/);return m?m[1].trim():s;}
function tirBg(tir,min,max){if(tir==null||min===max)return'transparent';const t=Math.max(0,Math.min(1,(tir-min)/(max-min)));return`rgba(${Math.round(255-t*199)},255,${Math.round(255-t*235)},${(0.12+t*0.35).toFixed(2)})`;}
function copyText(t){navigator.clipboard?.writeText(t).catch(()=>{});}
async function loadH2C(){if(window.html2canvas)return window.html2canvas;return new Promise((r,j)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';s.onload=()=>r(window.html2canvas);s.onerror=()=>j();document.head.appendChild(s);});}

const DETAIL_LABELS={tir:'TIR',md:'Modified Duration',issuer:'Emisor',issueCurrency:'Moneda de emisión',amortization:'Amortización',interests:'Intereses',issueDate:'Fecha de emisión',expirationDate:'Fecha de vencimiento',law:'Ley aplicable',minimalSheet:'Lámina mínima',isin:'ISIN'};
const DETAIL_FIELDS=Object.keys(DETAIL_LABELS);
function fmtD(k,v){if(v==null||v==='')return'—';if(k==='tir')return`${(v*100).toFixed(1)}%`;if(k==='md')return typeof v==='number'?v.toFixed(1):v;return String(v);}

function FlyerModal({data,columns,tirMin,tirMax,lastUpdate,onClose,title}){
  const[visCols,setVisCols]=useState(()=>columns.map(c=>c.key));const ref=useRef(null);const[dl,setDl]=useState(false);
  const[theme,setTheme]=useState(()=>document.documentElement.getAttribute('data-theme')||'dark');
  useEffect(()=>{const obs=new MutationObserver(()=>setTheme(document.documentElement.getAttribute('data-theme')||'dark'));obs.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>obs.disconnect();},[]);
  const logoSrc=theme==='dark'?'/logos/DG%20tema%20oscuro.png':'/logos/DG-tema-claro.svg';
  const vis=columns.filter(c=>visCols.includes(c.key));
  const cap=async a=>{setDl(true);try{const h2c=await loadH2C();await new Promise(r=>setTimeout(r,50));const canvas=await h2c(ref.current,{backgroundColor:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()||'#0a0a0a',scale:2,useCORS:true,logging:false});if(a==='download'){const l=document.createElement('a');l.download=`${title.toLowerCase().replace(/\s+/g,'-')}-${new Date().toISOString().slice(0,10)}.png`;l.href=canvas.toDataURL('image/png');l.click();}else canvas.toBlob(b=>{if(b)navigator.clipboard.write([new ClipboardItem({'image/png':b})]);});}catch(e){alert(e.message);}finally{setDl(false);}};
  return(<div style={S.flyerOverlay} onClick={e=>e.target===e.currentTarget&&onClose()}><div style={{width:'100%',maxWidth:1200}}>
    <div style={S.flyerControls}><div style={{display:'flex',gap:6,flexWrap:'wrap',flex:1}}>{columns.map(c=><label key={c.key} style={S.flyerCheck}><input type="checkbox" checked={visCols.includes(c.key)} onChange={()=>setVisCols(p=>p.includes(c.key)?p.filter(x=>x!==c.key):[...p,c.key])} style={{marginRight:4}}/><span style={{fontSize:9,letterSpacing:1}}>{c.label}</span></label>)}</div><div style={{display:'flex',gap:8}}><button style={S.flyerBtn} onClick={()=>cap('download')} disabled={dl}>{dl?'...':'⬇ Descargar'}</button><button style={S.flyerBtn} onClick={()=>cap('copy')} disabled={dl}>{dl?'...':'📋 Copiar'}</button><button style={{...S.flyerBtn,color:'var(--red)'}} onClick={onClose}>✕</button></div></div>
    <div ref={ref} style={{background:'var(--bg)',borderRadius:8,overflow:'hidden',border:'1px solid var(--border)'}}>
      <div style={{padding:'24px 24px 16px',borderBottom:'2px solid var(--neon)'}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:20,flexWrap:'wrap'}}><img src={logoSrc} alt="Delfino Gaviña" crossOrigin="anonymous" style={{height:48,width:'auto',display:'block',flexShrink:0}}/><div style={{fontFamily:"'Roboto Mono',monospace",fontSize:11,color:'var(--text-dim)'}}>{new Date().toLocaleDateString('es-AR',{day:'2-digit',month:'long',year:'numeric'})}</div></div><div style={{fontWeight:900,fontSize:18,letterSpacing:6,color:'var(--neon)',textAlign:'center',marginTop:14}}>{title}</div></div>
      <table style={{width:'100%',borderCollapse:'collapse',fontFamily:"'Roboto Mono',monospace",fontSize:11}}><thead><tr>{vis.map(c=><th key={c.key} style={S.flyerTh}>{c.label}</th>)}</tr></thead><tbody>{data.map((row,ri)=><tr key={row.ticker} style={{background:ri%2===0?'var(--row-alt)':'transparent'}}>{vis.map(col=>{const v=row[col.key];return<td key={col.key} style={{...S.flyerTd,background:col.isTir?tirBg(v,tirMin,tirMax):'transparent',color:col.dynamic?'var(--neon)':'var(--text)',fontWeight:col.key==='ticker'||col.dynamic||col.isTir?700:400}}>{col.editable?(row.law||'—'):col.fmt(v)}</td>;})}</tr>)}</tbody></table>
      <div style={{display:'flex',justifyContent:'space-between',padding:'12px 24px',borderTop:'1px solid var(--border)',fontFamily:"'Roboto Mono',monospace",fontSize:9,color:'var(--text-dim)'}}><span>Fuente: Portfolio Personal Inversiones (PPI) · API REST · A-24HS</span><span>{lastUpdate?`Actualizado: ${lastUpdate.toLocaleString('es-AR',{dateStyle:'medium',timeStyle:'short'})}`:''}</span></div>
    </div>
  </div></div>);
}

// ══════════════════════════════════════════════
//  config: { dbRoute, apiType, settlement, settingsKey, showPaymentMonths, collapsibleSearch, title, flyerTitle }
// ══════════════════════════════════════════════
export default function BondPage({ config }) {
  const { dbRoute, apiType, settlement = 'A-24HS', settingsKey, showPaymentMonths = true, collapsibleSearch = false, title, flyerTitle } = config;
  const historyKey = HISTORY_KEY_PREFIX + dbRoute;

  const ALL_COLS = useMemo(() => {
    const cols = {
      ticker:{label:'Ticker',defW:80,fmt:v=>v||'—'},issuer:{label:'Empresa',defW:170,fmt:v=>v||'—'},
      expirationDate:{label:'Vencimiento',defW:105,fmt:v=>v||'—'},coupon:{label:'Cupón',defW:75,fmt:v=>v||'—'},
    };
    if (showPaymentMonths) cols.paymentMonths = {label:'Meses Corte',defW:110,fmt:v=>v||'—'};
    Object.assign(cols, {
      price:{label:'Px (MEP)',defW:90,fmt:v=>v!=null?`$${Number(v).toFixed(2)}`:'—',dynamic:true},
      law:{label:'LEY',defW:65,fmt:v=>v||'—',editable:true},
      minimalSheet:{label:'Lámina',defW:82,fmt:v=>v||'—'},
      isin:{label:'ISIN',defW:140,fmt:v=>v||'—',copyable:true},
      tir:{label:'TIR',defW:78,fmt:v=>v!=null?`${(v*100).toFixed(1)}%`:'—',isTir:true},
      md:{label:'MD',defW:60,fmt:v=>v!=null?Number(v).toFixed(1):'—',dynamic:true},
    });
    return cols;
  }, [showPaymentMonths]);

  const DEF_ORDER = useMemo(() => Object.keys(ALL_COLS), [ALL_COLS]);

  const[ticker,setTicker]=useState('');const[loading,setLoading]=useState(false);const[error,setError]=useState(null);const[result,setResult]=useState(null);const[price,setPrice]=useState(null);const[history,setHistory]=useState(()=>loadJSON(historyKey,[]));const[showResult,setShowResult]=useState(false);const[showSearch,setShowSearch]=useState(!collapsibleSearch);const inputRef=useRef(null);
  const[dbFavs,setDbFavs]=useState([]);const[favData,setFavData]=useState([]);const[favRawBonds,setFavRawBonds]=useState({});const[favLoading,setFavLoading]=useState(false);const[favLastUpdate,setFavLastUpdate]=useState(null);const[sortCol,setSortCol]=useState('ticker');const[sortAsc,setSortAsc]=useState(true);const[filters,setFilters]=useState({});const[showFilters,setShowFilters]=useState(false);const[countdown,setCountdown]=useState(60);const refreshRef=useRef(null);const countdownRef=useRef(null);const[copiedIsin,setCopiedIsin]=useState(null);const[showFlyer,setShowFlyer]=useState(false);const[showChart,setShowChart]=useState(false);
  const[flyerSel,setFlyerSel]=useState(new Set());
  const[modalTicker,setModalTicker]=useState(null);const[modalBond,setModalBond]=useState(null);const[modalPrice,setModalPrice]=useState(null);const[modalLaw,setModalLaw]=useState('');
  const[carteraPopup,setCarteraPopup]=useState(null); // {ticker, precio, laminaMinima}
  const[colOrder,setColOrder]=useState(DEF_ORDER);const[dragCol,setDragCol]=useState(null);
  const[colWidths,setColWidths]=useState(()=>{const w={};DEF_ORDER.forEach(k=>{w[k]=ALL_COLS[k]?.defW||80;});return w;});
  const resizeColRef=useRef(null);const resizeStartX=useRef(0);const resizeStartW=useRef(0);

  useEffect(()=>{inputRef.current?.focus();},[]);

  // Load from DB
  useEffect(()=>{(async()=>{try{const[fr,sr]=await Promise.all([fetch(`${API}/api/db/${dbRoute}`),fetch(`${API}/api/db/settings`)]);const favs=await fr.json();const settings=await sr.json();if(Array.isArray(favs))setDbFavs(favs);if(Array.isArray(settings[settingsKey])&&settings[settingsKey].length)setColOrder(settings[settingsKey]);const wk=settingsKey+'_widths';if(settings[wk]&&typeof settings[wk]==='object'&&Object.keys(settings[wk]).length)setColWidths(p=>({...p,...settings[wk]}));}catch(e){console.error('DB load:',e);}})();},[dbRoute,settingsKey]);

  // Save settings (debounced)
  const saveTimer=useRef(null);
  const saveSetting=useCallback((key,value)=>{clearTimeout(saveTimer.current);saveTimer.current=setTimeout(()=>{fetch(`${API}/api/db/settings/${key}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value})}).catch(()=>{});},800);},[]);

  const handleColOrderChange=o=>{setColOrder(o);saveSetting(settingsKey,o);};
  const handleColWidthsChange=w=>{setColWidths(w);saveSetting(settingsKey+'_widths',w);};

  const favTickers=useMemo(()=>dbFavs.map(f=>f.ticker),[dbFavs]);
  const isInFavorites=result&&favTickers.includes(ticker);

  // Search
  const handleSearch=useCallback(async override=>{const t=(override||ticker).trim().toUpperCase();if(!t)return;setTicker(t);setLoading(true);setError(null);setResult(null);setPrice(null);setShowResult(false);try{const mr=await fetch(`${API}/api/ppi/market-data/current?ticker=${encodeURIComponent(t)}&type=${apiType}&settlement=${settlement}`);const md=await mr.json();if(!mr.ok||md.error||md.price==null||md.price===0)throw new Error('NOT_FOUND');setPrice(md.price);const br=await fetch(`${API}/api/ppi/bonds/estimate?ticker=${encodeURIComponent(t)}&price=${md.price}`);const bd=await br.json();if(!br.ok||bd.error)throw new Error('NOT_FOUND');setResult(Array.isArray(bd)?bd[0]:bd);setShowResult(true);setHistory(p=>{const u=[{ticker:t,price:md.price,date:new Date().toISOString()},...p.filter(h=>h.ticker!==t)].slice(0,20);saveJSON(historyKey,u);return u;});}catch(e){setError(e.message==='NOT_FOUND'?`El ticker ingresado no corresponde a un instrumento de tipo ${apiType}`:(e.message||'Error'));}finally{setLoading(false);}},[ticker,apiType,historyKey]);

  const removeFromHistory=t=>setHistory(p=>{const u=p.filter(h=>h.ticker!==t);saveJSON(historyKey,u);return u;});
  const addToFavorites=async()=>{if(!ticker||isInFavorites)return;try{await fetch(`${API}/api/db/${dbRoute}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticker,empresa:result?.issuer||ticker})});const r=await fetch(`${API}/api/db/${dbRoute}`);const f=await r.json();if(Array.isArray(f))setDbFavs(f);setTimeout(fetchFavorites,500);}catch(e){console.error(e);}};
  const removeFromFavorites=async t=>{try{await fetch(`${API}/api/db/${dbRoute}/${t}`,{method:'DELETE'});setDbFavs(p=>p.filter(f=>f.ticker!==t));setFavData(p=>p.filter(r=>r.ticker!==t));}catch(e){console.error(e);}};
  const updateLaw=async(tk,ley)=>{setFavData(p=>p.map(r=>r.ticker===tk?{...r,law:ley}:r));try{await fetch(`${API}/api/db/${dbRoute}/${tk}/law`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({ley})});}catch{}};
  const handleCopyIsin=isin=>{copyText(isin);setCopiedIsin(isin);setTimeout(()=>setCopiedIsin(null),1500);};
  const openDetail=row=>{const rb=favRawBonds[row.ticker];if(rb){setModalTicker(row.ticker);setModalBond(rb);setModalPrice(row.price);setModalLaw(row.law||'');}};

  const dbFavsRef=useRef(dbFavs);
  useEffect(()=>{dbFavsRef.current=dbFavs;},[dbFavs]);

  const fetchFavorites=useCallback(async()=>{
    let tickers,freshFavs;
    try{const r=await fetch(`${API}/api/db/${dbRoute}`);freshFavs=await r.json();if(Array.isArray(freshFavs)){setDbFavs(freshFavs);tickers=freshFavs.map(f=>f.ticker);}else{tickers=dbFavsRef.current.map(f=>f.ticker);freshFavs=dbFavsRef.current;}}
    catch{tickers=dbFavsRef.current.map(f=>f.ticker);freshFavs=dbFavsRef.current;}
    if(!tickers.length){setFavData([]);return;}
    setFavLoading(true);
    try{const res=await fetch(`${API}/api/ppi/bonds/batch?type=${apiType}&settlement=${settlement}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tickers})});const data=await res.json();const rawBonds={};const dbMap={};(freshFavs||[]).forEach(f=>{dbMap[f.ticker]=f;});
    const rows=data.filter(d=>!d.error&&d.bond).map(d=>{rawBonds[d.ticker]=d.bond;const db=dbMap[d.ticker]||{};const row={ticker:d.ticker,price:d.price,tir:d.bond.tir,md:d.bond.md,issuer:d.bond.issuer,coupon:extractCoupon(d.bond.interests),expirationDate:d.bond.expirationDate,law:db.ley||d.bond.law||'',minimalSheet:d.bond.minimalSheet,isin:d.bond.isin};if(showPaymentMonths)row.paymentMonths=extractMonths(d.bond.flows);return row;});
    setFavRawBonds(rawBonds);setFavData(rows);setFavLastUpdate(new Date());setCountdown(60);}catch(e){console.error('Fav fetch:',e);}finally{setFavLoading(false);}
  },[dbRoute,apiType,settlement,showPaymentMonths]);

  useEffect(()=>{fetchFavorites();refreshRef.current=setInterval(fetchFavorites,REFRESH_MS);return()=>clearInterval(refreshRef.current);},[fetchFavorites]);
  useEffect(()=>{countdownRef.current=setInterval(()=>setCountdown(c=>c<=1?60:c-1),1000);return()=>clearInterval(countdownRef.current);},[]);

  const onDragStart=(e,k)=>{setDragCol(k);e.dataTransfer.effectAllowed='move';};
  const onDragOver=e=>e.preventDefault();
  const onDrop=(e,tk)=>{e.preventDefault();if(!dragCol||dragCol===tk)return;const n=[...colOrder];n.splice(n.indexOf(dragCol),1);n.splice(n.indexOf(tk),0,dragCol);handleColOrderChange(n);setDragCol(null);};
  const onResizeStart=(e,k)=>{e.preventDefault();e.stopPropagation();resizeColRef.current=k;resizeStartX.current=e.clientX;resizeStartW.current=colWidths[k]||ALL_COLS[k]?.defW||80;const mv=ev=>{const nw={...colWidths,[resizeColRef.current]:Math.max(40,resizeStartW.current+ev.clientX-resizeStartX.current)};setColWidths(nw);};const up=()=>{handleColWidthsChange({...colWidths,[resizeColRef.current]:Math.max(40,resizeStartW.current+(window._lastResizeX||0)-resizeStartX.current)});document.removeEventListener('mousemove',mv2);document.removeEventListener('mouseup',up);};const mv2=ev=>{window._lastResizeX=ev.clientX;const nw=Math.max(40,resizeStartW.current+ev.clientX-resizeStartX.current);setColWidths(p=>({...p,[resizeColRef.current]:nw}));};document.addEventListener('mousemove',mv2);document.addEventListener('mouseup',up);};
  const handleSort=col=>{if(sortCol===col)setSortAsc(!sortAsc);else{setSortCol(col);setSortAsc(true);}};

  const{processedData,tirMin,tirMax}=useMemo(()=>{let rows=[...favData];Object.entries(filters).forEach(([key,val])=>{if(!val)return;const low=val.toLowerCase();rows=rows.filter(r=>{const c=r[key];if(c==null)return false;if(key==='tir'&&typeof c==='number')return`${(c*100).toFixed(2)}%`.includes(low);return String(c).toLowerCase().includes(low);});});rows.sort((a,b)=>{let va=a[sortCol],vb=b[sortCol];if(va==null)return 1;if(vb==null)return-1;if(typeof va==='number'&&typeof vb==='number')return sortAsc?va-vb:vb-va;return sortAsc?String(va).localeCompare(String(vb)):String(vb).localeCompare(String(va));});const tirs=rows.map(r=>r.tir).filter(t=>t!=null);return{processedData:rows,tirMin:tirs.length?Math.min(...tirs):0,tirMax:tirs.length?Math.max(...tirs):0};},[favData,filters,sortCol,sortAsc]);

  const columns=useMemo(()=>colOrder.filter(k=>ALL_COLS[k]).map(k=>({key:k,...ALL_COLS[k],w:colWidths[k]||ALL_COLS[k]?.defW||80})),[colOrder,colWidths,ALL_COLS]);

  const CB='1px solid rgba(128,128,128,0.15)';

  return(
    <div>
      <style>{`.rf-th:hover .rf-resize{opacity:1;background:var(--neon-dim);}.rf-resize:hover{background:var(--neon)!important;}`}</style>
      {modalBond&&<BondDetailModal bond={modalBond} ticker={modalTicker} price={modalPrice} manualLaw={modalLaw} assetType={apiType} onClose={()=>setModalBond(null)}/>}
      {carteraPopup&&<AddToCarteraPopup ticker={carteraPopup.ticker} precio={carteraPopup.precio} tipo={apiType} settlement={settlement} laminaMinima={carteraPopup.laminaMinima} onClose={()=>setCarteraPopup(null)}/>}
      {showFlyer&&<FlyerModal data={flyerSel.size?processedData.filter(r=>flyerSel.has(r.ticker)):processedData} columns={columns} tirMin={tirMin} tirMax={tirMax} lastUpdate={favLastUpdate} onClose={()=>setShowFlyer(false)} title={flyerTitle}/>}

      {/* Search - collapsible or always visible */}
      {collapsibleSearch && !showSearch && (
        <div style={{marginBottom:16}}><button style={S.addBtn} onClick={()=>setShowSearch(true)}>＋ Agregar papel</button></div>
      )}
      {showSearch && (
        <div style={{position:'relative'}}>
          {collapsibleSearch && <button style={S.closeSearchBtn} onClick={()=>{setShowSearch(false);setError(null);setShowResult(false);}}>✕</button>}
          <div style={S.searchRow}><div style={S.inputWrap}><span style={S.searchIcon}>⌕</span><input ref={inputRef} style={S.input} placeholder={`Ticker (ej: ${apiType==='ON'?'YMCJD, PLC2D':'AL30D, GD35D'})`} value={ticker} onChange={e=>setTicker(e.target.value.toUpperCase())} onKeyDown={e=>e.key==='Enter'&&handleSearch()} disabled={loading}/></div><button style={{...S.btn,opacity:loading||!ticker.trim()?0.4:1}} onClick={()=>handleSearch()} disabled={loading||!ticker.trim()}>{loading?<span style={S.spinner}/>:'CONSULTAR'}</button></div>
        </div>
      )}

      {history.length>0&&showSearch&&<div style={S.historyRow}><span style={S.historyLabel}>RECIENTES</span><div style={S.chips}>{history.map(h=><div key={h.ticker} style={S.chip}><button style={S.chipBtn} onClick={()=>{setTicker(h.ticker);handleSearch(h.ticker);}}>{h.ticker}</button><button style={S.chipX} onClick={()=>removeFromHistory(h.ticker)}>×</button></div>)}</div></div>}
      {error&&<div style={S.errorBox}><b>✕</b> {error}</div>}
      {loading&&<div style={S.card}>{Array.from({length:10}).map((_,i)=><div key={i} style={{...S.skelRow,animationDelay:`${i*80}ms`}}><div style={S.skelLabel}/><div style={{...S.skelVal,width:`${35+Math.random()*30}%`}}/></div>)}</div>}

      {result&&!loading&&showResult&&(
        <div style={{...S.card,animation:'fade-in 0.3s ease',marginBottom:40,position:'relative'}}>
          <button style={S.closeBtn} onClick={()=>setShowResult(false)}>✕</button>
          <div style={S.priceHeader}><div style={{display:'flex',alignItems:'center',gap:10}}><span style={S.tickerBadge}>{ticker}</span><span style={S.priceMeta}>{settlement}</span></div><div style={{display:'flex',alignItems:'center',gap:16}}><span style={S.priceVal}>${price?.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>{!isInFavorites?<button style={S.addFavBtn} onClick={addToFavorites}>★ AGREGAR</button>:<span style={S.inFavBadge}>★ EN FAVORITOS</span>}</div></div>
          {DETAIL_FIELDS.map((f,i)=><div key={f} style={{...S.detailRow,background:i%2===0?'var(--row-alt)':'transparent'}}><span style={S.detailLabel}>{DETAIL_LABELS[f]}</span><span style={S.detailValue}>{fmtD(f,result[f])}</span></div>)}
          <div style={S.detailFooter}>Consultado {new Date().toLocaleString('es-AR',{dateStyle:'medium',timeStyle:'short'})}</div>
        </div>
      )}

      {/* TABLE */}
      <div style={{marginTop:40}}>
        <div style={S.favTitleRow}><h3 style={S.favTitle}>{title}</h3><div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><button style={S.toolBtn} onClick={()=>setShowChart(!showChart)}>{showChart?'✕ CURVA':`📈 CURVA${flyerSel.size?` (${flyerSel.size})`:''}`}</button><button style={S.toolBtn} onClick={()=>setShowFlyer(true)}>📷 FLYER{flyerSel.size?` (${flyerSel.size})`:''}</button><button style={S.toolBtn} onClick={()=>setShowFilters(!showFilters)}>{showFilters?'✕ FILTROS':'⊞ FILTROS'}</button><button style={S.refreshBtn} onClick={fetchFavorites} disabled={favLoading}>{favLoading?<span style={S.spinnerSm}/>:'↻'}</button></div></div>
        <div style={S.favMeta}>{favLastUpdate&&<span>Actualizado {favLastUpdate.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>}<span style={S.countdown}><span style={S.countdownDot}/>{countdown}s</span><span style={{opacity:0.4,fontSize:9}}>Supabase · {dbFavs.length} papeles</span></div>

        <div style={S.tableWrap}>
          <table style={S.table}>
            <thead><tr>
              <th style={{...S.th,width:30,cursor:'default',borderRight:CB}}></th>
              <th style={{...S.th,width:30,cursor:'default',borderRight:CB}}></th>
              <th style={{...S.th,width:26,cursor:'pointer',borderRight:CB,padding:'10px 2px'}} onClick={()=>{if(flyerSel.size===processedData.length)setFlyerSel(new Set());else setFlyerSel(new Set(processedData.map(r=>r.ticker)));}} title="Seleccionar para flyer"><input type="checkbox" checked={flyerSel.size>0&&flyerSel.size===processedData.length} onChange={()=>{}} style={{cursor:'pointer',accentColor:'var(--neon)'}}/></th>
              {columns.map((col,ci)=><th key={col.key} className="rf-th" draggable onDragStart={e=>onDragStart(e,col.key)} onDragOver={onDragOver} onDrop={e=>onDrop(e,col.key)} style={{...S.th,width:col.w,minWidth:40,position:'relative',opacity:dragCol===col.key?0.4:1,borderRight:ci<columns.length-1?CB:'none'}} onClick={()=>handleSort(col.key)}>
                <div style={{display:'flex',alignItems:'center',gap:3,justifyContent:'center',cursor:'grab'}}>{col.label}<span style={{fontSize:7,opacity:0.6}}>{sortCol===col.key?(sortAsc?'▲':'▼'):'⇅'}</span></div>
                <div className="rf-resize" style={S.resizeHandle} onMouseDown={e=>onResizeStart(e,col.key)}/>
              </th>)}
            </tr>
            {showFilters&&<tr>{[null,null,null,...columns].map((col,i)=><th key={i} style={{...S.thFilter,borderRight:i<columns.length+2?CB:'none'}}>{col?<input style={S.filterInput} placeholder="..." value={filters[col.key]||''} onChange={e=>setFilters(p=>({...p,[col.key]:e.target.value}))}/>:null}</th>)}</tr>}
            </thead>
            <tbody>
              {favLoading&&!favData.length?Array.from({length:8}).map((_,i)=><tr key={i}><td style={{...S.td,borderRight:CB}}></td><td style={{...S.td,borderRight:CB}}></td><td style={{...S.td,borderRight:CB}}></td>{columns.map((c,ci)=><td key={c.key} style={{...S.td,borderRight:ci<columns.length-1?CB:'none'}}><div style={{...S.skelCell,width:`${40+Math.random()*40}%`,margin:'0 auto'}}/></td>)}</tr>)
              :!processedData.length?<tr><td colSpan={columns.length+3} style={{...S.td,textAlign:'center',padding:32,color:'var(--text-dim)'}}>Sin datos</td></tr>
              :processedData.map((row,ri)=>(
                <tr key={row.ticker} style={{background:ri%2===0?'var(--row-alt)':'transparent',cursor:'pointer'}} onMouseEnter={e=>{e.currentTarget.style.background='var(--row-hover)';}} onMouseLeave={e=>{e.currentTarget.style.background=ri%2===0?'var(--row-alt)':'transparent';}} onClick={()=>openDetail(row)}>
                  <td style={{...S.td,textAlign:'center',borderRight:CB}} onClick={e=>e.stopPropagation()}><button style={S.removeFavBtn} onClick={()=>removeFromFavorites(row.ticker)}>×</button></td>
                  <td style={{...S.td,textAlign:'center',borderRight:CB}} onClick={e=>e.stopPropagation()}><button style={S.addCarteraBtn} onClick={()=>setCarteraPopup({ticker:row.ticker,precio:row.price,laminaMinima:row.minimalSheet})} title="Agregar a cartera">＋</button></td>
                  <td style={{...S.td,textAlign:'center',borderRight:CB,padding:'8px 2px'}} onClick={e=>e.stopPropagation()}><input type="checkbox" checked={flyerSel.has(row.ticker)} onChange={()=>{setFlyerSel(p=>{const n=new Set(p);if(n.has(row.ticker))n.delete(row.ticker);else n.add(row.ticker);return n;});}} style={{cursor:'pointer',accentColor:'var(--neon)'}}/></td>
                  {columns.map((col,ci)=>{const v=row[col.key];const br=ci<columns.length-1?CB:'none';
                    if(col.editable)return<td key={col.key} style={{...S.td,textAlign:'center',borderRight:br}} onClick={e=>e.stopPropagation()}><input style={S.lawInput} value={row.law||''} onChange={e=>updateLaw(row.ticker,e.target.value.toUpperCase())} placeholder="—" maxLength={10}/></td>;
                    if(col.copyable)return<td key={col.key} style={{...S.td,textAlign:'center',borderRight:br}} onClick={e=>e.stopPropagation()}><span style={{fontSize:10}}>{v||'—'}</span>{v&&<button style={S.copyBtn} onClick={()=>handleCopyIsin(v)}>{copiedIsin===v?'✓':'⧉'}</button>}</td>;
                    if(col.isTir)return<td key={col.key} style={{...S.td,textAlign:'center',background:tirBg(v,tirMin,tirMax),fontWeight:700,borderRight:br}}>{col.fmt(v)}</td>;
                    return<td key={col.key} style={{...S.td,textAlign:'center',color:col.dynamic?'var(--neon)':'var(--text)',fontWeight:col.key==='ticker'||col.dynamic?700:400,borderRight:br}}>{col.fmt(v)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={S.tableFoot}>{processedData.length} papeles · Auto-refresh 60s · API PPI ({apiType}) · {settlement}</div>
      </div>

      {showChart&&<TirMdChart data={flyerSel.size?processedData.filter(r=>flyerSel.has(r.ticker)):processedData}/>}
    </div>
  );
}

const S={
  searchRow:{display:'flex',gap:10,marginBottom:16},inputWrap:{flex:1,position:'relative'},searchIcon:{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',fontSize:16,color:'var(--text-dim)',pointerEvents:'none'},
  input:{width:'100%',height:44,background:'var(--input-bg)',border:'1px solid var(--border)',borderRadius:4,color:'var(--text)',fontFamily:"'Roboto Mono',monospace",fontSize:13,fontWeight:500,paddingLeft:38,paddingRight:14,letterSpacing:'0.05em',outline:'none'},
  btn:{height:44,padding:'0 24px',background:'transparent',color:'var(--neon)',fontFamily:"'Roboto',sans-serif",fontSize:11,fontWeight:700,letterSpacing:3,border:'1px solid var(--neon)',borderRadius:4,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',minWidth:120},
  spinner:{display:'inline-block',width:16,height:16,border:'2px solid var(--neon-dim)',borderTopColor:'var(--neon)',borderRadius:'50%',animation:'spin 0.6s linear infinite'},
  historyRow:{display:'flex',alignItems:'center',gap:12,marginBottom:24,flexWrap:'wrap'},historyLabel:{fontFamily:"'Roboto Mono',monospace",fontSize:9,fontWeight:500,letterSpacing:2,color:'var(--text-dim)'},
  chips:{display:'flex',gap:6,flexWrap:'wrap'},chip:{display:'flex',alignItems:'center',background:'var(--input-bg)',border:'1px solid var(--border)',borderRadius:3},chipBtn:{background:'none',border:'none',color:'var(--neon-dim)',fontFamily:"'Roboto Mono',monospace",fontSize:11,fontWeight:500,padding:'4px 6px 4px 8px',cursor:'pointer'},chipX:{background:'none',border:'none',color:'var(--text-dim)',fontSize:14,padding:'3px 6px 3px 2px',cursor:'pointer'},
  errorBox:{display:'flex',alignItems:'center',gap:10,background:'rgba(255,59,59,0.05)',border:'1px solid rgba(255,59,59,0.2)',borderRadius:4,padding:'10px 16px',fontSize:12,color:'var(--red)',marginBottom:16,fontFamily:"'Roboto Mono',monospace"},
  card:{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:6,overflow:'hidden'},
  closeBtn:{position:'absolute',top:10,right:10,background:'none',border:'1px solid var(--border)',borderRadius:4,color:'var(--text-dim)',fontSize:12,width:28,height:28,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',zIndex:2},
  priceHeader:{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 20px',paddingRight:48,borderBottom:'1px solid var(--border)',background:'var(--th-bg)',flexWrap:'wrap',gap:10},
  tickerBadge:{fontFamily:"'Roboto Mono',monospace",fontSize:14,fontWeight:700,color:'var(--neon)',textShadow:'var(--neon-glow)',letterSpacing:'0.08em'},
  priceMeta:{fontSize:10,color:'var(--text-dim)',letterSpacing:1,textTransform:'uppercase'},priceVal:{fontFamily:"'Roboto Mono',monospace",fontSize:20,fontWeight:700,color:'var(--neon)',textShadow:'var(--neon-glow)'},
  addFavBtn:{background:'none',border:'1px solid var(--neon)',borderRadius:4,color:'var(--neon)',fontSize:10,fontWeight:700,letterSpacing:2,padding:'6px 12px',cursor:'pointer'},inFavBadge:{fontSize:10,fontWeight:700,letterSpacing:2,color:'var(--neon-dim)',fontFamily:"'Roboto Mono',monospace"},
  detailRow:{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 20px',borderBottom:'1px solid rgba(128,128,128,0.1)'},detailLabel:{fontSize:12,color:'var(--text-dim)'},detailValue:{fontFamily:"'Roboto Mono',monospace",fontSize:12,fontWeight:500,color:'var(--text)',textAlign:'right',maxWidth:'55%',wordBreak:'break-word'},detailFooter:{padding:'8px 20px',fontSize:10,color:'var(--text-dim)',textAlign:'right',letterSpacing:1},
  skelRow:{display:'flex',justifyContent:'space-between',padding:'13px 20px',animation:'pulse-neon 1.4s ease infinite'},skelLabel:{width:'25%',height:10,borderRadius:2,background:'var(--border)'},skelVal:{height:10,borderRadius:2,background:'var(--border)'},
  favTitleRow:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6,flexWrap:'wrap',gap:8},favTitle:{fontFamily:"'Roboto',sans-serif",fontWeight:700,fontSize:13,letterSpacing:4,color:'var(--neon)',textShadow:'var(--neon-glow)'},
  toolBtn:{background:'none',border:'1px solid var(--border)',borderRadius:3,color:'var(--text-dim)',fontFamily:"'Roboto Mono',monospace",fontSize:9,fontWeight:500,letterSpacing:1,padding:'5px 10px',cursor:'pointer'},
  refreshBtn:{background:'none',border:'1px solid var(--border)',borderRadius:3,color:'var(--neon-dim)',fontSize:16,padding:'3px 8px',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'},spinnerSm:{display:'inline-block',width:12,height:12,border:'1.5px solid var(--neon-dim)',borderTopColor:'var(--neon)',borderRadius:'50%',animation:'spin 0.6s linear infinite'},
  favMeta:{display:'flex',alignItems:'center',gap:12,fontSize:10,color:'var(--text-dim)',fontFamily:"'Roboto Mono',monospace",letterSpacing:1,marginBottom:12,flexWrap:'wrap'},countdown:{display:'flex',alignItems:'center',gap:4,color:'var(--neon-dim)'},countdownDot:{display:'inline-block',width:5,height:5,borderRadius:'50%',background:'var(--neon)',animation:'pulse-neon 1s ease infinite'},
  tableWrap:{overflowX:'auto',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:6},
  table:{width:'100%',borderCollapse:'collapse',fontFamily:"'Roboto Mono',monospace",fontSize:11,tableLayout:'fixed'},
  th:{padding:'10px 8px',fontFamily:"'Roboto',sans-serif",fontSize:9,fontWeight:700,letterSpacing:1.5,color:'var(--neon)',textTransform:'uppercase',borderBottom:'1px solid var(--border-neon)',background:'var(--th-bg)',whiteSpace:'nowrap',userSelect:'none',cursor:'pointer',textAlign:'center',overflow:'hidden',position:'relative'},
  resizeHandle:{position:'absolute',right:-3,top:4,bottom:4,width:6,borderRadius:3,cursor:'col-resize',background:'transparent',opacity:0,transition:'opacity 0.15s, background 0.15s',zIndex:5},
  thFilter:{padding:'4px 6px',background:'var(--th-bg)',borderBottom:'1px solid var(--border)'},filterInput:{width:'100%',background:'var(--input-bg)',border:'1px solid var(--border)',borderRadius:3,color:'var(--text)',fontFamily:"'Roboto Mono',monospace",fontSize:10,padding:'4px 6px',outline:'none'},
  td:{padding:'8px 8px',borderBottom:'1px solid rgba(128,128,128,0.1)',whiteSpace:'nowrap',fontSize:11,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',textAlign:'center'},
  skelCell:{height:10,borderRadius:2,background:'var(--border)',animation:'pulse-neon 1.4s ease infinite'},tableFoot:{padding:'8px 12px',fontSize:10,color:'var(--text-dim)',letterSpacing:1,textAlign:'right',fontFamily:"'Roboto Mono',monospace"},
  removeFavBtn:{background:'none',border:'none',color:'var(--red-dim)',fontSize:14,cursor:'pointer',lineHeight:1},addCarteraBtn:{background:'none',border:'1px solid var(--neon-dim)',borderRadius:3,color:'var(--neon-dim)',fontSize:12,fontWeight:700,cursor:'pointer',lineHeight:1,padding:'1px 5px'},lawInput:{width:'100%',maxWidth:60,background:'var(--input-bg)',border:'1px solid var(--border)',borderRadius:3,color:'var(--text)',fontFamily:"'Roboto Mono',monospace",fontSize:10,fontWeight:500,padding:'3px 5px',outline:'none',textAlign:'center'},
  copyBtn:{background:'none',border:'1px solid var(--border)',borderRadius:3,color:'var(--text-dim)',fontSize:10,padding:'1px 4px',cursor:'pointer',lineHeight:1,marginLeft:3},
  addBtn:{background:'none',border:'1px solid var(--neon)',borderRadius:4,color:'var(--neon)',fontFamily:"'Roboto Mono',monospace",fontSize:11,fontWeight:700,letterSpacing:2,padding:'8px 18px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:6},
  closeSearchBtn:{position:'absolute',top:8,right:0,background:'none',border:'1px solid var(--border)',borderRadius:4,color:'var(--text-dim)',fontSize:11,width:28,height:28,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',zIndex:2},
  flyerOverlay:{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',zIndex:10000,display:'flex',flexDirection:'column',alignItems:'center',padding:20,overflowY:'auto',backdropFilter:'blur(4px)'},
  flyerControls:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16,gap:12,flexWrap:'wrap'},flyerCheck:{display:'flex',alignItems:'center',color:'var(--text-dim)',fontFamily:"'Roboto Mono',monospace",cursor:'pointer',padding:'2px 6px',background:'rgba(255,255,255,0.05)',borderRadius:3,border:'1px solid var(--border)'},
  flyerBtn:{background:'none',border:'1px solid var(--border)',borderRadius:4,color:'var(--text)',fontFamily:"'Roboto Mono',monospace",fontSize:11,fontWeight:500,padding:'8px 16px',cursor:'pointer',whiteSpace:'nowrap'},
  flyerTh:{padding:'10px 10px',fontFamily:"'Roboto',sans-serif",fontSize:9,fontWeight:700,letterSpacing:2,color:'var(--neon)',textTransform:'uppercase',borderBottom:'1px solid var(--border-neon)',borderRight:'1px solid rgba(128,128,128,0.15)',background:'var(--th-bg)',textAlign:'center'},
  flyerTd:{padding:'9px 10px',borderBottom:'1px solid rgba(128,128,128,0.1)',borderRight:'1px solid rgba(128,128,128,0.1)',textAlign:'center',whiteSpace:'nowrap'},
};

import { useEffect, useRef, useState } from 'react';
import { getCompanyInfo } from './companyData';
import BondFlyerModal from './BondFlyerModal';
function fc(v){return v!=null?`$${Number(v).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'—';}

// Resolver Duration de la respuesta cruda de PPI. PPI a veces devuelve
// `duration` (camelCase), a veces `Duration` (PascalCase, como en algunos
// endpoints), y otras veces directamente no la trae — en ese caso la
// derivamos: Macaulay ≈ MD × (1+TIR). Misma lógica que CarterasPage usa para
// no romper si el campo viene vacío.
export function resolveDuration(bond){
  if(!bond)return null;
  const raw=bond.duration??bond.Duration??bond.macaulayDuration??bond.MacaulayDuration;
  if(raw!=null&&!isNaN(Number(raw)))return Number(raw);
  if(bond.md!=null&&bond.tir!=null)return Number(bond.md)*(1+Number(bond.tir));
  return null;
}

// Resamplear sensibilidad cruda de PPI (variation, price, tir, parity) a una
// grilla uniforme de variaciones de precio en pasos de 1% (-5% a +5%).
// Interpolación lineal entre los puntos contiguos que entrega PPI; si el
// objetivo cae fuera del rango, extrapolamos con la pendiente del segmento más
// cercano. Mantiene la fila ACTUAL (variation=0) explícita.
function resample1pct(raw,range=5){
  if(!Array.isArray(raw)||raw.length<2)return raw||[];
  const pts=raw.filter(p=>p&&p.variation!=null&&p.price!=null).map(p=>({v:Number(p.variation),price:Number(p.price),tir:p.tir!=null?Number(p.tir):null,parity:p.parity!=null?Number(p.parity):null})).sort((a,b)=>a.v-b.v);
  if(pts.length<2)return raw;
  const interp=(target)=>{
    let lo=pts[0],hi=pts[pts.length-1];
    if(target<=pts[0].v){lo=pts[0];hi=pts[1];}
    else if(target>=pts[pts.length-1].v){lo=pts[pts.length-2];hi=pts[pts.length-1];}
    else{for(let i=0;i<pts.length-1;i++){if(pts[i].v<=target&&target<=pts[i+1].v){lo=pts[i];hi=pts[i+1];break;}}}
    const dx=hi.v-lo.v;const t=dx===0?0:(target-lo.v)/dx;
    const lerp=(a,b)=>a==null||b==null?null:a+(b-a)*t;
    return{variation:target,price:lo.price+(hi.price-lo.price)*t,tir:lerp(lo.tir,hi.tir),parity:lerp(lo.parity,hi.parity)};
  };
  const out=[];for(let pct=range;pct>=-range;pct--)out.push(interp(pct/100));
  return out;
}

export default function BondDetailModal({bond,ticker,price,manualLaw,assetType,onClose}){
  const ref=useRef(null);const co=getCompanyInfo(ticker);
  // Flyer secundario (compartible). Se abre desde el botón ✦ FLYER del header.
  // Cuando está abierto, ESC cierra el flyer (no este modal) gracias al z-index
  // mayor en BondFlyerModal — el listener del flyer se monta primero en captura.
  const [flyerOpen,setFlyerOpen]=useState(false);
  useEffect(()=>{const h=e=>{if(e.key==='Escape'&&!flyerOpen)onClose();};document.addEventListener('keydown',h);document.body.style.overflow='hidden';return()=>{document.removeEventListener('keydown',h);document.body.style.overflow='';};},[flyerOpen,onClose]);
  if(!bond)return null;
  const flows=(bond.flows||[]).filter(f=>new Date(f.cuttingDate)>new Date()).slice(0,6);
  const sens=bond.sensitivity||[];
  const displayLaw=manualLaw||bond.law||'—';

  // Resamplear la sensibilidad de PPI a una grilla uniforme de ±5% en pasos
  // de 1%. PPI devuelve scenarios a steps irregulares (ej: ±2.5%, ±5%, ±7.1%);
  // el usuario quiere ver variaciones cerradas de 1%, así que interpolamos
  // linealmente entre puntos contiguos. Más legible que la salida cruda.
  const sens1pct=resample1pct(sens);
  // PPI devuelve sentinels cuando no calcula los campos (pasa con ONs):
  //   parity = -1 → "no aplica"
  //   residualValue = 0 / technicalValue = 0 → idem (un bono sin vencer no
  //   tiene residual 0; lo serían sólo bonos ya amortizados, que no figuran
  //   en estas pantallas). Tratamos esos casos como datos ausentes para no
  //   pintar valores engañosos como "Paridad: -100%".
  const parityClean   =bond.parity!=null&&Number(bond.parity)>-0.99?Number(bond.parity):null;
  const residualClean =bond.residualValue!=null&&Number(bond.residualValue)>0?Number(bond.residualValue):null;
  const technicalClean=bond.technicalValue!=null&&Number(bond.technicalValue)>0?Number(bond.technicalValue):null;
  // Valor residual y técnico llegan por 1 VN — escalamos a 100 VN igual que el flyer.
  const residual100=residualClean!=null?residualClean*100:null;
  const tecnico100 =technicalClean!=null?technicalClean*100:null;
  const duration   =resolveDuration(bond);

  return(<div ref={ref} style={S.overlay} onClick={e=>e.target===ref.current&&onClose()}>
    <div style={S.modal}>
      <div style={S.header}><div style={{display:'flex',alignItems:'center',gap:12}}><div style={{...S.logo,background:co.color}}>{co.short}</div><div><div style={S.ticker}>{ticker}</div><div style={S.company}>{bond.issuer||co.name}</div></div></div><div style={{display:'flex',alignItems:'center',gap:8}}><button style={S.flyerBtn} onClick={()=>setFlyerOpen(true)} title="Generar flyer compartible">✦ FLYER</button><button style={S.closeBtn} onClick={onClose}>✕</button></div></div>
      <div style={S.metrics}><M l="PRECIO" v={fc(price)} hl/><M l="TIR" v={bond.tir!=null?`${(bond.tir*100).toFixed(1)}%`:'—'} hl/><M l="MD" v={bond.md!=null?bond.md.toFixed(1):'—'}/><M l="PARIDAD" v={parityClean!=null?`${(parityClean*100).toFixed(1)}%`:'—'}/></div>
      <div style={S.body}>
        <Sec t="INFORMACIÓN DEL TÍTULO"><div style={S.grid}><R l="Emisor" v={bond.issuer}/><R l="ISIN" v={bond.isin}/><R l="Moneda emisión" v={bond.issueCurrency}/><R l="Moneda pago" v={bond.abbreviationCurrencyPay}/><R l="Fecha emisión" v={bond.issueDate}/><R l="Vencimiento" v={bond.expirationDate}/><R l="Ley" v={displayLaw}/><R l="Lámina mínima" v={bond.minimalSheet}/><R l="Cupón" v={bond.interests}/><R l="Amortización" v={bond.amortization}/><R l="Duration" v={duration!=null?duration.toFixed(1):null}/><R l="Valor residual" v={residual100!=null?residual100.toFixed(1):null}/><R l="Valor técnico" v={tecnico100!=null?fc(tecnico100):null}/></div></Sec>
        {bond.amountToInvest!=null&&<Sec t="RESUMEN DE INVERSIÓN (100 PAPELES)"><div style={S.grid}><R l="Monto a invertir" v={fc(bond.amountToInvest)}/><R l="Monto a recibir" v={fc(bond.amountToReceive)}/><R l="Renta total" v={fc(bond.totalRevenue)}/><R l="Amort. total" v={fc(bond.totalAmortization)}/><R l="Intereses devengados" v={fc(bond.interestAccrued)}/><R l="Cupón corriente" v={bond.currentCoupon}/></div></Sec>}
        {flows.length>0&&<Sec t="PRÓXIMOS FLUJOS DE FONDOS"><table style={S.ft}><thead><tr><th style={S.fth}>Fecha</th><th style={{...S.fth,textAlign:'right'}}>Renta</th><th style={{...S.fth,textAlign:'right'}}>Amort.</th><th style={{...S.fth,textAlign:'right'}}>Total</th></tr></thead><tbody>{flows.map((f,i)=><tr key={i} style={{background:i%2===0?'var(--row-alt)':'transparent'}}><td style={S.ftd}>{new Date(f.cuttingDate).toLocaleDateString('es-AR')}</td><td style={{...S.ftd,textAlign:'right',color:'var(--neon)'}}>{fc(f.rent)}</td><td style={{...S.ftd,textAlign:'right'}}>{fc(f.amortization)}</td><td style={{...S.ftd,textAlign:'right',fontWeight:700,color:'var(--neon)'}}>{fc(f.total)}</td></tr>)}</tbody></table></Sec>}
        {sens1pct.length>0&&<Sec t="SENSIBILIDAD — VARIACIÓN DE RENDIMIENTO POR PRECIO"><table style={S.ft}><thead><tr><th style={S.fth}>Var. Precio</th><th style={{...S.fth,textAlign:'right'}}>Precio</th><th style={{...S.fth,textAlign:'right'}}>TIR</th><th style={{...S.fth,textAlign:'right'}}>Paridad</th></tr></thead><tbody>{sens1pct.map((s,i)=>{const vp=s.variation!=null?s.variation*100:null;const cur=Math.abs(vp||0)<0.01;return(<tr key={i} style={{background:cur?'var(--row-hover)':i%2===0?'var(--row-alt)':'transparent'}}><td style={{...S.ftd,color:vp>0?'var(--neon)':vp<0?'var(--red)':'var(--text)',fontWeight:cur?700:400}}>{cur?'► ACTUAL':vp!=null?`${vp>0?'+':''}${vp.toFixed(0)}%`:'—'}</td><td style={{...S.ftd,textAlign:'right',fontWeight:cur?700:400}}>{fc(s.price)}</td><td style={{...S.ftd,textAlign:'right',color:'var(--neon)',fontWeight:700}}>{s.tir!=null?`${(s.tir*100).toFixed(1)}%`:'—'}</td><td style={{...S.ftd,textAlign:'right'}}>{s.parity!=null&&s.parity>0&&s.parity>-0.99?`${(s.parity*100).toFixed(1)}%`:'—'}</td></tr>);})}</tbody></table></Sec>}
      </div>
    </div>
    {flyerOpen&&<BondFlyerModal bond={bond} ticker={ticker} price={price} manualLaw={displayLaw} assetType={assetType} onClose={()=>setFlyerOpen(false)}/>}
  </div>);
}
function M({l,v,hl}){return<div style={S.met}><div style={S.metL}>{l}</div><div style={{...S.metV,color:hl?'var(--neon)':'var(--text)'}}>{v}</div></div>;}
function Sec({t,children}){return<div style={S.sec}><div style={S.secT}>{t}</div>{children}</div>;}
function R({l,v}){return<div style={S.row}><span style={S.rowL}>{l}</span><span style={S.rowV}>{v!=null&&v!==''?String(v):'—'}</span></div>;}
const S={
  // overlay: bloquea scroll de fondo (overflow:hidden) — el scroll vive dentro
  // del modal, no del overlay. Antes el overlay scrolleaba y se veía la tabla
  // detrás cuando el contenido del bono era largo.
  overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center',padding:'24px 20px',overflow:'hidden',backdropFilter:'blur(4px)'},
  // modal: flex column con maxHeight=viewport para que header/metrics queden
  // pegados arriba y solo el body interno scrollee. boxSizing border-box para
  // que el padding del overlay no haga overflow.
  modal:{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:12,width:'100%',maxWidth:700,maxHeight:'calc(100vh - 48px)',fontFamily:"'Roboto',sans-serif",boxShadow:'0 20px 60px rgba(0,0,0,0.5)',display:'flex',flexDirection:'column',overflow:'hidden'},
  header:{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'20px 24px',borderBottom:'1px solid var(--border)',background:'var(--th-bg)',flexShrink:0},
  // Cuerpo scrolleable — todo lo que va debajo de header + metrics.
  body:{flex:1,overflowY:'auto',minHeight:0},
  logo:{width:42,height:42,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:10,fontWeight:700,flexShrink:0},
  ticker:{fontFamily:"'Roboto Mono',monospace",fontSize:18,fontWeight:700,color:'var(--neon)',textShadow:'var(--neon-glow)',letterSpacing:'0.08em'},company:{fontSize:12,color:'var(--text-dim)',marginTop:2},
  closeBtn:{background:'none',border:'1px solid var(--border)',borderRadius:6,color:'var(--text-dim)',fontSize:14,width:34,height:34,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'},
  flyerBtn:{background:'transparent',border:'1px solid var(--neon)',borderRadius:6,color:'var(--neon)',fontFamily:"'Roboto',sans-serif",fontSize:10,fontWeight:700,letterSpacing:2,padding:'8px 14px',cursor:'pointer',textShadow:'var(--neon-glow)'},
  metrics:{display:'flex',borderBottom:'1px solid var(--border)',flexShrink:0},met:{flex:1,padding:'16px 12px',textAlign:'center',borderRight:'1px solid var(--border)'},metL:{fontSize:9,fontWeight:700,letterSpacing:2,color:'var(--text-dim)',marginBottom:6},metV:{fontFamily:"'Roboto Mono',monospace",fontSize:17,fontWeight:700},
  sec:{padding:'20px 24px',borderBottom:'1px solid var(--border)'},secT:{fontSize:10,fontWeight:700,letterSpacing:3,color:'var(--neon)',marginBottom:14,textTransform:'uppercase'},
  grid:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 32px'},row:{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'7px 0',borderBottom:'1px solid rgba(128,128,128,0.08)',gap:12},rowL:{fontSize:12,color:'var(--text-dim)',flexShrink:0},rowV:{fontSize:12,color:'var(--text)',fontFamily:"'Roboto Mono',monospace",fontWeight:500,textAlign:'right',wordBreak:'break-word'},
  ft:{width:'100%',borderCollapse:'collapse'},fth:{padding:'8px 8px',fontSize:9,fontWeight:700,letterSpacing:2,color:'var(--neon)',textTransform:'uppercase',borderBottom:'1px solid var(--border-neon)',textAlign:'left'},ftd:{padding:'8px 8px',fontSize:12,fontFamily:"'Roboto Mono',monospace",borderBottom:'1px solid rgba(128,128,128,0.08)',color:'var(--text)'},
};

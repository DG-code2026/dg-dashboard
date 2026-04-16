import { useEffect, useRef } from 'react';
import { getCompanyInfo } from './companyData';
function fc(v){return v!=null?`$${Number(v).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'—';}

export default function BondDetailModal({bond,ticker,price,manualLaw,onClose}){
  const ref=useRef(null);const co=getCompanyInfo(ticker);
  useEffect(()=>{const h=e=>{if(e.key==='Escape')onClose();};document.addEventListener('keydown',h);document.body.style.overflow='hidden';return()=>{document.removeEventListener('keydown',h);document.body.style.overflow='';};});
  if(!bond)return null;
  const flows=(bond.flows||[]).filter(f=>new Date(f.cuttingDate)>new Date()).slice(0,6);
  const sens=bond.sensitivity||[];
  const displayLaw=manualLaw||bond.law||'—';

  return(<div ref={ref} style={S.overlay} onClick={e=>e.target===ref.current&&onClose()}>
    <div style={S.modal}>
      <div style={S.header}><div style={{display:'flex',alignItems:'center',gap:12}}><div style={{...S.logo,background:co.color}}>{co.short}</div><div><div style={S.ticker}>{ticker}</div><div style={S.company}>{bond.issuer||co.name}</div></div></div><button style={S.closeBtn} onClick={onClose}>✕</button></div>
      <div style={S.metrics}><M l="PRECIO" v={fc(price)} hl/><M l="TIR" v={bond.tir!=null?`${(bond.tir*100).toFixed(2)}%`:'—'} hl/><M l="MD" v={bond.md!=null?bond.md.toFixed(4):'—'}/><M l="PARIDAD" v={bond.parity!=null?`${(bond.parity*100).toFixed(2)}%`:'—'}/></div>
      <div>
        <Sec t="INFORMACIÓN DEL TÍTULO"><div style={S.grid}><R l="Emisor" v={bond.issuer}/><R l="ISIN" v={bond.isin}/><R l="Moneda emisión" v={bond.issueCurrency}/><R l="Moneda pago" v={bond.abbreviationCurrencyPay}/><R l="Fecha emisión" v={bond.issueDate}/><R l="Vencimiento" v={bond.expirationDate}/><R l="Ley" v={displayLaw}/><R l="Lámina mínima" v={bond.minimalSheet}/><R l="Cupón" v={bond.interests}/><R l="Amortización" v={bond.amortization}/><R l="Valor residual" v={bond.residualValue}/><R l="Valor técnico" v={bond.technicalValue!=null?fc(bond.technicalValue):null}/></div></Sec>
        {bond.amountToInvest!=null&&<Sec t="RESUMEN DE INVERSIÓN (100 PAPELES)"><div style={S.grid}><R l="Monto a invertir" v={fc(bond.amountToInvest)}/><R l="Monto a recibir" v={fc(bond.amountToReceive)}/><R l="Renta total" v={fc(bond.totalRevenue)}/><R l="Amort. total" v={fc(bond.totalAmortization)}/><R l="Intereses devengados" v={fc(bond.interestAccrued)}/><R l="Cupón corriente" v={bond.currentCoupon}/></div></Sec>}
        {flows.length>0&&<Sec t="PRÓXIMOS FLUJOS DE FONDOS"><table style={S.ft}><thead><tr><th style={S.fth}>Fecha</th><th style={{...S.fth,textAlign:'right'}}>Renta</th><th style={{...S.fth,textAlign:'right'}}>Amort.</th><th style={{...S.fth,textAlign:'right'}}>Total</th></tr></thead><tbody>{flows.map((f,i)=><tr key={i} style={{background:i%2===0?'var(--row-alt)':'transparent'}}><td style={S.ftd}>{new Date(f.cuttingDate).toLocaleDateString('es-AR')}</td><td style={{...S.ftd,textAlign:'right',color:'var(--neon)'}}>{fc(f.rent)}</td><td style={{...S.ftd,textAlign:'right'}}>{fc(f.amortization)}</td><td style={{...S.ftd,textAlign:'right',fontWeight:700,color:'var(--neon)'}}>{fc(f.total)}</td></tr>)}</tbody></table></Sec>}
        {sens.length>0&&<Sec t="SENSIBILIDAD — VARIACIÓN DE RENDIMIENTO POR PRECIO"><table style={S.ft}><thead><tr><th style={S.fth}>Var. Precio</th><th style={{...S.fth,textAlign:'right'}}>Precio</th><th style={{...S.fth,textAlign:'right'}}>TIR</th><th style={{...S.fth,textAlign:'right'}}>Paridad</th></tr></thead><tbody>{sens.slice(0,9).map((s,i)=>{const vp=s.variation!=null?s.variation*100:null;const cur=Math.abs(vp||0)<0.01;return(<tr key={i} style={{background:cur?'var(--row-hover)':i%2===0?'var(--row-alt)':'transparent'}}><td style={{...S.ftd,color:vp>0?'var(--neon)':vp<0?'var(--red)':'var(--text)',fontWeight:cur?700:400}}>{cur?'► ACTUAL':vp!=null?`${vp>0?'+':''}${vp.toFixed(1)}%`:'—'}</td><td style={{...S.ftd,textAlign:'right',fontWeight:cur?700:400}}>{fc(s.price)}</td><td style={{...S.ftd,textAlign:'right',color:'var(--neon)',fontWeight:700}}>{s.tir!=null?`${(s.tir*100).toFixed(2)}%`:'—'}</td><td style={{...S.ftd,textAlign:'right'}}>{s.parity!=null?`${(s.parity*100).toFixed(2)}%`:'—'}</td></tr>);})}</tbody></table></Sec>}
      </div>
    </div>
  </div>);
}
function M({l,v,hl}){return<div style={S.met}><div style={S.metL}>{l}</div><div style={{...S.metV,color:hl?'var(--neon)':'var(--text)'}}>{v}</div></div>;}
function Sec({t,children}){return<div style={S.sec}><div style={S.secT}>{t}</div>{children}</div>;}
function R({l,v}){return<div style={S.row}><span style={S.rowL}>{l}</span><span style={S.rowV}>{v!=null&&v!==''?String(v):'—'}</span></div>;}
const S={
  overlay:{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:10000,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 20px',overflowY:'auto',backdropFilter:'blur(4px)'},
  modal:{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:12,width:'100%',maxWidth:700,fontFamily:"'Roboto',sans-serif",boxShadow:'0 20px 60px rgba(0,0,0,0.5)'},
  header:{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'20px 24px',borderBottom:'1px solid var(--border)',background:'var(--th-bg)'},
  logo:{width:42,height:42,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:10,fontWeight:700,flexShrink:0},
  ticker:{fontFamily:"'Roboto Mono',monospace",fontSize:18,fontWeight:700,color:'var(--neon)',textShadow:'var(--neon-glow)',letterSpacing:'0.08em'},company:{fontSize:12,color:'var(--text-dim)',marginTop:2},
  closeBtn:{background:'none',border:'1px solid var(--border)',borderRadius:6,color:'var(--text-dim)',fontSize:14,width:34,height:34,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'},
  metrics:{display:'flex',borderBottom:'1px solid var(--border)'},met:{flex:1,padding:'16px 12px',textAlign:'center',borderRight:'1px solid var(--border)'},metL:{fontSize:9,fontWeight:700,letterSpacing:2,color:'var(--text-dim)',marginBottom:6},metV:{fontFamily:"'Roboto Mono',monospace",fontSize:17,fontWeight:700},
  sec:{padding:'20px 24px',borderBottom:'1px solid var(--border)'},secT:{fontSize:10,fontWeight:700,letterSpacing:3,color:'var(--neon)',marginBottom:14,textTransform:'uppercase'},
  grid:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 32px'},row:{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'7px 0',borderBottom:'1px solid rgba(128,128,128,0.08)',gap:12},rowL:{fontSize:12,color:'var(--text-dim)',flexShrink:0},rowV:{fontSize:12,color:'var(--text)',fontFamily:"'Roboto Mono',monospace",fontWeight:500,textAlign:'right',wordBreak:'break-word'},
  ft:{width:'100%',borderCollapse:'collapse'},fth:{padding:'8px 8px',fontSize:9,fontWeight:700,letterSpacing:2,color:'var(--neon)',textTransform:'uppercase',borderBottom:'1px solid var(--border-neon)',textAlign:'left'},ftd:{padding:'8px 8px',fontSize:12,fontFamily:"'Roboto Mono',monospace",borderBottom:'1px solid rgba(128,128,128,0.08)',color:'var(--text)'},
};

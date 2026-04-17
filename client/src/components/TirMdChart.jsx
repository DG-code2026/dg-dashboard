import { useState, useRef, useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Label, LabelList } from 'recharts';
import { getCompanyInfo } from './companyData';

function CustomTooltip({active,payload}){
  if(!active||!payload?.length)return null;const d=payload[0]?.payload;if(!d)return null;const co=getCompanyInfo(d.ticker);
  return(<div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:6,padding:'10px 14px',fontFamily:"'Roboto Mono',monospace",fontSize:11,boxShadow:'0 8px 24px rgba(0,0,0,0.3)',maxWidth:220}}>
    <div style={{fontWeight:700,color:'var(--neon)',fontSize:13,marginBottom:4}}>{d.ticker}</div>
    <div style={{color:'var(--text-dim)',marginBottom:6}}>{co.name}</div>
    <div style={{color:'var(--text)'}}>Vencimiento: <b>{d.expirationDate||'—'}</b></div>
    <div style={{color:'var(--text)'}}>Cupón: <b>{d.coupon||'—'}</b></div>
    <div style={{color:'var(--neon)',marginTop:4}}>TIR: <b>{d.tirPct}%</b> · MD: <b>{d.mdVal}</b></div>
  </div>);
}

function TickerLabel(props){const{x,y,value}=props;if(x==null||y==null)return null;return<text x={x} y={y-12} textAnchor="middle" fill="var(--neon)" fontSize={9} fontWeight={700} fontFamily="'Roboto Mono',monospace" style={{pointerEvents:'none'}}>{value}</text>;}

function logReg(pts){
  // Logarithmic regression: y = a + b * ln(x)
  const n=pts.length;if(n<2)return null;
  let slnx=0,sy=0,slnx2=0,slnxy=0;
  for(const p of pts){if(p.x<=0)continue;const lx=Math.log(p.x);slnx+=lx;sy+=p.y;slnx2+=lx*lx;slnxy+=lx*p.y;}
  const d=n*slnx2-slnx*slnx;if(Math.abs(d)<1e-10)return null;
  const b=(n*slnxy-slnx*sy)/d;const a=(sy-b*slnx)/n;
  return{a,b,fn:x=>a+b*Math.log(x)};
}

export default function TirMdChart({data}){
  const chartRef=useRef(null);const[showGrid,setShowGrid]=useState(true);const[dl,setDl]=useState(false);

  const chartData=useMemo(()=>data.filter(d=>d.tir!=null&&d.md!=null).map(d=>({...d,tirPct:+(d.tir*100).toFixed(2),mdVal:+d.md.toFixed(2)})),[data]);

  const{mdDomain,mdTicks,tirDomain,tirTicks}=useMemo(()=>{
    if(!chartData.length)return{mdDomain:[0,12],mdTicks:[1,2,3,4,5,6,7,8,9,10,11,12],tirDomain:[0,12],tirTicks:[1,2,3,4,5,6,7,8,9,10,11,12]};
    const mds=chartData.map(d=>d.mdVal);const tirs=chartData.map(d=>d.tirPct);
    const mdLo=Math.max(0,Math.floor(Math.min(...mds))-1);const mdHi=Math.ceil(Math.max(...mds))+1;
    const tirLo=Math.max(0,Math.floor(Math.min(...tirs))-1);const tirHi=Math.ceil(Math.max(...tirs))+1;
    const mkTicks=(lo,hi)=>{const n=hi-lo;const step=n<=14?1:n<=28?2:Math.ceil(n/14);const t=[];for(let v=Math.ceil(lo/step)*step;v<=hi;v+=step)t.push(v);return t;};
    return{mdDomain:[mdLo,mdHi],mdTicks:mkTicks(mdLo,mdHi),tirDomain:[tirLo,tirHi],tirTicks:mkTicks(tirLo,tirHi)};
  },[chartData]);

  // Sampled points along the logarithmic regression, rendered via a Scatter with line=true so Recharts applies the axis scales.
  const trendData=useMemo(()=>{
    if(chartData.length<2)return[];
    const reg=logReg(chartData.map(d=>({x:d.mdVal,y:d.tirPct})));
    if(!reg)return[];
    const xs=chartData.map(d=>d.mdVal);
    const minX=Math.max(0.1,Math.min(...xs)-0.3);const maxX=Math.max(...xs)+0.3;
    const steps=60;const out=[];
    for(let i=0;i<=steps;i++){
      const x=minX+(maxX-minX)*(i/steps);
      out.push({mdVal:+x.toFixed(3),tirPct:+reg.fn(x).toFixed(3)});
    }
    return out;
  },[chartData]);

  const cap=async a=>{setDl(true);try{if(!window.html2canvas)await new Promise((r,j)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';s.onload=()=>r();s.onerror=()=>j();document.head.appendChild(s);});const canvas=await window.html2canvas(chartRef.current,{backgroundColor:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()||'#0a0a0a',scale:2,useCORS:true,logging:false});if(a==='download'){const l=document.createElement('a');l.download=`curva-rendimientos-${new Date().toISOString().slice(0,10)}.png`;l.href=canvas.toDataURL('image/png');l.click();}else canvas.toBlob(b=>{if(b)navigator.clipboard.write([new ClipboardItem({'image/png':b})]);});}catch(e){alert(e.message);}finally{setDl(false);}};

  const renderDot=(props)=>{const{cx,cy}=props;return<circle cx={cx} cy={cy} r={5} fill="var(--neon)" fillOpacity={0.85} stroke="var(--neon)" strokeWidth={1}/>;};

  if(!chartData.length)return(<div style={S.container}><div style={S.header}><h3 style={S.title}>CURVA DE RENDIMIENTOS</h3></div><div style={{padding:40,textAlign:'center',color:'var(--text-dim)',fontSize:12}}>No hay datos suficientes</div></div>);

  return(
    <div style={S.container}>
      <div style={S.header}>
        <h3 style={S.title}>CURVA DE RENDIMIENTOS</h3>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <label style={S.ctrl}><input type="checkbox" checked={showGrid} onChange={()=>setShowGrid(!showGrid)} style={{marginRight:4}}/><span style={S.ctrlLabel}>Grilla</span></label>
          <button style={S.btn} onClick={()=>cap('download')} disabled={dl} title="Descargar">⬇</button>
          <button style={S.btn} onClick={()=>cap('copy')} disabled={dl} title="Copiar">📋</button>
        </div>
      </div>
      <div ref={chartRef} style={S.chartWrap}>
        <ResponsiveContainer width="100%" height={460}>
          <ScatterChart margin={{top:35,right:30,bottom:25,left:20}}>
            {showGrid&&<CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>}
            <XAxis type="number" dataKey="mdVal" name="MD" domain={mdDomain} ticks={mdTicks} allowDecimals={false} tickFormatter={v=>String(Math.round(v))} tick={{fill:'var(--text-dim)',fontSize:10}} tickLine={{stroke:'var(--border)'}} axisLine={{stroke:'var(--border)'}}>
              <Label value="Modified Duration (años)" offset={-10} position="insideBottom" style={{fill:'var(--text-dim)',fontSize:10,letterSpacing:1}}/>
            </XAxis>
            <YAxis type="number" dataKey="tirPct" name="TIR" domain={tirDomain} ticks={tirTicks} allowDecimals={false} tickFormatter={v=>`${Math.round(v)}%`} tick={{fill:'var(--text-dim)',fontSize:10}} tickLine={{stroke:'var(--border)'}} axisLine={{stroke:'var(--border)'}}>
              <Label value="TIR (%)" angle={-90} position="insideLeft" style={{fill:'var(--text-dim)',fontSize:10,letterSpacing:1}}/>
            </YAxis>
            <Tooltip content={<CustomTooltip/>} cursor={false}/>
            {trendData.length>1&&(
              <Scatter data={trendData} line={{stroke:'#ff7ac6',strokeWidth:2.5,strokeDasharray:'6 4'}} shape={()=>null} isAnimationActive={false} legendType="none"/>
            )}
            <Scatter data={chartData} shape={renderDot} isAnimationActive={false}>
              <LabelList dataKey="ticker" content={<TickerLabel/>}/>
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <div style={S.chartFooter}>
          <span>{chartData.length} papeles · tendencia log. · {new Date().toLocaleDateString('es-AR',{day:'2-digit',month:'long',year:'numeric'})}</span>
          <span>Fuente: PPI · API REST · A-24HS</span>
        </div>
      </div>
    </div>
  );
}

const S={
  container:{marginTop:32,borderRadius:8,border:'1px solid var(--border)',background:'var(--bg-card)',overflow:'hidden'},
  header:{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 20px',borderBottom:'1px solid var(--border)',flexWrap:'wrap',gap:8},
  title:{fontFamily:"'Roboto',sans-serif",fontWeight:700,fontSize:12,letterSpacing:4,color:'var(--neon)',textShadow:'var(--neon-glow)'},
  ctrl:{display:'flex',alignItems:'center',gap:2,color:'var(--text-dim)'},ctrlLabel:{fontFamily:"'Roboto Mono',monospace",fontSize:9,letterSpacing:1},
  btn:{background:'none',border:'1px solid var(--border)',borderRadius:3,color:'var(--text-dim)',fontSize:12,padding:'4px 8px',cursor:'pointer'},
  chartWrap:{padding:'16px'},
  chartFooter:{display:'flex',justifyContent:'space-between',fontFamily:"'Roboto Mono',monospace",fontSize:9,color:'var(--text-dim)',letterSpacing:1,marginTop:8,padding:'0 4px'},
};

const D={
  YMCJD:{name:'YPF',short:'YPF',color:'#0072CE'},YMCXD:{name:'YPF',short:'YPF',color:'#0072CE'},YM34D:{name:'YPF',short:'YPF',color:'#0072CE'},
  PN35D:{name:'Pan American Energy',short:'PAE',color:'#E31937'},PN41D:{name:'Pan American Energy',short:'PAE',color:'#E31937'},PN43D:{name:'Pan American Energy',short:'PAE',color:'#E31937'},
  IRCPD:{name:'IRSA',short:'IRSA',color:'#1B3C73'},MGCOD:{name:'Pampa Energía',short:'PAMP',color:'#00A651'},MGCRD:{name:'Pampa Energía',short:'PAMP',color:'#00A651'},
  NPCCD:{name:'Central Puerto',short:'CEPU',color:'#F7941D'},PLC2D:{name:'Pluspetrol',short:'PLP',color:'#8B0000'},
  TLCOD:{name:'Telecom',short:'TECO',color:'#00AEEF'},TLCPD:{name:'Telecom',short:'TECO',color:'#00AEEF'},
  TSC3D:{name:'TGS',short:'TGS',color:'#003DA5'},TSC4D:{name:'TGS',short:'TGS',color:'#003DA5'},
  TTC9D:{name:'Tecpetrol',short:'TECP',color:'#ED1C24'},VSCRD:{name:'Vista Oil & Gas',short:'VIST',color:'#2D2D2D'},VSCTD:{name:'Vista Oil & Gas',short:'VIST',color:'#2D2D2D'},
  ARC1D:{name:'AA2000',short:'AA20',color:'#6B2D8B'},
  // Soberanos
  AL29D:{name:'Argentina',short:'AL29',color:'#1B5E20'},AL30D:{name:'Argentina',short:'AL30',color:'#1B5E20'},
  AL35D:{name:'Argentina',short:'AL35',color:'#1B5E20'},AL41D:{name:'Argentina',short:'AL41',color:'#1B5E20'},
  AE38D:{name:'Argentina',short:'AE38',color:'#1B5E20'},
  GD29D:{name:'Argentina',short:'GD29',color:'#0D47A1'},GD30D:{name:'Argentina',short:'GD30',color:'#0D47A1'},
  GD35D:{name:'Argentina',short:'GD35',color:'#0D47A1'},GD38D:{name:'Argentina',short:'GD38',color:'#0D47A1'},
  GD41D:{name:'Argentina',short:'GD41',color:'#0D47A1'},GD46D:{name:'Argentina',short:'GD46',color:'#0D47A1'},
  AO27D:{name:'Argentina',short:'AO27',color:'#2E7D32'},AO28D:{name:'Argentina',short:'AO28',color:'#2E7D32'},
};
function hashColor(s){let h=0;for(let i=0;i<s.length;i++)h=s.charCodeAt(i)+((h<<5)-h);return`hsl(${Math.abs(h)%360},55%,40%)`;}
export function getCompanyInfo(t){return D[t]||{name:t,short:t?t.replace(/\d+[A-Z]?$/,'').slice(0,4)||t.slice(0,4):'?',color:hashColor(t||'')};}
export default D;

import { useState, useEffect, useCallback } from "react";

// ─── Persistência local ───────────────────────────────────────────────────────
const loadCol = () => { try { return JSON.parse(localStorage.getItem("germ_col")||"[]"); } catch { return []; } };
const saveCol = col => { try { localStorage.setItem("germ_col", JSON.stringify(col)); } catch {} };

// ─── 18 Alas temáticas ────────────────────────────────────────────────────────
const ALAS = [
  { id:"retratos",     name:"Retratos",            icon:"👤", color:"#8B7355", desc:"Expressão humana no rosto — do Renascimento à modernidade",       hint:"portrait face expression" },
  { id:"pessoas_reais",name:"Pessoas Reais",        icon:"🧑", color:"#6B8E6B", desc:"Indivíduos identificáveis — reis, nobres, figuras históricas",    hint:"real person historical figure identified" },
  { id:"cidades",      name:"Cidades Reais",        icon:"🏙", color:"#5B7FA6", desc:"Vistas urbanas de cidades identificáveis do mundo",               hint:"cityscape urban view known city" },
  { id:"historico",    name:"Momentos Históricos",  icon:"⚔️", color:"#8B4A4A", desc:"Batalhas, eventos políticos e cenas históricas documentadas",     hint:"historical event battle political scene" },
  { id:"objetos",      name:"Objetos",              icon:"🏺", color:"#A08B5B", desc:"Still life, naturezas-mortas, composições de objetos",            hint:"still life objects vanitas composition" },
  { id:"lugares",      name:"Lugares Conhecidos",   icon:"🗺", color:"#5B8B8B", desc:"Monumentos e paisagens reconhecíveis do mundo inteiro",           hint:"landmark known place monument famous location" },
  { id:"natureza",     name:"Natureza",             icon:"🌿", color:"#5B8B5B", desc:"Paisagens naturais, fauna, flora, campos e mares",               hint:"nature landscape flora fauna countryside sea" },
  { id:"familiar",     name:"Ambiente Familiar",    icon:"🏠", color:"#9B7B5B", desc:"Cenas domésticas, interiores, vida cotidiana e família",          hint:"domestic interior family everyday life home" },
  { id:"nudes",        name:"Nudes Feminina",       icon:"🎨", color:"#9B7B7B", desc:"Arte clássica do nu feminino — da Antiguidade ao século XX",      hint:"female nude classical Venus goddess" },
  { id:"esoterico",    name:"Esoterismo",           icon:"🔮", color:"#7B5B9B", desc:"Simbolismo, alquimia, misticismo e arte esotérica",              hint:"esoteric mysticism symbolism alchemy occult" },
  { id:"sacro",        name:"Sacro",                icon:"✝️", color:"#9B8B5B", desc:"Arte religiosa, iconografia cristã, budista e outras tradições",  hint:"sacred religious icon devotional spiritual" },
  { id:"arquitetura",  name:"Arquitetura",          icon:"🏛", color:"#6B7B8B", desc:"Representações de edifícios, ruínas e espaços arquitetônicos",    hint:"architecture building ruins interior column" },
  { id:"povo",         name:"Pessoas do Povo",      icon:"🧑‍🤝‍🧑", color:"#8B7B5B", desc:"Camponeses, trabalhadores, cenas populares e vida simples",    hint:"peasant worker common people folk everyday" },
  { id:"perspectiva",  name:"Perspectiva",          icon:"📐", color:"#5B6B8B", desc:"Obras que exploram a profundidade e a perspectiva",               hint:"perspective depth optical illusion foreshortening" },
  { id:"luz_sol",      name:"Luz do Sol",           icon:"☀️", color:"#A08B3B", desc:"Obras onde a luz natural é protagonista — aurora, entardecer",    hint:"sunlight natural light dawn sunset luminism" },
  { id:"cores",        name:"Cores",                icon:"🌈", color:"#7B5B9B", desc:"Obras centradas no uso expressivo da cor como linguagem principal", hint:"color chromatic fauvism expressionism vibrant" },
  { id:"fase",         name:"Fase do Artista",      icon:"🖌️", color:"#5B8B7B", desc:"Explore um período específico na carreira de um artista",         hint:"artist period early work mature late style" },
  { id:"femininas",    name:"Artistas Femininas",   icon:"👩‍🎨", color:"#9B5B8B", desc:"Obras de grandes artistas mulheres — de Artemisia a Frida Kahlo", hint:"female artist woman painter Georgia O'Keeffe Frida Kahlo Mary Cassatt" },
];

// ─── Fase da Lua ─────────────────────────────────────────────────────────────
function getMoonPhase() {
  const now = new Date();
  const ref = new Date("2000-01-06T18:14:00Z");
  const cycle = 29.53058867;
  const age = (((now - ref) / 86400000) % cycle + cycle) % cycle;
  const idx = Math.floor((age / cycle) * 8) % 8;
  const phases = [
    { emoji:"🌑", name:"Lua Nova" }, { emoji:"🌒", name:"Lua Crescente" },
    { emoji:"🌓", name:"Quarto Crescente" }, { emoji:"🌔", name:"Crescente Gibosa" },
    { emoji:"🌕", name:"Lua Cheia" }, { emoji:"🌖", name:"Minguante Gibosa" },
    { emoji:"🌗", name:"Quarto Minguante" }, { emoji:"🌘", name:"Lua Minguante" },
  ];
  return { ...phases[idx], age: Math.round(age) };
}

// ─── Temperatura (Open-Meteo, gratuita) ──────────────────────────────────────
async function getWeather() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude: lat, longitude: lon } }) => {
        try {
          const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current_weather=true&timezone=auto`);
          const d = await r.json();
          const cw = d.current_weather;
          let city = "";
          try {
            const gr = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
            const gd = await gr.json();
            city = gd.address?.city || gd.address?.town || gd.address?.village || "";
          } catch {}
          const code = cw?.weathercode ?? 0;
          const icon = code===0?"☀️":code<=3?"🌤":code<=49?"🌫":code<=69?"🌧":code<=79?"🌨":"⛈";
          resolve({ temp: Math.round(cw?.temperature ?? 0), icon, city });
        } catch { resolve(null); }
      }, () => resolve(null), { timeout: 6000, maximumAge: 300000 }
    );
  });
}

// ─── Busca via backend ────────────────────────────────────────────────────────
async function searchArt(query, ala, fromYear, toYear) {
  const p = new URLSearchParams({ q: query });
  if (ala)      { p.append("ala", ala.name); p.append("alaHint", ala.hint||""); }
  if (fromYear) p.append("fromYear", fromYear);
  if (toYear)   p.append("toYear", toYear);
  const res = await fetch(`/api/search?${p}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return (data.results || []).map((o, i) => ({
    ...o,
    id: o.id || `art_${Date.now()}_${i}`,
    source: o.source || "api",
  }));
}

// ─── Componentes ─────────────────────────────────────────────────────────────
function AmbientBar() {
  const [moon, setMoon]       = useState(null);
  const [weather, setWeather] = useState(null);
  const [wLoading, setWL]     = useState(true);
  useEffect(() => {
    setMoon(getMoonPhase());
    getWeather().then(w => { setWeather(w); setWL(false); });
  }, []);
  const t = { fontSize:10.5, color:"#888", fontFamily:"Verdana,sans-serif", letterSpacing:.5 };
  return (
    <div style={{ background:"#fafafa", borderBottom:"1px solid #f0f0f0", padding:"6px 40px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        {moon && <><span style={{ fontSize:14 }}>{moon.emoji}</span><span style={t}>{moon.name}</span><span style={{...t,color:"#ccc"}}>·</span><span style={{...t,color:"#bbb"}}>dia {moon.age}</span></>}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        {wLoading && <span style={{...t,color:"#ddd"}}>localizando...</span>}
        {!wLoading && weather && <><span style={{ fontSize:14 }}>{weather.icon}</span><span style={t}>{weather.temp}°C</span>{weather.city&&<><span style={{...t,color:"#ccc"}}>·</span><span style={{...t,color:"#bbb"}}>{weather.city}</span></>}</>}
        {!wLoading && !weather && <span style={{...t,color:"#ddd"}}>—</span>}
      </div>
    </div>
  );
}

function Logo({ small }) {
  const n=small?17:46, d=small?25:64, a=small?17:46;
  return (
    <div style={{ display:"flex", alignItems:"baseline", lineHeight:1, userSelect:"none" }}>
      <span style={{ fontFamily:"Verdana,Geneva,Tahoma,sans-serif", fontSize:n, fontWeight:700, color:"#111", letterSpacing:small?"0.08em":"0.12em", textTransform:"uppercase" }}>Germanus</span>
      <span style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:d, fontWeight:700, color:"#1a3a6e", margin:"0 1px" }}>.</span>
      <span style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:a, fontWeight:700, color:"transparent", WebkitTextStroke:`${small?"1px":"1.5px"} #b22222`, letterSpacing:"-0.02em" }}>Arts</span>
    </div>
  );
}

function AlaBadge({ alaId, small }) {
  const ala = ALAS.find(a=>a.id===alaId); if(!ala) return null;
  return <span style={{ background:`${ala.color}18`, color:ala.color, border:`1px solid ${ala.color}44`, borderRadius:3, padding:small?"1px 6px":"2px 8px", fontSize:small?9:10.5, fontFamily:"monospace", letterSpacing:.5, whiteSpace:"nowrap" }}>{ala.icon} {ala.name}</span>;
}

function NavBtn({ children, onClick, blue }) {
  const [h,setH]=useState(false);
  return <button onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} style={{ background:h?(blue?"#1a3a6e":"#111"):"#fff", border:`1px solid ${blue?(h?"#1a3a6e":"#c8d4e8"):(h?"#111":"#e0e0e0")}`, borderRadius:2, color:h?"#fff":(blue?"#1a3a6e":"#888"), padding:"5px 10px", cursor:"pointer", fontSize:10, fontFamily:"Verdana,sans-serif", letterSpacing:.3, transition:"all .15s", whiteSpace:"nowrap" }}>{children}</button>;
}

function Btn({ children, onClick, filled, danger, outline }) {
  const [h,setH]=useState(false);
  const s={ flex:danger?0:1, padding:danger?"7px 10px":"7px 0", cursor:"pointer", fontSize:10, fontFamily:"Verdana,sans-serif", letterSpacing:.5, borderRadius:2, border:"1px solid", transition:"all .15s" };
  const c=filled?{background:h?"#333":"#111",borderColor:"#111",color:"#fff"}:danger?{background:"#fff",borderColor:h?"#b22222":"#ddd",color:h?"#b22222":"#ccc"}:{background:"#fff",borderColor:h?"#111":"#ddd",color:h?"#111":"#aaa"};
  return <button onClick={onClick} style={{...s,...c}} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}>{children}</button>;
}

function Chip({ children }) {
  return <span style={{ flex:1, textAlign:"center", fontSize:10, color:"#bbb", padding:"7px 0", border:"1px solid #eee", borderRadius:2, fontFamily:"Verdana,sans-serif" }}>{children}</span>;
}

function Card({ art, onAdd, onRemove, inCollection, onNavigate }) {
  const [open,setOpen]=useState(false);
  const [imgErr,setImgErr]=useState(false);
  const [imgOk,setImgOk]=useState(false);
  const nav=(q,id)=>onNavigate&&onNavigate(q,id);
  return (
    <div style={{ background:"#fff", border:"1px solid #e2e2e2", borderRadius:2, overflow:"hidden", display:"flex", flexDirection:"column", transition:"border-color .18s, box-shadow .18s" }}
      onMouseEnter={e=>{e.currentTarget.style.borderColor="#111";e.currentTarget.style.boxShadow="4px 4px 0 #111";}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor="#e2e2e2";e.currentTarget.style.boxShadow="none";}}>
      <div style={{ height:215, background:"#f5f4f2", borderBottom:"1px solid #ebebeb", overflow:"hidden", position:"relative", display:"flex", alignItems:"center", justifyContent:"center" }}>
        {art.imageUrl&&!imgErr?(
          <>{!imgOk&&<div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"#f5f4f2" }}><div style={{ width:22, height:22, border:"2px solid #e0e0e0", borderTopColor:"#aaa", borderRadius:"50%", animation:"spin 1s linear infinite" }}/></div>}
          <img src={art.imageUrl} alt={art.title} style={{ width:"100%", height:"100%", objectFit:"cover", opacity:imgOk?1:0, transition:"opacity .3s" }} onLoad={()=>setImgOk(true)} onError={()=>setImgErr(true)}/></>
        ):(
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8, padding:16, textAlign:"center" }}>
            <span style={{ fontSize:28, opacity:.1 }}>🖼</span>
            <span style={{ fontSize:9, color:"#ccc", fontFamily:"monospace", letterSpacing:1.5, textTransform:"uppercase" }}>imagem não disponível</span>
            {art.externalUrl&&<a href={art.externalUrl} target="_blank" rel="noreferrer" style={{ fontSize:9, color:"#bbb", fontFamily:"monospace" }}>wikipedia ↗</a>}
          </div>
        )}
        {art.alaId&&<div style={{ position:"absolute", top:8, left:8 }}><AlaBadge alaId={art.alaId} small/></div>}
      </div>
      <div style={{ padding:"14px", flex:1, display:"flex", flexDirection:"column", gap:6 }}>
        <h3 style={{ margin:0, fontSize:13.5, fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontWeight:600, color:"#111", lineHeight:1.35 }}>{art.title}</h3>
        <p style={{ margin:0, fontSize:12, color:"#444", fontFamily:"'Cormorant Garamond',serif", cursor:"pointer" }} onClick={()=>nav(art.artist?.split("(")[0].trim())} onMouseEnter={e=>e.target.style.color="#1a3a6e"} onMouseLeave={e=>e.target.style.color="#444"}>{art.artist}</p>
        <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
          {art.date&&<span style={{ fontSize:10.5, color:"#bbb", fontFamily:"monospace" }}>{art.date}</span>}
          {art.origin&&<span onClick={()=>nav(art.origin)} style={{ fontSize:10.5, color:"#999", fontFamily:"monospace", cursor:"pointer", borderBottom:"1px dotted #ccc" }} onMouseEnter={e=>{e.target.style.color="#1a3a6e";e.target.style.borderColor="#1a3a6e"}} onMouseLeave={e=>{e.target.style.color="#999";e.target.style.borderColor="#ccc"}}>🌍 {art.origin}</span>}
          {art.style&&<span onClick={()=>nav(art.style)} style={{ fontSize:10.5, color:"#999", fontFamily:"monospace", cursor:"pointer", borderBottom:"1px dotted #ccc" }} onMouseEnter={e=>{e.target.style.color="#1a3a6e";e.target.style.borderColor="#1a3a6e"}} onMouseLeave={e=>{e.target.style.color="#999";e.target.style.borderColor="#ccc"}}>🎨 {art.style}</span>}
        </div>
        {art.museum&&<p style={{ margin:0, fontSize:11, color:"#555", borderLeft:"2px solid #1a3a6e", paddingLeft:8, lineHeight:1.4, cursor:"pointer" }} onClick={()=>nav(art.museum?.split(",")[0])} onMouseEnter={e=>e.currentTarget.style.color="#1a3a6e"} onMouseLeave={e=>e.currentTarget.style.color="#555"}>{art.museum}</p>}
        {art.medium&&<p style={{ margin:0, fontSize:10.5, color:"#aaa" }}>{art.medium.slice(0,80)}{art.medium.length>80?"…":""}</p>}
        {open&&(
          <div style={{ borderTop:"1px solid #f0f0f0", paddingTop:9, display:"flex", flexDirection:"column", gap:6 }}>
            {art.dimensions&&<p style={{ margin:0, fontSize:10.5, color:"#bbb", fontFamily:"monospace" }}>{art.dimensions}</p>}
            {art.description&&<p style={{ margin:0, fontSize:13, color:"#555", lineHeight:1.65, fontFamily:"'Cormorant Garamond',serif" }}>{art.description}</p>}
            {art.credit&&<p style={{ margin:0, fontSize:10, color:"#ccc", fontStyle:"italic" }}>{art.credit}</p>}
            {art.externalUrl&&<a href={art.externalUrl} target="_blank" rel="noreferrer" style={{ color:"#1a3a6e", fontSize:11, fontFamily:"monospace" }}>Ver na Wikipedia ↗</a>}
            {onNavigate&&(
              <div style={{ borderTop:"1px solid #f5f5f5", paddingTop:8 }}>
                <p style={{ margin:"0 0 6px", fontSize:9, color:"#bbb", fontFamily:"Verdana,sans-serif", letterSpacing:1, textTransform:"uppercase" }}>Explorar a partir desta obra</p>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                  {art.artist&&<NavBtn onClick={()=>nav(art.artist?.split("(")[0].trim())}>+ {art.artist?.split("(")[0].trim()}</NavBtn>}
                  {art.style&&<NavBtn onClick={()=>nav(art.style)}>+ {art.style}</NavBtn>}
                  {art.alaId&&<NavBtn onClick={()=>nav("",art.alaId)} blue>{ALAS.find(a=>a.id===art.alaId)?.icon} Mais desta ala</NavBtn>}
                  {art.date&&art.style&&<NavBtn onClick={()=>nav(`${art.style} ${art.date?.slice(0,4)}`)}>+ Mesmo período</NavBtn>}
                </div>
              </div>
            )}
          </div>
        )}
        <div style={{ display:"flex", gap:6, marginTop:"auto", paddingTop:9, borderTop:"1px solid #f5f5f5" }}>
          <Btn outline onClick={()=>setOpen(v=>!v)}>{open?"▲ FECHAR":"▼ DETALHES"}</Btn>
          {onAdd&&!inCollection&&<Btn filled onClick={()=>onAdd(art)}>+ ACERVO</Btn>}
          {onAdd&&inCollection&&<Chip>✓ SALVO</Chip>}
          {onRemove&&<Btn danger onClick={()=>onRemove(art.id)}>✕</Btn>}
        </div>
      </div>
    </div>
  );
}

function YearRange({ from, to, onFrom, onTo }) {
  const inp={ background:"#fff", border:"1px solid #e0e0e0", borderRadius:2, color:"#111", padding:"7px 10px", fontSize:12, outline:"none", fontFamily:"Verdana,sans-serif", width:80, textAlign:"center" };
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <span style={{ fontSize:10, color:"#bbb", fontFamily:"Verdana,sans-serif", letterSpacing:.5 }}>DE</span>
      <input type="number" placeholder="1400" min="1" max="2025" value={from} onChange={e=>onFrom(e.target.value)} style={inp}/>
      <span style={{ fontSize:10, color:"#bbb", fontFamily:"Verdana,sans-serif", letterSpacing:.5 }}>ATÉ</span>
      <input type="number" placeholder="2025" min="1" max="2025" value={to} onChange={e=>onTo(e.target.value)} style={inp}/>
      {(from||to)&&<button onClick={()=>{onFrom("");onTo("");}} style={{ background:"none", border:"none", color:"#ccc", cursor:"pointer", fontSize:13 }}>✕</button>}
    </div>
  );
}

const EMPTY={ title:"",artist:"",date:"",medium:"",dimensions:"",origin:"",style:"",museum:"",description:"",imageUrl:"",externalUrl:"",credit:"",alaId:"" };
function ManualForm({ onAdd }) {
  const [f,setF]=useState(EMPTY);
  const s=(k,v)=>setF(x=>({...x,[k]:v}));
  const base={ width:"100%", background:"#fff", border:"1px solid #e0e0e0", borderRadius:2, color:"#111", padding:"9px 11px", fontSize:13, outline:"none", fontFamily:"'Cormorant Garamond',serif" };
  const inp=(label,key,rows)=>(
    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <label style={{ fontSize:9.5, color:"#bbb", fontFamily:"Verdana,sans-serif", letterSpacing:1, textTransform:"uppercase" }}>{label}</label>
      {rows?<textarea rows={rows} value={f[key]} onChange={e=>s(key,e.target.value)} style={{...base,resize:"vertical"}}/>:<input value={f[key]} onChange={e=>s(key,e.target.value)} style={base}/>}
    </div>
  );
  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:13 }}>
      <div style={{ gridColumn:"1/-1" }}>{inp("Título *","title")}</div>
      {inp("Artista","artist")} {inp("Data / Período","date")}
      {inp("Técnica","medium")} {inp("Dimensões","dimensions")}
      {inp("Origem / País","origin")} {inp("Estilo / Movimento","style")}
      {inp("Museu / Coleção","museum")} {inp("Créditos","credit")}
      <div style={{ gridColumn:"1/-1" }}>
        <label style={{ fontSize:9.5, color:"#bbb", fontFamily:"Verdana,sans-serif", letterSpacing:1, textTransform:"uppercase", display:"block", marginBottom:4 }}>Ala</label>
        <select value={f.alaId} onChange={e=>s("alaId",e.target.value)} style={{...base,cursor:"pointer"}}>
          <option value="">— sem ala —</option>
          {ALAS.map(a=><option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
        </select>
      </div>
      <div style={{ gridColumn:"1/-1" }}>{inp("URL da Imagem","imageUrl")}</div>
      <div style={{ gridColumn:"1/-1" }}>{inp("Link de Referência","externalUrl")}</div>
      <div style={{ gridColumn:"1/-1" }}>{inp("Descrição","description",4)}</div>
      <div style={{ gridColumn:"1/-1" }}>
        <button onClick={()=>{if(!f.title.trim())return alert("Título obrigatório.");onAdd({...f,id:`m_${Date.now()}`,source:"manual"});setF(EMPTY);}} style={{ width:"100%", background:"#111", border:"none", borderRadius:2, color:"#fff", padding:"13px 0", cursor:"pointer", fontSize:11, fontFamily:"Verdana,sans-serif", letterSpacing:1, textTransform:"uppercase" }}>Adicionar ao Acervo</button>
      </div>
    </div>
  );
}

function CuradoriaTab({ col, onSearchAla }) {
  const [sel,setSel]=useState(null);
  const count=id=>col.filter(a=>a.alaId===id).length;
  return (
    <div>
      <h2 style={{ margin:"0 0 4px", fontSize:22, fontWeight:700, fontFamily:"Verdana,sans-serif", color:"#111" }}>Curadoria</h2>
      <p style={{ margin:"0 0 28px", fontSize:12, color:"#aaa", fontFamily:"Verdana,sans-serif", lineHeight:1.6 }}>18 galerias temáticas por experiência visual — não por período acadêmico. Clique numa ala para buscar.</p>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))", gap:12 }}>
        {ALAS.map(ala=>{
          const c=count(ala.id), selected=sel?.id===ala.id;
          return (
            <div key={ala.id} onClick={()=>setSel(selected?null:ala)}
              style={{ background:"#fff", border:`1px solid ${selected?ala.color:"#e2e2e2"}`, borderLeft:`4px solid ${ala.color}`, borderRadius:2, padding:"14px 16px", cursor:"pointer", transition:"all .18s", boxShadow:selected?`3px 3px 0 ${ala.color}`:"none" }}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=ala.color;e.currentTarget.style.boxShadow=`3px 3px 0 ${ala.color}`;}}
              onMouseLeave={e=>{if(!selected){e.currentTarget.style.borderColor="#e2e2e2";e.currentTarget.style.boxShadow="none";}}}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <span style={{ fontSize:22 }}>{ala.icon}</span>
                {c>0&&<span style={{ fontSize:10, color:ala.color, fontFamily:"Verdana,sans-serif", background:`${ala.color}18`, border:`1px solid ${ala.color}33`, borderRadius:10, padding:"1px 7px" }}>{c}</span>}
              </div>
              <p style={{ margin:"8px 0 2px", fontFamily:"Verdana,sans-serif", fontSize:13, fontWeight:700, color:"#111" }}>{ala.name}</p>
              <p style={{ margin:0, fontSize:11, color:"#999", lineHeight:1.45, fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic" }}>{ala.desc}</p>
            </div>
          );
        })}
      </div>
      {sel&&(
        <div style={{ marginTop:24, background:`${sel.color}08`, border:`1px solid ${sel.color}33`, borderRadius:2, padding:"18px 22px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
            <span style={{ fontSize:26 }}>{sel.icon}</span>
            <div>
              <p style={{ margin:0, fontFamily:"Verdana,sans-serif", fontSize:15, fontWeight:700, color:"#111" }}>{sel.name}</p>
              <p style={{ margin:0, fontSize:12, color:"#888", fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic" }}>{sel.desc}</p>
            </div>
          </div>
          <button onClick={()=>onSearchAla(sel)} style={{ background:sel.color, border:"none", borderRadius:2, color:"#fff", padding:"10px 22px", cursor:"pointer", fontSize:11, fontFamily:"Verdana,sans-serif", letterSpacing:.5 }}>Buscar obras desta ala →</button>
        </div>
      )}
    </div>
  );
}

// ─── App principal ────────────────────────────────────────────────────────────
const TIPS=["Mona Lisa","Starry Night","Tarsila do Amaral","Frida Kahlo","Impressionismo","Barroco holandês","Arte islâmica","Guernica","Renascimento italiano","Ukiyo-e japonês"];

export default function App() {
  const [tab,setTab]       = useState("curadoria");
  const [col,setCol]       = useState([]);
  const [results,setRes]   = useState([]);
  const [query,setQuery]   = useState("");
  const [activeAla,setAla] = useState(null);
  const [fromYear,setFrom] = useState("");
  const [toYear,setTo]     = useState("");
  const [phase,setPhase]   = useState("idle");
  const [errMsg,setErr]    = useState("");
  const [filter,setFilt]   = useState("");
  const [filterAla,setFA]  = useState("");

  useEffect(()=>{ setCol(loadCol()); },[]);

  const add    = useCallback(art=>setCol(p=>{if(p.find(a=>a.id===art.id))return p;const n=[art,...p];saveCol(n);return n;}),[]);
  const remove = useCallback(id=>setCol(p=>{const n=p.filter(a=>a.id!==id);saveCol(n);return n;}),[]);

  const doSearch = async (q, ala) => {
    const sq = q ?? query;
    const sa = ala ?? activeAla;
    if (!sq.trim() || phase==="searching") return;
    setRes([]); setErr(""); setPhase("searching");
    try {
      const arts = await searchArt(sq, sa, fromYear, toYear);
      setRes(arts); setPhase("done");
    } catch(e) { setErr(e.message); setPhase("error"); }
  };

  const navigate = useCallback((term, alaId) => {
    const ala = alaId ? ALAS.find(a=>a.id===alaId) : activeAla;
    if (alaId) setAla(ALAS.find(a=>a.id===alaId)||null);
    if (term) setQuery(term);
    setTab("buscar");
    setRes([]); setPhase("idle");
    if (term || alaId) {
      setTimeout(async ()=>{
        setPhase("searching");
        try { const arts=await searchArt(term||query, ala, fromYear, toYear); setRes(arts); setPhase("done"); }
        catch(e){ setErr(e.message); setPhase("error"); }
      }, 50);
    }
  }, [activeAla, query, fromYear, toYear]);

  const goSearchAla = ala => { setAla(ala); setTab("buscar"); setQuery(""); setRes([]); setPhase("idle"); };

  const busy = phase==="searching";
  const ids  = new Set(col.map(a=>a.id));
  const filtered = col.filter(a=>{
    const txt=!filter||[a.title,a.artist,a.style,a.origin,a.museum,a.medium].some(v=>v?.toLowerCase().includes(filter.toLowerCase()));
    const ala=!filterAla||a.alaId===filterAla;
    return txt&&ala;
  });

  const TABS=[{id:"curadoria",label:"Curadoria"},{id:"buscar",label:"Buscar"},{id:"acervo",label:`Acervo${col.length?` (${col.length})`:""}`},{id:"manual",label:"Cadastrar"}];

  return (
    <div style={{ minHeight:"100vh", background:"#fff", color:"#111", fontFamily:"'Cormorant Garamond',Georgia,serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap" rel="stylesheet"/>
      <style>{`*{box-sizing:border-box}@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <AmbientBar/>

      <header style={{ background:"#fff", borderBottom:"1px solid #eaeaea", padding:"22px 40px 0" }}>
        <div style={{ maxWidth:1300, margin:"0 auto" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:20 }}>
            <Logo/>
            <p style={{ margin:0, fontSize:9.5, color:"#ccc", fontFamily:"Verdana,sans-serif", letterSpacing:2, textTransform:"uppercase" }}>Global Art Collection</p>
          </div>
          <nav style={{ display:"flex" }}>
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{ background:"none", border:"none", borderBottom:tab===t.id?"2px solid #111":"2px solid transparent", color:tab===t.id?"#111":"#bbb", padding:"10px 22px 10px 0", marginRight:4, cursor:"pointer", fontSize:10.5, fontFamily:"Verdana,sans-serif", letterSpacing:1, textTransform:"uppercase", transition:"color .18s" }}>{t.label}</button>
            ))}
          </nav>
        </div>
      </header>

      <main style={{ maxWidth:1300, margin:"0 auto", padding:"36px 40px" }}>

        {tab==="curadoria"&&<CuradoriaTab col={col} onSearchAla={goSearchAla}/>}

        {tab==="buscar"&&(
          <div>
            {/* Filtros de ala */}
            <div style={{ marginBottom:12 }}>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
                <button onClick={()=>setAla(null)} style={{ background:!activeAla?"#111":"#fff", border:`1px solid ${!activeAla?"#111":"#ddd"}`, borderRadius:2, color:!activeAla?"#fff":"#aaa", padding:"5px 12px", cursor:"pointer", fontSize:10, fontFamily:"Verdana,sans-serif", letterSpacing:.5, transition:"all .15s" }}>Todas</button>
                {ALAS.map(a=>(
                  <button key={a.id} onClick={()=>setAla(activeAla?.id===a.id?null:a)} style={{ background:activeAla?.id===a.id?a.color:"#fff", border:`1px solid ${activeAla?.id===a.id?a.color:"#e0e0e0"}`, borderRadius:2, color:activeAla?.id===a.id?"#fff":"#888", padding:"5px 10px", cursor:"pointer", fontSize:10, fontFamily:"Verdana,sans-serif", letterSpacing:.3, transition:"all .15s" }}>{a.icon} {a.name}</button>
                ))}
              </div>
              <YearRange from={fromYear} to={toYear} onFrom={setFrom} onTo={setTo}/>
            </div>

            {activeAla&&(
              <div style={{ background:`${activeAla.color}08`, borderLeft:`3px solid ${activeAla.color}`, padding:"10px 14px", marginBottom:12, borderRadius:"0 2px 2px 0" }}>
                <p style={{ margin:0, fontSize:12, color:activeAla.color, fontFamily:"Verdana,sans-serif", fontWeight:700 }}>{activeAla.icon} {activeAla.name}</p>
                <p style={{ margin:"2px 0 0", fontSize:11.5, color:"#888", fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic" }}>{activeAla.desc}</p>
              </div>
            )}

            <div style={{ display:"flex", alignItems:"center", borderBottom:"2px solid #111", marginBottom:14, paddingBottom:2 }}>
              <input placeholder={activeAla?`${activeAla.icon} Buscar em ${activeAla.name}...`:"Obra, artista, estilo, período, museu, país..."} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSearch()} style={{ flex:1, background:"transparent", border:"none", color:"#111", padding:"12px 0", fontSize:18, outline:"none", fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic" }}/>
              <button onClick={()=>doSearch()} disabled={busy} style={{ background:"none", border:"none", cursor:busy?"default":"pointer", fontSize:11, fontFamily:"Verdana,sans-serif", letterSpacing:2, color:busy?"#ccc":"#111", paddingLeft:18, whiteSpace:"nowrap" }}>
                {busy?<span style={{ display:"inline-block", animation:"spin 1s linear infinite", fontSize:16 }}>⟳</span>:"BUSCAR →"}
              </button>
            </div>

            {phase==="searching"&&<p style={{ fontSize:11, color:"#bbb", fontFamily:"Verdana,sans-serif", marginBottom:20 }}>Consultando base global de arte...</p>}
            {phase==="done"&&<p style={{ fontSize:11, color:"#999", fontFamily:"Verdana,sans-serif", marginBottom:20 }}>{results.length} obra{results.length!==1?"s":""} · {results.filter(r=>r.imageUrl).length} com imagem</p>}
            {phase==="error"&&<p style={{ fontSize:11, color:"#b22222", fontFamily:"Verdana,sans-serif", marginBottom:20 }}>Erro: {errMsg}</p>}

            {results.length>0&&<div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))", gap:20 }}>{results.map(a=><Card key={a.id} art={a} onAdd={add} inCollection={ids.has(a.id)} onNavigate={navigate}/>)}</div>}

            {phase==="idle"&&(
              <div style={{ paddingTop:56, borderTop:"1px solid #f4f4f4" }}>
                <div style={{ opacity:.07, marginBottom:24, display:"inline-block" }}><Logo/></div>
                <p style={{ fontSize:10, color:"#ccc", fontFamily:"Verdana,sans-serif", letterSpacing:1.5, textTransform:"uppercase", marginBottom:14 }}>Sugestões</p>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {TIPS.map(s=><button key={s} onClick={()=>{setQuery(s);setTimeout(()=>doSearch(s),50);}} style={{ background:"#fff", border:"1px solid #e8e8e8", borderRadius:2, color:"#aaa", padding:"7px 14px", cursor:"pointer", fontSize:11, fontFamily:"Verdana,sans-serif", transition:"all .15s" }} onMouseEnter={e=>{e.currentTarget.style.borderColor="#111";e.currentTarget.style.color="#111";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#e8e8e8";e.currentTarget.style.color="#aaa";}}>{s}</button>)}
                </div>
              </div>
            )}
          </div>
        )}

        {tab==="acervo"&&(
          <div>
            {col.length>0&&(
              <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap", alignItems:"center" }}>
                <input placeholder="Filtrar coleção..." value={filter} onChange={e=>setFilt(e.target.value)} style={{ flex:1, minWidth:180, background:"#fff", border:"1px solid #e0e0e0", borderRadius:2, color:"#111", padding:"9px 12px", fontSize:13, outline:"none", fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic" }}/>
                <select value={filterAla} onChange={e=>setFA(e.target.value)} style={{ background:"#fff", border:"1px solid #e0e0e0", borderRadius:2, color:filterAla?"#111":"#bbb", padding:"9px 12px", fontSize:11, outline:"none", cursor:"pointer", fontFamily:"Verdana,sans-serif" }}>
                  <option value="">Todas as alas</option>
                  {ALAS.map(a=><option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                </select>
                {(filter||filterAla)&&<button onClick={()=>{setFilt("");setFA("");}} style={{ background:"none", border:"none", color:"#ccc", cursor:"pointer", fontSize:16 }}>✕</button>}
              </div>
            )}
            {filtered.length===0
              ?<div style={{ textAlign:"center", padding:"80px 0" }}>
                  <div style={{ opacity:.07, marginBottom:18, display:"inline-block" }}><Logo/></div>
                  <p style={{ fontSize:11, color:"#ccc", fontFamily:"Verdana,sans-serif", letterSpacing:.5 }}>{col.length===0?"Acervo vazio — explore as alas e adicione obras":"Nenhuma obra corresponde"}</p>
                  {col.length===0&&<button onClick={()=>setTab("curadoria")} style={{ marginTop:14, background:"#111", border:"none", borderRadius:2, color:"#fff", padding:"10px 24px", cursor:"pointer", fontSize:10, fontFamily:"Verdana,sans-serif", letterSpacing:1 }}>VER CURADORIA</button>}
                </div>
              :<>
                  <p style={{ fontSize:10, color:"#ccc", fontFamily:"Verdana,sans-serif", letterSpacing:.5, marginBottom:18 }}>{filtered.length} obra{filtered.length!==1?"s":""}</p>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))", gap:20 }}>{filtered.map(a=><Card key={a.id} art={a} onRemove={remove} onNavigate={navigate}/>)}</div>
                </>
            }
          </div>
        )}

        {tab==="manual"&&(
          <div style={{ maxWidth:680 }}>
            <h2 style={{ margin:"0 0 4px", fontSize:22, fontWeight:700, fontFamily:"Verdana,sans-serif", color:"#111" }}>Cadastrar obra</h2>
            <p style={{ margin:"0 0 26px", fontSize:11, color:"#bbb", fontFamily:"Verdana,sans-serif" }}>Para obras de grupos, galerias, ateliês e museus sem API aberta.</p>
            <ManualForm onAdd={art=>{add(art);setTab("acervo");}}/>
          </div>
        )}
      </main>

      <footer style={{ borderTop:"1px solid #f2f2f2", padding:"14px 40px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <Logo small/>
        <p style={{ margin:0, fontSize:9, color:"#ddd", fontFamily:"Verdana,sans-serif", letterSpacing:2 }}>18 ALAS · MUSEUS GLOBAIS · CURADORIA LOCAL</p>
      </footer>
    </div>
  );
}

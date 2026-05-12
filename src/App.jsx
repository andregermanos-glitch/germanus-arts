import { useState, useEffect, useCallback } from "react";

// ─── Persistência ─────────────────────────────────────────────────────────────
const loadCol = () => { try { return JSON.parse(localStorage.getItem("germ_col")||"[]"); } catch { return []; } };
const saveCol = col => { try { localStorage.setItem("germ_col", JSON.stringify(col)); } catch {} };

// ─── 18 Alas ──────────────────────────────────────────────────────────────────
const ALAS = [
  { id:"retratos",     name:"Retratos",            icon:"👤", color:"#8B7355", desc:"Expressão humana no rosto",                    hint:"portrait face expression Renaissance" },
  { id:"pessoas_reais",name:"Pessoas Reais",        icon:"🧑", color:"#6B8E6B", desc:"Indivíduos identificáveis",                    hint:"real person historical figure identified" },
  { id:"cidades",      name:"Cidades Reais",        icon:"🏙", color:"#5B7FA6", desc:"Vistas urbanas identificáveis",               hint:"cityscape urban view known city" },
  { id:"historico",    name:"Momentos Históricos",  icon:"⚔️", color:"#8B4A4A", desc:"Batalhas e eventos políticos",                hint:"historical event battle political scene" },
  { id:"objetos",      name:"Objetos",              icon:"🏺", color:"#A08B5B", desc:"Still life e naturezas-mortas",               hint:"still life objects vanitas composition" },
  { id:"lugares",      name:"Lugares Conhecidos",   icon:"🗺", color:"#5B8B8B", desc:"Monumentos e paisagens famosas",             hint:"landmark known place monument famous" },
  { id:"natureza",     name:"Natureza",             icon:"🌿", color:"#5B8B5B", desc:"Paisagens, fauna e flora",                   hint:"nature landscape flora fauna countryside sea" },
  { id:"familiar",     name:"Ambiente Familiar",    icon:"🏠", color:"#9B7B5B", desc:"Cenas domésticas e cotidiano",               hint:"domestic interior family everyday life home" },
  { id:"nudes",        name:"Nudes Feminina",       icon:"🎨", color:"#9B7B7B", desc:"Arte clássica do nu feminino",               hint:"female nude classical Venus goddess" },
  { id:"esoterico",    name:"Esoterismo",           icon:"🔮", color:"#7B5B9B", desc:"Simbolismo e misticismo",                    hint:"esoteric mysticism symbolism alchemy" },
  { id:"sacro",        name:"Sacro",                icon:"✝️", color:"#9B8B5B", desc:"Arte religiosa e iconografia",               hint:"sacred religious icon devotional spiritual" },
  { id:"arquitetura",  name:"Arquitetura",          icon:"🏛", color:"#6B7B8B", desc:"Edifícios, ruínas e espaços",               hint:"architecture building ruins interior" },
  { id:"povo",         name:"Pessoas do Povo",      icon:"🧑‍🤝‍🧑", color:"#8B7B5B", desc:"Camponeses e vida simples",            hint:"peasant worker common people folk" },
  { id:"perspectiva",  name:"Perspectiva",          icon:"📐", color:"#5B6B8B", desc:"Profundidade como elemento central",         hint:"perspective depth optical illusion" },
  { id:"luz_sol",      name:"Luz do Sol",           icon:"☀️", color:"#A08B3B", desc:"Luz natural como protagonista",             hint:"sunlight natural light dawn sunset luminism" },
  { id:"cores",        name:"Cores",                icon:"🌈", color:"#7B5B9B", desc:"Cor como linguagem expressiva",             hint:"color chromatic fauvism expressionism vibrant" },
  { id:"fase",         name:"Fase do Artista",      icon:"🖌️", color:"#5B8B7B", desc:"Um período na carreira do artista",         hint:"artist period early work mature late style" },
  { id:"femininas",    name:"Artistas Femininas",   icon:"👩‍🎨", color:"#9B5B8B", desc:"Grandes artistas mulheres",              hint:"female artist woman painter Frida Kahlo Mary Cassatt" },
];

// ─── Lua ──────────────────────────────────────────────────────────────────────
function getMoonPhase() {
  const now = new Date(), ref = new Date("2000-01-06T18:14:00Z"), cycle = 29.53058867;
  const age = (((now - ref) / 86400000) % cycle + cycle) % cycle;
  const idx = Math.floor((age / cycle) * 8) % 8;
  const p = ["🌑 Lua Nova","🌒 Lua Crescente","🌓 Quarto Crescente","🌔 Crescente Gibosa","🌕 Lua Cheia","🌖 Minguante Gibosa","🌗 Quarto Minguante","🌘 Lua Minguante"];
  return { label: p[idx], age: Math.round(age) };
}

// ─── Temperatura ─────────────────────────────────────────────────────────────
async function getWeather() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(async ({ coords: { latitude: lat, longitude: lon } }) => {
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
        const icon = code===0?"☀️":code<=3?"🌤":code<=49?"🌫":code<=69?"🌧":"⛈";
        resolve({ temp: Math.round(cw?.temperature ?? 0), icon, city });
      } catch { resolve(null); }
    }, () => resolve(null), { timeout: 6000, maximumAge: 300000 });
  });
}

// ─── Busca via backend ────────────────────────────────────────────────────────
async function searchArt(query, ala, fromYear, toYear) {
  const p = new URLSearchParams({ q: query });
  if (ala) { p.append("ala", ala.name); p.append("alaHint", ala.hint||""); p.append("alaId", ala.id); }
  if (fromYear) p.append("fromYear", fromYear);
  if (toYear)   p.append("toYear", toYear);
  const res = await fetch(`/api/search?${p}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return (data.results || []).map((o, i) => ({ ...o, id: o.id || `art_${Date.now()}_${i}` }));
}

// ─── Componentes base ─────────────────────────────────────────────────────────
function Logo({ small }) {
  const n=small?16:44, d=small?26:68, a=small?16:44;
  return (
    <div style={{ display:"flex", alignItems:"baseline", lineHeight:1, userSelect:"none" }}>
      <span style={{ fontFamily:"Verdana,Geneva,sans-serif", fontSize:n, fontWeight:700, color:"#111", letterSpacing:small?"0.08em":"0.12em", textTransform:"uppercase" }}>Germanus</span>
      <span style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:d, fontWeight:700, color:"#1545c7", margin:"0 1px" }}>.</span>
      <span style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:a, fontWeight:700, color:"#d41515", letterSpacing:"-0.02em" }}>Art</span>
    </div>
  );
}

function AmbientBar() {
  const [moon, setMoon]       = useState(null);
  const [weather, setWeather] = useState(null);
  const [wLoading, setWL]     = useState(true);
  useEffect(() => {
    setMoon(getMoonPhase());
    getWeather().then(w => { setWeather(w); setWL(false); });
  }, []);
  const t = { fontSize:10, color:"#999", fontFamily:"Verdana,sans-serif", letterSpacing:.3 };
  return (
    <div style={{ background:"#f5f4f0", borderBottom:"1px solid #ece9e2", padding:"5px 36px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
      <span style={t}>{moon?.label} · dia {moon?.age}</span>
      <span style={t}>
        {wLoading ? "···" : weather ? `${weather.icon} ${weather.temp}°C${weather.city ? ` · ${weather.city}` : ""}` : "—"}
      </span>
    </div>
  );
}

// ─── Botão de ala (elongado, só texto, 3mm padding v) ────────────────────────
function AlaBtn({ ala, active, onClick }) {
  const [h, setH] = useState(false);
  const hot = active || h;
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "11px 14px",
        background: hot
          ? `linear-gradient(90deg, ${ala.color}45 0%, ${ala.color}12 50%, #faf9f7 100%)`
          : `linear-gradient(90deg, ${ala.color}18 0%, ${ala.color}05 50%, #faf9f7 100%)`,
        border: "1px solid",
        borderColor: hot ? `${ala.color}66` : "#e8e4dc",
        borderLeft: `3px solid ${active ? ala.color : hot ? ala.color+"aa" : "#e0dbd0"}`,
        borderRadius: 3,
        cursor: "pointer",
        transition: "all .18s",
        textAlign: "left",
        width: "100%",
        boxShadow: active ? `0 2px 8px ${ala.color}22` : "none",
      }}>
      <p style={{
        margin: 0,
        fontSize: 12,
        fontFamily: "Verdana,sans-serif",
        fontWeight: active ? 700 : 500,
        color: active ? "#0a0a0a" : "#2a2a2a",
        letterSpacing: ".3px",
      }}>
        {ala.name}
      </p>
    </button>
  );
}

// ─── Card de obra ─────────────────────────────────────────────────────────────
function Card({ art, onAdd, onRemove, inCollection, onNavigate }) {
  const [open, setOpen]    = useState(false);
  const [imgErr, setImgErr]= useState(false);
  const [imgOk, setImgOk]  = useState(false);
  const nav = (q, id) => onNavigate && onNavigate(q, id);
  const ala = ALAS.find(a => a.id === art.alaId);

  return (
    <div
      style={{ background:"#fff", border:"1px solid #e8e4dc", borderRadius:3, overflow:"hidden", display:"flex", flexDirection:"column", transition:"border-color .18s, box-shadow .18s" }}
      onMouseEnter={e=>{ e.currentTarget.style.borderColor="#aaa"; e.currentTarget.style.boxShadow="3px 3px 0 #0a0a0a20"; }}
      onMouseLeave={e=>{ e.currentTarget.style.borderColor="#e8e4dc"; e.currentTarget.style.boxShadow="none"; }}>

      {/* Imagem */}
      <div style={{ height:210, background:"#f2f0eb", borderBottom:"1px solid #ece9e2", overflow:"hidden", position:"relative", display:"flex", alignItems:"center", justifyContent:"center" }}>
        {art.imageUrl && !imgErr ? (
          <>
            {!imgOk && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"#f2f0eb" }}><div style={{ width:20, height:20, border:"2px solid #ddd", borderTopColor:"#888", borderRadius:"50%", animation:"spin 1s linear infinite" }}/></div>}
            <img src={art.imageUrl} alt={art.title} style={{ width:"100%", height:"100%", objectFit:"cover", opacity:imgOk?1:0, transition:"opacity .3s" }} onLoad={()=>setImgOk(true)} onError={()=>setImgErr(true)}/>
          </>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, padding:12, textAlign:"center" }}>
            <span style={{ fontSize:24, opacity:.1 }}>🖼</span>
            <span style={{ fontSize:9, color:"#bbb", fontFamily:"monospace", letterSpacing:1.5, textTransform:"uppercase" }}>sem imagem</span>
            {art.externalUrl && <a href={art.externalUrl} target="_blank" rel="noreferrer" style={{ fontSize:9, color:"#aaa", fontFamily:"monospace" }}>wikipedia ↗</a>}
          </div>
        )}
        {ala && (
          <div style={{ position:"absolute", top:7, left:7, background:`${ala.color}ee`, borderRadius:2, padding:"2px 7px" }}>
            <span style={{ fontSize:9, color:"#fff", fontFamily:"Verdana,sans-serif", letterSpacing:.5 }}>{ala.icon} {ala.name}</span>
          </div>
        )}
      </div>

      {/* Corpo */}
      <div style={{ padding:"13px", flex:1, display:"flex", flexDirection:"column", gap:5 }}>
        <h3 style={{ margin:0, fontSize:13.5, fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontWeight:600, color:"#0a0a0a", lineHeight:1.35 }}>{art.title}</h3>

        <p style={{ margin:0, fontSize:12, color:"#444", cursor:"pointer" }}
          onClick={()=>nav(art.artist?.split("(")[0].trim())}
          onMouseEnter={e=>e.target.style.color="#1a3a6e"}
          onMouseLeave={e=>e.target.style.color="#444"}>
          {art.artist}
        </p>

        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {art.date && <span style={{ fontSize:10.5, color:"#aaa", fontFamily:"monospace" }}>{art.date}</span>}
          {art.origin && (
            <span onClick={()=>nav(art.origin)} style={{ fontSize:10.5, color:"#888", fontFamily:"monospace", cursor:"pointer", borderBottom:"1px dotted #ccc" }}
              onMouseEnter={e=>e.target.style.color="#1a3a6e"} onMouseLeave={e=>e.target.style.color="#888"}>
              🌍 {art.origin}
            </span>
          )}
          {art.style && (
            <span onClick={()=>nav(art.style)} style={{ fontSize:10.5, color:"#888", fontFamily:"monospace", cursor:"pointer", borderBottom:"1px dotted #ccc" }}
              onMouseEnter={e=>e.target.style.color="#1a3a6e"} onMouseLeave={e=>e.target.style.color="#888"}>
              🎨 {art.style}
            </span>
          )}
        </div>

        {art.museum && (
          <p style={{ margin:0, fontSize:11, color:"#555", borderLeft:"2px solid #1a3a6e", paddingLeft:7, lineHeight:1.4, cursor:"pointer" }}
            onClick={()=>nav(art.museum?.split(",")[0])}
            onMouseEnter={e=>e.currentTarget.style.color="#1a3a6e"}
            onMouseLeave={e=>e.currentTarget.style.color="#555"}>
            {art.museum}
          </p>
        )}

        {art.medium && <p style={{ margin:0, fontSize:10.5, color:"#bbb" }}>{art.medium.slice(0,80)}{art.medium.length>80?"…":""}</p>}

        {open && (
          <div style={{ borderTop:"1px solid #f0ece4", paddingTop:9, display:"flex", flexDirection:"column", gap:5 }}>
            {art.dimensions && <p style={{ margin:0, fontSize:10.5, color:"#bbb", fontFamily:"monospace" }}>{art.dimensions}</p>}
            {art.description && <p style={{ margin:0, fontSize:13, color:"#444", lineHeight:1.65, fontFamily:"'Cormorant Garamond',serif" }}>{art.description}</p>}
            {art.credit && <p style={{ margin:0, fontSize:10, color:"#ccc", fontStyle:"italic" }}>{art.credit}</p>}
            {art.externalUrl && <a href={art.externalUrl} target="_blank" rel="noreferrer" style={{ color:"#1a3a6e", fontSize:11, fontFamily:"monospace" }}>Ver na Wikipedia ↗</a>}
            {onNavigate && (
              <div style={{ borderTop:"1px solid #f5f0e8", paddingTop:7 }}>
                <p style={{ margin:"0 0 5px", fontSize:9, color:"#bbb", fontFamily:"Verdana,sans-serif", letterSpacing:1, textTransform:"uppercase" }}>Explorar</p>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                  {art.artist && <NavBtn onClick={()=>nav(art.artist?.split("(")[0].trim())}>+ {art.artist?.split("(")[0].trim()}</NavBtn>}
                  {art.style  && <NavBtn onClick={()=>nav(art.style)}>+ {art.style}</NavBtn>}
                  {art.alaId  && <NavBtn onClick={()=>nav("", art.alaId)} blue>{ALAS.find(a=>a.id===art.alaId)?.icon} Mais desta ala</NavBtn>}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display:"flex", gap:5, marginTop:"auto", paddingTop:8, borderTop:"1px solid #f5f0e8" }}>
          <Btn outline onClick={()=>setOpen(v=>!v)}>{open?"▲":"▼"}</Btn>
          {onAdd && !inCollection && <Btn filled onClick={()=>onAdd(art)}>+ ACERVO</Btn>}
          {onAdd && inCollection  && <Chip>✓</Chip>}
          {onRemove && <Btn danger onClick={()=>onRemove(art.id)}>✕</Btn>}
        </div>
      </div>
    </div>
  );
}

function NavBtn({ children, onClick, blue }) {
  const [h,setH]=useState(false);
  return (
    <button onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      style={{ background:h?(blue?"#1a3a6e":"#0a0a0a"):"#fff", border:`1px solid ${blue?(h?"#1a3a6e":"#c8d4e8"):(h?"#0a0a0a":"#e0dbd0")}`, borderRadius:2, color:h?"#fff":(blue?"#1a3a6e":"#777"), padding:"4px 9px", cursor:"pointer", fontSize:9.5, fontFamily:"Verdana,sans-serif", letterSpacing:.3, transition:"all .15s", whiteSpace:"nowrap" }}>
      {children}
    </button>
  );
}

function Btn({ children, onClick, filled, danger, outline }) {
  const [h,setH]=useState(false);
  const s={ flex:danger?0:1, padding:danger?"6px 9px":"7px 0", cursor:"pointer", fontSize:9.5, fontFamily:"Verdana,sans-serif", letterSpacing:.5, borderRadius:2, border:"1px solid", transition:"all .15s" };
  const c=filled?{background:h?"#333":"#0a0a0a",borderColor:"#0a0a0a",color:"#fff"}:danger?{background:"#fff",borderColor:h?"#b22222":"#ddd",color:h?"#b22222":"#ccc"}:{background:"#fff",borderColor:h?"#0a0a0a":"#ddd",color:h?"#0a0a0a":"#aaa"};
  return <button onClick={onClick} style={{...s,...c}} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}>{children}</button>;
}

function Chip({ children }) {
  return <span style={{ flex:1, textAlign:"center", fontSize:9.5, color:"#aaa", padding:"7px 0", border:"1px solid #eee", borderRadius:2, fontFamily:"Verdana,sans-serif" }}>{children}</span>;
}

function YearRange({ from, to, onFrom, onTo }) {
  const inp={ background:"#fff", border:"1px solid #e0dbd0", borderRadius:2, color:"#333", padding:"5px 8px", fontSize:11, outline:"none", fontFamily:"Verdana,sans-serif", width:72, textAlign:"center" };
  return (
    <div style={{ display:"flex", alignItems:"center", gap:7 }}>
      <span style={{ fontSize:9.5, color:"#aaa", fontFamily:"Verdana,sans-serif" }}>DE</span>
      <input type="number" placeholder="1400" value={from} onChange={e=>onFrom(e.target.value)} style={inp}/>
      <span style={{ fontSize:9.5, color:"#aaa", fontFamily:"Verdana,sans-serif" }}>ATÉ</span>
      <input type="number" placeholder="2025" value={to} onChange={e=>onTo(e.target.value)} style={inp}/>
      {(from||to) && <button onClick={()=>{onFrom("");onTo("");}} style={{ background:"none", border:"none", color:"#ccc", cursor:"pointer", fontSize:12 }}>✕</button>}
    </div>
  );
}

// ─── Formulário manual ────────────────────────────────────────────────────────
const EMPTY={ title:"",artist:"",date:"",medium:"",dimensions:"",origin:"",style:"",museum:"",description:"",imageUrl:"",externalUrl:"",credit:"",alaId:"" };
function ManualForm({ onAdd }) {
  const [f,setF]=useState(EMPTY);
  const s=(k,v)=>setF(x=>({...x,[k]:v}));
  const base={ width:"100%", background:"#fff", border:"1px solid #e0dbd0", borderRadius:2, color:"#0a0a0a", padding:"9px 11px", fontSize:13, outline:"none", fontFamily:"'Cormorant Garamond',serif" };
  const inp=(label,key,rows)=>(
    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <label style={{ fontSize:9.5, color:"#aaa", fontFamily:"Verdana,sans-serif", letterSpacing:1, textTransform:"uppercase" }}>{label}</label>
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
        <label style={{ fontSize:9.5, color:"#aaa", fontFamily:"Verdana,sans-serif", letterSpacing:1, textTransform:"uppercase", display:"block", marginBottom:4 }}>Ala</label>
        <select value={f.alaId} onChange={e=>s("alaId",e.target.value)} style={{...base,cursor:"pointer"}}>
          <option value="">— sem ala —</option>
          {ALAS.map(a=><option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
        </select>
      </div>
      <div style={{ gridColumn:"1/-1" }}>{inp("URL da Imagem","imageUrl")}</div>
      <div style={{ gridColumn:"1/-1" }}>{inp("Link de Referência","externalUrl")}</div>
      <div style={{ gridColumn:"1/-1" }}>{inp("Descrição","description",4)}</div>
      <div style={{ gridColumn:"1/-1" }}>
        <button onClick={()=>{ if(!f.title.trim()) return alert("Título obrigatório."); onAdd({...f,id:`m_${Date.now()}`,source:"manual"}); setF(EMPTY); }}
          style={{ width:"100%", background:"#0a0a0a", border:"none", borderRadius:2, color:"#fff", padding:"13px 0", cursor:"pointer", fontSize:11, fontFamily:"Verdana,sans-serif", letterSpacing:1, textTransform:"uppercase" }}>
          Adicionar ao Acervo
        </button>
      </div>
    </div>
  );
}

// ─── Curadoria tab ────────────────────────────────────────────────────────────
function CuradoriaTab({ col, onClickAla }) {
  const count = id => col.filter(a => a.alaId === id).length;
  return (
    <div>
      <h2 style={{ margin:"0 0 4px", fontSize:20, fontWeight:700, fontFamily:"Verdana,sans-serif", color:"#0a0a0a" }}>Curadoria</h2>
      <p style={{ margin:"0 0 22px", fontSize:12, color:"#aaa", fontFamily:"Verdana,sans-serif", lineHeight:1.6 }}>18 galerias por experiência visual — clique para explorar.</p>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(min(100%, 280px), 1fr))", gap:8 }}>
        {ALAS.map(ala => {
          const c = count(ala.id);
          return (
            <button key={ala.id} onClick={() => onClickAla(ala)}
              style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px", background:`linear-gradient(90deg, ${ala.color}18 0%, transparent 100%)`, border:`1px solid ${ala.color}33`, borderLeft:`3px solid ${ala.color}`, borderRadius:3, cursor:"pointer", textAlign:"left", transition:"all .18s" }}
              onMouseEnter={e=>{ e.currentTarget.style.background=`linear-gradient(90deg, ${ala.color}35 0%, transparent 100%)`; e.currentTarget.style.borderColor=`${ala.color}66`; }}
              onMouseLeave={e=>{ e.currentTarget.style.background=`linear-gradient(90deg, ${ala.color}18 0%, transparent 100%)`; e.currentTarget.style.borderColor=`${ala.color}33`; }}>
              <span style={{ fontSize:18, filter:"grayscale(1) brightness(0.1) drop-shadow(0 0 3px rgba(0,0,0,0.2))", flexShrink:0 }}>{ala.icon}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ margin:0, fontSize:12, fontFamily:"Verdana,sans-serif", fontWeight:600, color:"#0a0a0a" }}>{ala.name}</p>
                <p style={{ margin:"1px 0 0", fontSize:10.5, color:"#aaa", fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>{ala.desc}</p>
              </div>
              {c > 0 && <span style={{ fontSize:9.5, color:ala.color, background:`${ala.color}18`, border:`1px solid ${ala.color}33`, borderRadius:10, padding:"1px 6px", fontFamily:"Verdana,sans-serif", flexShrink:0 }}>{c}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,setTab]       = useState("buscar");
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

  useEffect(() => { setCol(loadCol()); }, []);

  const add    = useCallback(art => setCol(p => { if(p.find(a=>a.id===art.id)) return p; const n=[art,...p]; saveCol(n); return n; }), []);
  const remove = useCallback(id  => setCol(p => { const n=p.filter(a=>a.id!==id); saveCol(n); return n; }), []);

  // Busca disparada pela ala (auto)
  const clickAla = useCallback(async (ala) => {
    if (activeAla?.id === ala.id) {
      setAla(null); setRes([]); setPhase("idle"); return;
    }
    setAla(ala); setRes([]); setErr(""); setPhase("searching"); setTab("buscar");
    try {
      const arts = await searchArt(ala.hint, ala, fromYear, toYear);
      setRes(arts); setPhase("done");
    } catch(e) { setErr(e.message); setPhase("error"); }
  }, [activeAla, fromYear, toYear]);

  // Busca por texto (opcional)
  const doSearch = async () => {
    if (!query.trim() || phase==="searching") return;
    setRes([]); setErr(""); setPhase("searching");
    try {
      const arts = await searchArt(query, activeAla, fromYear, toYear);
      setRes(arts); setPhase("done");
    } catch(e) { setErr(e.message); setPhase("error"); }
  };

  // Navegação por clique nos cards
  const navigate = useCallback((term, alaId) => {
    const ala = alaId ? ALAS.find(a=>a.id===alaId) : activeAla;
    if (alaId) setAla(ALAS.find(a=>a.id===alaId)||null);
    if (term) setQuery(term);
    setTab("buscar"); setRes([]); setPhase("idle");
    setTimeout(async () => {
      setPhase("searching");
      try { const arts=await searchArt(term||query, ala, fromYear, toYear); setRes(arts); setPhase("done"); }
      catch(e){ setErr(e.message); setPhase("error"); }
    }, 50);
  }, [activeAla, query, fromYear, toYear]);

  const busy     = phase === "searching";
  const ids      = new Set(col.map(a=>a.id));
  const filtered = col.filter(a => {
    const txt = !filter || [a.title,a.artist,a.style,a.origin,a.museum].some(v=>v?.toLowerCase().includes(filter.toLowerCase()));
    const ala = !filterAla || a.alaId === filterAla;
    return txt && ala;
  });

  const TABS = [
    { id:"buscar",    label:"Buscar" },
    { id:"acervo",    label:`Acervo${col.length ? ` (${col.length})` : ""}` },
    { id:"curadoria", label:"Curadoria" },
    { id:"manual",    label:"Cadastrar" },
  ];

  return (
    <div style={{ minHeight:"100vh", background:"#faf9f7", color:"#0a0a0a", fontFamily:"'Cormorant Garamond',Georgia,serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap" rel="stylesheet"/>
      <style>{`*{box-sizing:border-box}@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <AmbientBar/>

      <header style={{ background:"#faf9f7", borderBottom:"1px solid #e8e4dc", padding:"20px 36px 0" }}>
        <div style={{ maxWidth:1300, margin:"0 auto" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:18 }}>
            <Logo/>
            <p style={{ margin:0, fontSize:9, color:"#bbb", fontFamily:"Verdana,sans-serif", letterSpacing:2, textTransform:"uppercase" }}>Global Art Collection</p>
          </div>
          <nav style={{ display:"flex" }}>
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{ background:"none", border:"none", borderBottom:tab===t.id?"2px solid #0a0a0a":"2px solid transparent", color:tab===t.id?"#0a0a0a":"#aaa", padding:"9px 20px 9px 0", marginRight:4, cursor:"pointer", fontSize:10.5, fontFamily:"Verdana,sans-serif", letterSpacing:1, textTransform:"uppercase", transition:"color .18s" }}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main style={{ maxWidth:1300, margin:"0 auto", padding:"32px 36px" }}>

        {/* ── BUSCAR ── */}
        {tab==="buscar" && (
          <div>
            {/* Caixa de refinamento — topo, discreta */}
            <div style={{ display:"flex", alignItems:"center", gap:0, borderBottom:`2px solid ${activeAla ? activeAla.color : "#0a0a0a"}`, marginBottom:20, paddingBottom:2, transition:"border-color .3s" }}>
              <input
                placeholder={activeAla ? `Refinar em ${activeAla.name}... (opcional)` : "Busca direta — obra, artista, estilo, período..."}
                value={query}
                onChange={e=>setQuery(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&doSearch()}
                style={{ flex:1, background:"transparent", border:"none", color:"#0a0a0a", padding:"11px 0", fontSize:17, outline:"none", fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic" }}
              />
              {query.trim() && (
                <button onClick={doSearch} disabled={busy}
                  style={{ background:"none", border:"none", cursor:busy?"default":"pointer", fontSize:10.5, fontFamily:"Verdana,sans-serif", letterSpacing:2, color:busy?"#ccc":"#0a0a0a", paddingLeft:16, whiteSpace:"nowrap" }}>
                  {busy ? <span style={{ display:"inline-block", animation:"spin 1s linear infinite" }}>⟳</span> : "BUSCAR →"}
                </button>
              )}
            </div>

            {/* Filtro de anos — discreto */}
            <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:16 }}>
              <YearRange from={fromYear} to={toYear} onFrom={setFrom} onTo={setTo}/>
            </div>

            {/* Grid de alas — sempre visível, 2 colunas */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(min(100%, 280px), 1fr))", gap:6, marginBottom:24 }}>
              {ALAS.map(ala => (
                <AlaBtn key={ala.id} ala={ala} active={activeAla?.id===ala.id} onClick={()=>clickAla(ala)}/>
              ))}
            </div>

            {/* Status */}
            {phase==="searching" && (
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:"#ccc", animation:"spin 1s linear infinite" }}/>
                <span style={{ fontSize:10.5, color:"#aaa", fontFamily:"Verdana,sans-serif" }}>
                  {activeAla ? `Buscando em ${activeAla.name}...` : "Consultando base global de arte..."}
                </span>
              </div>
            )}
            {phase==="done" && results.length > 0 && (
              <p style={{ fontSize:10.5, color:"#aaa", fontFamily:"Verdana,sans-serif", marginBottom:16 }}>
                {results.length} obra{results.length!==1?"s":""} · {results.filter(r=>r.imageUrl).length} com imagem
              </p>
            )}
            {phase==="error" && <p style={{ fontSize:10.5, color:"#b22222", fontFamily:"Verdana,sans-serif", marginBottom:16 }}>Erro: {errMsg}</p>}

            {/* Resultados */}
            {results.length > 0 && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(265px, 1fr))", gap:18 }}>
                {results.map(a=><Card key={a.id} art={a} onAdd={add} inCollection={ids.has(a.id)} onNavigate={navigate}/>)}
              </div>
            )}

            {/* Estado inicial */}
            {phase==="idle" && results.length===0 && (
              <div style={{ textAlign:"center", paddingTop:20, borderTop:"1px solid #f0ece4" }}>
                <p style={{ fontSize:10, color:"#ccc", fontFamily:"Verdana,sans-serif", letterSpacing:1, textTransform:"uppercase" }}>
                  Selecione uma galeria acima ou busque diretamente
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── ACERVO ── */}
        {tab==="acervo" && (
          <div>
            {col.length > 0 && (
              <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap", alignItems:"center" }}>
                <input placeholder="Filtrar coleção..." value={filter} onChange={e=>setFilt(e.target.value)}
                  style={{ flex:1, minWidth:180, background:"#fff", border:"1px solid #e0dbd0", borderRadius:2, color:"#0a0a0a", padding:"9px 12px", fontSize:13, outline:"none", fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic" }}/>
                <select value={filterAla} onChange={e=>setFA(e.target.value)}
                  style={{ background:"#fff", border:"1px solid #e0dbd0", borderRadius:2, color:filterAla?"#0a0a0a":"#aaa", padding:"9px 12px", fontSize:11, outline:"none", cursor:"pointer", fontFamily:"Verdana,sans-serif" }}>
                  <option value="">Todas as alas</option>
                  {ALAS.map(a=><option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                </select>
                {(filter||filterAla) && <button onClick={()=>{setFilt("");setFA("");}} style={{ background:"none", border:"none", color:"#ccc", cursor:"pointer", fontSize:16 }}>✕</button>}
              </div>
            )}
            {filtered.length === 0
              ? <div style={{ textAlign:"center", padding:"80px 0" }}>
                  <div style={{ opacity:.06, marginBottom:16, display:"inline-block" }}><Logo/></div>
                  <p style={{ fontSize:11, color:"#ccc", fontFamily:"Verdana,sans-serif" }}>
                    {col.length===0 ? "Acervo vazio — explore as galerias" : "Nenhuma obra corresponde"}
                  </p>
                  {col.length===0 && <button onClick={()=>setTab("buscar")} style={{ marginTop:14, background:"#0a0a0a", border:"none", borderRadius:2, color:"#fff", padding:"10px 24px", cursor:"pointer", fontSize:10, fontFamily:"Verdana,sans-serif", letterSpacing:1 }}>EXPLORAR GALERIAS</button>}
                </div>
              : <>
                  <p style={{ fontSize:10, color:"#bbb", fontFamily:"Verdana,sans-serif", marginBottom:18 }}>{filtered.length} obra{filtered.length!==1?"s":""}</p>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(265px, 1fr))", gap:18 }}>
                    {filtered.map(a=><Card key={a.id} art={a} onRemove={remove} onNavigate={navigate}/>)}
                  </div>
                </>
            }
          </div>
        )}

        {/* ── CURADORIA ── */}
        {tab==="curadoria" && (
          <CuradoriaTab col={col} onClickAla={ala=>{ clickAla(ala); setTab("buscar"); }}/>
        )}

        {/* ── CADASTRAR ── */}
        {tab==="manual" && (
          <div style={{ maxWidth:680 }}>
            <h2 style={{ margin:"0 0 4px", fontSize:20, fontWeight:700, fontFamily:"Verdana,sans-serif" }}>Cadastrar obra</h2>
            <p style={{ margin:"0 0 24px", fontSize:11, color:"#bbb", fontFamily:"Verdana,sans-serif" }}>Para obras de grupos, galerias e museus sem API aberta.</p>
            <ManualForm onAdd={art=>{ add(art); setTab("acervo"); }}/>
          </div>
        )}
      </main>

      <footer style={{ borderTop:"1px solid #ece9e2", padding:"14px 36px", display:"flex", justifyContent:"space-between", alignItems:"center", background:"#faf9f7" }}>
        <Logo small/>
        <p style={{ margin:0, fontSize:9, color:"#ccc", fontFamily:"Verdana,sans-serif", letterSpacing:2 }}>18 GALERIAS · MUSEUS GLOBAIS · ACERVO PESSOAL</p>
      </footer>
    </div>
  );
}

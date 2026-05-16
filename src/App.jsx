import { useState, useEffect, useCallback } from "react";

// ─── Persistência ─────────────────────────────────────────────────────────────
const loadCol  = () => { try { return JSON.parse(localStorage.getItem("germ_col")||"[]"); } catch { return []; } };
const saveCol  = col => { try { localStorage.setItem("germ_col", JSON.stringify(col)); } catch {} };
const loadLang = () => { try { return localStorage.getItem("germ_lang") || "fr"; } catch { return "fr"; } };
const saveLang = l  => { try { localStorage.setItem("germ_lang", l); } catch {} };

// ─── Rotatividade — rastreia obras vistas (30 min) ───────────────────────────
const SEEN_KEY = "germ_seen";
const SEEN_TTL = 30 * 60 * 1000;

function getSeenIds() {
  try {
    const s = sessionStorage.getItem(SEEN_KEY);
    if (!s) return [];
    const { ids, ts } = JSON.parse(s);
    if (Date.now() - ts > SEEN_TTL) { sessionStorage.removeItem(SEEN_KEY); return []; }
    return ids || [];
  } catch { return []; }
}

function addSeenIds(newIds) {
  try {
    const ids = [...new Set([...getSeenIds(), ...newIds])];
    sessionStorage.setItem(SEEN_KEY, JSON.stringify({ ids, ts: Date.now() }));
  } catch {}
}

function clearSeen() {
  try { sessionStorage.removeItem(SEEN_KEY); } catch {}
}

// ─── Traduções ────────────────────────────────────────────────────────────────
const T = {
  fr: {
    tabs: ["Rechercher", "Collection", "Curation", "Ajouter une œuvre"],
    searchDirect: "Recherche directe — œuvre, artiste, style, période...",
    searchRefine: n => `Affiner dans ${n}... (optionnel)`,
    from: "DE", to: "À",
    searching: n => n ? `Recherche dans ${n}...` : "Consultation de la base d'art mondiale...",
    found: (n, i) => `${n} œuvre${n>1?"s":""} · ${i} avec image`,
    select: "Sélectionnez une galerie ou recherchez directement",
    noImg: "image non disponible",
    explore: "Explorer à partir de cette œuvre",
    moreAla: "Plus dans cette galerie",
    samePeriod: "+ Même période",
    add: "+ COLLECTION", saved: "✓ SAUVÉ",
    details: "▼ DÉTAILS", close: "▲ FERMER",
    remove: "✕",
    wikiLink: "Voir sur Wikipedia ↗",
    empty: "Collection vide — explorez les galeries",
    browse: "EXPLORER LES GALERIES",
    filter: "Filtrer la collection...",
    allGalleries: "Toutes les galeries",
    artworks: n => `${n} œuvre${n>1?"s":""}`,
    curationTitle: "Curation",
    curationSub: "18 galeries thématiques par expérience visuelle — cliquez pour explorer.",
    addTitle: "Ajouter une œuvre",
    addSub: "Pour les œuvres de groupes, galeries et musées sans API ouverte.",
    addBtn: "Ajouter à la Collection",
    titleReq: "Titre obligatoire.",
    fields: {
      title:"Titre *", artist:"Artiste", date:"Date / Période", medium:"Technique",
      dim:"Dimensions", origin:"Origine / Pays", style:"Style / Mouvement",
      museum:"Musée / Collection", credit:"Crédits", imgUrl:"URL de l'image",
      extUrl:"Lien de référence", desc:"Description", gallery:"Galerie"
    },
    noGallery: "— sans galerie —",
    footer: "18 GALERIES · MUSÉES MONDIAUX · COLLECTION PERSONNELLE",
    global: "Collection d'Art Mondial",
    alas: {
      retratos:"Portraits", pessoas_reais:"Personnages Réels", cidades:"Villes Réelles",
      historico:"Moments Historiques", objetos:"Objets", lugares:"Lieux Connus",
      natureza:"Nature", familiar:"Ambiance Familiale", nudes:"Nus Féminins",
      esoterico:"Ésotérisme", sacro:"Sacré", arquitetura:"Architecture",
      povo:"Gens du Peuple", perspectiva:"Perspective", luz_sol:"Lumière du Soleil",
      cores:"Couleurs", fase:"Phase de l'Artiste", femininas:"Artistes Féminines",
    }
  },
  en: {
    tabs: ["Search", "Collection", "Curation", "Add Artwork"],
    searchDirect: "Direct search — artwork, artist, style, period...",
    searchRefine: n => `Refine in ${n}... (optional)`,
    from: "FROM", to: "TO",
    searching: n => n ? `Searching in ${n}...` : "Consulting global art database...",
    found: (n, i) => `${n} artwork${n>1?"s":""} · ${i} with image`,
    select: "Select a gallery or search directly",
    noImg: "image unavailable",
    explore: "Explore from this artwork",
    moreAla: "More in this gallery",
    samePeriod: "+ Same period",
    add: "+ COLLECTION", saved: "✓ SAVED",
    details: "▼ DETAILS", close: "▲ CLOSE",
    remove: "✕",
    wikiLink: "See on Wikipedia ↗",
    empty: "Empty collection — explore the galleries",
    browse: "EXPLORE GALLERIES",
    filter: "Filter collection...",
    allGalleries: "All galleries",
    artworks: n => `${n} artwork${n>1?"s":""}`,
    curationTitle: "Curation",
    curationSub: "18 thematic galleries by visual experience — click to explore.",
    addTitle: "Add Artwork",
    addSub: "For works from groups, galleries and museums without open API.",
    addBtn: "Add to Collection",
    titleReq: "Title is required.",
    fields: {
      title:"Title *", artist:"Artist", date:"Date / Period", medium:"Technique",
      dim:"Dimensions", origin:"Origin / Country", style:"Style / Movement",
      museum:"Museum / Collection", credit:"Credits", imgUrl:"Image URL",
      extUrl:"Reference link", desc:"Description", gallery:"Gallery"
    },
    noGallery: "— no gallery —",
    footer: "18 GALLERIES · GLOBAL MUSEUMS · PERSONAL COLLECTION",
    global: "Global Art Collection",
    alas: {
      retratos:"Portraits", pessoas_reais:"Real People", cidades:"Real Cities",
      historico:"Historical Moments", objetos:"Objects", lugares:"Famous Places",
      natureza:"Nature", familiar:"Home Environment", nudes:"Female Nudes",
      esoterico:"Esotericism", sacro:"Sacred", arquitetura:"Architecture",
      povo:"Common People", perspectiva:"Perspective", luz_sol:"Sunlight",
      cores:"Colors", fase:"Artist's Phase", femininas:"Female Artists",
    }
  },
  es: {
    tabs: ["Buscar", "Colección", "Curaduría", "Agregar Obra"],
    searchDirect: "Búsqueda directa — obra, artista, estilo, período...",
    searchRefine: n => `Refinar en ${n}... (opcional)`,
    from: "DESDE", to: "HASTA",
    searching: n => n ? `Buscando en ${n}...` : "Consultando base de arte global...",
    found: (n, i) => `${n} obra${n>1?"s":""} · ${i} con imagen`,
    select: "Selecciona una galería o busca directamente",
    noImg: "imagen no disponible",
    explore: "Explorar desde esta obra",
    moreAla: "Más en esta galería",
    samePeriod: "+ Mismo período",
    add: "+ COLECCIÓN", saved: "✓ GUARDADO",
    details: "▼ DETALLES", close: "▲ CERRAR",
    remove: "✕",
    wikiLink: "Ver en Wikipedia ↗",
    empty: "Colección vacía — explora las galerías",
    browse: "EXPLORAR GALERÍAS",
    filter: "Filtrar colección...",
    allGalleries: "Todas las galerías",
    artworks: n => `${n} obra${n>1?"s":""}`,
    curationTitle: "Curaduría",
    curationSub: "18 galerías temáticas por experiencia visual — haz clic para explorar.",
    addTitle: "Agregar Obra",
    addSub: "Para obras de grupos, galerías y museos sin API abierta.",
    addBtn: "Agregar a la Colección",
    titleReq: "El título es obligatorio.",
    fields: {
      title:"Título *", artist:"Artista", date:"Fecha / Período", medium:"Técnica",
      dim:"Dimensiones", origin:"Origen / País", style:"Estilo / Movimiento",
      museum:"Museo / Colección", credit:"Créditos", imgUrl:"URL de imagen",
      extUrl:"Enlace de referencia", desc:"Descripción", gallery:"Galería"
    },
    noGallery: "— sin galería —",
    footer: "18 GALERÍAS · MUSEOS GLOBALES · COLECCIÓN PERSONAL",
    global: "Colección de Arte Global",
    alas: {
      retratos:"Retratos", pessoas_reais:"Personas Reales", cidades:"Ciudades Reales",
      historico:"Momentos Históricos", objetos:"Objetos", lugares:"Lugares Conocidos",
      natureza:"Naturaleza", familiar:"Ambiente Familiar", nudes:"Desnudos Femeninos",
      esoterico:"Esoterismo", sacro:"Sacro", arquitetura:"Arquitectura",
      povo:"Gente del Pueblo", perspectiva:"Perspectiva", luz_sol:"Luz del Sol",
      cores:"Colores", fase:"Fase del Artista", femininas:"Artistas Femeninas",
    }
  },
  it: {
    tabs: ["Cerca", "Collezione", "Curatela", "Aggiungi Opera"],
    searchDirect: "Ricerca diretta — opera, artista, stile, periodo...",
    searchRefine: n => `Raffina in ${n}... (facoltativo)`,
    from: "DA", to: "A",
    searching: n => n ? `Ricerca in ${n}...` : "Consultazione del database d'arte globale...",
    found: (n, i) => `${n} opera${n>1?"e":""}` + ` · ${i} con immagine`,
    select: "Seleziona una galleria o cerca direttamente",
    noImg: "immagine non disponibile",
    explore: "Esplora da questa opera",
    moreAla: "Altro in questa galleria",
    samePeriod: "+ Stesso periodo",
    add: "+ COLLEZIONE", saved: "✓ SALVATO",
    details: "▼ DETTAGLI", close: "▲ CHIUDI",
    remove: "✕",
    wikiLink: "Vedi su Wikipedia ↗",
    empty: "Collezione vuota — esplora le gallerie",
    browse: "ESPLORA LE GALLERIE",
    filter: "Filtra la collezione...",
    allGalleries: "Tutte le gallerie",
    artworks: n => `${n} opera${n>1?"e":""}`,
    curationTitle: "Curatela",
    curationSub: "18 gallerie tematiche per esperienza visiva — clicca per esplorare.",
    addTitle: "Aggiungi Opera",
    addSub: "Per opere da gruppi, gallerie e musei senza API aperta.",
    addBtn: "Aggiungi alla Collezione",
    titleReq: "Il titolo è obbligatorio.",
    fields: {
      title:"Titolo *", artist:"Artista", date:"Data / Periodo", medium:"Tecnica",
      dim:"Dimensioni", origin:"Origine / Paese", style:"Stile / Movimento",
      museum:"Museo / Collezione", credit:"Crediti", imgUrl:"URL immagine",
      extUrl:"Link di riferimento", desc:"Descrizione", gallery:"Galleria"
    },
    noGallery: "— senza galleria —",
    footer: "18 GALLERIE · MUSEI GLOBALI · COLLEZIONE PERSONALE",
    global: "Collezione d'Arte Globale",
    alas: {
      retratos:"Ritratti", pessoas_reais:"Persone Reali", cidades:"Città Reali",
      historico:"Momenti Storici", objetos:"Oggetti", lugares:"Luoghi Noti",
      natureza:"Natura", familiar:"Ambiente Familiare", nudes:"Nudi Femminili",
      esoterico:"Esoterismo", sacro:"Sacro", arquitetura:"Architettura",
      povo:"Gente del Popolo", perspectiva:"Prospettiva", luz_sol:"Luce del Sole",
      cores:"Colori", fase:"Fase dell'Artista", femininas:"Artiste Femminili",
    }
  }
};

// ─── 18 Alas ──────────────────────────────────────────────────────────────────
const ALAS = [
  { id:"retratos",     icon:"👤", color:"#8B7355", desc:{fr:"Expression humaine dans le visage",en:"Human expression in the face",es:"Expresión humana en el rostro",it:"Espressione umana nel volto"},           hint:"portrait face expression Renaissance" },
  { id:"pessoas_reais",icon:"🧑", color:"#6B8E6B", desc:{fr:"Personnages identifiables",en:"Identifiable individuals",es:"Individuos identificables",it:"Individui identificabili"},                             hint:"real person historical figure identified" },
  { id:"cidades",      icon:"🏙", color:"#5B7FA6", desc:{fr:"Vues urbaines identifiables",en:"Identifiable urban views",es:"Vistas urbanas identificables",it:"Vedute urbane identificabili"},                   hint:"cityscape urban view known city" },
  { id:"historico",    icon:"⚔️", color:"#8B4A4A", desc:{fr:"Batailles et événements politiques",en:"Battles and political events",es:"Batallas y eventos políticos",it:"Battaglie ed eventi politici"},         hint:"historical event battle political scene" },
  { id:"objetos",      icon:"🏺", color:"#A08B5B", desc:{fr:"Natures mortes et compositions",en:"Still life and compositions",es:"Naturalezas muertas",it:"Natura morta e composizioni"},                        hint:"still life objects vanitas composition" },
  { id:"lugares",      icon:"🗺", color:"#5B8B8B", desc:{fr:"Monuments et paysages célèbres",en:"Famous monuments and landscapes",es:"Monumentos y paisajes famosos",it:"Monumenti e paesaggi famosi"},          hint:"landmark known place monument famous" },
  { id:"natureza",     icon:"🌿", color:"#5B8B5B", desc:{fr:"Paysages, faune et flore",en:"Landscapes, fauna and flora",es:"Paisajes, fauna y flora",it:"Paesaggi, fauna e flora"},                             hint:"nature landscape flora fauna countryside sea" },
  { id:"familiar",     icon:"🏠", color:"#9B7B5B", desc:{fr:"Scènes domestiques et quotidiennes",en:"Domestic and everyday scenes",es:"Escenas domésticas",it:"Scene domestiche e quotidiane"},                  hint:"domestic interior family everyday life home" },
  { id:"nudes",        icon:"🎨", color:"#9B7B7B", desc:{fr:"Art classique du nu féminin",en:"Classical art of the female nude",es:"Arte clásico del desnudo femenino",it:"Arte classica del nudo femminile"},   hint:"female nude classical Venus goddess" },
  { id:"esoterico",    icon:"🔮", color:"#7B5B9B", desc:{fr:"Symbolisme et mysticisme",en:"Symbolism and mysticism",es:"Simbolismo y misticismo",it:"Simbolismo e misticismo"},                                  hint:"esoteric mysticism symbolism alchemy" },
  { id:"sacro",        icon:"✝️", color:"#9B8B5B", desc:{fr:"Art religieux et iconographie",en:"Religious art and iconography",es:"Arte religioso e iconografía",it:"Arte religiosa e iconografia"},            hint:"sacred religious icon devotional spiritual" },
  { id:"arquitetura",  icon:"🏛", color:"#6B7B8B", desc:{fr:"Édifices, ruines et espaces",en:"Buildings, ruins and spaces",es:"Edificios, ruinas y espacios",it:"Edifici, rovine e spazi"},                     hint:"architecture building ruins interior" },
  { id:"povo",         icon:"🧑‍🤝‍🧑", color:"#8B7B5B", desc:{fr:"Paysans et vie simple",en:"Peasants and simple life",es:"Campesinos y vida simple",it:"Contadini e vita semplice"},                     hint:"peasant worker common people folk" },
  { id:"perspectiva",  icon:"📐", color:"#5B6B8B", desc:{fr:"La profondeur comme élément central",en:"Depth as central element",es:"La profundidad como elemento central",it:"La profondità come elemento centrale"}, hint:"perspective depth optical illusion" },
  { id:"luz_sol",      icon:"☀️", color:"#A08B3B", desc:{fr:"La lumière naturelle comme protagoniste",en:"Natural light as protagonist",es:"La luz natural como protagonista",it:"La luce naturale come protagonista"}, hint:"sunlight natural light dawn sunset luminism" },
  { id:"cores",        icon:"🌈", color:"#7B5B9B", desc:{fr:"La couleur comme langage expressif",en:"Color as expressive language",es:"El color como lenguaje expresivo",it:"Il colore come linguaggio espressivo"}, hint:"color chromatic fauvism expressionism vibrant" },
  { id:"fase",         icon:"🖌️", color:"#5B8B7B", desc:{fr:"Une période dans la carrière de l'artiste",en:"A period in the artist's career",es:"Un período en la carrera del artista",it:"Un periodo nella carriera dell'artista"}, hint:"artist period early work mature late style" },
  { id:"femininas",    icon:"👩‍🎨", color:"#9B5B8B", desc:{fr:"Grandes artistes femmes",en:"Great women artists",es:"Grandes artistas mujeres",it:"Grandi artiste donne"},                                   hint:"female artist woman painter Frida Kahlo Mary Cassatt" },
];

// ─── Lua ──────────────────────────────────────────────────────────────────────
function getMoonPhase() {
  const now=new Date(), ref=new Date("2000-01-06T18:14:00Z"), cycle=29.53058867;
  const age=(((now-ref)/86400000)%cycle+cycle)%cycle;
  const idx=Math.floor((age/cycle)*8)%8;
  const p=["🌑","🌒","🌓","🌔","🌕","🌖","🌗","🌘"];
  return { emoji:p[idx], age:Math.round(age) };
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

// ─── Busca ────────────────────────────────────────────────────────────────────
async function searchArt(query, ala, fromYear, toYear, lang) {
  const p = new URLSearchParams({ q: query, lang: lang || "fr" });
  if (ala) { p.append("ala", ala.nameEn||ala.id); p.append("alaHint", ala.hint||""); p.append("alaId", ala.id); }
  if (fromYear) p.append("fromYear", fromYear);
  if (toYear)   p.append("toYear", toYear);
  // Envia IDs já vistos para o servidor excluir (rotatividade)
  const seen = getSeenIds();
  if (seen.length > 0) p.append("exclude", seen.slice(0, 80).join(","));
  const res = await fetch(`/api/search?${p}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  const results = (data.results || []).map((o, i) => ({ ...o, id: o.id || `art_${Date.now()}_${i}` }));
  // Marca obras retornadas como vistas
  addSeenIds(results.map(r => r.id));
  return results;
}

// ─── Logo ─────────────────────────────────────────────────────────────────────
function Logo({ small }) {
  const n=small?16:40, d=small?26:68, a=small?16:44;
  return (
    <div style={{ display:"flex", alignItems:"baseline", lineHeight:1, userSelect:"none" }}>
      <span style={{ fontFamily:"Verdana,Geneva,sans-serif", fontSize:n, fontWeight:700, color:"#111", letterSpacing:small?"0.04em":"0.04em", textTransform:"uppercase" }}>Germanus</span>
      <span style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:d, fontWeight:700, color:"#1545c7", margin:"0 1px" }}>.</span>
      <span style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:a, fontWeight:700, color:"#d41515", letterSpacing:"-0.02em" }}>Art</span>
    </div>
  );
}

// ─── Seletor de idioma ────────────────────────────────────────────────────────
function LangSwitcher({ lang, setLang }) {
  const langs = [
    { code:"fr", flag:"🇫🇷" },
    { code:"en", flag:"🇬🇧" },
    { code:"es", flag:"🇪🇸" },
    { code:"it", flag:"🇮🇹" },
  ];
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
      {langs.map(l => (
        <button key={l.code} onClick={() => { setLang(l.code); saveLang(l.code); }}
          style={{
            background:"none", border:"none", cursor:"pointer",
            fontSize:20, lineHeight:1, padding:"2px 3px",
            opacity: lang===l.code ? 1 : 0.35,
            borderBottom: lang===l.code ? "2px solid #0a0a0a" : "2px solid transparent",
            transition:"all .2s"
          }}>
          {l.flag}
        </button>
      ))}
    </div>
  );
}

// ─── Barra ambiente ───────────────────────────────────────────────────────────
function AmbientBar() {
  const [moon, setMoon]       = useState(null);
  const [weather, setWeather] = useState(null);
  const [wL, setWL]           = useState(true);
  useEffect(() => {
    setMoon(getMoonPhase());
    getWeather().then(w => { setWeather(w); setWL(false); });
  }, []);
  const s = { fontSize:10, color:"#999", fontFamily:"Verdana,sans-serif", letterSpacing:.3 };
  return (
    <div style={{ background:"#f5f4f0", borderBottom:"1px solid #ece9e2", padding:"5px 36px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
      <span style={s}>{moon?.emoji} · día {moon?.age}</span>
      <span style={s}>{wL?"···":weather?`${weather.icon} ${weather.temp}°C${weather.city?` · ${weather.city}`:""}` : "—"}</span>
    </div>
  );
}

// ─── Botão de ala — texto, padding 3mm (≈11px) ───────────────────────────────
function AlaBtn({ name, ala, active, onClick }) {
  const [h,setH] = useState(false);
  const hot = active || h;
  return (
    <button onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      style={{
        display:"flex", alignItems:"center",
        padding:"7px 14px",
        background: hot
          ? `linear-gradient(90deg, ${ala.color}45 0%, ${ala.color}12 50%, #faf9f7 100%)`
          : `linear-gradient(90deg, ${ala.color}18 0%, ${ala.color}05 50%, #faf9f7 100%)`,
        border:"1px solid",
        borderColor: hot ? `${ala.color}66` : "#e8e4dc",
        borderLeft: `3px solid ${active ? ala.color : hot ? ala.color+"aa" : "#e0dbd0"}`,
        borderRadius:3, cursor:"pointer", transition:"all .18s",
        textAlign:"left", width:"100%",
        boxShadow: active ? `0 2px 8px ${ala.color}22` : "none",
      }}>
      <span style={{
        margin:0, fontSize:12, lineHeight:"1",
        fontFamily:"Verdana,sans-serif",
        fontWeight: active ? 700 : 500,
        color: active ? "#0a0a0a" : "#2a2a2a",
        letterSpacing:".3px", display:"block",
      }}>{name}</span>
    </button>
  );
}

// ─── Card de obra ─────────────────────────────────────────────────────────────
function Card({ art, onAdd, onRemove, inCollection, onNavigate, t }) {
  const [open,setOpen]    = useState(false);
  const [imgErr,setImgErr]= useState(false);
  const [imgOk,setImgOk]  = useState(false);
  const nav=(q,id)=>onNavigate&&onNavigate(q,id);
  const ala = ALAS.find(a=>a.id===art.alaId);

  return (
    <div style={{ background:"#fff", border:"1px solid #e8e4dc", borderRadius:3, overflow:"hidden", display:"flex", flexDirection:"column", transition:"border-color .18s, box-shadow .18s" }}
      onMouseEnter={e=>{ e.currentTarget.style.borderColor="#aaa"; e.currentTarget.style.boxShadow="3px 3px 0 #0a0a0a20"; }}
      onMouseLeave={e=>{ e.currentTarget.style.borderColor="#e8e4dc"; e.currentTarget.style.boxShadow="none"; }}>

      <div style={{ height:210, background:"#f2f0eb", borderBottom:"1px solid #ece9e2", overflow:"hidden", position:"relative", display:"flex", alignItems:"center", justifyContent:"center" }}>
        {art.imageUrl&&!imgErr?(
          <>
            {!imgOk&&<div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"#f2f0eb" }}><div style={{ width:20, height:20, border:"2px solid #ddd", borderTopColor:"#888", borderRadius:"50%", animation:"spin 1s linear infinite" }}/></div>}
            <img src={art.imageUrl} alt={art.title} style={{ width:"100%", height:"100%", objectFit:"cover", opacity:imgOk?1:0, transition:"opacity .3s" }} onLoad={()=>setImgOk(true)} onError={()=>setImgErr(true)}/>
          </>
        ):(
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, padding:12, textAlign:"center" }}>
            <span style={{ fontSize:24, opacity:.1 }}>🖼</span>
            <span style={{ fontSize:9, color:"#bbb", fontFamily:"monospace", letterSpacing:1.5, textTransform:"uppercase" }}>{t.noImg}</span>
            {art.externalUrl&&<a href={art.externalUrl} target="_blank" rel="noreferrer" style={{ fontSize:9, color:"#aaa", fontFamily:"monospace" }}>wikipedia ↗</a>}
          </div>
        )}
        {ala&&<div style={{ position:"absolute", top:7, left:7, background:`${ala.color}ee`, borderRadius:2, padding:"2px 7px" }}><span style={{ fontSize:9, color:"#fff", fontFamily:"Verdana,sans-serif", letterSpacing:.5 }}>{t.alas[ala.id]}</span></div>}
      </div>

      <div style={{ padding:"13px", flex:1, display:"flex", flexDirection:"column", gap:5 }}>
        <h3 style={{ margin:0, fontSize:13.5, fontFamily:"'Cormorant Garamond',serif", fontStyle:"italic", fontWeight:600, color:"#0a0a0a", lineHeight:1.35 }}>{art.title}</h3>
        <p style={{ margin:0, fontSize:12, color:"#444", cursor:"pointer" }}
          onClick={()=>nav(art.artist?.split("(")[0].trim())}
          onMouseEnter={e=>e.target.style.color="#1a3a6e"} onMouseLeave={e=>e.target.style.color="#444"}>
          {art.artist}
        </p>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {art.date&&<span style={{ fontSize:10.5, color:"#aaa", fontFamily:"monospace" }}>{art.date}</span>}
          {art.origin&&<span onClick={()=>nav(art.origin)} style={{ fontSize:10.5, color:"#888", fontFamily:"monospace", cursor:"pointer", borderBottom:"1px dotted #ccc" }} onMouseEnter={e=>e.target.style.color="#1a3a6e"} onMouseLeave={e=>e.target.style.color="#888"}>🌍 {art.origin}</span>}
          {art.style&&<span onClick={()=>nav(art.style)} style={{ fontSize:10.5, color:"#888", fontFamily:"monospace", cursor:"pointer", borderBottom:"1px dotted #ccc" }} onMouseEnter={e=>e.target.style.color="#1a3a6e"} onMouseLeave={e=>e.target.style.color="#888"}>🎨 {art.style}</span>}
        </div>
        {art.museum&&<p style={{ margin:0, fontSize:11, color:"#555", borderLeft:"2px solid #1a3a6e", paddingLeft:7, lineHeight:1.4, cursor:"pointer" }} onClick={()=>nav(art.museum?.split(",")[0])} onMouseEnter={e=>e.currentTarget.style.color="#1a3a6e"} onMouseLeave={e=>e.currentTarget.style.color="#555"}>{art.museum}</p>}
        {art.medium&&<p style={{ margin:0, fontSize:10.5, color:"#bbb" }}>{art.medium.slice(0,80)}{art.medium.length>80?"…":""}</p>}

        {open&&(
          <div style={{ borderTop:"1px solid #f0ece4", paddingTop:9, display:"flex", flexDirection:"column", gap:5 }}>
            {art.dimensions&&<p style={{ margin:0, fontSize:10.5, color:"#bbb", fontFamily:"monospace" }}>{art.dimensions}</p>}
            {art.description&&<p style={{ margin:0, fontSize:13, color:"#444", lineHeight:1.65, fontFamily:"'Cormorant Garamond',serif" }}>{art.description}</p>}
            {art.credit&&<p style={{ margin:0, fontSize:10, color:"#ccc", fontStyle:"italic" }}>{art.credit}</p>}
            {art.externalUrl&&<a href={art.externalUrl} target="_blank" rel="noreferrer" style={{ color:"#1a3a6e", fontSize:11, fontFamily:"monospace" }}>{t.wikiLink}</a>}
            {onNavigate&&(
              <div style={{ borderTop:"1px solid #f5f0e8", paddingTop:7 }}>
                <p style={{ margin:"0 0 5px", fontSize:9, color:"#bbb", fontFamily:"Verdana,sans-serif", letterSpacing:1, textTransform:"uppercase" }}>{t.explore}</p>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                  {art.artist&&<NavBtn onClick={()=>nav(art.artist?.split("(")[0].trim())}>+ {art.artist?.split("(")[0].trim()}</NavBtn>}
                  {art.style&&<NavBtn onClick={()=>nav(art.style)}>+ {art.style}</NavBtn>}
                  {art.alaId&&<NavBtn onClick={()=>nav("",art.alaId)} blue>{t.moreAla}</NavBtn>}
                  {art.date&&art.style&&<NavBtn onClick={()=>nav(`${art.style} ${art.date?.slice(0,4)}`)}>+ {t.samePeriod.replace("+ ","")}</NavBtn>}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display:"flex", gap:5, marginTop:"auto", paddingTop:8, borderTop:"1px solid #f5f0e8" }}>
          <Btn outline onClick={()=>setOpen(v=>!v)}>{open?t.close:t.details}</Btn>
          {onAdd&&!inCollection&&<Btn filled onClick={()=>onAdd(art)}>{t.add}</Btn>}
          {onAdd&&inCollection&&<Chip>{t.saved}</Chip>}
          {onRemove&&<Btn danger onClick={()=>onRemove(art.id)}>{t.remove}</Btn>}
        </div>
      </div>
    </div>
  );
}

function NavBtn({ children, onClick, blue }) {
  const [h,setH]=useState(false);
  return <button onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} style={{ background:h?(blue?"#1a3a6e":"#0a0a0a"):"#fff", border:`1px solid ${blue?(h?"#1a3a6e":"#c8d4e8"):(h?"#0a0a0a":"#e0dbd0")}`, borderRadius:2, color:h?"#fff":(blue?"#1a3a6e":"#777"), padding:"4px 9px", cursor:"pointer", fontSize:9.5, fontFamily:"Verdana,sans-serif", letterSpacing:.3, transition:"all .15s", whiteSpace:"nowrap" }}>{children}</button>;
}
function Btn({ children, onClick, filled, danger, outline }) {
  const [h,setH]=useState(false);
  const s={flex:danger?0:1,padding:danger?"6px 9px":"7px 0",cursor:"pointer",fontSize:9.5,fontFamily:"Verdana,sans-serif",letterSpacing:.5,borderRadius:2,border:"1px solid",transition:"all .15s"};
  const c=filled?{background:h?"#333":"#0a0a0a",borderColor:"#0a0a0a",color:"#fff"}:danger?{background:"#fff",borderColor:h?"#b22222":"#ddd",color:h?"#b22222":"#ccc"}:{background:"#fff",borderColor:h?"#0a0a0a":"#ddd",color:h?"#0a0a0a":"#aaa"};
  return <button onClick={onClick} style={{...s,...c}} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}>{children}</button>;
}
function Chip({ children }) {
  return <span style={{ flex:1, textAlign:"center", fontSize:9.5, color:"#aaa", padding:"7px 0", border:"1px solid #eee", borderRadius:2, fontFamily:"Verdana,sans-serif" }}>{children}</span>;
}

// ─── Filtro de anos ───────────────────────────────────────────────────────────
function YearRange({ from, to, onFrom, onTo, t }) {
  const inp={background:"#fff",border:"1px solid #e0dbd0",borderRadius:2,color:"#333",padding:"5px 8px",fontSize:11,outline:"none",fontFamily:"Verdana,sans-serif",width:72,textAlign:"center"};
  return (
    <div style={{ display:"flex", alignItems:"center", gap:7 }}>
      <span style={{ fontSize:9.5, color:"#aaa", fontFamily:"Verdana,sans-serif" }}>{t.from}</span>
      <input type="number" placeholder="1400" value={from} onChange={e=>onFrom(e.target.value)} style={inp}/>
      <span style={{ fontSize:9.5, color:"#aaa", fontFamily:"Verdana,sans-serif" }}>{t.to}</span>
      <input type="number" placeholder="2025" value={to} onChange={e=>onTo(e.target.value)} style={inp}/>
      {(from||to)&&<button onClick={()=>{onFrom("");onTo("");}} style={{ background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:12 }}>✕</button>}
    </div>
  );
}

// ─── Formulário manual ────────────────────────────────────────────────────────
const EMPTY={title:"",artist:"",date:"",medium:"",dimensions:"",origin:"",style:"",museum:"",description:"",imageUrl:"",externalUrl:"",credit:"",alaId:""};
function ManualForm({ onAdd, t }) {
  const [f,setF]=useState(EMPTY);
  const s=(k,v)=>setF(x=>({...x,[k]:v}));
  const base={width:"100%",background:"#fff",border:"1px solid #e0dbd0",borderRadius:2,color:"#0a0a0a",padding:"9px 11px",fontSize:13,outline:"none",fontFamily:"'Cormorant Garamond',serif"};
  const inp=(label,key,rows)=>(
    <div style={{ display:"flex",flexDirection:"column",gap:4 }}>
      <label style={{ fontSize:9.5,color:"#aaa",fontFamily:"Verdana,sans-serif",letterSpacing:1,textTransform:"uppercase" }}>{label}</label>
      {rows?<textarea rows={rows} value={f[key]} onChange={e=>s(key,e.target.value)} style={{...base,resize:"vertical"}}/>:<input value={f[key]} onChange={e=>s(key,e.target.value)} style={base}/>}
    </div>
  );
  return (
    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:13 }}>
      <div style={{ gridColumn:"1/-1" }}>{inp(t.fields.title,"title")}</div>
      {inp(t.fields.artist,"artist")} {inp(t.fields.date,"date")}
      {inp(t.fields.medium,"medium")} {inp(t.fields.dim,"dimensions")}
      {inp(t.fields.origin,"origin")} {inp(t.fields.style,"style")}
      {inp(t.fields.museum,"museum")} {inp(t.fields.credit,"credit")}
      <div style={{ gridColumn:"1/-1" }}>
        <label style={{ fontSize:9.5,color:"#aaa",fontFamily:"Verdana,sans-serif",letterSpacing:1,textTransform:"uppercase",display:"block",marginBottom:4 }}>{t.fields.gallery}</label>
        <select value={f.alaId} onChange={e=>s("alaId",e.target.value)} style={{...base,cursor:"pointer"}}>
          <option value="">{t.noGallery}</option>
          {ALAS.map(a=><option key={a.id} value={a.id}>{t.alas[a.id]}</option>)}
        </select>
      </div>
      <div style={{ gridColumn:"1/-1" }}>{inp(t.fields.imgUrl,"imageUrl")}</div>
      <div style={{ gridColumn:"1/-1" }}>{inp(t.fields.extUrl,"externalUrl")}</div>
      <div style={{ gridColumn:"1/-1" }}>{inp(t.fields.desc,"description",4)}</div>
      <div style={{ gridColumn:"1/-1" }}>
        <button onClick={()=>{ if(!f.title.trim()) return alert(t.titleReq); onAdd({...f,id:`m_${Date.now()}`,source:"manual"}); setF(EMPTY); }} style={{ width:"100%",background:"#0a0a0a",border:"none",borderRadius:2,color:"#fff",padding:"13px 0",cursor:"pointer",fontSize:11,fontFamily:"Verdana,sans-serif",letterSpacing:1,textTransform:"uppercase" }}>{t.addBtn}</button>
      </div>
    </div>
  );
}

// ─── Curadoria ────────────────────────────────────────────────────────────────
function CuradoriaTab({ col, onClickAla, t, lang }) {
  const count=id=>col.filter(a=>a.alaId===id).length;
  return (
    <div>
      <h2 style={{ margin:"0 0 4px",fontSize:20,fontWeight:700,fontFamily:"Verdana,sans-serif",color:"#0a0a0a" }}>{t.curationTitle}</h2>
      <p style={{ margin:"0 0 22px",fontSize:12,color:"#aaa",fontFamily:"Verdana,sans-serif",lineHeight:1.6 }}>{t.curationSub}</p>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(min(100%, 280px), 1fr))",gap:8 }}>
        {ALAS.map(ala=>{
          const c=count(ala.id);
          return (
            <button key={ala.id} onClick={()=>onClickAla(ala)}
              style={{ display:"flex",alignItems:"center",gap:10,padding:"11px 14px",background:`linear-gradient(90deg, ${ala.color}18 0%, transparent 100%)`,border:`1px solid ${ala.color}33`,borderLeft:`3px solid ${ala.color}`,borderRadius:3,cursor:"pointer",textAlign:"left",transition:"all .18s" }}
              onMouseEnter={e=>{ e.currentTarget.style.background=`linear-gradient(90deg, ${ala.color}35 0%, transparent 100%)`; e.currentTarget.style.borderColor=`${ala.color}66`; }}
              onMouseLeave={e=>{ e.currentTarget.style.background=`linear-gradient(90deg, ${ala.color}18 0%, transparent 100%)`; e.currentTarget.style.borderColor=`${ala.color}33`; }}>
              <div style={{ flex:1,minWidth:0 }}>
                <p style={{ margin:0,fontSize:12,fontFamily:"Verdana,sans-serif",fontWeight:600,color:"#0a0a0a",lineHeight:"1" }}>{t.alas[ala.id]}</p>
                <p style={{ margin:"3px 0 0",fontSize:10.5,color:"#aaa",fontFamily:"'Cormorant Garamond',serif",fontStyle:"italic",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis" }}>{ala.desc[lang]}</p>
              </div>
              {c>0&&<span style={{ fontSize:9.5,color:ala.color,background:`${ala.color}18`,border:`1px solid ${ala.color}33`,borderRadius:10,padding:"1px 6px",fontFamily:"Verdana,sans-serif",flexShrink:0 }}>{c}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [lang,setLang]     = useState(loadLang);
  const t = T[lang];

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

  useEffect(()=>{ setCol(loadCol()); },[]);

  const add    = useCallback(art=>setCol(p=>{if(p.find(a=>a.id===art.id))return p;const n=[art,...p];saveCol(n);return n;}),[]);
  const remove = useCallback(id=>setCol(p=>{const n=p.filter(a=>a.id!==id);saveCol(n);return n;}),[]);

  const clickAla = useCallback(async (ala) => {
    if (activeAla?.id===ala.id) { setAla(null);setRes([]);setPhase("idle");return; }
    setAla(ala);setRes([]);setErr("");setPhase("searching");setTab("buscar");
    try {
      const arts = await searchArt(ala.hint, ala, fromYear, toYear, lang);
      setRes(arts);setPhase("done");
    } catch(e){setErr(e.message);setPhase("error");}
  },[activeAla,fromYear,toYear]);

  const doSearch = async () => {
    if (!query.trim()||phase==="searching") return;
    setRes([]);setErr("");setPhase("searching");
    try {
      const arts = await searchArt(query, activeAla, fromYear, toYear, lang);
      setRes(arts);setPhase("done");
    } catch(e){setErr(e.message);setPhase("error");}
  };

  const navigate = useCallback((term,alaId)=>{
    const ala=alaId?ALAS.find(a=>a.id===alaId):activeAla;
    if(alaId)setAla(ALAS.find(a=>a.id===alaId)||null);
    if(term)setQuery(term);
    setTab("buscar");setRes([]);setPhase("idle");
    setTimeout(async()=>{
      setPhase("searching");
      try{const arts=await searchArt(term||query,ala,fromYear,toYear,lang);setRes(arts);setPhase("done");}
      catch(e){setErr(e.message);setPhase("error");}
    },50);
  },[activeAla,query,fromYear,toYear]);

  const busy=phase==="searching";
  const ids=new Set(col.map(a=>a.id));
  const filtered=col.filter(a=>{
    const txt=!filter||[a.title,a.artist,a.style,a.origin,a.museum].some(v=>v?.toLowerCase().includes(filter.toLowerCase()));
    const ala=!filterAla||a.alaId===filterAla;
    return txt&&ala;
  });

  const TABS=[
    {id:"buscar",   label:t.tabs[0]},
    {id:"acervo",   label:`${t.tabs[1]}${col.length?` (${col.length})`:""}`},
    {id:"curadoria",label:t.tabs[2]},
    {id:"manual",   label:t.tabs[3]},
  ];

  return (
    <div style={{ minHeight:"100vh",background:"#faf9f7",color:"#0a0a0a",fontFamily:"'Cormorant Garamond',Georgia,serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap" rel="stylesheet"/>
      <style>{`*{box-sizing:border-box}@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <AmbientBar/>

      <header style={{ background:"#faf9f7",borderBottom:"1px solid #e8e4dc",padding:"18px 36px 0" }}>
        <div style={{ maxWidth:1300,margin:"0 auto" }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:16 }}>
            <Logo/>
            <div style={{ display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6 }}>
              <LangSwitcher lang={lang} setLang={setLang}/>
              <p style={{ margin:0,fontSize:9,color:"#bbb",fontFamily:"Verdana,sans-serif",letterSpacing:2,textTransform:"uppercase" }}>{t.global}</p>
            </div>
          </div>
          <nav style={{ display:"flex" }}>
            {TABS.map(tb=>(
              <button key={tb.id} onClick={()=>setTab(tb.id)} style={{ background:"none",border:"none",borderBottom:tab===tb.id?"2px solid #0a0a0a":"2px solid transparent",color:tab===tb.id?"#0a0a0a":"#aaa",padding:"9px 20px 9px 0",marginRight:4,cursor:"pointer",fontSize:10.5,fontFamily:"Verdana,sans-serif",letterSpacing:1,textTransform:"uppercase",transition:"color .18s" }}>{tb.label}</button>
            ))}
          </nav>
        </div>
      </header>

      <main style={{ maxWidth:1300,margin:"0 auto",padding:"30px 36px" }}>

        {/* BUSCAR */}
        {tab==="buscar"&&(
          <div>
            <div style={{ display:"flex",alignItems:"center",borderBottom:`2px solid ${activeAla?activeAla.color:"#0a0a0a"}`,marginBottom:18,paddingBottom:2,transition:"border-color .3s" }}>
              <input
                placeholder={activeAla?t.searchRefine(t.alas[activeAla.id]):t.searchDirect}
                value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSearch()}
                style={{ flex:1,background:"transparent",border:"none",color:"#0a0a0a",padding:"11px 0",fontSize:17,outline:"none",fontFamily:"'Cormorant Garamond',serif",fontStyle:"italic" }}
              />
              {query.trim()&&(
                <button onClick={doSearch} disabled={busy}
                  style={{ background:"none",border:"none",cursor:busy?"default":"pointer",fontSize:10.5,fontFamily:"Verdana,sans-serif",letterSpacing:2,color:busy?"#ccc":"#0a0a0a",paddingLeft:16,whiteSpace:"nowrap" }}>
                  {busy?<span style={{ display:"inline-block",animation:"spin 1s linear infinite" }}>⟳</span>:`${t.tabs[0].toUpperCase()} →`}
                </button>
              )}
            </div>

            <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:14 }}>
              <YearRange from={fromYear} to={toYear} onFrom={setFrom} onTo={setTo} t={t}/>
            </div>

            <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(min(100%, 280px), 1fr))",gap:6,marginBottom:22 }}>
              {ALAS.map(ala=>(
                <AlaBtn key={ala.id} name={t.alas[ala.id]} ala={ala} active={activeAla?.id===ala.id} onClick={()=>clickAla(ala)}/>
              ))}
            </div>

            {phase==="searching"&&<div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:14 }}><div style={{ width:6,height:6,borderRadius:"50%",background:"#ccc",animation:"spin 1s linear infinite" }}/><span style={{ fontSize:10.5,color:"#aaa",fontFamily:"Verdana,sans-serif" }}>{t.searching(activeAla?t.alas[activeAla.id]:null)}</span></div>}
            {phase==="done"&&results.length>0&&<p style={{ fontSize:10.5,color:"#aaa",fontFamily:"Verdana,sans-serif",marginBottom:14 }}>{t.found(results.length,results.filter(r=>r.imageUrl).length)}</p>}
            {phase==="error"&&<p style={{ fontSize:10.5,color:"#b22222",fontFamily:"Verdana,sans-serif",marginBottom:14 }}>Erreur: {errMsg}</p>}

            {results.length>0&&(
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(265px, 1fr))",gap:18 }}>
                {results.map(a=><Card key={a.id} art={a} onAdd={add} inCollection={ids.has(a.id)} onNavigate={navigate} t={t}/>)}
              </div>
            )}

            {phase==="idle"&&results.length===0&&(
              <div style={{ textAlign:"center",paddingTop:18,borderTop:"1px solid #f0ece4" }}>
                <p style={{ fontSize:10,color:"#ccc",fontFamily:"Verdana,sans-serif",letterSpacing:1,textTransform:"uppercase" }}>{t.select}</p>
              </div>
            )}
          </div>
        )}

        {/* ACERVO */}
        {tab==="acervo"&&(
          <div>
            {col.length>0&&(
              <div style={{ display:"flex",gap:10,marginBottom:18,flexWrap:"wrap",alignItems:"center" }}>
                <input placeholder={t.filter} value={filter} onChange={e=>setFilt(e.target.value)}
                  style={{ flex:1,minWidth:180,background:"#fff",border:"1px solid #e0dbd0",borderRadius:2,color:"#0a0a0a",padding:"9px 12px",fontSize:13,outline:"none",fontFamily:"'Cormorant Garamond',serif",fontStyle:"italic" }}/>
                <select value={filterAla} onChange={e=>setFA(e.target.value)}
                  style={{ background:"#fff",border:"1px solid #e0dbd0",borderRadius:2,color:filterAla?"#0a0a0a":"#aaa",padding:"9px 12px",fontSize:11,outline:"none",cursor:"pointer",fontFamily:"Verdana,sans-serif" }}>
                  <option value="">{t.allGalleries}</option>
                  {ALAS.map(a=><option key={a.id} value={a.id}>{t.alas[a.id]}</option>)}
                </select>
                {(filter||filterAla)&&<button onClick={()=>{setFilt("");setFA("");}} style={{ background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:16 }}>✕</button>}
              </div>
            )}
            {filtered.length===0
              ?<div style={{ textAlign:"center",padding:"80px 0" }}>
                  <div style={{ opacity:.06,marginBottom:16,display:"inline-block" }}><Logo/></div>
                  <p style={{ fontSize:11,color:"#ccc",fontFamily:"Verdana,sans-serif" }}>{col.length===0?t.empty:"—"}</p>
                  {col.length===0&&<button onClick={()=>setTab("buscar")} style={{ marginTop:14,background:"#0a0a0a",border:"none",borderRadius:2,color:"#fff",padding:"10px 24px",cursor:"pointer",fontSize:10,fontFamily:"Verdana,sans-serif",letterSpacing:1 }}>{t.browse}</button>}
                </div>
              :<>
                  <p style={{ fontSize:10,color:"#bbb",fontFamily:"Verdana,sans-serif",marginBottom:16 }}>{t.artworks(filtered.length)}</p>
                  <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(265px, 1fr))",gap:18 }}>
                    {filtered.map(a=><Card key={a.id} art={a} onRemove={remove} onNavigate={navigate} t={t}/>)}
                  </div>
                </>
            }
          </div>
        )}

        {/* CURADORIA */}
        {tab==="curadoria"&&<CuradoriaTab col={col} onClickAla={ala=>{clickAla(ala);setTab("buscar");}} t={t} lang={lang}/>}

        {/* MANUAL */}
        {tab==="manual"&&(
          <div style={{ maxWidth:680 }}>
            <h2 style={{ margin:"0 0 4px",fontSize:20,fontWeight:700,fontFamily:"Verdana,sans-serif" }}>{t.addTitle}</h2>
            <p style={{ margin:"0 0 24px",fontSize:11,color:"#bbb",fontFamily:"Verdana,sans-serif" }}>{t.addSub}</p>
            <ManualForm onAdd={art=>{add(art);setTab("acervo");}} t={t}/>
          </div>
        )}
      </main>

      <footer style={{ borderTop:"1px solid #ece9e2",padding:"14px 36px",display:"flex",justifyContent:"space-between",alignItems:"center",background:"#faf9f7" }}>
        <Logo small/>
        <p style={{ margin:0,fontSize:9,color:"#ccc",fontFamily:"Verdana,sans-serif",letterSpacing:2 }}>{t.footer}</p>
      </footer>
    </div>
  );
}

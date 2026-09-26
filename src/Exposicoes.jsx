// src/Exposicoes.jsx — Aba Exposições · GERMANUS.Art
//
// Substitui o conteúdo da aba que hoje é "Curadoria".
// Duas vistas num componente só:
//   · lista das exposições publicadas
//   · a sala: obras lado a lado numa parede, na ordem definida em /colecoes
//
// A ordem é o argumento da exposição — por isso a sala é uma faixa horizontal
// percorrida da esquerda para a direita, e não uma grade.
//
// Uso em App.jsx:  <Exposicoes lang={lang} />

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

const TX = {
  fr: { titulo:"Expositions", sub:"Parcours ordonnés à travers les 18 galeries — l'ordre est l'argument.",
        obras:n=>`${n} œuvre${n>1?"s":""}`, entrar:"Entrer →", voltar:"← Toutes les expositions",
        vazio:"Aucune exposition pour le moment.", dica:"Faites défiler la salle →" },
  en: { titulo:"Exhibitions", sub:"Ordered paths across the 18 galleries — the sequence is the argument.",
        obras:n=>`${n} work${n>1?"s":""}`, entrar:"Enter →", voltar:"← All exhibitions",
        vazio:"No exhibitions yet.", dica:"Scroll the room →" },
  es: { titulo:"Exposiciones", sub:"Recorridos ordenados por las 18 galerías — el orden es el argumento.",
        obras:n=>`${n} obra${n>1?"s":""}`, entrar:"Entrar →", voltar:"← Todas las exposiciones",
        vazio:"Aún no hay exposiciones.", dica:"Recorra la sala →" },
  pt: { titulo:"Exposições", sub:"Percursos ordenados através das 18 galerias — a ordem é o argumento.",
        obras:n=>`${n} obra${n>1?"s":""}`, entrar:"Entrar →", voltar:"← Todas as exposições",
        vazio:"Ainda não há exposições.", dica:"Percorra a sala →" },
  it: { titulo:"Mostre", sub:"Percorsi ordinati attraverso le 18 gallerie — l'ordine è l'argomento.",
        obras:n=>`${n} opera${n>1?"e":""}`, entrar:"Entrare →", voltar:"← Tutte le mostre",
        vazio:"Ancora nessuna mostra.", dica:"Percorri la sala →" },
  de: { titulo:"Ausstellungen", sub:"Geordnete Wege durch die 18 Galerien — die Reihenfolge ist das Argument.",
        obras:n=>`${n} Werk${n>1?"e":""}`, entrar:"Eintreten →", voltar:"← Alle Ausstellungen",
        vazio:"Noch keine Ausstellungen.", dica:"Den Saal entlang →" },
};

// ─── Lightbox simples (independente do ZoomViewer do App) ────────────────────
function Lupa({ obra, onFechar }) {
  useEffect(() => {
    const esc = e => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [onFechar]);

  return createPortal(
    <div onClick={onFechar}
      style={{ position:"fixed", inset:0, zIndex:99999, background:"rgba(10,10,10,.95)",
               display:"flex", flexDirection:"column", alignItems:"center",
               justifyContent:"center", padding:"4vh 4vw", gap:14 }}>
      <img src={obra.imageHd || obra.imageUrl} alt={obra.title}
        style={{ maxWidth:"100%", maxHeight:"82vh", objectFit:"contain" }}/>
      <div style={{ textAlign:"center", maxWidth:"70ch" }}>
        <p style={{ margin:0, color:"#eee", fontSize:15,
                    fontFamily:"'Cormorant Garamond',Georgia,serif" }}>
          {obra.title} <span style={{ color:"#999" }}>· {obra.artist}{obra.date ? `, ${obra.date}` : ""}</span>
        </p>
        {obra.museum && <p style={{ margin:"4px 0 0", color:"#777", fontSize:10,
          fontFamily:"Verdana,sans-serif", letterSpacing:1 }}>{obra.museum}</p>}
      </div>
    </div>, document.body);
}

export default function Exposicoes({ lang = "fr" }) {
  const x = TX[lang] || TX.fr;

  const [lista, setLista]   = useState([]);
  const [aberta, setAberta] = useState(null);   // { colecao, results }
  const [carregando, setCarregando] = useState(true);
  const [lupa, setLupa]     = useState(null);

  useEffect(() => {
    fetch("/api/colecoes").then(r => r.json())
      .then(d => { setLista(d.colecoes || []); setCarregando(false); })
      .catch(() => setCarregando(false));
  }, []);

  async function entrar(slug) {
    setCarregando(true);
    try {
      const d = await (await fetch(`/api/colecao/${encodeURIComponent(slug)}`)).json();
      setAberta(d);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {}
    setCarregando(false);
  }

  const tit = c => c?.[`titulo_${lang}`] || c?.titulo_pt || "";
  const txt = c => c?.[`texto_${lang}`] || c?.texto_pt || "";

  // ─── A sala ────────────────────────────────────────────────────────────────
  if (aberta) {
    const c = aberta.colecao;
    const obras = aberta.results || [];
    return (
      <div>
        <style>{`
          .exp-parede { display:flex; gap:38px; align-items:flex-end;
            overflow-x:auto; padding:0 4px 28px; scroll-snap-type:x proximity; }
          .exp-parede::-webkit-scrollbar { height:6px }
          .exp-parede::-webkit-scrollbar-thumb { background:#ddd7cc; border-radius:3px }
          .exp-obra { flex:0 0 auto; scroll-snap-align:center; max-width:78vw; }
          .exp-obra img { height:340px; width:auto; display:block; cursor:zoom-in;
            border:1px solid #e8e4dc; background:#f2f0eb; transition:box-shadow .2s; }
          .exp-obra img:hover { box-shadow:0 6px 24px rgba(0,0,0,.16) }
          @media (max-width:820px){ .exp-obra img { height:230px } .exp-parede { gap:24px } }
        `}</style>

        <button onClick={() => setAberta(null)}
          style={{ background:"none", border:"none", cursor:"pointer", padding:0, marginBottom:16,
                   fontSize:10, color:"#aaa", fontFamily:"Verdana,sans-serif",
                   letterSpacing:1, textTransform:"uppercase" }}>{x.voltar}</button>

        <h2 style={{ margin:"0 0 6px", fontSize:22, fontWeight:700,
                     fontFamily:"Verdana,sans-serif", color:"#0a0a0a" }}>{tit(c)}</h2>

        {txt(c) && (
          <p style={{ margin:"0 0 6px", maxWidth:"68ch", fontSize:16, lineHeight:1.68,
                      color:"#3a3a3a", fontFamily:"'Cormorant Garamond',Georgia,serif",
                      whiteSpace:"pre-wrap" }}>{txt(c)}</p>
        )}

        <p style={{ margin:"0 0 26px", fontSize:9, color:"#ccc", fontFamily:"Verdana,sans-serif",
                    letterSpacing:1, textTransform:"uppercase" }}>
          {x.obras(obras.length)} · {x.dica}
        </p>

        <div className="exp-parede">
          {obras.map((o, i) => (
            <figure key={o.id} className="exp-obra" style={{ margin:0 }}>
              <img src={o.imageUrl} alt={o.title} loading="lazy"
                   onClick={() => setLupa(o)}/>
              <figcaption style={{ paddingTop:10, maxWidth:420 }}>
                <p style={{ margin:0, fontSize:9, color:"#c4bdb2", fontFamily:"Verdana,sans-serif",
                            letterSpacing:1 }}>{String(i + 1).padStart(2, "0")}</p>
                <p style={{ margin:"3px 0 0", fontSize:14.5, color:"#0a0a0a", lineHeight:1.3,
                            fontFamily:"'Cormorant Garamond',Georgia,serif" }}>{o.title}</p>
                <p style={{ margin:"2px 0 0", fontSize:12, color:"#777",
                            fontFamily:"'Cormorant Garamond',Georgia,serif" }}>
                  {o.artist}{o.date ? `, ${o.date}` : ""}
                </p>
                {o.nota && (
                  <p style={{ margin:"7px 0 0", fontSize:13, color:"#555", lineHeight:1.6,
                              fontStyle:"italic", borderLeft:"2px solid #e0dbd0", paddingLeft:9,
                              fontFamily:"'Cormorant Garamond',Georgia,serif" }}>{o.nota}</p>
                )}
              </figcaption>
            </figure>
          ))}
        </div>

        {obras.length === 0 && (
          <p style={{ fontSize:11, color:"#ccc", fontFamily:"Verdana,sans-serif" }}>—</p>
        )}

        {lupa && <Lupa obra={lupa} onFechar={() => setLupa(null)}/>}
      </div>
    );
  }

  // ─── A lista ───────────────────────────────────────────────────────────────
  return (
    <div>
      <h2 style={{ margin:"0 0 4px", fontSize:20, fontWeight:700,
                   fontFamily:"Verdana,sans-serif", color:"#0a0a0a" }}>{x.titulo}</h2>
      <p style={{ margin:"0 0 22px", fontSize:12, color:"#aaa",
                  fontFamily:"Verdana,sans-serif", lineHeight:1.6 }}>{x.sub}</p>

      {carregando && <p style={{ fontSize:11, color:"#ccc", fontFamily:"Verdana,sans-serif" }}>···</p>}
      {!carregando && lista.length === 0 &&
        <p style={{ fontSize:11, color:"#ccc", fontFamily:"Verdana,sans-serif" }}>{x.vazio}</p>}

      <div style={{ display:"grid",
                    gridTemplateColumns:"repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap:16 }}>
        {lista.map(c => (
          <button key={c.slug} onClick={() => entrar(c.slug)}
            style={{ display:"flex", flexDirection:"column", background:"#fff",
                     border:"1px solid #e8e4dc", borderRadius:3, cursor:"pointer",
                     textAlign:"left", padding:0, overflow:"hidden", transition:"all .18s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor="#aaa";
                                 e.currentTarget.style.boxShadow="3px 3px 0 #0a0a0a20"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor="#e8e4dc";
                                 e.currentTarget.style.boxShadow="none"; }}>
            {c.capa && (
              <div style={{ height:150, overflow:"hidden", borderBottom:"1px solid #ece9e2" }}>
                <img src={c.capa} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/>
              </div>
            )}
            <div style={{ padding:"13px 15px 15px" }}>
              <p style={{ margin:0, fontSize:13, fontFamily:"Verdana,sans-serif",
                          fontWeight:600, color:"#0a0a0a" }}>{tit(c)}</p>
              <p style={{ margin:"6px 0 0", fontSize:13.5, color:"#555", lineHeight:1.55,
                          fontFamily:"'Cormorant Garamond',Georgia,serif" }}>
                {txt(c).length > 150 ? txt(c).slice(0, 150) + "…" : txt(c)}
              </p>
              <p style={{ margin:"9px 0 0", fontSize:9.5, color:"#bbb",
                          fontFamily:"Verdana,sans-serif", letterSpacing:1,
                          textTransform:"uppercase" }}>{x.obras(c.n)} · {x.entrar}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

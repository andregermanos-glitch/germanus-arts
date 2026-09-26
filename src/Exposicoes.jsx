// src/Exposicoes.jsx — Aba Exposições · GERMANUS.Art
//
// Duas vistas num componente só:
//   · lista das exposições publicadas
//   · a sala: obras lado a lado numa parede, na ordem definida em /colecoes
//
// Ao clicar numa obra, a sala vira percurso: tela cheia, setas para a obra
// seguinte e anterior, teclado, e ampliação com roda do rato, duplo clique
// ou os botões. A ordem é o argumento da exposição.
//
// Uso em App.jsx:  <Exposicoes lang={lang} />

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

const TX = {
  fr: { titulo:"Expositions", sub:"Parcours ordonnés à travers les 18 galeries — l'ordre est l'argument.",
        obras:n=>`${n} œuvre${n>1?"s":""}`, entrar:"Entrer →", voltar:"← Toutes les expositions",
        vazio:"Aucune exposition pour le moment.", dica:"Parcourez la salle →",
        ant:"Œuvre précédente", prox:"Œuvre suivante", fechar:"Fermer",
        mais:"Agrandir", menos:"Réduire", reset:"Taille d'origine" },
  en: { titulo:"Exhibitions", sub:"Ordered paths across the 18 galleries — the sequence is the argument.",
        obras:n=>`${n} work${n>1?"s":""}`, entrar:"Enter →", voltar:"← All exhibitions",
        vazio:"No exhibitions yet.", dica:"Walk the room →",
        ant:"Previous work", prox:"Next work", fechar:"Close",
        mais:"Zoom in", menos:"Zoom out", reset:"Actual size" },
  es: { titulo:"Exposiciones", sub:"Recorridos ordenados por las 18 galerías — el orden es el argumento.",
        obras:n=>`${n} obra${n>1?"s":""}`, entrar:"Entrar →", voltar:"← Todas las exposiciones",
        vazio:"Aún no hay exposiciones.", dica:"Recorra la sala →",
        ant:"Obra anterior", prox:"Obra siguiente", fechar:"Cerrar",
        mais:"Ampliar", menos:"Reducir", reset:"Tamaño original" },
  pt: { titulo:"Exposições", sub:"Percursos ordenados através das 18 galerias — a ordem é o argumento.",
        obras:n=>`${n} obra${n>1?"s":""}`, entrar:"Entrar →", voltar:"← Todas as exposições",
        vazio:"Ainda não há exposições.", dica:"Percorra a sala →",
        ant:"Obra anterior", prox:"Próxima obra", fechar:"Fechar",
        mais:"Ampliar", menos:"Reduzir", reset:"Tamanho original" },
  it: { titulo:"Mostre", sub:"Percorsi ordinati attraverso le 18 gallerie — l'ordine è l'argomento.",
        obras:n=>`${n} opera${n>1?"e":""}`, entrar:"Entrare →", voltar:"← Tutte le mostre",
        vazio:"Ancora nessuna mostra.", dica:"Percorri la sala →",
        ant:"Opera precedente", prox:"Opera successiva", fechar:"Chiudi",
        mais:"Ingrandire", menos:"Ridurre", reset:"Dimensione originale" },
  de: { titulo:"Ausstellungen", sub:"Geordnete Wege durch die 18 Galerien — die Reihenfolge ist das Argument.",
        obras:n=>`${n} Werk${n>1?"e":""}`, entrar:"Eintreten →", voltar:"← Alle Ausstellungen",
        vazio:"Noch keine Ausstellungen.", dica:"Den Saal entlanggehen →",
        ant:"Vorheriges Werk", prox:"Nächstes Werk", fechar:"Schließen",
        mais:"Vergrößern", menos:"Verkleinern", reset:"Originalgröße" },
};

// ─── Sala em tela cheia: percurso + ampliação ───────────────────────────────
function Percurso({ obras, indice, setIndice, onFechar, x }) {
  const o = obras[indice];
  const [escala, setEscala] = useState(1);
  const [pos, setPos]       = useState({ x: 0, y: 0 });
  const [arrasto, setArr]   = useState(null);
  const [carregou, setCarregou] = useState(false);

  const temAnt  = indice > 0;
  const temProx = indice < obras.length - 1;

  const zerar = useCallback(() => { setEscala(1); setPos({ x: 0, y: 0 }); }, []);

  const ir = useCallback(n => {
    if (n < 0 || n >= obras.length) return;
    setCarregou(false);
    zerar();
    setIndice(n);
  }, [obras.length, setIndice, zerar]);

  useEffect(() => {
    const tecla = e => {
      if (e.key === "Escape")     onFechar();
      if (e.key === "ArrowRight") ir(indice + 1);
      if (e.key === "ArrowLeft")  ir(indice - 1);
      if (e.key === "+" || e.key === "=") setEscala(s => Math.min(s + 0.5, 8));
      if (e.key === "-")          setEscala(s => Math.max(s - 0.5, 1));
      if (e.key === "0")          zerar();
    };
    window.addEventListener("keydown", tecla);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", tecla); document.body.style.overflow = ""; };
  }, [indice, ir, onFechar, zerar]);

  const naRoda = e => {
    e.preventDefault();
    setEscala(s => Math.min(Math.max(s + (e.deltaY > 0 ? -0.3 : 0.3), 1), 8));
  };

  if (!o) return null;

  return createPortal(
    <div style={{ position:"fixed", inset:0, zIndex:99999, background:"rgba(10,10,10,.96)",
                  display:"flex", flexDirection:"column" }}>
      <style>{`
        .pc-btn { border:1px solid rgba(255,255,255,.34); background:rgba(255,255,255,.12);
          color:#fff; cursor:pointer; border-radius:50%; display:flex; align-items:center;
          justify-content:center; transition:all .16s; padding:0; }
        .pc-btn:hover { background:#fff; color:#0a0a0a }
        .pc-btn:disabled { opacity:.18; cursor:default }
        .pc-btn:disabled:hover { background:rgba(255,255,255,.12); color:#fff }
        .pc-lado { position:absolute; top:50%; transform:translateY(-50%);
          width:54px; height:54px; font-size:28px; z-index:3 }
        .pc-esq { left:18px } .pc-dir { right:18px }
        .pc-topo { position:absolute; top:18px; right:18px; display:flex; gap:8px; z-index:3 }
        .pc-topo .pc-btn { width:40px; height:40px; font-size:17px }
        @media (max-width:820px){
          .pc-lado { width:42px; height:42px; font-size:22px }
          .pc-esq { left:6px } .pc-dir { right:6px }
        }
      `}</style>

      <div className="pc-topo">
        <button className="pc-btn" title={x.mais}  onClick={() => setEscala(s => Math.min(s + 0.5, 8))}>+</button>
        <button className="pc-btn" title={x.menos} onClick={() => setEscala(s => Math.max(s - 0.5, 1))}>−</button>
        <button className="pc-btn" title={x.reset} onClick={zerar}>⟲</button>
        <button className="pc-btn" title={x.fechar} onClick={onFechar}>✕</button>
      </div>

      <button className="pc-btn pc-lado pc-esq" disabled={!temAnt}
              title={x.ant} onClick={() => ir(indice - 1)}>‹</button>
      <button className="pc-btn pc-lado pc-dir" disabled={!temProx}
              title={x.prox} onClick={() => ir(indice + 1)}>›</button>

      <div onWheel={naRoda}
           onMouseDown={e => { if (escala > 1) setArr({ x: e.clientX - pos.x, y: e.clientY - pos.y }); }}
           onMouseMove={e => { if (arrasto) setPos({ x: e.clientX - arrasto.x, y: e.clientY - arrasto.y }); }}
           onMouseUp={() => setArr(null)}
           onMouseLeave={() => setArr(null)}
           onDoubleClick={() => (escala > 1 ? zerar() : setEscala(2.5))}
           style={{ flex:1, overflow:"hidden", display:"flex", alignItems:"center",
                    justifyContent:"center", padding:"58px 76px 8px",
                    cursor: escala > 1 ? (arrasto ? "grabbing" : "grab") : "zoom-in" }}>
        {!carregou && (
          <span style={{ position:"absolute", color:"#777", fontFamily:"Verdana,sans-serif",
                         fontSize:11, letterSpacing:2 }}>· · ·</span>
        )}
        <img src={o.imageHd || o.imageUrl} alt={o.title} draggable={false}
             onLoad={() => setCarregou(true)}
             style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain",
                      transform:`translate(${pos.x}px, ${pos.y}px) scale(${escala})`,
                      transition: arrasto ? "none" : "transform .18s ease-out",
                      opacity: carregou ? 1 : 0, userSelect:"none" }}/>
      </div>

      <div style={{ padding:"10px 76px 26px", textAlign:"center" }}>
        <p style={{ margin:0, fontSize:9, color:"#6d6d6d", fontFamily:"Verdana,sans-serif",
                    letterSpacing:2 }}>
          {String(indice + 1).padStart(2, "0")} / {String(obras.length).padStart(2, "0")}
        </p>
        <p style={{ margin:"7px 0 0", color:"#f0f0f0", fontSize:17, lineHeight:1.35,
                    fontFamily:"'Cormorant Garamond',Georgia,serif" }}>{o.title}</p>
        <p style={{ margin:"3px 0 0", color:"#9a9a9a", fontSize:14,
                    fontFamily:"'Cormorant Garamond',Georgia,serif" }}>
          {o.artist}{o.date ? `, ${o.date}` : ""}
        </p>
        {o.nota && (
          <p style={{ margin:"10px auto 0", maxWidth:"62ch", color:"#b8b8b8", fontSize:14,
                      lineHeight:1.6, fontStyle:"italic",
                      fontFamily:"'Cormorant Garamond',Georgia,serif" }}>{o.nota}</p>
        )}
        {o.museum && (
          <p style={{ margin:"9px 0 0", color:"#5e5e5e", fontSize:9,
                      fontFamily:"Verdana,sans-serif", letterSpacing:1 }}>{o.museum}</p>
        )}
      </div>
    </div>, document.body);
}

export default function Exposicoes({ lang = "fr" }) {
  const x = TX[lang] || TX.fr;

  const [lista, setLista]   = useState([]);
  const [aberta, setAberta] = useState(null);   // { colecao, results }
  const [carregando, setCarregando] = useState(true);
  const [indice, setIndice] = useState(null);   // null = percurso fechado

  // ─── Navegação da parede ───────────────────────────────────────────────────
  const parede = useRef(null);
  const [podeEsq, setPodeEsq] = useState(false);
  const [podeDir, setPodeDir] = useState(false);

  function medir() {
    const el = parede.current;
    if (!el) return;
    setPodeEsq(el.scrollLeft > 8);
    setPodeDir(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }

  function deslizar(dir) {
    const el = parede.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: "smooth" });
  }

  useEffect(() => {
    fetch("/api/colecoes").then(r => r.json())
      .then(d => { setLista(d.colecoes || []); setCarregando(false); })
      .catch(() => setCarregando(false));
  }, []);

  useEffect(() => {
    if (!aberta) return;
    const t = setTimeout(medir, 120);
    window.addEventListener("resize", medir);
    return () => { clearTimeout(t); window.removeEventListener("resize", medir); };
  }, [aberta]);

  // Setas do teclado percorrem a parede — só quando o percurso está fechado
  useEffect(() => {
    if (!aberta || indice !== null) return;
    const tecla = e => {
      if (e.key === "ArrowRight") deslizar(1);
      if (e.key === "ArrowLeft")  deslizar(-1);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aberta, indice]);

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
            overflow-x:auto; padding:0 4px 28px; scroll-snap-type:x proximity;
            scroll-behavior:smooth; }
          .exp-parede::-webkit-scrollbar { height:6px }
          .exp-parede::-webkit-scrollbar-thumb { background:#ddd7cc; border-radius:3px }
          .exp-obra { flex:0 0 auto; scroll-snap-align:center; max-width:78vw; }
          .exp-obra img { height:340px; width:auto; display:block; cursor:zoom-in;
            border:1px solid #e8e4dc; background:#f2f0eb; transition:box-shadow .2s; }
          .exp-obra img:hover { box-shadow:0 6px 24px rgba(0,0,0,.16) }

          .exp-seta { position:absolute; top:150px; z-index:5; width:42px; height:42px;
            border-radius:50%; border:1px solid #e0dbd0; background:rgba(255,255,255,.94);
            color:#0a0a0a; font-size:22px; line-height:1; cursor:pointer; padding:0;
            display:flex; align-items:center; justify-content:center;
            box-shadow:0 2px 12px rgba(0,0,0,.12); transition:all .18s; }
          .exp-seta:hover { background:#0a0a0a; color:#fff; border-color:#0a0a0a }
          .exp-esq { left:-14px } .exp-dir { right:-14px }

          @media (max-width:820px){
            .exp-obra img { height:230px } .exp-parede { gap:24px }
            .exp-seta { top:95px; width:36px; height:36px; font-size:18px }
            .exp-esq { left:-4px } .exp-dir { right:-4px }
          }
          @media (prefers-reduced-motion: reduce){ .exp-parede { scroll-behavior:auto } }
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
          {x.obras(obras.length)}{obras.length > 1 ? ` · ${x.dica}` : ""}
        </p>

        <div style={{ position:"relative" }}>
          {podeEsq && (
            <button className="exp-seta exp-esq" onClick={() => deslizar(-1)}
                    aria-label={x.ant}>‹</button>
          )}
          {podeDir && (
            <button className="exp-seta exp-dir" onClick={() => deslizar(1)}
                    aria-label={x.prox}>›</button>
          )}

          <div className="exp-parede" ref={parede} onScroll={medir}>
            {obras.map((o, i) => (
              <figure key={o.id} className="exp-obra" style={{ margin:0 }}>
                <img src={o.imageUrl} alt={o.title} loading="lazy"
                     onLoad={medir} onClick={() => setIndice(i)}/>
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
        </div>

        {obras.length === 0 && (
          <p style={{ fontSize:11, color:"#ccc", fontFamily:"Verdana,sans-serif" }}>—</p>
        )}

        {indice !== null && (
          <Percurso obras={obras} indice={indice} setIndice={setIndice}
                    onFechar={() => setIndice(null)} x={x}/>
        )}
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

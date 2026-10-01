// src/Paginas.jsx — páginas do menu do rodapé: /nos-somos, /direitos, /noticias, /loja, /contatos
// Mesma linha visual da página inicial: fundo creme, Cormorant Garamond nos textos,
// Verdana em caixa-alta espaçada nos rótulos, logo GERMANUS.Art no cabeçalho.

import { useState, useEffect } from "react";
import "./germanus.css";
import { Logo, LangSwitcher, loadLang } from "./App";
import MenuRodape, { ROTULOS } from "./MenuRodape";

const VERMELHO = "#b03a2e";
const LOCALE = { fr:"fr-FR", en:"en-GB", es:"es-ES", pt:"pt-BR", it:"it-IT", de:"de-DE" };

const TX = {
  fr: { voltar:"← Retour à la collection", ler:"Lire", edicao:"Édition nº", editorial:"Éditorial", fontes:"Sources",
        vazio:"Aucun article publié pour l’instant.", ia:"Textes rédigés par l’Éditorial GERMANUS.Art avec l’aide de l’IA et relus par la curation.", pt:"Articles en portugais." },
  en: { voltar:"← Back to the collection", ler:"Read", edicao:"Edition no.", editorial:"Editorial", fontes:"Sources",
        vazio:"No articles published yet.", ia:"Written by the GERMANUS.Art Editorial with AI assistance and reviewed by our curators.", pt:"Articles in Portuguese." },
  es: { voltar:"← Volver a la colección", ler:"Leer", edicao:"Edición n.º", editorial:"Editorial", fontes:"Fuentes",
        vazio:"Aún no hay artículos publicados.", ia:"Textos del Editorial GERMANUS.Art con apoyo de IA y revisión de la curaduría.", pt:"Artículos en portugués." },
  pt: { voltar:"← Voltar ao acervo", ler:"Ler", edicao:"Edição nº", editorial:"Editorial", fontes:"Fontes",
        vazio:"Nenhuma matéria publicada ainda.", ia:"Textos produzidos pela redação da GERMANUS.Art com apoio de IA e revisão editorial.", pt:"" },
  it: { voltar:"← Torna alla collezione", ler:"Leggi", edicao:"Edizione n.", editorial:"Editoriale", fontes:"Fonti",
        vazio:"Nessun articolo pubblicato.", ia:"Testi dell’Editoriale GERMANUS.Art con supporto dell’IA e revisione curatoriale.", pt:"Articoli in portoghese." },
  de: { voltar:"← Zurück zur Sammlung", ler:"Lesen", edicao:"Ausgabe Nr.", editorial:"Redaktion", fontes:"Quellen",
        vazio:"Noch keine Artikel veröffentlicht.", ia:"Texte der GERMANUS.Art-Redaktion, mit KI-Unterstützung verfasst und kuratorisch geprüft.", pt:"Artikel auf Portugiesisch." },
};

const serif = "'Cormorant Garamond',Georgia,serif";
const rotulo = { fontFamily:"Verdana,sans-serif", fontSize:9.5, letterSpacing:2, textTransform:"uppercase" };

function paragrafos(texto) {
  const t = String(texto || "").trim();
  if (!t) return [];
  const blocos = t.split(/\n\s*\n/);
  return (blocos.length > 1 ? blocos : t.split(/\n/)).map(p => p.trim()).filter(Boolean);
}

function Fontes({ fontes, titulo }) {
  const linhas = String(fontes || "").split(/\n/).map(l => l.trim()).filter(Boolean);
  if (!linhas.length) return null;
  return (
    <div style={{ marginTop:28, paddingTop:14, borderTop:"1px solid #e0dbd0" }}>
      <p style={{ ...rotulo, color:"#999", margin:"0 0 8px" }}>{titulo}</p>
      {linhas.map((l, i) => {
        const url = (l.match(/https?:\/\/\S+/) || [])[0];
        const nome = url ? l.replace(url, "").replace(/[\s—–:-]+$/, "").trim() : l;
        return (
          <p key={i} style={{ margin:"0 0 4px", fontSize:14, fontFamily:serif, color:"#5c5346" }}>
            {url ? <a href={url} target="_blank" rel="noopener noreferrer" style={{ color:"#1545c7", textDecoration:"none" }}>{nome || url} ↗</a> : nome}
          </p>
        );
      })}
    </div>
  );
}

// ─── Moldura comum: cabeçalho igual ao da home + rodapé com o menu ───────────
function Moldura({ lang, setLang, slug, children }) {
  const t = TX[lang] || TX.fr;
  return (
    <div className="germ-app" style={{ minHeight:"100vh", color:"#0a0a0a", fontFamily:serif, display:"flex", flexDirection:"column" }}>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap" rel="stylesheet"/>
      <style>{`*{box-sizing:border-box}.lang-switcher{display:flex;align-items:center;gap:6px}@media(max-width:768px){.lang-switcher{display:grid;grid-template-columns:repeat(2,auto);gap:6px;justify-content:end}.pg-pad{padding-left:16px!important;padding-right:16px!important}.pg-voltar{display:none}.pg-logo{transform:scale(.62);transform-origin:left bottom;margin-right:-40%}}`}</style>

      <header className="germ-header pg-pad" style={{ borderBottom:"1px solid #e8e4dc", padding:"18px 36px 16px" }}>
        <div style={{ maxWidth:1300, margin:"0 auto", display:"flex", justifyContent:"space-between", alignItems:"flex-end", gap:12 }}>
          <a href="/" className="pg-logo" style={{ textDecoration:"none" }} title="GERMANUS.Art"><Logo/></a>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8 }}>
            <LangSwitcher lang={lang} setLang={setLang}/>
            <a href="/" className="pg-voltar" style={{ ...rotulo, fontSize:9, color:"#999", textDecoration:"none" }}>{t.voltar}</a>
          </div>
        </div>
      </header>

      <main className="pg-pad" style={{ flex:1, width:"100%", maxWidth:1300, margin:"0 auto", padding:"30px 36px 40px" }}>
        {children}
      </main>

      <footer className="germ-footer pg-pad" style={{ borderTop:"1px solid #ece9e2", padding:"6px 36px 18px" }}>
        <div style={{ maxWidth:1300, margin:"0 auto" }}>
          <MenuRodape lang={lang} atual={slug} centro/>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:14, gap:12, flexWrap:"wrap" }}>
            <a href="/" style={{ textDecoration:"none" }}><Logo small/></a>
            {slug === "noticias" && <p style={{ margin:0, fontSize:12, fontStyle:"italic", color:"#8a8478", fontFamily:serif }}>{t.ia}</p>}
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Páginas de texto (Nós Somos, Direitos, Loja, Contatos) ──────────────────
function PaginaTexto({ slug, lang }) {
  const [p, setP] = useState(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    fetch(`/api/pagina/${slug}`).then(r => r.ok ? r.json() : Promise.reject())
      .then(setP).catch(() => setErro(true));
  }, [slug]);
  const titulo = p?.titulo || (ROTULOS.pt[slug]);
  return (
    <article style={{ maxWidth:680, margin:"0 auto", paddingTop:12 }}>
      <p style={{ ...rotulo, color:VERMELHO, margin:"0 0 10px" }}>GERMANUS.Art</p>
      <h1 style={{ margin:"0 0 22px", fontSize:"clamp(34px,5vw,48px)", fontWeight:700, lineHeight:1.05, fontFamily:serif }}>
        {lang === "pt" ? titulo : (ROTULOS[lang] || ROTULOS.fr)[slug]}
      </h1>
      <div style={{ borderTop:"1px solid #0a0a0a", borderBottom:"1px solid #0a0a0a", height:4, marginBottom:26 }}/>
      {erro && <p style={{ color:"#999", fontStyle:"italic" }}>—</p>}
      {!p && !erro && <p style={{ color:"#bbb", fontStyle:"italic" }}>…</p>}
      {p && paragrafos(p.texto).map((par, i) => (
        <p key={i} style={{ fontSize:20, lineHeight:1.6, margin:"0 0 18px", color:"#2c2418" }}>{par}</p>
      ))}
    </article>
  );
}

// ─── Notícias: central + seis chamadas; clicar numa chamada a leva ao centro ──
function PaginaNoticias({ lang }) {
  const t = TX[lang] || TX.fr;
  const [lista, setLista] = useState(null);
  const [edicao, setEdicao] = useState(0);

  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get("n");
    fetch(`/api/noticias${n ? `?n=${encodeURIComponent(n)}` : ""}`).then(r => r.json())
      .then(d => { setLista(d.noticias || []); setEdicao(d.edicao || 0); })
      .catch(() => setLista([]));
  }, []);

  function abrir(i) {
    setLista(l => {
      const nova = [...l];
      [nova[0], nova[i]] = [nova[i], nova[0]];
      try { window.history.replaceState(null, "", `/noticias?n=${nova[0].id}`); } catch {}
      return nova;
    });
    window.scrollTo({ top:0, behavior:"smooth" });
  }

  const hoje = new Date().toLocaleDateString(LOCALE[lang] || "pt-BR", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
  const quando = d => d ? new Date(d).toLocaleString(LOCALE[lang] || "pt-BR", { day:"numeric", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit" }) : "";

  const central = lista?.[0];
  const esquerda = (lista || []).slice(1, 4).map((n, k) => ({ n, i: k + 1 }));
  const direita  = (lista || []).slice(4, 7).map((n, k) => ({ n, i: k + 4 }));

  const Chamada = ({ n, i }) => (
    <button className="nt-chamada" onClick={() => abrir(i)}>
      <span style={{ ...rotulo, fontSize:9, color:VERMELHO }}>{n.editoria}</span>
      <span className="nt-chamada-tit">{n.titulo}</span>
      <span style={{ fontSize:14, fontStyle:"italic", color:"#5c5346", fontFamily:serif }}>{t.ler} →</span>
    </button>
  );

  return (
    <div>
      <style>{`
        .nt-grade{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr) minmax(0,1fr);gap:40px;align-items:start}
        .nt-col{display:flex;flex-direction:column;gap:22px}
        .nt-chamada{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;
          gap:18px;aspect-ratio:1/1;padding:22px;background:#fff;border:1px solid #d8d2c6;transition:border-color .18s,box-shadow .18s}
        .nt-chamada:hover,.nt-chamada:focus-visible{border-color:#0a0a0a;box-shadow:0 8px 24px rgba(0,0,0,.06)}
        .nt-chamada-tit{font-family:${serif};font-size:25px;font-weight:700;line-height:1.12;color:#0a0a0a}
        .nt-central p.corpo{font-size:20px;line-height:1.62;margin:0 0 18px;color:#2c2418}
        @media(max-width:1000px){.nt-grade{grid-template-columns:minmax(0,1fr) minmax(0,1.6fr)}.nt-dir{grid-column:1}.nt-central{grid-column:2;grid-row:1 / span 2}}
        @media(max-width:720px){
          .nt-meio{display:none}
          .nt-grade{grid-template-columns:1fr;gap:0}
          .nt-central{grid-column:1;grid-row:auto;order:-1;padding-bottom:26px;margin-bottom:6px;border-bottom:1px solid #0a0a0a}
          .nt-dir{grid-column:1}
          .nt-col{gap:0}
          .nt-chamada{aspect-ratio:auto;border:none;border-bottom:1px solid #e0dbd0;background:none;padding:16px 0;gap:6px}
          .nt-chamada:hover{box-shadow:none}
          .nt-chamada-tit{font-size:22px}
          .nt-central p.corpo{font-size:19px}
        }
      `}</style>

      {/* Linha da edição */}
      <div style={{ borderTop:"1px solid #0a0a0a", padding:"10px 0", display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
        <span style={{ ...rotulo, color:"#5c5346" }}>{hoje}</span>
        <span className="nt-meio" style={{ ...rotulo, color:"#0a0a0a", fontWeight:700 }}>{t.editorial}</span>
        <span style={{ ...rotulo, color:"#5c5346" }}>{edicao ? `${t.edicao} ${edicao}` : ""}</span>
      </div>
      <div style={{ borderTop:"1px solid #0a0a0a", borderBottom:"1px solid #0a0a0a", height:4, marginBottom:34 }}/>

      {lista === null && <p style={{ textAlign:"center", color:"#bbb", fontStyle:"italic" }}>…</p>}
      {lista && lista.length === 0 && <p style={{ textAlign:"center", color:"#999", fontStyle:"italic", fontSize:20, padding:"60px 0" }}>{t.vazio}</p>}

      {central && (
        <div className="nt-grade">
          <div className="nt-col nt-esq">{esquerda.map(x => <Chamada key={x.n.id} {...x}/>)}</div>

          <article className="nt-central" key={central.id}>
            <p style={{ ...rotulo, color:VERMELHO, margin:"0 0 12px" }}>{central.editoria}</p>
            <h1 style={{ margin:"0 0 16px", fontSize:"clamp(34px,4.6vw,56px)", fontWeight:700, lineHeight:1.04, fontFamily:serif }}>{central.titulo}</h1>
            {central.linha_fina && <p style={{ margin:"0 0 20px", fontSize:22, fontStyle:"italic", lineHeight:1.35, color:"#5c5346" }}>{central.linha_fina}</p>}
            <div style={{ borderTop:"1px solid #bdb6a8", borderBottom:"1px solid #bdb6a8", padding:"10px 0", marginBottom:24, fontSize:15, color:"#5c5346" }}>
              <b style={{ color:"#0a0a0a" }}>{central.autor}</b>
              <span style={{ margin:"0 10px" }}>·</span>{quando(central.publicada_em)}
            </div>
            {t.pt && <p style={{ ...rotulo, fontSize:8.5, color:"#aaa", margin:"0 0 16px" }}>{t.pt}</p>}
            {paragrafos(central.texto).map((par, i) => <p key={i} className="corpo">{par}</p>)}
            <Fontes fontes={central.fontes} titulo={t.fontes}/>
          </article>

          <div className="nt-col nt-dir">{direita.map(x => <Chamada key={x.n.id} {...x}/>)}</div>
        </div>
      )}
    </div>
  );
}

// ─── Roteador das páginas ────────────────────────────────────────────────────
export default function Paginas({ slug }) {
  const [lang, setLang] = useState(loadLang);
  useEffect(() => {
    const nome = slug === "noticias" ? TX[lang]?.editorial : (ROTULOS[lang] || ROTULOS.fr)[slug];
    document.title = `${nome} — GERMANUS.Art`;
    document.documentElement.lang = lang;
  }, [slug, lang]);
  return (
    <Moldura lang={lang} setLang={setLang} slug={slug}>
      {slug === "noticias" ? <PaginaNoticias lang={lang}/> : <PaginaTexto slug={slug} lang={lang}/>}
    </Moldura>
  );
}

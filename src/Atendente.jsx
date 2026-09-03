// src/Atendente.jsx — Atendente Emmanuel Rio · GERMANUS.Art
//
// Uso em App.jsx, no lugar do texto "Selecione uma galeria":
//   import Atendente from "./Atendente";
//   <Atendente lang={lang} />
//
// Se /api/atendente/status responder false, o componente não renderiza nada.
// Ninguém clica num atendente quebrado.

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// AJUSTE: troque pelas URLs do R2 depois de subir as duas imagens.
const BUSTO  = "/emmanuel-busto.jpg";
const FIGURA = "/emmanuel-figura.jpg";

const TX = {
  fr: { convite:"Demandez à Emmanuel Rio", campo:"Écrivez votre question…", enviar:"ENVOYER", fechar:"Fermer",
        credito:"Albert Schindler, 1836 · Art Institute of Chicago",
        erro:"Je ne peux pas converser pour le moment. Revenez plus tard — le fonds reste ouvert, et vous pouvez parcourir les ailes normalement.",
        abertura:"Je suis Emmanuel Rio. Je peux expliquer comment ce fonds est organisé, parler de toute œuvre qui s'y trouve, ou raconter ma propre histoire. Que préférez-vous ?" },
  en: { convite:"Ask Emmanuel Rio", campo:"Type your question…", enviar:"SEND", fechar:"Close",
        credito:"Albert Schindler, 1836 · Art Institute of Chicago",
        erro:"I cannot talk just now. Come back later — the collection stays open, and you can walk the wings as usual.",
        abertura:"I am Emmanuel Rio. I can explain how this collection is arranged, discuss any work held here, or tell you my own story. Which would you prefer?" },
  es: { convite:"Pregunte a Emmanuel Rio", campo:"Escriba su pregunta…", enviar:"ENVIAR", fechar:"Cerrar",
        credito:"Albert Schindler, 1836 · Art Institute of Chicago",
        erro:"No puedo conversar en este momento. Vuelva más tarde — el acervo sigue abierto y puede recorrer las alas con normalidad.",
        abertura:"Soy Emmanuel Rio. Puedo explicar cómo está organizado este acervo, hablar de cualquier obra que esté aquí, o contar mi propia historia. ¿Qué prefiere?" },
  pt: { convite:"Pergunte ao Emmanuel Rio", campo:"Escreva sua pergunta…", enviar:"ENVIAR", fechar:"Fechar",
        credito:"Albert Schindler, 1836 · Art Institute of Chicago",
        erro:"Não posso conversar neste momento. Volte em outra hora — o acervo continua aberto, e você pode percorrer as alas normalmente.",
        abertura:"Sou Emmanuel Rio. Posso explicar como este acervo está organizado, falar de qualquer obra que esteja aqui, ou contar a minha própria história. O que prefere?" },
  it: { convite:"Chiedi a Emmanuel Rio", campo:"Scrivi la tua domanda…", enviar:"INVIA", fechar:"Chiudi",
        credito:"Albert Schindler, 1836 · Art Institute of Chicago",
        erro:"Non posso conversare in questo momento. Torni più tardi — la raccolta resta aperta e può percorrere le ale normalmente.",
        abertura:"Sono Emmanuel Rio. Posso spiegare come è organizzata questa raccolta, parlare di qualsiasi opera qui presente, o raccontare la mia storia. Cosa preferisce?" },
  de: { convite:"Fragen Sie Emmanuel Rio", campo:"Schreiben Sie Ihre Frage…", enviar:"SENDEN", fechar:"Schließen",
        credito:"Albert Schindler, 1836 · Art Institute of Chicago",
        erro:"Ich kann im Augenblick nicht sprechen. Kommen Sie später wieder — die Sammlung bleibt geöffnet, und Sie können die Flügel wie gewohnt durchgehen.",
        abertura:"Ich bin Emmanuel Rio. Ich kann erklären, wie diese Sammlung geordnet ist, über jedes hier verwahrte Werk sprechen oder meine eigene Geschichte erzählen. Was möchten Sie?" },
};

export default function Atendente({ lang = "fr" }) {
  const t = TX[lang] || TX.fr;

  const [disponivel, setDisp] = useState(null);
  const [aberto, setAberto]   = useState(false);
  const [texto, setTexto]     = useState("");
  const [busy, setBusy]       = useState(false);
  const [conversa, setConv]   = useState([]);
  const fim = useRef(null);

  useEffect(() => {
    fetch("/api/atendente/status")
      .then(r => r.json())
      .then(d => setDisp(!!d.disponivel))
      .catch(() => setDisp(false));
  }, []);

  useEffect(() => {
    if (aberto) {
      setConv(c => (c.length ? c : [{ de: "ele", texto: t.abertura }]));
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [aberto]);

  useEffect(() => {
    const esc = e => { if (e.key === "Escape") setAberto(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  useEffect(() => { fim.current?.scrollIntoView({ behavior: "smooth" }); }, [conversa, busy]);

  async function enviar() {
    const pergunta = texto.trim();
    if (!pergunta || busy) return;
    setTexto("");
    setConv(c => [...c, { de: "visitante", texto: pergunta }]);
    setBusy(true);

    const historico = conversa
      .filter(m => m.texto !== t.abertura)
      .slice(-6)
      .map(m => ({ role: m.de === "ele" ? "assistant" : "user", content: m.texto }));

    try {
      const r = await fetch("/api/atendente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pergunta, historico, lang }),
      });
      const d = await r.json();
      if (!r.ok || !d.resposta) {
        setConv(c => [...c, { de: "ele", texto: t.erro }]);
        if (d.erro === "atendente_indisponivel")
          setTimeout(() => { setAberto(false); setDisp(false); }, 5000);
      } else {
        setConv(c => [...c, { de: "ele", texto: d.resposta }]);
      }
    } catch {
      setConv(c => [...c, { de: "ele", texto: t.erro }]);
    } finally {
      setBusy(false);
    }
  }

  if (!disponivel) return null;

  return (
    <>
      <style>{`
        @keyframes er-sobe { from { transform: translateY(24px); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes er-pisca { 0%,100% { opacity:.25 } 50% { opacity:.85 } }
        .er-chamada:hover .er-busto { filter: none; transform: scale(1.04) }
        .er-chamada:hover .er-txt { color: #0a0a0a }
        @media (max-width: 820px) { .er-figura { display: none !important } }
      `}</style>

      <button className="er-chamada" onClick={() => setAberto(true)}
        style={{ display:"inline-flex", alignItems:"center", gap:12,
                 background:"none", border:"none", cursor:"pointer", padding:0 }}>
        <img src={BUSTO} alt="" className="er-busto"
          style={{ width:52, height:52, borderRadius:"50%", objectFit:"cover",
                   objectPosition:"50% 35%", filter:"grayscale(0.25)",
                   transition:"all .25s", flexShrink:0, border:"1px solid #e8e4dc" }}/>
        <span className="er-txt"
          style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:15,
                   fontStyle:"italic", color:"#666", transition:"color .2s", letterSpacing:.2 }}>
          {t.convite}
        </span>
      </button>

      {aberto && createPortal(
        <div onClick={() => setAberto(false)}
          style={{ position:"fixed", inset:0, zIndex:9998, background:"rgba(10,10,10,.42)",
                   display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width:"100%", maxWidth:1080, maxHeight:"86vh", background:"#faf9f7",
                     borderTop:"1px solid #e8e4dc", boxShadow:"0 -14px 44px rgba(0,0,0,.16)",
                     display:"flex", gap:26, padding:"20px 26px 22px",
                     animation:"er-sobe .28s ease-out" }}>

            <figure className="er-figura" style={{ margin:0, flex:"0 0 210px", alignSelf:"flex-end" }}>
              <img src={FIGURA} alt="Retrato de Emmanuel Rio, por Albert Schindler, 1836"
                style={{ width:"100%", display:"block", border:"1px solid #e8e4dc" }}/>
              <figcaption style={{ fontFamily:"Verdana,sans-serif", fontSize:8.5, color:"#bbb",
                                   letterSpacing:.8, paddingTop:5, lineHeight:1.5 }}>
                {t.credito}
              </figcaption>
            </figure>

            <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", maxHeight:"78vh" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline",
                            borderBottom:"1px solid #ece9e2", paddingBottom:8, marginBottom:12 }}>
                <span style={{ fontFamily:"Verdana,sans-serif", fontSize:9.5, letterSpacing:1.6,
                               textTransform:"uppercase", color:"#aaa" }}>Emmanuel Rio</span>
                <button onClick={() => setAberto(false)} aria-label={t.fechar}
                  style={{ background:"none", border:"none", cursor:"pointer",
                           color:"#ccc", fontSize:16, lineHeight:1, padding:0 }}>✕</button>
              </div>

              <div style={{ flex:1, overflowY:"auto", paddingRight:10 }}>
                {conversa.map((m, i) => (
                  <p key={i} style={ m.de === "ele"
                    ? { margin:"0 0 14px", fontFamily:"'Cormorant Garamond',Georgia,serif",
                        fontSize:16.5, lineHeight:1.66, color:"#1a1a1a",
                        maxWidth:"64ch", whiteSpace:"pre-wrap" }
                    : { margin:"0 0 14px", fontFamily:"'Cormorant Garamond',Georgia,serif",
                        fontSize:15, lineHeight:1.6, color:"#7a7a7a", fontStyle:"italic",
                        paddingLeft:12, borderLeft:"2px solid #e0dbd0", maxWidth:"64ch" } }>
                    {m.texto}
                  </p>
                ))}
                {busy && (
                  <p style={{ margin:0, fontFamily:"Verdana,sans-serif", fontSize:11,
                              color:"#bbb", letterSpacing:4,
                              animation:"er-pisca 1.2s ease-in-out infinite" }}>· · ·</p>
                )}
                <div ref={fim}/>
              </div>

              <div style={{ display:"flex", alignItems:"center", gap:14,
                            borderTop:"2px solid #0a0a0a", marginTop:12, paddingTop:4 }}>
                <input value={texto} maxLength={600} autoFocus
                  onChange={e => setTexto(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && enviar()}
                  placeholder={t.campo}
                  style={{ flex:1, background:"transparent", border:"none", outline:"none",
                           fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:16,
                           fontStyle:"italic", color:"#0a0a0a", padding:"10px 0" }}/>
                <button onClick={enviar} disabled={busy || !texto.trim()}
                  style={{ background:"none", border:"none",
                           cursor:(busy || !texto.trim()) ? "default" : "pointer",
                           fontFamily:"Verdana,sans-serif", fontSize:10.5, letterSpacing:2,
                           color:(busy || !texto.trim()) ? "#ccc" : "#0a0a0a", whiteSpace:"nowrap" }}>
                  {t.enviar} →
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

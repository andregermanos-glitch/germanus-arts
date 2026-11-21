// src/MenuRodape.jsx — menu de texto do rodapé: Nós Somos · Direitos · Editorial · Loja · Contatos
// Usado na página inicial (abaixo da seleção de ala e do Emmanuel Rio) e nas páginas internas.

export const ROTAS = ["nos-somos", "direitos", "editorial", "loja", "contatos"];
// Editorial fica fora do menu por enquanto (a página continua existindo em /editorial).
const MENU = ROTAS.filter(s => s !== "editorial");

export const ROTULOS = {
  en: { "nos-somos":"About us",        direitos:"Rights",   editorial:"Editorial",   loja:"Shop",     contatos:"Contact" },
  fr: { "nos-somos":"Qui sommes-nous", direitos:"Droits",   editorial:"Éditorial",   loja:"Boutique", contatos:"Contact" },
  es: { "nos-somos":"Quiénes somos",   direitos:"Derechos", editorial:"Editorial",   loja:"Tienda",   contatos:"Contacto" },
  pt: { "nos-somos":"Nós Somos",       direitos:"Direitos", editorial:"Editorial",   loja:"Loja",     contatos:"Contatos" },
  it: { "nos-somos":"Chi siamo",       direitos:"Diritti",  editorial:"Editoriale",  loja:"Negozio",  contatos:"Contatti" },
  de: { "nos-somos":"Über uns",        direitos:"Rechte",   editorial:"Editorial",   loja:"Shop",     contatos:"Kontakt" },
};

export default function MenuRodape({ lang = "en", atual = "", centro = false }) {
  const r = ROTULOS[lang] || ROTULOS.en;
  return (
    <nav className="menu-rodape" style={{
      display:"flex", flexWrap:"wrap", alignItems:"center",
      justifyContent: centro ? "center" : "flex-start",
      gap:"6px 0", paddingTop:14, marginTop:14, borderTop:"1px solid #f0ece4",
    }}>
      {MENU.map((slug, i) => (
        <span key={slug} style={{ display:"inline-flex", alignItems:"center" }}>
          {i > 0 && <span aria-hidden="true" style={{ color:"#d8d2c6", margin:"0 12px", fontSize:10 }}>·</span>}
          <a href={`/${slug}`} style={{
            fontSize:10, fontFamily:"Verdana,sans-serif", letterSpacing:1.5, textTransform:"uppercase",
            textDecoration:"none", color: atual === slug ? "#0a0a0a" : "#8a8478",
            borderBottom: atual === slug ? "1px solid #0a0a0a" : "1px solid transparent",
            paddingBottom:2, transition:"color .18s",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "#0a0a0a"; }}
          onMouseLeave={e => { e.currentTarget.style.color = atual === slug ? "#0a0a0a" : "#8a8478"; }}
          >{r[slug]}</a>
        </span>
      ))}
    </nav>
  );
}

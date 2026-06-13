// server/categorias.js — Busca por Categoria do Wikimedia Commons
// Categorias reais e curadas do Commons (não busca por palavras-chave)
// ─── ALTERAÇÃO 13/06/2026 (fim do roubo entre alas) ───────────────────────────
// Três pares de alas compartilhavam a mesma categoria do Commons e roubavam
// obras entre si a cada ciclo (o id é commons_<pageid>, único por imagem):
//   familiar ↔ povo            → "Genre paintings"
//   retratos ↔ pessoas_reais   → "Portrait paintings"
//   cores ↔ luz_sol            → "Impressionist paintings"
// Com o COALESCE no server.js, a 1ª ala trancava a categoria e a 2ª ficava vazia.
// Agora cada ala tem categorias EXCLUSIVAS. Onde a separação conceitual é difícil
// (ex.: pessoas_reais vs retratos), usei categorias por artista ("Paintings by X"),
// que têm arquivos diretos e não colidem com as categorias-de-gênero.
// Objets também ganhou categorias por artista (de Heem, Ruysch) porque
// "Still-life paintings" é categoria-contêiner (quase só subcategorias) e o
// fetcher só lê arquivos diretos — por isso Objets quase não enchia pelo Commons.
// ──────────────────────────────────────────────────────────────────────────────

// ─── Mapeamento: cada ala → categorias reais do Wikimedia Commons ─────────────
const CATEGORIAS_WIKIMEDIA = {

  // Psyché — Surrealismo
  fase: [
    "Surrealist paintings",
    "Metaphysical paintings",
    "Paintings by Salvador Dalí",
    "Paintings by Max Ernst"
  ],

  // Émotion — Abstração + Expressionismo + Dadaísmo
  cidades: [
    "Abstract paintings",
    "Abstract expressionism",
    "Expressionist paintings",
    "Dada",
    "Paintings by Wassily Kandinsky"
  ],

  // Couleurs — Fauvismo + Pós-Impressionismo (Impressionismo cedido a luz_sol)
  cores: [
    "Fauvist paintings",
    "Constructivism",
    "Post-Impressionist paintings",
    "Pointillist paintings",
    "Paintings by Paul Gauguin"
  ],

  // Perspective — Cubismo
  perspectiva: [
    "Cubist paintings",
    "Cubism",
    "Paintings by Pablo Picasso",
    "Paintings by Georges Braque"
  ],

  // Sacré — Religioso
  sacro: [
    "Religious paintings",
    "Christian art",
    "Paintings of the Madonna and Child",
    "Crucifixion of Jesus in paintings"
  ],

  // Retratos — retrato como gênero (fica com "Portrait paintings")
  retratos: [
    "Portrait paintings",
    "Self-portraits",
    "Portrait paintings of men",
    "Portrait paintings of women"
  ],

  historico: [
    "History paintings",
    "Battle paintings",
    "Napoleonic Wars in art"
  ],

  // Objets — naturezas-mortas. "Still-life paintings" é contêiner (poucos arquivos
  // diretos); as categorias por artista garantem obras já no equilibrador.
  // Para volume real, usar /api/commons/massa com descer:true (ver nota no fim).
  objetos: [
    "Vanitas paintings",
    "Flower paintings",
    "Paintings by Jan Davidsz. de Heem",
    "Paintings by Rachel Ruysch",
    "Paintings by Willem Kalf"
  ],

  lugares: [
    "Vedute",
    "Cityscape paintings",
    "Paintings of Venice"
  ],

  natureza: [
    "Landscape paintings",
    "Forests in painting",
    "Marine art"
  ],

  // Familiale — interiores domésticos (NÃO usa mais "Genre paintings")
  familiar: [
    "Interiors in art",
    "Domestic scenes in art",
    "Paintings by Pieter de Hooch",
    "Paintings by Gabriel Metsu"
  ],

  nudes: [
    "Nude paintings",
    "Nudes in painting",
    "Venus in art"
  ],

  esoterico: [
    "Symbolist paintings",
    "Symbolism (arts)",
    "Allegorical paintings"
  ],

  arquitetura: [
    "Architectural paintings",
    "Capricci (paintings)",
    "Architecture in art"
  ],

  // Peuple — trabalho/rua/campo (fica com "Genre paintings")
  povo: [
    "Genre paintings",
    "Peasants in art",
    "Rural life in art",
    "Paintings by Adriaen van Ostade"
  ],

  // Lumière — Impressionismo (cedido por cores)
  luz_sol: [
    "Impressionist paintings",
    "Luminism (Impressionism)",
    "Plein air paintings"
  ],

  // Personnages — pessoas identificadas (NÃO usa mais "Portrait paintings";
  // usa retratos de grupo/equestres e por artista para não roubar de Retratos)
  pessoas_reais: [
    "Group portraits",
    "Equestrian portraits",
    "Paintings by Anthony van Dyck",
    "Paintings by Diego Velázquez"
  ],

  femininas: [
    "Paintings by women artists",
    "Paintings by Mary Cassatt",
    "Paintings by Berthe Morisot"
  ]
};

// Categorias soltas para chamada directa (além das alas)
const CATEGORIAS_EXTRA = {
  surrealismo:     "Surrealist paintings",
  abstracionismo:  "Abstract paintings",
  cubismo:         "Cubist paintings",
  expressionismo:  "Expressionist paintings",
  dadaismo:        "Dada",
  construtivismo:  "Constructivism",
  fauvismo:        "Fauvist paintings",
  impressionismo:  "Impressionist paintings",
};

// ─── Filtro de domínio público (permissivo) ──────────────────────────────────
function isLivre(license, date) {
  const l = (license || "").toLowerCase();
  if (l.includes("all rights reserved") || l.includes("cc by-nc") ||
      l.includes("cc by-nd") || l.includes("fair use")) return false;
  if (l.includes("public domain") || l.includes("pd-") || l.includes("cc0") ||
      l.includes("cc by") || l.includes("cc-by") || l === "") return true;
  const y = (date || "").match(/\b(1[0-9]{3})\b/);
  if (y && parseInt(y[1]) < 1928) return true;
  return true; // dúvida → incluir
}

// ─── Buscar membros de uma categoria do Commons (COM PAGINAÇÃO) ───────────────
async function buscarCategoria(categoria, limite = 50) {
  const obras = [];
  let cmcontinue = null;
  let paginas = 0;
  const MAX_PAGINAS = 6;  // até ~300 ficheiros por categoria

  while (obras.length < limite && paginas < MAX_PAGINAS) {
    paginas++;
    let url = `https://commons.wikimedia.org/w/api.php`
      + `?action=query&generator=categorymembers`
      + `&gcmtitle=${encodeURIComponent("Category:" + categoria)}`
      + `&gcmtype=file&gcmlimit=50`
      + `&prop=imageinfo&iiprop=url|extmetadata`
      + `&iiextmetadatafilter=LicenseShortName|Artist|DateTimeOriginal|ObjectName`
      + `&format=json&origin=*`;
    if (cmcontinue) url += `&gcmcontinue=${encodeURIComponent(cmcontinue)}`;

    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      const d = await r.json();
      for (const page of Object.values(d.query?.pages || {})) {
        const ii = page.imageinfo?.[0];
        if (!ii?.url) continue;
        if (!ii.url.match(/\.(jpg|jpeg|png|tiff?)$/i)) continue;
        const meta = ii.extmetadata || {};
        const license = meta.LicenseShortName?.value || "";
        const date    = meta.DateTimeOriginal?.value || "";
        if (!isLivre(license, date)) continue;
        const artist = (meta.Artist?.value || "").replace(/<[^>]+>/g, "").trim();
        obras.push({
          pageid: page.pageid,
          title:  (page.title || "").replace(/^File:/, "").replace(/\.(jpg|jpeg|png|tiff?)$/i, ""),
          artist: artist || "Desconhecido",
          date:   date.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/)?.[0] || "",
          museum: `Wikimedia Commons — ${categoria}`,
          imageUrl: ii.url,
          credit: "Domínio Público — Wikimedia Commons"
        });
      }
      // Token de continuação para a próxima página
      cmcontinue = d.continue?.gcmcontinue || null;
      if (!cmcontinue) break;  // não há mais páginas
      await new Promise(r => setTimeout(r, 250));
    } catch(e) {
      console.log(`  [Commons] ${categoria} p${paginas}: ${e.message}`);
      break;
    }
  }
  return obras.slice(0, limite);
}

// ─── Buscar todas as categorias de uma ala ────────────────────────────────────
async function buscarPorCategoria(nomeOuAla, limite = 50) {
  // Aceita nome de ala (fase) ou categoria extra (surrealismo) ou categoria directa
  let categorias;
  if (CATEGORIAS_WIKIMEDIA[nomeOuAla]) {
    categorias = CATEGORIAS_WIKIMEDIA[nomeOuAla];
  } else if (CATEGORIAS_EXTRA[nomeOuAla]) {
    categorias = [CATEGORIAS_EXTRA[nomeOuAla]];
  } else {
    categorias = [nomeOuAla]; // assume que é nome de categoria do Commons
  }

  const todas = [];
  const vistos = new Set();
  const porCategoria = Math.ceil(limite / categorias.length);

  for (const cat of categorias) {
    if (todas.length >= limite) break;
    const obras = await buscarCategoria(cat, porCategoria + 5);
    for (const o of obras) {
      if (todas.length >= limite) break;
      if (vistos.has(o.pageid)) continue;
      vistos.add(o.pageid);
      todas.push(o);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return todas;
}

function listarCategoriasWikimedia() {
  return [...Object.keys(CATEGORIAS_WIKIMEDIA), ...Object.keys(CATEGORIAS_EXTRA)];
}

module.exports = {
  buscarPorCategoria,
  buscarCategoria,
  listarCategoriasWikimedia,
  CATEGORIAS_WIKIMEDIA,
  CATEGORIAS_EXTRA
};

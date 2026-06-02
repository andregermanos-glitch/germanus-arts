// server/categorias.js — Busca por Categoria do Wikimedia Commons
// Categorias reais e curadas do Commons (não busca por palavras-chave)

// ─── Mapeamento: cada ala → categorias reais do Wikimedia Commons ─────────────
const CATEGORIAS_WIKIMEDIA = {

  // Psyché — Surrealismo
  fase: [
    "Surrealist paintings",
    "Surrealism",
    "Paintings by Salvador Dalí",
    "Paintings by Max Ernst",
    "Metaphysical paintings"
  ],

  // Émotion — Abstração + Expressionismo + Dadaísmo
  cidades: [
    "Abstract paintings",
    "Abstract expressionism",
    "Expressionist paintings",
    "Dada",
    "Paintings by Wassily Kandinsky"
  ],

  // Couleurs — Fauvismo + Impressionismo + Construtivismo
  cores: [
    "Fauvist paintings",
    "Impressionist paintings",
    "Constructivism",
    "Post-Impressionist paintings",
    "Pointillist paintings"
  ],

  // Perspective — Cubismo (importante!)
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

  // Retratos — Portrait
  retratos: [
    "Portrait paintings",
    "Self-portraits",
    "Portrait paintings of men",
    "Portrait paintings of women"
  ],

  // Restantes alas — categorias adicionais do Commons
  historico: [
    "History paintings",
    "Battle paintings",
    "Napoleonic Wars in art"
  ],

  objetos: [
    "Still-life paintings",
    "Vanitas paintings",
    "Flower paintings"
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

  familiar: [
    "Genre paintings",
    "Interiors in art",
    "Domestic scenes in art"
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

  povo: [
    "Genre paintings",
    "Peasants in art",
    "Rural life in art"
  ],

  luz_sol: [
    "Impressionist paintings",
    "Luminism (Impressionism)",
    "Plein air paintings"
  ],

  pessoas_reais: [
    "Portrait paintings",
    "Group portraits",
    "Equestrian portraits"
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

// ─── Buscar membros de uma categoria do Commons ───────────────────────────────
async function buscarCategoria(categoria, limite = 50) {
  const url = `https://commons.wikimedia.org/w/api.php`
    + `?action=query&generator=categorymembers`
    + `&gcmtitle=${encodeURIComponent("Category:" + categoria)}`
    + `&gcmtype=file&gcmlimit=${Math.min(limite, 100)}`
    + `&prop=imageinfo&iiprop=url|extmetadata`
    + `&iiextmetadatafilter=LicenseShortName|Artist|DateTimeOriginal|ObjectName`
    + `&format=json&origin=*`;

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const d = await r.json();
    const obras = [];
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
    return obras;
  } catch(e) {
    console.log(`  [Commons] ${categoria}: ${e.message}`);
    return [];
  }
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

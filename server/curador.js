// server/curador.js — Motor de Curadoria Fixa
// Carrega listas curadas e indexa no PostgreSQL na inicialização
// Nível 1: obras icônicas garantidas, buscadas por ID ou título

const path = require("path");
const fs   = require("fs");

// Carrega todos os JSONs da pasta curadoria/ automaticamente
const CURADORIA_DIR = path.join(__dirname, "curadoria");
const TODAS_AS_ALAS = {};
fs.readdirSync(CURADORIA_DIR)
  .filter(f => f.endsWith(".json"))
  .forEach(f => {
    const ala = f.replace(".json", "");
    TODAS_AS_ALAS[ala] = require(path.join(CURADORIA_DIR, f));
    console.log(`  📂 Curadoria carregada: ${ala} (${TODAS_AS_ALAS[ala].length} obras)`);
  });

// ─── Busca obra por ID no Rijksmuseum via IIIF ────────────────────────────────
async function fetchRijksById(apiId) {
  try {
    const mr = await fetch(
      `https://www.rijksmuseum.nl/api/iiif/${apiId}/manifest/json`,
      { signal: AbortSignal.timeout(6000) }
    );
    const m = await mr.json();
    const lbl  = m.label || apiId;
    const title = typeof lbl === "string" ? lbl : (lbl?.en?.[0] || lbl?.nl?.[0] || apiId);
    const meta  = m.metadata || [];
    const cf = meta.find(x => (x.label||"").toLowerCase().includes("maker") || (x.label||"").toLowerCase().includes("artist"));
    const artist = cf?.value || "Rijksmuseum";
    const date   = (meta.find(x => (x.label||"").toLowerCase().includes("date"))?.value) || "";
    return {
      imageUrl: `https://iiif.rijksmuseum.nl/iiif/${apiId}/full/400,/0/default.jpg`,
      museum:   "Rijksmuseum, Amsterdã, Países Baixos",
      title, artist, date,
    };
  } catch { return null; }
}

// ─── Busca obra por ID no Harvard Art Museums ─────────────────────────────────
async function fetchHarvardById(apiId, key) {
  if (!key) return null;
  try {
    const r = await fetch(
      `https://api.harvardartmuseums.org/object/${apiId}?apikey=${key}`,
      { signal: AbortSignal.timeout(6000) }
    );
    const d = await r.json();
    if (!d.primaryimageurl) return null;
    return {
      imageUrl: d.primaryimageurl,
      museum:   "Harvard Art Museums, Cambridge, EUA",
      title:    d.title || "",
      artist:   d.people?.[0]?.name || "Desconhecido",
      date:     d.dated || "",
    };
  } catch { return null; }
}

// ─── Busca obra por título no Rijksmuseum (para api_id null) ──────────────────
async function searchRijksByTitle(creator, title) {
  try {
    const params = new URLSearchParams({
      type: "painting", imageAvailable: "true",
      creator: creator.split(" ").slice(0, 2).join(" "),
    });
    const r = await fetch(
      `https://data.rijksmuseum.nl/search/collection?${params}`,
      { signal: AbortSignal.timeout(8000),
        headers: { "Accept": "application/ld+json, application/json" } }
    );
    const d = await r.json();
    const items = d.orderedItems || [];
    for (const item of items.slice(0, 5)) {
      const idParts = (item.id || "").split("/");
      const objNum  = idParts[idParts.length - 1];
      if (!objNum) continue;
      const result = await fetchRijksById(objNum);
      if (result) return { ...result, api_id: objNum };
    }
  } catch {}
  return null;
}

// ─── Busca obra por título no Harvard ────────────────────────────────────────
async function searchHarvardByTitle(artist, title, key) {
  if (!key) return null;
  try {
    const q = encodeURIComponent(`${artist} ${title}`);
    const r = await fetch(
      `https://api.harvardartmuseums.org/object?keyword=${q}&hasimage=1&apikey=${key}&size=3`,
      { signal: AbortSignal.timeout(8000) }
    );
    const d = await r.json();
    const obj = (d.records || []).find(o => o.primaryimageurl);
    if (!obj) return null;
    return {
      imageUrl: obj.primaryimageurl,
      museum:   "Harvard Art Museums, Cambridge, EUA",
      title:    obj.title || title,
      artist:   obj.people?.[0]?.name || artist,
      date:     obj.dated || "",
      api_id:   String(obj.objectid),
    };
  } catch { return null; }
}

// ─── Busca obra no Europeana ──────────────────────────────────────────────────
async function searchEuropeana(searchQ, key) {
  if (!key) return null;
  try {
    const r = await fetch(
      `https://api.europeana.eu/record/v2/search.json?query=${encodeURIComponent(searchQ + " painting")}&rows=3&media=true&qf=TYPE%3AIMAGE&profile=rich`,
      { signal: AbortSignal.timeout(8000),
        headers: { "X-Api-Key": key, "Accept": "application/json" } }
    );
    const d = await r.json();
    const arr  = (o, f) => Array.isArray(o?.[f]) ? o[f][0] : (o?.[f] || "");
    const item = (d.items || []).find(o => arr(o, "edmPreview"));
    if (!item) return null;
    return {
      imageUrl: arr(item, "edmPreview"),
      museum:   arr(item, "dataProvider") || "Europeana",
      title:    arr(item, "title") || "",
      artist:   arr(item, "dcCreator") || "",
      date:     arr(item, "year") || "",
      api_id:   (item.id || "").replace(/\//g, "_"),
    };
  } catch { return null; }
}

// ─── Indexa uma obra no PostgreSQL ───────────────────────────────────────────
async function indexar(pool, obra, resultado) {
  if (!resultado?.imageUrl) return false;
  const id = `curated_${obra.api}_${resultado.api_id || obra.titulo.replace(/\s/g,"_").slice(0,30)}`;
  try {
    await pool.query(
      `INSERT INTO artworks (id,source,title,artist,date,medium,dimensions,origin,style,museum,description,credit,image_url,external_url,ala_id)
       VALUES ($1,'curadoria',$2,$3,$4,'','','',$5,$6,'','curadoria GERMANUS.Art',$7,'',$8)
       ON CONFLICT (id) DO UPDATE SET image_url=EXCLUDED.image_url, indexed_at=EXTRACT(EPOCH FROM NOW())::BIGINT`,
      [id, resultado.title || obra.titulo, resultado.artist || obra.autor,
       resultado.date || String(obra.ano), obra.importancia || "",
       resultado.museum, resultado.imageUrl, obra.ala]
    );
    return true;
  } catch { return false; }
}

// ─── Verifica se ala já foi indexada ─────────────────────────────────────────
async function alaJaIndexada(pool, ala) {
  try {
    const r = await pool.query(
      `SELECT COUNT(*) as n FROM artworks WHERE ala_id=$1 AND source='curadoria'`,
      [ala]
    );
    return parseInt(r.rows[0].n) >= 10;
  } catch { return false; }
}

// ─── Indexa todas as alas na inicialização ────────────────────────────────────
async function indexarCuradoria(pool, keys) {
  console.log("📚 Curadoria — verificando alas...");

  for (const [ala, obras] of Object.entries(TODAS_AS_ALAS)) {
    const jaFeito = await alaJaIndexada(pool, ala);
    if (jaFeito) {
      console.log(`  ✅ ${ala} — já indexada`);
      continue;
    }

    console.log(`  🎨 Indexando ${ala} (${obras.length} obras)...`);
    let ok = 0, skip = 0;

    // Processa em lotes de 5 para não sobrecarregar as APIs
    for (let i = 0; i < obras.length; i += 5) {
      const lote = obras.slice(i, i + 5);
      await Promise.all(lote.map(async (obra) => {
        let resultado = null;

        if (obra.api === "rijksmuseum") {
          if (obra.api_id) {
            resultado = await fetchRijksById(obra.api_id);
          } else if (obra.search_creator) {
            resultado = await searchRijksByTitle(obra.search_creator, obra.search_title || "");
          }
        } else if (obra.api === "harvard") {
          if (obra.api_id) {
            resultado = await fetchHarvardById(obra.api_id, keys.harvard);
          } else {
            resultado = await searchHarvardByTitle(obra.search_artist || obra.autor, obra.search_q || obra.titulo, keys.harvard);
          }
        } else if (obra.api === "europeana") {
          resultado = await searchEuropeana(obra.search_q || obra.titulo, keys.europeana);
        }

        const gravado = await indexar(pool, obra, resultado);
        if (gravado) ok++;
        else skip++;
      }));

      // Pausa entre lotes para respeitar rate limits
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`  ✅ ${ala} — ${ok} indexadas, ${skip} sem imagem`);
  }

  console.log("📚 Curadoria concluída.");
}

module.exports = { indexarCuradoria };

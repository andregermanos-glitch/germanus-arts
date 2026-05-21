// server/curador.js — Motor de Curadoria Fixa
// Prioridade: 1) image_url direto no JSON  2) Rijksmuseum IIIF por api_id
//             3) Met / Cleveland / AIC (sem chave)  4) Harvard  5) Europeana

const path = require("path");
const fs   = require("fs");

const CURADORIA_DIR = path.join(__dirname, "curadoria");
const TODAS_AS_ALAS = {};
fs.readdirSync(CURADORIA_DIR)
  .filter(f => f.endsWith(".json"))
  .forEach(f => {
    const ala = f.replace(".json", "");
    TODAS_AS_ALAS[ala] = require(path.join(CURADORIA_DIR, f));
    console.log(`  📂 Curadoria carregada: ${ala} (${TODAS_AS_ALAS[ala].length} obras)`);
  });

// ─── Helpers ──────────────────────────────────────────────────────────────────
const get = async (url, headers = {}) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

// ─── 1. Rijksmuseum IIIF por api_id ──────────────────────────────────────────
async function fetchRijksById(apiId) {
  try {
    const m = await get(`https://www.rijksmuseum.nl/api/iiif/${apiId}/manifest/json`);
    const lbl    = m.label || apiId;
    const title  = typeof lbl === "string" ? lbl : (lbl?.en?.[0] || lbl?.nl?.[0] || apiId);
    const meta   = m.metadata || [];
    const cf     = meta.find(x => /maker|artist/i.test(x.label || ""));
    const artist = cf?.value || "Rijksmuseum";
    const date   = meta.find(x => /date/i.test(x.label || ""))?.value || "";
    return {
      imageUrl: `https://iiif.rijksmuseum.nl/iiif/${apiId}/full/400,/0/default.jpg`,
      museum: "Rijksmuseum, Amsterdã, Países Baixos",
      title, artist, date,
      api_id: apiId,
    };
  } catch { return null; }
}

// ─── 2. Harvard por api_id ────────────────────────────────────────────────────
async function fetchHarvardById(apiId, key) {
  if (!key) return null;
  try {
    const d = await get(`https://api.harvardartmuseums.org/object/${apiId}?apikey=${key}`);
    if (!d.primaryimageurl) return null;
    return {
      imageUrl: d.primaryimageurl,
      museum:   "Harvard Art Museums, Cambridge, EUA",
      title:    d.title || "",
      artist:   d.people?.[0]?.name || "Desconhecido",
      date:     d.dated || "",
      api_id:   String(apiId),
    };
  } catch { return null; }
}

// ─── 3. Met Museum (sem chave) ────────────────────────────────────────────────
async function searchMet(query) {
  try {
    const s = await get(
      `https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=${encodeURIComponent(query)}`
    );
    const ids = (s.objectIDs || []).slice(0, 5);
    for (const id of ids) {
      try {
        const d = await get(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
        if (d.primaryImage && d.isPublicDomain) {
          return {
            imageUrl: d.primaryImageSmall || d.primaryImage,
            museum:   `${d.repository || "The Metropolitan Museum of Art"}, Nova York, EUA`,
            title:    d.title || query,
            artist:   d.artistDisplayName || "Desconhecido",
            date:     d.objectDate || "",
            api_id:   `met_${id}`,
          };
        }
      } catch {}
    }
  } catch {}
  return null;
}

// ─── 4. Cleveland Museum (sem chave) ─────────────────────────────────────────
async function searchCleveland(query) {
  try {
    const d = await get(
      `https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(query)}&has_image=1&limit=5`
    );
    const obj = (d.data || []).find(o => o.images?.web?.url);
    if (!obj) return null;
    return {
      imageUrl: obj.images.web.url,
      museum:   "Cleveland Museum of Art, Cleveland, EUA",
      title:    obj.title || query,
      artist:   obj.creators?.[0]?.description || "Desconhecido",
      date:     obj.creation_date || "",
      api_id:   `cle_${obj.id}`,
    };
  } catch { return null; }
}

// ─── 5. Art Institute of Chicago (sem chave) ──────────────────────────────────
async function searchAIC(query) {
  try {
    const d = await get(
      `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(query)}&fields=id,title,artist_display,date_display,image_id,is_public_domain&limit=5`
    );
    const obj = (d.data || []).find(o => o.image_id && o.is_public_domain);
    if (!obj) return null;
    return {
      imageUrl: `https://www.artic.edu/iiif/2/${obj.image_id}/full/400,/0/default.jpg`,
      museum:   "Art Institute of Chicago, Chicago, EUA",
      title:    obj.title || query,
      artist:   obj.artist_display || "Desconhecido",
      date:     obj.date_display || "",
      api_id:   `aic_${obj.id}`,
    };
  } catch { return null; }
}

// ─── 6. Europeana ─────────────────────────────────────────────────────────────
async function searchEuropeana(searchQ, key) {
  if (!key) return null;
  try {
    const d = await get(
      `https://api.europeana.eu/record/v2/search.json?query=${encodeURIComponent(searchQ + " painting")}&rows=3&media=true&qf=TYPE%3AIMAGE&profile=rich`,
      { "X-Api-Key": key, Accept: "application/json" }
    );
    const arr  = (o, f) => Array.isArray(o?.[f]) ? o[f][0] : (o?.[f] || "");
    const item = (d.items || []).find(o => arr(o, "edmPreview"));
    if (!item) return null;
    return {
      imageUrl: arr(item, "edmPreview"),
      museum:   arr(item, "dataProvider") || "Europeana",
      title:    arr(item, "title") || searchQ,
      artist:   arr(item, "dcCreator") || "",
      date:     arr(item, "year") || "",
      api_id:   (item.id || "").replace(/\//g, "_"),
    };
  } catch { return null; }
}

// ─── Rijksmuseum search por título (fallback) ─────────────────────────────────
async function searchRijksByTitle(creator, title) {
  try {
    const params = new URLSearchParams({
      type: "painting", imageAvailable: "true",
      creator: creator.split(" ").slice(0, 2).join(" "),
    });
    const d = await get(
      `https://data.rijksmuseum.nl/search/collection?${params}`,
      { Accept: "application/ld+json, application/json" }
    );
    for (const item of (d.orderedItems || []).slice(0, 5)) {
      const objNum = (item.id || "").split("/").at(-1);
      if (!objNum) continue;
      const result = await fetchRijksById(objNum);
      if (result) return { ...result, api_id: objNum };
    }
  } catch {}
  return null;
}

// ─── Harvard search por título ────────────────────────────────────────────────
async function searchHarvardByTitle(artist, title, key) {
  if (!key) return null;
  try {
    const q = encodeURIComponent(`${artist} ${title}`);
    const d = await get(
      `https://api.harvardartmuseums.org/object?keyword=${q}&hasimage=1&apikey=${key}&size=3`
    );
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

// ─── Indexa uma obra no PostgreSQL ────────────────────────────────────────────
// ─── hasMetadata — rejeita obras sem título, artista ou URL ──────────────────
function hasMetadata(resultado) {
  const title  = (resultado.title  || "").trim();
  const artist = (resultado.artist || "").trim();
  const url    = (resultado.imageUrl || "").trim();

  if (!url) return false;
  if (!title || title.toLowerCase() === "sem título") return false;
  if (!artist || artist.toLowerCase() === "desconhecido" || artist.toLowerCase() === "unknown") return false;
  return true;
}

async function indexar(pool, obra, resultado) {
  if (!hasMetadata(resultado)) return false;   // ← rejeita metadados incompletos
  const id = `curated_${obra.api}_${(resultado.api_id || obra.titulo).replace(/[^a-zA-Z0-9]/g,"_").slice(0,30)}`;
  try {
    await pool.query(
      `INSERT INTO artworks (id,source,title,artist,date,medium,dimensions,origin,style,museum,description,credit,image_url,external_url,ala_id)
       VALUES ($1,'curadoria',$2,$3,$4,'','','',$5,$6,'','curadoria GERMANUS.Art',$7,'',$8)
       ON CONFLICT (id) DO UPDATE SET image_url=EXCLUDED.image_url, indexed_at=EXTRACT(EPOCH FROM NOW())::BIGINT`,
      [id, resultado.title || obra.titulo, resultado.artist || obra.autor,
       resultado.date || String(obra.ano || ""), obra.importancia || "",
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

// ─── Resolve imagem de uma obra (cascata de 6 fontes) ────────────────────────
async function resolverObra(obra, keys) {
  // 0. image_url direto no JSON (mais confiável, sem chamada de API)
  if (obra.image_url) {
    return {
      imageUrl: obra.image_url,
      title:    obra.titulo,
      artist:   obra.autor,
      date:     String(obra.ano || ""),
      museum:   obra.institution || obra.origem || "",
      api_id:   obra.titulo.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30),
    };
  }

  // 1. Rijksmuseum por api_id
  if (obra.api === "rijksmuseum" && obra.api_id) {
    const r = await fetchRijksById(obra.api_id);
    if (r) return r;
  }

  // 2. Harvard por api_id
  if (obra.api === "harvard" && obra.api_id && keys.harvard) {
    const r = await fetchHarvardById(obra.api_id, keys.harvard);
    if (r) return r;
  }

  // 3. Met Museum (sem chave — grande acervo público)
  const q = obra.search_q || `${obra.autor} ${obra.titulo}`;
  const met = await searchMet(q);
  if (met) return met;

  // 4. Art Institute of Chicago (sem chave)
  const aic = await searchAIC(q);
  if (aic) return aic;

  // 5. Cleveland Museum (sem chave)
  const cle = await searchCleveland(q);
  if (cle) return cle;

  // 6. Rijksmuseum por título (se sem api_id)
  if (obra.api === "rijksmuseum" && obra.search_creator) {
    const r = await searchRijksByTitle(obra.search_creator, obra.search_title || "");
    if (r) return r;
  }

  // 7. Harvard por título
  if (obra.api === "harvard" && !obra.api_id) {
    const r = await searchHarvardByTitle(obra.search_artist || obra.autor, obra.search_q || obra.titulo, keys.harvard);
    if (r) return r;
  }

  // 8. Europeana
  if (obra.api === "europeana") {
    const r = await searchEuropeana(obra.search_q || obra.titulo, keys.europeana);
    if (r) return r;
  }

  return null;
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

    // Lotes de 4 para não sobrecarregar as APIs
    for (let i = 0; i < obras.length; i += 4) {
      const lote = obras.slice(i, i + 4);
      await Promise.all(lote.map(async (obra) => {
        const resultado = await resolverObra(obra, keys);
        const gravado   = await indexar(pool, obra, resultado);
        if (gravado) ok++; else skip++;
      }));
      await new Promise(r => setTimeout(r, 400));
    }

    console.log(`  ✅ ${ala} — ${ok} indexadas, ${skip} sem imagem`);
  }

  console.log("📚 Curadoria concluída.");
}

module.exports = { indexarCuradoria };

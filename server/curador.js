// server/curador.js — Motor de Curadoria Fixa
// Prioridade: 1) image_url direto no JSON  2) Rijksmuseum IIIF por api_id
//             3) Met / Cleveland / AIC (sem chave)  4) Harvard  5) Europeana
// ─── ALTERAÇÃO 13/06/2026 (anti-churn R2) ─────────────────────────────────────
// indexar(): o ON CONFLICT antes fazia SET image_url = COALESCE(EXCLUDED…), o que
// sobrescrevia a URL com a URL do museu recém-resolvida em toda re-indexação
// (a cada 6h por ala). Como a migrarLoteR2 movia a obra para o bucket, o curador
// a revertia 6h depois — ciclo infinito migração↔reversão.
// CORREÇÃO: se a image_url atual já aponta para o R2, NÃO tocar. A obra fica
// selada no bucket; só obras ainda em URL de museu são reprocessadas/recuperadas.
// ──────────────────────────────────────────────────────────────────────────────

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

// ─── Helpers Linked Art (nova API Rijksmuseum) ────────────────────────────────
// Procura recursivamente qualquer URL do iiif.micr.io no JSON Linked Art
function findMicrioUrl(obj, depth = 0) {
  if (depth > 12) return null;
  if (typeof obj === "string") {
    if (obj.includes("iiif.micr.io")) return obj;
    return null;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) { const r = findMicrioUrl(item, depth + 1); if (r) return r; }
  } else if (obj && typeof obj === "object") {
    for (const val of Object.values(obj)) { const r = findMicrioUrl(val, depth + 1); if (r) return r; }
  }
  return null;
}

function extractLabelLA(field) {
  if (!field) return null;
  if (typeof field === "string") return field;
  if (Array.isArray(field)) {
    for (const x of field) {
      if (typeof x === "string") return x;
      if (x?.content) return x.content;
      if (x?.value)   return x.value;
    }
  }
  if (typeof field === "object") {
    return field.en?.[0] || field.nl?.[0] || Object.values(field)[0]?.[0] || null;
  }
  return null;
}

function extractArtistLA(md) {
  // Linked Art: produced_by.carried_out_by[0]._label ou label
  const pb = md.produced_by;
  if (!pb) return null;
  const cob = pb.carried_out_by || [];
  if (!cob.length) return null;
  return extractLabelLA(cob[0]._label || cob[0].label) || null;
}

// ─── 1. Rijksmuseum por api_id — nova API (Search → Linked Art → iiif.micr.io)
async function fetchRijksById(apiId) {
  try {
    // Passo 1: Search API com objectNumber (parâmetro directo)
    const sr = await fetch(
      `https://data.rijksmuseum.nl/search/collection?objectNumber=${encodeURIComponent(apiId)}&imageAvailable=true`,
      { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } }
    );
    if (sr.ok) {
      const sd    = await sr.json();
      const item  = (sd.orderedItems || [])[0];
      const lodId = item?.id; // "https://id.rijksmuseum.nl/200415501"
      if (lodId) {
        // Passo 2: Resolver → Linked Art JSON
        const numId = lodId.split("/").at(-1);
        const mr = await fetch(
          `https://data.rijksmuseum.nl/${numId}`,
          { signal: AbortSignal.timeout(8000), headers: { Accept: "application/ld+json" } }
        );
        if (mr.ok) {
          const md = await mr.json();
          // Passo 3: Extrair URL iiif.micr.io recursivamente
          const micrioRaw = findMicrioUrl(md);
          if (micrioRaw) {
            const imageUrl = micrioRaw
              .replace("/info.json", "/full/!800,800/0/default.jpg")
              .replace("/manifest", "/full/!800,800/0/default.jpg");
            const title  = extractLabelLA(md._label || md.label || md.identified_by) || apiId;
            const artist = extractArtistLA(md) || "Rijksmuseum";
            return { imageUrl, title, artist, date: "", museum: "Rijksmuseum, Amsterdã, Países Baixos", api_id: apiId };
          }
        }
      }
    }

    // Fallback A: manifesto IIIF antigo (pode ainda funcionar)
    const mf = await fetch(
      `https://www.rijksmuseum.nl/api/iiif/${apiId}/manifest/json`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (mf.ok) {
      const m      = await mf.json();
      const canvas = m.sequences?.[0]?.canvases?.[0];
      const imgRes = canvas?.images?.[0]?.resource;
      const imgSvc = imgRes?.service?.["@id"];
      const imgId  = imgRes?.["@id"];
      const imageUrl = imgId || (imgSvc ? `${imgSvc}/full/400,/0/default.jpg` : null);
      if (imageUrl) {
        const lbl   = m.label;
        const title = typeof lbl === "string" ? lbl : (lbl?.en?.[0] || lbl?.nl?.[0] || apiId);
        const meta  = m.metadata || [];
        const ac    = meta.find(x => /maker|artist|kunstenaar/i.test(x.label || ""));
        const date  = meta.find(x => /date|datum/i.test(x.label || ""))?.value || "";
        return { imageUrl, title, artist: ac?.value || "", date, museum: "Rijksmuseum, Amsterdã, Países Baixos", api_id: apiId };
      }
    }

    // Fallback B: imagem IIIF directa (servidor antigo pode ainda responder)
    const directUrl = `https://iiif.rijksmuseum.nl/iiif/${apiId}/full/400,/0/default.jpg`;
    return { imageUrl: directUrl, title: apiId, artist: "Rijksmuseum", date: "", museum: "Rijksmuseum, Amsterdã, Países Baixos", api_id: apiId };
  } catch (e) {
    console.log(`  [Rijks] ${apiId}: ${e.message}`);
    return null;
  }
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
// Tipos aceites no Met — apenas pinturas e trabalhos sobre papel/tela
const MET_PAINTING_TYPES = new Set([
  "Paintings","Painting","Oil painting","Watercolor",
  "Tempera painting","Fresco","Panel painting"
]);

async function searchMet(query) {
  try {
    const s = await get(
      `https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=${encodeURIComponent(query + " painting")}`
    );
    const ids = (s.objectIDs || []).slice(0, 8);
    for (const id of ids) {
      try {
        const d = await get(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
        if (!d.primaryImage || !d.isPublicDomain) continue;
        const dept   = (d.department || "").toLowerCase();
        const objNm  = (d.objectName || "").toLowerCase();
        const medium = (d.medium || "").toLowerCase();
        const isRejectedType =
          dept.includes("arms") || dept.includes("textile") ||
          dept.includes("decorative") || dept.includes("musical") ||
          objNm.includes("sculpture") || objNm.includes("casket") ||
          objNm.includes("reliquary") || objNm.includes("vessel") ||
          objNm.includes("bowl") || objNm.includes("jar") ||
          objNm.includes("print") || objNm.includes("drawing") ||
          (medium.includes("bronze") && !medium.includes("oil")) ||
          (medium.includes("marble") && !medium.includes("oil")) ||
          (medium.includes("wood") && !medium.includes("oil") && !medium.includes("panel"));
        if (isRejectedType) continue;
        return {
          imageUrl: d.primaryImageSmall || d.primaryImage,
          museum:   `${d.repository || "The Metropolitan Museum of Art"}, Nova York, EUA`,
          title:    d.title || query,
          artist:   d.artistDisplayName || "Desconhecido",
          date:     d.objectDate || "",
          api_id:   `met_${id}`,
        };
      } catch {}
    }
  } catch {}
  return null;
}

// ─── 4. Cleveland Museum (sem chave) ─────────────────────────────────────────
async function searchCleveland(query) {
  try {
    const d = await get(
      `https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(query)}&has_image=1&type=painting&limit=5`
    );
    const obj = (d.data || []).find(o => {
      if (!o.images?.web?.url) return false;
      const t = (o.type || o.type_title || "").toLowerCase();
      return !t || t.includes("paint") || t.includes("oil") || t.includes("tempera") || t.includes("watercolor");
    });
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
      `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(query)}&fields=id,title,artist_display,date_display,image_id,is_public_domain,artwork_type_title,classification_title&limit=10`
    );
    const PAINTING_TYPES = new Set(["Painting","Oil painting","Watercolor","Tempera",
      "Painting and Drawing","Paintings","Mixed Media"]);
    const obj = (d.data || []).find(o => {
      if (!o.image_id || !o.is_public_domain) return false;
      const tipo = o.artwork_type_title || o.classification_title || "";
      return !tipo || PAINTING_TYPES.has(tipo) || tipo.toLowerCase().includes("paint");
    });
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
    if (title) params.set("title", title.split(" ").slice(0, 3).join(" "));
    const sr = await fetch(
      `https://data.rijksmuseum.nl/search/collection?${params}`,
      { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } }
    );
    if (!sr.ok) return null;
    const d = await sr.json();
    for (const item of (d.orderedItems || []).slice(0, 3)) {
      const numId = (item.id || "").split("/").at(-1);
      if (!numId) continue;
      try {
        const mr = await fetch(
          `https://data.rijksmuseum.nl/${numId}`,
          { signal: AbortSignal.timeout(6000), headers: { Accept: "application/ld+json" } }
        );
        if (!mr.ok) continue;
        const md = await mr.json();
        const micrioRaw = findMicrioUrl(md);
        if (micrioRaw) {
          const imageUrl = micrioRaw.replace("/info.json", "/full/!800,800/0/default.jpg");
          return {
            imageUrl,
            title:  extractLabelLA(md._label || md.label) || title,
            artist: extractArtistLA(md) || creator,
            date:   "",
            museum: "Rijksmuseum, Amsterdã, Países Baixos",
            api_id: numId,
          };
        }
      } catch {}
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

// ─── hasMetadata — rejeita obras sem título, artista ou URL ──────────────────
function hasMetadata(resultado) {
  if (!resultado) return false;  // ← guard contra null
  const title  = (resultado.title   || "").trim();
  const artist = (resultado.artist  || "").trim();
  const url    = (resultado.imageUrl || "").trim();
  if (!url) return false;
  if (!title  || title.toLowerCase()  === "sem título") return false;
  if (!artist || artist.toLowerCase() === "desconhecido"
              || artist.toLowerCase() === "unknown")     return false;
  return true;
}

// ─── Indexa uma obra no PostgreSQL ────────────────────────────────────────────
async function indexar(pool, obra, resultado) {
  if (!hasMetadata(resultado)) return false;   // ← rejeita metadados incompletos
  const id = `curated_${obra.api}_${(resultado.api_id || obra.titulo).replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}`;
  try {
    // ANTI-CHURN: se a image_url actual já aponta para o R2, congela — não
    // sobrescrever com a URL de museu recém-resolvida. Senão a re-indexação a
    // cada 6h reverteria todas as obras já migradas para o bucket.
    await pool.query(
      `INSERT INTO artworks (id,source,title,artist,date,medium,dimensions,origin,style,museum,description,credit,image_url,external_url,ala_id)
       VALUES ($1,'curadoria',$2,$3,$4,'','','',$5,$6,'','curadoria GERMANUS.Art',$7,'',$8)
       ON CONFLICT (id) DO UPDATE SET
         image_url = CASE
           WHEN artworks.image_url LIKE '%r2.dev%'
             OR artworks.image_url LIKE '%r2.cloudflarestorage%'
           THEN artworks.image_url
           ELSE COALESCE(EXCLUDED.image_url, artworks.image_url)
         END,
         indexed_at = EXTRACT(EPOCH FROM NOW())::BIGINT`,
      [id, resultado.title || obra.titulo, resultado.artist || obra.autor,
       resultado.date || String(obra.ano || ""), obra.importancia || "",
       resultado.museum, resultado.imageUrl, obra.ala]
    );
    return true;
  } catch { return false; }
}

// ─── Verifica se ala já foi indexada ─────────────────────────────────────────
async function alaJaIndexada(pool, ala, obras) {
  try {
    const JANELA_H  = 6;  // re-indexa se última passagem foi há >6h
    const threshold = Math.max(Math.floor((obras?.length || 10) * 0.5), 5);
    const cutoff    = Math.floor(Date.now() / 1000) - JANELA_H * 3600;

    const r = await pool.query(
      `SELECT COUNT(*) AS n
         FROM artworks
        WHERE ala_id    = $1
          AND source    = 'curadoria'
          AND indexed_at > $2`,
      [ala, cutoff]
    );

    const recentes = parseInt(r.rows[0].n, 10);
    return recentes >= threshold;
  } catch { return false; }
}

// ─── Met Museum por ID direto ────────────────────────────────────────────────
async function fetchMetById(metId) {
  try {
    const d = await get(
      `https://collectionapi.metmuseum.org/public/collection/v1/objects/${metId}`
    );
    if (!d.primaryImage || !d.isPublicDomain) return null;
    return {
      imageUrl: d.primaryImageSmall || d.primaryImage,
      museum:   `${d.repository || "The Metropolitan Museum of Art"}, Nova York, EUA`,
      title:    d.title || "",
      artist:   d.artistDisplayName || "Desconhecido",
      date:     d.objectDate || "",
      api_id:   `met_${metId}`,
    };
  } catch { return null; }
}

// ─── AIC por ID direto ────────────────────────────────────────────────────────
async function fetchAICById(aicId) {
  try {
    const d = await get(
      `https://api.artic.edu/api/v1/artworks/${aicId}?fields=id,title,artist_display,date_display,image_id,is_public_domain`
    );
    const obj = d.data;
    if (!obj?.image_id || !obj?.is_public_domain) return null;
    return {
      imageUrl: `https://www.artic.edu/iiif/2/${obj.image_id}/full/400,/0/default.jpg`,
      museum:   "Art Institute of Chicago, Chicago, EUA",
      title:    obj.title || "",
      artist:   obj.artist_display || "Desconhecido",
      date:     obj.date_display || "",
      api_id:   `aic_${aicId}`,
    };
  } catch { return null; }
}

// ─── Validação de correspondência artista/título ─────────────────────────────
function normalizar(str) {
  return (str || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // remove acentos
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

function palavrasChave(str) {
  const stopWords = new Set(["the","and","for","with","from","into","this","that",
    "les","des","une","dans","avec","sur","por","con","para","delle","della","nel"]);
  return normalizar(str).split(" ").filter(w => w.length > 3 && !stopWords.has(w));
}

function artistaCorresponde(esperado, encontrado) {
  if (!esperado) return true;  // sem restrição de artista
  const palavrasEsp = palavrasChave(esperado);
  const normEncontrado = normalizar(encontrado);
  return palavrasEsp.some(p => normEncontrado.includes(p));
}

function tituloCorresponde(esperado, encontrado, threshold = 0.4) {
  if (!esperado) return true;  // sem restrição de título
  const palavrasEsp = palavrasChave(esperado);
  if (palavrasEsp.length === 0) return true;
  const normEncontrado = normalizar(encontrado);
  const match = palavrasEsp.filter(p => normEncontrado.includes(p)).length;
  return (match / palavrasEsp.length) >= threshold;
}

function validarResultado(obra, resultado, modo = "artista") {
  if (!resultado) return false;
  if (modo === "artista") {
    return artistaCorresponde(obra.autor, resultado.artist);
  }
  if (modo === "titulo_artista") {
    return artistaCorresponde(obra.autor, resultado.artist) &&
           tituloCorresponde(obra.titulo, resultado.title);
  }
  return true;
}

// ─── Resolve imagem de uma obra (cascata de fontes) ──────────────────────────
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

  // 1. Rijksmuseum IIIF por api_id (mais confiável)
  if (obra.api === "rijksmuseum" && obra.api_id) {
    const r = await fetchRijksById(obra.api_id);
    if (r) return r;
  }

  // 2. Harvard por api_id
  if (obra.api === "harvard" && obra.api_id && keys.harvard) {
    const r = await fetchHarvardById(obra.api_id, keys.harvard);
    if (r) return r;
  }

  // 3. Met por ID direto
  if (obra.met_id) {
    const r = await fetchMetById(obra.met_id);
    if (r) return r;
  }

  // 4. AIC por ID direto
  if (obra.aic_id) {
    const r = await fetchAICById(obra.aic_id);
    if (r) return r;
  }

  // ── Fallbacks por busca de texto ────────────────────────────────────────────
  const q = obra.search_q || `${obra.autor} ${obra.titulo}`;
  const modoValidacao = (obra.autor && obra.titulo) ? "titulo_artista"
                      : obra.autor                  ? "artista"
                      : "rejeitar"; // sem artista = não aceitar resultado incerto

  if (modoValidacao === "rejeitar") {
    return null;
  }

  // 5. Met Museum por texto + validação
  const met = await searchMet(q);
  if (met && validarResultado(obra, met, modoValidacao)) return met;
  if (met) console.log(`  ⚠ Met rejeitado: esperado "${obra.autor} / ${obra.titulo}", encontrado "${met.artist} / ${met.title}"`);

  // 6. AIC por texto + validação
  const aic = await searchAIC(q);
  if (aic && validarResultado(obra, aic, modoValidacao)) return aic;
  if (aic) console.log(`  ⚠ AIC rejeitado: esperado "${obra.autor} / ${obra.titulo}", encontrado "${aic.artist} / ${aic.title}"`);

  // 7. Cleveland por texto + validação
  const cle = await searchCleveland(q);
  if (cle && validarResultado(obra, cle, modoValidacao)) return cle;
  if (cle) console.log(`  ⚠ Cleveland rejeitado: esperado "${obra.autor} / ${obra.titulo}", encontrado "${cle.artist} / ${cle.title}"`);

  // 8. Rijksmuseum por título + validação de artista
  if (obra.api === "rijksmuseum" && obra.search_creator) {
    const r = await searchRijksByTitle(obra.search_creator, obra.search_title || "");
    if (r && validarResultado(obra, r, "artista")) return r;
  }

  // 9. Harvard por título + validação de artista
  if (obra.api === "harvard" && !obra.api_id) {
    const r = await searchHarvardByTitle(obra.search_artist || obra.autor, obra.search_q || obra.titulo, keys.harvard);
    if (r && validarResultado(obra, r, "artista")) return r;
  }

  // 10. Europeana: exige correspondência de artista E título (fonte menos fiável)
  if (obra.api === "europeana") {
    const r = await searchEuropeana(obra.search_q || obra.titulo, keys.europeana);
    if (r && validarResultado(obra, r, "titulo_artista")) return r;
    if (r) console.log(`  ⚠ Europeana rejeitada: esperado "${obra.autor} / ${obra.titulo}", encontrado "${r.artist} / ${r.title}"`);
  }

  return null;
}

// ─── Indexa todas as alas na inicialização ────────────────────────────────────
async function indexarCuradoria(pool, keys) {
  console.log("📚 Curadoria — verificando alas...");

  for (const [ala, obras] of Object.entries(TODAS_AS_ALAS)) {
    // ── Fase 1: indexar alas novas ou com cache expirado (>6h) ──────────────
    const jaFeito = await alaJaIndexada(pool, ala, obras);

    if (jaFeito) {
      console.log(`  ✅ ${ala} — cache válido, a saltar`);
    } else {
      console.log(`  🎨 Indexando ${ala} (${obras.length} obras)...`);
      let ok = 0, skip = 0;

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

    // ── Fase 2: re-tentar obras sem image_url desta ala ─────────────────────
    // (só toca obras com URL vazia; obras no R2 têm URL preenchida → não entram)
    try {
      const semImg = await pool.query(
        `SELECT id, title, artist
           FROM artworks
          WHERE ala_id = $1
            AND source = 'curadoria'
            AND (image_url IS NULL OR image_url = '')
          LIMIT 10`,
        [ala]
      );

      if (semImg.rows.length > 0) {
        console.log(`  🔄 ${ala} — ${semImg.rows.length} obras sem imagem, retentando...`);
        for (const row of semImg.rows) {
          const obraOriginal = obras.find(o =>
            normalizar(o.titulo) === normalizar(row.title) ||
            normalizar(o.autor)  === normalizar(row.artist)
          );
          if (!obraOriginal) continue;

          const resultado = await resolverObra(obraOriginal, keys);
          if (resultado?.imageUrl) {
            await pool.query(
              `UPDATE artworks
                  SET image_url  = $1,
                      indexed_at = EXTRACT(EPOCH FROM NOW())::BIGINT
                WHERE id = $2`,
              [resultado.imageUrl, row.id]
            );
            console.log(`    ✓ Imagem recuperada: ${row.title?.slice(0, 45)}`);
          }
          await new Promise(r => setTimeout(r, 300));
        }
      }
    } catch (e) {
      console.log(`  ⚠ Fase 2 falhou para ${ala}: ${e.message}`);
    }
  }

  console.log("📚 Curadoria concluída.");
}

module.exports = { indexarCuradoria };

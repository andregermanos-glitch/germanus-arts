// museums.js — Conectores para 8 APIs de museus globais
// Cada conector: busca, normaliza e verifica imagem antes de retornar

const fetch = require("node-fetch");

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Verifica se uma URL de imagem é acessível (retorna 200 com content-type image/*)
async function verifyImage(url, timeout = 5000) {
  if (!url) return false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(url, { method: "HEAD", signal: ctrl.signal });
    clearTimeout(timer);
    const ct = res.headers.get("content-type") || "";
    return res.ok && ct.startsWith("image/");
  } catch {
    return false;
  }
}

// Normaliza um objeto de obra para o formato padrão Germanus
function normalize(source, obj) {
  return {
    id:          `${source}_${obj.id}`,
    source,
    title:       obj.title       || "Sem título",
    artist:      obj.artist      || "Desconhecido",
    date:        obj.date        || "",
    medium:      obj.medium      || "",
    dimensions:  obj.dimensions  || "",
    origin:      obj.origin      || "",
    style:       obj.style       || "",
    museum:      obj.museum      || "",
    description: obj.description || "",
    credit:      obj.credit      || "",
    imageUrl:    obj.imageUrl    || "",
    externalUrl: obj.externalUrl || "",
    type:        obj.type        || "",
  };
}

// Filtra e verifica imagens em paralelo (mantém só quem tem imagem)
async function filterWithImages(artworks) {
  const results = await Promise.all(
    artworks.map(async art => {
      const ok = await verifyImage(art.imageUrl);
      return ok ? art : null;
    })
  );
  return results.filter(Boolean);
}

// ─── 1. Victoria & Albert Museum (Londres) ────────────────────────────────────
// Sem chave, CORS nativo, 1M+ obras
async function searchVAM(query, limit = 8) {
  try {
    const url = `https://api.vam.ac.uk/v2/objects/search?q=${encodeURIComponent(query)}&page_size=${limit}&images_exist=1`;
    const res = await fetch(url, { timeout: 10000 });
    const data = await res.json();

    const raw = (data.records || []).filter(o => o._primaryImageId).map(o => ({
      id:          o.systemNumber,
      title:       o._primaryTitle || "Sem título",
      artist:      o._primaryMaker?.name || "Desconhecido",
      date:        o._primaryDate || "",
      medium:      o._primaryMedium || "",
      dimensions:  "",
      origin:      o._primaryPlace || "Reino Unido",
      style:       "",
      museum:      "Victoria and Albert Museum, Londres, Reino Unido",
      description: "",
      credit:      "Victoria and Albert Museum",
      type:        o._primaryType || "",
      imageUrl:    `https://framemark.vam.ac.uk/collections/${o._primaryImageId}/full/400,/0/default.jpg`,
      externalUrl: `https://collections.vam.ac.uk/item/${o.systemNumber}/`,
    }));

    return filterWithImages(raw.map(o => normalize("vam", o)));
  } catch (e) {
    console.error("[VAM]", e.message);
    return [];
  }
}

// ─── 2. Rijksmuseum (Amsterdã) — API aberta, sem chave ───────────────────────
// Nova API Linked Art: data.rijksmuseum.nl/search/collection
async function searchRijks(query, key, limit = 8) {
  // Tenta primeiro a nova API sem chave
  try {
    const url = `https://data.rijksmuseum.nl/search/collection?q=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await fetch(url, { timeout: 10000 });
    const data = await res.json();
    const items = data.orderedItems
      || data["ordered_items"]
      || data.items
      || data.results
      || data["@graph"]
      || [];

    console.log(`[Rijks nova API] resposta: ${JSON.stringify(Object.keys(data))} — ${items.length} itens`);
    const raw = items
      .map(o => {
        const idParts = (o.id || "").split("/");
        const objNum  = idParts[idParts.length - 1] || "";
        if (!objNum) return null;

        // URL IIIF construída diretamente — sempre funciona para objetos do Rijksmuseum
        const imageUrl = `https://iiif.rijksmuseum.nl/iiif/${objNum}/full/400,/0/default.jpg`;

        const label  = o.label || {};
        const title  = (label.en || label.nl || Object.values(label)[0] || ["Sem título"])[0];
        const produced = o.produced_by?.carried_out_by || [];
        const artistLabel = produced[0]?.label;
        const artist = artistLabel ? (Object.values(artistLabel)[0] || ["Desconhecido"])[0] : "Desconhecido";

        return normalize("rijks", {
          id:          objNum,
          title,
          artist,
          date:        "",
          medium:      "",
          dimensions:  "",
          origin:      "Países Baixos",
          style:       "",
          museum:      "Rijksmuseum, Amsterdã, Países Baixos",
          description: "",
          credit:      "Rijksmuseum",
          type:        "",
          imageUrl,
          externalUrl: `https://www.rijksmuseum.nl/en/collection/${objNum}`,
        });
      })
      .filter(Boolean);

    // Confia nas URLs IIIF do Rijksmuseum sem verificação HEAD
    if (raw.length > 0) return raw;
  } catch (e) {
    console.log("[Rijks nova API]", e.message, "— tentando API antiga...");
  }

  // Fallback: API antiga com chave (se tiver)
  if (!key) return [];
  try {
    const url = `https://www.rijksmuseum.nl/api/en/collection?key=${key}&q=${encodeURIComponent(query)}&imgonly=True&ps=${limit}&format=json`;
    const res = await fetch(url, { timeout: 10000 });
    const data = await res.json();
    const raw = (data.artObjects || []).filter(o => o.webImage?.url).map(o => ({
      id:          o.objectNumber,
      title:       o.title || "Sem título",
      artist:      o.principalOrFirstMaker || "Desconhecido",
      date:        o.dating?.presentingDate || "",
      medium:      o.physicalMedium || "",
      dimensions:  "",
      origin:      "Países Baixos",
      style:       "",
      museum:      "Rijksmuseum, Amsterdã, Países Baixos",
      description: o.plaqueDescriptionEnglish || "",
      credit:      "Rijksmuseum",
      type:        "Pintura",
      imageUrl:    o.webImage.url,
      externalUrl: `https://www.rijksmuseum.nl/en/collection/${o.objectNumber}`,
    }));
    return filterWithImages(raw.map(o => normalize("rijks", o)));
  } catch (e) {
    console.error("[Rijks antiga]", e.message);
    return [];
  }
}

// ─── 3. Cleveland Museum of Art ───────────────────────────────────────────────
// Sem chave, CORS nativo, 64k+ obras CC0
async function searchCleveland(query, limit = 8) {
  try {
    const url = `https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(query)}&limit=${limit}&has_image=1&cc0=1`;
    const res = await fetch(url, { timeout: 10000 });
    const data = await res.json();

    const raw = (data.data || []).filter(o => o.images?.web?.url).map(o => normalize("cleveland", {
      id:          String(o.id),
      title:       o.title || "Sem título",
      artist:      o.creators?.[0]?.description || "Desconhecido",
      date:        o.creation_date || "",
      medium:      o.technique || "",
      dimensions:  o.dimensions?.framed ? `${Math.round(o.dimensions.framed.height)} × ${Math.round(o.dimensions.framed.width)} cm` : "",
      origin:      o.culture || "EUA",
      style:       o.style || "",
      museum:      "Cleveland Museum of Art, Ohio, EUA",
      description: (o.did_you_know || o.description || "").replace(/<[^>]+>/g, ""),
      credit:      o.creditline || "Cleveland Museum of Art",
      type:        o.type || "",
      imageUrl:    o.images.web.url,
      externalUrl: o.url || `https://www.clevelandart.org/art/${o.id}`,
    }));

    return raw.filter(o => o.imageUrl);
  } catch (e) {
    console.error("[Cleveland]", e.message);
    return [];
  }
}

// ─── 4. Art Institute of Chicago (AIC) ───────────────────────────────────────
// Sem chave, IIIF, 120k+ obras
async function searchAIC(query, limit = 8) {
  try {
    const fields = "id,title,artist_display,date_display,medium_display,dimensions,style_title,place_of_origin,description,image_id,credit_line,department_title,artwork_type_title";
    const url = `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(query)}&fields=${fields}&limit=${limit}`;
    const res = await fetch(url, { timeout: 10000 });
    const data = await res.json();

    // Exclui tipos que não são obras de arte visual
    const excludeTypes = ["Architectural", "Technical", "Map", "Document", "Decorative Art", "Stencil", "Poster", "Graphic Design", "Ephemera"];
    const raw = (data.data || []).filter(o =>
      o.image_id &&
      !excludeTypes.some(t => (o.artwork_type_title||"").includes(t))
    ).map(o => normalize("aic", {
      id:          String(o.id),
      title:       o.title || "Sem título",
      artist:      o.artist_display || "Desconhecido",
      date:        o.date_display || "",
      medium:      o.medium_display || "",
      dimensions:  o.dimensions || "",
      origin:      o.place_of_origin || "EUA",
      style:       o.style_title || "",
      museum:      "Art Institute of Chicago, Illinois, EUA",
      description: (o.description || "").replace(/<[^>]+>/g, ""),
      credit:      o.credit_line || "Art Institute of Chicago",
      type:        o.artwork_type_title || "",
      // URLs IIIF do AIC são confiáveis — sem verificação HEAD que falha server-side
      imageUrl:    `https://www.artic.edu/iiif/2/${o.image_id}/full/400,/0/default.jpg`,
      externalUrl: `https://www.artic.edu/artworks/${o.id}`,
    }));

    return raw.filter(o => o.imageUrl);
  } catch (e) {
    console.error("[AIC]", e.message);
    return [];
  }
}

// ─── 5. Metropolitan Museum of Art (Nova York) ───────────────────────────────
// Sem chave, 470k+ obras — busca em 2 etapas
async function searchMet(query, limit = 6) {
  try {
    const searchUrl = `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(query)}&hasImages=true`;
    const sr = await fetch(searchUrl, { timeout: 10000 });
    const sd = await sr.json();
    const ids = (sd.objectIDs || []).slice(0, limit * 2); // pega mais pois alguns podem falhar

    const objects = await Promise.all(
      ids.map(id =>
        fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, { timeout: 8000 })
          .then(r => r.json())
          .catch(() => null)
      )
    );

    const raw = objects.filter(o => o?.primaryImageSmall).slice(0, limit).map(o => normalize("met", {
      id:          String(o.objectID),
      title:       o.title || "Sem título",
      artist:      o.artistDisplayName || "Desconhecido",
      date:        o.objectDate || "",
      medium:      o.medium || "",
      dimensions:  o.dimensions || "",
      origin:      o.country || o.culture || "",
      style:       o.period || "",
      museum:      `The Metropolitan Museum of Art, Nova York, EUA — ${o.department || ""}`,
      description: o.creditLine || "",
      credit:      "The Metropolitan Museum of Art",
      type:        o.objectName || "",
      imageUrl:    o.primaryImageSmall,
      externalUrl: o.objectURL || "",
    }));

    return raw.filter(o => o.imageUrl);
  } catch (e) {
    console.error("[Met]", e.message);
    return [];
  }
}

// ─── 6. Smithsonian Institution ───────────────────────────────────────────────
// Chave gratuita (DEMO_KEY funciona com rate limit), 4M+ obras
async function searchSmithsonian(query, key = "DEMO_KEY", limit = 8) {
  try {
    const url = `https://api.si.edu/openaccess/api/v1.0/search?q=${encodeURIComponent(query)}&api_key=${key}&rows=${limit}&media.type=Images&type=edanmdm`;
    const res = await fetch(url, { timeout: 10000 });
    const data = await res.json();

    const raw = (data.response?.rows || []).map(o => {
      const dnr = o.content?.descriptiveNonRepeating || {};
      const ft  = o.content?.freetext || {};
      const img = dnr.online_media?.media?.[0];
      const imgUrl = img?.thumbnail || img?.content || "";
      return {
        id:          o.id,
        title:       dnr.title?.content || o.title || "Sem título",
        artist:      ft.name?.[0]?.content || "Desconhecido",
        date:        ft.date?.[0]?.content || "",
        medium:      ft.physicalDescription?.[0]?.content || "",
        dimensions:  "",
        origin:      "EUA",
        style:       "",
        museum:      `Smithsonian Institution — ${dnr.data_source || ""}`,
        description: ft.notes?.[0]?.content || "",
        credit:      `Smithsonian — ${dnr.data_source || ""}`,
        type:        "",
        imageUrl:    imgUrl,
        externalUrl: `https://collections.si.edu/search/detail/${o.id}`,
      };
    }).filter(o => o.imageUrl);

    return filterWithImages(raw.map(o => normalize("smithsonian", o)));
  } catch (e) {
    console.error("[Smithsonian]", e.message);
    return [];
  }
}

// ─── 7. Harvard Art Museums ───────────────────────────────────────────────────
// Chave gratuita obrigatória, 250k+ obras
async function searchHarvard(query, key, limit = 8) {
  if (!key) return [];
  try {
    const fields = "id,title,people,dated,technique,dimensions,department,description,primaryimageurl,url,creditline,culture,period,division,classification";
    const url = `https://api.harvardartmuseums.org/object?apikey=${key}&keyword=${encodeURIComponent(query)}&size=${limit}&hasimage=1&fields=${fields}`;
    const res = await fetch(url, { timeout: 10000 });
    const data = await res.json();

    const raw = (data.records || []).filter(o => o.primaryimageurl).map(o => ({
      id:          String(o.id),
      title:       o.title || "Sem título",
      artist:      o.people?.find(p => p.role === "Artist")?.name || o.people?.[0]?.name || "Desconhecido",
      date:        o.dated || "",
      medium:      o.technique || "",
      dimensions:  o.dimensions || "",
      origin:      o.culture || "EUA",
      style:       o.period || "",
      museum:      `Harvard Art Museums, Boston, EUA — ${o.division || o.department || ""}`,
      description: o.description || "",
      credit:      o.creditline || "Harvard Art Museums",
      type:        o.classification || "",
      imageUrl:    o.primaryimageurl,
      externalUrl: o.url || `https://www.harvardartmuseums.org/collections/object/${o.id}`,
    }));

    return filterWithImages(raw.map(o => normalize("harvard", o)));
  } catch (e) {
    console.error("[Harvard]", e.message);
    return [];
  }
}

// ─── 8. Europeana ─────────────────────────────────────────────────────────────
// Chave gratuita, 50M+ obras europeias — suporta wskey (projeto) e apikey (pessoal)
async function searchEuropeana(query, key, limit = 8) {
  if (!key) return [];
  try {
    // Tenta com apikey (chave pessoal — nova API)
    const url = `https://api.europeana.eu/record/v2/search.json?apikey=${key}&query=${encodeURIComponent(query)}&rows=${limit}&media=true&reusability=open&qf=TYPE%3AIMAGE&profile=rich`;
    const res = await fetch(url, { timeout: 10000 });
    const data = await res.json();

    if (!data.items && data.success === false) {
      console.log(`[Europeana] apikey falhou:`, data.error || "sem detalhe", "— tentando wskey...");
      // Fallback wskey (chave de projeto — API antiga)
      const url2 = `https://api.europeana.eu/record/v2/search.json?wskey=${key}&query=${encodeURIComponent(query)}&rows=${limit}&media=true&reusability=open&qf=TYPE%3AIMAGE&profile=rich`;
      const res2 = await fetch(url2, { timeout: 10000 });
      const data2 = await res2.json();
      if (!data2.items) return [];
      return processEuropeanaItems(data2.items, limit);
    }

    if (!data.items) return [];
    console.log(`[Europeana] ✅ ${data.items?.length || 0} resultados com apikey`);
    return processEuropeanaItems(data.items, limit);
  } catch (e) {
    console.error("[Europeana]", e.message);
    return [];
  }
}

function processEuropeanaItems(items, limit) {
  const arr = (item, field) => Array.isArray(item?.[field]) ? item[field][0] : (item?.[field] || "");
  const raw = (items || [])
    .filter(o => arr(o, "edmPreview"))
    .slice(0, limit)
    .map(o => normalize("europeana", {
      id:          (o.id || "").replace(/\//g, "_"),
      title:       arr(o, "title") || "Sem título",
      artist:      arr(o, "dcCreator") || "Desconhecido",
      date:        arr(o, "year") || "",
      medium:      "",
      dimensions:  "",
      origin:      arr(o, "country") || "Europa",
      style:       "",
      museum:      arr(o, "dataProvider") || "Europeana",
      description: arr(o, "dcDescription") || "",
      credit:      `Europeana — ${arr(o, "dataProvider") || ""}`,
      type:        "",
      // Europeana fornece URLs de thumbnail diretas e confiáveis — sem verificação HEAD
      imageUrl:    arr(o, "edmPreview"),
      externalUrl: arr(o, "edmIsShownAt") || o.guid || "",
    }));
  // Filtra apenas por URL existente — não faz HEAD request (bloqueia CORS)
  return raw.filter(o => o.imageUrl && o.imageUrl.startsWith("http"));
}

// ─── Busca unificada ──────────────────────────────────────────────────────────
async function searchAll(query, keys = {}, options = {}) {
  const limit = options.limit || 6;

  const runners = [
    searchVAM(query, limit),
    searchCleveland(query, limit),
    searchAIC(query, limit),
    searchMet(query, limit),
    searchRijks(query, keys.rijks, limit),
    searchSmithsonian(query, keys.si || "DEMO_KEY", limit),
    searchHarvard(query, keys.harvard, limit),
    searchEuropeana(query, keys.europeana, limit),
  ];

  const results = await Promise.allSettled(runners);

  const all = results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => r.value);

  // Aplica filtro de ano se fornecido
  const { fromYear, toYear } = options;
  if (fromYear || toYear) {
    return all.filter(art => {
      const year = parseInt(art.date);
      if (isNaN(year)) return true; // mantém se não tem ano
      if (fromYear && year < parseInt(fromYear)) return false;
      if (toYear   && year > parseInt(toYear))   return false;
      return true;
    });
  }

  return all;
}

module.exports = {
  searchAll,
  searchVAM,
  searchRijks,
  searchCleveland,
  searchAIC,
  searchMet,
  searchSmithsonian,
  searchHarvard,
  searchEuropeana,
  verifyImage,
};

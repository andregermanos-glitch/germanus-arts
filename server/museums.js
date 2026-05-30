// museums.js — Conectores para 8 APIs de museus globais + Shanghai Museum
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

// ─── 2. Rijksmuseum (Amsterdã) ────────────────────────────────────────────────
async function searchRijks(query, key, limit = 8) {
  try {
    const mainWord = query.split(" ").filter(w => w.length > 3)[0] || query.split(" ")[0];
    const params = new URLSearchParams({ type:"painting", imageAvailable:"true", description:mainWord });
    const url = `https://data.rijksmuseum.nl/search/collection?${params}`;
    const res = await fetch(url, {
      timeout: 10000,
      headers: { "Accept": "application/ld+json, application/json", "User-Agent": "GermanusArt/1.0" }
    });
    const data = await res.json();
    const items = data.orderedItems || [];
    if (items.length === 0) return [];

    const results = await Promise.all(items.slice(0, limit).map(async (item) => {
      const idParts = (item.id || "").split("/");
      const objNum  = idParts[idParts.length - 1];
      if (!objNum || objNum.length < 3) return null;
      let title = objNum, artist = "Rijksmuseum";
      try {
        const mr = await fetch(`https://www.rijksmuseum.nl/api/iiif/${objNum}/manifest/json`, { signal:AbortSignal.timeout(4000) });
        const manifest = await mr.json();
        const lbl = manifest.label;
        title = typeof lbl==="string" ? lbl : (lbl?.en?.[0] || lbl?.nl?.[0] || objNum);
        const meta = manifest.metadata || [];
        const cf = meta.find(m => (m.label||"").includes("maker") || (m.label||"").includes("Kunst"));
        if (cf?.value) artist = cf.value;
      } catch {}
      return normalize("rijks", {
        id:objNum, title, artist, date:"", medium:"Oil on canvas", dimensions:"",
        origin:"Países Baixos", style:"", museum:"Rijksmuseum, Amsterdã, Países Baixos",
        description:"", credit:"Rijksmuseum", type:"Painting",
        imageUrl:`https://iiif.rijksmuseum.nl/iiif/${objNum}/full/400,/0/default.jpg`,
        externalUrl:`https://www.rijksmuseum.nl/en/collection/${objNum}`,
      });
    }));
    return results.filter(Boolean);
  } catch (e) {
    console.log("[Rijks nova API] erro:", e.message);
  }

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

// ─── 4. Art Institute of Chicago (AIC) ────────────────────────────────────────
async function searchAIC(query, limit = 8) {
  try {
    const fields = "id,title,artist_display,date_display,medium_display,dimensions,style_title,place_of_origin,description,image_id,credit_line,department_title,artwork_type_title";
    const url = `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(query)}&fields=${fields}&limit=${limit}`;
    const res = await fetch(url, { timeout: 10000 });
    const data = await res.json();

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
      imageUrl:    `https://www.artic.edu/iiif/2/${o.image_id}/full/400,/0/default.jpg`,
      externalUrl: `https://www.artic.edu/artworks/${o.id}`,
    }));

    return raw.filter(o => o.imageUrl);
  } catch (e) {
    console.error("[AIC]", e.message);
    return [];
  }
}

// ─── 5. Metropolitan Museum of Art (Nova York) ────────────────────────────────
async function searchMet(query, limit = 6) {
  try {
    const searchUrl = `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(query)}&hasImages=true`;
    const sr = await fetch(searchUrl, { timeout: 10000 });
    const sd = await sr.json();
    const ids = (sd.objectIDs || []).slice(0, limit * 2);

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
async function searchEuropeana(query, key, limit = 8) {
  if (!key) return [];
  try {
    const simpleQuery = query.split(" ")[0];
    const artQuery = `${simpleQuery} painting`;
    const url = `https://api.europeana.eu/record/v2/search.json?query=${encodeURIComponent(artQuery)}&rows=${limit}&media=true&qf=TYPE%3AIMAGE&profile=rich`;
    const res = await fetch(url, {
      timeout: 10000,
      headers: { "X-Api-Key": key, "Accept": "application/json" }
    });
    const data = await res.json();

    if (data.success === false || !data.items) {
      return [];
    }

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
      imageUrl:    arr(o, "edmPreview"),
      externalUrl: arr(o, "edmIsShownAt") || o.guid || "",
    }));
  return raw.filter(o => o.imageUrl && o.imageUrl.startsWith("http"));
}

// ─── 9. SHANGHAI MUSEUM (Museu de Xangai) ─────────────────────────────────────
// Termos de busca para cada uma das 18 alas
const TERMOS_SHANGHAI = {
  retratos: ["portrait figure person", "人物画", "人像", "portrait painting"],
  pessoas_reais: ["historical figure emperor", "历史人物", "帝王像", "official portrait"],
  historico: ["historical event battle", "历史事件", "战争图", "battle scene"],
  perspectiva: ["architecture perspective", "建筑画", "园林", "garden view"],
  objetos: ["still life object", "静物", "器物", "art object"],
  lugares: ["famous place landscape", "名胜", "风景", "landscape famous"],
  natureza: ["nature landscape", "山水", "自然风景", "mountain water"],
  familiar: ["family domestic scene", "家庭生活", "仕女图", "domestic interior"],
  nudes: ["figure nude", "人体", "裸体画", "nude figure"],
  esoterico: ["religious mystical", "宗教画", "佛道", "mystical art"],
  sacro: ["religious sacred buddhist", "佛教艺术", "道教", "sacred art"],
  arquitetura: ["architecture building", "建筑", "宫殿", "building art"],
  povo: ["peasant worker folk", "民俗", "市井", "folk scene"],
  luz_sol: ["sunlight bright", "阳光", "明亮", "sunlight scene"],
  cores: ["colorful vibrant", "色彩", "绚丽", "color art"],
  cidades: ["urban city scene", "城市", "都市", "cityscape"],
  fase: ["surreal fantasy", "奇幻", "梦幻", "fantasy art"],
  femininas: ["female woman artist", "女性艺术", "仕女", "woman figure"]
};

async function buscarShanghaiMuseum(termo, maxN = 8, ala = null) {
  const resultados = [];
  let termosBusca = [];
  
  if (ala && TERMOS_SHANGHAI[ala]) {
    termosBusca = TERMOS_SHANGHAI[ala];
  } else {
    termosBusca = [termo, "art", "painting", "chinese art"];
  }
  
  for (const busca of termosBusca.slice(0, 3)) {
    if (resultados.length >= maxN) break;
    
    try {
      const url = `https://www.shanghaimuseum.net/mu/frontend/pg/en/collection/antique?keywords=${encodeURIComponent(busca)}&format=json&limit=${maxN * 2}`;
      
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json"
        },
        signal: AbortSignal.timeout(10000)
      });
      
      if (!response.ok) continue;
      
      const data = await response.json();
      
      if (data.data && data.data.length > 0) {
        for (const item of data.data.slice(0, maxN - resultados.length)) {
          if (!item.image_url && !item.thumb_url) continue;
          
          resultados.push({
            imageUrl: item.image_url || item.thumb_url,
            museum: "Shanghai Museum, Xangai, China",
            title: item.title_en || item.title || "Sem título",
            artist: item.artist_en || item.artist || "Artista chinês",
            date: item.dynasty || item.period || item.year || "",
            api_id: `shanghai_${item.id || Date.now()}_${Math.random()}`,
            source: "shanghai_museum",
            ala_id: ala
          });
          
          await new Promise(r => setTimeout(r, 150));
        }
      }
      
    } catch (error) {
      console.log(`[Shanghai] Erro: ${error.message}`);
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  return resultados;
}

async function buscarShanghaiPorAla(ala, maxN = 10) {
  const termos = TERMOS_SHANGHAI[ala] || ["chinese art", "painting"];
  const todosResultados = [];
  
  for (const termo of termos.slice(0, 2)) {
    if (todosResultados.length >= maxN) break;
    const resultados = await buscarShanghaiMuseum(termo, maxN - todosResultados.length, ala);
    todosResultados.push(...resultados);
    await new Promise(r => setTimeout(r, 300));
  }
  
  return todosResultados;
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

  const { fromYear, toYear } = options;
  if (fromYear || toYear) {
    return all.filter(art => {
      const year = parseInt(art.date);
      if (isNaN(year)) return true;
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
  buscarShanghaiMuseum,
  buscarShanghaiPorAla,
  TERMOS_SHANGHAI
};

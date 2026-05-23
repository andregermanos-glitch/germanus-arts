// server/semeador.js — Semeador de Obras em Massa
// Lê sementes.json → busca até 8 obras por artista no Met, AIC e Cleveland
// Corre em background, 1 artista de cada vez, com pausa entre pedidos
// Meta: ~2880 obras no banco ao longo de 24h

const fs   = require("fs");
const path = require("path");

const SEMENTES_PATH = path.join(__dirname, "sementes.json");
const MAX_POR_ARTISTA = 8;   // obras máximas por artista
const PAUSA_MS = 800;         // ms entre pedidos à API
const CICLO_H  = 12;          // re-corre a cada 12h (apanha artistas ainda sem obras)

// ─── HTTP helper ──────────────────────────────────────────────────────────────
const get = async (url, headers = {}) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000), headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Normalizar texto para comparação ─────────────────────────────────────────
function norm(s) {
  return (s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function artistaCorresponde(esperado, encontrado) {
  const palavras = norm(esperado).split(" ").filter(w => w.length > 3);
  const n = norm(encontrado);
  return palavras.some(p => n.includes(p));
}

// ─── Met Museum ───────────────────────────────────────────────────────────────
async function buscarMet(artista, maxN) {
  const resultados = [];
  try {
    const q = encodeURIComponent(`${artista} painting`);
    const s = await get(
      `https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=${q}`
    );
    const ids = (s.objectIDs || []).slice(0, maxN * 3);

    for (const id of ids) {
      if (resultados.length >= maxN) break;
      try {
        const d = await get(
          `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`
        );
        if (!d.primaryImage || !d.isPublicDomain) continue;

        // Só pinturas
        const dept  = (d.department || "").toLowerCase();
        const objnm = (d.objectName || "").toLowerCase();
        const medium = (d.medium || "").toLowerCase();
        if (dept.includes("arms") || dept.includes("textile") ||
            dept.includes("decorative") || dept.includes("musical") ||
            objnm.includes("sculpture") || objnm.includes("print") ||
            objnm.includes("drawing") || objnm.includes("vessel") ||
            (medium.includes("bronze") && !medium.includes("oil"))) continue;

        // Validar artista
        if (!artistaCorresponde(artista, d.artistDisplayName || "")) continue;

        resultados.push({
          imageUrl: d.primaryImageSmall || d.primaryImage,
          museum:   `${d.repository || "The Metropolitan Museum of Art"}, Nova York, EUA`,
          title:    d.title || "",
          artist:   d.artistDisplayName || artista,
          date:     d.objectDate || "",
          api_id:   `met_${id}`,
          met_id:   id,
        });
        await sleep(150);
      } catch {}
    }
  } catch (e) {
    console.log(`    [Met] ${artista}: ${e.message}`);
  }
  return resultados;
}

// ─── Art Institute of Chicago ──────────────────────────────────────────────────
async function buscarAIC(artista, maxN) {
  const resultados = [];
  try {
    const q = encodeURIComponent(artista);
    const d = await get(
      `https://api.artic.edu/api/v1/artworks/search?q=${q}` +
      `&fields=id,title,artist_display,date_display,image_id,is_public_domain,artwork_type_title&limit=${maxN * 2}`
    );
    const TIPOS_OK = new Set(["Painting","Oil painting","Watercolor","Tempera","Paintings","Mixed Media"]);

    for (const obj of (d.data || [])) {
      if (resultados.length >= maxN) break;
      if (!obj.image_id || !obj.is_public_domain) continue;
      const tipo = obj.artwork_type_title || "";
      if (tipo && !TIPOS_OK.has(tipo) && !tipo.toLowerCase().includes("paint")) continue;
      if (!artistaCorresponde(artista, obj.artist_display || "")) continue;

      resultados.push({
        imageUrl: `https://www.artic.edu/iiif/2/${obj.image_id}/full/400,/0/default.jpg`,
        museum:   "Art Institute of Chicago, Chicago, EUA",
        title:    obj.title || "",
        artist:   obj.artist_display || artista,
        date:     obj.date_display || "",
        api_id:   `aic_${obj.id}`,
        aic_id:   obj.id,
      });
    }
  } catch (e) {
    console.log(`    [AIC] ${artista}: ${e.message}`);
  }
  return resultados;
}

// ─── Cleveland Museum of Art ───────────────────────────────────────────────────
async function buscarCleveland(artista, maxN) {
  const resultados = [];
  try {
    const q = encodeURIComponent(artista);
    const d = await get(
      `https://openaccess-api.clevelandart.org/api/artworks/?q=${q}&has_image=1&type=painting&limit=${maxN * 2}`
    );
    for (const obj of (d.data || [])) {
      if (resultados.length >= maxN) break;
      if (!obj.images?.web?.url) continue;
      const criador = (obj.creators || []).map(c => c.description).join(" ");
      if (!artistaCorresponde(artista, criador)) continue;

      resultados.push({
        imageUrl: obj.images.web.url,
        museum:   "Cleveland Museum of Art, Cleveland, EUA",
        title:    obj.title || "",
        artist:   criador || artista,
        date:     obj.creation_date || "",
        api_id:   `cle_${obj.id}`,
      });
    }
  } catch (e) {
    console.log(`    [Cle] ${artista}: ${e.message}`);
  }
  return resultados;
}

// ─── Gravar obra no banco ──────────────────────────────────────────────────────
async function gravar(pool, obra, ala) {
  const { imageUrl, museum, title, artist, date, api_id } = obra;
  if (!imageUrl || !title || !artist) return false;
  if (artist.toLowerCase() === "desconhecido" || artist.toLowerCase() === "unknown") return false;

  const id = `seed_${api_id.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40)}`;
  try {
    await pool.query(
      `INSERT INTO artworks
         (id, source, title, artist, date, medium, dimensions, origin,
          style, museum, description, credit, image_url, external_url, ala_id)
       VALUES ($1,'semeador',$2,$3,$4,'','','','','','','curadoria GERMANUS.Art',$5,'',$6)
       ON CONFLICT (id) DO NOTHING`,
      [id, title, artist, date, imageUrl, ala]
    );
    return true;
  } catch { return false; }
}

// ─── Verificar se artista já foi semeado ──────────────────────────────────────
async function artistaJaSemeado(pool, artista, ala) {
  try {
    const r = await pool.query(
      `SELECT COUNT(*) AS n FROM artworks
        WHERE ala_id = $1 AND source = 'semeador'
          AND artist ILIKE $2`,
      [ala, `%${artista.split(" ").slice(-1)[0]}%`]  // apelido do artista
    );
    return parseInt(r.rows[0].n, 10) >= 3;  // se já tem ≥3 obras deste artista, skip
  } catch { return false; }
}

// ─── Semear um artista ────────────────────────────────────────────────────────
async function semearArtista(pool, artista, ala) {
  const jaFeito = await artistaJaSemeado(pool, artista, ala);
  if (jaFeito) return 0;

  let ok = 0;
  const metade = Math.ceil(MAX_POR_ARTISTA / 2);

  // Met: metade das obras
  const met = await buscarMet(artista, metade);
  for (const obra of met) {
    if (await gravar(pool, obra, ala)) ok++;
    await sleep(100);
  }

  // AIC: outra metade
  const aic = await buscarAIC(artista, metade);
  for (const obra of aic) {
    if (await gravar(pool, obra, ala)) ok++;
    await sleep(100);
  }

  // Cleveland: se ainda faltam obras
  if (ok < 3) {
    const cle = await buscarCleveland(artista, 3);
    for (const obra of cle) {
      if (await gravar(pool, obra, ala)) ok++;
      await sleep(100);
    }
  }

  return ok;
}

// ─── Loop principal ───────────────────────────────────────────────────────────
async function correrCiclo(pool) {
  const sementes = JSON.parse(fs.readFileSync(SEMENTES_PATH, "utf-8"));
  let totalNovo = 0;

  // Contar obras actuais no banco
  const antes = await pool.query(
    `SELECT COUNT(*) AS n FROM artworks WHERE source IN ('curadoria','semeador','expansao')`
  );
  const nAntes = parseInt(antes.rows[0].n, 10);
  console.log(`🌱 Semeador iniciando — ${nAntes} obras no banco`);

  for (const [ala, artistas] of Object.entries(sementes)) {
    console.log(`  🎨 [${ala}] ${artistas.length} artistas`);

    for (const artista of artistas) {
      const n = await semearArtista(pool, artista, ala);
      if (n > 0) {
        totalNovo += n;
        console.log(`    ✓ ${artista}: +${n} obras`);
      }
      await sleep(PAUSA_MS);
    }
  }

  const depois = await pool.query(
    `SELECT COUNT(*) AS n FROM artworks WHERE source IN ('curadoria','semeador','expansao')`
  );
  const nDepois = parseInt(depois.rows[0].n, 10);
  console.log(`🌱 Semeador concluído — ${nDepois} obras no banco (+${nDepois - nAntes} novas)`);
}

// ─── Exportar função de arranque ──────────────────────────────────────────────
async function iniciarSemeador(pool) {
  // Primeira corrida: aguarda 30s após o servidor arrancar (deixa curadoria terminar)
  setTimeout(async () => {
    try { await correrCiclo(pool); } catch (e) {
      console.log(`🌱 Semeador erro: ${e.message}`);
    }

    // Ciclos seguintes: a cada CICLO_H horas
    setInterval(async () => {
      try { await correrCiclo(pool); } catch (e) {
        console.log(`🌱 Semeador erro: ${e.message}`);
      }
    }, CICLO_H * 3600 * 1000);

  }, 30 * 1000);

  console.log(`🌱 Semeador agendado — primeira corrida em 30s, depois a cada ${CICLO_H}h`);
}

module.exports = { iniciarSemeador };

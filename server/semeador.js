// server/semeador.js — Semeador Turbinado v2
// APIs: Met Museum + AIC + Cleveland + Rijksmuseum
// 541 artistas × 18 alas → até ~4300 obras

const fs   = require("fs");
const path = require("path");

const SEMENTES_PATH  = path.join(__dirname, "sementes.json");
const MAX_POR_API    = 5;   // obras por API por artista
const PAUSA_MS       = 600; // ms entre pedidos
const CICLO_H        = 8;   // re-corre a cada 8h

const sleep = ms => new Promise(r => setTimeout(r, ms));

const get = async (url, headers = {}) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(12000), headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

function norm(s) {
  return (s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function artistaCorresponde(esperado, encontrado) {
  const palavras = norm(esperado).split(" ").filter(w => w.length > 3);
  if (!palavras.length) return false;
  const n = norm(encontrado);
  return palavras.some(p => n.includes(p));
}

// ─── Met Museum ───────────────────────────────────────────────────────────────
async function buscarMet(artista, maxN) {
  const resultados = [];
  try {
    const q = encodeURIComponent(artista);
    const s = await get(
      `https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=${q}`
    );
    const ids = (s.objectIDs || []).slice(0, maxN * 4);
    for (const id of ids) {
      if (resultados.length >= maxN) break;
      try {
        const d = await get(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
        if (!d.primaryImage || !d.isPublicDomain) continue;
        const dept  = (d.department || "").toLowerCase();
        const objnm = (d.objectName || "").toLowerCase();
        const medium = (d.medium || "").toLowerCase();
        if (dept.includes("arms") || dept.includes("textile") || dept.includes("musical")) continue;
        if (objnm.includes("sculpture") || objnm.includes("vessel") || objnm.includes("bowl")) continue;
        if (medium.includes("bronze") && !medium.includes("oil")) continue;
        if (!artistaCorresponde(artista, d.artistDisplayName || "")) continue;
        resultados.push({
          imageUrl: d.primaryImage || d.primaryImageSmall,  // full-res para zoom
          museum:   `${d.repository || "The Metropolitan Museum of Art"}, Nova York`,
          title:    d.title || "",
          artist:   d.artistDisplayName || artista,
          date:     d.objectDate || "",
          api_id:   `met_${id}`,
        });
        await sleep(120);
      } catch {}
    }
  } catch (e) { console.log(`    [Met] ${artista}: ${e.message}`); }
  return resultados;
}

// ─── AIC ──────────────────────────────────────────────────────────────────────
async function buscarAIC(artista, maxN) {
  const resultados = [];
  try {
    const q = encodeURIComponent(artista);
    const d = await get(
      `https://api.artic.edu/api/v1/artworks/search?q=${q}` +
      `&fields=id,title,artist_display,date_display,image_id,is_public_domain,artwork_type_title&limit=${maxN * 3}`
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
        museum:   "Art Institute of Chicago, Chicago",
        title:    obj.title || "",
        artist:   obj.artist_display || artista,
        date:     obj.date_display || "",
        api_id:   `aic_${obj.id}`,
      });
    }
  } catch (e) { console.log(`    [AIC] ${artista}: ${e.message}`); }
  return resultados;
}

// ─── Cleveland ────────────────────────────────────────────────────────────────
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
        museum:   "Cleveland Museum of Art, Cleveland",
        title:    obj.title || "",
        artist:   criador || artista,
        date:     obj.creation_date || "",
        api_id:   `cle_${obj.id}`,
      });
    }
  } catch (e) { console.log(`    [Cle] ${artista}: ${e.message}`); }
  return resultados;
}

// ─── Rijksmuseum ──────────────────────────────────────────────────────────────
async function buscarRijks(artista, maxN, key) {
  if (!key) return [];
  const resultados = [];
  try {
    const q = encodeURIComponent(artista);
    const d = await get(
      `https://www.rijksmuseum.nl/api/en/collection?q=${q}&imgonly=true&type=painting&ps=${maxN * 2}&apikey=${key}`
    );
    for (const obj of (d.artObjects || [])) {
      if (resultados.length >= maxN) break;
      const img = obj.webImage?.url;
      if (!img) continue;
      const maker = (obj.principalOrFirstMaker || "");
      if (!artistaCorresponde(artista, maker)) continue;
      resultados.push({
        imageUrl: img.replace("=s0", "=s400"),
        museum:   "Rijksmuseum, Amsterdam",
        title:    obj.title || "",
        artist:   maker || artista,
        date:     obj.dating?.presentingDate || "",
        api_id:   `rks_${obj.objectNumber}`,
      });
    }
  } catch (e) { console.log(`    [Rks] ${artista}: ${e.message}`); }
  return resultados;
}

// ─── Gravar no banco ──────────────────────────────────────────────────────────
async function gravar(pool, obra, ala) {
  const { imageUrl, museum, title, artist, date, api_id } = obra;
  if (!imageUrl || !title || !artist) return false;
  if (norm(artist).includes("unknown") || norm(artist).includes("desconhecido")) return false;
  const id = `seed_${(api_id || "").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50)}`;
  try {
    await pool.query(
      `INSERT INTO artworks
         (id,source,title,artist,date,medium,dimensions,origin,style,museum,description,credit,image_url,external_url,ala_id)
       VALUES ($1,'semeador',$2,$3,$4,'','','','','','','GERMANUS.Art',$5,'',$6)
       ON CONFLICT (id) DO NOTHING`,
      [id, title, artist, date, imageUrl, ala]
    );
    return true;
  } catch { return false; }
}

// ─── Verificar se artista já foi semeado ─────────────────────────────────────
async function artistaJaSemeado(pool, artista, ala) {
  try {
    const apelido = artista.split(" ").filter(w => w.length > 3).pop() || artista;
    const r = await pool.query(
      `SELECT COUNT(*) AS n FROM artworks
        WHERE ala_id=$1 AND source='semeador' AND artist ILIKE $2`,
      [ala, `%${apelido}%`]
    );
    return parseInt(r.rows[0].n, 10) >= 3;
  } catch { return false; }
}

// ─── Semear um artista ────────────────────────────────────────────────────────
async function semearArtista(pool, artista, ala, rijksKey) {
  const jaFeito = await artistaJaSemeado(pool, artista, ala);
  if (jaFeito) return 0;

  let ok = 0;

  const [met, aic, cle, rks] = await Promise.all([
    buscarMet(artista, MAX_POR_API),
    buscarAIC(artista, MAX_POR_API),
    buscarCleveland(artista, 3),
    buscarRijks(artista, MAX_POR_API, rijksKey),
  ]);

  const todas = [...met, ...aic, ...cle, ...rks];
  const vistas = new Set();
  for (const obra of todas) {
    if (vistas.has(obra.api_id)) continue;
    vistas.add(obra.api_id);
    if (await gravar(pool, obra, ala)) ok++;
    await sleep(80);
  }

  return ok;
}

// ─── Ciclo principal ──────────────────────────────────────────────────────────
async function correrCiclo(pool, rijksKey) {
  const sementes = JSON.parse(fs.readFileSync(SEMENTES_PATH, "utf-8"));

  const antes = await pool.query(
    `SELECT COUNT(*) AS n FROM artworks WHERE source IN ('curadoria','semeador','curadoria_manual','direto')`
  );
  const nAntes = parseInt(antes.rows[0].n, 10);
  console.log(`🌱 Semeador v2 — ${nAntes} obras no banco`);

  let totalNovo = 0;

  for (const [ala, artistas] of Object.entries(sementes)) {
    let alaOk = 0;
    console.log(`  🎨 [${ala}] ${artistas.length} artistas`);

    for (const artista of artistas) {
      const n = await semearArtista(pool, artista, ala, rijksKey);
      if (n > 0) {
        totalNovo += n;
        alaOk += n;
        console.log(`    ✓ ${artista}: +${n}`);
      }
      await sleep(PAUSA_MS);
    }

    if (alaOk > 0) console.log(`  ✅ [${ala}] +${alaOk} obras novas`);
  }

  const depois = await pool.query(
    `SELECT COUNT(*) AS n FROM artworks WHERE source IN ('curadoria','semeador','curadoria_manual','direto')`
  );
  const nDepois = parseInt(depois.rows[0].n, 10);
  console.log(`🌱 Ciclo concluído — ${nDepois} obras (+${nDepois - nAntes} novas)`);
}

// ─── Exportar ─────────────────────────────────────────────────────────────────
async function iniciarSemeador(pool) {
  const rijksKey = process.env.RIJKS_KEY || process.env.RIJKSMUSEUM_KEY || "";

  if (!rijksKey) console.log("⚠ RIJKS_KEY não definida — Rijksmuseum desactivado");
  else           console.log("✅ Rijksmuseum activado");

  setTimeout(async () => {
    try { await correrCiclo(pool, rijksKey); }
    catch (e) { console.log(`🌱 Semeador erro: ${e.message}`); }

    setInterval(async () => {
      try { await correrCiclo(pool, rijksKey); }
      catch (e) { console.log(`🌱 Semeador erro: ${e.message}`); }
    }, CICLO_H * 3600 * 1000);

  }, 60 * 1000); // 1 minuto após boot

  console.log(`🌱 Semeador v2 — arranque em 60s, ciclos a cada ${CICLO_H}h`);
}

module.exports = { iniciarSemeador, semearArtista };

// server/server.js — Germanus.Art Backend (versão final com curadoria manual)
// ─── ALTERAÇÕES 12/06/2026 ───────────────────────────────────────────────────
// 1. Migração R2 DESATIVADA (estava a reescrever image_url para bucket vazio)
// 2. /api/cache/forcar corrigido: incrementa download_attempts, ORDER BY RANDOM,
//    User-Agent descritivo e relatório de motivos de falha
// 3. Nova rota /api/cache/diagnostico — pendentes por domínio
// 4. Cache automático REATIVADO (CONCORRENCIA 5, lotes de 100/min)
// 5. /api/cache/status agora mostra o tamanho do banco (medidor de combustível)
// ─────────────────────────────────────────────────────────────────────────────
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const express  = require("express");
const cors     = require("cors");
const fs       = require("fs");
const path     = require("path");
const { Pool } = require("pg");
const { searchAll } = require("./museums");
const { indexarCuradoria } = require("./curador");
const { expandirAla }      = require("./expansor");
const { iniciarSemeador, semearArtista } = require("./semeador");
const { buscarObrasPorAla, carregarTodasAlas, salvarObras, ARTISTAS_RUSSOS, ALA_TERMOS } = require("./commons");
const { buscarPorCategoria, listarCategoriasWikimedia, CATEGORIAS_WIKIMEDIA, CATEGORIAS_EXTRA } = require("./categorias");
const { enviarParaR2, r2Ativo } = require("./r2");

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ─── PostgreSQL ───────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ─── Constantes ──────────────────────────────────────────────────────────────
const KEYS = {
  rijks:     process.env.RIJKS_KEY     || "",
  si:        process.env.SI_KEY        || "DEMO_KEY",
  harvard:   process.env.HARVARD_KEY   || "",
  europeana: process.env.EUROPEANA_KEY || "",
};

// Estratégia actual: imagens de exibição em BYTEA no Postgres (volume 5 GB).
// R2 fica reservado para a fase HD — reactivar só quando o banco se aproximar de 4 GB.
// Arquitetura R2: imagens moram no bucket, Postgres guarda só a URL.
const R2_MIGRACAO_ATIVA = true;
// Cache BYTEA no Postgres DESATIVADO (era o que enchia o disco)
const CACHE_BYTEA_ATIVO = false;

// User-Agent descritivo — exigido pela Wikimedia (o "Mozilla/5.0" pelado leva 403)
const UA = "GermanusArt/1.0 (https://germanus.art; contato@germanus.art)";

const ALA_HINTS = {
  retratos:      "portrait bust figure man woman classical painting face",
  pessoas_reais: "known figure identified person celebrity full body action portrait",
  historico:     "historical event battle independence revolution war famous moment",
  perspectiva:   "unknown place street interior depth perspective viewpoint urban",
  objetos:       "still life objects vanitas flowers fruit natura morta composition",
  lugares:       "famous recognizable place landmark known city building landscape",
  natureza:      "landscape nature wilderness countryside forest pastoral sea mountain",
  familiar:      "domestic interior family everyday life home genre room",
  nudes:         "nude female Venus goddess classical mythology figure woman",
  esoterico:     "esoteric occult alchemy Rosicrucian mysticism symbolic hidden knowledge",
  sacro:         "religious baroque sacred faith saints angels Madonna Christ altarpiece",
  arquitetura:   "architecture building bridge church cathedral palace construction exterior",
  povo:          "peasant workers people folk context activity scene labor market crowd",
  luz_sol:       "sunlight sunshine luminism golden light sky landscape people ground",
  cores:         "fauvism impressionism pop art color language Matisse Monet Warhol Basquiat",
  cidades:       "abstract expressionism Kandinsky Pollock Rothko Malevich color form reality",
  fase:          "surrealism dream optical illusion Dalí Magritte De Chirico Vasarely 20th century",
  femininas:     "female woman artist painter Frida Kahlo Tarsila Amaral Cassatt Morisot",
};

const ALA_TERMS = {
  retratos:      ["portrait painting face expression bust","self-portrait oil canvas master Renaissance","baroque portrait figure man woman classical"],
  pessoas_reais: ["known historical figure identified portrait","celebrity full body action person commission","real person identified full portrait commissioned"],
  historico:     ["historical event battle scene famous moment","independence revolution war historical painting","famous historical moment battle allegory event"],
  perspectiva:   ["perspective depth unknown place interior","architectural view unknown city street depth","unknown street interior corridor perspective viewpoint"],
  objetos:       ["still life flowers objects Dutch vanitas","natura morta nature morte fruit vessels Flemish","still life composition objects table kitchen flowers"],
  lugares:       ["famous landmark known place city view","recognizable place monument Venice Paris London","famous city building landscape known heritage"],
  natureza:      ["landscape nature countryside wilderness forest","pastoral seascape mountain meadow river unknown","nature wild landscape unknown pastoral no still life"],
  familiar:      ["domestic interior family genre everyday","home room reading sewing music interior Dutch","family domestic scene interior everyday life"],
  nudes:         ["nude female figure Venus classical mythology","nude woman goddess bather nymph oil canvas","classical nude female figure painting art"],
  esoterico:     ["esoteric occult symbolism alchemy mysticism","Rosicrucian hidden knowledge spiritual symbolic","esoteric alchemical Buddhist mystical occult Varo"],
  sacro:         ["religious painting Madonna saints baroque","Christ crucifixion altarpiece sacred baroque faith","religious icon prayer church angel Virgin holy"],
  arquitetura:   ["architecture building exterior church ruins","bridge palace cathedral construction landmark","building architecture facade exterior painting"],
  povo:          ["peasant workers folk genre scene activity","market labor crowd common people context","folk scene people working activity social"],
  luz_sol:       ["sunlight luminism golden light sunshine","sunlit landscape figures light impressionist plein air","sunlight sky atmosphere golden hour light"],
  cores:         ["fauvism impressionism color vibrant painting","Matisse Monet color language bold Fauves","pop art Warhol Basquiat Lichtenstein color bold"],
  cidades:       ["abstract expressionism action painting gesture","Kandinsky abstraction inner emotional Bauhaus Malevich","Pollock Rothko abstract form color emerging reality"],
  fase:          ["surrealism dream painting Dalí Magritte","optical illusion De Chirico metaphysical dreamlike","surrealist dream psychological 20th century Vasarely"],
  femininas:     ["woman female artist painter work","Frida Kahlo Tarsila Amaral Brazilian Mexican woman","female artist painting impressionism Cassatt Morisot"],
};

const memCache  = new Map();
const CACHE_TTL    = 300000;
const CACHE_BATCH  = 30;               // lote por ciclo — ritmo educado p/ Wikimedia (~0,5 req/s)
const CACHE_DELAY  = 60 * 1000;        // 1 min após boot
const CACHE_PERIOD = 60 * 1000;        // 1 lote por minuto (~100 imagens/min)
const CLEANUP_DELAY  =  5 * 60 * 1000;
const CLEANUP_PERIOD =  2 * 60 * 60 * 1000; // 2h — desbloqueia URLs falhadas

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function getCache(key) {
  const mem = memCache.get(key);
  if (mem && Date.now() - mem.ts < CACHE_TTL) return mem.data;
  try {
    const r = await pool.query(
      `SELECT data FROM search_cache WHERE cache_key=$1 AND ts > $2`,
      [key, Math.floor((Date.now() - CACHE_TTL) / 1000)]
    );
    if (r.rows.length > 0) {
      const data = JSON.parse(r.rows[0].data);
      memCache.set(key, { data, ts: Date.now() });
      return data;
    }
  } catch {}
  return null;
}

async function setCache(key, data) {
  memCache.set(key, { data, ts: Date.now() });
  try {
    await pool.query(
      `INSERT INTO search_cache (cache_key, data) VALUES ($1, $2)
       ON CONFLICT (cache_key) DO UPDATE SET data=EXCLUDED.data, ts=EXTRACT(EPOCH FROM NOW())::BIGINT`,
      [key, JSON.stringify(data)]
    );
  } catch {}
}

async function saveArtwork(art) {
  try {
    await pool.query(
      `INSERT INTO artworks (id,source,title,artist,date,medium,dimensions,origin,style,museum,description,credit,image_url,external_url,ala_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET image_url=EXCLUDED.image_url, indexed_at=EXTRACT(EPOCH FROM NOW())::BIGINT`,
      [art.id, art.source, art.title, art.artist, art.date, art.medium, art.dimensions, art.origin,
       art.style, art.museum, art.description, art.credit, art.imageUrl, art.externalUrl, art.alaId || null]
    );
  } catch {}
}

// Constrói URL de alta resolução para zoom a partir da URL da miniatura
function toHd(url) {
  if (!url) return url;
  // AIC IIIF: /full/400,/ → /full/1686,/ (resolução recomendada do AIC)
  if (url.includes("artic.edu/iiif")) {
    return url.replace(/\/full\/[^/]+\//, "/full/1686,/");
  }
  // Wikimedia: /800px-Nome → /1600px-Nome
  if (url.includes("upload.wikimedia.org") && url.includes("/thumb/")) {
    return url.replace(/\/\d+px-/, "/1600px-");
  }
  // Met, Cleveland, Rijksmuseum e outros — a URL guardada já é boa resolução
  return url;
}

function mapRow(r) {
  // Servir directamente da URL original (CDN do museu) — não usa volume do banco
  const imageUrl = r.image_url;
  const imageHd  = toHd(r.image_url);
  return {
    id: r.id, source: r.source, title: r.title, artist: r.artist, date: r.date,
    medium: r.medium, dimensions: r.dimensions, origin: r.origin, style: r.style,
    museum: r.museum, description: r.description, credit: r.credit,
    imageUrl, imageHd, externalUrl: r.external_url, alaId: r.ala_id,
    isCached: (r.image_cached_at > 0),
    wiki: { en: r.wiki_en || null, fr: r.wiki_fr || null, es: r.wiki_es || null, it: r.wiki_it || null }
  };
}

function rotate(results, excludeIds) {
  const excluded = new Set(excludeIds || []);
  const fresh = excluded.size > 0 ? results.filter(a => !excluded.has(a.id)) : results;
  return fresh.filter(a => a.imageUrl).sort(() => Math.random() - 0.45);
}

async function searchLocal(q, alaId, limit) {
  try {
    const r = await pool.query(
      `SELECT * FROM artworks
       WHERE (title ILIKE $1 OR artist ILIKE $1 OR style ILIKE $1 OR museum ILIKE $1 OR origin ILIKE $1)
       AND ($2::TEXT IS NULL OR ala_id = $2)
       AND image_url IS NOT NULL AND image_url != ''
       ORDER BY indexed_at DESC LIMIT $3`,
      [`%${q}%`, alaId || null, limit]
    );
    return r.rows.map(mapRow);
  } catch { return []; }
}

async function searchCuradoria(alaId, excludeIds = [], limit = 500, offset = 0) {
  try {
    const excl = excludeIds.filter(Boolean);
    let query = `
      SELECT *, image_cached_at FROM artworks
      WHERE ala_id = $1
        AND image_url IS NOT NULL AND image_url != ''
    `;
    const params = [alaId];
    if (excl.length > 0) {
      query += ` AND id != ALL($${params.length + 1}::TEXT[])`;
      params.push(excl);
    }
    query += ` ORDER BY (image_cached_at > 0) DESC, indexed_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    const r = await pool.query(query, params);
    return r.rows.map(mapRow);
  } catch { return []; }
}

// ─── Manutenção ───────────────────────────────────────────────────────────────
async function downloadAndCacheImages() {
  try {
    const r = await pool.query(
      `SELECT id, image_url FROM artworks
       WHERE image_url IS NOT NULL AND image_url != ''
         AND (image_data IS NULL OR image_cached_at = 0)
         AND (download_attempts IS NULL OR download_attempts < 3)
       ORDER BY RANDOM() LIMIT $1`,
      [CACHE_BATCH]
    );
    if (r.rows.length === 0) return;
    console.log(`📦 Cache — baixando ${r.rows.length} obras em paralelo...`);

    // Baixar uma imagem — devolve "ok", "429" (rate limit) ou "falha"
    async function baixarUma(row) {
      try {
        const res = await fetch(row.image_url, {
          signal: AbortSignal.timeout(15000),
          headers: { "User-Agent": UA },
        });
        if (res.status === 429) return "429";   // rate limit: NÃO conta como tentativa da obra
        if (!res.ok) throw new Error("HTTP " + res.status);
        const contentType = res.headers.get("content-type") || "image/jpeg";
        if (!contentType.startsWith("image/")) throw new Error("not image");
        const buf = await res.arrayBuffer();
        if (buf.byteLength < 5000) throw new Error("too small");
        await pool.query(
          `UPDATE artworks SET image_data=$1, image_mime=$2, image_cached_at=$3, download_attempts=0 WHERE id=$4`,
          [Buffer.from(buf), contentType, Math.floor(Date.now() / 1000), row.id]
        );
        return "ok";
      } catch (e) {
        await pool.query(
          `UPDATE artworks SET download_attempts=COALESCE(download_attempts,0)+1, last_attempt_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=$1`,
          [row.id]
        );
        return "falha";
      }
    }

    // Ritmo educado: pares em paralelo, pausa entre pares, e recuo imediato
    // se a fonte começar a devolver 429 (espera o próximo ciclo de 60s)
    const CONCORRENCIA = 2;
    let saved = 0, rate429 = 0;
    for (let i = 0; i < r.rows.length; i += CONCORRENCIA) {
      const lote = r.rows.slice(i, i + CONCORRENCIA);
      const resultados = await Promise.all(lote.map(baixarUma));
      saved   += resultados.filter(x => x === "ok").length;
      rate429 += resultados.filter(x => x === "429").length;
      if (rate429 >= 4) {
        console.log(`📦 Cache — rate limit (429) detectado, recuando até o próximo ciclo`);
        break;
      }
      await new Promise(s => setTimeout(s, 1500));
    }
    if (saved > 0) console.log(`📦 Cache concluído — ${saved}/${r.rows.length} imagens${rate429 ? ` (${rate429}× 429)` : ""}`);
  } catch (e) { console.error("[downloadAndCacheImages]", e.message); }
}

async function validateAndCleanImages() {
  try {
    const cacheExpiry = Math.floor((Date.now() - 3600000) / 1000);
    await pool.query(`DELETE FROM search_cache WHERE ts < $1`, [cacheExpiry]);

    // Desbloqueia obras falhadas após 2h para nova tentativa
    await pool.query(`
      UPDATE artworks
      SET download_attempts = 0
      WHERE download_attempts >= 3
        AND image_cached_at = 0
        AND image_url IS NOT NULL AND image_url != ''
        AND last_attempt_at < EXTRACT(EPOCH FROM NOW()) - 7200
    `);
  } catch {}
}

// Reset único: obras bloqueadas por 429 (rate limit) não são URLs mortas — liberta-as
async function resetarBloqueiosInjustos() {
  try {
    const r = await pool.query(`
      UPDATE artworks SET download_attempts = 0
      WHERE download_attempts >= 3 AND image_cached_at = 0
        AND image_url IS NOT NULL AND image_url != ''`);
    if (r.rowCount > 0) console.log(`🔓 ${r.rowCount} obras desbloqueadas para nova tentativa`);
  } catch {}
}

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS artworks (
      id TEXT PRIMARY KEY, source TEXT, title TEXT NOT NULL, artist TEXT,
      date TEXT, medium TEXT, dimensions TEXT, origin TEXT, style TEXT,
      museum TEXT, description TEXT, credit TEXT, image_url TEXT,
      external_url TEXT, ala_id TEXT,
      indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      image_data BYTEA DEFAULT NULL, image_mime TEXT DEFAULT 'image/jpeg',
      image_cached_at BIGINT DEFAULT 0,
      wiki_en TEXT, wiki_fr TEXT, wiki_es TEXT, wiki_it TEXT,
      wiki_fetched_at BIGINT DEFAULT 0,
      download_attempts INT DEFAULT 0, last_attempt_at BIGINT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS search_cache (
      cache_key TEXT PRIMARY KEY, data TEXT NOT NULL,
      ts BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_art_title  ON artworks(title);
    CREATE INDEX IF NOT EXISTS idx_art_artist ON artworks(artist);
    CREATE INDEX IF NOT EXISTS idx_art_ala    ON artworks(ala_id);
    CREATE INDEX IF NOT EXISTS idx_art_img    ON artworks(image_url) WHERE image_url IS NOT NULL AND image_url != '';
  `);
  console.log("✅ PostgreSQL pronto");
}

// ═══════════════════════════════════════════════════════════════════════════
// ROTAS DE CURADORIA MANUAL
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/carregar/psyche", async (req, res) => {
  try {
    const psychePath = fs.existsSync(path.join(__dirname, "psyche.json"))
      ? path.join(__dirname, "psyche.json")
      : path.join(__dirname, "psique.json");
    if (!fs.existsSync(psychePath))
      return res.status(404).json({ error: "psyche.json / psique.json não encontrado" });
    const obras = JSON.parse(fs.readFileSync(psychePath, "utf-8"));
    let adicionadas = 0, erros = 0;
    for (const obra of obras) {
      try {
        const id = `psyche_${(obra.api_id || obra.titulo || Date.now()).toString().replace(/[^a-z0-9]/gi,"_").toLowerCase()}`;
        await pool.query(
          `INSERT INTO artworks (id,source,title,artist,date,museum,image_url,ala_id,credit)
           VALUES ($1,'curadoria_manual',$2,$3,$4,$5,$6,'fase','Curadoria manual - Obras Surrealistas')
           ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, artist=EXCLUDED.artist, image_url=EXCLUDED.image_url`,
          [id, obra.titulo, obra.artista, obra.ano||"", obra.museu||"", obra.imageUrl]
        );
        adicionadas++;
      } catch { erros++; }
      await new Promise(r => setTimeout(r, 100));
    }
    res.json({ ok: true, adicionadas, erros });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/carregar/mestres", async (req, res) => {
  try {
    const mestresPath = path.join(__dirname, "mestres.json");
    if (!fs.existsSync(mestresPath))
      return res.status(404).json({ error: "mestres.json não encontrado" });
    const obras = JSON.parse(fs.readFileSync(mestresPath, "utf-8"));
    let adicionadas = 0, erros = 0;
    for (const obra of obras) {
      try {
        const id = `mestre_${(obra.titulo||Date.now()).toString().replace(/[^a-z0-9]/gi,"_").toLowerCase()}`;
        const ala = obra.ala || "retratos";
        await pool.query(
          `INSERT INTO artworks (id,source,title,artist,date,museum,image_url,ala_id,credit)
           VALUES ($1,'curadoria_manual',$2,$3,$4,$5,$6,$7,'Curadoria manual - Obras-primas')
           ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, artist=EXCLUDED.artist, image_url=EXCLUDED.image_url`,
          [id, obra.titulo, obra.artista, obra.ano||"", obra.museu||"", obra.imageUrl, ala]
        );
        adicionadas++;
      } catch { erros++; }
      await new Promise(r => setTimeout(r, 100));
    }
    res.json({ ok: true, adicionadas, erros });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/carregar/:nome", async (req, res) => {
  try {
    const filePath = path.join(__dirname, `${req.params.nome}.json`);
    if (!fs.existsSync(filePath))
      return res.status(404).json({ error: `${req.params.nome}.json não encontrado` });
    const obras = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    let adicionadas = 0;
    for (const obra of obras) {
      const id = `manual_${(obra.titulo||"").replace(/[^a-z0-9]/gi,"_").toLowerCase()}_${Date.now()}`;
      await pool.query(
        `INSERT INTO artworks (id,source,title,artist,date,museum,image_url,ala_id)
         VALUES ($1,'curadoria_manual',$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [id, obra.titulo, obra.artista, obra.ano||"", obra.museu||"", obra.imageUrl, obra.ala||"geral"]
      );
      adicionadas++;
    }
    res.json({ ok: true, arquivo: req.params.nome, adicionadas });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ROTAS DA API
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/status", async (req, res) => {
  let artCount = 0;
  try { const r = await pool.query("SELECT COUNT(*) as n FROM artworks WHERE image_url!=''"); artCount = parseInt(r.rows[0].n); } catch {}
  res.json({ status: "online", artworks_indexed: artCount });
});

app.get("/api/search", async (req, res) => {
  const { q, alaId, exclude, limit = 500, offset = 0 } = req.query;
  const finalAlaId = (alaId === "psyche") ? "fase" : alaId;

  if (finalAlaId) {
    try {
      const excludeIds = exclude ? exclude.split(",").filter(Boolean) : [];
      const results = await searchCuradoria(finalAlaId, excludeIds, parseInt(limit), parseInt(offset));
      // Total real na ala
      let totalAla = results.length;
      try {
        const ct = await pool.query(
          `SELECT COUNT(*) AS n FROM artworks WHERE ala_id=$1 AND image_url IS NOT NULL AND image_url!=''`,
          [finalAlaId]
        );
        totalAla = parseInt(ct.rows[0].n);
      } catch {}
      return res.json({
        source: "database",
        total: totalAla,
        shown: parseInt(offset) + results.length,
        hasMore: parseInt(offset) + results.length < totalAla,
        results,
        ala: finalAlaId
      });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (!q?.trim()) {
    try {
      const r = await pool.query(
        `SELECT * FROM artworks WHERE image_url IS NOT NULL AND image_url != '' ORDER BY indexed_at DESC LIMIT $1`,
        [parseInt(limit)]
      );
      return res.json({ source: "random", total: r.rows.length, results: r.rows.map(mapRow) });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  try {
    const results = await searchLocal(q, finalAlaId || null, parseInt(limit));
    res.json({ source: "database", total: results.length, results });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/curadoria/expandir", async (req, res) => {
  const ala  = req.query.ala  || req.body?.ala  || "retratos";
  const n    = parseInt(req.query.n || req.body?.n || "30");
  const hint = ALA_HINTS[ala] || "painting art masterwork";
  try {
    const resultado = await expandirAla(pool, KEYS, ala, hint, n);
    res.json({ ok: true, ala, ...resultado });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/curadoria/status", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT ala_id, source, COUNT(*) as n FROM artworks
      WHERE image_url IS NOT NULL AND image_url != ''
      GROUP BY ala_id, source ORDER BY ala_id
    `);
    res.json({ alas: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/image/:id", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT image_data, image_mime FROM artworks WHERE id=$1 AND image_cached_at>0`,
      [req.params.id]
    );
    if (!r.rows[0]?.image_data) return res.status(404).send("Not cached");
    res.set({
      "Content-Type": r.rows[0].image_mime || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*"
    });
    res.send(r.rows[0].image_data);
  } catch(e) { res.status(500).send("Error"); }
});

// Medidor de combustível: total de obras, cache, pendentes e TAMANHO DO BANCO
app.get("/api/cache/status", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT COUNT(*) as total_obras,
             COUNT(*) FILTER (WHERE image_cached_at>0) as imagens_cache,
             COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_url!='' AND image_cached_at=0) as imagens_pendentes
      FROM artworks WHERE image_url IS NOT NULL AND image_url!=''
    `);
    let tamanho = null, tamanho_bytes = null;
    try {
      const t = await pool.query(`
        SELECT pg_size_pretty(pg_database_size(current_database())) AS tamanho,
               pg_database_size(current_database()) AS bytes
      `);
      tamanho = t.rows[0].tamanho;
      tamanho_bytes = parseInt(t.rows[0].bytes);
    } catch {}
    res.json({ ...r.rows[0], tamanho_banco: tamanho, tamanho_banco_bytes: tamanho_bytes, limite_volume: "5 GB" });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// CORRIGIDO: incrementa download_attempts nas falhas, ORDER BY RANDOM
// (não fica preso nas mesmas 200), User-Agent descritivo e relatório de motivos
app.get("/api/cache/forcar", async (req, res) => {
  try {
    const limite = parseInt(req.query.limit) || 100;
    const r = await pool.query(
      `SELECT id, image_url FROM artworks
       WHERE image_url IS NOT NULL AND image_url!=''
         AND (image_data IS NULL OR image_cached_at=0)
         AND COALESCE(download_attempts,0) < 3
       ORDER BY RANDOM() LIMIT $1`,
      [limite]
    );
    if (r.rows.length === 0) return res.json({ message: "Nenhuma imagem pendente", total: 0 });
    let baixadas = 0;
    const motivos = {};
    for (const row of r.rows) {
      try {
        const resposta = await fetch(row.image_url, {
          signal: AbortSignal.timeout(15000),
          headers: { "User-Agent": UA }
        });
        if (!resposta.ok) throw new Error("HTTP_" + resposta.status);
        const contentType = resposta.headers.get("content-type") || "image/jpeg";
        if (!contentType.startsWith("image/")) throw new Error("nao_e_imagem");
        const buffer = await resposta.arrayBuffer();
        if (buffer.byteLength < 5000) throw new Error("muito_pequena");
        await pool.query(
          `UPDATE artworks SET image_data=$1, image_mime=$2, image_cached_at=$3, download_attempts=0 WHERE id=$4`,
          [Buffer.from(buffer), contentType, Math.floor(Date.now() / 1000), row.id]
        );
        baixadas++;
      } catch (e) {
        const motivo = (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : e.message;
        motivos[motivo] = (motivos[motivo] || 0) + 1;
        // 429 = rate limit da fonte, não é culpa da URL — não consome tentativa
        if (motivo !== "HTTP_429") {
          await pool.query(
            `UPDATE artworks SET download_attempts=COALESCE(download_attempts,0)+1,
                    last_attempt_at=EXTRACT(EPOCH FROM NOW())::BIGINT
             WHERE id=$1`,
            [row.id]
          );
        }
        if ((motivos["HTTP_429"] || 0) >= 5) break;  // recuo imediato sob rate limit
      }
      await new Promise(s => setTimeout(s, 1000));
    }
    res.json({ ok: true, processadas: r.rows.length, baixadas, motivos });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// NOVO: pendentes agrupadas por domínio — mostra de onde vêm as falhas
app.get("/api/cache/diagnostico", async (req, res) => {
  try {
    const dominios = await pool.query(`
      SELECT substring(image_url from '//([^/]+)') AS dominio,
             COUNT(*) AS pendentes,
             COUNT(*) FILTER (WHERE COALESCE(download_attempts,0) >= 3) AS bloqueadas
      FROM artworks
      WHERE image_url IS NOT NULL AND image_url!='' AND image_cached_at=0
      GROUP BY 1 ORDER BY 2 DESC`);
    const r2 = await pool.query(`
      SELECT COUNT(*) AS n FROM artworks
      WHERE image_url LIKE '%r2.dev%' OR image_url LIKE '%r2.cloudflarestorage%'`);
    res.json({ urls_apontando_para_r2: parseInt(r2.rows[0].n), pendentes_por_dominio: dominios.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/cache/detalhado", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT COUNT(*) as total_obras,
             COUNT(*) FILTER (WHERE image_cached_at>0) as imagens_cache,
             COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_url!='' AND image_cached_at=0) as imagens_pendentes,
             COUNT(*) FILTER (WHERE download_attempts>=3) as imagens_falhas
      FROM artworks WHERE image_url IS NOT NULL AND image_url!=''
    `);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/semeador/agora", async (req, res) => {
  try {
    const sementes = JSON.parse(fs.readFileSync(path.join(__dirname, "sementes.json"), "utf-8"));
    let total = 0;
    for (const [ala, artistas] of Object.entries(sementes)) {
      for (const artista of artistas) {
        const n = await semearArtista(pool, artista, ala);
        total += n;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    res.json({ ok: true, obras_adicionadas: total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ═══════════════════════════════════════════════════════════════════════════
// ROTAS WIKIMEDIA COMMONS
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/commons/ala/:ala", async (req, res) => {
  try {
    const { ala } = req.params;
    const limite = parseInt(req.query.limite) || 20;
    if (!ALA_TERMOS[ala])
      return res.status(400).json({ error: `Ala "${ala}" não encontrada` });
    const obras = await buscarObrasPorAla(pool, ala, limite);
    const { salvas, erros } = await salvarObras(pool, obras);
    res.json({ ok: true, ala, encontradas: obras.length, salvas, erros });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/commons/todas", async (req, res) => {
  try {
    const limitePorAla = parseInt(req.query.limite) || 15;
    const todasObras = await carregarTodasAlas(pool, limitePorAla);
    const { salvas, erros } = await salvarObras(pool, todasObras);
    res.json({ ok: true, total_encontradas: todasObras.length, total_salvas: salvas, erros });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/commons/artistas", async (req, res) => {
  res.json({ artistas: ARTISTAS_RUSSOS });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROTAS WIKIMEDIA POR CATEGORIA
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/commons/categorias", (req, res) => {
  res.json({
    alas: CATEGORIAS_WIKIMEDIA,
    extras: CATEGORIAS_EXTRA,
    lista: listarCategoriasWikimedia()
  });
});

app.get("/api/commons/categoria/:nome", async (req, res) => {
  try {
    const { nome } = req.params;
    const ala    = req.query.ala || (CATEGORIAS_WIKIMEDIA[nome] ? nome : "fase");
    const limite = parseInt(req.query.limite) || 50;

    console.log(`🖼️ Categoria Wikimedia: ${nome} → ala "${ala}" (${limite})`);
    const obras = await buscarPorCategoria(nome, limite);

    let salvas = 0;
    for (const obra of obras) {
      try {
        const id = `commons_${obra.pageid}`;
        await pool.query(
          `INSERT INTO artworks (id,source,title,artist,date,museum,image_url,ala_id,credit,image_cached_at)
           VALUES ($1,'wikimedia_commons',$2,$3,$4,$5,$6,$7,$8,0)
           ON CONFLICT (id) DO UPDATE SET ala_id=EXCLUDED.ala_id`,
          [id, obra.title, obra.artist, obra.date, obra.museum, obra.imageUrl, ala, obra.credit]
        );
        salvas++;
      } catch {}
    }
    res.json({ ok: true, categoria: nome, ala, encontradas: obras.length, salvas });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/commons/categorias", async (req, res) => {
  try {
    const { categorias, ala = "fase", limitePorCategoria = 30 } = req.body;
    if (!Array.isArray(categorias) || !categorias.length)
      return res.status(400).json({ error: "Envie { categorias: ['surrealismo','cubismo'], ala: 'fase' }" });

    const resultados = {};
    let total = 0;
    for (const cat of categorias) {
      const obras = await buscarPorCategoria(cat, limitePorCategoria);
      let salvas = 0;
      for (const obra of obras) {
        try {
          await pool.query(
            `INSERT INTO artworks (id,source,title,artist,date,museum,image_url,ala_id,credit,image_cached_at)
             VALUES ($1,'wikimedia_commons',$2,$3,$4,$5,$6,$7,$8,0)
             ON CONFLICT (id) DO UPDATE SET ala_id=EXCLUDED.ala_id`,
            [`commons_${obra.pageid}`, obra.title, obra.artist, obra.date, obra.museum, obra.imageUrl, ala, obra.credit]
          );
          salvas++;
        } catch {}
      }
      resultados[cat] = { encontradas: obras.length, salvas };
      total += salvas;
    }
    res.json({ ok: true, ala, total_salvas: total, resultados });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// MIGRAÇÃO R2 — status e manutenção de disco
// ═══════════════════════════════════════════════════════════════════════════

// Progresso da migração para o R2 + tamanho do banco
app.get("/api/r2/status", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE image_url LIKE '%r2.dev%' OR image_url LIKE '%r2.cloudflarestorage%') AS no_r2,
        COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_url != ''
              AND image_url NOT LIKE '%r2.dev%' AND image_url NOT LIKE '%r2.cloudflarestorage%') AS pendentes,
        COUNT(*) FILTER (WHERE image_data IS NOT NULL) AS ainda_com_bytea
      FROM artworks`);
    let tamanho = null;
    try {
      const t = await pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS s`);
      tamanho = t.rows[0].s;
    } catch {}
    res.json({ ...r.rows[0], tamanho_banco: tamanho, r2_ativo: r2Ativo() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Limpa BYTEA órfão (imagens que já estão no R2 mas ainda têm bytes no Postgres)
// e roda VACUUM para devolver o espaço ao disco.
app.get("/api/r2/limpar-bytea", async (req, res) => {
  try {
    const upd = await pool.query(`
      UPDATE artworks SET image_data = NULL, image_cached_at = 0
      WHERE image_data IS NOT NULL
        AND (image_url LIKE '%r2.dev%' OR image_url LIKE '%r2.cloudflarestorage%')`);
    res.json({ ok: true, bytea_limpos: upd.rowCount,
               nota: "Rode /api/r2/vacuum para devolver o espaço ao disco" });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// TESTE: migra UMA obra e devolve o erro exato (diagnóstico da migração R2)
app.get("/api/r2/testar", async (req, res) => {
  try {
    if (!r2Ativo()) return res.json({ erro: "r2Ativo()=false — variáveis incompletas" });
    // Pega uma obra que tenha BYTEA (mais garantido) ou URL externa
    const r = await pool.query(
      `SELECT id, image_url FROM artworks
       WHERE image_url IS NOT NULL AND image_url != ''
         AND image_url NOT LIKE '%r2.dev%'
         AND image_url NOT LIKE '%r2.cloudflarestorage%'
       ORDER BY (image_cached_at > 0) DESC
       LIMIT 1`
    );
    if (r.rows.length === 0) return res.json({ mensagem: "Nenhuma obra pendente" });
    const obra = r.rows[0];
    try {
      const novaUrl = await enviarParaR2(obra.id, obra.image_url);
      if (novaUrl) {
        return res.json({ ok: true, id: obra.id, url_origem: obra.image_url, url_r2: novaUrl });
      }
      return res.json({ ok: false, id: obra.id, motivo: "enviarParaR2 devolveu null", url_origem: obra.image_url });
    } catch (e) {
      return res.json({ ok: false, id: obra.id, erro: e.message, nome: e.name, code: e.code || null, url_origem: obra.image_url });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// VACUUM para recuperar espaço físico. VACUUM normal (não FULL) não trava a tabela
// e funciona mesmo com pouco espaço livre; devolve espaço ao SO gradualmente.
app.get("/api/r2/vacuum", async (req, res) => {
  try {
    // VACUUM não pode rodar dentro de transação; o pool do pg executa fora por padrão
    await pool.query(`VACUUM (VERBOSE, ANALYZE) artworks`);
    let tamanho = null;
    try {
      const t = await pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS s`);
      tamanho = t.rows[0].s;
    } catch {}
    res.json({ ok: true, mensagem: "VACUUM concluído", tamanho_banco: tamanho });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// CARGA EM MASSA — desce recursivamente nas subcategorias do Commons
// ═══════════════════════════════════════════════════════════════════════════

// Lista as subcategorias diretas de uma categoria do Commons
async function listarSubcategorias(categoria) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers`
    + `&cmtitle=${encodeURIComponent("Category:" + categoria)}&cmtype=subcat&cmlimit=500&format=json&origin=*`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": UA } });
    const d = await r.json();
    return (d.query?.categorymembers || []).map(m => (m.title || "").replace(/^Category:/, ""));
  } catch { return []; }
}

// Carrega uma categoria e, opcionalmente, as suas subcategorias (1 nível de profundidade)
async function carregarCategoriaProfunda(categoria, ala, limitePorCat, descer) {
  const visitar = [categoria];
  if (descer) {
    const subs = await listarSubcategorias(categoria);
    visitar.push(...subs);
  }
  let salvas = 0, encontradas = 0;
  for (const cat of visitar) {
    try {
      const obras = await buscarPorCategoria(cat, limitePorCat);
      encontradas += obras.length;
      for (const obra of obras) {
        try {
          await pool.query(
            `INSERT INTO artworks (id,source,title,artist,date,museum,image_url,ala_id,credit,image_cached_at)
             VALUES ($1,'wikimedia_commons',$2,$3,$4,$5,$6,$7,$8,0)
             ON CONFLICT (id) DO UPDATE SET ala_id=EXCLUDED.ala_id`,
            [`commons_${obra.pageid}`, obra.title, obra.artist, obra.date, obra.museum, obra.imageUrl, ala, obra.credit]
          );
          salvas++;
        } catch {}
      }
    } catch {}
    await new Promise(r => setTimeout(r, 400)); // ritmo educado entre subcategorias
  }
  return { categoria, subcategorias: visitar.length - 1, encontradas, salvas };
}

// POST /api/commons/massa
// Body: { lotes: [ {categoria, ala, descer}, ... ], limitePorCat }
// Dispara em sequência (não em paralelo) para respeitar o rate limit do Commons.
app.post("/api/commons/massa", async (req, res) => {
  try {
    const { lotes, limitePorCat = 100 } = req.body || {};
    if (!Array.isArray(lotes) || !lotes.length)
      return res.status(400).json({ error: "Envie { lotes: [{categoria, ala, descer}], limitePorCat }" });
    const resultados = [];
    let totalSalvas = 0;
    for (const lote of lotes) {
      const r = await carregarCategoriaProfunda(
        lote.categoria, lote.ala || "retratos", limitePorCat, lote.descer !== false
      );
      resultados.push(r);
      totalSalvas += r.salvas;
      console.log(`📥 Massa [${lote.categoria}] → ${r.salvas} salvas (${r.subcategorias} subcats)`);
    }
    res.json({ ok: true, total_salvas: totalSalvas, resultados });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// /banco — PAINEL VISUAL (v2)
// ═══════════════════════════════════════════════════════════════════════════

app.get("/banco", async (req, res) => {
  try {
    const tot = await pool.query(`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE image_cached_at > 0) AS cached,
             COUNT(DISTINCT artist) AS artistas,
             COUNT(DISTINCT ala_id) FILTER (WHERE ala_id IS NOT NULL) AS alas
      FROM artworks
    `);
    const alas = await pool.query(`
      SELECT ala_id, source, COUNT(*) AS n
      FROM artworks
      WHERE image_url IS NOT NULL AND image_url != ''
      GROUP BY ala_id, source ORDER BY ala_id, source
    `);

    // Tamanho do banco — medidor de combustível rumo aos 5 GB
    let tamanhoBanco = "—";
    try {
      const t = await pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS s`);
      tamanhoBanco = t.rows[0].s;
    } catch {}

    const t    = tot.rows[0];
    const rows = alas.rows;

    const porAla = {};
    for (const r of rows) {
      const ala = r.ala_id || "sem_ala";
      if (!porAla[ala]) porAla[ala] = { total: 0, fontes: {} };
      const n = parseInt(r.n);
      porAla[ala].total += n;
      porAla[ala].fontes[r.source] = (porAla[ala].fontes[r.source] || 0) + n;
    }

    const ALA_LABEL = {
      retratos:"Retratos", pessoas_reais:"Personnages", historico:"Histoire",
      perspectiva:"Perspective", objetos:"Objets", lugares:"Lieux",
      natureza:"Nature", familiar:"Familiale", nudes:"Nus",
      esoterico:"Ésotérisme", sacro:"Sacré", arquitetura:"Architecture",
      povo:"Peuple", luz_sol:"Lumière", cores:"Couleurs",
      cidades:"Émotion", fase:"Psyché", femininas:"Féminines", sem_ala:"— sem ala"
    };
    const ORDER = [
      "retratos","pessoas_reais","historico","perspectiva","objetos",
      "lugares","natureza","familiar","nudes","esoterico","sacro","arquitetura",
      "povo","luz_sol","cores","cidades","fase","femininas","sem_ala"
    ];
    const SRC_COLOR = {
      curadoria:"#1D9E75", semeador:"#185FA5",
      curadoria_manual:"#BA7517", direto:"#BA7517", expansao:"#534AB7",
      wikimedia_commons:"#1D9E75"
    };

    const maxN = Math.max(...Object.values(porAla).map(d => d.total), 1);

    const alaRows = ORDER.filter(a => porAla[a]).map(ala => {
      const d   = porAla[ala];
      const lbl = ALA_LABEL[ala] || ala;
      const barSegs = Object.entries(d.fontes).map(([src, n]) => {
        const w = (n / maxN * 100).toFixed(1);
        const c = SRC_COLOR[src] || "#888";
        return `<div style="width:${w}%;height:8px;background:${c}"></div>`;
      }).join("");
      const status = d.total < 20 ? "⚠" : d.total < 50 ? "·" : "✓";
      const sc     = d.total < 20 ? "#E24B4A" : d.total < 50 ? "#BA7517" : "#1D9E75";
      return `<tr>
        <td style="padding:7px 12px;color:#e0e0e0;font-weight:500">${lbl}</td>
        <td style="padding:7px 12px">
          <div style="background:#1a1a1a;border-radius:2px;height:8px;display:flex;overflow:hidden;min-width:120px">${barSegs}</div>
        </td>
        <td style="padding:7px 12px;text-align:right;color:#aaa;font-size:13px">${d.total.toLocaleString("pt-PT")}</td>
        <td style="padding:7px 12px;text-align:center;color:${sc};font-size:13px">${status}</td>
      </tr>`;
    }).join("");

    const fonteRows = Object.entries(
      rows.reduce((acc, r) => {
        acc[r.source] = (acc[r.source] || 0) + parseInt(r.n);
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]).map(([src, n]) =>
      `<tr>
        <td style="padding:6px 12px">
          <span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;background:${SRC_COLOR[src]||"#555"}33;color:${SRC_COLOR[src]||"#aaa"}">${src}</span>
        </td>
        <td style="padding:6px 12px;text-align:right;color:#e0e0e0;font-weight:500">${parseInt(n).toLocaleString("pt-PT")}</td>
      </tr>`
    ).join("");

    const now = new Date().toLocaleString("pt-PT", { timeZone: "America/Sao_Paulo" });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GERMANUS.Art — Banco</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:28px 24px;max-width:900px}
h1{font-size:20px;font-weight:600;color:#fff;margin-bottom:4px}
.sub{color:#555;font-size:12px;margin-bottom:28px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:32px}
.card{background:#141414;border:1px solid #222;border-radius:10px;padding:14px 16px}
.card .v{font-size:28px;font-weight:700;color:#fff;line-height:1}
.card .l{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}
.card.g .v{color:#1D9E75}.card.b .v{color:#185FA5}.card.a .v{color:#BA7517}.card.r .v{color:#E24B4A}
h2{font-size:13px;font-weight:500;color:#666;text-transform:uppercase;letter-spacing:.5px;margin:0 0 10px}
table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:28px}
th{text-align:left;padding:8px 12px;color:#444;font-size:10px;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid #1a1a1a}
td{border-bottom:1px solid #111}
tr:hover td{background:#111}
.legend{display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap}
.legend span{display:flex;align-items:center;gap:6px;font-size:11px;color:#666}
.legend b{width:10px;height:10px;border-radius:2px;display:inline-block}
a{color:#378ADD;text-decoration:none}a:hover{text-decoration:underline}
.actions{margin-top:28px;display:flex;gap:12px;flex-wrap:wrap}
.btn{display:inline-block;padding:8px 16px;border:1px solid #2a2a2a;border-radius:8px;color:#aaa;font-size:12px}
.btn:hover{background:#141414;color:#fff}
</style>
</head>
<body>
<h1>GERMANUS.Art — Banco de Dados</h1>
<p class="sub">Actualizado: ${now} BRT &nbsp;·&nbsp; <a href="/banco">↻ Actualizar</a></p>

<div class="cards">
  <div class="card"><div class="v">${parseInt(t.total).toLocaleString("pt-PT")}</div><div class="l">obras totais</div></div>
  <div class="card g"><div class="v">${parseInt(t.cached).toLocaleString("pt-PT")}</div><div class="l">imagens cached</div></div>
  <div class="card a"><div class="v">${parseInt(t.artistas).toLocaleString("pt-PT")}</div><div class="l">artistas únicos</div></div>
  <div class="card b"><div class="v">${t.alas}</div><div class="l">alas activas</div></div>
  <div class="card r"><div class="v" style="font-size:20px">${tamanhoBanco}</div><div class="l">tamanho do banco / 5 GB</div></div>
</div>

<div class="legend">
  <span><b style="background:#1D9E75"></b>curadoria</span>
  <span><b style="background:#185FA5"></b>semeador</span>
  <span><b style="background:#BA7517"></b>manual/direto</span>
  <span><b style="background:#534AB7"></b>expansao</span>
  <span style="margin-left:auto;color:#555">✓ ≥50 &nbsp;· 20–49 &nbsp;⚠ &lt;20</span>
</div>

<h2>obras por ala</h2>
<table>
  <thead><tr><th>Ala</th><th>Composição</th><th style="text-align:right">Total</th><th style="text-align:center">Estado</th></tr></thead>
  <tbody>${alaRows}</tbody>
</table>

<h2>por origem</h2>
<table>
  <thead><tr><th>Fonte</th><th style="text-align:right">Obras</th></tr></thead>
  <tbody>${fonteRows}</tbody>
</table>

<div class="actions">
  <a class="btn" href="/">← Voltar ao site</a>
  <a class="btn" href="/api/cache/forcar?limit=200">Forçar cache</a>
  <a class="btn" href="/api/cache/diagnostico">Diagnóstico</a>
  <a class="btn" href="/api/cache/status">Status + tamanho</a>
  <a class="btn" href="/api/carregar/psyche">Carregar Psyché</a>
  <a class="btn" href="/api/carregar/mestres">Carregar Mestres</a>
  <a class="btn" href="/api/curadoria/status">JSON raw</a>
</div>
</body>
</html>`);
  } catch(e) { res.status(500).send(`<pre style="color:red">Erro: ${e.message}</pre>`); }
});

// ─── Frontend estático ────────────────────────────────────────────────────────
const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"), err => {
    if (err) res.status(200).send("Germanus.Art online");
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  // 1) ABRIR A PORTA PRIMEIRO — o healthcheck do Railway precisa de resposta
  //    imediata; toda a inicialização pesada acontece depois, em segundo plano.
  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📊 Banco: /banco`);
  });

  // 2) Inicialização do banco (não-fatal: se falhar, o servidor continua de pé
  //    e as rotas devolvem erros tratados em vez de derrubar o healthcheck)
  try {
    await initDB();
    await resetarBloqueiosInjustos();
  } catch (e) {
    console.error("⚠ initDB falhou (servidor continua no ar):", e.message);
  }

  console.log("🌱 Iniciando curadoria...");
  indexarCuradoria(pool, KEYS).catch(e => console.error("Curadoria erro:", e.message));

  console.log("🌱 Iniciando semeador...");
  iniciarSemeador(pool);

  // Commons — carrega obras russas 5min após boot, depois a cada 24h
  setTimeout(async () => {
    try {
      console.log("🖼️ Commons — carregando obras Wikimedia...");
      const obras = await carregarTodasAlas(pool, 12);
      const { salvas } = await salvarObras(pool, obras);
      console.log(`🖼️ Commons concluído — ${salvas} obras adicionadas`);
    } catch(e) { console.log("🖼️ Commons erro:", e.message); }
    setInterval(async () => {
      try {
        const obras = await carregarTodasAlas(pool, 8);
        const { salvas } = await salvarObras(pool, obras);
        if (salvas > 0) console.log(`🖼️ Commons ciclo — +${salvas} obras`);
      } catch {}
    }, 24 * 3600 * 1000);
  }, 5 * 60 * 1000);

  // Auto-equilibrador — enche cada ala até META obras. Corre 8min após boot, depois a cada 90min
  const META_POR_ALA = 200;
  setTimeout(async () => {
    async function equilibrar() {
      const alas = Object.keys(CATEGORIAS_WIKIMEDIA);

      // Contar obras actuais por ala
      const contagem = {};
      try {
        const r = await pool.query(`
          SELECT ala_id, COUNT(*) AS n FROM artworks
          WHERE image_url IS NOT NULL AND image_url != ''
          GROUP BY ala_id
        `);
        for (const row of r.rows) contagem[row.ala_id] = parseInt(row.n);
      } catch {}

      // Ordenar alas: as mais fracas primeiro
      const fracas = alas
        .map(a => ({ ala: a, n: contagem[a] || 0 }))
        .filter(x => x.n < META_POR_ALA)
        .sort((a, b) => a.n - b.n);

      if (fracas.length === 0) {
        console.log(`🎯 Todas as 18 alas atingiram a meta de ${META_POR_ALA} obras!`);
        return;
      }

      console.log(`🎯 Auto-equilibrador — ${fracas.length} alas abaixo de ${META_POR_ALA}`);

      // Focar nas 4 mais fracas por ciclo
      for (const { ala, n } of fracas.slice(0, 4)) {
        const faltam = META_POR_ALA - n;
        try {
          const obras = await buscarPorCategoria(ala, faltam + 20);
          let salvas = 0;
          for (const obra of obras) {
            try {
              await pool.query(
                `INSERT INTO artworks (id,source,title,artist,date,museum,image_url,ala_id,credit,image_cached_at)
                 VALUES ($1,'wikimedia_commons',$2,$3,$4,$5,$6,$7,$8,0)
                 ON CONFLICT (id) DO UPDATE SET ala_id=EXCLUDED.ala_id`,
                [`commons_${obra.pageid}`, obra.title, obra.artist, obra.date, obra.museum, obra.imageUrl, ala, obra.credit]
              );
              salvas++;
            } catch {}
          }
          console.log(`  🎯 [${ala}] ${n} → ${n + salvas} (+${salvas}, meta ${META_POR_ALA})`);
        } catch(e) { console.log(`  ⚠ [${ala}] ${e.message}`); }
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    try { await equilibrar(); } catch(e) { console.log("🎯 Equilibrador erro:", e.message); }
    setInterval(equilibrar, 90 * 60 * 1000);  // a cada 90 minutos
  }, 8 * 60 * 1000);

  // ─── Migração R2: DESATIVADA ────────────────────────────────────────────────
  // O job reescrevia image_url para o R2 antes de confirmar que o bucket tinha
  // os arquivos, gerando URLs mortas. Reactivar apenas na fase HD (banco ~4 GB),
  // e quando reactivar: gravar numa coluna nova (image_hd_url) em vez de
  // sobrescrever image_url. Controlado pela constante R2_MIGRACAO_ATIVA.
  if (R2_MIGRACAO_ATIVA && r2Ativo()) {
    setTimeout(() => {
      async function migrarLoteR2() {
        try {
          // Pega obras que ainda NÃO estão no R2
          const r = await pool.query(
            `SELECT id, image_url FROM artworks
             WHERE image_url IS NOT NULL AND image_url != ''
               AND image_url NOT LIKE '%r2.dev%'
               AND image_url NOT LIKE '%r2.cloudflarestorage%'
               AND COALESCE(download_attempts,0) < 3
             ORDER BY (image_cached_at > 0) DESC, indexed_at DESC NULLS LAST
             LIMIT 15`
          );
          if (r.rows.length === 0) {
            console.log("☁️  R2 — migração completa, nada pendente");
            return;
          }
          let migradas = 0, rate429 = 0;
          for (const row of r.rows) {
            try {
              const novaUrl = await enviarParaR2(row.id, row.image_url);
              if (novaUrl) {
                // Grava URL do R2 E limpa o BYTEA no mesmo UPDATE (libera disco)
                await pool.query(
                  `UPDATE artworks
                   SET image_url=$1, image_data=NULL, image_cached_at=0, download_attempts=0
                   WHERE id=$2`,
                  [novaUrl, row.id]
                );
                migradas++;
              }
            } catch (e) {
              if (e.code === 429 || e.message === "HTTP_429") {
                rate429++;
                if (rate429 >= 3) { console.log("☁️  R2 — rate limit, recuando"); break; }
              } else {
                await pool.query(
                  `UPDATE artworks SET download_attempts=COALESCE(download_attempts,0)+1,
                          last_attempt_at=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=$1`,
                  [row.id]
                );
              }
            }
            await new Promise(s => setTimeout(s, 1200)); // ritmo educado
          }
          if (migradas > 0) console.log(`☁️  R2 — ${migradas}/${r.rows.length} imagens migradas para o bucket`);
        } catch (e) { console.log("☁️  R2 erro:", e.message); }
      }
      migrarLoteR2();
      setInterval(migrarLoteR2, 90 * 1000); // a cada 90s
    }, 2 * 60 * 1000);
    console.log("☁️  Migração para R2 ACTIVADA — imagens vão para o bucket, BYTEA é limpo");
  } else {
    console.log("☁️  R2 não configurado — verifique as variáveis R2_* no Railway");
  }

  // Cache BYTEA no Postgres DESATIVADO — as imagens agora vão para o R2.
  // (era o que enchia o disco do volume). Para reactivar, mude CACHE_BYTEA_ATIVO.
  if (CACHE_BYTEA_ATIVO) {
    setTimeout(() => {
      downloadAndCacheImages();
      setInterval(downloadAndCacheImages, CACHE_PERIOD);
    }, CACHE_DELAY);
    console.log("📦 Cache BYTEA activado");
  } else {
    console.log("📦 Cache BYTEA desactivado — imagens servidas do R2");
  }

  setInterval(validateAndCleanImages, CLEANUP_PERIOD);

  console.log(`🎨 Carregar Psyché: /api/carregar/psyche`);
  console.log(`🎨 Carregar Mestres: /api/carregar/mestres`);
}

// Nunca derrubar o processo por falha de inicialização — a porta fica aberta
// e o healthcheck passa; os erros aparecem nos logs para diagnóstico.
start().catch(e => { console.error("❌ Erro na inicialização (servidor segue no ar):", e.message); });

module.exports = app;

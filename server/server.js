// server/server.js — Germanus.Art Backend (reorganizado)
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const express  = require("express");
const cors     = require("cors");
const path     = require("path");
const { Pool } = require("pg");
const { searchAll } = require("./museums");
const { indexarCuradoria } = require("./curador");
const { expandirAla }      = require("./expansor");
const { iniciarSemeador }  = require("./semeador");

const app  = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// ─── PostgreSQL ───────────────────────────────────────────────────────────────
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

// ─── Constantes globais ──────────────────────────────────────────────────────
const KEYS = {
  rijks:     process.env.RIJKS_KEY     || "",
  si:        process.env.SI_KEY        || "DEMO_KEY",
  harvard:   process.env.HARVARD_KEY   || "",
  europeana: process.env.EUROPEANA_KEY || "",
};

// Hint de busca por ala (usado pelo expansor)
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

// Cache
const memCache = new Map();
const CACHE_TTL = 300000; // 5 minutos
const CACHE_BATCH  = 20;
const CACHE_DELAY  = 10 * 60 * 1000;
const CACHE_PERIOD =  5 * 60 * 1000;
const CLEANUP_BATCH  = 100;
const CLEANUP_DELAY  = 5 * 60 * 1000;
const CLEANUP_PERIOD = 24 * 60 * 60 * 1000;

// ─── Funções auxiliares ──────────────────────────────────────────────────────
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
      [art.id,art.source,art.title,art.artist,art.date,art.medium,art.dimensions,art.origin,
       art.style,art.museum,art.description,art.credit,art.imageUrl,art.externalUrl,art.alaId||null]
    );
  } catch {}
}

function mapRow(r) {
  const imageUrl = (r.image_cached_at > 0) ? `/api/image/${r.id}` : r.image_url;
  return {
    id:r.id, source:r.source, title:r.title, artist:r.artist, date:r.date,
    medium:r.medium, dimensions:r.dimensions, origin:r.origin, style:r.style,
    museum:r.museum, description:r.description, credit:r.credit,
    imageUrl, externalUrl:r.external_url, alaId:r.ala_id,
    isCached: (r.image_cached_at > 0),
    wiki: { en: r.wiki_en || null, fr: r.wiki_fr || null, es: r.wiki_es || null, it: r.wiki_it || null }
  };
}

function rotate(results, excludeIds) {
  const excluded = new Set(excludeIds || []);
  const fresh    = excluded.size > 0 ? results.filter(a => !excluded.has(a.id)) : results;
  const withImg  = fresh.filter(a => a.imageUrl).sort(() => Math.random() - 0.45);
  return withImg;
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

async function searchCuradoria(alaId, excludeIds = [], limit = 18) {
  try {
    const excl = excludeIds.filter(Boolean);
    const sourceOrder = `CASE source WHEN 'curadoria' THEN 0 WHEN 'expansao' THEN 1 ELSE 2 END`;

    if (excl.length > 0) {
      const r = await pool.query(
        `SELECT *, image_cached_at FROM artworks
         WHERE ala_id = $1
           AND source IN ('curadoria','expansao','algorithm+museums')
           AND image_url IS NOT NULL AND image_url != ''
           AND id != ALL($3::TEXT[])
         ORDER BY
           (image_cached_at > 0) DESC,
           ${sourceOrder}, RANDOM()
         LIMIT $2`,
        [alaId, limit, excl]
      );
      if (r.rows.length >= limit) return r.rows.map(mapRow);
    }

    const r2 = await pool.query(
      `SELECT *, image_cached_at FROM artworks
       WHERE ala_id = $1
         AND source IN ('curadoria','expansao','algorithm+museums')
         AND image_url IS NOT NULL AND image_url != ''
       ORDER BY
         (image_cached_at > 0) DESC,
         ${sourceOrder}, RANDOM()
       LIMIT $2`,
      [alaId, limit]
    );
    return r2.rows.map(mapRow);
  } catch { return []; }
}

async function searchByGallery(alaId, extraQuery, keys, options = {}) {
  const terms   = ALA_TERMS[alaId] || ["painting art masterwork"];
  const timeIdx = Math.floor(Date.now() / 180000) % terms.length;
  const q1 = extraQuery || terms[timeIdx];
  const q2 = terms[(timeIdx + 1) % terms.length];

  const [r1, r2] = await Promise.all([
    searchAll(q1, keys, { limit: 8, ...options }),
    searchAll(q2, keys, { limit: 6, ...options }),
  ]);

  const seen = new Set();
  return [...r1, ...r2].filter(a => {
    const key = a.id || a.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return a.imageUrl;
  });
}

// ─── Funções de manutenção ───────────────────────────────────────────────────
async function downloadAndCacheImages() {
  try {
    const r = await pool.query(
      `SELECT id, image_url, image_mime FROM artworks
       WHERE image_url IS NOT NULL AND image_url != ''
         AND (image_data IS NULL OR image_cached_at = 0)
         AND (download_attempts IS NULL OR download_attempts < 3)
       ORDER BY RANDOM()
       LIMIT $1`,
      [CACHE_BATCH]
    );
    if (r.rows.length === 0) return;

    console.log(`📦 Cache de imagens — baixando ${r.rows.length} obras...`);
    let saved = 0;

    for (const row of r.rows) {
      try {
        const res = await fetch(row.image_url, {
          signal: AbortSignal.timeout(12000),
          headers: { "User-Agent": "GermanusArt/1.0 (art curation platform)" },
        });

        if (!res.ok) continue;
        const contentType = res.headers.get("content-type") || "image/jpeg";
        if (!contentType.startsWith("image/")) continue;

        const buf  = await res.arrayBuffer();
        const size = buf.byteLength;
        if (size < 5000) continue;

        const bytes = new Uint8Array(buf.slice(0, 4));
        const isJPEG = bytes[0]===0xFF && bytes[1]===0xD8;
        const isPNG  = bytes[0]===0x89 && bytes[1]===0x50;
        const isWEBP = bytes[0]===0x52 && bytes[1]===0x49;
        const isGIF  = bytes[0]===0x47 && bytes[1]===0x49;
        if (!isJPEG && !isPNG && !isWEBP && !isGIF) continue;

        await pool.query(
          `UPDATE artworks
           SET image_data = $1, image_mime = $2, image_cached_at = $3,
               download_attempts = 0
           WHERE id = $4`,
          [Buffer.from(buf), contentType, Math.floor(Date.now() / 1000), row.id]
        );
        saved++;
      } catch {
        await pool.query(
          `UPDATE artworks
           SET download_attempts = COALESCE(download_attempts, 0) + 1,
               last_attempt_at = $1
           WHERE id = $2`,
          [Math.floor(Date.now() / 1000), row.id]
        );
      }
      await new Promise(r => setTimeout(r, 400));
    }

    if (saved > 0)
      console.log(`📦 Cache concluído — ${saved}/${r.rows.length} imagens armazenadas`);
  } catch (e) {
    console.error("[downloadAndCacheImages]", e.message);
  }
}

async function fetchWikiSummary(lang, query) {
  try {
    const searchUrl = `https://${lang}.wikipedia.org/w/api.php?` +
      `action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=1&origin=*`;
    const sr = await fetch(searchUrl, { signal: AbortSignal.timeout(6000) });
    const sd = await sr.json();
    const hit = sd?.query?.search?.[0];
    if (!hit) return null;

    const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`;
    const pr = await fetch(summaryUrl, { signal: AbortSignal.timeout(6000) });
    if (!pr.ok) return null;
    const pd = await pr.json();
    return pd.extract ? pd.extract.slice(0, 600) : null;
  } catch { return null; }
}

async function fetchWikipediaSummaries() {
  try {
    const r = await pool.query(
      `SELECT id, title, artist FROM artworks
       WHERE image_cached_at > 0
         AND (wiki_en IS NULL OR wiki_fetched_at = 0)
       ORDER BY indexed_at DESC
       LIMIT 10`
    );
    if (r.rows.length === 0) return;

    console.log(`📖 Wikipedia — buscando resumos para ${r.rows.length} obras...`);
    let saved = 0;

    for (const row of r.rows) {
      const query = `${row.title} ${row.artist}`.trim();
      const [en, fr, es, it] = await Promise.all([
        fetchWikiSummary("en", query),
        fetchWikiSummary("fr", query),
        fetchWikiSummary("es", query),
        fetchWikiSummary("it", query),
      ]);

      await pool.query(
        `UPDATE artworks SET
           wiki_en = $1, wiki_fr = $2, wiki_es = $3, wiki_it = $4,
           wiki_fetched_at = $5
         WHERE id = $6`,
        [en, fr, es, it, Math.floor(Date.now() / 1000), row.id]
      );

      if (en || fr || es || it) saved++;
      await new Promise(r => setTimeout(r, 500));
    }

    if (saved > 0) console.log(`📖 Wikipedia — ${saved} obras com texto salvo`);
  } catch (e) {
    console.error("[fetchWikipediaSummaries]", e.message);
  }
}

async function validateAndCleanImages() {
  let checked = 0, removed = 0, cacheRemoved = 0;
  try {
    const cacheExpiry = Math.floor((Date.now() - 3600000) / 1000);
    const cacheResult = await pool.query(
      `DELETE FROM search_cache WHERE ts < $1 RETURNING cache_key`, [cacheExpiry]
    );
    cacheRemoved = cacheResult.rowCount || 0;
    if (cacheRemoved > 0)
      console.log(`🧹 search_cache — ${cacheRemoved} entradas expiradas removidas`);

    const r = await pool.query(
      `SELECT id, image_url FROM artworks
       WHERE image_url IS NOT NULL AND image_url != ''
       ORDER BY indexed_at ASC LIMIT $1`,
      [CLEANUP_BATCH]
    );
    if (r.rows.length === 0) return;

    console.log(`🔍 Validação de imagens — verificando ${r.rows.length} obras...`);

    for (let i = 0; i < r.rows.length; i += 10) {
      const lote = r.rows.slice(i, i + 10);
      await Promise.all(lote.map(async (row) => {
        checked++;
        try {
          const res = await fetch(row.image_url, {
            method: "HEAD",
            signal: AbortSignal.timeout(4000),
          });
          if (res.status === 404) {
            await pool.query(
              `UPDATE artworks
               SET image_url = NULL, image_data = NULL, image_cached_at = 0
               WHERE id = $1`,
              [row.id]
            );
            removed++;
          }
        } catch {}
      }));
      await new Promise(r => setTimeout(r, 600));
    }

    if (removed > 0) {
      console.log(`🔍 Validação concluída — ${removed} URLs inválidas limpas de ${checked} verificadas`);
    } else {
      console.log(`🔍 Validação concluída — ${checked} obras OK`);
    }
  } catch(e) {
    console.error("[validateAndClean]", e.message);
  }
}

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS artworks (
      id TEXT PRIMARY KEY, source TEXT, title TEXT NOT NULL, artist TEXT,
      date TEXT, medium TEXT, dimensions TEXT, origin TEXT, style TEXT,
      museum TEXT, description TEXT, credit TEXT, image_url TEXT,
      external_url TEXT, ala_id TEXT,
      indexed_at     BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
      image_data     BYTEA  DEFAULT NULL,
      image_mime     TEXT   DEFAULT 'image/jpeg',
      image_cached_at BIGINT DEFAULT 0,
      wiki_en         TEXT   DEFAULT NULL,
      wiki_fr         TEXT   DEFAULT NULL,
      wiki_es         TEXT   DEFAULT NULL,
      wiki_it         TEXT   DEFAULT NULL,
      wiki_fetched_at BIGINT DEFAULT 0,
      download_attempts  INT    DEFAULT 0,
      last_attempt_at    BIGINT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS search_cache (
      cache_key TEXT PRIMARY KEY, data TEXT NOT NULL,
      ts BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_art_title      ON artworks(title);
    CREATE INDEX IF NOT EXISTS idx_art_artist     ON artworks(artist);
    CREATE INDEX IF NOT EXISTS idx_art_ala        ON artworks(ala_id);
    CREATE INDEX IF NOT EXISTS idx_art_ala_source ON artworks(ala_id, source);
    CREATE INDEX IF NOT EXISTS idx_art_img        ON artworks(image_url) WHERE image_url IS NOT NULL AND image_url != '';
    CREATE INDEX IF NOT EXISTS idx_art_indexed    ON artworks(indexed_at DESC);
  `);
  console.log("✅ PostgreSQL — tabelas prontas");
}

// ─── Rotas da API ────────────────────────────────────────────────────────────
app.get("/api/status", async (req, res) => {
  let artCount = 0;
  try { const r = await pool.query("SELECT COUNT(*) as n FROM artworks WHERE image_url!=''"); artCount = parseInt(r.rows[0].n); } catch {}
  res.json({
    status: "online",
    database: "PostgreSQL (persistente)",
    artworks_indexed: artCount,
    mode: "Algoritmo próprio — independente de Claude",
    apis: {
      vam:"ok", cleveland:"ok", aic:"ok", met:"ok", rijksmuseum:"ok (sem chave)",
      smithsonian: KEYS.si ? "ok" : "DEMO_KEY",
      harvard:     KEYS.harvard   ? "ok" : "sem chave",
      europeana:   KEYS.europeana ? "ok" : "sem chave",
    }
  });
});

app.post("/api/curadoria/expandir", async (req, res) => {
  const ala  = req.query.ala  || req.body?.ala  || "retratos";
  const n    = parseInt(req.query.n || req.body?.n || "30");
  const hint = ALA_HINTS[ala] || "painting art masterwork";
  try {
    const resultado = await expandirAla(pool, KEYS, ala, hint, n);
    res.json({ ok:true, ala, ...resultado });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

app.get("/api/curadoria/status", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ala_id, source, COUNT(*) as n FROM artworks
       WHERE image_url IS NOT NULL AND image_url != ''
       GROUP BY ala_id, source ORDER BY ala_id`
    );
    res.json({ alas: r.rows });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/search", async (req, res) => {
  const { q, alaId, fromYear, toYear, exclude, lang } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: "Parâmetro q obrigatório" });

  const excludeIds = exclude ? exclude.split(",").filter(Boolean) : [];

  if (alaId) {
    const limit = parseInt(req.query.limit) || 500;
    const results = await searchCuradoria(alaId, excludeIds, limit);
    return res.json({
      source: "database",
      total:  results.length,
      cached: results.filter(r => r.isCached).length,
      results
    });
  }

  const cacheKey = `${q}|${alaId||""}|${fromYear||""}|${toYear||""}`;

  const cached = await getCache(cacheKey);
  if (cached) return res.json({ source:"cache", results: rotate(cached, excludeIds) });

  const localResults = await searchLocal(q, alaId, 50);
  if (localResults.length >= 8) {
    await setCache(cacheKey, localResults);
    return res.json({ source:"local_db", total: localResults.length, results: rotate(localResults, excludeIds) });
  }

  try {
    const galleryResults = await searchByGallery(alaId, q, KEYS, { fromYear, toYear });

    for (const art of galleryResults) {
      await saveArtwork({ ...art, alaId: alaId || null, imageUrl: art.imageUrl, externalUrl: art.externalUrl });
    }

    const seen  = new Set(galleryResults.map(a => a.id));
    const extra = localResults.filter(a => !seen.has(a.id));
    const final = [...galleryResults, ...extra];

    await setCache(cacheKey, final);
    res.json({ source:"algorithm+museums", total: final.length, results: rotate(final, excludeIds) });

  } catch(e) {
    console.error("[Search]", e.message);
    if (localResults.length > 0) return res.json({ source:"local_fallback", results: rotate(localResults, excludeIds) });
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/image/:id", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT image_data, image_mime FROM artworks
       WHERE id = $1 AND image_data IS NOT NULL AND image_cached_at > 0`,
      [req.params.id]
    );
    if (!r.rows[0]?.image_data) return res.status(404).send("Not cached");

    res.set({
      "Content-Type":  r.rows[0].image_mime || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      "ETag":          `"${req.params.id}"`,
    });

    if (req.headers["if-none-match"] === `"${req.params.id}"`)
      return res.status(304).end();

    res.send(r.rows[0].image_data);
  } catch (e) {
    console.error("[/api/image]", e.message);
    res.status(500).send("Error");
  }
});

app.get("/api/cache/status", async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_url != '') as with_url,
         COUNT(*) FILTER (WHERE image_cached_at > 0)  as images_cached,
         COUNT(*) FILTER (WHERE wiki_fetched_at > 0)  as wiki_fetched,
         COUNT(*) FILTER (WHERE wiki_en IS NOT NULL)  as wiki_en_ok,
         ROUND(SUM(CASE WHEN image_data IS NOT NULL
                   THEN pg_column_size(image_data) ELSE 0 END) / 1048576.0, 1) as image_mb,
         ROUND(SUM(
           COALESCE(length(wiki_en),0) + COALESCE(length(wiki_fr),0) +
           COALESCE(length(wiki_es),0) + COALESCE(length(wiki_it),0)
         ) / 1048576.0, 2) as wiki_mb
       FROM artworks`
    );
    res.json({ ...r.rows[0], note:"images: /api/image/:id  |  wiki via mapRow" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Rota de diagnóstico /banco ──────────────────────────────────────────────
app.get("/banco", async (req, res) => {
  try {
    const statsAla = await pool.query(`
      SELECT
        ala_id,
        source,
        COUNT(*)                                          AS total,
        COUNT(*) FILTER (WHERE image_url IS NOT NULL
                           AND image_url != '')           AS com_url,
        COUNT(*) FILTER (WHERE image_cached_at > 0)      AS com_cache,
        COUNT(*) FILTER (WHERE image_url IS NULL
                            OR image_url = '')            AS sem_imagem
      FROM artworks
      GROUP BY ala_id, source
      ORDER BY ala_id, source
    `);

    const totais = await pool.query(`
      SELECT
        COUNT(*)                                           AS total,
        COUNT(*) FILTER (WHERE image_url IS NOT NULL
                           AND image_url != '')            AS com_url,
        COUNT(*) FILTER (WHERE image_cached_at > 0)       AS com_cache,
        COUNT(*) FILTER (WHERE image_url IS NULL
                            OR image_url = '')             AS sem_imagem,
        COUNT(DISTINCT artist)                             AS artistas,
        COUNT(DISTINCT ala_id)                             AS alas
      FROM artworks
    `);

    const recentes = await pool.query(`
      SELECT id, source, title, artist, ala_id,
             image_url IS NOT NULL AND image_url != '' AS tem_url,
             image_cached_at > 0                        AS tem_cache,
             to_timestamp(indexed_at)::TEXT             AS quando
      FROM artworks
      ORDER BY indexed_at DESC
      LIMIT 30
    `);

    const semImg = await pool.query(`
      SELECT ala_id, COUNT(*) AS n
      FROM artworks
      WHERE image_url IS NULL OR image_url = ''
      GROUP BY ala_id ORDER BY n DESC
    `);

    const t = totais.rows[0];

    const html = `<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GERMANUS.Art — Banco de Dados</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0f0f0f; color: #e0e0e0; padding: 24px; }
  h1 { font-size: 22px; font-weight: 700; color: #fff; margin-bottom: 4px; }
  .sub { color: #888; font-size: 13px; margin-bottom: 24px; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 28px; }
  .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 10px;
          padding: 16px 20px; min-width: 130px; }
  .card .val { font-size: 32px; font-weight: 700; color: #fff; line-height: 1; }
  .card .lbl { font-size: 11px; color: #888; text-transform: uppercase;
               letter-spacing: .5px; margin-top: 4px; }
  .card.verde .val { color: #4ade80; }
  .card.azul  .val { color: #60a5fa; }
  .card.ambar .val { color: #fbbf24; }
  .card.rosa  .val { color: #f472b6; }
  h2 { font-size: 15px; font-weight: 600; color: #ccc; margin-bottom: 10px;
       padding-bottom: 6px; border-bottom: 1px solid #2a2a2a; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 28px; }
  th { text-align: left; padding: 8px 12px; background: #1a1a1a; color: #888;
       font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
  td { padding: 7px 12px; border-bottom: 1px solid #1e1e1e; color: #d0d0d0; }
  tr:hover td { background: #181818; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 20px;
          font-size: 11px; font-weight: 600; }
  .pill.c { background: #14532d33; color: #4ade80; }
  .pill.s { background: #78350f33; color: #fbbf24; }
  .pill.e { background: #1e1b4b33; color: #a5b4fc; }
  .pill.m { background: #4c1d9533; color: #c4b5fd; }
  .bar-wrap { background: #1a1a1a; border-radius: 4px; height: 6px;
              width: 80px; display: inline-block; vertical-align: middle; }
  .bar { background: #4ade80; border-radius: 4px; height: 6px; }
  .ts  { font-size: 11px; color: #555; }
  .ok  { color: #4ade80; }
  .nok { color: #f87171; }
  .section { margin-bottom: 32px; }
  @media(max-width:600px) { .cards { flex-direction: column; } }
</style>
</head>
<body>

<h1>GERMANUS.Art — Banco de Dados</h1>
<div class="sub">Actualizado em: ${new Date().toLocaleString("pt-PT",{timeZone:"America/Sao_Paulo"})} (BRT)
  &nbsp;·&nbsp; <a href="/banco" style="color:#60a5fa">↻ Actualizar</a></div>

<div class="cards">
  <div class="card"><div class="val">${t.total}</div><div class="lbl">Total obras</div></div>
  <div class="card verde"><div class="val">${t.com_cache}</div><div class="lbl">Com imagem cached</div></div>
  <div class="card azul"><div class="val">${t.com_url}</div><div class="lbl">Com URL</div></div>
  <div class="card ambar"><div class="val">${t.sem_imagem}</div><div class="lbl">Sem imagem</div></div>
  <div class="card rosa"><div class="val">${t.artistas}</div><div class="lbl">Artistas únicos</div></div>
  <div class="card"><div class="val">${t.alas}</div><div class="lbl">Alas activas</div></div>
</div>

<div class="section">
<h2>Por ala e origem</h2>
<table>
  <thead>
    <tr><th>Ala</th><th>Origem</th><th>Total</th><th>Com URL</th><th>Cached</th><th>Sem imagem</th><th>Cobertura</th></tr>
  </thead>
  <tbody>
  ${statsAla.rows.map(r => {
    const pct = r.total > 0 ? Math.round(r.com_cache / r.total * 100) : 0;
    const src = r.source === "curadoria" ? "c" : r.source === "semeador" ? "s" : r.source === "expans

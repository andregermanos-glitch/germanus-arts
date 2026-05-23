// server/server.js — Germanus.Art Backend (versão corrigida)
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

// ─── Constantes ──────────────────────────────────────────────────────────────
const KEYS = {
  rijks:     process.env.RIJKS_KEY     || "",
  si:        process.env.SI_KEY        || "DEMO_KEY",
  harvard:   process.env.HARVARD_KEY   || "",
  europeana: process.env.EUROPEANA_KEY || "",
};

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

// Cache em memória
const memCache = new Map();
const CACHE_TTL = 300000;
const CACHE_BATCH = 20;
const CACHE_DELAY = 10 * 60 * 1000;
const CACHE_PERIOD = 5 * 60 * 1000;
const CLEANUP_BATCH = 100;
const CLEANUP_DELAY = 5 * 60 * 1000;
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
      [art.id, art.source, art.title, art.artist, art.date, art.medium, art.dimensions, art.origin,
       art.style, art.museum, art.description, art.credit, art.imageUrl, art.externalUrl, art.alaId || null]
    );
  } catch {}
}

function mapRow(r) {
  const imageUrl = (r.image_cached_at > 0) ? `/api/image/${r.id}` : r.image_url;
  return {
    id: r.id, source: r.source, title: r.title, artist: r.artist, date: r.date,
    medium: r.medium, dimensions: r.dimensions, origin: r.origin, style: r.style,
    museum: r.museum, description: r.description, credit: r.credit,
    imageUrl, externalUrl: r.external_url, alaId: r.ala_id,
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
         ORDER BY (image_cached_at > 0) DESC, ${sourceOrder}, RANDOM()
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
       ORDER BY (image_cached_at > 0) DESC, ${sourceOrder}, RANDOM()
       LIMIT $2`,
      [alaId, limit]
    );
    return r2.rows.map(mapRow);
  } catch { return []; }
}

async function searchByGallery(alaId, extraQuery, keys, options = {}) {
  const terms = ALA_TERMS[alaId] || ["painting art masterwork"];
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
      `SELECT id, image_url FROM artworks
       WHERE image_url IS NOT NULL AND image_url != ''
         AND (image_data IS NULL OR image_cached_at = 0)
         AND (download_attempts IS NULL OR download_attempts < 3)
       ORDER BY RANDOM() LIMIT $1`,
      [CACHE_BATCH]
    );
    if (r.rows.length === 0) return;

    console.log(`📦 Cache de imagens — baixando ${r.rows.length} obras...`);
    let saved = 0;

    for (const row of r.rows) {
      try {
        const res = await fetch(row.image_url, {
          signal: AbortSignal.timeout(12000),
          headers: { "User-Agent": "GermanusArt/1.0" },
        });
        if (!res.ok) continue;

        const contentType = res.headers.get("content-type") || "image/jpeg";
        if (!contentType.startsWith("image/")) continue;

        const buf = await res.arrayBuffer();
        if (buf.byteLength < 5000) continue;

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
          `UPDATE artworks SET download_attempts = COALESCE(download_attempts, 0) + 1 WHERE id = $1`,
          [row.id]
        );
      }
      await new Promise(r => setTimeout(r, 400));
    }
    if (saved > 0) console.log(`📦 Cache concluído — ${saved}/${r.rows.length} imagens`);
  } catch (e) { console.error("[downloadAndCacheImages]", e.message); }
}

async function fetchWikiSummary(lang, query) {
  try {
    const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=1&origin=*`;
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
       WHERE image_cached_at > 0 AND (wiki_en IS NULL OR wiki_fetched_at = 0)
       ORDER BY indexed_at DESC LIMIT 10`
    );
    if (r.rows.length === 0) return;

    console.log(`📖 Wikipedia — buscando resumos para ${r.rows.length} obras...`);
    for (const row of r.rows) {
      const query = `${row.title} ${row.artist}`.trim();
      const [en, fr, es, it] = await Promise.all([
        fetchWikiSummary("en", query), fetchWikiSummary("fr", query),
        fetchWikiSummary("es", query), fetchWikiSummary("it", query),
      ]);
      await pool.query(
        `UPDATE artworks SET wiki_en=$1, wiki_fr=$2, wiki_es=$3, wiki_it=$4, wiki_fetched_at=$5 WHERE id=$6`,
        [en, fr, es, it, Math.floor(Date.now() / 1000), row.id]
      );
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (e) { console.error("[fetchWikipediaSummaries]", e.message); }
}

async function validateAndCleanImages() {
  try {
    const cacheExpiry = Math.floor((Date.now() - 3600000) / 1000);
    const cacheResult = await pool.query(`DELETE FROM search_cache WHERE ts < $1`, [cacheExpiry]);
    if (cacheResult.rowCount > 0) console.log(`🧹 cache: ${cacheResult.rowCount} entradas removidas`);

    const r = await pool.query(
      `SELECT id, image_url FROM artworks WHERE image_url IS NOT NULL AND image_url != ''
       ORDER BY indexed_at ASC LIMIT $1`,
      [CLEANUP_BATCH]
    );
    if (r.rows.length === 0) return;

    console.log(`🔍 Validando ${r.rows.length} imagens...`);
    let removed = 0;
    for (const row of r.rows) {
      try {
        const res = await fetch(row.image_url, { method: "HEAD", signal: AbortSignal.timeout(4000) });
        if (res.status === 404) {
          await pool.query(`UPDATE artworks SET image_url = NULL, image_data = NULL, image_cached_at = 0 WHERE id = $1`, [row.id]);
          removed++;
        }
      } catch {}
    }
    if (removed > 0) console.log(`🔍 ${removed} URLs inválidas limpas`);
  } catch(e) { console.error("[validateAndClean]", e.message); }
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
    CREATE INDEX IF NOT EXISTS idx_art_title ON artworks(title);
    CREATE INDEX IF NOT EXISTS idx_art_artist ON artworks(artist);
    CREATE INDEX IF NOT EXISTS idx_art_ala ON artworks(ala_id);
    CREATE INDEX IF NOT EXISTS idx_art_img ON artworks(image_url) WHERE image_url IS NOT NULL AND image_url != '';
  `);
  console.log("✅ PostgreSQL pronto");
}

// ─── Rotas da API ────────────────────────────────────────────────────────────
app.get("/api/status", async (req, res) => {
  let artCount = 0;
  try { const r = await pool.query("SELECT COUNT(*) as n FROM artworks WHERE image_url!=''"); artCount = parseInt(r.rows[0].n); } catch {}
  res.json({ status: "online", artworks_indexed: artCount });
});

app.post("/api/curadoria/expandir", async (req, res) => {
  const ala = req.query.ala || req.body?.ala || "retratos";
  const n = parseInt(req.query.n || req.body?.n || "30");
  const hint = ALA_HINTS[ala] || "painting art masterwork";
  try {
    const resultado = await expandirAla(pool, KEYS, ala, hint, n);
    res.json({ ok: true, ala, ...resultado });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/curadoria/status", async (req, res) => {
  try {
    const r = await pool.query(`SELECT ala_id, source, COUNT(*) as n FROM artworks WHERE image_url IS NOT NULL AND image_url != '' GROUP BY ala_id, source ORDER BY ala_id`);
    res.json({ alas: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/search", async (req, res) => {
  const { q, alaId, fromYear, toYear, exclude } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: "Parâmetro q obrigatório" });

  const excludeIds = exclude ? exclude.split(",").filter(Boolean) : [];

  if (alaId) {
    const limit = parseInt(req.query.limit) || 500;
    const results = await searchCuradoria(alaId, excludeIds, limit);
    return res.json({ source: "database", total: results.length, results });
  }

  const cacheKey = `${q}|${alaId || ""}|${fromYear || ""}|${toYear || ""}`;
  const cached = await getCache(cacheKey);
  if (cached) return res.json({ source: "cache", results: rotate(cached, excludeIds) });

  const localResults = await searchLocal(q, alaId, 50);
  if (localResults.length >= 8) {
    await setCache(cacheKey, localResults);
    return res.json({ source: "local_db", results: rotate(localResults, excludeIds) });
  }

  try {
    const galleryResults = await searchByGallery(alaId, q, KEYS, { fromYear, toYear });
    for (const art of galleryResults) await saveArtwork({ ...art, alaId: alaId || null });
    const seen = new Set(galleryResults.map(a => a.id));
    const final = [...galleryResults, ...localResults.filter(a => !seen.has(a.id))];
    await setCache(cacheKey, final);
    res.json({ source: "algorithm+museums", total: final.length, results: rotate(final, excludeIds) });
  } catch(e) {
    if (localResults.length > 0) return res.json({ source: "local_fallback", results: rotate(localResults, excludeIds) });
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/image/:id", async (req, res) => {
  try {
    const r = await pool.query(`SELECT image_data, image_mime FROM artworks WHERE id = $1 AND image_cached_at > 0`, [req.params.id]);
    if (!r.rows[0]?.image_data) return res.status(404).send("Not cached");
    res.set({ "Content-Type": r.rows[0].image_mime || "image/jpeg", "Cache-Control": "public, max-age=31536000", "ETag": `"${req.params.id}"` });
    if (req.headers["if-none-match"] === `"${req.params.id}"`) return res.status(304).end();
    res.send(r.rows[0].image_data);
  } catch (e) { res.status(500).send("Error"); }
});

app.get("/api/cache/status", async (req, res) => {
  try {
    const r = await pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE image_cached_at > 0) as images_cached FROM artworks`);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Rota de diagnóstico
app.get("/banco", async (req, res) => {
  try {
    const total = await pool.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE image_cached_at > 0) as cached FROM artworks`);
    const alas = await pool.query(`SELECT ala_id, source, COUNT(*) as n FROM artworks GROUP BY ala_id, source ORDER BY ala_id`);
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Germanus.Art - Banco</title><style>body{background:#0f0f0f;color:#e0e0e0;font-family:sans-serif;padding:20px}</style></head><body>
      <h1>GERMANUS.Art - Banco de Dados</h1>
      <p>Total: ${total.rows[0].total} obras | Cache: ${total.rows[0].cached} imagens</p>
      <h2>Por ala:</h2><ul>${alas.rows.map(r => `<li>${r.ala_id || 'sem ala'} (${r.source}): ${r.n}</li>`).join('')}</ul>
      <p><a href="/" style="color:#60a5fa">← Voltar ao site</a></p>
    </body></html>`;
    res.send(html);
  } catch(e) { res.status(500).send(e.message); }
});

// ─── Frontend estático ───────────────────────────────────────────────────────
const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"), err => {
    if (err) res.status(200).send("Germanus.Art online");
  });
});

// ─── Inicialização ───────────────────────────────────────────────────────────
async function start() {
  await initDB();
  
  // Indexa curadoria fixa
  indexarCuradoria(pool, KEYS).catch(e => console.error("Curadoria erro:", e.message));
  
  // Inicia semeador (30s após boot)
  iniciarSemeador(pool);
  
  // Jobs de manutenção
  setTimeout(() => { validateAndCleanImages(); setInterval(validateAndCleanImages, CLEANUP_PERIOD); }, CLEANUP_DELAY);
  setTimeout(() => { downloadAndCacheImages(); setInterval(downloadAndCacheImages, CACHE_PERIOD); }, CACHE_DELAY);
  setTimeout(() => { fetchWikipediaSummaries(); setInterval(fetchWikipediaSummaries, 8 * 60 * 1000); }, 15 * 60 * 1000);
  
  app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
}

start().catch(e => { console.error("❌ Fatal:", e.message); process.exit(1); });

module.exports = app;

// server/server.js — Germanus.Art Backend (sem Claude — algoritmo próprio)
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const express  = require("express");
const cors     = require("cors");
const path     = require("path");
const { Pool } = require("pg");
const { searchAll } = require("./museums");
const { indexarCuradoria } = require("./curador");
const { expandirAla }      = require("./expansor");

// Hint de busca por ala (usado pelo expansor)
const ALA_HINTS = {
  retratos:"portrait painting face",pessoas_reais:"historical figure portrait",
  cidades:"cityscape urban street painting night city Hopper Kirchner",historico:"battle historical scene",
  objetos:"still life flowers Dutch",lugares:"landmark famous place",
  natureza:"landscape nature countryside",familiar:"domestic interior family",
  nudes:"classical nude Venus figure",esoterico:"mysticism symbolism esoteric",
  sacro:"religious painting Madonna saints",arquitetura:"architecture building ruins",
  povo:"peasant workers folk genre",perspectiva:"perspective depth painting",
  luz_sol:"sunlight luminism natural light",cores:"colorful expressionism vibrant",
  fase:"surrealism dream psychology Dalí Magritte unconscious",femininas:"female woman artist painter",
};

const app  = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

// ─── PostgreSQL ───────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS artworks (
      id TEXT PRIMARY KEY, source TEXT, title TEXT NOT NULL, artist TEXT,
      date TEXT, medium TEXT, dimensions TEXT, origin TEXT, style TEXT,
      museum TEXT, description TEXT, credit TEXT, image_url TEXT,
      external_url TEXT, ala_id TEXT,
      indexed_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );
    CREATE TABLE IF NOT EXISTS search_cache (
      cache_key TEXT PRIMARY KEY, data TEXT NOT NULL,
      ts BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_art_title  ON artworks(title);
    CREATE INDEX IF NOT EXISTS idx_art_artist ON artworks(artist);
    CREATE INDEX IF NOT EXISTS idx_art_ala    ON artworks(ala_id);
  `);
  console.log("✅ PostgreSQL — tabelas prontas");
}

// ─── Chaves ───────────────────────────────────────────────────────────────────
const KEYS = {
  rijks:     process.env.RIJKS_KEY     || "",
  si:        process.env.SI_KEY        || "DEMO_KEY",
  harvard:   process.env.HARVARD_KEY   || "",
  europeana: process.env.EUROPEANA_KEY || "",
};

// ─── Cache ────────────────────────────────────────────────────────────────────
const memCache = new Map();
const CACHE_TTL = 300000; // 5 minutos

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

function mapRow(r) {
  return { id:r.id, source:r.source, title:r.title, artist:r.artist, date:r.date,
    medium:r.medium, dimensions:r.dimensions, origin:r.origin, style:r.style,
    museum:r.museum, description:r.description, credit:r.credit,
    imageUrl:r.image_url, externalUrl:r.external_url, alaId:r.ala_id };
}

// ─── Curadoria fixa — 18 obras por vez, sem repetição por 30 min ──────────────
async function searchCuradoria(alaId, excludeIds = [], limit = 18) {
  try {
    const excl = excludeIds.filter(Boolean);

    // Tenta retornar obras ainda não vistas nos últimos 30 min
    if (excl.length > 0) {
      const r = await pool.query(
        `SELECT * FROM artworks
         WHERE ala_id = $1
           AND source = 'curadoria'
           AND image_url IS NOT NULL AND image_url != ''
           AND id != ALL($3::TEXT[])
         ORDER BY RANDOM()
         LIMIT $2`,
        [alaId, limit, excl]
      );
      if (r.rows.length >= limit) return r.rows.map(mapRow);
    }

    // Esgotou ou sem exclusões — reinicia o ciclo sem filtro
    const r2 = await pool.query(
      `SELECT * FROM artworks
       WHERE ala_id = $1
         AND source = 'curadoria'
         AND image_url IS NOT NULL AND image_url != ''
       ORDER BY RANDOM()
       LIMIT $2`,
      [alaId, limit]
    );
    return r2.rows.map(mapRow);
  } catch { return []; }
}

// ─── Algoritmo de curadoria por ala ──────────────────────────────────────────
// Cada ala tem termos de busca rotacionados (usado apenas em buscas livres)
const ALA_TERMS = {
  retratos:      ["portrait painting face expression","self-portrait oil canvas master","Renaissance baroque portrait figure"],
  pessoas_reais: ["historical figure portrait identified","royal portrait king queen noble","identified person historical painting"],
  cidades:       ["cityscape urban street painting night city","city veduta canal nocturnal impressionism","urban street scene figures Hopper Kirchner Caillebotte"],
  historico:     ["battle historical scene painting","war allegory history canvas","historical event narrative painting"],
  objetos:       ["still life flowers objects Dutch","vanitas nature morte Flemish","still life fruit objects canvas"],
  lugares:       ["landmark famous place painting","monument landscape famous view","iconic location landscape art"],
  natureza:      ["landscape nature painting countryside","forest meadow river nature art","seascape nature pastoral painting"],
  familiar:      ["domestic interior family scene","everyday life home genre painting","family interior Dutch genre"],
  nudes:         ["classical nude painting Venus","goddess figure nude academic study","nude figure classical mythology"],
  esoterico:     ["mysticism symbolism painting","alchemy esoteric occult art","symbolist mystical allegory painting"],
  sacro:         ["religious painting Madonna saints","devotional sacred icon altarpiece","religious art church biblical"],
  arquitetura:   ["architecture painting building ruins","church interior cathedral art","architectural view building painting"],
  povo:          ["peasant workers folk genre painting","common people scene countryside","working class folk life painting"],
  perspectiva:   ["perspective depth landscape painting","architectural perspective vanishing","optical depth view painting"],
  luz_sol:       ["sunlight luminism natural light painting","golden hour sunshine landscape","natural light impressionism painting"],
  cores:         ["colorful expressionism vibrant painting","fauvism bold color art","chromatic color field painting"],
  fase:          ["surrealism dream unconscious painting","Dalí Magritte dream symbolic","psychological symbolist figurative painting"],
  femininas:     ["woman female artist painter work","Mary Cassatt Berthe Morisot art","female artist painting impressionism"],
};

// Busca curada sem Claude — usa termos rotacionados por ala (busca livre)
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

// ─── Rotatividade (busca livre) ───────────────────────────────────────────────
function rotate(results, excludeIds) {
  const excluded = new Set(excludeIds || []);
  const fresh    = excluded.size > 0 ? results.filter(a => !excluded.has(a.id)) : results;
  return fresh.filter(a => a.imageUrl).sort(() => Math.random() - 0.45);
}

// ─── GET /api/status ──────────────────────────────────────────────────────────
app.get("/api/status", async (req, res) => {
  let artCount = 0;
  try { const r = await pool.query("SELECT COUNT(*) as n FROM artworks WHERE image_url!=''"); artCount = parseInt(r.rows[0].n); } catch {}
  res.json({
    status: "online",
    database: "PostgreSQL (persistente)",
    artworks_indexed: artCount,
    mode: "Curadoria fixa — 18 obras por ala, sem repetição 30 min",
    apis: {
      vam:"ok", cleveland:"ok", aic:"ok", met:"ok", rijksmuseum:"ok",
      smithsonian: KEYS.si ? "ok" : "DEMO_KEY",
      harvard:     KEYS.harvard   ? "ok" : "sem chave",
      europeana:   KEYS.europeana ? "ok" : "sem chave",
    }
  });
});

// ─── POST /api/curadoria/expandir ─────────────────────────────────────────────
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

// ─── GET /api/curadoria/status ────────────────────────────────────────────────
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

// ─── GET /api/search ──────────────────────────────────────────────────────────
app.get("/api/search", async (req, res) => {
  const { q, alaId, fromYear, toYear, exclude } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: "Parâmetro q obrigatório" });

  const excludeIds = exclude ? exclude.split(",").filter(Boolean) : [];

  // ── Ala selecionada → curadoria fixa, 18 obras, sem repetição 30 min ──────
  if (alaId) {
    const results = await searchCuradoria(alaId, excludeIds, 18);
    if (results.length > 0)
      return res.json({ source:"curadoria", total:results.length, results });
    // fallback se a ala ainda não foi indexada: continua para busca livre
  }

  // ── Busca livre (texto sem ala) → pipeline completo ───────────────────────
  const cacheKey = `${q}|${alaId||""}|${fromYear||""}|${toYear||""}`;

  const cached = await getCache(cacheKey);
  if (cached) return res.json({ source:"cache", results: rotate(cached, excludeIds) });

  const localResults = await searchLocal(q, alaId, 50);
  if (localResults.length >= 8) {
    await setCache(cacheKey, localResults);
    return res.json({ source:"local_db", total:localResults.length, results: rotate(localResults, excludeIds) });
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
    res.json({ source:"algorithm+museums", total:final.length, results: rotate(final, excludeIds) });

  } catch(e) {
    console.error("[Search]", e.message);
    if (localResults.length > 0) return res.json({ source:"local_fallback", results: rotate(localResults, excludeIds) });
    res.status(500).json({ error: e.message });
  }
});

// ─── Serve frontend ───────────────────────────────────────────────────────────
const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"), err => {
    if (err) res.status(200).send("Germanus.Art online");
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
initDB().then(async () => {
  indexarCuradoria(pool, KEYS).catch(e => console.error("Curadoria erro:", e.message));
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║   GERMANUS.Art — Curadoria Fixa                  ║
║   http://localhost:${PORT}                         ║
║   Modo: 18 obras por ala · sem repetição 30 min  ║
║   Europeana: ${KEYS.europeana ? "✅ ativo" : "⚠️  sem chave"}                   ║
║   Harvard:   ${KEYS.harvard   ? "✅ ativo" : "⚠️  sem chave"}                   ║
╚══════════════════════════════════════════════════╝
    `);
  });
}).catch(e => { console.error("❌ PostgreSQL:", e.message); process.exit(1); });

module.exports = app;

// server/server.js — Germanus.Arts Backend (PostgreSQL persistente)
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const express    = require("express");
const cors       = require("cors");
const path       = require("path");
const fetch      = require("node-fetch");
const { Pool }   = require("pg");
const { searchAll } = require("./museums");

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ─── PostgreSQL ───────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS artworks (
      id           TEXT PRIMARY KEY,
      source       TEXT,
      title        TEXT NOT NULL,
      artist       TEXT,
      date         TEXT,
      medium       TEXT,
      dimensions   TEXT,
      origin       TEXT,
      style        TEXT,
      museum       TEXT,
      description  TEXT,
      credit       TEXT,
      image_url    TEXT,
      external_url TEXT,
      ala_id       TEXT,
      indexed_at   BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );
    CREATE TABLE IF NOT EXISTS search_cache (
      cache_key TEXT PRIMARY KEY,
      data      TEXT NOT NULL,
      ts        BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_art_title  ON artworks(title);
    CREATE INDEX IF NOT EXISTS idx_art_artist ON artworks(artist);
    CREATE INDEX IF NOT EXISTS idx_art_ala    ON artworks(ala_id);
  `);
  console.log("✅ PostgreSQL — tabelas prontas");
}

// ─── Cache em memória + PostgreSQL ───────────────────────────────────────────
const memCache = new Map();
const CACHE_TTL = 600000; // 10 minutos

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
      `INSERT INTO search_cache (cache_key, data)
       VALUES ($1, $2)
       ON CONFLICT (cache_key) DO UPDATE
       SET data = EXCLUDED.data, ts = EXTRACT(EPOCH FROM NOW())::BIGINT`,
      [key, JSON.stringify(data)]
    );
  } catch {}
}

async function saveArtwork(art) {
  try {
    await pool.query(
      `INSERT INTO artworks
         (id,source,title,artist,date,medium,dimensions,origin,style,museum,
          description,credit,image_url,external_url,ala_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET
         title=EXCLUDED.title, artist=EXCLUDED.artist,
         image_url=EXCLUDED.image_url,
         indexed_at=EXTRACT(EPOCH FROM NOW())::BIGINT`,
      [art.id, art.source, art.title, art.artist, art.date, art.medium,
       art.dimensions, art.origin, art.style, art.museum, art.description,
       art.credit, art.imageUrl, art.externalUrl, art.alaId || null]
    );
  } catch {}
}

async function searchLocal(q, alaId, limit) {
  try {
    const r = await pool.query(
      `SELECT * FROM artworks
       WHERE (title ILIKE $1 OR artist ILIKE $1 OR style ILIKE $1
              OR museum ILIKE $1 OR origin ILIKE $1)
       AND ($2::TEXT IS NULL OR ala_id = $2)
       ORDER BY indexed_at DESC LIMIT $3`,
      [`%${q}%`, alaId || null, limit]
    );
    return r.rows.map(mapRow);
  } catch { return []; }
}

function mapRow(r) {
  return {
    id: r.id, source: r.source, title: r.title, artist: r.artist,
    date: r.date, medium: r.medium, dimensions: r.dimensions,
    origin: r.origin, style: r.style, museum: r.museum,
    description: r.description, credit: r.credit,
    imageUrl: r.image_url, externalUrl: r.external_url, alaId: r.ala_id
  };
}

// ─── Chaves ───────────────────────────────────────────────────────────────────
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const KEYS = {
  rijks:     process.env.RIJKS_KEY     || "",
  si:        process.env.SI_KEY        || "DEMO_KEY",
  harvard:   process.env.HARVARD_KEY   || "",
  europeana: process.env.EUROPEANA_KEY || "",
};

// ─── Prompt Claude ────────────────────────────────────────────────────────────
function buildPrompt(query, ala, alaHint, fromYear, toYear, lang) {
  const alaCtx  = ala     ? `Gallery: "${ala}" — keywords: ${alaHint||ala}.` : "";
  const yearCtx = (fromYear||toYear) ? `Period: ${fromYear||"any"} to ${toYear||"present"}.` : "";

  const langMap = {
    fr: `Répondez ENTIÈREMENT en français. Titres: utilisez le titre français courant (ex: "La Joconde", "La Nuit étoilée"). Descriptions, techniques, styles et musées: en français.`,
    en: `Respond ENTIRELY in English.`,
    es: `Responda COMPLETAMENTE en español. Títulos: use el título español más conocido si existe. Descripciones, técnicas y estilos: en español.`,
    it: `Risponda COMPLETAMENTE in italiano. Titoli: usa il titolo italiano più noto se esiste. Descrizioni, tecniche e stili: in italiano.`,
  };
  const langInstruction = langMap[lang] || langMap.fr;
  return `You are a world art history expert. ${langInstruction}
${alaCtx} ${yearCtx}
Search: "${query}"
Return 8 real well-known artworks. Each object:
[{"title":"...","artist":"Full Name (Nationality, YYYY–YYYY)","date":"...","medium":"...","dimensions":"...","origin":"...","style":"...","museum":"Museum, City, Country","description":"2-3 sentences.","credit":"...","wikiTitle":"Exact English Wikipedia article title","commonsFile":"Exact_Wikimedia_Commons_filename.jpg","artic_id":"AIC uuid or empty"}]
Known commonsFile values:
Starry Night→Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg
Mona Lisa→Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg
Girl with Pearl Earring→Girl_with_a_Pearl_Earring.jpg
Birth of Venus→Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg
The Scream→Edvard_Munch,_1893,_The_Scream,_oil,_tempera_and_pastel_on_cardboard,_91_x_73_cm,_National_Gallery_of_Norway.jpg
Las Meninas→Las_Meninas,_by_Diego_Velázquez,_from_Prado_in_Google_Earth.jpg
Night Watch→The_Night_Watch_-_HD.jpg
American Gothic→Grant_DeVolson_Wood_-_American_Gothic.jpg
Guernica→Guernica.jpg
Water Lilies 1906→Claude_Monet_-_Water_Lilies_-_1906,_Ryerson.jpg
If uncertain leave commonsFile empty.`;
}

// ─── Valida se o filename parece uma obra (não retrato simples do artista) ────
function isArtworkFilename(filename) {
  if (!filename) return false;
  const f = filename.toLowerCase();
  // Rejeita se é muito curto (provavelmente nome de pessoa)
  if (f.length < 8) return false;
  // Aceita sempre — a ausência do fallback Wikipedia já resolve o problema de fotos
  return true;
}

// ─── Resolve imagem — apenas obra, nunca retrato de artista ──────────────────
async function resolveImage(o) {
  // 1. AIC IIIF (mais confiável — imagem garantida de obra)
  if (o.artic_id && o.artic_id.length > 10) {
    const url = `https://www.artic.edu/iiif/2/${o.artic_id}/full/400,/0/default.jpg`;
    try {
      const r = await fetch(url, { method:"HEAD", signal:AbortSignal.timeout(4000) });
      if (r.ok) return url;
    } catch {}
  }

  // 2. Wikimedia Special:FilePath
  if (o.commonsFile) {
    const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(o.commonsFile)}?width=400`;
    try {
      const r = await fetch(url, { method:"HEAD", signal:AbortSignal.timeout(5000) });
      const ct = r.headers.get("content-type") || "";
      if (r.ok && ct.startsWith("image/")) return r.url || url;
    } catch {}
    return url;
  }

  // SEM fallback Wikipedia — evita fotos de artistas aparecerem no lugar das obras
  return "";
}

// ─── GET /api/status ──────────────────────────────────────────────────────────
app.get("/api/status", async (req, res) => {
  let artCount = 0;
  try { const r = await pool.query("SELECT COUNT(*) as n FROM artworks"); artCount = parseInt(r.rows[0].n); } catch {}
  res.json({
    status: "online",
    database: "PostgreSQL (persistente)",
    artworks_indexed: artCount,
    anthropic: ANTHROPIC_KEY ? "✅ configurado" : "❌ sem chave — configure ANTHROPIC_API_KEY",
  });
});

// ─── GET /api/search ──────────────────────────────────────────────────────────
app.get("/api/search", async (req, res) => {
  const { q, ala, alaHint, alaId, fromYear, toYear, lang, exclude } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: "Parâmetro q obrigatório" });

  // IDs já vistos — para rotatividade
  const excludeIds = new Set(exclude ? exclude.split(",").filter(Boolean) : []);

  // Aplica exclusão e embaralha levemente para variedade
  const rotate = (results) => {
    const fresh = excludeIds.size > 0
      ? results.filter(a => !excludeIds.has(a.id))
      : results;
    // Embaralha mantendo obras com imagem no topo
    const withImg    = fresh.filter(a => a.imageUrl).sort(() => Math.random() - 0.45);
    const withoutImg = fresh.filter(a => !a.imageUrl);
    return [...withImg, ...withoutImg];
  };

  const cacheKey = `${q}|${ala||""}|${alaId||""}|${fromYear||""}|${toYear||""}`;

  // 1. Cache (aplica rotação nos resultados cacheados)
  const cached = await getCache(cacheKey);
  if (cached) return res.json({ source:"cache", results: rotate(cached) });

  // 2. Banco local (RAG lookup — sem chamar Claude)
  const localResults = await searchLocal(q, alaId, 40);
  if (localResults.length >= 6) {
    await setCache(cacheKey, localResults);
    return res.json({ source:"local_db", total: localResults.length, results: rotate(localResults) });
  }

  // 3. Claude + museus (só se banco local insuficiente)
  try {
    if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY não configurada");

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        messages: [{ role:"user", content: buildPrompt(q, ala, alaHint, fromYear, toYear, lang||"fr") }]
      })
    });

    const claudeData = await claudeRes.json();
    if (claudeData.error) throw new Error(claudeData.error.message);

    const raw   = claudeData.content?.find(b=>b.type==="text")?.text || "";
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("JSON não encontrado na resposta");

    const arr = JSON.parse(match[0]);

    // Resolve imagens + salva no PostgreSQL
    const results = await Promise.all(arr.map(async (o, i) => {
      const imageUrl = await resolveImage(o);
      const art = {
        id:          `art_${Date.now()}_${i}`,
        source:      "ai+museum",
        alaId:       alaId || null,
        title:       String(o.title||"Sem título"),
        artist:      String(o.artist||"Desconhecido"),
        date:        String(o.date||""),
        medium:      String(o.medium||""),
        dimensions:  String(o.dimensions||""),
        origin:      String(o.origin||""),
        style:       String(o.style||""),
        museum:      String(o.museum||""),
        description: String(o.description||""),
        credit:      String(o.credit||""),
        imageUrl,
        externalUrl: o.wikiTitle
          ? `https://en.wikipedia.org/wiki/${encodeURIComponent(String(o.wikiTitle).replace(/ /g,"_"))}`
          : "",
      };
      await saveArtwork(art); // ← persiste no PostgreSQL
      return art;
    }));

    // Enriquece com museus (obras adicionais com imagem garantida)
    const museumResults = await searchAll(q, KEYS, { limit:5, fromYear, toYear }).catch(()=>[]);
    const seen  = new Set(results.map(a=>a.title.toLowerCase()));
    const extra = museumResults.filter(a=>!seen.has(a.title.toLowerCase())).slice(0,5);
    for (const a of extra) await saveArtwork({ ...a, alaId: alaId||null });

    const final = [...results, ...extra];
    await setCache(cacheKey, final);

    res.json({ source:"claude+museums", total: final.length, results: rotate(final) });

  } catch(e) {
    console.error("[Search]", e.message);
    // Fallback gracioso — retorna museus direto em vez de erro 500
    try {
      const fallback = await searchAll(q, KEYS, { limit:8, fromYear, toYear });
      const combined = [...(localResults||[]), ...fallback];
      if (combined.length > 0) return res.json({ source:"fallback", results: rotate(combined) });
    } catch {}
    res.status(500).json({ error: e.message });
  }
});

// ─── Serve frontend ───────────────────────────────────────────────────────────
const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"), err => {
    if (err) res.status(200).send("Germanus.Arts online");
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════╗
║    GERMANUS.Arts — PostgreSQL Edition        ║
║    http://localhost:${PORT}                    ║
║    Anthropic: ${ANTHROPIC_KEY ? "✅ configurado" : "❌ sem chave"}           ║
║    Database:  PostgreSQL (persistente)       ║
╚══════════════════════════════════════════════╝
    `);
  });
}).catch(e => {
  console.error("❌ Erro ao conectar PostgreSQL:", e.message);
  process.exit(1);
});

module.exports = app;

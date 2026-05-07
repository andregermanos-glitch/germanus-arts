// server/server.js — Germanus.Arts Backend
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const express  = require("express");
const cors     = require("cors");
const path     = require("path");
const fetch    = require("node-fetch");
const Database = require("better-sqlite3");
const { searchAll } = require("./museums");

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ─── Banco de dados ───────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, "../germanus.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    data TEXT,
    ts   INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS artworks (
    id TEXT PRIMARY KEY, source TEXT, title TEXT, artist TEXT,
    date TEXT, medium TEXT, dimensions TEXT, origin TEXT,
    style TEXT, museum TEXT, description TEXT, credit TEXT,
    image_url TEXT, external_url TEXT, ala_id TEXT,
    indexed_at INTEGER DEFAULT (strftime('%s','now'))
  );
`);

const getCache = db.prepare("SELECT data FROM cache WHERE key=? AND ts > ?");
const setCache = db.prepare("INSERT OR REPLACE INTO cache (key,data) VALUES (?,?)");
const saveArt  = db.prepare(`
  INSERT OR REPLACE INTO artworks
    (id,source,title,artist,date,medium,dimensions,origin,style,museum,description,credit,image_url,external_url,ala_id)
  VALUES (@id,@source,@title,@artist,@date,@medium,@dimensions,@origin,@style,@museum,@description,@credit,@imageUrl,@externalUrl,@alaId)
`);

// ─── Chaves ───────────────────────────────────────────────────────────────────
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const KEYS = {
  rijks:     process.env.RIJKS_KEY     || "",
  si:        process.env.SI_KEY        || "DEMO_KEY",
  harvard:   process.env.HARVARD_KEY   || "",
  europeana: process.env.EUROPEANA_KEY || "",
};

// ─── Prompt Claude ────────────────────────────────────────────────────────────
function buildPrompt(query, ala, alaHint, fromYear, toYear) {
  const alaCtx  = ala     ? `Gallery focus: "${ala}" — keywords: ${alaHint||ala}.` : "";
  const yearCtx = (fromYear||toYear) ? `Only works from ${fromYear||"any"} to ${toYear||"present"}.` : "";
  return `You are a world art history expert. Return ONLY a raw JSON array, no markdown, no backticks.

${alaCtx} ${yearCtx}
Search: "${query}"

Return 8 real well-known artworks. Each object must have:
[{
  "title":"...", "artist":"Full Name (Nationality, YYYY–YYYY)",
  "date":"...", "medium":"...", "dimensions":"...",
  "origin":"...", "style":"...", "museum":"Museum, City, Country",
  "description":"2-3 sentences.", "credit":"...",
  "wikiTitle":"Exact English Wikipedia article title",
  "commonsFile":"Exact_Wikimedia_Commons_filename.jpg",
  "artic_id":"AIC uuid or empty"
}]

Known commonsFile values — use these exactly:
Starry Night → Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg
Mona Lisa → Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg
Girl with Pearl Earring → Girl_with_a_Pearl_Earring.jpg
Birth of Venus → Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg
The Scream → Edvard_Munch,_1893,_The_Scream,_oil,_tempera_and_pastel_on_cardboard,_91_x_73_cm,_National_Gallery_of_Norway.jpg
Las Meninas → Las_Meninas,_by_Diego_Velázquez,_from_Prado_in_Google_Earth.jpg
Night Watch → The_Night_Watch_-_HD.jpg
American Gothic → Grant_DeVolson_Wood_-_American_Gothic.jpg
Guernica → Guernica.jpg
Water Lilies 1906 → Claude_Monet_-_Water_Lilies_-_1906,_Ryerson.jpg
Impression Sunrise → Claude_Monet,_Impression,_soleil_levant.jpg
Sunflowers → Van_Gogh_-_Sunflowers.jpg
If uncertain about commonsFile, leave empty string.`;
}

// ─── Resolve imagem server-side ───────────────────────────────────────────────
async function resolveImage(o) {
  // 1. AIC IIIF (mais confiável)
  if (o.artic_id && o.artic_id.length > 10) {
    const url = `https://www.artic.edu/iiif/2/${o.artic_id}/full/400,/0/default.jpg`;
    try {
      const r = await fetch(url, { method:"HEAD", signal: AbortSignal.timeout(4000) });
      if (r.ok) return url;
    } catch {}
  }
  // 2. Wikimedia Special:FilePath (sem hash)
  if (o.commonsFile) {
    const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(o.commonsFile)}?width=400`;
    try {
      const r = await fetch(url, { method:"HEAD", signal: AbortSignal.timeout(5000) });
      if (r.ok && (r.headers.get("content-type")||"").startsWith("image/")) return url;
      // Segue redirect se necessário
      if (r.redirected) return r.url;
      return url; // tenta mesmo assim — browser vai seguir redirect
    } catch {}
  }
  // 3. Wikipedia thumbnail via API
  if (o.wikiTitle) {
    try {
      const r = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(o.wikiTitle)}&prop=pageimages&format=json&piprop=thumbnail&pithumbsize=600&origin=*`,
        { signal: AbortSignal.timeout(5000) }
      );
      const d = await r.json();
      const img = Object.values(d.query?.pages||{})[0]?.thumbnail?.source;
      if (img) return img;
    } catch {}
  }
  return "";
}

// ─── GET /api/status ──────────────────────────────────────────────────────────
app.get("/api/status", (req, res) => {
  const total = db.prepare("SELECT COUNT(*) as n FROM artworks").get()?.n || 0;
  res.json({
    status: "online",
    version: "1.0.0",
    artworks_indexed: total,
    anthropic: ANTHROPIC_KEY ? "configurado" : "SEM CHAVE — configure ANTHROPIC_API_KEY",
    apis: {
      vam:"ok", cleveland:"ok", aic:"ok", met:"ok",
      rijks:     KEYS.rijks     ? "ok" : "sem chave",
      smithsonian: "DEMO_KEY",
      harvard:   KEYS.harvard   ? "ok" : "sem chave",
      europeana: KEYS.europeana ? "ok" : "sem chave",
    }
  });
});

// ─── GET /api/search — busca principal ───────────────────────────────────────
app.get("/api/search", async (req, res) => {
  const { q, ala, alaHint, fromYear, toYear } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: "Parâmetro q obrigatório" });

  const cacheKey = `${q}|${ala||""}|${fromYear||""}|${toYear||""}`;
  const cached   = getCache.get(cacheKey, Math.floor(Date.now()/1000) - 600);
  if (cached) return res.json({ source:"cache", results: JSON.parse(cached.data) });

  try {
    // 1. Claude AI → metadados das obras
    if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY não configurada no servidor");

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":       "application/json",
        "x-api-key":          ANTHROPIC_KEY,
        "anthropic-version":  "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        messages: [{ role:"user", content: buildPrompt(q, ala, alaHint, fromYear, toYear) }]
      })
    });

    const claudeData = await claudeRes.json();
    if (claudeData.error) throw new Error(claudeData.error.message);

    const raw   = claudeData.content?.find(b=>b.type==="text")?.text || "";
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("Resposta da IA não contém JSON válido");

    const arr = JSON.parse(match[0]);

    // 2. Resolve imagens em paralelo (server-side, sem CORS)
    const results = await Promise.all(arr.map(async (o, i) => {
      const imageUrl = await resolveImage(o);
      const art = {
        id:          `art_${Date.now()}_${i}`,
        source:      "ai+museum",
        alaId:       req.query.alaId || null,
        title:       String(o.title       || "Sem título"),
        artist:      String(o.artist      || "Desconhecido"),
        date:        String(o.date        || ""),
        medium:      String(o.medium      || ""),
        dimensions:  String(o.dimensions  || ""),
        origin:      String(o.origin      || ""),
        style:       String(o.style       || ""),
        museum:      String(o.museum      || ""),
        description: String(o.description || ""),
        credit:      String(o.credit      || ""),
        imageUrl,
        externalUrl: o.wikiTitle
          ? `https://en.wikipedia.org/wiki/${encodeURIComponent(String(o.wikiTitle).replace(/ /g,"_"))}`
          : "",
      };
      // Salva no banco para acesso offline/rápido
      try { saveArt.run({ ...art, imageUrl: art.imageUrl, externalUrl: art.externalUrl, alaId: art.alaId }); } catch {}
      return art;
    }));

    // 3. Também busca nas APIs dos museus (enriquece com obras adicionais que têm imagem garantida)
    const museumResults = await searchAll(q, KEYS, { limit: 4, fromYear, toYear }).catch(()=>[]);
    const seen = new Set(results.map(a=>a.title.toLowerCase()));
    const extra = museumResults.filter(a=>!seen.has(a.title.toLowerCase())).slice(0,4);

    const final = [...results, ...extra];
    setCache.run(cacheKey, JSON.stringify(final));

    res.json({ source:"ai+museums", total: final.length, results: final });

  } catch(e) {
    console.error("[Search]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Serve frontend (produção) ────────────────────────────────────────────────
const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"), err => {
    if (err) res.status(200).send("Germanus.Arts — Backend online. Faça o build do frontend com: npm run build");
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║    GERMANUS.Arts — Online             ║
║    http://localhost:${PORT}              ║
║                                       ║
║    Anthropic: ${ANTHROPIC_KEY ? "✅ configurado  " : "❌ sem chave   "}        ║
║    GET /api/status   — diagnóstico    ║
║    GET /api/search?q=...              ║
╚═══════════════════════════════════════╝
  `);
});

module.exports = app;

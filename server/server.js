// server/server.js — Germanus.Art Backend (versão final com curadoria manual + Wikimedia Commons)
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
const { buscarObrasPorAla, carregarTodasAlas, salvarObras, ARTISTAS_RUSSOS } = require("./commons");

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
const CACHE_BATCH  = 200;
const CACHE_DELAY  = 60 * 1000;
const CACHE_PERIOD =  2 * 60 * 1000;
const CLEANUP_DELAY  =  5 * 60 * 1000;
const CLEANUP_PERIOD = 24 * 60 * 60 * 1000;

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

async function searchCuradoria(alaId, excludeIds = [], limit = 50) {
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
    query += ` ORDER BY (image_cached_at > 0) DESC, RANDOM() LIMIT $${params.length + 1}`;
    params.push(limit);
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
         AND image_url NOT LIKE '%metmuseum%'
       ORDER BY RANDOM() LIMIT $1`,
      [CACHE_BATCH]
    );
    if (r.rows.length === 0) return;
    console.log(`📦 Cache de imagens — baixando ${r.rows.length} obras...`);
    let saved = 0;
    for (const row of r.rows) {
      try {
        const res = await fetch(row.image_url, {
          signal: AbortSignal.timeout(15000),
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        });
        if (!res.ok) continue;
        const contentType = res.headers.get("content-type") || "image/jpeg";
        if (!contentType.startsWith("image/")) continue;
        const buf = await res.arrayBuffer();
        if (buf.byteLength < 5000) continue;
        await pool.query(
          `UPDATE artworks SET image_data=$1, image_mime=$2, image_cached_at=$3, download_attempts=0 WHERE id=$4`,
          [Buffer.from(buf), contentType, Math.floor(Date.now() / 1000), row.id]
        );
        saved++;
      } catch {
        await pool.query(
          `UPDATE artworks SET download_attempts=COALESCE(download_attempts,0)+1 WHERE id=$1`,
          [row.id]
        );
      }
      await new Promise(r => setTimeout(r, 500));
    }
    if (saved > 0) console.log(`📦 Cache concluído — ${saved}/${r.rows.length} imagens`);
  } catch (e) { console.error("[downloadAndCacheImages]", e.message); }
}

async function validateAndCleanImages() {
  try {
    const cacheExpiry = Math.floor((Date.now() - 3600000) / 1000);
    await pool.query(`DELETE FROM search_cache WHERE ts < $1`, [cacheExpiry]);

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
    const psychePath = path.join(__dirname, "psyche.json");
    if (!fs.existsSync(psychePath))
      return res.status(404).json({ error: "psyche.json não encontrado" });
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
// ROTAS DO WIKIMEDIA COMMONS (DOMÍNIO PÚBLICO)
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/commons/ala/:ala", async (req, res) => {
  try {
    const { ala } = req.params;
    const limite = parseInt(req.query.limite) || 20;
    
    const { ALA_TERMOS } = require("./commons");
    if (!ALA_TERMOS[ala]) {
      return res.status(400).json({ error: `Ala "${ala}" não encontrada. Alas: ${Object.keys(ALA_TERMOS).join(", ")}` });
    }
    
    console.log(`🖼️ Baixando obras russas para ala "${ala}"...`);
    const obras = await buscarObrasPorAla(pool, ala, limite);
    const { salvas, erros } = await salvarObras(pool, obras);
    
    res.json({ ok: true, ala, encontradas: obras.length, salvas, erros });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/commons/todas", async (req, res) => {
  try {
    const limitePorAla = parseInt(req.query.limite) || 15;
    console.log(`🖼️ Baixando obras russas para TODAS as alas...`);
    const todasObras = await carregarTodasAlas(pool, limitePorAla);
    const { salvas, erros } = await salvarObras(pool, todasObras);
    res.json({ ok: true, total_encontradas: todasObras.length, total_salvas: salvas, erros });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/commons/artista/:nome", async (req, res) => {
  try {
    const nome = decodeURIComponent(req.params.nome);
    const limite = parseInt(req.query.limite) || 30;
    
    console.log(`🖼️ Buscando obras de ${nome}...`);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(nome)} painting&gsrnamespace=6&gsrlimit=${limite}&prop=imageinfo&iiprop=url&format=json&origin=*`;
    const response = await fetch(url);
    const data = await response.json();
    
    const obras = [];
    if (data.query && data.query.pages) {
      for (const page of Object.values(data.query.pages)) {
        if (page.imageinfo && page.imageinfo[0]) {
          obras.push({
            id: `commons_${nome.replace(/\s/g, '_')}_${page.pageid}`,
            source: "wikimedia_commons",
            title: page.title.replace(/^File:/, '').replace(/\.(jpg|jpeg|png|gif|tiff)$/i, ''),
            artist: nome,
            date: "",
            museum: "Wikimedia Commons - Domínio Público",
            image_url: page.imageinfo[0].url,
            ala_id: "geral"
          });
        }
      }
    }
    const { salvas, erros } = await salvarObras(pool, obras);
    res.json({ ok: true, artista: nome, encontradas: obras.length, salvas, erros });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/commons/artistas", async (req, res) => {
  res.json({ artistas_russos: ARTISTAS_RUSSOS });
});

app.get("/api/commons/status", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT source, COUNT(*) as total,
             COUNT(*) FILTER (WHERE image_cached_at > 0) as cached
      FROM artworks WHERE source = 'wikimedia_commons' GROUP BY source
      UNION ALL
      SELECT ala_id as source, COUNT(*), COUNT(*) FILTER (WHERE image_cached_at > 0)
      FROM artworks WHERE source = 'wikimedia_commons' GROUP BY ala_id
    `);
    res.json(r.rows);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
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
  const { q, alaId, exclude, limit = 50 } = req.query;
  const finalAlaId = (alaId === "psyche") ? "fase" : alaId;

  if (finalAlaId) {
    try {
      const excludeIds = exclude ? exclude.split(",").filter(Boolean) : [];
      const results = await searchCuradoria(finalAlaId, excludeIds, parseInt(limit));
      return res.json({ source: "database", total: results.length, results, ala: finalAlaId });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (!q?.trim()) {
    try {
      const r = await pool.query(
        `SELECT * FROM artworks WHERE image_url IS NOT NULL AND image_url != '' ORDER BY RANDOM() LIMIT $1`,
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

app.get("/api/cache/status", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT COUNT(*) as total_obras,
             COUNT(*) FILTER (WHERE image_cached_at>0) as imagens_cache,
             COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_url!='' AND image_cached_at=0) as imagens_pendentes
      FROM artworks WHERE image_url IS NOT NULL AND image_url!=''
    `);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/cache/forcar", async (req, res) => {
  try {
    const limite = parseInt(req.query.limit) || 100;
    const r = await pool.query(
      `SELECT id, image_url FROM artworks
       WHERE image_url IS NOT NULL AND image_url!=''
         AND (image_data IS NULL OR image_cached_at=0)
         AND download_attempts<3
         AND image_url NOT LIKE '%metmuseum%'
       LIMIT $1`,
      [limite]
    );
    if (r.rows.length === 0) return res.json({ message: "Nenhuma imagem pendente", total: 0 });
    let baixadas = 0;
    for (const row of r.rows) {
      try {
        await new Promise(r => setTimeout(r, 500));
        const resposta = await fetch(row.image_url, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0" } });
        if (!resposta.ok) continue;
        const contentType = resposta.headers.get("content-type") || "image/jpeg";
        if (!contentType.startsWith("image/")) continue;
        const buffer = await resposta.arrayBuffer();
        if (buffer.byteLength < 5000) continue;
        await pool.query(
          `UPDATE artworks SET image_data=$1, image_mime=$2, image_cached_at=$3 WHERE id=$4`,
          [Buffer.from(buffer), contentType, Math.floor(Date.now() / 1000), row.id]
        );
        baixadas++;
      } catch {}
    }
    res.json({ ok: true, processadas: r.rows.length, baixadas });
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
      curadoria_manual:"#BA7517", wikimedia_commons:"#9B59B6",
      direto:"#BA7517", expansao:"#534AB7"
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
        <

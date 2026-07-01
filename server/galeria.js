// server/galeria.js — Rotação estável por usuário (cookie anônimo)
// ─────────────────────────────────────────────────────────────────────────────
// A ala tem UMA ordem fixa (ordem de entrada no banco: antigas primeiro, novas
// no fim). Cada visitante recebe um ponto de partida próprio nessa ordem,
// estável por 1 semana (cookie anônimo germ_uid). A cada clique/página ele
// avança 18 na sequência, sem repetir, dando a volta na ordem fixa.
//
// - Sequência fixa  = ORDER BY indexed_at ASC, id ASC  → novas entram no fim
// - Ponto de partida = hash(uid + ala) % N             → cada um começa em lugar diferente
// - Página p        = posições [(offset + p*18) .. +18] com wrap
//
// COMO LIGAR (1 linha no server.js, ANTES do app.get("*")):
//     require("./galeria").montarGaleria(app, pool);
//
// USO (frontend):  GET /api/galeria/:ala?page=0   (page 1, 2, ... a cada clique)
// ─────────────────────────────────────────────────────────────────────────────

const PAGE = 18;
const SEMANA = 7 * 24 * 3600; // segundos

function lerCookie(req, nome) {
  const raw = req.headers.cookie || "";
  for (const par of raw.split(";")) {
    const [k, v] = par.trim().split("=");
    if (k === nome) return v;
  }
  return null;
}

function novoUid() {
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

// Hash determinístico (FNV-1a) → mesmo uid+ala sempre dá o mesmo offset
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Alta resolução para o zoom (espelha o toHd do server)
function toHd(url) {
  if (!url) return url;
  if (url.includes("artic.edu/iiif")) return url.replace(/\/full\/[^/]+\//, "/full/1686,/");
  if (url.includes("upload.wikimedia.org") && url.includes("/thumb/")) return url.replace(/\/\d+px-/, "/1600px-");
  return url;
}

function mapRow(r) {
  return {
    id: r.id, source: r.source, title: r.title, artist: r.artist, date: r.date,
    medium: r.medium, dimensions: r.dimensions, origin: r.origin, style: r.style,
    museum: r.museum, description: r.description, credit: r.credit,
    imageUrl: r.image_url, imageHd: r.hd_url || toHd(r.image_url),
    externalUrl: r.external_url, alaId: r.ala_id,
    wiki: { en: r.wiki_en || null, fr: r.wiki_fr || null, es: r.wiki_es || null, it: r.wiki_it || null, pt: r.wiki_pt || null, de: r.wiki_de || null },
  };
}

function montarGaleria(app, pool) {
  app.get("/api/galeria/:ala", async (req, res) => {
    try {
      const ala  = req.params.ala;
      const page = Math.max(0, parseInt(req.query.page || "0", 10) || 0);

      // uid anônimo estável por 1 semana
      let uid = lerCookie(req, "germ_uid");
      if (!uid) {
        uid = novoUid();
        res.setHeader("Set-Cookie", `germ_uid=${uid}; Max-Age=${SEMANA}; Path=/; SameSite=Lax`);
      }

      // total de obras publicadas com imagem na ala (a sequência fixa)
      const ct = await pool.query(
        `SELECT COUNT(*) AS n FROM artworks
          WHERE ala_id = $1 AND image_url IS NOT NULL AND image_url <> ''
            AND COALESCE(status,'publicada') = 'publicada'`,
        [ala]
      );
      const N = parseInt(ct.rows[0].n, 10);
      if (N === 0) return res.json({ results: [], total: 0, page, hasMore: false, uid });

      // ponto de partida do usuário (estável) e posições desta página (com wrap)
      const offset = hashStr(uid + "|" + ala) % N;
      const count  = Math.min(PAGE, N);
      const base   = offset + page * PAGE;
      const positions = [];
      for (let i = 0; i < count; i++) positions.push((base + i) % N);

      const r = await pool.query(
        `WITH ordenado AS (
           SELECT *, (ROW_NUMBER() OVER (ORDER BY indexed_at ASC, id ASC) - 1) AS pos
           FROM artworks
           WHERE ala_id = $1 AND image_url IS NOT NULL AND image_url <> ''
             AND COALESCE(status,'publicada') = 'publicada'
         )
         SELECT * FROM ordenado WHERE pos = ANY($2::bigint[])`,
        [ala, positions]
      );

      // reordena para bater exatamente com a sequência pedida
      const byPos = new Map(r.rows.map(row => [Number(row.pos), row]));
      const results = positions.map(p => byPos.get(p)).filter(Boolean).map(mapRow);

      res.json({
        results,
        total: N,
        page,
        hasMore: (page + 1) * PAGE < N, // ainda há mais antes de dar a volta completa
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log("🔁 Galeria (rotação estável) montada — /api/galeria/:ala");
}

module.exports = { montarGaleria };

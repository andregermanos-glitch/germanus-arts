// server/hd_recuperar.js — Recupera a URL HD das obras antigas do Commons
// ─────────────────────────────────────────────────────────────────────────────
// Caminho A: o card usa a imagem normal (1000px, rápido); o ZOOM busca o HD na
// fonte. Para isso cada obra precisa de uma hd_url. As importações novas já a
// guardam; este módulo preenche as ANTIGAS do Commons (id = commons_<pageid>):
// consulta o Commons pelo pageid → nome do arquivo → monta Special:FilePath?width=2500.
//
// Obras cujo id não tem pageid limpo (coleção russa, ids base64) não dão para
// recuperar — ficam sem hd_url e o zoom usa a 1000px normal (sem piora).
//
// COMO LIGAR (1 linha no server.js, ANTES do app.get("*")):
//     require("./hd_recuperar").montarHdRecuperar(app, pool);
//
// USO:  POST /api/hd/recuperar { "total": 2000 }   ·   GET /api/hd/status
// ─────────────────────────────────────────────────────────────────────────────

const COMMONS = "https://commons.wikimedia.org/w/api.php";
const UA = "GermanusArt/1.0 (https://germanus.art; contato@germanus.art)";

let est = { rodando: false, alvo: 0, feitas: 0, recuperadas: 0 };

async function recuperarLote(pool, pageids) {
  const url = `${COMMONS}?action=query&pageids=${pageids.join("|")}&prop=info&format=json&origin=*`;
  let d;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    d = await r.json();
  } catch (e) { console.log("  [HD] lote:", e.message); return 0; }

  const pages = d.query?.pages || {};
  let n = 0;
  for (const pid of Object.keys(pages)) {
    const titulo = pages[pid].title; // "File:Xxxx.jpg"
    if (!titulo) continue;
    const arquivo = titulo.replace(/^File:/, "");
    const hd = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(arquivo)}?width=2500`;
    try {
      await pool.query(`UPDATE artworks SET hd_url=$1 WHERE id=$2 AND hd_url IS NULL`, [hd, `commons_${pid}`]);
      n++;
    } catch {}
  }
  return n;
}

async function rodar(pool, total) {
  est = { rodando: true, alvo: total, feitas: 0, recuperadas: 0 };
  while (est.feitas < total) {
    // obras antigas do Commons com pageid numérico e ainda sem hd_url
    const r = await pool.query(
      `SELECT id FROM artworks
        WHERE hd_url IS NULL AND id ~ '^commons_[0-9]+$'
        ORDER BY indexed_at ASC LIMIT 50`
    );
    if (r.rows.length === 0) break;
    const pageids = r.rows.map(x => x.id.replace("commons_", ""));
    const n = await recuperarLote(pool, pageids);
    est.recuperadas += n;
    est.feitas += r.rows.length;
    await new Promise(s => setTimeout(s, 800)); // ritmo educado
  }
  est.rodando = false;
  console.log(`🔍 HD — recuperação concluída: ${est.recuperadas}/${est.feitas} obras com HD`);
}

function montarHdRecuperar(app, pool) {
  pool.query(`ALTER TABLE artworks ADD COLUMN IF NOT EXISTS hd_url TEXT`).catch(() => {});

  app.post("/api/hd/recuperar", async (req, res) => {
    if (est.rodando) return res.json({ ok: false, mensagem: "Já está rodando", est });
    const total = Math.min(parseInt(req.body?.total || "2000", 10) || 2000, 50000);
    res.json({ ok: true, mensagem: `Recuperação de HD iniciada (até ${total}). Veja /api/hd/status`, total });
    rodar(pool, total).catch(e => { est.rodando = false; console.log("🔍 HD erro:", e.message); });
  });

  app.get("/api/hd/status", async (req, res) => {
    let tot = {};
    try {
      const r = await pool.query(`
        SELECT COUNT(*) FILTER (WHERE hd_url IS NOT NULL) AS com_hd,
               COUNT(*) FILTER (WHERE hd_url IS NULL AND id ~ '^commons_[0-9]+$') AS recuperaveis,
               COUNT(*) AS total
        FROM artworks`);
      tot = r.rows[0];
    } catch (e) { tot = { erro: e.message }; }
    res.json({ ...est, ...tot });
  });

  console.log("🔍 HD recuperar montado — POST /api/hd/recuperar");
}

module.exports = { montarHdRecuperar };

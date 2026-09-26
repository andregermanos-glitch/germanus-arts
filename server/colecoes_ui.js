// server/colecoes_ui.js — Coleções editoriais do GERMANUS.Art
// ─────────────────────────────────────────────────────────────────────────────
// Ala é permanente e classificatória; coleção é editorial e SEQUENCIADA: reúne
// obras de várias alas numa ordem escolhida. A ordem importa — trocar duas obras
// de lugar muda o que a sequência diz. Por isso a tabela tem coluna `ordem`.
//
// Cria as tabelas sozinho no boot (como o curadoria_ui faz com status/curado).
//
// COMO LIGAR (1 linha no server.js, ANTES do app.get("*")):
//     require("./colecoes_ui").montarColecoes(app, pool);
// ─────────────────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function montarColecoes(app, pool) {

  // ── Migração idempotente ───────────────────────────────────────────────────
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS colecoes (
          slug        TEXT PRIMARY KEY,
          titulo_pt   TEXT NOT NULL,
          titulo_fr   TEXT, titulo_en TEXT, titulo_es TEXT, titulo_it TEXT, titulo_de TEXT,
          texto_pt    TEXT,
          texto_fr    TEXT, texto_en TEXT, texto_es TEXT, texto_it TEXT, texto_de TEXT,
          publicada   BOOLEAN NOT NULL DEFAULT FALSE,
          ordem       SMALLINT NOT NULL DEFAULT 0,
          criada_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS colecao_obras (
          colecao  TEXT NOT NULL REFERENCES colecoes(slug) ON DELETE CASCADE,
          obra_id  TEXT NOT NULL,
          ordem    SMALLINT NOT NULL DEFAULT 0,
          nota_pt  TEXT,
          PRIMARY KEY (colecao, obra_id)
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_colecao_ordem ON colecao_obras (colecao, ordem)`);
      console.log("🖼️  Coleções — tabelas prontas");
    } catch (e) { console.log("🖼️  Coleções — migração:", e.message); }
  })();

  // ── API pública (consumida pelo frontend) ──────────────────────────────────

  // Lista as coleções publicadas, com contagem e capa
  app.get("/api/colecoes", async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT c.slug, c.titulo_pt, c.titulo_fr, c.titulo_en, c.titulo_es, c.titulo_it, c.titulo_de,
               c.texto_pt, c.texto_fr, c.texto_en, c.texto_es, c.texto_it, c.texto_de,
               COUNT(co.obra_id)::int AS n,
               (SELECT a.image_url FROM colecao_obras x
                  JOIN artworks a ON a.id = x.obra_id
                 WHERE x.colecao = c.slug ORDER BY x.ordem LIMIT 1) AS capa
          FROM colecoes c
          LEFT JOIN colecao_obras co ON co.colecao = c.slug
         WHERE c.publicada = TRUE
         GROUP BY c.slug ORDER BY c.ordem, c.titulo_pt`);
      res.json({ colecoes: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Uma coleção com as obras NA ORDEM definida
  app.get("/api/colecao/:slug", async (req, res) => {
    try {
      const c = await pool.query(`SELECT * FROM colecoes WHERE slug = $1`, [req.params.slug]);
      if (!c.rows[0]) return res.status(404).json({ error: "coleção não encontrada" });
      const o = await pool.query(`
        SELECT a.*, co.ordem, co.nota_pt
          FROM colecao_obras co JOIN artworks a ON a.id = co.obra_id
         WHERE co.colecao = $1 ORDER BY co.ordem, a.title`, [req.params.slug]);
      res.json({
        colecao: c.rows[0],
        results: o.rows.map(r => ({
          id: r.id, title: r.title, artist: r.artist, date: r.date, medium: r.medium,
          dimensions: r.dimensions, origin: r.origin, style: r.style, museum: r.museum,
          description: r.description, credit: r.credit, imageUrl: r.image_url,
          imageHd: r.hd_url || r.image_url, externalUrl: r.external_url, alaId: r.ala_id,
          nota: r.nota_pt,
          wiki: { en:r.wiki_en, fr:r.wiki_fr, es:r.wiki_es, it:r.wiki_it, pt:r.wiki_pt, de:r.wiki_de },
        })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── API do painel ──────────────────────────────────────────────────────────

  app.post("/api/colecoes/salvar", async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.slug || !b.titulo_pt) return res.status(400).json({ error: "slug e titulo_pt obrigatórios" });
      await pool.query(`
        INSERT INTO colecoes (slug, titulo_pt, titulo_fr, titulo_en, titulo_es, titulo_it, titulo_de,
                              texto_pt, publicada, ordem)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (slug) DO UPDATE SET
          titulo_pt=EXCLUDED.titulo_pt, titulo_fr=EXCLUDED.titulo_fr, titulo_en=EXCLUDED.titulo_en,
          titulo_es=EXCLUDED.titulo_es, titulo_it=EXCLUDED.titulo_it, titulo_de=EXCLUDED.titulo_de,
          texto_pt=EXCLUDED.texto_pt, publicada=EXCLUDED.publicada, ordem=EXCLUDED.ordem`,
        [b.slug, b.titulo_pt, b.titulo_fr || null, b.titulo_en || null, b.titulo_es || null,
         b.titulo_it || null, b.titulo_de || null, b.texto_pt || null,
         b.publicada !== false, parseInt(b.ordem || 0, 10)]);
      res.json({ ok: true, slug: b.slug });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Busca obras publicadas por título ou autor — para montar a coleção
  app.get("/api/colecoes/buscar", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (!q) return res.json({ obras: [] });
      const { rows } = await pool.query(`
        SELECT id, title, artist, date, ala_id, image_url
          FROM artworks
         WHERE image_url IS NOT NULL AND image_url <> ''
           AND COALESCE(status,'publicada') = 'publicada'
           AND (title ILIKE $1 OR artist ILIKE $1)
         LIMIT 12`, [`%${q}%`]);
      res.json({ obras: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Acrescenta obra ao fim da coleção
  app.post("/api/colecoes/adicionar", async (req, res) => {
    try {
      const { colecao, obra_id } = req.body || {};
      if (!colecao || !obra_id) return res.status(400).json({ error: "colecao e obra_id obrigatórios" });
      const m = await pool.query(`SELECT COALESCE(MAX(ordem),0)+1 AS n FROM colecao_obras WHERE colecao=$1`, [colecao]);
      await pool.query(
        `INSERT INTO colecao_obras (colecao, obra_id, ordem) VALUES ($1,$2,$3)
         ON CONFLICT (colecao, obra_id) DO NOTHING`, [colecao, obra_id, m.rows[0].n]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/colecoes/remover", async (req, res) => {
    try {
      const { colecao, obra_id } = req.body || {};
      await pool.query(`DELETE FROM colecao_obras WHERE colecao=$1 AND obra_id=$2`, [colecao, obra_id]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Reordena: recebe a lista de ids na ordem desejada
  app.post("/api/colecoes/ordenar", async (req, res) => {
    try {
      const { colecao, ids } = req.body || {};
      if (!colecao || !Array.isArray(ids)) return res.status(400).json({ error: "colecao e ids obrigatórios" });
      for (let i = 0; i < ids.length; i++)
        await pool.query(`UPDATE colecao_obras SET ordem=$3 WHERE colecao=$1 AND obra_id=$2`, [colecao, ids[i], i + 1]);
      res.json({ ok: true, total: ids.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Painel /colecoes ───────────────────────────────────────────────────────
  app.get("/colecoes", async (req, res) => {
    const slug = (req.query.c || "").trim();
    let lista = [], atual = null, obras = [];
    try {
      const l = await pool.query(`
        SELECT c.slug, c.titulo_pt, c.publicada, COUNT(co.obra_id)::int AS n
          FROM colecoes c LEFT JOIN colecao_obras co ON co.colecao=c.slug
         GROUP BY c.slug ORDER BY c.ordem, c.titulo_pt`);
      lista = l.rows;
      if (slug) {
        const a = await pool.query(`SELECT * FROM colecoes WHERE slug=$1`, [slug]);
        atual = a.rows[0] || null;
        const o = await pool.query(`
          SELECT a.id, a.title, a.artist, a.date, a.ala_id, a.image_url, co.ordem
            FROM colecao_obras co JOIN artworks a ON a.id=co.obra_id
           WHERE co.colecao=$1 ORDER BY co.ordem`, [slug]);
        obras = o.rows;
      }
    } catch (e) { return res.status(500).send(`<pre style="color:red">${esc(e.message)}</pre>`); }

    const tabs = lista.map(c => `<a href="/colecoes?c=${encodeURIComponent(c.slug)}"
        style="display:inline-block;padding:6px 12px;border-radius:8px;font-size:12px;text-decoration:none;
        border:1px solid ${c.slug===slug?"#1D9E75":"#2a2a2a"};background:${c.slug===slug?"#1D9E7522":"#141414"};
        color:${c.slug===slug?"#1D9E75":"#aaa"}">${esc(c.titulo_pt)} (${c.n})${c.publicada?"":" ·rascunho"}</a>`).join("");

    const cards = obras.map((o, i) => `<div class="card" data-id="${esc(o.id)}">
        <div class="pos">${i+1}</div>
        <img src="${esc(o.image_url)}" loading="lazy" alt="">
        <div class="info"><div class="t">${esc(o.title)}</div>
          <div class="m">${esc(o.artist||"")} ${o.date?"· "+esc(o.date):""}</div>
          <div class="a">${esc(o.ala_id||"")}</div></div>
        <div class="acs">
          <button onclick="mover('${esc(o.id)}',-1)">↑</button>
          <button onclick="mover('${esc(o.id)}',1)">↓</button>
          <button onclick="remover('${esc(o.id)}')">✕</button>
        </div></div>`).join("");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Germanus — Coleções</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#e0e0e0;font-family:-apple-system,Segoe UI,sans-serif;padding:24px;max-width:1000px;margin:0 auto}
h1{font-size:20px;color:#fff}.sub{color:#666;font-size:12px;margin:4px 0 18px}a{color:#378ADD;text-decoration:none}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px}
.box{background:#101010;border:1px solid #222;border-radius:10px;padding:14px;margin-bottom:16px}
.box h3{font-size:12px;color:#ccc;margin-bottom:8px}
label{display:block;font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin:10px 0 4px}
input,textarea{width:100%;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:6px;color:#ddd;padding:8px 10px;font-size:13px;font-family:inherit}
textarea{min-height:90px;resize:vertical;line-height:1.5}
.row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
button{padding:7px 13px;border-radius:7px;border:1px solid #2a2a2a;background:#161616;color:#ccc;cursor:pointer;font-size:12px}
button.go{background:#1D9E7522;border-color:#1D9E7555;color:#5fd6a8}
.card{display:flex;align-items:center;gap:12px;background:#121212;border:1px solid #1e1e1e;border-radius:8px;padding:8px;margin-bottom:6px}
.card img{width:56px;height:56px;object-fit:cover;border-radius:5px;background:#1a1a1a}
.card .pos{width:22px;text-align:center;color:#555;font-size:12px}
.card .info{flex:1;min-width:0}
.card .t{font-size:13px;color:#fff}.card .m{font-size:11px;color:#888}.card .a{font-size:10px;color:#BA7517}
.card .acs{display:flex;gap:4px}
.res{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #161616}
.res img{width:40px;height:40px;object-fit:cover;border-radius:4px}
.res .t{flex:1;font-size:12px;color:#ddd}
</style></head><body>
<h1>GERMANUS.Art — Coleções</h1>
<p class="sub"><a href="/banco">← banco</a> · <a href="/curadoria">curadoria</a> · <a href="/museus">museus</a> · a ordem das obras é o argumento da coleção</p>

<div class="tabs">${tabs || '<span style="color:#555;font-size:12px">Nenhuma coleção ainda.</span>'}</div>

<div class="box">
  <h3>${atual ? "Editar coleção" : "Nova coleção"}</h3>
  <div class="row">
    <div><label>slug</label><input id="f_slug" value="${esc(atual?.slug||"")}"></div>
    <div><label>ordem no site</label><input id="f_ordem" type="number" value="${atual?.ordem||0}"></div>
    <div><label>publicada</label><input id="f_pub" value="${atual? String(atual.publicada) : "true"}"></div>
  </div>
  <div class="row">
    <div><label>título PT</label><input id="f_pt" value="${esc(atual?.titulo_pt||"")}"></div>
    <div><label>título FR</label><input id="f_fr" value="${esc(atual?.titulo_fr||"")}"></div>
    <div><label>título EN</label><input id="f_en" value="${esc(atual?.titulo_en||"")}"></div>
  </div>
  <div class="row">
    <div><label>título ES</label><input id="f_es" value="${esc(atual?.titulo_es||"")}"></div>
    <div><label>título IT</label><input id="f_it" value="${esc(atual?.titulo_it||"")}"></div>
    <div><label>título DE</label><input id="f_de" value="${esc(atual?.titulo_de||"")}"></div>
  </div>
  <label>texto de abertura (PT)</label><textarea id="f_texto">${esc(atual?.texto_pt||"")}</textarea>
  <div style="margin-top:10px"><button class="go" onclick="salvar()">salvar coleção</button>
  <span id="msg" style="font-size:12px;color:#666;margin-left:10px"></span></div>
</div>

${slug ? `
<div class="box">
  <h3>Acrescentar obras — busque por título ou autor</h3>
  <input id="busca" placeholder="ex.: Absinthe, Courbet, Renoir…" onkeydown="if(event.key==='Enter')buscar()">
  <div id="res" style="margin-top:10px"></div>
</div>

<div class="box">
  <h3>Obras da coleção — ${obras.length} · a ordem é esta</h3>
  ${cards || '<p style="color:#555;font-size:12px">Nenhuma obra ainda.</p>'}
</div>` : '<p style="color:#555;font-size:12px">Escolha ou crie uma coleção para montar a sequência.</p>'}

<script>
var SLUG = ${JSON.stringify(slug)};
var g = function(i){ return document.getElementById(i); };

async function salvar(){
  var b = { slug:g('f_slug').value.trim(), ordem:g('f_ordem').value,
    publicada: g('f_pub').value.trim() !== 'false',
    titulo_pt:g('f_pt').value, titulo_fr:g('f_fr').value, titulo_en:g('f_en').value,
    titulo_es:g('f_es').value, titulo_it:g('f_it').value, titulo_de:g('f_de').value,
    texto_pt:g('f_texto').value };
  if(!b.slug || !b.titulo_pt) return alert('slug e título PT são obrigatórios');
  g('msg').textContent = 'salvando…';
  var d = await (await fetch('/api/colecoes/salvar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})).json();
  if(d.ok) location.href = '/colecoes?c=' + encodeURIComponent(b.slug);
  else g('msg').textContent = 'erro: ' + (d.error||'');
}
async function buscar(){
  var q = g('busca').value.trim(); if(!q) return;
  var d = await (await fetch('/api/colecoes/buscar?q='+encodeURIComponent(q))).json();
  g('res').innerHTML = (d.obras||[]).map(function(o){
    return '<div class="res"><img src="'+o.image_url+'"><span class="t">'+o.title+
      ' <span style="color:#777">· '+(o.artist||'')+'</span></span>'+
      '<button onclick="adicionar(\\''+o.id+'\\')">+ adicionar</button></div>';
  }).join('') || '<p style="color:#555;font-size:12px">Nada encontrado no acervo publicado.</p>';
}
async function adicionar(id){
  await fetch('/api/colecoes/adicionar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({colecao:SLUG,obra_id:id})});
  location.reload();
}
async function remover(id){
  if(!confirm('Tirar da coleção?')) return;
  await fetch('/api/colecoes/remover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({colecao:SLUG,obra_id:id})});
  location.reload();
}
async function mover(id, delta){
  var ids = Array.prototype.map.call(document.querySelectorAll('.card'), function(c){ return c.dataset.id; });
  var i = ids.indexOf(id), j = i + delta;
  if(i<0 || j<0 || j>=ids.length) return;
  ids[i] = ids[j]; ids[j] = id;
  await fetch('/api/colecoes/ordenar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({colecao:SLUG, ids:ids})});
  location.reload();
}
</script>
</body></html>`);
  });

  console.log("🖼️  Coleções montadas — /colecoes");
}

module.exports = { montarColecoes };

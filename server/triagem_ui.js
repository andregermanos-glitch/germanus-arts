// server/triagem_ui.js — Aba de Triagem (revisão de direitos autorais)
// ─────────────────────────────────────────────────────────────────────────────
// Separa as obras que a triagem marcou (🟡 verificar / 🔴 risco) num painel PRÓPRIO,
// fora da Entrada comum (para não misturar com as importações novas).
// Aqui você pode, obra a obra:
//   • CORRIGIR título, artista, data/ano ali mesmo (inline)
//   • RE-VERIFICAR (roda a triagem de novo — ex.: corrigiu "Monet" → vira 🟢)
//   • PUBLICAR (libera para o site) ou ARQUIVAR (descarta, mantém no banco)
//
// COMO LIGAR (1 linha no server.js, ANTES do app.get("*")):
//     require("./triagem_ui").montarTriagem(app, pool);
// ─────────────────────────────────────────────────────────────────────────────

const { enriquecerObra } = require("./enriquecedor");

function montarTriagem(app, pool) {

  // salvar correções de metadados (título/artista/data)
  app.post("/api/triagem/salvar", async (req, res) => {
    try {
      const { id, title, artist, date } = req.body || {};
      if (!id) return res.status(400).json({ error: "id obrigatório" });
      await pool.query(
        `UPDATE artworks SET title=$2, artist=$3, date=$4 WHERE id=$1`,
        [id, (title || "").trim(), (artist || "").trim(), (date || "").trim()]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // publicar (libera para o site)
  app.post("/api/triagem/publicar", async (req, res) => {
    try {
      const { id } = req.body || {};
      await pool.query(`UPDATE artworks SET status='publicada', triagem='verde' WHERE id=$1`, [id]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // arquivar (descarta do site, mantém no banco)
  app.post("/api/triagem/arquivar", async (req, res) => {
    try {
      const { id } = req.body || {};
      await pool.query(`UPDATE artworks SET status='arquivada' WHERE id=$1`, [id]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // re-verificar: roda a triagem de novo nessa obra (usa os dados já corrigidos)
  app.post("/api/triagem/reverificar", async (req, res) => {
    try {
      const { id } = req.body || {};
      const r = await pool.query(
        `SELECT id,title,artist,date,museum,credit,style FROM artworks WHERE id=$1`, [id]
      );
      if (r.rowCount === 0) return res.status(404).json({ error: "não encontrada" });
      const faixa = await enriquecerObra(pool, r.rows[0]);
      res.json({ ok: true, faixa });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // dados da aba (JSON) — paginado
  app.get("/api/triagem/lista", async (req, res) => {
    try {
      const faixa = ["amarelo", "vermelho"].includes(req.query.faixa) ? req.query.faixa : null;
      const offset = Math.max(parseInt(req.query.offset || "0", 10) || 0, 0);
      const filtro = faixa ? `triagem=$1` : `triagem IN ('amarelo','vermelho')`;
      const params = faixa ? [faixa] : [];
      const r = await pool.query(
        `SELECT id,title,artist,date,triagem,image_url,museum
           FROM artworks WHERE ${filtro}
          ORDER BY triagem DESC, indexed_at ASC
          LIMIT 24 OFFSET ${offset}`, params
      );
      const tot = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE triagem='amarelo') AS amarelo,
                COUNT(*) FILTER (WHERE triagem='vermelho') AS vermelho
           FROM artworks`
      );
      res.json({ obras: r.rows, ...tot.rows[0], offset });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // painel visual
  app.get("/triagem", async (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Germanus — Triagem</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#e0e0e0;font-family:-apple-system,Segoe UI,sans-serif;padding:24px;max-width:1100px;margin:0 auto}
h1{font-size:20px;color:#fff}.sub{color:#666;font-size:12px;margin:4px 0 20px}
a{color:#378ADD;text-decoration:none}
.tabs{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap}
.tabs button{padding:8px 14px;border-radius:8px;border:1px solid #2a2a2a;background:#161616;color:#ccc;cursor:pointer;font-size:12px}
.tabs button.on{background:#e0a23a22;border-color:#e0a23a55;color:#e0a23a}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.card{background:#141414;border:1px solid #222;border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.card img{width:100%;height:150px;object-fit:cover;background:#000}
.card .b{padding:10px;display:flex;flex-direction:column;gap:6px}
.tag{font-size:10px;font-weight:700;padding:2px 7px;border-radius:5px;align-self:flex-start;text-transform:uppercase}
.tag.amarelo{background:#e0a23a22;color:#e0a23a}.tag.vermelho{background:#e24b4a22;color:#e24b4a}
.card label{font-size:9px;color:#666;text-transform:uppercase}
.card input{width:100%;padding:5px 7px;border-radius:5px;border:1px solid #2a2a2a;background:#0e0e0e;color:#eee;font-size:12px}
.acts{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}
.acts button{flex:1;min-width:70px;padding:6px;border-radius:6px;border:1px solid #2a2a2a;background:#161616;color:#ccc;cursor:pointer;font-size:11px}
.acts .pub{background:#1D9E7522;border-color:#1D9E7555;color:#5fd6a8}
.acts .arq{background:#e24b4a18;border-color:#e24b4a44;color:#e88}
.acts .rev{background:#378add22;border-color:#378add55;color:#8bc0f5}
.acts .sav{background:#2a2a2a}
.more{margin:20px auto;display:block;padding:10px 20px;border-radius:8px;border:1px solid #2a2a2a;background:#161616;color:#ccc;cursor:pointer}
.msg{font-size:10px;margin-top:4px;min-height:12px}
</style></head><body>
<h1>GERMANUS.Art — Triagem de Direitos</h1>
<p class="sub"><a href="/banco">← banco</a> · <a href="/enriquecimento">enriquecimento</a> · corrija, re-verifique e decida obra a obra · régua: domínio público = morte do autor +70 anos (ou obra anterior a 1875)</p>

<div class="tabs">
  <button id="t_todas" class="on" onclick="carregar(null)">Todas</button>
  <button id="t_amarelo" onclick="carregar('amarelo')">🟡 Verificar (<span id="c_a">–</span>)</button>
  <button id="t_vermelho" onclick="carregar('vermelho')">🔴 Risco (<span id="c_v">–</span>)</button>
</div>

<div class="grid" id="grid"></div>
<button class="more" id="more" onclick="mais()" style="display:none">Carregar mais ↓</button>

<script>
let faixaAtual = null, offset = 0;

function card(o){
  const t = (o.triagem||'amarelo');
  return \`<div class="card" id="card_\${o.id}">
    <img src="\${o.image_url||''}" onerror="this.style.opacity=.2">
    <div class="b">
      <span class="tag \${t}">\${t==='vermelho'?'🔴 risco':'🟡 verificar'}</span>
      <label>Título</label><input id="ti_\${o.id}" value="\${(o.title||'').replace(/"/g,'&quot;')}">
      <label>Artista</label><input id="ar_\${o.id}" value="\${(o.artist||'').replace(/"/g,'&quot;')}">
      <label>Ano/Data</label><input id="da_\${o.id}" value="\${(o.date||'').replace(/"/g,'&quot;')}">
      <div class="acts">
        <button class="sav" onclick="salvar('\${o.id}')">💾 Salvar</button>
        <button class="rev" onclick="reverificar('\${o.id}')">🔄 Re-verificar</button>
      </div>
      <div class="acts">
        <button class="pub" onclick="publicar('\${o.id}')">✓ Publicar</button>
        <button class="arq" onclick="arquivar('\${o.id}')">✕ Arquivar</button>
      </div>
      <div class="msg" id="ms_\${o.id}"></div>
    </div>
  </div>\`;
}

async function carregar(faixa){
  faixaAtual = faixa; offset = 0;
  document.getElementById('t_todas').className = faixa===null?'on':'';
  document.getElementById('t_amarelo').className = faixa==='amarelo'?'on':'';
  document.getElementById('t_vermelho').className = faixa==='vermelho'?'on':'';
  document.getElementById('grid').innerHTML = '';
  await mais();
}
async function mais(){
  const q = faixaAtual ? \`?faixa=\${faixaAtual}&offset=\${offset}\` : \`?offset=\${offset}\`;
  const d = await (await fetch('/api/triagem/lista'+q)).json();
  document.getElementById('c_a').textContent = d.amarelo||0;
  document.getElementById('c_v').textContent = d.vermelho||0;
  document.getElementById('grid').insertAdjacentHTML('beforeend', (d.obras||[]).map(card).join(''));
  offset += (d.obras||[]).length;
  document.getElementById('more').style.display = (d.obras||[]).length>=24 ? 'block' : 'none';
}
function msg(id,txt){ const e=document.getElementById('ms_'+id); if(e) e.textContent=txt; }
function some(id){ const c=document.getElementById('card_'+id); if(c){ c.style.opacity=.3; setTimeout(()=>c.remove(),400);} }

async function post(url,body){ return (await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json(); }

async function salvar(id){
  const body={id,title:v('ti_'+id),artist:v('ar_'+id),date:v('da_'+id)};
  const d=await post('/api/triagem/salvar',body);
  msg(id, d.ok?'💾 salvo':'erro');
}
async function reverificar(id){
  await salvar(id); // salva antes de re-verificar
  msg(id,'⏳ re-verificando...');
  const d=await post('/api/triagem/reverificar',{id});
  if(d.ok){
    if(d.faixa==='verde'){ msg(id,'🟢 virou seguro! (publique)'); }
    else msg(id, d.faixa==='vermelho'?'🔴 continua risco':'🟡 continua a verificar');
  } else msg(id,'erro: '+(d.error||''));
}
async function publicar(id){ const d=await post('/api/triagem/publicar',{id}); if(d.ok) some(id); }
async function arquivar(id){ const d=await post('/api/triagem/arquivar',{id}); if(d.ok) some(id); }
function v(id){ return document.getElementById(id).value; }

carregar(null);
</script>
</body></html>`);
  });

  console.log("⚖️  Triagem montada — /triagem");
}

module.exports = { montarTriagem };

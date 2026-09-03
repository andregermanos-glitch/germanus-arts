// server/atendente_admin.js — Painel /atendente · GERMANUS.Art
//
// Montagem em server.js, junto dos outros módulos:
//   require("./atendente_admin").montarAtendenteAdmin(app, pool);
//
// Não altera a qualidade das respostas. Serve para você incluir e corrigir
// verbetes sem deploy, e para ler quais perguntas ficaram sem verbete.

function montarAtendenteAdmin(app, pool) {

  // ─── API do painel ─────────────────────────────────────────────────────────
  app.get("/api/atendente/verbetes", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, slug, eixo, titulo_pt, ativo, prioridade, length(corpo) AS tamanho
           FROM conteudo_atendente ORDER BY eixo, slug`);
      res.json({ verbetes: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/atendente/verbete/:slug", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM conteudo_atendente WHERE slug = $1`, [req.params.slug]);
      if (!rows[0]) return res.status(404).json({ error: "não encontrado" });
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/atendente/verbete", async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.slug || !b.titulo_pt || !b.corpo)
        return res.status(400).json({ error: "slug, titulo_pt e corpo são obrigatórios" });

      const chaves = ["pt","en","fr","es","it","de"]
        .map(l => `${b["chaves_" + l] || ""} ${b["titulo_" + l] || ""}`)
        .join(" ").toLowerCase();

      await pool.query(
        `INSERT INTO conteudo_atendente
           (slug, eixo, titulo_pt, titulo_en, titulo_fr, titulo_es, titulo_it, titulo_de,
            chaves_pt, chaves_en, chaves_fr, chaves_es, chaves_it, chaves_de,
            chaves_todas, gatilhos, corpo, ativo, prioridade, alterado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
         ON CONFLICT (slug) DO UPDATE SET
           eixo=EXCLUDED.eixo, titulo_pt=EXCLUDED.titulo_pt, titulo_en=EXCLUDED.titulo_en,
           titulo_fr=EXCLUDED.titulo_fr, titulo_es=EXCLUDED.titulo_es,
           titulo_it=EXCLUDED.titulo_it, titulo_de=EXCLUDED.titulo_de,
           chaves_pt=EXCLUDED.chaves_pt, chaves_en=EXCLUDED.chaves_en,
           chaves_fr=EXCLUDED.chaves_fr, chaves_es=EXCLUDED.chaves_es,
           chaves_it=EXCLUDED.chaves_it, chaves_de=EXCLUDED.chaves_de,
           chaves_todas=EXCLUDED.chaves_todas, gatilhos=EXCLUDED.gatilhos,
           corpo=EXCLUDED.corpo, ativo=EXCLUDED.ativo, prioridade=EXCLUDED.prioridade,
           alterado_em=NOW()`,
        [b.slug, b.eixo || "extra", b.titulo_pt, b.titulo_en || null, b.titulo_fr || null,
         b.titulo_es || null, b.titulo_it || null, b.titulo_de || null,
         b.chaves_pt || null, b.chaves_en || null, b.chaves_fr || null,
         b.chaves_es || null, b.chaves_it || null, b.chaves_de || null,
         chaves, b.gatilhos || null, b.corpo,
         b.ativo !== false, parseInt(b.prioridade || 0, 10)]);

      res.json({ ok: true, slug: b.slug });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/atendente/perguntas", async (req, res) => {
    try {
      const recentes = await pool.query(
        `SELECT criado_em, lang, pergunta, slugs, match_fraco, rodadas, erro
           FROM atendente_log ORDER BY criado_em DESC LIMIT 80`);
      const resumo = await pool.query(`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE match_fraco) AS fracas,
               COUNT(*) FILTER (WHERE erro IS NOT NULL) AS erros,
               COALESCE(SUM(tokens_in),0)  AS tin,
               COALESCE(SUM(tokens_out),0) AS tout
          FROM atendente_log WHERE criado_em > NOW() - INTERVAL '30 days'`);
      res.json({ recentes: recentes.rows, resumo: resumo.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Painel HTML ───────────────────────────────────────────────────────────
  app.get("/atendente", async (req, res) => {
    let verbetes = [], resumo = {}, perguntas = [];
    try {
      const v = await pool.query(
        `SELECT slug, eixo, titulo_pt, ativo, prioridade, length(corpo) AS tamanho
           FROM conteudo_atendente ORDER BY eixo, slug`);
      verbetes = v.rows;
    } catch {}
    try {
      const r = await pool.query(`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE match_fraco) AS fracas,
               COUNT(*) FILTER (WHERE erro IS NOT NULL) AS erros,
               COALESCE(SUM(tokens_in),0) AS tin, COALESCE(SUM(tokens_out),0) AS tout
          FROM atendente_log WHERE criado_em > NOW() - INTERVAL '30 days'`);
      resumo = r.rows[0] || {};
      const p = await pool.query(
        `SELECT criado_em, lang, pergunta, match_fraco, erro
           FROM atendente_log ORDER BY criado_em DESC LIMIT 40`);
      perguntas = p.rows;
    } catch {}

    // Custo aproximado no Gemini 2.5 Flash-Lite: US$0,10 entrada / US$0,40 saída por milhão
    const custo = ((parseInt(resumo.tin || 0) / 1e6) * 0.10
                 + (parseInt(resumo.tout || 0) / 1e6) * 0.40).toFixed(2);

    const porEixo = {};
    for (const v of verbetes) (porEixo[v.eixo] ||= []).push(v);

    const linhas = Object.entries(porEixo).map(([eixo, vs]) => `
      <h3>eixo ${eixo} · ${vs.length}</h3>
      <table>${vs.map(v => `<tr>
        <td><a href="#" onclick="editar('${v.slug}');return false;">${v.titulo_pt}</a>
            <span class="slug">${v.slug}</span></td>
        <td class="n">${v.tamanho}</td>
        <td class="n">${v.prioridade ? "fixo" : ""}</td>
        <td class="n">${v.ativo ? "" : "inativo"}</td>
      </tr>`).join("")}</table>`).join("");

    const pergRows = perguntas.map(p => `<tr>
      <td class="d">${new Date(p.criado_em).toLocaleString("pt-BR", { timeZone:"America/Sao_Paulo" })}</td>
      <td class="d">${p.lang}</td>
      <td>${(p.pergunta || "").replace(/</g, "&lt;")}</td>
      <td class="n">${p.erro ? `<span class="er">${p.erro}</span>` : p.match_fraco ? '<span class="fr">sem verbete</span>' : "✓"}</td>
    </tr>`).join("") || '<tr><td colspan="4" class="d">Nenhuma pergunta ainda.</td></tr>';

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Atendente — GERMANUS.Art</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:28px 24px;max-width:940px}
h1{font-size:20px;color:#fff;margin-bottom:4px}h3{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.6px;margin:22px 0 8px}
.sub{color:#555;font-size:12px;margin-bottom:24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:26px}
.card{background:#141414;border:1px solid #222;border-radius:10px;padding:14px 16px}
.card .v{font-size:26px;font-weight:700;color:#fff;line-height:1}.card .l{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}
.card.g .v{color:#1D9E75}.card.a .v{color:#BA7517}.card.r .v{color:#E24B4A}
table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px}
td{border-bottom:1px solid #111;padding:6px 10px}tr:hover td{background:#111}
td.n{text-align:right;color:#666;font-size:11px;white-space:nowrap}td.d{color:#666;font-size:11px;white-space:nowrap}
.slug{color:#444;font-size:10px;font-family:monospace;margin-left:8px}
a{color:#e0e0e0;text-decoration:none}a:hover{color:#378ADD}
.er{color:#E24B4A}.fr{color:#BA7517}
.btn{display:inline-block;padding:8px 16px;border:1px solid #2a2a2a;border-radius:8px;color:#aaa;font-size:12px;cursor:pointer;background:none}
.btn:hover{background:#141414;color:#fff}
#ed{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center;padding:20px;z-index:99}
#ed .box{background:#111;border:1px solid #222;border-radius:12px;padding:20px;width:100%;max-width:760px;max-height:90vh;overflow:auto}
label{display:block;font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin:12px 0 4px}
input,textarea,select{width:100%;background:#0a0a0a;border:1px solid #222;border-radius:6px;color:#e0e0e0;padding:8px 10px;font-size:13px;font-family:inherit}
textarea{min-height:180px;resize:vertical;line-height:1.6}
.row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.acoes{margin-top:16px;display:flex;gap:10px}
</style></head><body>
<h1>Atendente Emmanuel Rio</h1>
<p class="sub">${verbetes.length} verbetes · <a href="/banco">← banco</a> · <a href="/atendente">↻</a></p>

<div class="cards">
  <div class="card"><div class="v">${resumo.total || 0}</div><div class="l">perguntas · 30d</div></div>
  <div class="card a"><div class="v">${resumo.fracas || 0}</div><div class="l">sem verbete</div></div>
  <div class="card r"><div class="v">${resumo.erros || 0}</div><div class="l">erros</div></div>
  <div class="card g"><div class="v" style="font-size:20px">US$ ${custo}</div><div class="l">custo estimado · 30d</div></div>
</div>

<button class="btn" onclick="novo()">+ novo verbete</button>

${linhas}

<h3>últimas perguntas</h3>
<table>${pergRows}</table>

<div id="ed"><div class="box">
  <label>slug (sem espaços, sem acento)</label><input id="f_slug">
  <div class="row">
    <div><label>eixo</label><input id="f_eixo" value="extra"></div>
    <div><label>prioridade (1 = sempre no prompt)</label><input id="f_prio" type="number" value="0"></div>
    <div><label>ativo</label><select id="f_ativo"><option value="true">sim</option><option value="false">não</option></select></div>
  </div>
  <label>título PT</label><input id="f_tpt">
  <div class="row">
    <div><label>título EN</label><input id="f_ten"></div>
    <div><label>título FR</label><input id="f_tfr"></div>
    <div><label>título ES</label><input id="f_tes"></div>
  </div>
  <div class="row">
    <div><label>título IT</label><input id="f_tit"></div>
    <div><label>título DE</label><input id="f_tde"></div>
    <div></div>
  </div>
  <label>chaves PT (separadas por vírgula)</label><input id="f_cpt">
  <div class="row">
    <div><label>chaves EN</label><input id="f_cen"></div>
    <div><label>chaves FR</label><input id="f_cfr"></div>
    <div><label>chaves ES</label><input id="f_ces"></div>
  </div>
  <div class="row">
    <div><label>chaves IT</label><input id="f_cit"></div>
    <div><label>chaves DE</label><input id="f_cde"></div>
    <div></div>
  </div>
  <label>gatilhos (perguntas que trazem este verbete)</label><input id="f_gat">
  <label>corpo — em português, prosa, sem marcadores</label><textarea id="f_corpo"></textarea>
  <div class="acoes">
    <button class="btn" onclick="salvar()">salvar</button>
    <button class="btn" onclick="document.getElementById('ed').style.display='none'">cancelar</button>
    <span id="msg" style="font-size:12px;color:#666;align-self:center"></span>
  </div>
</div></div>

<script>
const g = id => document.getElementById(id);
function abrir(){ g('ed').style.display='flex'; g('msg').textContent=''; }
function novo(){
  ['f_slug','f_tpt','f_ten','f_tfr','f_tes','f_tit','f_tde','f_cpt','f_cen','f_cfr','f_ces','f_cit','f_cde','f_gat','f_corpo'].forEach(i=>g(i).value='');
  g('f_eixo').value='extra'; g('f_prio').value=0; g('f_ativo').value='true';
  g('f_slug').disabled=false; abrir();
}
async function editar(slug){
  const d = await (await fetch('/api/atendente/verbete/'+slug)).json();
  g('f_slug').value=d.slug; g('f_slug').disabled=true;
  g('f_eixo').value=d.eixo||''; g('f_prio').value=d.prioridade||0; g('f_ativo').value=String(d.ativo);
  g('f_tpt').value=d.titulo_pt||''; g('f_ten').value=d.titulo_en||''; g('f_tfr').value=d.titulo_fr||'';
  g('f_tes').value=d.titulo_es||''; g('f_tit').value=d.titulo_it||''; g('f_tde').value=d.titulo_de||'';
  g('f_cpt').value=d.chaves_pt||''; g('f_cen').value=d.chaves_en||''; g('f_cfr').value=d.chaves_fr||'';
  g('f_ces').value=d.chaves_es||''; g('f_cit').value=d.chaves_it||''; g('f_cde').value=d.chaves_de||'';
  g('f_gat').value=d.gatilhos||''; g('f_corpo').value=d.corpo||'';
  abrir();
}
async function salvar(){
  const b = { slug:g('f_slug').value.trim(), eixo:g('f_eixo').value.trim(),
    prioridade:g('f_prio').value, ativo:g('f_ativo').value==='true',
    titulo_pt:g('f_tpt').value, titulo_en:g('f_ten').value, titulo_fr:g('f_tfr').value,
    titulo_es:g('f_tes').value, titulo_it:g('f_tit').value, titulo_de:g('f_tde').value,
    chaves_pt:g('f_cpt').value, chaves_en:g('f_cen').value, chaves_fr:g('f_cfr').value,
    chaves_es:g('f_ces').value, chaves_it:g('f_cit').value, chaves_de:g('f_cde').value,
    gatilhos:g('f_gat').value, corpo:g('f_corpo').value };
  g('msg').textContent='salvando…';
  const r = await fetch('/api/atendente/verbete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  const d = await r.json();
  g('msg').textContent = d.ok ? 'salvo' : ('erro: '+(d.error||''));
  if (d.ok) setTimeout(()=>location.reload(), 600);
}
</script>
</body></html>`);
  });

  console.log("🗂️  Painel do atendente montado — /atendente");
}

module.exports = { montarAtendenteAdmin };

// server/europeana_ui.js — Importador Europeana por INSTITUIÇÃO → ENTRADA
// ─────────────────────────────────────────────────────────────────────────────
// Estratégia (do André): em vez de tratar a Europeana como um oceano, trata-se
// UMA INSTITUIÇÃO por vez. Dois passos:
//   1) LISTAR instituições (facet DATA_PROVIDER) — uma chamada, sem baixar obras.
//   2) IMPORTAR de uma instituição só as obras em DOMÍNIO PÚBLICO + CC0,
//      em segundo plano, para a Entrada (rascunho), como o commons_entrada faz.
//
// A Europeana NÃO hospeda imagens — ela aponta para o link da instituição
// (campo edmIsShownBy). Guardamos esse link como image_url. O metadado é CC0.
// Filtramos só direitos que permitem uso comercial limpo: Public Domain + CC0.
//
// COMO LIGAR (1 linha no server.js, ANTES do app.get("*")):
//     require("./europeana_ui").montarEuropeana(app, pool);
//
// PRECISA da variável de ambiente EUROPEANA_KEY no Railway.
// ─────────────────────────────────────────────────────────────────────────────

const API = "https://api.europeana.eu/record/v2/search.json";
const KEY = process.env.EUROPEANA_KEY || "";

// Só direitos que permitem uso comercial sem obrigação (Public Domain + CC0).
// A Europeana grava esses status como URLs no campo RIGHTS. Filtramos por elas.
const DIREITOS_PD = [
  'http://creativecommons.org/publicdomain/mark/1.0/',
  'http://creativecommons.org/publicdomain/zero/1.0/',
];
// query fragment: RIGHTS:("...mark..." OR "...zero...")
const QF_DIREITOS = 'RIGHTS:(' + DIREITOS_PD.map(u => `"${u}"`).join(' OR ') + ')';

// estado do trabalho em background (para o painel acompanhar)
let job = { rodando: false, instituicao: null, inseridas: 0, vistas: 0, alvo: 0, fim: null, erro: null };

async function apiGet(params, qfExtra) {
  const u = new URL(API);
  u.searchParams.set("wskey", KEY);
  for (const [k, v] of Object.entries(params)) {
    if (k === "qf ") continue; // chave-fantasma usada só para sinalizar; ignora
    u.searchParams.set(k, v);
  }
  // qf adicional: usa append (não set) para permitir múltiplos qf, que a API trata como AND
  if (qfExtra) u.searchParams.append("qf", qfExtra);
  const r = await fetch(u, { signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error("Europeana HTTP " + r.status);
  return r.json();
}

// pega o primeiro valor útil de um campo que pode vir como array ou string
function primeiro(v) {
  if (Array.isArray(v)) return v[0] || "";
  return v || "";
}

// monta uma obra a partir de um item da Search API
function mapItem(it) {
  const id = "europeana_" + (it.id || "").replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+/, "");
  const title = primeiro(it.title) || primeiro(it.dcTitleLangAware?.def) || "(sem título)";
  const artist = primeiro(it.dcCreator) || primeiro(it.edmAgentLabel) || "";
  const date = primeiro(it.year) || primeiro(it.edmTimespanLabel) || "";
  // link da imagem: edmIsShownBy (arquivo na instituição) > edmPreview (miniatura Europeana)
  const image = primeiro(it.edmIsShownBy) || primeiro(it.edmPreview) || "";
  const museum = primeiro(it.dataProvider) || primeiro(it.provider) || "Europeana";
  const ext = primeiro(it.guid) || (it.id ? "https://www.europeana.eu/item" + it.id : "");
  const rights = primeiro(it.rights) || "";
  return { id, title, artist, date, image, museum, ext, rights };
}

// Filtro "só pintura": combina o tipo de item (proxy_dc_type) em vários idiomas
// com o campo de assunto (what). Corta documento, foto, mapa, espécime, etc.
const QF_PINTURA = [
  'proxy_dc_type.en:(painting OR paintings)',
  'proxy_dc_type.pt:(pintura OR pinturas)',
  'proxy_dc_type.fr:(peinture OR peintures)',
  'proxy_dc_type.de:(Gemälde OR Malerei)',
  'proxy_dc_type.es:(pintura OR pinturas)',
  'proxy_dc_type.it:(dipinto OR dipinti OR pittura)',
  'what:painting',
].map(s => `(${s})`).join(' OR ');

async function processar(pool, instituicao, alvo, soPintura) {
  job = { rodando: true, instituicao, inseridas: 0, vistas: 0, alvo, fim: null, erro: null, soPintura: !!soPintura };
  let cursor = "*";
  try {
    while (job.inseridas < alvo) {
      const restante = Math.min(100, alvo - job.inseridas);
      const params = {
        query: "*:*",
        qf: `DATA_PROVIDER:"${instituicao}"`,
        reusability: "open",           // atalho: só conteúdo aberto (PD, CC0, CC BY, CC BY-SA)
        media: "true",                 // só com mídia
        rows: String(restante),
        cursor,
        profile: "rich",               // ESSENCIAL: traz edmIsShownBy (link do arquivo)
      };
      const d = await apiGet(params, soPintura ? QF_PINTURA : null);
      const items = d.items || [];
      if (items.length === 0) break;
      job.vistas += items.length;

      for (const it of items) {
        const rights = primeiro(it.rights) || "";
        // trava dupla: só Public Domain Mark ou CC0
        const ok = DIREITOS_PD.some(u => rights.startsWith(u.replace(/\/$/, "")) || rights === u);
        if (!ok) continue;
        const o = mapItem(it);
        if (!o.image) continue;
        try {
          await pool.query(
            `INSERT INTO artworks
               (id,source,title,artist,date,museum,image_url,external_url,ala_id,credit,status,triagem,image_cached_at)
             VALUES ($1,'europeana',$2,$3,$4,$5,$6,$7,'entrada',$8,'rascunho','',0)
             ON CONFLICT (id) DO NOTHING`,
            [o.id, o.title, o.artist, o.date, o.museum, o.image, o.ext,
             `${o.museum} · via Europeana · ${o.rights || 'Public Domain'}`]
          );
          job.inseridas++;
        } catch (e) { /* segue */ }
      }

      cursor = d.nextCursor;
      if (!cursor) break; // acabou o acervo
    }
  } catch (e) {
    job.erro = e.message;
  }
  job.rodando = false;
  job.fim = Date.now();
  console.log(`🇪🇺 Europeana [${instituicao}]: ${job.inseridas} inseridas de ${job.vistas} vistas`);
}

function montarEuropeana(app, pool) {

  // 1) LISTA de instituições (facet) — uma chamada, sem baixar obras
  app.get("/api/europeana/instituicoes", async (req, res) => {
    if (!KEY) return res.status(400).json({ error: "Falta EUROPEANA_KEY no Railway" });
    try {
      const busca = (req.query.q || "").trim();
      const d = await apiGet({
        query: "*:*",
        qf: QF_DIREITOS,            // conta só obras em domínio público / CC0
        reusability: "open",
        rows: "0",                  // não traz obra nenhuma, só os facets
        profile: "facets",
        facet: "DATA_PROVIDER",
        "f.DATA_PROVIDER.facet.limit": "2000",
      });
      let lista = (d.facets?.[0]?.fields || []).map(f => ({ nome: f.label, obras: f.count }));
      if (busca) lista = lista.filter(i => i.nome.toLowerCase().includes(busca.toLowerCase()));
      lista.sort((a, b) => b.obras - a.obras);
      res.json({ total: lista.length, instituicoes: lista.slice(0, 500) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 2) IMPORTAR uma instituição → Entrada (background)
  app.post("/api/europeana/importar", async (req, res) => {
    if (!KEY) return res.status(400).json({ error: "Falta EUROPEANA_KEY no Railway" });
    if (job.rodando) return res.status(409).json({ error: "Já há uma importação rodando", job });
    const instituicao = (req.body?.instituicao || "").trim();
    const alvo = Math.min(parseInt(req.body?.total || "500", 10) || 500, 20000);
    const soPintura = req.body?.soPintura !== false; // padrão: só pintura
    if (!instituicao) return res.status(400).json({ error: "instituicao obrigatória" });
    processar(pool, instituicao, alvo, soPintura); // não await — roda em segundo plano
    res.json({ ok: true, mensagem: `Importando até ${alvo} ${soPintura ? "pinturas" : "obras"} (Public Domain + CC0) de "${instituicao}" para a Entrada.` });
  });

  // status do trabalho
  app.get("/api/europeana/status", (req, res) => res.json(job));

  // painel
  app.get("/europeana", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Germanus — Europeana</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#e0e0e0;font-family:-apple-system,Segoe UI,sans-serif;padding:24px;max-width:1000px;margin:0 auto}
h1{font-size:20px;color:#fff}.sub{color:#666;font-size:12px;margin:4px 0 20px}a{color:#378ADD;text-decoration:none}
.bar{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
input{flex:1;min-width:200px;padding:9px 12px;border-radius:8px;border:1px solid #2a2a2a;background:#111;color:#eee;font-size:13px}
button{padding:9px 14px;border-radius:8px;border:1px solid #2a2a2a;background:#161616;color:#ccc;cursor:pointer;font-size:12px}
button.go{background:#1D9E7522;border-color:#1D9E7555;color:#5fd6a8}
table{width:100%;border-collapse:collapse;font-size:13px}
td,th{padding:8px 10px;border-bottom:1px solid #1c1c1c;text-align:left}
th{color:#888;font-weight:600;font-size:11px;text-transform:uppercase}
tr:hover{background:#141414}
.n{color:#5fd6a8;font-variant-numeric:tabular-nums}
.imp{padding:5px 10px;font-size:11px}
#status{margin:14px 0;padding:12px;border-radius:8px;background:#111;border:1px solid #222;font-size:12px;display:none}
.prog{height:6px;background:#1c1c1c;border-radius:3px;overflow:hidden;margin-top:8px}
.prog>div{height:100%;background:#1D9E75;width:0;transition:width .4s}
</style></head><body>
<h1>GERMANUS.Art — Europeana por Instituição</h1>
<p class="sub"><a href="/banco">← banco</a> · <a href="/curadoria">curadoria</a> · importa só <b>Domínio Público + CC0</b> · uma instituição por vez → Entrada</p>

<div id="status"></div>

<div class="bar">
  <input id="q" placeholder="Filtrar instituições (ex.: Rijksmuseum, Nationalmuseum...)" onkeydown="if(event.key==='Enter')carregar()">
  <button class="go" onclick="carregar()">🔍 Listar instituições</button>
</div>
<label style="display:flex;align-items:center;gap:8px;margin:-6px 0 16px;font-size:13px;color:#aaa;cursor:pointer">
  <input type="checkbox" id="soPintura" checked style="width:16px;height:16px;cursor:pointer">
  Importar <b style="color:#5fd6a8">só pinturas</b> (corta documentos, fotos, mapas, gravuras) — recomendado para as ecobags
</label>

<table><thead><tr><th>Instituição</th><th>Obras (PD+CC0)</th><th></th></tr></thead>
<tbody id="lista"><tr><td colspan="3" style="color:#666">Clique em "Listar instituições" para começar.</td></tr></tbody></table>

<script>
async function carregar(){
  const q = document.getElementById('q').value.trim();
  document.getElementById('lista').innerHTML = '<tr><td colspan="3" style="color:#666">Carregando...</td></tr>';
  try{
    const d = await (await fetch('/api/europeana/instituicoes'+(q?('?q='+encodeURIComponent(q)):''))).json();
    if(d.error){ document.getElementById('lista').innerHTML='<tr><td colspan=3 style="color:#e88">'+d.error+'</td></tr>'; return; }
    document.getElementById('lista').innerHTML = (d.instituicoes||[]).map(function(i){
      return '<tr><td>'+i.nome+'</td><td class="n">'+i.obras.toLocaleString('pt-BR')+'</td>'+
      '<td><button class="imp go" onclick="importar(this,\\''+i.nome.replace(/'/g,"\\\\'")+'\\')">Importar →</button></td></tr>';
    }).join('') || '<tr><td colspan=3 style="color:#666">Nada encontrado.</td></tr>';
  }catch(e){ document.getElementById('lista').innerHTML='<tr><td colspan=3 style="color:#e88">Erro: '+e.message+'</td></tr>'; }
}
async function importar(btn, nome){
  var so = document.getElementById('soPintura').checked;
  const total = prompt('Quantas '+(so?'pinturas':'obras')+' (Público+CC0) importar de "'+nome+'"? (máx 20000)', '500');
  if(total===null) return;
  btn.disabled = true; btn.textContent = 'enviando...';
  const d = await (await fetch('/api/europeana/importar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instituicao:nome,total:parseInt(total,10),soPintura:so})})).json();
  if(d.error){ alert(d.error); btn.disabled=false; btn.textContent='Importar →'; return; }
  acompanhar();
}
async function acompanhar(){
  const box = document.getElementById('status'); box.style.display='block';
  const t = setInterval(async ()=>{
    const j = await (await fetch('/api/europeana/status')).json();
    const pct = j.alvo ? Math.round(100*j.inseridas/j.alvo) : 0;
    box.innerHTML = '<b>'+(j.instituicao||'')+'</b> — '+j.inseridas+' inseridas · '+j.vistas+' vistas'+
      (j.erro?(' · <span style="color:#e88">'+j.erro+'</span>'):'')+
      '<div class="prog"><div style="width:'+pct+'%"></div></div>'+
      (j.rodando?'':'<div style="color:#5fd6a8;margin-top:6px">✓ concluído — veja em <a href="/curadoria">Entrada</a></div>');
    if(!j.rodando){ clearInterval(t); }
  }, 1500);
}
</script>
</body></html>`);
  });

  console.log("🇪🇺 Europeana montada — /europeana" + (KEY ? "" : "  ⚠️ FALTA EUROPEANA_KEY"));
}

module.exports = { montarEuropeana };

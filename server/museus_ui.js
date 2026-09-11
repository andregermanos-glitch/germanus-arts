// server/museus_ui.js — Importador Met + AIC + Cleveland → ENTRADA
// ─────────────────────────────────────────────────────────────────────────────
// Mesma lógica do europeana_ui.js: job em segundo plano, entrada como rascunho,
// painel com barra de progresso. A diferença é o eixo: a Europeana é agregadora,
// então lá se escolhe a INSTITUIÇÃO; aqui cada fonte é um museu só, então se
// escolhe o TERMO de busca.
//
// Cada museu declara domínio público no próprio registro, e é esse campo que
// filtramos — a cadeia institucional de que falamos: curta e com responsável.
//   Met       → isPublicDomain=true  + classification contendo "Painting"
//   AIC       → is_public_domain=true + artwork_type_title = "Painting"
//   Cleveland → cc0=1 + type=Painting
//
// Nenhum dos três pede chave de API.
//
// COMO LIGAR (1 linha no server.js, ANTES do app.get("*")):
//     require("./museus_ui").montarMuseus(app, pool);
// ─────────────────────────────────────────────────────────────────────────────

const UA = "GermanusArt/1.0 (https://germanus.art; contato@germanus.art)";

let job = { rodando:false, fonte:null, termo:null, alvo:0, vistas:0, pintura_ok:0,
            inseridas:0, duplicadas:0, erro:null, sql_erro:null, fim:null };

const pausa = ms => new Promise(r => setTimeout(r, ms));

async function pegar(url, timeout = 20000) {
  const r = await fetch(url, { headers:{ "User-Agent":UA, "Accept":"application/json" },
                               signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// ─── Gravação (mesmo insert do europeana_ui) ─────────────────────────────────
async function gravar(pool, o) {
  try {
    const r = await pool.query(
      `INSERT INTO artworks
         (id,source,title,artist,date,medium,dimensions,origin,museum,description,
          image_url,external_url,ala_id,credit,status,triagem,image_cached_at,indexed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'entrada',$13,'rascunho','',0,
               EXTRACT(EPOCH FROM NOW())::BIGINT)
       ON CONFLICT (id) DO UPDATE SET indexed_at = EXTRACT(EPOCH FROM NOW())::BIGINT
         WHERE COALESCE(artworks.status,'publicada') = 'rascunho'`,
      [o.id, o.source, o.title, o.artist, o.date, o.medium || "", o.dimensions || "",
       o.origin || "", o.museum, o.description || "", o.image, o.ext || "", o.credit]);
    if (r.rowCount > 0) job.inseridas++; else job.duplicadas++;
  } catch (e) { job.sql_erro = e.message; }
}

// ─── Met ─────────────────────────────────────────────────────────────────────
// A busca devolve só IDs; a ficha vem numa chamada por obra. É a mais lenta das
// três, e também a de metadado mais completo.
async function importarMet(pool, termo, alvo) {
  const busca = `https://collectionapi.metmuseum.org/public/collection/v1/search`
    + `?q=${encodeURIComponent(termo)}&hasImages=true&isPublicDomain=true&medium=Paintings`;
  const d = await pegar(busca);
  const ids = (d.objectIDs || []).slice(0, alvo * 3);

  for (const id of ids) {
    if (job.inseridas >= alvo) break;
    job.vistas++;
    let o = null;
    try {
      o = await pegar(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, 12000);
    } catch { await pausa(400); continue; }

    const classif = (o?.classification || "") + " " + (o?.objectName || "");
    if (!o?.isPublicDomain) { await pausa(250); continue; }
    if (!/painting/i.test(classif)) { await pausa(250); continue; }
    const img = o.primaryImage || o.primaryImageSmall;
    if (!img) { await pausa(250); continue; }
    job.pintura_ok++;

    await gravar(pool, {
      id: "met_" + o.objectID, source: "met",
      title: o.title || "(sem título)", artist: o.artistDisplayName || "",
      date: o.objectDate || "", medium: o.medium || "", dimensions: o.dimensions || "",
      origin: o.country || o.culture || "",
      museum: "The Metropolitan Museum of Art, Nova York, EUA",
      description: "", image: img, ext: o.objectURL || "",
      credit: `${o.creditLine || "The Metropolitan Museum of Art"} · Domínio público (Met Open Access)`,
    });
    await pausa(250); // ritmo educado
  }
}

// ─── Art Institute of Chicago ────────────────────────────────────────────────
// Uma chamada traz tudo, com paginação. Entrega IIIF, que o toHd() do server.js
// já sabe transformar em alta resolução para o zoom.
async function importarAIC(pool, termo, alvo) {
  const campos = "id,title,artist_display,date_display,medium_display,dimensions,"
    + "place_of_origin,image_id,credit_line,artwork_type_title,is_public_domain";
  let page = 1;

  while (job.inseridas < alvo && page <= 30) {
    const url = `https://api.artic.edu/api/v1/artworks/search`
      + `?q=${encodeURIComponent(termo)}&fields=${campos}&limit=100&page=${page}`;
    let d;
    try { d = await pegar(url); } catch { break; }
    const itens = d.data || [];
    if (!itens.length) break;
    job.vistas += itens.length;

    for (const o of itens) {
      if (job.inseridas >= alvo) break;
      if (!o.is_public_domain) continue;
      if (!/painting/i.test(o.artwork_type_title || "")) continue;
      if (!o.image_id) continue;
      job.pintura_ok++;

      await gravar(pool, {
        id: "aic_" + o.id, source: "aic",
        title: o.title || "(sem título)", artist: o.artist_display || "",
        date: o.date_display || "", medium: o.medium_display || "",
        dimensions: o.dimensions || "", origin: o.place_of_origin || "",
        museum: "Art Institute of Chicago, Illinois, EUA", description: "",
        image: `https://www.artic.edu/iiif/2/${o.image_id}/full/843,/0/default.jpg`,
        ext: `https://www.artic.edu/artworks/${o.id}`,
        credit: `${o.credit_line || "Art Institute of Chicago"} · Domínio público (CC0)`,
      });
    }
    page++;
    await pausa(600);
  }
}

// ─── Cleveland ───────────────────────────────────────────────────────────────
// Acervo menor e muito bem digitalizado. cc0=1 já garante uso comercial livre.
async function importarCleveland(pool, termo, alvo) {
  let skip = 0;

  while (job.inseridas < alvo && skip < 3000) {
    const url = `https://openaccess-api.clevelandart.org/api/artworks/`
      + `?q=${encodeURIComponent(termo)}&type=Painting&cc0=1&has_image=1&limit=100&skip=${skip}`;
    let d;
    try { d = await pegar(url); } catch { break; }
    const itens = d.data || [];
    if (!itens.length) break;
    job.vistas += itens.length;

    for (const o of itens) {
      if (job.inseridas >= alvo) break;
      const img = o.images?.web?.url || o.images?.print?.url;
      if (!img) continue;
      job.pintura_ok++;

      await gravar(pool, {
        id: "cleveland_" + o.id, source: "cleveland",
        title: o.title || "(sem título)",
        artist: o.creators?.[0]?.description || "",
        date: o.creation_date || "", medium: o.technique || "",
        dimensions: "", origin: o.culture?.[0] || "",
        museum: "Cleveland Museum of Art, Ohio, EUA",
        description: (o.description || "").replace(/<[^>]+>/g, ""),
        image: img, ext: o.url || `https://www.clevelandart.org/art/${o.id}`,
        credit: `${o.creditline || "Cleveland Museum of Art"} · CC0`,
      });
    }
    skip += 100;
    await pausa(600);
  }
}

// ─── Orquestração ────────────────────────────────────────────────────────────
async function processar(pool, fonte, termo, alvo) {
  job = { rodando:true, fonte, termo, alvo, vistas:0, pintura_ok:0,
          inseridas:0, duplicadas:0, erro:null, sql_erro:null, fim:null };
  try {
    if (fonte === "met")            await importarMet(pool, termo, alvo);
    else if (fonte === "aic")       await importarAIC(pool, termo, alvo);
    else if (fonte === "cleveland") await importarCleveland(pool, termo, alvo);
    else job.erro = "fonte desconhecida";
  } catch (e) { job.erro = e.message; }
  job.rodando = false;
  job.fim = Date.now();
  console.log(`🏛️  ${fonte} [${termo}]: ${job.inseridas} inseridas de ${job.vistas} vistas`);
}

function montarMuseus(app, pool) {

  app.post("/api/museus/importar", async (req, res) => {
    if (job.rodando) return res.status(409).json({ error:"Já há uma importação rodando", job });
    const fonte = String(req.body?.fonte || "").trim();
    const termo = String(req.body?.termo || "").trim();
    const alvo  = Math.min(parseInt(req.body?.total || "200", 10) || 200, 5000);
    if (!["met","aic","cleveland"].includes(fonte))
      return res.status(400).json({ error:"fonte deve ser met, aic ou cleveland" });
    if (!termo) return res.status(400).json({ error:"termo obrigatório" });
    processar(pool, fonte, termo, alvo);   // sem await: roda em segundo plano
    res.json({ ok:true, mensagem:`Importando até ${alvo} pinturas de "${termo}" (${fonte}) para a Entrada.` });
  });

  app.get("/api/museus/status", (req, res) => res.json(job));

  app.get("/api/museus/no-banco", async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT source,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE COALESCE(status,'publicada')='rascunho')::int AS na_entrada,
               COUNT(*) FILTER (WHERE COALESCE(status,'publicada')='publicada')::int AS publicadas
          FROM artworks WHERE source IN ('met','aic','cleveland')
         GROUP BY source ORDER BY source`);
      res.json({ fontes: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Painel ──────────────────────────────────────────────────────────────
  app.get("/museus", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Germanus — Museus</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#e0e0e0;font-family:-apple-system,Segoe UI,sans-serif;padding:24px;max-width:1000px;margin:0 auto}
h1{font-size:20px;color:#fff}.sub{color:#666;font-size:12px;margin:4px 0 20px}a{color:#378ADD;text-decoration:none}
.fontes{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.fonte{flex:1;min-width:220px;background:#111;border:1px solid #222;border-radius:10px;padding:14px;cursor:pointer}
.fonte.on{border-color:#1D9E75;background:#1D9E7512}
.fonte h3{font-size:14px;color:#fff;margin-bottom:4px}
.fonte p{font-size:11px;color:#666;line-height:1.45}
.bar{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap}
input{flex:1;min-width:200px;padding:9px 12px;border-radius:8px;border:1px solid #2a2a2a;background:#111;color:#eee;font-size:13px}
button{padding:9px 14px;border-radius:8px;border:1px solid #2a2a2a;background:#161616;color:#ccc;cursor:pointer;font-size:12px}
button.go{background:#1D9E7522;border-color:#1D9E7555;color:#5fd6a8}
.sug{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px}
.sug button{font-size:11px;padding:5px 10px;background:#141414}
#status{margin:14px 0;padding:12px;border-radius:8px;background:#111;border:1px solid #222;font-size:12px;display:none}
.prog{height:6px;background:#1c1c1c;border-radius:3px;overflow:hidden;margin-top:8px}
.prog>div{height:100%;background:#1D9E75;width:0;transition:width .4s}
</style></head><body>
<h1>GERMANUS.Art — Met · AIC · Cleveland</h1>
<p class="sub"><a href="/banco">← banco</a> · <a href="/curadoria">curadoria</a> · <a href="/europeana">europeana</a> · só <b>pintura em domínio público</b> → Entrada</p>

<div class="fontes">
  <div class="fonte on" id="f_met" onclick="escolher('met')">
    <h3>Metropolitan</h3><p>Metadado mais completo. Uma chamada por obra, então é a mais lenta — importe em blocos menores.</p></div>
  <div class="fonte" id="f_aic" onclick="escolher('aic')">
    <h3>Art Institute of Chicago</h3><p>A mais rápida, e entrega IIIF — o zoom em alta resolução já funciona.</p></div>
  <div class="fonte" id="f_cleveland" onclick="escolher('cleveland')">
    <h3>Cleveland</h3><p>Acervo menor, muito bem digitalizado. Tudo CC0, uso comercial livre.</p></div>
</div>

<div class="bar">
  <input id="termo" placeholder="Termo de busca em inglês (ex.: portrait, still life, landscape)" onkeydown="if(event.key==='Enter')importar()">
  <button class="go" onclick="importar()">Importar →</button>
</div>

<div class="sug">
  <button onclick="usar('portrait')">portrait</button>
  <button onclick="usar('still life')">still life</button>
  <button onclick="usar('landscape')">landscape</button>
  <button onclick="usar('interior')">interior</button>
  <button onclick="usar('religious')">religious</button>
  <button onclick="usar('mythology')">mythology</button>
  <button onclick="usar('architecture')">architecture</button>
  <button onclick="usar('sunlight')">sunlight</button>
  <button onclick="usar('impressionism')">impressionism</button>
  <button onclick="usar('women artists')">women artists</button>
</div>

<div id="status"></div>

<script>
var fonte = 'met';
function escolher(f){
  fonte = f;
  ['met','aic','cleveland'].forEach(function(x){
    document.getElementById('f_'+x).className = 'fonte' + (x===f ? ' on' : '');
  });
}
function usar(t){ document.getElementById('termo').value = t; }
async function importar(){
  var termo = document.getElementById('termo').value.trim();
  if(!termo) return alert('Escreva um termo de busca.');
  var total = prompt('Quantas pinturas importar de "'+termo+'" ('+fonte+')? (máx 5000)', '200');
  if(total===null) return;
  var d = await (await fetch('/api/museus/importar',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({fonte:fonte, termo:termo, total:parseInt(total,10)})})).json();
  if(d.error){ alert(d.error); return; }
  acompanhar();
}
async function acompanhar(){
  var box = document.getElementById('status'); box.style.display='block';
  var t = setInterval(async function(){
    var j = await (await fetch('/api/museus/status')).json();
    var pct = j.alvo ? Math.round(100*j.inseridas/j.alvo) : 0;
    box.innerHTML = '<b>'+(j.fonte||'')+' — '+(j.termo||'')+'</b><br>'+
      j.inseridas+' inseridas · '+j.vistas+' vistas · '+j.pintura_ok+' pinturas PD · '+(j.duplicadas||0)+' duplicadas'+
      (j.erro?(' · <span style="color:#e88">'+j.erro+'</span>'):'')+
      (j.sql_erro?(' · <span style="color:#e88">SQL: '+j.sql_erro+'</span>'):'')+
      '<div class="prog"><div style="width:'+pct+'%"></div></div>'+
      (j.rodando?'':'<div style="color:#5fd6a8;margin-top:6px">✓ concluído — veja em <a href="/curadoria?ala=entrada&offset=0">Entrada</a></div>');
    if(!j.rodando) clearInterval(t);
  }, 1500);
}
</script>
</body></html>`);
  });

  console.log("🏛️  Museus montado — /museus (Met, AIC, Cleveland)");
}

module.exports = { montarMuseus };

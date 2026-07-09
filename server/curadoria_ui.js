// server/curadoria_ui.js — Painel de Curadoria do GERMANUS.Art
// ─────────────────────────────────────────────────────────────────────────────
// Página /curadoria: inspeciona o conteúdo de cada ala (18 obras por página,
// Anterior/Próxima) + a aba ENTRADA (staging: obras importadas, invisíveis no
// site). Duas funções em lote:
//   1. Arquivar  — tira da galeria (status='arquivada'); NÃO apaga; reversível.
//   2. Mover     — muda de ala (ala_id) E publica (status='publicada') + curado=TRUE.
//                  É assim que você tira uma obra da ENTRADA para uma ala real.
//
// Estados (coluna status):
//   'rascunho'  → na ENTRADA, invisível no site (importações entram assim)
//   'publicada' → distribuída numa ala, visível no site
//   'arquivada' → retirada da galeria, fica no banco
//
// COMO LIGAR (1 linha no server.js, ANTES do app.get("*")):
//     require("./curadoria_ui").montarCuradoria(app, pool);
// ─────────────────────────────────────────────────────────────────────────────

const LIMIT = 18;

const ALA_LABEL = {
  retratos: "Retratos", pessoas_reais: "Personnages", historico: "Histoire",
  perspectiva: "Perspective", objetos: "Objets", lugares: "Lieux",
  natureza: "Nature", familiar: "Familiale", nudes: "Nus",
  esoterico: "Ésotérisme", sacro: "Sacré", arquitetura: "Architecture",
  povo: "Peuple", luz_sol: "Lumière", cores: "Couleurs",
  cidades: "Émotion", fase: "Psyché", femininas: "Féminines"
};
const ORDER = [
  "retratos", "pessoas_reais", "historico", "perspectiva", "objetos",
  "lugares", "natureza", "familiar", "nudes", "esoterico", "sacro",
  "arquitetura", "povo", "luz_sol", "cores", "cidades", "fase", "femininas"
];
const ALAS_VALIDAS = new Set(ORDER); // destinos válidos para mover

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function toHd(url) {
  if (!url) return url;
  if (url.includes("artic.edu/iiif")) return url.replace(/\/full\/[^/]+\//, "/full/843,/");
  if (url.includes("upload.wikimedia.org") && url.includes("/thumb/")) return url.replace(/\/\d+px-/, "/800px-");
  return url;
}

function montarCuradoria(app, pool) {
  // Migração idempotente das colunas editoriais
  (async () => {
    try {
      await pool.query(`ALTER TABLE artworks ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'publicada'`);
      await pool.query(`ALTER TABLE artworks ADD COLUMN IF NOT EXISTS curado BOOLEAN DEFAULT FALSE`);
      console.log("🎛️  Curadoria — colunas status/curado prontas");
    } catch (e) { console.log("🎛️  Curadoria — migração:", e.message); }
  })();

  // ── Arquivar em lote ───────────────────────────────────────────────────────
  app.post("/api/curadoria/arquivar", async (req, res) => {
    try {
      const ids = (req.body?.ids || []).map(s => String(s).trim()).filter(Boolean);
      if (!ids.length) return res.status(400).json({ error: "Envie { ids: [...] }" });
      const r = await pool.query(
        `UPDATE artworks SET status='arquivada', curado=TRUE WHERE id = ANY($1::text[])`, [ids]);
      res.json({ ok: true, arquivadas: r.rowCount, pedidas: ids.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Restaurar em lote ──────────────────────────────────────────────────────
  app.post("/api/curadoria/restaurar", async (req, res) => {
    try {
      const ids = (req.body?.ids || []).map(s => String(s).trim()).filter(Boolean);
      if (!ids.length) return res.status(400).json({ error: "Envie { ids: [...] }" });
      const r = await pool.query(
        `UPDATE artworks SET status='publicada' WHERE id = ANY($1::text[])`, [ids]);
      res.json({ ok: true, restauradas: r.rowCount });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Mover em lote (publica ao mover para uma ala real) ─────────────────────
  app.post("/api/curadoria/mover", async (req, res) => {
    try {
      const movs = req.body?.movimentos || [];
      if (!Array.isArray(movs) || !movs.length)
        return res.status(400).json({ error: "Envie { movimentos: [{id, ala}] }" });
      let movidas = 0; const erros = [];
      for (const m of movs) {
        const id  = String(m.id || "").trim();
        const ala = String(m.ala || "").trim();
        if (!id || !ALAS_VALIDAS.has(ala)) { erros.push({ ...m, motivo: "id vazio ou ala inválida" }); continue; }
        const r = await pool.query(
          `UPDATE artworks SET ala_id=$2, status='publicada', curado=TRUE WHERE id=$1`, [id, ala]);
        if (r.rowCount) movidas++; else erros.push({ id, ala, motivo: "id não encontrado" });
      }
      res.json({ ok: true, movidas, erros });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Página visual ──────────────────────────────────────────────────────────
  app.get("/curadoria", async (req, res) => {
    try {
      const reqAla   = req.query.ala || "retratos";
      const isEntrada = (reqAla === "entrada");
      const ala      = isEntrada ? "entrada" : (ALAS_VALIDAS.has(reqAla) ? reqAla : "retratos");
      const offset   = Math.max(0, parseInt(req.query.offset || "0", 10) || 0);

      // Filtro: ENTRADA mostra rascunhos (qualquer ala); ala real mostra publicadas
      let filtro, params;
      if (isEntrada) {
        filtro = `image_url IS NOT NULL AND image_url<>'' AND COALESCE(status,'publicada')='rascunho'`;
        params = [];
      } else {
        filtro = `ala_id=$1 AND image_url IS NOT NULL AND image_url<>'' AND COALESCE(status,'publicada')='publicada'`;
        params = [ala];
      }

      const ct = await pool.query(`SELECT COUNT(*) AS n FROM artworks WHERE ${filtro}`, params);
      const total = parseInt(ct.rows[0].n, 10);

      const r = await pool.query(
        `SELECT id,title,artist,date,museum,description,image_url,ala_id,
                wiki_en,wiki_fr,wiki_es,wiki_it, COALESCE(curado,false) AS curado
           FROM artworks WHERE ${filtro}
          ORDER BY (image_url LIKE '%r2.dev%' OR image_url LIKE '%r2.cloudflarestorage%') DESC, indexed_at DESC
          LIMIT ${LIMIT} OFFSET ${offset}`,
        params
      );

      // contagem da entrada (para o badge do botão)
      const ent = await pool.query(`SELECT COUNT(*) AS n FROM artworks WHERE COALESCE(status,'publicada')='rascunho'`);
      const nEntrada = parseInt(ent.rows[0].n, 10);

      const pagina    = Math.floor(offset / LIMIT) + 1;
      const totalPags = Math.max(1, Math.ceil(total / LIMIT));
      const temAnt    = offset > 0;
      const temProx   = offset + LIMIT < total;

      const btnEntrada = `<a href="/curadoria?ala=entrada&offset=0"
        style="display:inline-block;padding:6px 12px;border-radius:8px;font-size:12px;text-decoration:none;
               border:1px solid ${isEntrada ? "#BA7517" : "#3a2e15"};
               background:${isEntrada ? "#BA751722" : "#1a1408"};
               color:${isEntrada ? "#e0a23a" : "#BA7517"}">📥 Entrada${nEntrada ? ` (${nEntrada})` : ""}</a>`;

      const botoes = btnEntrada + ORDER.map(a => {
        const ativo = (a === ala && !isEntrada);
        return `<a href="/curadoria?ala=${a}&offset=0"
                  style="display:inline-block;padding:6px 12px;border-radius:8px;font-size:12px;text-decoration:none;
                         border:1px solid ${ativo ? "#1D9E75" : "#2a2a2a"};
                         background:${ativo ? "#1D9E7522" : "#141414"};
                         color:${ativo ? "#1D9E75" : "#aaa"}">${esc(ALA_LABEL[a])}</a>`;
      }).join("");

      const cards = r.rows.map(o => {
        const img  = esc(toHd(o.image_url));
        const desc = (o.description || o.wiki_en || o.wiki_fr || o.wiki_es || o.wiki_it || "").replace(/<[^>]+>/g, "").trim();
        const descCurta = desc.length > 240 ? desc.slice(0, 240) + "…" : desc;
        const meta = [o.artist, o.date].filter(Boolean).map(esc).join(" · ");
        const tagAla = isEntrada && o.ala_id ? `<span style="color:#BA7517">${esc(o.ala_id)}</span>` : "";
        return `<div class="card">
          <div class="thumb"><img src="${img}" loading="lazy" alt="${esc(o.title)}"
               onerror="this.parentElement.classList.add('err')"></div>
          <div class="info">
            <div class="t">${esc(o.title) || "<i>sem título</i>"}</div>
            <div class="m">${meta}</div>
            ${o.museum ? `<div class="mu">${esc(o.museum)}</div>` : ""}
            ${descCurta ? `<div class="d" title="${esc(desc)}">${esc(descCurta)}</div>` : `<div class="d vazio">sem descrição</div>`}
            <div class="id" onclick="copiarId('${esc(o.id)}')" title="clique para copiar o ID">
              ${esc(o.id)} ${o.curado ? "· <span style='color:#1D9E75'>curado</span>" : ""} ${tagAla}
            </div>
            <div class="acoes">
              <button onclick="addArquivar('${esc(o.id)}')">⊘ arquivar</button>
              <button onclick="addMover('${esc(o.id)}')">⇄ mover</button>
            </div>
          </div>
        </div>`;
      }).join("");

      const tituloAba = isEntrada ? "📥 Entrada (rascunhos para organizar)" : esc(ALA_LABEL[ala]);

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`<!DOCTYPE html>
<html lang="pt"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GERMANUS.Art — Curadoria</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;max-width:1200px;margin:0 auto}
h1{font-size:20px;color:#fff;margin-bottom:4px}
.sub{color:#555;font-size:12px;margin-bottom:18px}
.alas{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px}
.nav{display:flex;align-items:center;gap:14px;margin-bottom:18px}
.nav a,.nav span{font-size:13px}
.nav a{color:#378ADD;text-decoration:none;padding:6px 14px;border:1px solid #2a2a2a;border-radius:8px}
.nav a:hover{background:#141414}
.nav .off{color:#444;border-color:#1a1a1a;pointer-events:none}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-bottom:28px}
.card{background:#121212;border:1px solid #222;border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.thumb{height:150px;background:#1a1a1a;display:flex;align-items:center;justify-content:center}
.thumb img{width:100%;height:100%;object-fit:cover}
.card.err .thumb::after{content:"imagem indisponível";color:#555;font-size:11px}
.card.err .thumb img{display:none}
.info{padding:10px 11px;display:flex;flex-direction:column;gap:3px;flex:1}
.info .t{font-size:13px;color:#fff;font-weight:500;line-height:1.2}
.info .m{font-size:11px;color:#999}
.info .mu{font-size:10px;color:#666}
.info .d{font-size:10px;color:#888;line-height:1.35;margin-top:2px}
.info .d.vazio{color:#444;font-style:italic}
.info .id{font-family:ui-monospace,monospace;font-size:10px;color:#555;cursor:pointer;word-break:break-all;margin-top:6px;padding:4px 6px;background:#0d0d0d;border-radius:5px}
.info .id:hover{color:#378ADD;background:#101418}
.acoes{display:flex;gap:6px;margin-top:6px}
.acoes button{flex:1;font-size:10px;padding:5px;border-radius:6px;border:1px solid #2a2a2a;background:#161616;color:#aaa;cursor:pointer}
.acoes button:hover{background:#1d1d1d;color:#fff}
.boxes{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:10px}
.box{background:#101010;border:1px solid #222;border-radius:10px;padding:14px}
.box h3{font-size:12px;color:#ccc;margin-bottom:4px}
.box p{font-size:10px;color:#666;margin-bottom:8px;line-height:1.4}
.box textarea{width:100%;height:120px;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:6px;color:#ddd;font-family:ui-monospace,monospace;font-size:11px;padding:8px;resize:vertical}
.box button.go{margin-top:8px;width:100%;padding:9px;border-radius:7px;border:none;font-size:12px;font-weight:500;cursor:pointer}
.box .go.arq{background:#E24B4A22;color:#E24B4A;border:1px solid #E24B4A55}
.box .go.mov{background:#534AB722;color:#9b91ff;border:1px solid #534AB755}
.box button.go:hover{filter:brightness(1.3)}
@media(max-width:700px){.boxes{grid-template-columns:1fr}}
a.voltar{color:#555;font-size:12px;text-decoration:none}a.voltar:hover{color:#aaa}
.import{background:#120d04;border:1px solid #3a2e15;border-radius:10px;padding:12px 14px;margin-bottom:16px}
.import-label{font-size:12px;color:#e0a23a;display:block;margin-bottom:8px}
.import-btns{display:flex;flex-wrap:wrap;gap:6px}
.import-btns button{font-size:12px;padding:6px 12px;border-radius:7px;border:1px solid #BA751755;background:#BA751718;color:#e0a23a;cursor:pointer}
.import-btns button:hover{background:#BA751733;color:#fff}
.import-status{font-size:11px;color:#aaa;margin-top:10px;min-height:14px}
</style></head><body>

<h1>GERMANUS.Art — Curadoria</h1>
<p class="sub"><a class="voltar" href="/banco">← painel do banco</a> &nbsp;·&nbsp; vendo: <b style="color:#1D9E75">${tituloAba}</b> &nbsp;·&nbsp; ${total} obras</p>

<div class="import">
  <span class="import-label">📥 Importar bloco de movimento para a Entrada:</span>
  <div class="import-btns">
    <button onclick="importar('impressionismo')">Impressionismo</button>
    <button onclick="importar('cubismo')">Cubismo</button>
    <button onclick="importar('surrealismo')">Surrealismo</button>
    <button onclick="importar('fauvismo')">Fauvismo</button>
    <button onclick="importar('pop_art')">Pop Art</button>
    <button onclick="importar('abstracionismo')">Abstracionismo</button>
    <button onclick="importar('vanguarda')">Vanguarda</button>
  </div>
  <div id="importStatus" class="import-status"></div>
</div>

<div class="import import-commons">
  <span class="import-label">📥 Importar do Wikimedia Commons → Entrada (milhares, em 2º plano):</span>
  <div class="import-btns">
    <button onclick="impCommons('Portrait paintings')">Retratos</button>
    <button onclick="impCommons('Still-life paintings')">Naturezas-mortas</button>
    <button onclick="impCommons('Landscape paintings')">Paisagens</button>
    <button onclick="impCommons('Religious paintings')">Sacro</button>
    <button onclick="impCommons('Nude paintings')">Nus</button>
    <button onclick="impCommons('History paintings')">Histórico</button>
    <button onclick="impCommons('Genre paintings')">Cotidiano</button>
    <button onclick="impCommons('Impressionist paintings')">Impressionismo</button>
    <button onclick="impCommons('')">Outra categoria…</button>
  </div>
  <div id="commonsStatus" class="import-status"></div>
</div>

<div class="alas">${botoes}</div>

<div class="nav">
  ${temAnt ? `<a href="/curadoria?ala=${ala}&offset=${offset - LIMIT}">← Anterior</a>` : `<a class="off">← Anterior</a>`}
  <span style="color:#888">página
    <input id="pgInput" type="number" min="1" max="${totalPags}" value="${pagina}"
      style="width:56px;padding:3px 6px;border-radius:6px;border:1px solid #333;background:#111;color:#eee;text-align:center;font-size:13px"
      onkeydown="if(event.key==='Enter'){irPagina()}">
    de ${totalPags}</span>
  <button onclick="irPagina()" style="padding:4px 12px;border-radius:6px;border:1px solid #378ADD55;background:#378ADD22;color:#8bc0f5;cursor:pointer;font-size:12px">ir →</button>
  ${temProx ? `<a href="/curadoria?ala=${ala}&offset=${offset + LIMIT}">Próxima →</a>` : `<a class="off">Próxima →</a>`}
</div>
<script>
function irPagina(){
  var el = document.getElementById('pgInput');
  var p = parseInt(el.value, 10);
  var max = ${totalPags};
  if(!p || p < 1) p = 1;
  if(p > max) p = max;
  var off = (p - 1) * ${LIMIT};
  location.href = "/curadoria?ala=${ala}&offset=" + off;
}
</script>

<div class="grid">${cards || '<p style="color:#555">Nenhuma obra aqui.</p>'}</div>

<div class="boxes">
  <div class="box">
    <h3>⊘ Arquivar (tirar da galeria)</h3>
    <p>Um ID por linha. Sai do site mas fica no banco (reversível). Use o botão "arquivar" dos cards.</p>
    <textarea id="boxArquivar" placeholder="wikidata_Q12418&#10;commons_12345678"></textarea>
    <button class="go arq" onclick="enviarArquivar()">Arquivar listadas</button>
  </div>
  <div class="box">
    <h3>⇄ Mover para uma ala (publica)</h3>
    <p>Uma linha por obra: <b>ID&nbsp;ala</b> (ex.: <code>wikidata_Q123 cores</code>). Tirar da Entrada publica a obra. Alas: ${ORDER.join(", ")}.</p>
    <textarea id="boxMover" placeholder="wikidata_Q12418 cores&#10;commons_999 perspectiva"></textarea>
    <button class="go mov" onclick="enviarMover()">Mover listadas</button>
  </div>
</div>

<script>
function copiarId(id){ navigator.clipboard?.writeText(id); }
async function impCommons(categoria){
  if(!categoria){
    categoria = prompt("Nome EXATO da categoria do Commons (em inglês, sem 'Category:').\\nEx.: Baroque paintings, Cubist paintings, Marine art", "");
    if(!categoria) return;
  }
  const total = prompt("Quantas obras de \\""+categoria+"\\" puxar para a Entrada? (ex.: 1000, 3000, 5000)", "2000");
  if(total===null) return;
  const n = parseInt(total,10);
  if(!n||n<1) return alert("Número inválido.");
  const st = document.getElementById('commonsStatus');
  st.textContent = "⏳ Iniciando carga de \\""+categoria+"\\" (até "+n+")... isso roda em segundo plano.";
  try{
    const r = await fetch("/api/commons/entrada",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({categoria, total:n})});
    const d = await r.json();
    if(d.ok){ st.innerHTML = "✅ "+d.mensagem+" <a href='/curadoria?ala=entrada&offset=0' style='color:#e0a23a'>→ ver Entrada</a>"; }
    else { st.textContent = "❌ "+(d.error||"erro"); }
  }catch(e){ st.textContent = "❌ Falha ao iniciar: "+e.message; }
}
async function importar(movimento){
  const total = prompt("Quantas obras de "+movimento+" puxar para a Entrada? (ex.: 500, 1000, 2000)", "1000");
  if(total===null) return;
  const n = parseInt(total,10);
  if(!n || n<1) return alert("Número inválido.");
  const st = document.getElementById('importStatus');
  st.textContent = "⏳ Iniciando importação de "+movimento+" (até "+n+")...";
  try{
    const r = await fetch("/api/importar/movimento",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({movimento, total:n})});
    const d = await r.json();
    if(d.ok){
      st.innerHTML = "✅ "+d.mensagem+" <a href='/curadoria?ala=entrada&offset=0' style='color:#e0a23a'>→ ver Entrada</a>";
    } else {
      st.textContent = "❌ "+(d.error||"erro");
    }
  }catch(e){ st.textContent = "❌ Falha ao iniciar: "+e.message; }
}
function addArquivar(id){ const t=document.getElementById('boxArquivar'); t.value=(t.value.trim()?t.value.trim()+"\\n":"")+id; }
function addMover(id){ const t=document.getElementById('boxMover'); t.value=(t.value.trim()?t.value.trim()+"\\n":"")+id+" "; t.focus(); }
async function enviarArquivar(){
  const ids=document.getElementById('boxArquivar').value.split("\\n").map(s=>s.trim()).filter(Boolean);
  if(!ids.length) return alert("Cole pelo menos um ID.");
  if(!confirm("Arquivar "+ids.length+" obra(s)? (reversível)")) return;
  const r=await fetch("/api/curadoria/arquivar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids})});
  const d=await r.json(); alert(d.ok?("Arquivadas: "+d.arquivadas+" de "+d.pedidas):("Erro: "+(d.error||""))); if(d.ok) location.reload();
}
async function enviarMover(){
  const linhas=document.getElementById('boxMover').value.split("\\n").map(s=>s.trim()).filter(Boolean);
  if(!linhas.length) return alert("Cole pelo menos uma linha.");
  const movimentos=linhas.map(l=>{ const p=l.replace(/[→>]+/g," ").split(/\\s+/).filter(Boolean); return { id:p[0], ala:p[p.length-1] }; });
  if(!confirm("Mover/publicar "+movimentos.length+" obra(s)?")) return;
  const r=await fetch("/api/curadoria/mover",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({movimentos})});
  const d=await r.json();
  if(d.ok){ let msg="Movidas: "+d.movidas; if(d.erros&&d.erros.length) msg+="\\nFalhas: "+d.erros.length+" (verifique ID/ala)"; alert(msg); location.reload(); }
  else alert("Erro: "+(d.error||""));
}
</script>
</body></html>`);
    } catch (e) {
      res.status(500).send(`<pre style="color:red">Erro: ${esc(e.message)}</pre>`);
    }
  });

  console.log("🎛️  Curadoria montada — /curadoria (com aba Entrada)");
}

module.exports = { montarCuradoria };

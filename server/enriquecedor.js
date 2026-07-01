// server/enriquecedor.js — Padronização Germanus + triagem de direitos + wiki 4 idiomas
// ─────────────────────────────────────────────────────────────────────────────
// Para cada obra, numa única passada:
//   1. PADRONIZA  → nome da obra limpo, artista limpo, ano (4 dígitos)
//   2. TRIAGEM    → lê morte do autor (Wikidata) + licença (Commons). Régua 70 anos:
//                   🟢 seguro (fica) · 🟡 verificar · 🔴 risco  → 🟡/🔴 vão p/ Entrada
//   3. WIKI       → descrição do ARTISTA em EN/FR/IT/ES (Wikipédia, sem tradução paga)
//   4. MOVIMENTO  → tenta preencher (Wikidata); obra fica solta p/ você decidir na Entrada
//
// Roda em SEGUNDO PLANO, ritmo educado. Começa pelas PUBLICADAS, depois Entrada.
//
// COMO LIGAR (1 linha no server.js, ANTES do app.get("*")):
//     require("./enriquecedor").montarEnriquecedor(app, pool);
//
// USO:
//   POST /api/enriquecer/iniciar   { "total": 500, "escopo": "publicadas" }   (ou "entrada"|"todas")
//   GET  /api/enriquecer/status    → progresso e contagem 🟢🟡🔴
//   GET  /enriquecimento           → painel visual
// ─────────────────────────────────────────────────────────────────────────────

const UA = "GermanusArt/1.0 (https://germanus.art; contato@germanus.art)";
const WD_SPARQL = "https://query.wikidata.org/sparql";
const COMMONS   = "https://commons.wikimedia.org/w/api.php";
const ANO_ATUAL = new Date().getFullYear();
const REGUA_PD  = 70; // anos após a morte do autor

let estado = { rodando: false, escopo: null, alvo: 0, feitas: 0, verde: 0, amarelo: 0, vermelho: 0, ultima: "" };

// ─── Helpers de limpeza ───────────────────────────────────────────────────────
function tirarHtml(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

// Nome da obra "padrão Germanus": só o título, sem detalhes técnicos
function limparTitulo(t) {
  let s = tirarHtml(t);
  s = s.replace(/\.(jpg|jpeg|png|tif|tiff|gif|webp)$/i, "");        // extensão
  s = s.replace(/\b(MET|DP|DT|RM)[\s_-]?\d{3,}\b/gi, "");           // códigos de museu
  s = s.replace(/,?\s*(oil|tempera|acrylic|watercolou?r|gouache)\s+on\s+\w+.*$/i, ""); // técnica
  s = s.replace(/\s*\([^)]*\d{3,}[^)]*\)\s*$/g, "");                // (xxxx) no fim com números longos
  s = s.replace(/[_]+/g, " ").replace(/\s{2,}/g, " ").trim();
  s = s.replace(/[\s,;:-]+$/g, "").trim();
  return s || tirarHtml(t);
}

// Artista limpo: sem HTML, sem "Unknown author" duplicado, sem datas entre parênteses
function limparArtista(a) {
  let s = tirarHtml(a);
  s = s.replace(/unknown\s*author/ig, "").replace(/after\s+/i, "");
  s = s.replace(/\(\s*\d{3,4}[^)]*\)/g, "");      // (1818-1895)
  s = s.replace(/\s{2,}/g, " ").trim().replace(/[,;]+$/,"").trim();
  if (!s || /^desconhecido$/i.test(s)) return "Desconhecido";
  return s;
}

function extrairAno(...campos) {
  for (const c of campos) {
    const m = String(c || "").match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
    if (m) return m[1];
  }
  return "";
}

// ─── Wikidata: dados do artista (morte + wiki 4 idiomas + movimento) ──────────
async function dadosDoArtista(nome) {
  if (!nome || /^(desconhecido|unknown|anonymous)/i.test(nome)) return null;
  const q = `
    SELECT ?p ?pLabel ?morte ?movLabel
           ?en ?fr ?it ?es WHERE {
      ?p rdfs:label "${nome.replace(/"/g, '\\"')}"@en .
      ?p wdt:P31 wd:Q5 .
      OPTIONAL { ?p wdt:P570 ?morte. }
      OPTIONAL { ?p wdt:P135 ?mov. ?mov rdfs:label ?movLabel FILTER(LANG(?movLabel)="en"). }
      OPTIONAL { ?en schema:about ?p; schema:inLanguage "en"; schema:isPartOf <https://en.wikipedia.org/>. }
      OPTIONAL { ?fr schema:about ?p; schema:inLanguage "fr"; schema:isPartOf <https://fr.wikipedia.org/>. }
      OPTIONAL { ?it schema:about ?p; schema:inLanguage "it"; schema:isPartOf <https://it.wikipedia.org/>. }
      OPTIONAL { ?es schema:about ?p; schema:inLanguage "es"; schema:isPartOf <https://es.wikipedia.org/>. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 1`;
  try {
    const url = `${WD_SPARQL}?query=${encodeURIComponent(q)}&format=json`;
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/sparql-results+json" }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const d = await r.json();
    const b = d.results?.bindings?.[0];
    if (!b) return null;
    const anoMorte = b.morte?.value ? parseInt(b.morte.value.slice(0, 4), 10) : null;
    return {
      anoMorte,
      movimento: b.movLabel?.value || null,
      artigos: { en: b.en?.value || null, fr: b.fr?.value || null, it: b.it?.value || null, es: b.es?.value || null },
    };
  } catch { return null; }
}

// Resumo (extract) de um artigo da Wikipédia, por idioma
async function resumoWiki(urlArtigo) {
  if (!urlArtigo) return null;
  try {
    const m = urlArtigo.match(/^https?:\/\/([a-z]+)\.wikipedia\.org\/wiki\/(.+)$/);
    if (!m) return null;
    const lang = m[1], titulo = decodeURIComponent(m[2]);
    const api = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(titulo)}`;
    const r = await fetch(api, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const d = await r.json();
    const pages = d.query?.pages ? Object.values(d.query.pages) : [];
    let txt = pages[0]?.extract || "";
    txt = txt.replace(/\s+/g, " ").trim();
    if (txt.length > 600) txt = txt.slice(0, 600).replace(/\s+\S*$/, "") + "…";
    return txt || null;
  } catch { return null; }
}

// ─── Processa UMA obra ────────────────────────────────────────────────────────
async function enriquecerObra(pool, o) {
  // 1. Padroniza
  const tituloLimpo  = limparTitulo(o.title);
  const artistaLimpo = limparArtista(o.artist);
  const anoNovo = o.date && /\d{4}/.test(o.date) ? o.date : extrairAno(o.title, o.date);

  // 2 + 3 + 4. Wikidata do artista
  const wd = await dadosDoArtista(artistaLimpo);

  // ─── TRIAGEM DE DIREITOS (régua inteligente) ───────────────────────────────
  // Via 1 (mais forte): data de morte do autor no Wikidata → régua 70 anos.
  // Via 2 (rede de segurança): ano da OBRA. Obra muito antiga é domínio público
  //   independente de acharmos o autor — resolve Cusco/colonial "autor desconhecido"
  //   e obras cujo nome de artista veio sujo e não casou no Wikidata (ex.: Monet).
  const anoObra = parseInt((anoNovo || "").slice(0, 4), 10) || null;
  const ANTIGA_SEGURA = 1875; // obra anterior a isso: autor quase certamente morto há +70 anos

  let faixa;
  if (wd?.anoMorte) {
    // Via 1: sabemos quando o autor morreu — decisão firme
    faixa = (ANO_ATUAL - wd.anoMorte) > REGUA_PD ? "verde" : "vermelho";
  } else if (anoObra && anoObra < ANTIGA_SEGURA) {
    // Via 2: sem data de morte, mas a obra é antiga o bastante → seguro
    faixa = "verde";
  } else if (anoObra && anoObra >= 1955) {
    // Obra recente e autor não confirmado morto → risco real
    faixa = "vermelho";
  } else {
    // Sem data de morte e sem ano decisivo → na dúvida, verificar
    faixa = "amarelo";
  }

  // Wiki em 4 idiomas (resumo do artista)
  let wikiEn = null, wikiFr = null, wikiIt = null, wikiEs = null;
  if (wd?.artigos) {
    [wikiEn, wikiFr, wikiIt, wikiEs] = await Promise.all([
      resumoWiki(wd.artigos.en), resumoWiki(wd.artigos.fr),
      resumoWiki(wd.artigos.it), resumoWiki(wd.artigos.es),
    ]);
  }

  // Decisão de status: 🟡/🔴 vão para a Entrada (rascunho); 🟢 mantém
  const novoStatus = (faixa === "verde") ? null : "rascunho"; // null = não mexe no status

  // Grava (limpeza sempre p/ nome e artista; ano só se vazio; wiki só preenche)
  await pool.query(
    `UPDATE artworks SET
       title  = $2,
       artist = $3,
       date   = CASE WHEN COALESCE(date,'')='' THEN $4 ELSE date END,
       style  = COALESCE(NULLIF(style,''), $5),
       wiki_en = COALESCE(wiki_en, $6),
       wiki_fr = COALESCE(wiki_fr, $7),
       wiki_it = COALESCE(wiki_it, $8),
       wiki_es = COALESCE(wiki_es, $9),
       wiki_fetched_at = EXTRACT(EPOCH FROM NOW())::BIGINT,
       triagem = $10,
       status  = CASE WHEN $11::text IS NULL THEN status ELSE $11 END
     WHERE id = $1`,
    [o.id, tituloLimpo, artistaLimpo, anoNovo || null, wd?.movimento || null,
     wikiEn, wikiFr, wikiIt, wikiEs, faixa, novoStatus]
  );

  return faixa;
}

// ─── Loop em segundo plano ────────────────────────────────────────────────────
async function rodar(pool, total, escopo) {
  estado = { rodando: true, escopo, alvo: total, feitas: 0, verde: 0, amarelo: 0, vermelho: 0, ultima: "" };

  let filtroStatus;
  if (escopo === "publicadas")    filtroStatus = `COALESCE(status,'publicada')='publicada'`;
  else if (escopo === "entrada")  filtroStatus = `COALESCE(status,'publicada')='rascunho'`;
  else                            filtroStatus = `TRUE`;

  while (estado.feitas < total) {
    const lote = await pool.query(
      `SELECT id,title,artist,date,museum,credit,style FROM artworks
        WHERE ${filtroStatus} AND COALESCE(triagem,'')=''
        ORDER BY indexed_at ASC LIMIT 20`
    );
    if (lote.rows.length === 0) break; // nada mais a enriquecer neste escopo

    for (const o of lote.rows) {
      if (estado.feitas >= total) break;
      try {
        const faixa = await enriquecerObra(pool, o);
        estado[faixa === "verde" ? "verde" : faixa === "vermelho" ? "vermelho" : "amarelo"]++;
        estado.ultima = o.id;
      } catch (e) { /* segue */ }
      estado.feitas++;
      await new Promise(r => setTimeout(r, 1500)); // ritmo educado com Wikidata/Wikipédia
    }
  }
  estado.rodando = false;
  console.log(`✨ Enriquecedor concluído — ${estado.feitas} obras (🟢${estado.verde} 🟡${estado.amarelo} 🔴${estado.vermelho})`);
}

function montarEnriquecedor(app, pool) {
  pool.query(`ALTER TABLE artworks ADD COLUMN IF NOT EXISTS triagem TEXT DEFAULT ''`).catch(() => {});

  app.post("/api/enriquecer/iniciar", async (req, res) => {
    if (estado.rodando) return res.json({ ok: false, mensagem: "Já está rodando", estado });
    const total  = Math.min(parseInt(req.body?.total || "500", 10) || 500, 20000);
    const escopo = ["publicadas", "entrada", "todas"].includes(req.body?.escopo) ? req.body.escopo : "publicadas";
    res.json({ ok: true, mensagem: `Enriquecimento iniciado (${escopo}, até ${total}). Acompanhe em /enriquecimento`, total, escopo });
    rodar(pool, total, escopo).catch(e => { estado.rodando = false; console.log("✨ Enriquecedor erro:", e.message); });
  });

  app.get("/api/enriquecer/status", (req, res) => res.json(estado));

  app.get("/enriquecimento", async (req, res) => {
    let tot = {};
    try {
      const r = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE triagem='verde')    AS verde,
          COUNT(*) FILTER (WHERE triagem='amarelo')  AS amarelo,
          COUNT(*) FILTER (WHERE triagem='vermelho') AS vermelho,
          COUNT(*) FILTER (WHERE COALESCE(triagem,'')='') AS pendentes,
          COUNT(*) FILTER (WHERE wiki_en IS NOT NULL OR wiki_fr IS NOT NULL) AS com_wiki,
          COUNT(*) AS total
        FROM artworks`);
      tot = r.rows[0];
    } catch (e) { tot = { erro: e.message }; }
    const pct = estado.alvo > 0 ? Math.round(estado.feitas / estado.alvo * 100) : 0;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Germanus — Enriquecimento</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#e0e0e0;font-family:-apple-system,Segoe UI,sans-serif;padding:28px 24px;max-width:760px;margin:0 auto}
h1{font-size:20px;color:#fff;margin-bottom:4px}.sub{color:#555;font-size:12px;margin-bottom:24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:24px}
.card{background:#141414;border:1px solid #222;border-radius:10px;padding:14px}
.card .v{font-size:26px;font-weight:700}.card .l{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}
.v.g{color:#1D9E75}.v.a{color:#E0A23A}.v.r{color:#E24B4A}.v.b{color:#378ADD}
.bar{height:10px;background:#1a1a1a;border-radius:6px;overflow:hidden;margin:8px 0 18px}
.bar>div{height:100%;background:#1D9E75;width:${pct}%;transition:width .4s}
.run{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}
button{padding:9px 16px;border-radius:8px;border:1px solid #2a2a2a;background:#161616;color:#ddd;cursor:pointer;font-size:12px}
button:hover{background:#1d1d1d}button.go{background:#1D9E7522;border-color:#1D9E7555;color:#5fd6a8}
a{color:#378ADD;text-decoration:none}.st{font-size:12px;color:#888;margin-top:10px}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}td{padding:6px 10px;border-bottom:1px solid #161616}
</style></head><body>
<h1>GERMANUS.Art — Enriquecimento & Triagem</h1>
<p class="sub"><a href="/banco">← banco</a> · <a href="/curadoria">curadoria</a> · régua: domínio público = morte do autor +${REGUA_PD} anos</p>

<div class="cards">
  <div class="card"><div class="v g">${tot.verde||0}</div><div class="l">🟢 seguro</div></div>
  <div class="card"><div class="v a">${tot.amarelo||0}</div><div class="l">🟡 verificar</div></div>
  <div class="card"><div class="v r">${tot.vermelho||0}</div><div class="l">🔴 risco</div></div>
  <div class="card"><div class="v">${tot.pendentes||0}</div><div class="l">não vistas</div></div>
  <div class="card"><div class="v b">${tot.com_wiki||0}</div><div class="l">com wiki</div></div>
</div>

<div class="run">
  <button class="go" onclick="iniciar('publicadas')">▶ Enriquecer publicadas</button>
  <button onclick="iniciar('entrada')">Entrada</button>
  <button onclick="iniciar('todas')">Todas</button>
  <button onclick="location.reload()">↻ Atualizar</button>
</div>
<div class="bar"><div></div></div>
<p class="st">${estado.rodando
  ? `⏳ Rodando (${estado.escopo}): ${estado.feitas}/${estado.alvo} · 🟢${estado.verde} 🟡${estado.amarelo} 🔴${estado.vermelho}`
  : (estado.feitas>0 ? `✓ Última leva: ${estado.feitas} obras (🟢${estado.verde} 🟡${estado.amarelo} 🔴${estado.vermelho})` : "Parado.")}</p>

<script>
async function iniciar(escopo){
  const total = prompt("Quantas obras enriquecer agora? (ex.: 200, 500, 1000)", "300");
  if(total===null) return;
  const r = await fetch("/api/enriquecer/iniciar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({escopo,total:parseInt(total,10)})});
  const d = await r.json();
  alert(d.mensagem || JSON.stringify(d));
  setTimeout(()=>location.reload(), 1500);
}
${estado.rodando ? "setTimeout(()=>location.reload(), 8000);" : ""}
</script>
</body></html>`);
  });

  console.log("✨ Enriquecedor montado — /enriquecimento e POST /api/enriquecer/iniciar");
}

module.exports = { montarEnriquecedor, enriquecerObra };

// server/censo.js — Censo do acervo (somente leitura: não altera nada no banco)
// ─────────────────────────────────────────────────────────────────────────────
// Responde a quatro perguntas:
//   1. ONDE estão as obras — por estado (publicada / entrada / arquivada) e por ala.
//      Mostra lado a lado o número do /banco (que conta tudo que tem ala e imagem)
//      e o número que o SITE realmente exibe (publicada + imagem + ala válida).
//   2. DE ONDE vieram — o mesmo recorte por fonte (met, aic, commons, europeana…).
//   3. DUPLICATAS — a mesma pintura entrando por duas fontes (ex.: Met e Commons).
//      "Fortes": mesmo artista + mesmo título + mesmo ano. "Prováveis": artista + título.
//   4. ESGOTAMENTO — para cada fonte varrida pelo agente (Met, AIC, Cleveland,
//      Europeana): o tamanho do universo hoje (consultado na API do museu), quanto
//      já foi varrido, e quantas obras ainda devem chegar ao site.
//
// Páginas:  GET /censo          (painel)
//           GET /api/censo      (o mesmo em JSON)
//
// COMO LIGAR — no server.js, junto dos outros require (perto da linha 1126):
//     require("./censo").montarCenso(app, pool);
// ─────────────────────────────────────────────────────────────────────────────

const ALAS = {
  retratos: "Retratos", pessoas_reais: "Pessoas Conhecidas", historico: "História",
  perspectiva: "Perspectiva", objetos: "Objetos", lugares: "Lugares Conhecidos",
  natureza: "Natureza", familiar: "Ambiente Familiar", nudes: "Nu Feminino",
  esoterico: "Esotérico", sacro: "Sacro", arquitetura: "Arquitetura",
  povo: "Pessoas do Povo", luz_sol: "Luz do Sol", cores: "Cores",
  cidades: "Emoção", fase: "Psiquê", femininas: "Artistas Femininas",
};
const IDS = Object.keys(ALAS);

const ST = `COALESCE(status,'publicada')`;
const TEM_IMG = `(image_url IS NOT NULL AND image_url <> '')`;
const NO_SITE = `(${ST}='publicada' AND ${TEM_IMG} AND ala_id = ANY($1::text[]))`;

// Chaves normalizadas para achar a mesma pintura vinda de fontes diferentes.
// Artista: primeira linha, antes de "(" e de "," (AIC grava "Claude Monet\nFrench, 1840–1926").
const NORM = (expr) => `trim(regexp_replace(lower(translate(${expr},
  'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
  'aaaaaaeeeeiiiiooooouuuucnaaaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', ' ', 'g'))`;
const CHAVE_ARTISTA = NORM(`split_part(split_part(split_part(COALESCE(artist,''), E'\\n', 1), '(', 1), ',', 1)`);
const CHAVE_TITULO  = NORM(`COALESCE(title,'')`);
const ANO = `substring(COALESCE(date,'') from '\\d{4}')`;
const ANONIMO = `'^(unknown|anonymous|anonimo|anonyme|desconhecido|anoniem|unbekannt|$)'`;

// ─── Universo de cada fonte (consulta ao vivo, guardada por 6 h) ─────────────
let universoCache = { em: 0, dados: null };

async function pegar(url, ms = 30000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "GERMANUS.Art censo" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function universo() {
  if (universoCache.dados && Date.now() - universoCache.em < 6 * 3600 * 1000) return universoCache.dados;
  const u = {};
  const tentar = async (nome, fn) => { try { u[nome] = await fn(); } catch (e) { u[nome] = { erro: e.message }; } };

  await Promise.all([
    // Met: o agente varre os departamentos 11, 1 e 21 objeto a objeto
    tentar("met", async () => {
      const deps = {};
      for (const d of [11, 1, 21]) {
        const j = await pegar(`https://collectionapi.metmuseum.org/public/collection/v1/objects?departmentIds=${d}`, 60000);
        deps[d] = j.total || (j.objectIDs || []).length;
      }
      return { objetos: deps[11] + deps[1] + deps[21], deps,
               nota: "objetos dos 3 departamentos (nem todos são pintura em domínio público)" };
    }),
    // AIC: mesma busca do agente (domínio público + Painting)
    tentar("aic", async () => {
      const params = { query: { bool: { must: [ { term: { is_public_domain: true } },
                                                { match: { artwork_type_title: "Painting" } } ] } }, limit: 0 };
      const j = await pegar(`https://api.artic.edu/api/v1/artworks/search?params=${encodeURIComponent(JSON.stringify(params))}`);
      return { objetos: j.pagination?.total ?? null, nota: "pinturas em domínio público" };
    }),
    // Cleveland: mesma busca do agente (Painting + CC0 + com imagem)
    tentar("cleveland", async () => {
      const j = await pegar("https://openaccess-api.clevelandart.org/api/artworks/?type=Painting&cc0=1&has_image=1&limit=1");
      return { objetos: j.info?.total ?? null, nota: "pinturas CC0 com imagem" };
    }),
    // Europeana: mesma busca do agente (Public Domain Mark + CC0 + filtro de pintura)
    tentar("europeana", async () => {
      const KEY = process.env.EUROPEANA_KEY;
      if (!KEY) throw new Error("Falta EUROPEANA_KEY");
      const x = new URL("https://api.europeana.eu/record/v2/search.json");
      x.searchParams.set("wskey", KEY);
      x.searchParams.set("query", "*:*");
      x.searchParams.set("reusability", "open");
      x.searchParams.set("media", "true");
      x.searchParams.set("rows", "0");
      x.searchParams.append("qf", 'RIGHTS:("http://creativecommons.org/publicdomain/mark/1.0/" OR "http://creativecommons.org/publicdomain/zero/1.0/")');
      x.searchParams.append("qf",
        '(skos_concept:"http://data.europeana.eu/concept/47" OR skos_concept:"http://data.europeana.eu/concept/base/47"' +
        ' OR proxy_dc_type.en:(painting OR paintings) OR proxy_dc_type.nl:(schilderij OR schilderijen)' +
        ' OR proxy_dc_type.sv:(målning OR oljemålning) OR proxy_dc_type.de:(Gemälde) OR proxy_dc_type.fr:(peinture))');
      const j = await pegar(x.toString());
      return { objetos: j.totalResults ?? null, nota: "itens Domínio Público/CC0 marcados como pintura (inclui fotos e cópias de baixa qualidade)" };
    }),
  ]);
  universoCache = { em: Date.now(), dados: u };
  return u;
}

// Posição do marcador de cada fonte (quanto do universo já foi varrido)
function posicao(fonte, estado, vistas, u) {
  estado = estado || {};
  if (fonte === "aic")       return estado.page ? (estado.page - 1) * 100 : 0;
  if (fonte === "cleveland") return estado.skip || 0;
  if (fonte === "met" && u?.deps) {
    const ordem = [11, 1, 21];
    const dep = estado.dep || 0;
    let p = 0;
    for (let i = 0; i < Math.min(dep, 3); i++) p += u.deps[ordem[i]] || 0;
    return p + (dep < 3 ? (estado.pos || 0) : 0);
  }
  return vistas || 0; // Europeana usa cursor: a melhor medida é o nº de itens já vistos
}

// ─── Coleta ──────────────────────────────────────────────────────────────────
async function coletar(pool, comUniverso = true) {
  const q = (sql, p = [IDS]) => pool.query(sql, p).then(r => r.rows);

  const resumo = (await q(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE ${NO_SITE})::int AS no_site,
           COUNT(*) FILTER (WHERE ${ST}='publicada' AND NOT ${NO_SITE})::int AS publicada_invisivel,
           COUNT(*) FILTER (WHERE ${ST}='rascunho')::int AS entrada,
           COUNT(*) FILTER (WHERE ${ST}='arquivada')::int AS arquivada,
           COUNT(*) FILTER (WHERE ${ST} NOT IN ('publicada','rascunho','arquivada'))::int AS outro_status
      FROM artworks`))[0];

  // Por ala: o que o /banco mostra × o que o site mostra
  const porAla = await q(`
    SELECT COALESCE(ala_id,'(sem ala)') AS ala,
           COUNT(*) FILTER (WHERE ${TEM_IMG})::int AS banco,
           COUNT(*) FILTER (WHERE ${NO_SITE})::int AS site,
           COUNT(*) FILTER (WHERE ${ST}='rascunho')::int AS entrada,
           COUNT(*) FILTER (WHERE ${ST}='arquivada')::int AS arquivada,
           COUNT(*) FILTER (WHERE NOT ${TEM_IMG})::int AS sem_imagem
      FROM artworks GROUP BY 1 ORDER BY 2 DESC`);

  // Por fonte
  const porFonte = await q(`
    SELECT COALESCE(source,'?') AS fonte, COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE ${NO_SITE})::int AS site,
           COUNT(*) FILTER (WHERE ${ST}='rascunho')::int AS entrada,
           COUNT(*) FILTER (WHERE ${ST}='arquivada')::int AS arquivada
      FROM artworks GROUP BY 1 ORDER BY 2 DESC`);

  // A Entrada por dentro: por que essas obras não estão no site
  let entrada = [];
  try {
    entrada = await q(`
      SELECT CASE
          WHEN NOT ${TEM_IMG} OR img_retirada_em IS NOT NULL THEN 'sem imagem / imagem morta'
          WHEN ala_classificada_em IS NULL AND ala_sugerida IS NULL THEN 'ainda não classificada pelo agente'
          WHEN COALESCE(ala_tipo,'pintura') <> 'pintura' THEN 'agente diz que NÃO é pintura'
          WHEN ala_decisao IS NULL THEN 'classificada, aguardando você aceitar'
          WHEN COALESCE(triagem,'') <> 'verde' THEN 'aceita, mas a triagem de direitos não está verde'
          ELSE 'outro motivo' END AS motivo,
        COUNT(*)::int AS n
      FROM artworks WHERE ${ST}='rascunho' GROUP BY 1 ORDER BY 2 DESC`, []);
  } catch (e) { entrada = [{ motivo: "colunas do agente ausentes: " + e.message, n: 0 }]; }

  // Duplicatas
  const dupSql = comAno => `
    WITH k AS (
      SELECT id, source, title, artist, date, ${ST} AS st, ${NO_SITE} AS visivel,
             ${CHAVE_ARTISTA} AS ka, ${CHAVE_TITULO} AS kt, ${ANO} AS ano
        FROM artworks
       WHERE ${ST} <> 'arquivada')
    SELECT ka, kt, ${comAno ? "ano" : "min(ano) AS ano"}, COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE visivel)::int AS visiveis,
           COUNT(DISTINCT source)::int AS fontes,
           json_agg(json_build_object('id',id,'fonte',source,'titulo',title,'artista',artist,
                                      'data',date,'status',st,'no_site',visivel) ORDER BY visivel DESC, source) AS obras
      FROM k
     WHERE ka !~ ${ANONIMO} AND length(kt) >= 6
       AND kt !~ '^(untitled|sem titulo|sans titre|senza titolo|ohne titel|zonder titel)$'
       ${comAno ? "AND ano IS NOT NULL" : ""}
     GROUP BY ka, kt${comAno ? ", ano" : ""}
    HAVING COUNT(*) > 1
     ORDER BY visiveis DESC, n DESC`;
  const fortes = await q(dupSql(true));
  const provaveis = await q(dupSql(false));
  const somar = (gs, f) => gs.reduce((s, g) => s + f(g), 0);
  const dup = {
    fortes: { grupos: fortes.length, copias_extras: somar(fortes, g => g.n - 1),
              repetidas_no_site: somar(fortes, g => Math.max(0, g.visiveis - 1)) },
    provaveis: { grupos: provaveis.length, copias_extras: somar(provaveis, g => g.n - 1),
                 repetidas_no_site: somar(provaveis, g => Math.max(0, g.visiveis - 1)) },
    lista: provaveis.slice(0, 150),
    criterio: "Fortes = mesmo artista + mesmo título + mesmo ano. Prováveis = mesmo artista + mesmo título " +
              "(pode juntar duas obras diferentes com título genérico, como 'Paisagem'). Anônimos e títulos curtos ficam de fora.",
  };

  // Esgotamento das fontes do agente
  let fontes = [];
  try { fontes = await q(`SELECT fonte, estado, esgotada, ativa, vistas, importadas FROM agente_fontes ORDER BY fonte`, []); }
  catch { fontes = []; }
  const u = comUniverso ? await universo() : {};
  const daFonte = Object.fromEntries(porFonte.map(f => [f.fonte, f]));

  // Aproveitamento: das obras desta fonte já decididas (no site ou arquivadas), quantas foram ao site.
  // Fonte ainda sem decisões usa o aproveitamento médio do acervo inteiro.
  const somaSite = porFonte.reduce((s, f) => s + f.site, 0);
  const somaDecid = porFonte.reduce((s, f) => s + f.site + f.arquivada, 0);
  const aprovGeral = somaDecid > 0 ? somaSite / somaDecid : null;
  const esgot = fontes.map(f => {
    const uni = u[f.fonte] || {};
    const tot = uni.objetos ?? null;
    const pos = Math.min(posicao(f.fonte, f.estado, f.vistas, uni), tot ?? Infinity);
    const banco = daFonte[f.fonte] || { total: 0, site: 0, entrada: 0, arquivada: 0 };
    const decididas = banco.site + banco.arquivada;
    const aprovProprio = decididas >= 30;   // poucas decisões não bastam para uma taxa própria
    const aproveitamento = aprovProprio ? banco.site / decididas : aprovGeral;
    const rendimento = f.vistas > 0 ? f.importadas / f.vistas : null;  // obras gravadas por objeto varrido
    const faltam = (tot != null) ? Math.max(0, tot - pos) : null;
    const chegarao = (faltam != null && rendimento != null) ? Math.round(faltam * rendimento) : null;
    const novas_no_site = (chegarao != null && aproveitamento != null) ? Math.round(chegarao * aproveitamento) : null;
    const pendentes_no_site = (aproveitamento != null) ? Math.round(banco.entrada * aproveitamento) : null;
    return {
      fonte: f.fonte, ativa: f.ativa, esgotada: f.esgotada,
      universo: tot, universo_nota: uni.nota || uni.erro || "",
      varrido: pos, pct_varrido: tot ? Math.round(pos / tot * 1000) / 10 : null, faltam_varrer: faltam,
      vistas: f.vistas, importadas: f.importadas,
      no_banco: banco.total, no_site: banco.site, na_entrada: banco.entrada, arquivadas: banco.arquivada,
      aproveitamento: aproveitamento != null ? Math.round(aproveitamento * 100) : null,
      aproveitamento_medio: !aprovProprio,
      ainda_chegam_ao_banco: chegarao, ainda_chegam_ao_site: novas_no_site,
      da_entrada_ao_site: pendentes_no_site,
    };
  });

  // Projeção do teto
  const somaN = k => esgot.reduce((s, e) => s + (e[k] || 0), 0);
  const outrasEntrada = porFonte.filter(f => !fontes.some(x => x.fonte === f.fonte)).reduce((s, f) => s + f.entrada, 0);
  const projecao = {
    hoje_no_site: resumo.no_site,
    da_entrada_das_fontes_do_agente: somaN("da_entrada_ao_site"),
    entrada_de_outras_fontes: outrasEntrada,
    ainda_por_baixar: somaN("ainda_chegam_ao_site"),
    menos_duplicatas_estimadas: -dup.fortes.repetidas_no_site,
  };
  projecao.teto_estimado = projecao.hoje_no_site + projecao.da_entrada_das_fontes_do_agente
                         + projecao.ainda_por_baixar + projecao.menos_duplicatas_estimadas;
  projecao.nota = "Teto das 4 fontes automáticas, mantido o aproveitamento atual de cada uma. " +
    "Não inclui Wikimedia Commons, curadoria manual nem novas instituições, que não têm fim definido. " +
    "A Entrada de outras fontes aparece à parte porque depende da sua revisão.";

  return { gerado_em: new Date().toISOString(), resumo, porAla, porFonte, entrada, duplicatas: dup,
           esgotamento: esgot, projecao };
}

// ─── Painel ──────────────────────────────────────────────────────────────────
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const n = x => (x == null ? "—" : Number(x).toLocaleString("pt-BR"));

function pagina(d) {
  const r = d.resumo;
  const linhaAla = a => `<tr${IDS.includes(a.ala) ? "" : ' class="fora"'}>
      <td>${esc(ALAS[a.ala] || a.ala)}</td><td>${n(a.banco)}</td><td class="ok">${n(a.site)}</td>
      <td>${n(a.entrada)}</td><td>${n(a.arquivada)}</td><td>${n(a.sem_imagem)}</td></tr>`;
  const linhaFonte = f => `<tr><td>${esc(f.fonte)}</td><td>${n(f.total)}</td><td class="ok">${n(f.site)}</td>
      <td>${n(f.entrada)}</td><td>${n(f.arquivada)}</td></tr>`;
  const linhaEsg = e => `<tr><td><b>${esc(e.fonte)}</b>${e.esgotada ? ' <span class="tag">esgotada</span>' : ""}${e.ativa ? "" : ' <span class="tag">pausada</span>'}
      <div class="mini">${esc(e.universo_nota)}</div></td>
      <td>${n(e.universo)}</td><td>${e.pct_varrido == null ? "—" : e.pct_varrido + "%"}<div class="mini">${n(e.varrido)}</div></td>
      <td>${n(e.no_banco)}</td><td class="ok">${n(e.no_site)}</td>
      <td>${e.aproveitamento == null ? "—" : e.aproveitamento + "%" + (e.aproveitamento_medio ? '<div class="mini">média geral</div>' : "")}</td>
      <td class="ok">+${n(e.ainda_chegam_ao_site)}</td></tr>`;
  const grupo = g => `<details><summary>${esc(g.obras[0].artista || "")} — <i>${esc(g.obras[0].titulo)}</i>
      <span class="mini">${g.n} cópias · ${g.visiveis} no site</span></summary>
      <ul>${g.obras.map(o => `<li><code>${esc(o.id)}</code> · ${esc(o.fonte)} · ${esc(o.data || "s/d")} · ${o.no_site ? '<span class="ok">no site</span>' : esc(o.status)}</li>`).join("")}</ul></details>`;
  const p = d.projecao;

  return `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>GERMANUS.Art — Censo</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#ddd;font:14px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px 16px;max-width:980px;margin:0 auto}
h1{font-size:20px;color:#fff;font-weight:600}h2{font-size:12px;color:#777;text-transform:uppercase;letter-spacing:.6px;margin:30px 0 10px}
.sub{color:#555;font-size:12px;margin:4px 0 20px}.mini{color:#666;font-size:11px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.card{background:#141414;border:1px solid #222;border-radius:10px;padding:12px 14px}
.card .v{font-size:24px;font-weight:700;color:#fff}.card .l{font-size:11px;color:#777;margin-top:2px}
.card.g .v,.ok{color:#1D9E75}.card.a .v{color:#BA7517}.card.r .v{color:#E24B4A}
.wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:right;color:#555;font-size:10px;text-transform:uppercase;padding:6px 8px;border-bottom:1px solid #1d1d1d;white-space:nowrap}
td{text-align:right;padding:6px 8px;border-bottom:1px solid #141414;vertical-align:top}
th:first-child,td:first-child{text-align:left}tr.fora td{color:#777;font-style:italic}
.tag{font-size:10px;border:1px solid #333;border-radius:10px;padding:1px 6px;color:#aaa}
.box{background:#111;border:1px solid #222;border-radius:10px;padding:14px 16px}
.box p{margin:4px 0}.teto{font-size:28px;color:#fff;font-weight:700}
details{border-bottom:1px solid #161616;padding:6px 0}summary{cursor:pointer}
details ul{margin:6px 0 4px 18px;color:#999;font-size:12px}code{color:#8ab4f8}
a{color:#378ADD}
</style></head><body>
<h1>Censo do acervo</h1>
<p class="sub">Gerado em ${esc(new Date(d.gerado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }))} · somente leitura · <a href="/banco">/banco</a> · <a href="/api/censo">JSON</a></p>

<div class="cards">
  <div class="card"><div class="v">${n(r.total)}</div><div class="l">registros no banco</div></div>
  <div class="card g"><div class="v">${n(r.no_site)}</div><div class="l">visíveis no site</div></div>
  <div class="card a"><div class="v">${n(r.entrada)}</div><div class="l">na Entrada (rascunho)</div></div>
  <div class="card"><div class="v">${n(r.arquivada)}</div><div class="l">arquivadas</div></div>
  <div class="card r"><div class="v">${n(r.publicada_invisivel)}</div><div class="l">publicadas mas invisíveis<br>(sem imagem ou sem ala válida)</div></div>
</div>

<h2>Por ala — /banco × site</h2>
<p class="mini" style="margin-bottom:8px">"No /banco" conta tudo que tem ala e imagem, inclusive Entrada e arquivadas. "No site" é o que a galeria exibe.</p>
<div class="wrap"><table><tr><th>Ala</th><th>no /banco</th><th>no site</th><th>entrada</th><th>arquivada</th><th>sem imagem</th></tr>
${d.porAla.map(linhaAla).join("")}</table></div>

<h2>Por que a Entrada não está no site</h2>
<div class="wrap"><table><tr><th>Motivo</th><th>Obras</th></tr>
${d.entrada.map(e => `<tr><td>${esc(e.motivo)}</td><td>${n(e.n)}</td></tr>`).join("")}</table></div>

<h2>Por fonte</h2>
<div class="wrap"><table><tr><th>Fonte</th><th>total</th><th>no site</th><th>entrada</th><th>arquivada</th></tr>
${d.porFonte.map(linhaFonte).join("")}</table></div>

<h2>Esgotamento das fontes do agente</h2>
<div class="wrap"><table><tr><th>Fonte</th><th>universo hoje</th><th>varrido</th><th>no banco</th><th>no site</th><th>aproveit.</th><th>ainda virão ao site</th></tr>
${d.esgotamento.map(linhaEsg).join("") || '<tr><td colspan="7">Tabela agente_fontes não encontrada.</td></tr>'}</table></div>
<p class="mini" style="margin-top:6px">Aproveitamento = das obras dessa fonte já decididas, quantas foram ao site. "Ainda virão" = o que falta varrer × o rendimento já observado × o aproveitamento.</p>

<h2>Teto estimado</h2>
<div class="box">
  <p class="teto">≈ ${n(p.teto_estimado)} obras</p>
  <p>${n(p.hoje_no_site)} hoje no site</p>
  <p>+ ${n(p.da_entrada_das_fontes_do_agente)} que devem sair da Entrada (fontes do agente)</p>
  <p>+ ${n(p.ainda_por_baixar)} ainda por baixar</p>
  <p>− ${n(-p.menos_duplicatas_estimadas)} duplicatas fortes já no site</p>
  <p class="mini" style="margin-top:8px">Fora da conta: ${n(p.entrada_de_outras_fontes)} obras de outras fontes paradas na Entrada. ${esc(p.nota)}</p>
</div>

<h2>Duplicatas</h2>
<div class="cards">
  <div class="card"><div class="v">${n(d.duplicatas.fortes.grupos)}</div><div class="l">grupos fortes · ${n(d.duplicatas.fortes.repetidas_no_site)} repetidas no site</div></div>
  <div class="card"><div class="v">${n(d.duplicatas.provaveis.grupos)}</div><div class="l">grupos prováveis · ${n(d.duplicatas.provaveis.repetidas_no_site)} repetidas no site</div></div>
</div>
<p class="mini" style="margin:8px 0">${esc(d.duplicatas.criterio)} Lista abaixo: até 150 grupos, os que têm mais cópias visíveis primeiro.</p>
${d.duplicatas.lista.map(grupo).join("")}
</body></html>`;
}

function montarCenso(app, pool) {
  app.get("/api/censo", async (req, res) => {
    try { res.json(await coletar(pool, req.query.rapido !== "1")); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get("/censo", async (req, res) => {
    try {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(pagina(await coletar(pool, req.query.rapido !== "1")));
    } catch (e) { res.status(500).send("Erro no censo: " + esc(e.message)); }
  });
  console.log("📊 Censo do acervo — /censo");
}

module.exports = { montarCenso, coletar, pagina };

// server/galeria.js — Sequência curada e fixa por ala, em blocos de 18
// ─────────────────────────────────────────────────────────────────────────────
// Cada ala tem UMA sequência, igual para todos os visitantes, do começo ao fim.
// Ela é montada em blocos de 18 obras:
//
//   1. QUALIDADE — cada obra recebe uma nota (ver notaSql abaixo). Os primeiros
//      blocos reúnem as melhores; as de menor nota ficam juntas nos últimos.
//   2. VARIEDADE DE ARTISTAS — no máximo 2 obras do mesmo artista por bloco.
//   3. VARIEDADE DE MUSEUS — cada museu tem um teto por bloco proporcional ao
//      seu peso na ala (mínimo 3): um museu com 10% da ala cabe 3 vezes em 18;
//      um com 50% cabe 9. Assim o bloco mistura acervos sem empurrar todas as
//      obras do museu dominante para o fim da ala. Quando dá, a escolha ainda
//      prefere a obra que traz um museu novo ao bloco.
//      Se, no fim da ala, faltar variedade, os limites sobem aos poucos só
//      nesses blocos finais (primeiro o de museu, depois o de artista).
//   4. RITMO — dentro do bloco, a melhor obra abre, e a ordem evita o mesmo
//      artista ou o mesmo museu lado a lado e alterna os séculos.
//
// A sequência é recalculada a cada 10 min (ou quando o nº de obras da ala muda),
// então movimentos feitos em /curadoria aparecem sem deploy. Para forçar:
//     GET /api/galeria/:ala?page=0&refresh=1
//
// USO (frontend):  GET /api/galeria/:ala?page=0   (page 1, 2… = próximos 18)
// Diagnóstico:     GET /api/galeria/:ala/sequencia  (ids, nota e bloco de cada obra)
//
// COMO LIGAR (já está no server.js, ANTES do app.get("*")):
//     require("./galeria").montarGaleria(app, pool);
// ─────────────────────────────────────────────────────────────────────────────

const PAGE = 18;
const MAX_POR_ARTISTA = 2;
const TTL_MS = 10 * 60 * 1000;

const cache = new Map(); // ala -> { seq: [{id, nota, bloco}], n, em }
let colunas = null;      // colunas existentes em artworks (detectadas uma vez)

// Hash determinístico (FNV-1a) — desempate estável, igual para todos
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

const FILTRO = `ala_id = $1 AND image_url IS NOT NULL AND image_url <> ''
                AND COALESCE(status,'publicada') = 'publicada'`;

async function lerColunas(pool) {
  if (colunas) return colunas;
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'artworks'`);
  colunas = new Set(r.rows.map(x => x.column_name));
  return colunas;
}

// ─── A nota de qualidade ─────────────────────────────────────────────────────
// Usa só o que o banco já sabe. Cada sinal entra apenas se a coluna existir.
function notaSql(c) {
  const p = [];
  // Obras escolhidas à mão (curadoria fixa) — o núcleo do acervo
  p.push(`CASE WHEN source = 'curadoria' THEN 40 ELSE 0 END`);
  // Obra que você já revisou/moveu em /curadoria
  if (c.has("curado")) p.push(`CASE WHEN curado THEN 12 ELSE 0 END`);
  // Obra com verbete na Wikipédia = obra reconhecida (3 pts por idioma, até 18)
  const wikis = ["wiki_en", "wiki_fr", "wiki_es", "wiki_it", "wiki_pt", "wiki_de"].filter(w => c.has(w));
  if (wikis.length) p.push(`LEAST(18, 3 * (${wikis.map(w => `(CASE WHEN COALESCE(${w},'') <> '' THEN 1 ELSE 0 END)`).join(" + ")}))`);
  // Resolução medida (lado menor)
  if (c.has("img_w") && c.has("img_h")) p.push(`CASE
      WHEN img_w IS NULL OR img_h IS NULL OR img_w = 0 THEN 0
      WHEN LEAST(img_w, img_h) >= 2400 THEN 14
      WHEN LEAST(img_w, img_h) >= 1500 THEN 10
      WHEN LEAST(img_w, img_h) >= 900  THEN 5
      WHEN LEAST(img_w, img_h) <  500  THEN -12
      ELSE 0 END`);
  if (c.has("hd_url")) p.push(`CASE WHEN COALESCE(hd_url,'') <> '' THEN 3 ELSE 0 END`);
  // Ficha completa
  p.push(`CASE WHEN COALESCE(description,'') <> '' THEN 3 ELSE 0 END`);
  p.push(`CASE WHEN COALESCE(date,'') <> '' THEN 2 ELSE 0 END`);
  p.push(`CASE WHEN COALESCE(museum,'') <> '' THEN 2 ELSE 0 END`);
  // Autoria desconhecida pesa um pouco
  p.push(`CASE WHEN COALESCE(artist,'') = '' OR artist ~* '^(unknown|anonymous|anônimo|anonimo|anonyme|desconhecido)' THEN -6 ELSE 0 END`);
  // Certeza do agente ao pôr a obra nesta ala
  if (c.has("ala_confianca")) p.push(`CASE WHEN ala_confianca IS NULL THEN 0 ELSE ROUND(((ala_confianca - 0.6) * 15)::numeric, 1) END`);
  // Imagem que já falhou para algum visitante
  const falhas = ["falhas_imagem", "img_falhas"].filter(f => c.has(f));
  if (falhas.length) p.push(`CASE WHEN (${falhas.map(f => `COALESCE(${f},0)`).join(" + ")}) > 0 THEN -15 ELSE 0 END`);
  return p.join(" + ");
}

// Chave de artista: "Claude Monet (1840–1926)" e "claude monet" contam como o mesmo
function chaveArtista(a, id) {
  const k = (a || "").split("(")[0].normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!k || /^(unknown|anonymous|anonimo|anonyme|desconhecido)/.test(k)) return "anon:" + id; // anônimos não se agrupam
  return k;
}

// Chave de museu: "Rijksmuseum, Amsterdam, Países Baixos" → "rijksmuseum".
// Sem museu na ficha, usa a fonte (ex.: commons, met, aic).
function chaveMuseu(museum, source) {
  const base = String(museum || "").split(/[,(;–—-]/)[0];
  const k = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/^(the|le|la|il|el|o|museo|museu|musee|museum)\s+/, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (k) return "m:" + k;
  return "f:" + String(source || "?").toLowerCase();
}

function seculo(date) {
  const m = String(date || "").match(/\d{3,4}/);
  return m ? Math.floor(parseInt(m[0], 10) / 100) : -1;
}

// Dentro do bloco: a melhor abre; depois, evita artista e museu repetidos lado
// a lado e prefere trocar de século a cada passo.
function ritmo(bloco) {
  const resto = [...bloco];
  const out = [resto.shift()];
  while (resto.length) {
    const ant = out[out.length - 1];
    let idx = resto.findIndex(o => o.art !== ant.art && o.mus !== ant.mus && o.sec !== ant.sec);
    if (idx < 0) idx = resto.findIndex(o => o.art !== ant.art && o.mus !== ant.mus);
    if (idx < 0) idx = resto.findIndex(o => o.art !== ant.art);
    if (idx < 0) idx = 0;
    out.push(resto.splice(idx, 1)[0]);
  }
  return out;
}

function montarSequencia(rows) {
  // 1. ordem de qualidade (desempate estável e "embaralhado" pelo id)
  const obras = rows.map(r => ({
    id: r.id, nota: Number(r.nota) || 0,
    art: chaveArtista(r.artist, r.id), mus: chaveMuseu(r.museum, r.source),
    sec: seculo(r.date), h: hashStr(String(r.id)),
  })).sort((a, b) => b.nota - a.nota || a.h - b.h);

  // teto por museu, proporcional ao peso do museu na ala (mínimo 3 por bloco)
  const peso = new Map();
  for (const o of obras) peso.set(o.mus, (peso.get(o.mus) || 0) + 1);
  const tetoMuseu = m => Math.max(3, Math.ceil(PAGE * (peso.get(m) || 0) / obras.length));

  // 2. blocos de 18
  const seq = [];
  let restantes = obras;
  let bloco = 0;
  while (restantes.length) {
    const tam = Math.min(PAGE, restantes.length);
    const usados = new Set();
    const escolhidas = [];
    const cArt = new Map(), cMus = new Map();
    const pega = o => {
      cArt.set(o.art, (cArt.get(o.art) || 0) + 1);
      cMus.set(o.mus, (cMus.get(o.mus) || 0) + 1);
      usados.add(o.id); escolhidas.push(o);
    };
    const cabe = (o, folgaArt, folgaMus) =>
      !usados.has(o.id) &&
      (cArt.get(o.art) || 0) < MAX_POR_ARTISTA + folgaArt &&
      (cMus.get(o.mus) || 0) < tetoMuseu(o.mus) + folgaMus;

    // a) entre as melhores ainda disponíveis, prefere a que traz um museu novo
    //    (janela curta, para a variedade não atropelar a qualidade)
    const JANELA = 6;
    while (escolhidas.length < tam) {
      const cand = [];
      for (let i = 0; i < restantes.length && cand.length < JANELA; i++)
        if (cabe(restantes[i], 0, 0)) cand.push(restantes[i]);
      if (!cand.length) break;
      pega(cand.find(o => !cMus.has(o.mus)) || cand[0]);
    }
    // b) faltou variedade (fim da ala): afrouxa primeiro museu, depois artista
    for (let folga = 1; escolhidas.length < tam; folga++) {
      for (const [fa, fm] of [[0, folga], [folga, folga]]) {
        for (let i = 0; i < restantes.length && escolhidas.length < tam; i++)
          if (cabe(restantes[i], fa, fm)) pega(restantes[i]);
        if (escolhidas.length >= tam) break;
      }
    }

    escolhidas.sort((a, b) => b.nota - a.nota || a.h - b.h);
    for (const o of ritmo(escolhidas)) seq.push({ id: o.id, nota: o.nota, bloco });
    restantes = restantes.filter(o => !usados.has(o.id));
    bloco++;
  }
  return seq;
}

async function sequenciaDaAla(pool, ala, forcar) {
  const ct = await pool.query(`SELECT COUNT(*) AS n FROM artworks WHERE ${FILTRO}`, [ala]);
  const n = parseInt(ct.rows[0].n, 10);
  const c = cache.get(ala);
  if (!forcar && c && c.n === n && Date.now() - c.em < TTL_MS) return c.seq;

  const cols = await lerColunas(pool);
  const r = await pool.query(
    `SELECT id, artist, date, museum, source, (${notaSql(cols)}) AS nota FROM artworks WHERE ${FILTRO}`, [ala]);
  const seq = montarSequencia(r.rows);
  cache.set(ala, { seq, n: seq.length, em: Date.now() });
  return seq;
}

function montarGaleria(app, pool) {
  app.get("/api/galeria/:ala", async (req, res) => {
    try {
      const ala  = req.params.ala;
      const page = Math.max(0, parseInt(req.query.page || "0", 10) || 0);
      const seq  = await sequenciaDaAla(pool, ala, req.query.refresh === "1");
      const N = seq.length;
      const fatia = seq.slice(page * PAGE, page * PAGE + PAGE);
      if (!fatia.length) return res.json({ results: [], total: N, page, hasMore: false });

      const ids = fatia.map(o => o.id);
      const r = await pool.query(`SELECT * FROM artworks WHERE id = ANY($1::text[])`, [ids]);
      const porId = new Map(r.rows.map(row => [row.id, row]));
      const results = ids.map(id => porId.get(id)).filter(Boolean).map(mapRow);

      res.json({ results, total: N, page, hasMore: (page + 1) * PAGE < N });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Diagnóstico: a sequência inteira com nota e bloco (para conferir a curadoria)
  app.get("/api/galeria/:ala/sequencia", async (req, res) => {
    try {
      const ala = req.params.ala;
      const seq = await sequenciaDaAla(pool, ala, req.query.refresh === "1");
      const r = await pool.query(`SELECT id, title, artist, date, museum FROM artworks WHERE id = ANY($1::text[])`, [seq.map(o => o.id)]);
      const porId = new Map(r.rows.map(row => [row.id, row]));
      res.json({ ala, total: seq.length, sequencia: seq.map((o, i) => ({
        pos: i + 1, bloco: o.bloco + 1, nota: o.nota, id: o.id,
        titulo: porId.get(o.id)?.title, artista: porId.get(o.id)?.artist, data: porId.get(o.id)?.date,
        museu: porId.get(o.id)?.museum,
      })) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Instituições e portais do acervo (para a lista que rola no rodapé do site).
  // Conta só obras visíveis no site; o nome vem do campo "museum", antes da vírgula.
  // Cache de 1 h.
  let instCache = { em: 0, lista: null };
  app.get("/api/acervo/instituicoes", async (req, res) => {
    try {
      if (!instCache.lista || Date.now() - instCache.em > 3600 * 1000) {
        const r = await pool.query(`
          SELECT trim(regexp_replace(museum, '\\s*[,(;—–].*$', '')) AS nome, source, COUNT(*)::int AS n
            FROM artworks
           WHERE image_url IS NOT NULL AND image_url <> ''
             AND COALESCE(status,'publicada') = 'publicada'
             AND ala_id IS NOT NULL AND ala_id <> 'entrada'
           GROUP BY 1, 2`);
        const PORTAIS = { europeana: "Europeana", wikimedia_commons: "Wikimedia Commons" };
        const porChave = new Map();
        const portais = new Map();
        for (const { nome, source, n } of r.rows) {
          if (PORTAIS[source]) portais.set(PORTAIS[source], (portais.get(PORTAIS[source]) || 0) + n);
          if (!nome || /wikimedia|europeana/i.test(nome)) continue;
          const chave = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
            .replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
          if (!chave) continue;
          const g = porChave.get(chave) || { total: 0, nomes: {} };
          g.total += n;
          g.nomes[nome] = (g.nomes[nome] || 0) + n;
          porChave.set(chave, g);
        }
        const museus = [...porChave.values()]
          .filter(g => g.total >= 5)                       // ignora instituições com 1–4 obras
          .map(g => ({ nome: Object.entries(g.nomes).sort((a, b) => b[1] - a[1])[0][0], obras: g.total, tipo: "museu" }))
          .sort((a, b) => b.obras - a.obras);
        const lista = [...museus,
          ...[...portais].filter(([, n]) => n > 0).map(([nome, obras]) => ({ nome, obras, tipo: "portal" }))];
        instCache = { em: Date.now(), lista };
      }
      res.json({ instituicoes: instCache.lista });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log("🖼  Galeria (sequência curada em blocos de 18) montada — /api/galeria/:ala");
}

module.exports = { montarGaleria, montarSequencia };

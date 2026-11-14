// server/fichas.js — Arrumação das fichas pela própria fonte
// ─────────────────────────────────────────────────────────────────────────────
// Princípio: nenhuma ficha é "adivinhada". Cada obra é rebuscada pelo ID que ela
// já carrega (met_…, aic_…, cleveland_…, europeana_…, wikidata_Q…, arquivo do
// Commons, inventário do Rijksmuseum) e, quando possível, conferida no Wikidata
// pelo número de inventário. O resultado vira uma PROPOSTA — nada é gravado na
// ficha até você aceitar em /fichas.
//
//   1. DIAGNÓSTICO — marca defeitos (título que é nome de arquivo, código de
//      museu, tudo em maiúsculas, artista vazio/"Unknown"/com datas, sem data).
//   2. REBUSCA     — consulta o registro exato na API de origem.
//   3. WIKIDATA    — confirma artista e data; traz o título nos 6 idiomas.
//   4. PROPOSTA    — grava em ficha_proposta com a confiança (alta/média) e os
//                    motivos. Fichas já corretas ficam marcadas como "ok".
//   5. REVISÃO     — você aceita, edita ou rejeita em /fichas. Aceitar guarda a
//                    ficha anterior (ficha_anterior) e permite desfazer.
//
// Fichas corrigidas à mão (aqui ou na /triagem) ficam com ficha_manual=TRUE e o
// agente nunca mais mexe nelas.
//
// ─── ALTERAÇÃO 14/11/2026 (identificação) ────────────────────────────────────
// • O ID da fonte agora é achado em qualquer posição do nome da obra:
//   curated_met_aic_102227 → AIC 102227 · seed_met_4361 → Met 4361 ·
//   seed_cle_… → Cleveland · seed_rks_SK_A_1234 → Rijksmuseum SK-A-1234 ·
//   commons_<pageid> → arquivo do Commons pelo pageid.
// • CONFERÊNCIA DE IMAGEM: a imagem guardada (inclusive no R2) é comparada com a
//   imagem do registro da fonte — pela URL quando dá, senão por "impressão
//   digital" visual (dHash 64 bits, via jpeg-js). Resultado em imagem_check:
//   confere / diverge / duvidosa / nao_verificavel / sem_ref.
// • mesmoArtista: ignora "the Elder/Younger/Jr." e prenomes comuns (Thomas,
//   Hans, Jan…); "Workshop/Follower/After/Attributed" diferente vira motivo.
// • Aba "Imagem" no painel + ação "mandar para a Entrada".
//
// COMO LIGAR (1 linha no server.js, ANTES do app.get("*")):
//     require("./fichas").montarFichas(app, pool);
//
// Variáveis: EUROPEANA_KEY (já usada no importador). Senha opcional para gravar:
// FICHAS_SENHA (ou, na falta dela, NOTICIAS_SENHA).
// ─────────────────────────────────────────────────────────────────────────────

const { paginaFichas } = require("./fichas_painel");

const UA = "GermanusArt/1.0 (https://germanus.art; contato@germanus.art)";
const WD_API    = "https://www.wikidata.org/w/api.php";
const WD_SPARQL = "https://query.wikidata.org/sparql";
const COMMONS   = "https://commons.wikimedia.org/w/api.php";
const EUROPEANA_KEY = () => process.env.EUROPEANA_KEY || "";

// Coleções no Wikidata (para casar pelo nº de inventário)
const COLECAO = {
  met: "Q160236", aic: "Q239303", cleveland: "Q657415", rijks: "Q190804",
};
const ANONIMO_QIDS = new Set(["Q4233718", "Q3570070"]); // anonymous / unknown

let estado = novoEstado();
function novoEstado() {
  return { rodando: false, parar: false, escopo: null, alvo: 0, feitas: 0,
           propostas: 0, ok: 0, sem_fonte: 0, erros: 0, ultima: "", ultimo_erro: null,
           inicio: 0, fim: 0, porFonte: {}, modo: "fichas", imagens: {} };
}

// ─── utilidades de texto ─────────────────────────────────────────────────────
const pausa = ms => new Promise(r => setTimeout(r, ms));

function semHtml(s) {
  return String(s ?? "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}
function linha(s) { return semHtml(s).split("\n")[0].trim(); }
function norm(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(s) { return norm(s).split(" ").filter(t => t.length > 2); }
function semelhanca(a, b) { // Jaccard de palavras
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let i = 0; for (const t of A) if (B.has(t)) i++;
  return i / (A.size + B.size - i);
}
// Qualificadores de atribuição: "Workshop of X" NÃO é "X".
const RX_QUALIF = /\b(attributed to|workshop of|studio of|follower of|followers of|circle of|school of|manner of|style of|copy after|after|imitator of|atelier de|cercle de|suiveur de|entourage de|d'apres|d apres|atribuido a|oficina de|seguidor de|escola de|bottega di|cerchia di|seguace di|scuola di|toegeschreven aan|navolger van|werkplaats van)\b/i;
const GERACAO = /\b(elder|younger|il vecchio|il giovane|l'ancien|le jeune|de oude|de jonge)\b/i;
const PARTICULAS = new Set(["the","elder","younger","jr","sr","junior","senior","de","van","von","der","den","la","le","da","di","del","della","y","il","ii","iii","jonge","oude"]);
const PRENOMES = new Set(["john","thomas","william","george","charles","james","henry","jean","pierre","jacques","louis","henri","hans","jacob","pieter","peter","johann","johannes","giovanni","francesco","antonio","juan","francisco","jose","maria","anna","marie","paul","edward","robert","richard","joseph","frans","cornelis","willem","abraham","david","carl","karl","friedrich","ludwig","andrea","domenico","pietro","giuseppe","nicolas","claude","francois","alexander","ivan","vasily"]);
function nucleoArtista(a) {
  const s = norm(limparArtista(a).replace(RX_QUALIF, " "));
  return s.split(" ").filter(t => t.length > 1 && !PARTICULAS.has(t));
}
function geracao(a) { const m = String(a || "").match(GERACAO); return m ? norm(m[1]) : ""; }
function mesmoArtista(a, b) {
  const ta = nucleoArtista(a), tb = nucleoArtista(b);
  if (!ta.length || !tb.length) return false;
  const ga = geracao(a), gb = geracao(b);
  if (ga && gb && ga !== gb) return false;                 // Brueghel o Velho ≠ o Jovem
  const sa = ta[ta.length - 1], sb = tb[tb.length - 1];
  if (sa === sb && sa.length > 2 && !PRENOMES.has(sa)) return true;   // mesmo sobrenome
  // ordem invertida ("Monet, Claude"): o sobrenome de um aparece no outro
  if ((sa.length > 3 && !PRENOMES.has(sa) && tb.includes(sa)) || (sb.length > 3 && !PRENOMES.has(sb) && ta.includes(sb))) return true;
  const comuns = ta.filter(t => t.length > 3 && tb.includes(t) && !PRENOMES.has(t));
  if (comuns.length >= 2) return true;
  // nome de um termo só (Rembrandt, Titian, Raphael) contra o nome completo
  if ((ta.length === 1 || tb.length === 1) && comuns.length === 1) return true;
  return false;
}
function atribuicaoDifere(a, b) {
  return RX_QUALIF.test(String(a || "")) !== RX_QUALIF.test(String(b || ""));
}
const RX_ANON = /^(unknown|anonymous|anonyme|anonimo|anônimo|desconhecido|artista russo|unidentified|onbekend)/i;
function ehAnonimo(a) { return !String(a || "").trim() || RX_ANON.test(String(a).trim()); }

// Artista limpo: "Claude Monet\nFrench, 1840–1926" / "Claude Monet (French, 1840-1926)" → "Claude Monet"
function limparArtista(a) {
  let s = linha(a);
  s = s.replace(/\(\s*[^)]*\d{3,4}[^)]*\)/g, "")                       // (French, 1840–1926)
       .replace(/,?\s*\b(\d{3,4})\s*[–-]\s*(\d{2,4})\b.*$/, "")           // , 1840–1926
       .replace(/\s{2,}/g, " ").replace(/[,;:\s]+$/, "").trim();
  if (ehAnonimo(s)) return "Desconhecido";
  return s;
}
function limparTitulo(t) {
  let s = linha(t).replace(/\s{2,}/g, " ").replace(/[\s,;:]+$/, "").trim();
  if (/^\(?sem t[ií]tulo\)?$/i.test(s) || /^untitled$/i.test(s)) return s ? "Sem título" : "";
  return s;
}
function limparData(d) {
  let s = semHtml(d).replace(/\n/g, " ").replace(/\s{2,}/g, " ").trim();
  if (s.length > 40) { const m = s.match(/\b(1[0-9]{3}|20[0-2][0-9])(\s*[–-]\s*\d{2,4})?/); s = m ? m[0] : ""; }
  return s;
}
// rawurlencode do PHP (como o Wikidata grava o P18)
function rawUrl(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

// ─── 1. diagnóstico ──────────────────────────────────────────────────────────
const PESO = { titulo_vazio: 5, titulo_arquivo: 4, titulo_com_artista: 3, artista_vazio: 3,
               artista_sujo: 2, titulo_maiusculas: 2, titulo_longo: 1, data_vazia: 1, data_suja: 1 };
const DEFEITO_ROTULO = {
  titulo_vazio: "título vazio", titulo_arquivo: "título é nome de arquivo/código",
  titulo_com_artista: "título com o nome do artista", titulo_maiusculas: "título em maiúsculas",
  titulo_longo: "título longo demais", artista_vazio: "artista vazio/desconhecido",
  artista_sujo: "artista com datas/nacionalidade", data_vazia: "sem data", data_suja: "data com texto",
};

function defeitos(o) {
  const d = [];
  const bruto = String(o.title || "");
  const t = linha(bruto);
  if (!t || /^\(?sem t[ií]tulo\)?$/i.test(t) || t === o.id) d.push("titulo_vazio");
  else {
    if (/\.(jpe?g|png|tiff?|gif|webp)\b/i.test(bruto) || /_/.test(t) ||
        /\b(DP|DT|RM|MET)[\s_-]?\d{3,}/i.test(t) || /\b(SK|RP|BK|NG)[-_ ][A-Z][-_ ]?\d+/.test(t) ||
        /\s[-–]\s.+\b1[0-9]{3}\s*$/.test(t) ||
        /\b(google art project|wga\d+|hi-?res|cropped|edit(ed)?|retouched)\b/i.test(t)) d.push("titulo_arquivo");
    if (t.length > 8 && t === t.toUpperCase() && /[A-Z]{4}/.test(t)) d.push("titulo_maiusculas");
    if (t.length > 140) d.push("titulo_longo");
    const sob = tokens(o.artist).pop();
    if (sob && sob.length > 3 && !ehAnonimo(o.artist) && norm(t).includes(sob) && /\s[-–]\s|\b1[0-9]{3}\b/.test(t))
      d.push("titulo_com_artista");
  }
  const a = String(o.artist || "");
  if (ehAnonimo(a)) d.push("artista_vazio");
  else if (/\n|<|\(\s*[^)]*\d{3,4}|\d{4}\s*[–-]\s*\d{2,4}|\b(French|Dutch|Italian|Spanish|German|Flemish|British|American|English|Russian|Austrian|Belgian|Swedish|Danish|Norwegian),/.test(a))
    d.push("artista_sujo");
  const dt = String(o.date || "");
  if (!/\d{3,4}/.test(dt)) d.push("data_vazia");
  else if (dt.length > 40 || /<|\n/.test(dt)) d.push("data_suja");
  return d;
}
const pesoDefeitos = d => d.reduce((s, k) => s + (PESO[k] || 1), 0);

// ─── HTTP educado ────────────────────────────────────────────────────────────
async function pegar(url, { timeout = 20000, json = true, accept } = {}) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, ...(accept ? { Accept: accept } : {}) },
      signal: AbortSignal.timeout(timeout),
    });
    if (r.status === 429 || r.status === 503) { await pausa(3000); continue; }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status} em ${new URL(url).hostname}`);
    return json ? r.json() : r.text();
  }
  throw new Error(`limite de requisições em ${new URL(url).hostname}`);
}

// ─── 2. fontes ───────────────────────────────────────────────────────────────
// Cada leitor devolve { title, artist, date, medium, dimensions, museum, url,
//                       qid?, inventario?, colecao?, fonte } ou null (não achou).

async function lerMet(n) {
  const o = await pegar(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${n}`);
  if (!o || !o.objectID) return null;
  const qid = (o.objectWikidata_URL || "").match(/Q\d+/)?.[0] || null;
  return {
    fonte: "met", title: o.title, artist: o.artistDisplayName || (o.artistRole ? "" : "Desconhecido"),
    date: o.objectDate, medium: o.medium, dimensions: o.dimensions,
    museum: "The Metropolitan Museum of Art, Nova York, EUA", url: o.objectURL,
    qid, inventario: o.accessionNumber, colecao: COLECAO.met,
    imagem: o.primaryImageSmall || o.primaryImage || null,
  };
}

async function lerAIC(n) {
  const campos = "id,title,artist_title,artist_display,date_display,medium_display,dimensions,main_reference_number,image_id";
  const d = await pegar(`https://api.artic.edu/api/v1/artworks/${n}?fields=${campos}`);
  const o = d?.data;
  if (!o || !o.id) return null;
  return {
    fonte: "aic", title: o.title, artist: o.artist_title || linha(o.artist_display),
    date: o.date_display, medium: o.medium_display, dimensions: o.dimensions,
    museum: "Art Institute of Chicago, Illinois, EUA", url: `https://www.artic.edu/artworks/${o.id}`,
    inventario: o.main_reference_number, colecao: COLECAO.aic,
    imagem: o.image_id ? `https://www.artic.edu/iiif/2/${o.image_id}/full/400,/0/default.jpg` : null,
  };
}

async function lerCleveland(n) {
  const d = await pegar(`https://openaccess-api.clevelandart.org/api/artworks/${n}`);
  const o = d?.data;
  if (!o || !o.id) return null;
  return {
    fonte: "cleveland", title: o.title, artist: o.creators?.[0]?.description || "",
    date: o.creation_date, medium: o.technique, dimensions: o.measurements,
    museum: "Cleveland Museum of Art, Ohio, EUA", url: o.url || `https://www.clevelandart.org/art/${o.id}`,
    inventario: o.accession_number, colecao: COLECAO.cleveland,
    imagem: o.images?.web?.url || null,
  };
}

// Europeana: o ID exato está no link da ficha (guid); o id interno foi achatado
function idEuropeana(o) {
  const m = String(o.external_url || "").match(/europeana\.eu\/(?:[a-z]{2}\/)?item(\/[^/?#]+\/[^?#]+)/);
  if (m) return decodeURIComponent(m[1]);
  const r = String(o.id || "").replace(/^europeana_/, "").match(/^(\d+)_(.+)$/);
  return r ? `/${r[1]}/${r[2]}` : null;
}
function pegaLang(mapa, ordem = ["en", "def", "pt", "fr", "es", "it", "de", "nl"]) {
  if (!mapa) return "";
  if (Array.isArray(mapa)) return mapa[0] || "";
  for (const k of ordem) if (mapa[k]?.length) return mapa[k][0];
  const v = Object.values(mapa)[0];
  return Array.isArray(v) ? v[0] || "" : "";
}
async function lerEuropeana(o) {
  const key = EUROPEANA_KEY();
  if (!key) throw new Error("EUROPEANA_KEY ausente no Railway");
  const rid = idEuropeana(o);
  if (!rid) return null;
  const d = await pegar(`https://api.europeana.eu/record/v2${rid}.json?wskey=${encodeURIComponent(key)}`);
  const ob = d?.object;
  if (!ob) return null;
  const proxies = ob.proxies || [];
  const prov = proxies.find(p => !p.europeanaProxy) || proxies[0] || {};
  const eur  = proxies.find(p => p.europeanaProxy) || {};
  const campo = k => prov[k] || eur[k];
  // criador pode vir como URI de agente → resolve pelo rótulo
  let artist = pegaLang(campo("dcCreator"));
  if (/^https?:\/\//.test(artist)) {
    const ag = (ob.agents || []).find(a => a.about === artist);
    artist = ag ? pegaLang(ag.prefLabel) : "";
  }
  let date = pegaLang(campo("dctermsCreated")) || pegaLang(campo("dcDate"));
  if (/^https?:\/\//.test(date)) {
    const ts = (ob.timespans || []).find(t => t.about === date);
    date = ts ? pegaLang(ts.prefLabel) : "";
  }
  const agg = (ob.aggregations || [])[0] || {};
  const museu = pegaLang(agg.edmDataProvider) || o.museum;
  const ids = [].concat(...Object.values(campo("dcIdentifier") || {}));
  const inventario = ids.find(x => /[A-Z]{1,4}[-\s]?[A-Z]?[-\s]?\d/.test(x) && x.length < 30) || ids[0] || null;
  return {
    fonte: "europeana", title: pegaLang(campo("dcTitle")), artist, date,
    medium: pegaLang(campo("dctermsMedium")), dimensions: pegaLang(campo("dctermsExtent")),
    museum: museu, url: `https://www.europeana.eu/item${rid}`,
    inventario, colecao: /rijksmuseum/i.test(museu) ? COLECAO.rijks : null,
    imagem: ob.europeanaAggregation?.edmPreview || pegaLang(agg.edmIsShownBy) || null,
  };
}

// Commons: nome do arquivo a partir da URL da imagem
function arquivoCommons(url) {
  const u = String(url || "");
  let m = u.match(/Special:FilePath\/([^?#]+)/i);
  if (m) return decodeURIComponent(m[1]).replace(/_/g, " ");
  if (!/upload\.wikimedia\.org/.test(u)) return null;
  const partes = u.split("?")[0].split("/");
  const i = partes.indexOf("thumb");
  const nome = i >= 0 ? partes[i + 3] : partes[partes.length - 1];
  return nome ? decodeURIComponent(nome).replace(/_/g, " ") : null;
}
async function lerCommons(arquivo) {
  const q = `${COMMONS}?action=query&format=json&titles=${encodeURIComponent("File:" + arquivo)}`
    + `&prop=imageinfo&iiprop=extmetadata&iiextmetadatalanguage=en`;
  const d = await pegar(q);
  const pg = d?.query?.pages ? Object.values(d.query.pages)[0] : null;
  if (!pg || pg.missing !== undefined || !pg.pageid) return null;
  const meta = pg.imageinfo?.[0]?.extmetadata || {};
  let qid = null;
  // dados estruturados do Commons: P6243 = "representação digital de" (a pintura no Wikidata)
  try {
    const sdc = await pegar(`${COMMONS}?action=wbgetentities&format=json&ids=M${pg.pageid}`);
    const st = sdc?.entities?.["M" + pg.pageid]?.statements || {};
    qid = st.P6243?.[0]?.mainsnak?.datavalue?.value?.id || null;
  } catch { /* segue sem */ }
  if (!qid) {
    // quem usa este arquivo como imagem (P18) no Wikidata
    const uri = `http://commons.wikimedia.org/wiki/Special:FilePath/${rawUrl(arquivo.replace(/ /g, " "))}`;
    const linhas = await sparql(`SELECT ?item WHERE { ?item wdt:P18 <${uri}> . } LIMIT 3`).catch(() => []);
    if (linhas.length === 1) qid = linhas[0].item.value.split("/").pop();
  }
  return {
    fonte: "commons", title: meta.ObjectName?.value || "", artist: meta.Artist?.value || "",
    date: meta.DateTimeOriginal?.value || "", medium: "", dimensions: "",
    museum: "", url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(("File:" + arquivo).replace(/ /g, "_"))}`,
    qid, imagem: miniCommons(arquivo),
  };
}
function miniCommons(arquivo) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(arquivo).replace(/ /g, "_"))}?width=400`;
}
// commons_<pageid>: o arquivo é achado pelo pageid (vale mesmo depois do R2)
async function lerCommonsPorPageid(pid) {
  const d = await pegar(`${COMMONS}?action=query&format=json&pageids=${pid}`);
  const pg = d?.query?.pages?.[pid];
  if (!pg || pg.missing !== undefined || !pg.title) return null;
  return lerCommons(pg.title.replace(/^File:/, ""));
}

// ID da fonte em qualquer posição do nome da obra
function fonteDoId(o) {
  const id = String(o.id || "");
  let m;
  if ((m = id.match(/(?:^|_)(met|aic|cle|cleveland)_(\d+)$/))) return { tipo: m[1] === "cle" ? "cleveland" : m[1], n: m[2] };
  if ((m = id.match(/^commons_(\d+)$/))) return { tipo: "commons_pageid", n: m[1] };
  if ((m = id.match(/^seed_rks_(.+)$/))) return { tipo: "rijks", n: m[1].replace(/_/g, "-") };
  return null;
}

// Rijksmuseum: inventário no id (rijks_SK-A-1234) ou na URL IIIF
function inventarioRijks(o) {
  const m = String(o.id || "").match(/^rijks_(.+)$/) ||
            String(o.image_url || "").match(/iiif\.rijksmuseum\.nl\/iiif\/([^/]+)/) ||
            String(o.external_url || "").match(/rijksmuseum\.nl\/[a-z]{2}\/collection\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ─── 3. Wikidata ─────────────────────────────────────────────────────────────
async function sparql(q) {
  const d = await pegar(`${WD_SPARQL}?format=json&query=${encodeURIComponent(q)}`,
    { accept: "application/sparql-results+json", timeout: 30000 });
  return d?.results?.bindings || [];
}
function litSparql(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }

async function qidPorInventario(inv, colecao) {
  if (!inv) return null;
  const q = colecao
    ? `SELECT ?item WHERE { ?item wdt:P217 ${litSparql(inv)} ; wdt:P195 wd:${colecao} . } LIMIT 3`
    : `SELECT ?item WHERE { ?item wdt:P217 ${litSparql(inv)} . } LIMIT 3`;
  const l = await sparql(q);
  return l.length === 1 ? l[0].item.value.split("/").pop() : null;
}

const LINGUAS = ["pt", "en", "fr", "es", "it", "de"];
async function obraWikidata(qid) {
  const d = await pegar(`${WD_API}?action=wbgetentities&format=json&ids=${qid}`
    + `&props=labels|claims&languages=${LINGUAS.join("|")}|nl`);
  const e = d?.entities?.[qid];
  if (!e || e.missing !== undefined) return null;
  const cl = e.claims || {};
  const val = (p) => (cl[p] || []).filter(c => c.rank !== "deprecated").map(c => c.mainsnak?.datavalue?.value).filter(Boolean);

  // títulos: P1476 (título oficial) por idioma, senão o rótulo
  const titulos = {};
  for (const v of val("P1476")) if (v.language && LINGUAS.includes(v.language) && !titulos[v.language]) titulos[v.language] = v.text;
  for (const L of LINGUAS) if (!titulos[L] && e.labels?.[L]) titulos[L] = e.labels[L].value;
  const tituloBase = titulos.en || val("P1476")[0]?.text || e.labels?.nl?.value || Object.values(titulos)[0] || "";

  // autor: P170; se for anônimo ou faltar, tenta P1773 (atribuído a)
  let autorQ = val("P170").map(v => v.id).find(id => !ANONIMO_QIDS.has(id)) || null;
  let atribuido = false;
  if (!autorQ) { autorQ = val("P1773").map(v => v.id)[0] || null; atribuido = !!autorQ; }
  let artist = "";
  if (autorQ) {
    const a = await pegar(`${WD_API}?action=wbgetentities&format=json&ids=${autorQ}&props=labels&languages=en|pt|fr|nl|de|es|it`);
    const lb = a?.entities?.[autorQ]?.labels || {};
    artist = (lb.en || lb.pt || lb.fr || lb.nl || lb.de || lb.es || lb.it || {}).value || "";
    if (atribuido && artist) artist = "Attributed to " + artist;
  } else if (val("P170").some(v => ANONIMO_QIDS.has(v.id))) artist = "Desconhecido";

  // data: P571 (criação); precisão 9 = ano
  let date = "";
  const t = val("P571")[0];
  if (t?.time) {
    const ano = parseInt(t.time.slice(1, 5), 10);
    if (t.precision >= 9) date = String(ano);
    else if (t.precision === 8) date = `${Math.floor(ano / 10) * 10}s`;
    else if (t.precision === 7) date = `séc. ${Math.ceil(ano / 100)}`;
  }
  const p18 = val("P18")[0];
  return { qid, titulos, title: tituloBase, artist, date, imagem: p18 ? miniCommons(p18) : null };
}

// ─── 4. montar a proposta de uma obra ────────────────────────────────────────
const fonteRijks = inv => ({ fonte: "rijksmuseum", inventario: inv, colecao: COLECAO.rijks,
  museum: "Rijksmuseum, Amsterdam, Países Baixos",
  url: `https://www.rijksmuseum.nl/en/collection/${encodeURIComponent(inv)}` });

// a) leitura na fonte de origem, pelo ID (em qualquer posição do nome)
async function acharFonte(o) {
  const src = String(o.source || "");
  let m;
  const f = fonteDoId(o);
  if (f?.tipo === "met") return lerMet(f.n);
  if (f?.tipo === "aic") return lerAIC(f.n);
  if (f?.tipo === "cleveland") return lerCleveland(f.n);
  if (src === "europeana" || /^europeana_/.test(o.id)) return lerEuropeana(o);
  if ((m = String(o.id).match(/^wikidata_(Q\d+)$/))) return { fonte: "wikidata", qid: m[1] };
  if (f?.tipo === "commons_pageid") { const r = await lerCommonsPorPageid(f.n); if (r) return r; }
  if (f?.tipo === "rijks") return fonteRijks(f.n);
  const arq = arquivoCommons(o.image_url) || arquivoCommons(o.hd_url);
  const inv = inventarioRijks(o);
  if (inv) return fonteRijks(inv);
  if (arq) return lerCommons(arq);
  return null;
}
async function wikidataDaFonte(fonte) {
  const qid = fonte.qid || await qidPorInventario(fonte.inventario, fonte.colecao);
  return qid ? obraWikidata(qid) : null;
}

// ─── conferência de imagem ───────────────────────────────────────────────────
let jpeg = null;
try { jpeg = require("jpeg-js"); } catch { /* sem a biblioteca: só compara por URL */ }

// identidade da imagem pela URL (quando a imagem guardada ainda é a do museu)
function chaveUrl(u) {
  u = String(u || ""); let m;
  if ((m = u.match(/artic\.edu\/iiif\/2\/([0-9a-f-]{30,})/i))) return "aic:" + m[1].toLowerCase();
  if ((m = u.match(/images\.metmuseum\.org\/.+\/([^/?#]+?)\.(?:jpe?g|png|tiff?)/i))) return "met:" + m[1].toLowerCase();
  const arq = arquivoCommons(u);
  if (arq) return "commons:" + norm(arq);
  return null;
}
function miniatura(u) {
  u = String(u || "");
  if (u.includes("artic.edu/iiif")) return u.replace(/\/full\/[^/]+\//, "/full/400,/");
  if (u.includes("upload.wikimedia.org") && u.includes("/thumb/")) return u.replace(/\/\d+px-/, "/400px-");
  if (/Special:FilePath/i.test(u)) return u.replace(/([?&])width=\d+/, "$1width=400");
  return u;
}
async function baixarImagem(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25000), redirect: "follow" });
  if (!r.ok) throw new Error(`imagem HTTP ${r.status}`);
  const len = +(r.headers.get("content-length") || 0);
  if (len > 30e6) throw new Error("imagem grande demais para conferir");
  return Buffer.from(await r.arrayBuffer());
}
// dHash 9x8 → 64 bits; só JPEG (o formato de quase todo o acervo)
function impressao(buf) {
  if (!jpeg || !buf || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  const im = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, tolerantDecoding: true,
                                maxResolutionInMP: 40, maxMemoryUsageInMB: 256 });
  const { width: w, height: h, data } = im, W = 9, H = 8, g = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.floor(x * w / W), x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / W));
    const y0 = Math.floor(y * h / H), y1 = Math.max(y0 + 1, Math.floor((y + 1) * h / H));
    const sx = Math.max(1, Math.floor((x1 - x0) / 12)), sy = Math.max(1, Math.floor((y1 - y0) / 12));
    let soma = 0, c = 0;
    for (let yy = y0; yy < y1; yy += sy) for (let xx = x0; xx < x1; xx += sx) {
      const i = (yy * w + xx) * 4; soma += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; c++;
    }
    g[y * W + x] = soma / c;
  }
  const bits = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < 8; x++) bits.push(g[y * W + x] > g[y * W + x + 1] ? 1 : 0);
  return { bits, proporcao: w / h };
}
// limites calibrados para reprodução da mesma pintura (recortes/cor diferentes)
const CONFERE_ATE = 10, DIVERGE_DESDE = 22;
async function conferirImagem(o, fonte, wd) {
  const ref = fonte?.imagem || wd?.imagem || null;
  const base = { em: Math.floor(Date.now() / 1000), fonte_url: ref, ref_de: fonte?.imagem ? (fonte.fonte || "") : (ref ? "wikidata" : "") };
  if (!ref) return { ...base, status: "sem_ref", motivo: "a fonte não fornece imagem para comparar" };
  const atual = o.image_url || o.hd_url;
  if (!atual) return { ...base, status: "nao_verificavel", motivo: "a obra não tem imagem guardada" };
  // 1) pela URL, quando as duas são do mesmo tipo
  const k1 = chaveUrl(atual), k2 = chaveUrl(ref);
  if (k1 && k2 && k1.split(":")[0] === k2.split(":")[0])
    return { ...base, status: k1 === k2 ? "confere" : "diverge", metodo: "url" };
  // 2) pela impressão digital visual
  if (!jpeg) return { ...base, status: "nao_verificavel", motivo: "instale jpeg-js (package.json) para comparar imagens no R2" };
  try {
    const [a, b] = await Promise.all([baixarImagem(miniatura(atual)), baixarImagem(ref)]);
    const ia = impressao(a), ib = impressao(b);
    if (!ia || !ib) return { ...base, status: "nao_verificavel", motivo: "imagem em formato não-JPEG" };
    const dist = ia.bits.reduce((s, v, i) => s + (v !== ib.bits[i] ? 1 : 0), 0);
    const difProp = Math.abs(Math.log(ia.proporcao / ib.proporcao));   // 0 = mesma proporção
    let status = dist <= CONFERE_ATE ? "confere" : dist >= DIVERGE_DESDE ? "diverge" : "duvidosa";
    if (status === "duvidosa" && difProp > 0.35) status = "diverge";   // formato muito diferente
    if (status === "confere" && difProp > 0.6) status = "duvidosa";
    return { ...base, status, metodo: "visual", dist, difProp: +difProp.toFixed(2) };
  } catch (e) {
    return { ...base, status: "nao_verificavel", motivo: e.message };
  }
}
const ROTULO_IMG = { confere: "imagem confere com a fonte", diverge: "⚠ IMAGEM NÃO CONFERE com o registro da fonte",
  duvidosa: "◐ imagem parecida, mas não idêntica à da fonte — olhar", nao_verificavel: "imagem não verificável", sem_ref: "fonte sem imagem" };

async function rebuscar(o, { semImagem = false } = {}) {
  const motivos = [];
  const fonte = await acharFonte(o);
  if (!fonte) return { estado: "sem_fonte", motivos: ["a obra não traz um ID de fonte que dê para consultar"
    + (/r2\.dev|r2\.cloudflarestorage/.test(String(o.image_url)) && /^commons_\D/.test(o.id) ? " (o link original do Commons se perdeu na migração para o R2)" : "")] };

  // b) Wikidata (pelo QID direto, pelo arquivo do Commons ou pelo nº de inventário)
  let wd = null;
  try { wd = await wikidataDaFonte(fonte); }
  catch (e) { motivos.push("Wikidata indisponível agora (" + e.message + ")"); }

  const daFonte = {
    title: limparTitulo(fonte.title), artist: fonte.artist ? limparArtista(fonte.artist) : "",
    date: limparData(fonte.date),
  };
  const daWd = wd ? { title: limparTitulo(wd.title), artist: wd.artist ? limparArtista(wd.artist) : "", date: wd.date } : null;

  // c) escolha campo a campo: a fonte de origem manda; o Wikidata completa e confere
  const prop = {
    title:  daFonte.title  || daWd?.title  || "",
    artist: daFonte.artist || daWd?.artist || "",
    date:   daFonte.date   || daWd?.date   || "",
  };
  if (fonte.fonte === "commons" && daWd?.title) prop.title = daWd.title; // nome de arquivo perde para o Wikidata
  if (fonte.fonte === "commons" && daWd?.artist && !ehAnonimo(daWd.artist)) prop.artist = daWd.artist;

  // confiança
  const porId = ["met", "aic", "cleveland", "europeana", "wikidata"].includes(fonte.fonte);
  let confianca = porId || (wd && ["commons", "rijksmuseum"].includes(fonte.fonte)) ? "alta" : "media";
  if (!porId && !wd) motivos.push(fonte.fonte === "commons" ? "lido da página do arquivo no Commons, sem item no Wikidata" : "sem confirmação no Wikidata");
  if (wd && daFonte.artist && daWd?.artist && !ehAnonimo(daFonte.artist) && !ehAnonimo(daWd.artist)
      && !mesmoArtista(daFonte.artist, daWd.artist)) {
    confianca = "media"; motivos.push(`Wikidata diz outro artista: ${daWd.artist}`);
  }
  if (!ehAnonimo(o.artist) && prop.artist && atribuicaoDifere(o.artist, prop.artist)) {
    confianca = "media"; motivos.push(`atribuição diferente (oficina/seguidor/atribuído): "${linha(o.artist)}" × "${prop.artist}"`);
  }
  if (wd) motivos.push(`conferida no Wikidata (${wd.qid})`);
  if (!prop.artist && !ehAnonimo(o.artist)) prop.artist = limparArtista(o.artist); // nunca apaga autor
  if (!prop.title) prop.title = limparTitulo(o.title);
  if (!prop.date) prop.date = limparData(o.date);

  // título muito diferente de um título que parecia bom → revisar com calma
  const defAtuais = defeitos(o);
  const tituloBom = !defAtuais.some(d => d.startsWith("titulo"));
  if (tituloBom && semelhanca(o.title, prop.title) < 0.2 && norm(o.title) !== norm(prop.title)) {
    confianca = "media"; motivos.push("título proposto bem diferente do atual");
  }

  // campos de apoio: só preenchem o que está vazio
  const extra = {};
  if (!String(o.medium || "").trim() && fonte.medium) extra.medium = linha(fonte.medium).slice(0, 200);
  if (!String(o.dimensions || "").trim() && fonte.dimensions) extra.dimensions = linha(fonte.dimensions).slice(0, 200);
  if (!String(o.museum || "").trim() && fonte.museum) extra.museum = linha(fonte.museum);
  if (!String(o.external_url || "").trim() && fonte.url) extra.external_url = fonte.url;

  // d) a imagem guardada é mesmo a deste registro?
  const imagem = semImagem ? null : await conferirImagem(o, fonte, wd);
  const imgRuim = imagem && (imagem.status === "diverge" || imagem.status === "duvidosa");
  if (imagem && imagem.status !== "nao_verificavel" && imagem.status !== "sem_ref") motivos.push(ROTULO_IMG[imagem.status]
    + (imagem.dist != null ? ` (distância ${imagem.dist}/64)` : ""));
  if (imgRuim) confianca = "media";

  const muda = norm(prop.title) !== norm(o.title) || norm(prop.artist) !== norm(o.artist)
            || norm(prop.date) !== norm(o.date) || Object.keys(extra).length > 0;

  return {
    estado: muda || imgRuim ? "proposta" : "ok",
    imagem,
    proposta: {
      ...prop, ...extra, confianca, motivos, fonte: fonte.fonte, url: fonte.url || null,
      wikidata: wd?.qid || null, titulos: wd?.titulos || null, defeitos: defAtuais,
      imagem: imagem?.status || null,
    },
  };
}

// só a conferência de imagem (para as fichas já aceitas/corretas)
async function conferirSoImagem(o) {
  const fonte = await acharFonte(o);
  if (!fonte) return { em: Math.floor(Date.now() / 1000), status: "sem_ref", motivo: "sem fonte consultável" };
  let wd = null;
  if (!fonte.imagem) { try { wd = await wikidataDaFonte(fonte); } catch { /* segue */ } }
  return conferirImagem(o, fonte, wd);
}

// ─── 5. trabalho em segundo plano ────────────────────────────────────────────
const SELECT_FICHA = `id, source, title, artist, date, medium, dimensions, museum,
  image_url, hd_url, external_url, status, ala_id`;

function filtroEscopo(escopo) {
  if (escopo === "entrada") return `COALESCE(status,'publicada')='rascunho'`;
  if (escopo === "todas") return `COALESCE(status,'publicada') IN ('publicada','rascunho')`;
  return `COALESCE(status,'publicada')='publicada'`;
}

async function rodar(pool, { total, escopo, soDefeituosas }) {
  estado = { ...novoEstado(), rodando: true, escopo, alvo: total, inicio: Date.now() };
  try {
    const r = await pool.query(
      `SELECT ${SELECT_FICHA} FROM artworks
        WHERE ${filtroEscopo(escopo)} AND ficha_estado IS NULL AND NOT COALESCE(ficha_manual,false)`);
    let fila = r.rows.map(o => ({ o, p: pesoDefeitos(defeitos(o)) }));
    if (soDefeituosas) fila = fila.filter(x => x.p > 0);
    fila.sort((a, b) => b.p - a.p);
    fila = fila.slice(0, total);
    estado.alvo = fila.length;

    for (const { o } of fila) {
      if (estado.parar) break;
      estado.ultima = `${o.id} — ${linha(o.title).slice(0, 60)}`;
      try {
        const res = await rebuscar(o);
        const fonte = res.proposta?.fonte || "—";
        estado.porFonte[fonte] = (estado.porFonte[fonte] || 0) + 1;
        await pool.query(
          `UPDATE artworks SET ficha_estado=$2, ficha_proposta=$3, ficha_conferida_em=EXTRACT(EPOCH FROM NOW())::BIGINT,
                  imagem_check=COALESCE($4::jsonb, imagem_check)
            WHERE id=$1 AND NOT COALESCE(ficha_manual,false)`,
          [o.id, res.estado, JSON.stringify(res.proposta || { motivos: res.motivos || [], defeitos: defeitos(o) }),
           res.imagem ? JSON.stringify(res.imagem) : null]);
        if (res.imagem) estado.imagens[res.imagem.status] = (estado.imagens[res.imagem.status] || 0) + 1;
        if (res.estado === "proposta") estado.propostas++;
        else if (res.estado === "ok") estado.ok++;
        else estado.sem_fonte++;
      } catch (e) {
        estado.erros++; estado.ultimo_erro = `${o.id}: ${e.message}`;
        await pool.query(
          `UPDATE artworks SET ficha_estado='erro', ficha_proposta=$2, ficha_conferida_em=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=$1`,
          [o.id, JSON.stringify({ motivos: [e.message], defeitos: defeitos(o) })]).catch(() => {});
      }
      estado.feitas++;
      await pausa(350);
    }
  } catch (e) { estado.ultimo_erro = e.message; }
  estado.rodando = false; estado.fim = Date.now();
  console.log(`🗂  Fichas: ${estado.feitas} vistas · ${estado.propostas} propostas · ${estado.ok} ok · ${estado.sem_fonte} sem fonte · ${estado.erros} erros · imagens ${JSON.stringify(estado.imagens)}`);
}

// remessa só de imagens: inclui fichas já aceitas, corretas e corrigidas à mão
async function rodarImagens(pool, { total, escopo, refazer }) {
  estado = { ...novoEstado(), rodando: true, escopo, alvo: total, inicio: Date.now(), modo: "imagens" };
  try {
    const r = await pool.query(
      `SELECT ${SELECT_FICHA} FROM artworks
        WHERE ${filtroEscopo(escopo)} AND COALESCE(image_url,'')<>''
          ${refazer ? "" : "AND imagem_check IS NULL"}
        ORDER BY (source IN ('curadoria','semeador')) DESC, id LIMIT $1`, [total]);
    estado.alvo = r.rows.length;
    for (const o of r.rows) {
      if (estado.parar) break;
      estado.ultima = `${o.id} — ${linha(o.title).slice(0, 60)}`;
      try {
        const img = await conferirSoImagem(o);
        estado.imagens[img.status] = (estado.imagens[img.status] || 0) + 1;
        await pool.query(`UPDATE artworks SET imagem_check=$2 WHERE id=$1`, [o.id, JSON.stringify(img)]);
      } catch (e) { estado.erros++; estado.ultimo_erro = `${o.id}: ${e.message}`; }
      estado.feitas++;
      await pausa(300);
    }
  } catch (e) { estado.ultimo_erro = e.message; }
  estado.rodando = false; estado.fim = Date.now(); cacheDiag = null;
  console.log(`🖼  Imagens: ${estado.feitas} conferidas · ${JSON.stringify(estado.imagens)} · ${estado.erros} erros`);
}

// ─── diagnóstico agregado (cache curto) ──────────────────────────────────────
let cacheDiag = null;
async function diagnostico(pool, forcar) {
  if (!forcar && cacheDiag && Date.now() - cacheDiag.em < 120000) return cacheDiag.d;
  const r = await pool.query(
    `SELECT id, source, title, artist, date, COALESCE(status,'publicada') AS status,
            ficha_estado, COALESCE(ficha_manual,false) AS manual,
            ficha_proposta->>'confianca' AS conf
       FROM artworks WHERE COALESCE(status,'publicada') IN ('publicada','rascunho')`);
  const d = { total: 0, publicadas: 0, com_defeito: 0, por_defeito: {}, por_fonte: {},
              estados: {}, pendentes: { alta: 0, media: 0 }, manuais: 0 };
  for (const o of r.rows) {
    d.total++; if (o.status === "publicada") d.publicadas++;
    if (o.manual) d.manuais++;
    const est = o.ficha_estado || "nao_vista";
    d.estados[est] = (d.estados[est] || 0) + 1;
    if (est === "proposta") d.pendentes[o.conf === "alta" ? "alta" : "media"]++;
    if (o.status !== "publicada" || est === "aceita" || o.manual) continue;
    const df = defeitos(o);
    if (df.length) {
      d.com_defeito++;
      for (const k of df) d.por_defeito[k] = (d.por_defeito[k] || 0) + 1;
      const f = String(o.source || "?");
      d.por_fonte[f] = (d.por_fonte[f] || 0) + 1;
    }
  }
  d.imagens = {};
  try {
    const ri = await pool.query(
      `SELECT imagem_check->>'status' AS s, COUNT(*)::int AS n FROM artworks
        WHERE imagem_check IS NOT NULL AND COALESCE(status,'publicada')='publicada' GROUP BY 1`);
    for (const x of ri.rows) d.imagens[x.s] = x.n;
  } catch { /* coluna ainda não criada */ }
  cacheDiag = { em: Date.now(), d };
  return d;
}

// ─── rotas ───────────────────────────────────────────────────────────────────
function montarFichas(app, pool) {
  (async () => {
    try {
      for (const c of ["ficha_estado TEXT", "ficha_proposta JSONB", "ficha_anterior JSONB",
                       "ficha_conferida_em BIGINT", "ficha_manual BOOLEAN DEFAULT FALSE",
                       "ficha_titulos JSONB", "wikidata_id TEXT", "imagem_check JSONB",
                       "medium TEXT", "dimensions TEXT", "external_url TEXT"])
        await pool.query(`ALTER TABLE artworks ADD COLUMN IF NOT EXISTS ${c}`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_art_ficha_estado ON artworks(ficha_estado)`);
      console.log("🗂  Fichas — colunas prontas");
    } catch (e) { console.log("🗂  Fichas — migração:", e.message); }
  })();

  const senhaOk = (req, res) => {
    const senha = process.env.FICHAS_SENHA || process.env.NOTICIAS_SENHA;
    if (!senha || req.get("x-senha") === senha) return true;
    res.status(401).json({ error: "senha inválida" }); return false;
  };
  const listaIds = b => (Array.isArray(b?.ids) ? b.ids : []).map(s => String(s).trim()).filter(Boolean);

  // painel
  app.get("/fichas", async (req, res) => {
    try {
      const aba = ["alta", "media", "imagem", "sem_fonte", "erro", "aceita", "rejeitada", "ok"].includes(req.query.aba) ? req.query.aba : "alta";
      const offset = Math.max(0, parseInt(req.query.offset || "0", 10) || 0);
      const LIMIT = 18;
      let filtro = `ficha_estado=$1`; let params = [aba];
      if (aba === "alta" || aba === "media") { filtro = `ficha_estado='proposta' AND COALESCE(ficha_proposta->>'confianca','media')=$1`; }
      if (aba === "imagem") { filtro = `imagem_check->>'status' = ANY($1::text[]) AND COALESCE(status,'publicada')='publicada'`; params = [["diverge", "duvidosa"]]; }
      const ct = await pool.query(`SELECT COUNT(*) AS n FROM artworks WHERE ${filtro}`, params);
      const ordem = aba === "aceita" || aba === "rejeitada" ? "ficha_conferida_em DESC NULLS LAST, id"
                  : aba === "imagem" ? "(imagem_check->>'status')='diverge' DESC, (imagem_check->>'dist')::int DESC NULLS FIRST, id" : "id";
      const r = await pool.query(
        `SELECT ${SELECT_FICHA}, ficha_estado, ficha_proposta, ficha_anterior, imagem_check FROM artworks
          WHERE ${filtro} ORDER BY ${ordem} LIMIT ${LIMIT} OFFSET ${offset}`, params);
      const diag = await diagnostico(pool, req.query.recontar === "1");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(paginaFichas({
        aba, offset, LIMIT, total: parseInt(ct.rows[0].n, 10), obras: r.rows, diag, estado,
        rotulos: DEFEITO_ROTULO, temSenha: !!(process.env.FICHAS_SENHA || process.env.NOTICIAS_SENHA),
        temEuropeana: !!EUROPEANA_KEY(),
      }));
    } catch (e) { res.status(500).send(`<pre style="color:#e55">Erro: ${String(e.message).replace(/</g, "&lt;")}</pre>`); }
  });

  app.get("/api/fichas/status", (req, res) => res.json(estado));
  app.get("/api/fichas/diagnostico", async (req, res) => {
    try { res.json(await diagnostico(pool, req.query.recontar === "1")); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // rodar uma remessa
  app.post("/api/fichas/rodar", (req, res) => {
    if (!senhaOk(req, res)) return;
    if (estado.rodando) return res.status(409).json({ error: "já está rodando" });
    const total = Math.min(5000, Math.max(1, parseInt(req.body?.total || "200", 10) || 200));
    const escopo = ["publicadas", "entrada", "todas"].includes(req.body?.escopo) ? req.body.escopo : "publicadas";
    const soDefeituosas = req.body?.so_defeituosas !== false;
    rodar(pool, { total, escopo, soDefeituosas });
    res.json({ ok: true, mensagem: `Remessa iniciada: até ${total} fichas (${escopo}${soDefeituosas ? ", só com defeito" : ""}).` });
  });
  app.post("/api/fichas/conferir_imagens", (req, res) => {
    if (!senhaOk(req, res)) return;
    if (estado.rodando) return res.status(409).json({ error: "já está rodando" });
    const total = Math.min(10000, Math.max(1, parseInt(req.body?.total || "300", 10) || 300));
    const escopo = ["publicadas", "entrada", "todas"].includes(req.body?.escopo) ? req.body.escopo : "publicadas";
    rodarImagens(pool, { total, escopo, refazer: !!req.body?.refazer });
    res.json({ ok: true, mensagem: `Conferência de imagens iniciada: até ${total} obras (${escopo}).` + (jpeg ? "" : " ATENÇÃO: jpeg-js não instalado — só compara por URL.") });
  });
  // a imagem está certa (conferida a olho) — sai da aba Imagem
  app.post("/api/fichas/imagem_ok", async (req, res) => {
    if (!senhaOk(req, res)) return;
    try {
      const r = await pool.query(
        `UPDATE artworks SET imagem_check = COALESCE(imagem_check,'{}'::jsonb) || '{"status":"confirmada"}'::jsonb
          WHERE id = ANY($1::text[])`, [listaIds(req.body)]);
      cacheDiag = null; res.json({ ok: true, marcadas: r.rowCount });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // imagem errada — tira da ala e devolve para a Entrada
  app.post("/api/fichas/para_entrada", async (req, res) => {
    if (!senhaOk(req, res)) return;
    try {
      const r = await pool.query(
        `UPDATE artworks SET status='rascunho',
            imagem_check = COALESCE(imagem_check,'{}'::jsonb) || '{"status":"na_entrada"}'::jsonb
          WHERE id = ANY($1::text[])`, [listaIds(req.body)]);
      cacheDiag = null; res.json({ ok: true, movidas: r.rowCount });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/fichas/parar", (req, res) => {
    if (!senhaOk(req, res)) return;
    estado.parar = true; res.json({ ok: true });
  });

  // testar uma obra sem gravar nada (mostra o que cada fonte devolveu)
  app.get("/api/fichas/testar", async (req, res) => {
    try {
      const id = String(req.query.id || "").trim();
      const r = await pool.query(`SELECT ${SELECT_FICHA} FROM artworks WHERE id=$1`, [id]);
      if (!r.rows.length) return res.status(404).json({ error: "id não encontrado" });
      const o = r.rows[0];
      res.json({ atual: { title: o.title, artist: o.artist, date: o.date, image_url: o.image_url }, defeitos: defeitos(o),
                 id_da_fonte: fonteDoId(o), resultado: await rebuscar(o) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // aceitar (por ids, ou todas de alta confiança)
  async function aplicar(ids) {
    let feitas = 0;
    for (const id of ids) {
      const r = await pool.query(
        `SELECT id, title, artist, date, medium, dimensions, museum, external_url, ficha_proposta
           FROM artworks WHERE id=$1 AND ficha_estado='proposta' AND NOT COALESCE(ficha_manual,false)`, [id]);
      const o = r.rows[0]; if (!o || !o.ficha_proposta) continue;
      const p = o.ficha_proposta;
      const anterior = { title: o.title, artist: o.artist, date: o.date, medium: o.medium,
                         dimensions: o.dimensions, museum: o.museum, external_url: o.external_url };
      await pool.query(
        `UPDATE artworks SET title=$2, artist=$3, date=$4,
            medium=COALESCE(NULLIF(medium,''),$5), dimensions=COALESCE(NULLIF(dimensions,''),$6),
            museum=COALESCE(NULLIF(museum,''),$7), external_url=COALESCE(NULLIF(external_url,''),$8),
            wikidata_id=COALESCE($9, wikidata_id), ficha_titulos=COALESCE($10::jsonb, ficha_titulos),
            ficha_anterior=$11, ficha_estado='aceita', ficha_conferida_em=EXTRACT(EPOCH FROM NOW())::BIGINT
          WHERE id=$1`,
        [id, p.title || o.title, p.artist || o.artist, p.date || o.date,
         p.medium || null, p.dimensions || null, p.museum || null, p.external_url || null,
         p.wikidata || null, p.titulos ? JSON.stringify(p.titulos) : null, JSON.stringify(anterior)]);
      feitas++;
    }
    cacheDiag = null;
    return feitas;
  }
  app.post("/api/fichas/aceitar", async (req, res) => {
    if (!senhaOk(req, res)) return;
    try {
      let ids = listaIds(req.body);
      if (req.body?.todas_alta) {
        const r = await pool.query(`SELECT id FROM artworks WHERE ficha_estado='proposta' AND ficha_proposta->>'confianca'='alta'`);
        ids = r.rows.map(x => x.id);
      }
      if (!ids.length) return res.status(400).json({ error: "nenhuma ficha indicada" });
      res.json({ ok: true, aceitas: await aplicar(ids), pedidas: ids.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/fichas/rejeitar", async (req, res) => {
    if (!senhaOk(req, res)) return;
    try {
      const ids = listaIds(req.body);
      const r = await pool.query(
        `UPDATE artworks SET ficha_estado='rejeitada', ficha_conferida_em=EXTRACT(EPOCH FROM NOW())::BIGINT
          WHERE id = ANY($1::text[])`, [ids]);
      cacheDiag = null; res.json({ ok: true, rejeitadas: r.rowCount });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // editar à mão (vale para qualquer aba) — a ficha fica protegida do agente
  app.post("/api/fichas/editar", async (req, res) => {
    if (!senhaOk(req, res)) return;
    try {
      const { id, title, artist, date } = req.body || {};
      const r0 = await pool.query(`SELECT title, artist, date, ficha_anterior FROM artworks WHERE id=$1`, [id]);
      if (!r0.rows.length) return res.status(404).json({ error: "id não encontrado" });
      const o = r0.rows[0];
      await pool.query(
        `UPDATE artworks SET title=$2, artist=$3, date=$4, ficha_manual=TRUE, ficha_estado='aceita',
            ficha_anterior=COALESCE(ficha_anterior,$5), ficha_conferida_em=EXTRACT(EPOCH FROM NOW())::BIGINT
          WHERE id=$1`,
        [id, String(title || "").trim(), String(artist || "").trim(), String(date || "").trim(),
         JSON.stringify({ title: o.title, artist: o.artist, date: o.date })]);
      cacheDiag = null; res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // desfazer uma aceitação — restaura exatamente os campos guardados
  app.post("/api/fichas/desfazer", async (req, res) => {
    if (!senhaOk(req, res)) return;
    try {
      const id = String(req.body?.id || "");
      const r0 = await pool.query(`SELECT ficha_anterior FROM artworks WHERE id=$1`, [id]);
      const a = r0.rows[0]?.ficha_anterior;
      if (!a) return res.status(400).json({ error: "não há ficha anterior guardada" });
      const campos = ["title", "artist", "date", "medium", "dimensions", "museum", "external_url"]
        .filter(k => Object.prototype.hasOwnProperty.call(a, k));
      const sets = campos.map((k, i) => `${k}=$${i + 2}`);
      await pool.query(
        `UPDATE artworks SET ${sets.join(", ")}${sets.length ? "," : ""}
            ficha_estado=CASE WHEN ficha_proposta ? 'confianca' THEN 'proposta' ELSE NULL END,
            ficha_manual=FALSE, ficha_anterior=NULL
          WHERE id=$1`,
        [id, ...campos.map(k => (k === "title" ? (a[k] ?? "") : a[k] ?? null))]);
      cacheDiag = null; res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // devolver à fila (erros / sem fonte / rejeitadas) para uma nova tentativa
  app.post("/api/fichas/reabrir", async (req, res) => {
    if (!senhaOk(req, res)) return;
    try {
      const est = ["erro", "sem_fonte", "rejeitada", "ok"].includes(req.body?.estado) ? req.body.estado : "erro";
      const r = await pool.query(`UPDATE artworks SET ficha_estado=NULL WHERE ficha_estado=$1 AND NOT COALESCE(ficha_manual,false)`, [est]);
      cacheDiag = null; res.json({ ok: true, reabertas: r.rowCount });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log("🗂  Fichas montadas — /fichas");
}

module.exports = { montarFichas, defeitos, rebuscar, limparArtista, limparTitulo, limparData,
                   arquivoCommons, idEuropeana, inventarioRijks, mesmoArtista, atribuicaoDifere,
                   fonteDoId, chaveUrl, impressao, conferirImagem };

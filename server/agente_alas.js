// server/agente_alas.js — Agente de Alas: classifica a ENTRADA nas 18 alas
// ─────────────────────────────────────────────────────────────────────────────
// A coleta continua onde já está: /museus (Met, AIC, Cleveland) e /europeana
// jogam pintura PD/CC0 na Entrada como rascunho. Este agente trabalha DEPOIS:
// olha cada obra da Entrada (imagem + metadados) e SUGERE a ala.
// Nada é publicado sem o clique do André no painel /agente.
//
// Como o agente aprende o critério da casa, e não o do museu:
//   • o prompt leva os critérios fixos das alas (CRITERIOS_ALAS.txt, corrigido)
//     e as regras de desempate do olhar dominante;
//   • leva também EXEMPLOS reais: obras que o André já curou em cada ala
//     (curado=TRUE). Cada correção feita no painel vira exemplo no ciclo seguinte.
//
// Direitos: o agente não decide direito autoral. Ao aceitar uma sugestão, a obra
// só é PUBLICADA se a triagem já estiver 🟢; senão ela recebe a ala e continua
// rascunho, esperando a triagem (/triagem ou o enriquecedor).
//
// REMESSAS (seção própria mais abaixo): o agente também BAIXA — percorre o acervo
// público de pintura do Met, AIC, Cleveland e Europeana, 500 obras novas por
// remessa, coloca nas alas, publica e para. A próxima só com autorização no painel.
//
// VERIFICADOR DE IMAGENS: percorre as obras publicadas e devolve para a Entrada
// as que não têm imagem ou cuja imagem não carrega (confirmado em 2 checagens).
//
// Também separa o que NÃO é pintura (desenho, gravura, foto) — regra geral das
// alas — para arquivar em lote (ex.: os RP_T_* do Rijksmuseum).
//
// COMO LIGAR (1 linha no server.js, ANTES do app.get("*")):
//     require("./agente_alas").montarAgenteAlas(app, pool);
//
// Variáveis no Railway:
//   GEMINI_API_KEY        (já existe, do atendente)
//   AGENTE_MODELO         opcional — padrão: o mesmo modelo do atendente
//   AGENTE_AUTO           opcional — "1" liga a classificação automática da Entrada antiga (padrão desligado)
//   AGENTE_LOTE_AUTO      opcional — obras por ciclo automático (padrão 30)
// ─────────────────────────────────────────────────────────────────────────────

const API    = "https://generativelanguage.googleapis.com/v1beta/models";
const MODELO = process.env.AGENTE_MODELO || "gemini-3.5-flash-lite"; // confirme o id no AI Studio
const AUTO_LIGADO   = process.env.AGENTE_AUTO === "1";   // padrão DESLIGADO: só gasta API sob comando
const LOTE_AUTO     = Math.min(parseInt(process.env.AGENTE_LOTE_AUTO || "30", 10) || 30, 200);
const INTERVALO_MIN = 10;          // ciclo automático a cada 10 min
const PAUSA_MS      = 1200;        // entre chamadas ao Gemini
const MAX_BYTES     = 7 * 1024 * 1024;

// ─── As 18 alas (ids reais do site) ──────────────────────────────────────────
// Atenção: o id "cidades" é a ala EMOÇÃO (abstração) e "fase" é PSIQUÊ.
const ALAS = {
  retratos: "Retratos", pessoas_reais: "Pessoas Conhecidas", historico: "História",
  perspectiva: "Perspectiva", objetos: "Objetos", lugares: "Lugares Conhecidos",
  natureza: "Natureza", familiar: "Ambiente Familiar", nudes: "Nu Feminino",
  esoterico: "Esotérico", sacro: "Sacro", arquitetura: "Arquitetura",
  povo: "Pessoas do Povo", luz_sol: "Luz do Sol", cores: "Cores",
  cidades: "Emoção", fase: "Psiquê", femininas: "Artistas Femininas",
};
const IDS = Object.keys(ALAS);

const CRITERIOS = {
  retratos:      "Bustos e configuração clássica de retrato — pessoa real ou não.",
  pessoas_reais: "Pessoa identificável (célebre), de corpo inteiro ou em ação.",
  historico:     "Momento histórico — batalha, revolução, evento que mudou o mundo.",
  perspectiva:   "Lugar NÃO identificável em que a perspectiva/profundidade é a linguagem.",
  objetos:       "Objetos — INCLUI natureza-morta, flores em vaso, vanitas.",
  lugares:       "Lugar RECONHECÍVEL — o público sabe onde é ao primeiro olhar (Veneza, Paris, marco famoso).",
  natureza:      "Natureza desconhecida — paisagem, mar, floresta. SEM natureza-morta, SEM lugar famoso.",
  familiar:      "Cotidiano doméstico, interior de casa — sem pessoa em atividade específica.",
  nudes:         "Nu feminino clássico — a mulher como tema universal.",
  esoterico:     "Conhecimento oculto — alquimia, Rosa-Cruz, simbolismo místico, Remedios Varo.",
  sacro:         "Fé — santos, anjos, Cristo, Madona, arte sacra de qualquer tradição.",
  arquitetura:   "Prédio, ponte ou construção como DESTAQUE — não a vista de cidade conhecida.",
  povo:          "Gente do povo em atividade/contexto específico — trabalho, mercado, festa.",
  luz_sol:       "Luz do sol como protagonista, em qualquer sujeito — céu, gente, paisagem, chão.",
  cores:         "Cor como LINGUAGEM — fauvismo, pós-impressionismo, pontilhismo, pop art.",
  cidades:       "EMOÇÃO — abstração: cor e forma emergindo como realidade emocional (Kandinsky, Rothko).",
  fase:          "PSIQUÊ — sonho como tema e ilusão de ótica; surrealismo e metafísica do século XX.",
  femininas:     "A artista mulher — toda obra pintada por mulher vem para cá (Frida, Tarsila, Cassatt, Morisot, Vigée Le Brun).",
};

const DESEMPATE = `
REGRAS DE DESEMPATE (a obra vai para a ala cujo olhar DOMINA, não para a única possível):
- retratos × pessoas_reais: busto/meio-corpo em pose de retrato → retratos; pessoa célebre de corpo inteiro ou agindo → pessoas_reais.
- lugares × natureza × perspectiva × arquitetura: dá para dizer ONDE é? → lugares. Paisagem sem lugar identificável → natureza. Rua/interior anônimo cuja força é a profundidade → perspectiva. Um edifício ou ponte é o assunto → arquitetura.
- objetos × natureza: natureza-morta é SEMPRE objetos.
- familiar × povo: interior doméstico tranquilo → familiar; gente trabalhando, vendendo, festejando → povo.
- luz_sol × cores: se a LUZ comanda a cena → luz_sol, mesmo com cor intensa; se a COR é a própria linguagem (Fauves, Gauguin, Van Gogh tardio, pop) → cores.
- cidades (Emoção) é para abstração; figurativo expressivo não entra aí.
- fase (Psiquê) é para sonho/surrealismo/ilusão ótica do século XX.
- sacro vence retratos quando a figura é santo, anjo ou cena bíblica.
- nudes: nu feminino como tema; nu dentro de cena bíblica ou mitológica de batalha fica na ala da cena.
- femininas: REGRA QUE VENCE TODAS AS OUTRAS — se a autora é mulher (pela ficha ou pelo seu conhecimento do nome),
  a 1ª opção é SEMPRE femininas; a ala do tema vai como 2ª opção. Na dúvida sobre o gênero de quem pintou, não aplique.
- Pintura de gênero holandesa: interior → familiar; taverna/mercado → povo.`;

// ─── Estado ──────────────────────────────────────────────────────────────────
let job = { rodando:false, origem:null, alvo:0, feitas:0, erros:0, sem_imagem:0,
            ultimo_erro:null, inicio:null, fim:null };
let auto = { ligado: AUTO_LIGADO, proximo: null };
let cacheExemplos = { ts: 0, texto: "" };

const pausa = ms => new Promise(r => setTimeout(r, ms));

// ─── Imagem pequena para o modelo (economiza banda e tokens) ────────────────
function miniatura(url) {
  if (!url) return url;
  if (url.includes("artic.edu/iiif"))          return url.replace(/\/full\/[^/]+\//, "/full/600,/");
  if (url.includes("upload.wikimedia.org") && url.includes("/thumb/"))
                                                return url.replace(/\/\d+px-/, "/640px-");
  if (url.includes("images.metmuseum.org") && url.includes("/original/"))
                                                return url.replace("/original/", "/web-large/");
  return url;
}
function thumbEuropeana(url) {
  return "https://api.europeana.eu/thumbnail/v2/url.json?type=IMAGE&size=w400&uri=" + encodeURIComponent(url);
}

async function baixarImagem(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": "GermanusArt/1.0 (https://germanus.art)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error("img HTTP " + r.status);
  const tipo = (r.headers.get("content-type") || "").split(";")[0].trim();
  if (!/^image\/(jpeg|png|webp|gif)$/.test(tipo)) throw new Error("img tipo " + tipo);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("img grande " + buf.length);
  return { mime: tipo, data: buf.toString("base64") };
}

async function imagemParaModelo(o) {
  // Europeana: a miniatura oficial primeiro (o arquivo original às vezes é TIFF enorme)
  const tentativas = o.source === "europeana"
    ? [thumbEuropeana(o.image_url), o.image_url]
    : [miniatura(o.image_url), o.image_url];
  if (tentativas[0] === tentativas[1]) tentativas.pop();
  for (const u of tentativas) {
    try { return await baixarImagem(u); } catch { /* tenta a próxima */ }
  }
  return null;
}

// ─── Exemplos reais da curadoria do André (few-shot) ────────────────────────
async function exemplos(pool) {
  if (Date.now() - cacheExemplos.ts < 30 * 60 * 1000 && cacheExemplos.texto) return cacheExemplos.texto;
  const linhas = [];
  for (const id of IDS) {
    let r;
    try {
      r = await pool.query(
        `SELECT title, artist, date FROM artworks
          WHERE ala_id=$1 AND COALESCE(status,'publicada')='publicada'
          ORDER BY curado DESC NULLS LAST, random() LIMIT 6`, [id]);
    } catch { r = { rows: [] }; }
    if (!r.rows.length) continue;
    const obras = r.rows.map(o =>
      `"${(o.title || "").slice(0, 70)}"${o.artist ? " — " + o.artist.slice(0, 40) : ""}${o.date ? " (" + String(o.date).slice(0, 12) + ")" : ""}`);
    linhas.push(`${id}: ${obras.join("; ")}`);
  }
  cacheExemplos = { ts: Date.now(), texto: linhas.join("\n") };
  return cacheExemplos.texto;
}

function instrucoes(exemplosTexto) {
  return `Você é o curador-assistente da GERMANUS.Art, acervo de pintura ocidental em domínio público.
Sua tarefa: olhar UMA obra e sugerir em qual das 18 alas ela entra.

TESE DA CASA: cada ala dimensiona a pintura pelo OLHAR. A obra vai para a ala cujo olhar domina,
por proximidade — não por exclusividade, nem pela classificação do museu.

AS ALAS (use sempre o id à esquerda):
${IDS.map(id => `- ${id} (${ALAS[id]}): ${CRITERIOS[id]}`).join("\n")}
${DESEMPATE}

REGRA GERAL: o acervo é só de PINTURA. Se a imagem for desenho, gravura, estudo a lápis,
fotografia, objeto 3D, página de livro ou manuscrito, informe no campo "tipo" — mesmo assim sugira a ala.

EXEMPLOS DE OBRAS JÁ CURADAS PELO DONO DO ACERVO, POR ALA (imite este critério):
${exemplosTexto || "(ainda sem exemplos)"}

Responda só o JSON pedido. "confianca" entre 0 e 1, honesta: abaixo de 0.6 quando duas alas disputam de verdade.
"motivo" em português, uma frase curta (até 20 palavras) dizendo o que domina o olhar.`;
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    tipo:      { type: "STRING", enum: ["pintura", "desenho", "gravura", "fotografia", "outro"] },
    ala:       { type: "STRING", enum: IDS },
    ala2:      { type: "STRING", enum: IDS },
    confianca: { type: "NUMBER" },
    motivo:    { type: "STRING" },
  },
  required: ["tipo", "ala", "ala2", "confianca", "motivo"],
};

async function chamarGemini(system, parts) {
  const r = await fetch(`${API}/${MODELO}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 300,
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
      },
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) {
    const t = await r.text();
    const e = new Error(`Gemini ${r.status}: ${t.slice(0, 200)}`);
    e.cota = r.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(t);
    throw e;
  }
  const d = await r.json();
  const texto = d?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  return JSON.parse(texto);
}

// ─── Classificar uma obra ────────────────────────────────────────────────────
async function classificar(pool, o, system) {
  const img = await imagemParaModelo(o);
  if (!img) job.sem_imagem++;

  const ficha = [
    `Título: ${o.title || "(sem título)"}`,
    `Artista: ${o.artist || "(desconhecido)"}`,
    `Data: ${o.date || "?"}`,
    o.medium ? `Técnica: ${o.medium}` : "",
    o.museum ? `Museu: ${o.museum}` : "",
    o.description ? `Descrição do museu: ${String(o.description).slice(0, 600)}` : "",
    img ? "" : "ATENÇÃO: a imagem não pôde ser carregada — decida só pela ficha e baixe a confiança.",
  ].filter(Boolean).join("\n");

  const parts = [{ text: ficha }];
  if (img) parts.push({ inline_data: { mime_type: img.mime, data: img.data } });

  const res = await chamarGemini(system, parts);
  const ala  = IDS.includes(res.ala)  ? res.ala  : null;
  let   ala2 = IDS.includes(res.ala2) ? res.ala2 : null;
  if (ala2 === ala) ala2 = null;
  let conf = Math.max(0, Math.min(1, Number(res.confianca) || 0));
  if (!img) conf = Math.min(conf, 0.5);
  if (!ala) throw new Error("resposta sem ala válida");

  await pool.query(
    `UPDATE artworks SET ala_sugerida=$2, ala_sugerida2=$3, ala_confianca=$4, ala_motivo=$5,
            ala_tipo=$6, ala_modelo=$7, ala_classificada_em=EXTRACT(EPOCH FROM NOW())::BIGINT
      WHERE id=$1`,
    [o.id, ala, ala2, conf, String(res.motivo || "").slice(0, 300),
     ["pintura","desenho","gravura","fotografia","outro"].includes(res.tipo) ? res.tipo : "outro",
     MODELO + (img ? "" : " (sem imagem)")]);
}

// ─── Lote em segundo plano ───────────────────────────────────────────────────
// remessaId: classifica só as obras daquela remessa (custo = o que foi autorizado)
// devolve { feitas, cota } — cota=true quando o Gemini recusou por limite
async function rodarLote(pool, alvo, origem, refazer = false, remessaId = null) {
  if (job.rodando) return null;
  if (!process.env.GEMINI_API_KEY) { job.ultimo_erro = "Falta GEMINI_API_KEY no Railway"; return null; }
  job = { rodando:true, origem, alvo, feitas:0, erros:0, sem_imagem:0, ultimo_erro:null,
          inicio:Date.now(), fim:null };
  let cota = false;
  try {
    const system = instrucoes(await exemplos(pool));
    const filtroRefazer = refazer ? "" : "AND ala_classificada_em IS NULL";
    const filtroRemessa = remessaId ? "AND agente_remessa = $2" : "";
    const params = remessaId ? [alvo, remessaId] : [alvo];
    const r = await pool.query(
      `SELECT id, source, title, artist, date, medium, museum, description, image_url
         FROM artworks
        WHERE COALESCE(status,'publicada')='rascunho' AND ala_decisao IS NULL AND img_retirada_em IS NULL
          AND image_url IS NOT NULL AND image_url<>'' ${filtroRefazer} ${filtroRemessa}
        ORDER BY indexed_at DESC NULLS LAST LIMIT $1`, params);

    for (const o of r.rows) {
      try {
        await classificar(pool, o, system);
        job.feitas++;
      } catch (e) {
        job.erros++; job.ultimo_erro = `${o.id}: ${e.message}`;
        if (e.cota) { cota = true; job.ultimo_erro = "Cota do Gemini esgotada — parei o lote. " + e.message; break; }
        // marca para não travar a fila na mesma obra problemática
        await pool.query(
          `UPDATE artworks SET ala_classificada_em=EXTRACT(EPOCH FROM NOW())::BIGINT,
                  ala_motivo=$2 WHERE id=$1 AND ala_sugerida IS NULL`,
          [o.id, "erro: " + e.message.slice(0, 200)]).catch(() => {});
      }
      if (remessaId && remessa.parar) break;
      await pausa(PAUSA_MS);
    }
  } catch (e) { job.ultimo_erro = e.message; }
  job.rodando = false;
  job.fim = Date.now();
  console.log(`🧭 Agente de alas (${origem}): ${job.feitas} classificadas, ${job.erros} erros`);
  return { feitas: job.feitas, cota };
}

// ═════════════════════════════════════════════════════════════════════════════
// REMESSAS — o agente baixa até 500 obras NOVAS, coloca cada pintura na ala
// sugerida e PUBLICA (decisão do André, 04/10/2026), e então para.
// Ficam na Entrada: o que não é pintura, o que não teve ala, e o que não tem
// imagem funcionando. Correções de ala: em /curadoria.
// A próxima remessa só começa quando o André autoriza no painel. As fontes são
// percorridas do começo ao fim do acervo público de pintura de cada museu, e o
// ponto onde parou fica gravado no banco (sobrevive a deploy e reinício).
// Ordem: Met → AIC → Cleveland → Europeana (a maior, e a de filtro menos testado).
// Obras que já estão no banco não contam na cota e não são tocadas.
// ═════════════════════════════════════════════════════════════════════════════
const UA = "GermanusArt/1.0 (https://germanus.art; contato@germanus.art)";
const ORDEM_FONTES = ["met", "aic", "cleveland", "europeana"];
const NOME_FONTE = { met: "Metropolitan", aic: "Art Institute of Chicago",
                     cleveland: "Cleveland", europeana: "Europeana (todas as instituições)" };
const REMESSA_PADRAO = 500;

let remessa = { rodando: false, parar: false, fonte: null, ultimo_erro: null };

async function pegarJson(url, timeout = 25000) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" },
                               signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${new URL(url).host}`);
  return r.json();
}

// grava só se for obra nova; devolve true quando entrou
async function gravarNova(pool, remessaId, o) {
  const r = await pool.query(
    `INSERT INTO artworks
       (id,source,title,artist,date,medium,dimensions,origin,museum,description,
        image_url,external_url,ala_id,credit,status,triagem,image_cached_at,indexed_at,agente_remessa)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'entrada',$13,'rascunho','',0,
             EXTRACT(EPOCH FROM NOW())::BIGINT,$14)
     ON CONFLICT (id) DO NOTHING`,
    [o.id, o.source, o.title, o.artist || "", o.date || "", o.medium || "", o.dimensions || "",
     o.origin || "", o.museum, o.description || "", o.image, o.ext || "", o.credit, remessaId]);
  return r.rowCount > 0;
}

// Cada fonte avança UMA página por chamada: passo(pool, estado, restante, gravar)
// → { estado, esgotada, vistas }. O estado é o "marcador de página" gravado no banco.
const FONTES = {

  // Met: lista completa de IDs por departamento; uma chamada por obra.
  // 11 = European Paintings, 1 = American Wing, 21 = Modern and Contemporary (quase tudo
  // ainda protegido — vem por último; o filtro de domínio público descarta o resto).
  met: {
    deps: [11, 1, 21],
    cacheIds: {},
    async passo(pool, estado, restante, gravar) {
      const dep = estado.dep || 0, pos = estado.pos || 0;
      if (dep >= this.deps.length) return { estado, esgotada: true, vistas: 0 };
      const depId = this.deps[dep];
      if (!this.cacheIds[depId]) {
        const d = await pegarJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects?departmentIds=${depId}`, 60000);
        this.cacheIds[depId] = (d.objectIDs || []).slice().sort((a, b) => a - b);
      }
      const ids = this.cacheIds[depId];
      if (pos >= ids.length) return { estado: { dep: dep + 1, pos: 0 }, esgotada: dep + 1 >= this.deps.length, vistas: 0 };
      const fatia = ids.slice(pos, pos + 40);
      let n = 0, vistas = 0;
      for (const id of fatia) {
        if (restante <= 0 || remessa.parar) break;
        n++; vistas++;
        let o;
        try { o = await pegarJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, 15000); }
        catch { await pausa(500); continue; }
        await pausa(200);
        const classif = `${o?.classification || ""} ${o?.objectName || ""}`;
        const img = o?.primaryImage || o?.primaryImageSmall;
        if (!o?.isPublicDomain || !/painting/i.test(classif) || !img) continue;
        if (await gravar({
          id: "met_" + o.objectID, source: "met", title: o.title || "(sem título)",
          artist: o.artistDisplayName, date: o.objectDate, medium: o.medium, dimensions: o.dimensions,
          origin: o.country || o.culture, museum: "The Metropolitan Museum of Art, Nova York, EUA",
          image: img, ext: o.objectURL,
          credit: `${o.creditLine || "The Metropolitan Museum of Art"} · Domínio público (Met Open Access)`,
        })) restante--;
      }
      return { estado: { dep, pos: pos + n }, esgotada: false, vistas };
    },
  },

  // AIC: busca filtrada (domínio público + tipo pintura), 100 por página, ordem por id.
  // A API não pagina além de 10.000 resultados (página 100).
  aic: {
    async passo(pool, estado, restante, gravar) {
      const page = estado.page || 1;
      if (page > 100) return { estado, esgotada: true, vistas: 0 };
      const params = {
        query: { bool: { must: [ { term: { is_public_domain: true } },
                                 { match: { artwork_type_title: "Painting" } } ] } },
        sort: [{ id: "asc" }],
        fields: ["id","title","artist_display","date_display","medium_display","dimensions",
                 "place_of_origin","image_id","credit_line","artwork_type_title","is_public_domain"],
        limit: 100, page,
      };
      const d = await pegarJson(`https://api.artic.edu/api/v1/artworks/search?params=${encodeURIComponent(JSON.stringify(params))}`);
      const itens = d.data || [];
      if (!itens.length) return { estado, esgotada: true, vistas: 0 };
      let parou = false;
      for (const o of itens) {
        if (restante <= 0 || remessa.parar) { parou = true; break; }
        if (!o.is_public_domain || !/painting/i.test(o.artwork_type_title || "") || !o.image_id) continue;
        if (await gravar({
          id: "aic_" + o.id, source: "aic", title: o.title || "(sem título)",
          artist: o.artist_display, date: o.date_display, medium: o.medium_display,
          dimensions: o.dimensions, origin: o.place_of_origin,
          museum: "Art Institute of Chicago, Illinois, EUA",
          image: `https://www.artic.edu/iiif/2/${o.image_id}/full/843,/0/default.jpg`,
          ext: `https://www.artic.edu/artworks/${o.id}`,
          credit: `${o.credit_line || "Art Institute of Chicago"} · Domínio público (CC0)`,
        })) restante--;
      }
      await pausa(600);
      return { estado: parou ? estado : { page: page + 1 }, esgotada: false, vistas: itens.length };
    },
  },

  // Cleveland: cc0=1 + type=Painting, 100 por página.
  cleveland: {
    async passo(pool, estado, restante, gravar) {
      const skip = estado.skip || 0;
      const d = await pegarJson(`https://openaccess-api.clevelandart.org/api/artworks/`
        + `?type=Painting&cc0=1&has_image=1&limit=100&skip=${skip}`);
      const itens = d.data || [];
      if (!itens.length) return { estado, esgotada: true, vistas: 0 };
      let parou = false;
      for (const o of itens) {
        if (restante <= 0 || remessa.parar) { parou = true; break; }
        const img = o.images?.web?.url || o.images?.print?.url;
        if (!img) continue;
        if (await gravar({
          id: "cleveland_" + o.id, source: "cleveland", title: o.title || "(sem título)",
          artist: o.creators?.[0]?.description, date: o.creation_date, medium: o.technique,
          origin: o.culture?.[0], museum: "Cleveland Museum of Art, Ohio, EUA",
          description: (o.description || "").replace(/<[^>]+>/g, ""),
          image: img, ext: o.url || `https://www.clevelandart.org/art/${o.id}`,
          credit: `${o.creditline || "Cleveland Museum of Art"} · CC0`,
        })) restante--;
      }
      await pausa(600);
      return { estado: parou ? estado : { skip: skip + itens.length }, esgotada: false, vistas: itens.length };
    },
  },

  // Europeana: todas as instituições, só Public Domain Mark + CC0, filtro de pintura v5
  // (o mesmo do europeana_ui.js). Cursor profundo da própria API.
  europeana: {
    async passo(pool, estado, restante, gravar) {
      const KEY = process.env.EUROPEANA_KEY;
      if (!KEY) throw new Error("Falta EUROPEANA_KEY no Railway");
      const cursor = estado.cursor || "*";
      const u = new URL("https://api.europeana.eu/record/v2/search.json");
      u.searchParams.set("wskey", KEY);
      u.searchParams.set("query", "*:*");
      u.searchParams.set("reusability", "open");
      u.searchParams.set("media", "true");
      u.searchParams.set("rows", "100");
      u.searchParams.set("cursor", cursor);
      u.searchParams.set("profile", "rich");
      u.searchParams.append("qf", 'RIGHTS:("http://creativecommons.org/publicdomain/mark/1.0/" OR "http://creativecommons.org/publicdomain/zero/1.0/")');
      u.searchParams.append("qf",
        '(skos_concept:"http://data.europeana.eu/concept/47" OR skos_concept:"http://data.europeana.eu/concept/base/47"' +
        ' OR proxy_dc_type.en:(painting OR paintings) OR proxy_dc_type.nl:(schilderij OR schilderijen)' +
        ' OR proxy_dc_type.sv:(målning OR oljemålning) OR proxy_dc_type.de:(Gemälde) OR proxy_dc_type.fr:(peinture))');
      const d = await pegarJson(u.toString(), 30000);
      const itens = d.items || [];
      if (!itens.length) return { estado, esgotada: true, vistas: 0 };
      const p1 = v => Array.isArray(v) ? (v[0] || "") : (v || "");
      let parou = false;
      for (const it of itens) {
        if (restante <= 0 || remessa.parar) { parou = true; break; }
        const rights = p1(it.rights);
        if (!/publicdomain\/(mark|zero)\/1\.0/.test(rights)) continue;
        const image = p1(it.edmIsShownBy) || p1(it.edmPreview);
        if (!image) continue;
        const museum = p1(it.dataProvider) || p1(it.provider) || "Europeana";
        if (await gravar({
          id: "europeana_" + (it.id || "").replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+/, ""),
          source: "europeana", title: p1(it.title) || p1(it.dcTitleLangAware?.def) || "(sem título)",
          artist: p1(it.dcCreator) || p1(it.edmAgentLabel), date: p1(it.year) || p1(it.edmTimespanLabel),
          museum, image, ext: p1(it.guid) || (it.id ? "https://www.europeana.eu/item" + it.id : ""),
          credit: `${museum} · via Europeana · ${rights || "Public Domain"}`,
        })) restante--;
      }
      await pausa(500);
      if (parou) return { estado, esgotada: false, vistas: itens.length };
      return { estado: { cursor: d.nextCursor || cursor }, esgotada: !d.nextCursor, vistas: itens.length };
    },
  },
};

// ─── Checagem de imagem ──────────────────────────────────────────────────────
// "ok"     → a URL responde com uma imagem
// "morta"  → 404/410, resposta que não é imagem, domínio inexistente
// "duvida" → timeout, 429, 5xx: não conta como falha (tenta de novo depois)
async function checarImagem(url) {
  if (!url || !/^https?:\/\//i.test(url)) return "morta";
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, "Range": "bytes=0-2047", "Accept": "image/*" },
      redirect: "follow", signal: AbortSignal.timeout(20000),
    });
    try { await r.body?.cancel(); } catch {}
    if (r.status === 404 || r.status === 410) return "morta";
    if (r.status === 429 || r.status >= 500) return "duvida";
    if (!r.ok) return r.status === 403 ? "duvida" : "morta";
    const tipo = (r.headers.get("content-type") || "").toLowerCase();
    if (tipo.startsWith("image/")) return "ok";
    if (tipo.includes("octet-stream")) return "ok";
    return "morta";                                   // html de erro, página da instituição etc.
  } catch (e) {
    const m = String(e?.cause?.code || e?.message || "");
    if (/ENOTFOUND|EAI_AGAIN|ERR_INVALID_URL|CERT|certificate/i.test(m)) return "morta";
    return "duvida";
  }
}

// Fim da remessa: cada PINTURA com ala sugerida e imagem funcionando vai para a
// ala e é publicada. O resto fica na Entrada para o André decidir.
async function introduzirNasAlas(pool, remessaId) {
  const r = await pool.query(
    `SELECT id, image_url FROM artworks
      WHERE agente_remessa=$1 AND COALESCE(status,'publicada')='rascunho' AND ala_decisao IS NULL
        AND ala_sugerida IS NOT NULL AND COALESCE(ala_tipo,'')='pintura'`, [remessaId]);
  let introduzidas = 0;
  for (const o of r.rows) {
    if (remessa.parar) break;
    let st = await checarImagem(o.image_url);
    if (st === "duvida") { await pausa(3000); st = await checarImagem(o.image_url); }
    if (st === "ok") {
      await pool.query(
        `UPDATE artworks SET ala_id=ala_sugerida, status='publicada', ala_decisao='auto',
                img_verificada_em=EXTRACT(EPOCH FROM NOW())::BIGINT, img_falhas=0
          WHERE id=$1`, [o.id]);
      introduzidas++;
    } else {
      await pool.query(
        `UPDATE artworks SET img_falhas=COALESCE(img_falhas,0)+1,
                img_retirada_em = CASE WHEN $2 THEN EXTRACT(EPOCH FROM NOW())::BIGINT ELSE img_retirada_em END
          WHERE id=$1`, [o.id, st === "morta"]);
    }
    await pausa(250);
  }
  const n = await pool.query(
    `SELECT COUNT(*)::int AS n FROM artworks
      WHERE agente_remessa=$1 AND COALESCE(status,'publicada')='rascunho'`, [remessaId]);
  cacheExemplos.ts = 0;
  return { introduzidas, naEntrada: n.rows[0].n };
}

// ─── Verificador de imagens das alas ─────────────────────────────────────────
// Percorre TODAS as obras publicadas (não só as do agente), as menos verificadas
// primeiro. Sem image_url → Entrada na hora. Imagem morta → nova checagem no
// ciclo seguinte; morta 2 vezes → Entrada. Mantém o ala_id (como imagens_mortas.js),
// então dá para consertar a imagem e republicar na mesma ala pela /curadoria.
const VERIF_LOTE = 300;
let verif = { ligado: process.env.AGENTE_VERIFICAR !== "0", rodando: false, ultima: null,
              checadas: 0, ok: 0, mortas: 0, duvida: 0, retiradas: 0 };

async function verificarImagens(pool) {
  if (verif.rodando || !verif.ligado) return;
  verif = { ...verif, rodando: true, checadas: 0, ok: 0, mortas: 0, duvida: 0, retiradas: 0 };
  try {
    const vazias = await pool.query(
      `UPDATE artworks SET status='rascunho', img_retirada_em=EXTRACT(EPOCH FROM NOW())::BIGINT
        WHERE COALESCE(status,'publicada')='publicada' AND (image_url IS NULL OR image_url='')`);
    verif.retiradas += vazias.rowCount;

    const r = await pool.query(
      `SELECT id, image_url, COALESCE(img_falhas,0) AS falhas FROM artworks
        WHERE COALESCE(status,'publicada')='publicada' AND image_url IS NOT NULL AND image_url<>''
        ORDER BY COALESCE(img_falhas,0) DESC, img_verificada_em ASC NULLS FIRST
        LIMIT $1`, [VERIF_LOTE]);
    for (const o of r.rows) {
      if (!verif.ligado) break;
      const st = await checarImagem(o.image_url);
      verif.checadas++; verif[st === "ok" ? "ok" : st === "morta" ? "mortas" : "duvida"]++;
      if (st === "ok") {
        await pool.query(`UPDATE artworks SET img_falhas=0, img_verificada_em=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=$1`, [o.id]);
      } else if (st === "morta") {
        const f = o.falhas + 1;
        if (f >= 2) {
          await pool.query(
            `UPDATE artworks SET status='rascunho', img_falhas=$2,
                    img_retirada_em=EXTRACT(EPOCH FROM NOW())::BIGINT,
                    img_verificada_em=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=$1`, [o.id, f]);
          verif.retiradas++;
          console.log(`🖼️  Agente: "${o.id}" sem imagem — devolvida para a Entrada`);
        } else {
          // volta para a frente da fila: confirma no próximo ciclo (≈10 min)
          await pool.query(`UPDATE artworks SET img_falhas=$2, img_verificada_em=0 WHERE id=$1`, [o.id, f]);
        }
      } else {
        await pool.query(`UPDATE artworks SET img_verificada_em=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=$1`, [o.id]);
      }
      await pausa(300);
    }
  } catch (e) { verif.erro = e.message; }
  verif.rodando = false;
  verif.ultima = Date.now();
}

async function remessaAtiva(pool) {
  const r = await pool.query(
    `SELECT * FROM agente_remessas WHERE fase IN ('importando','classificando') ORDER BY id DESC LIMIT 1`);
  return r.rows[0] || null;
}

// Executa (ou retoma) a remessa ativa: importa até a cota, depois classifica.
async function executarRemessa(pool) {
  if (remessa.rodando) return;
  const rem = await remessaAtiva(pool);
  if (!rem || rem.pausada) return;
  remessa = { rodando: true, parar: false, fonte: null, ultimo_erro: null, id: rem.id };
  try {
    // ─── Fase 1: importar ────────────────────────────────────────────────────
    if (rem.fase === "importando") {
      let importadas = rem.importadas;
      const pular = new Set();
      while (importadas < rem.autorizadas && !remessa.parar) {
        const fr = await pool.query(
          `SELECT * FROM agente_fontes WHERE ativa AND NOT esgotada
            ORDER BY array_position($1::text[], fonte)`, [ORDEM_FONTES]);
        const f = fr.rows.find(x => !pular.has(x.fonte) && FONTES[x.fonte]);
        if (!f) break;                                   // acervo das fontes ativas acabou
        remessa.fonte = f.fonte;
        let errosSeguidos = 0, inseridasFonte = 0, estado = f.estado || {};
        while (importadas < rem.autorizadas && !remessa.parar) {
          let res;
          const gravar = async o => {
            const ok = await gravarNova(pool, rem.id, o).catch(e => { remessa.ultimo_erro = "SQL: " + e.message; return false; });
            if (ok) { importadas++; inseridasFonte++; }
            return ok;
          };
          try { res = await FONTES[f.fonte].passo(pool, estado, rem.autorizadas - importadas, gravar); errosSeguidos = 0; }
          catch (e) {
            remessa.ultimo_erro = `${f.fonte}: ${e.message}`;
            if (++errosSeguidos >= 3) { pular.add(f.fonte); break; }   // tenta de novo na próxima remessa
            await pausa(5000); continue;
          }
          estado = res.estado;
          await pool.query(
            `UPDATE agente_fontes SET estado=$2, esgotada=$3, vistas=vistas+$4, importadas=importadas+$5 WHERE fonte=$1`,
            [f.fonte, JSON.stringify(estado), res.esgotada, res.vistas, inseridasFonte]);
          inseridasFonte = 0;
          await pool.query(`UPDATE agente_remessas SET importadas=$2 WHERE id=$1`, [rem.id, importadas]);
          if (res.esgotada) break;
        }
      }
      if (remessa.parar) return;
      await pool.query(`UPDATE agente_remessas SET fase='classificando', importadas=$2 WHERE id=$1`, [rem.id, importadas]);
      rem.fase = "classificando";
    }

    // ─── Fase 2: classificar só o que esta remessa trouxe ────────────────────
    if (rem.fase === "classificando") {
      while (!remessa.parar) {
        while (job.rodando) await pausa(3000);            // espera lote manual/automático
        const res = await rodarLote(pool, 200, `remessa ${rem.id}`, false, rem.id);
        if (!res) break;
        await pool.query(
          `UPDATE agente_remessas SET classificadas =
             (SELECT COUNT(*) FROM artworks WHERE agente_remessa=$1 AND ala_classificada_em IS NOT NULL)
           WHERE id=$1`, [rem.id]);
        if (res.cota) { remessa.ultimo_erro = "Cota do Gemini — retomo sozinho no próximo ciclo (10 min)."; break; }
        if (res.feitas === 0) {
          const { introduzidas, naEntrada } = await introduzirNasAlas(pool, rem.id);
          if (remessa.parar) break;
          await pool.query(
            `UPDATE agente_remessas SET fase='concluida', introduzidas=$2, na_entrada=$3,
                    fim=EXTRACT(EPOCH FROM NOW())::BIGINT WHERE id=$1`, [rem.id, introduzidas, naEntrada]);
          console.log(`🧭 Remessa ${rem.id} concluída — ${introduzidas} nas alas, ${naEntrada} na Entrada; aguardando autorização`);
          break;
        }
      }
    }
  } catch (e) {
    remessa.ultimo_erro = e.message;
    await pool.query(`UPDATE agente_remessas SET erro=$2 WHERE id=$1`, [rem.id, e.message.slice(0, 300)]).catch(() => {});
  } finally {
    remessa.rodando = false;
    remessa.fonte = null;
  }
}

// ─── Montagem ────────────────────────────────────────────────────────────────
function montarAgenteAlas(app, pool) {

  (async () => {
    const cols = [
      "ala_sugerida TEXT", "ala_sugerida2 TEXT", "ala_confianca REAL", "ala_motivo TEXT",
      "ala_tipo TEXT", "ala_modelo TEXT", "ala_classificada_em BIGINT", "ala_decisao TEXT",
      "agente_remessa INT", "img_verificada_em BIGINT", "img_falhas INT DEFAULT 0",
      "img_retirada_em BIGINT",
    ];
    try {
      for (const c of cols) await pool.query(`ALTER TABLE artworks ADD COLUMN IF NOT EXISTS ${c}`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_art_ala_sug ON artworks(ala_sugerida)
                          WHERE ala_decisao IS NULL`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_art_remessa ON artworks(agente_remessa)
                          WHERE agente_remessa IS NOT NULL`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS agente_remessas (
          id SERIAL PRIMARY KEY, autorizadas INT NOT NULL, importadas INT DEFAULT 0,
          classificadas INT DEFAULT 0, fase TEXT DEFAULT 'importando', pausada BOOLEAN DEFAULT FALSE,
          criada_em BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT, fim BIGINT, erro TEXT);
        ALTER TABLE agente_remessas ADD COLUMN IF NOT EXISTS introduzidas INT DEFAULT 0;
        ALTER TABLE agente_remessas ADD COLUMN IF NOT EXISTS na_entrada INT DEFAULT 0;
        CREATE TABLE IF NOT EXISTS agente_fontes (
          fonte TEXT PRIMARY KEY, estado JSONB DEFAULT '{}'::jsonb, esgotada BOOLEAN DEFAULT FALSE,
          ativa BOOLEAN DEFAULT TRUE, vistas INT DEFAULT 0, importadas INT DEFAULT 0);`);
      for (const f of ORDEM_FONTES)
        await pool.query(`INSERT INTO agente_fontes (fonte) VALUES ($1) ON CONFLICT DO NOTHING`, [f]);
      setTimeout(() => executarRemessa(pool).catch(() => {}), 60000); // retoma remessa após deploy
      console.log("🧭 Agente de alas — colunas prontas");
    } catch (e) { console.log("🧭 Agente de alas — erro nas colunas:", e.message); }
  })();

  // ciclo automático: classifica o que chegou na Entrada
  const ciclo = async () => {
    auto.proximo = Date.now() + INTERVALO_MIN * 60000;
    executarRemessa(pool).catch(() => {});        // retoma remessa interrompida (cota, erro, deploy)
    verificarImagens(pool).catch(() => {});       // imagens das alas (não usa API paga)
    if (remessa.rodando) return;
    if (!auto.ligado || job.rodando || !process.env.GEMINI_API_KEY) return;
    try {
      const n = await pool.query(
        `SELECT COUNT(*)::int AS n FROM artworks
          WHERE COALESCE(status,'publicada')='rascunho' AND ala_decisao IS NULL AND img_retirada_em IS NULL
            AND ala_classificada_em IS NULL AND image_url IS NOT NULL AND image_url<>''`);
      if (n.rows[0].n > 0) await rodarLote(pool, LOTE_AUTO, "automático");
    } catch { /* tenta no próximo ciclo */ }
  };
  setTimeout(ciclo, 5 * 60000);                   // 5 min após o boot
  setInterval(ciclo, INTERVALO_MIN * 60000);

  // ─── API ─────────────────────────────────────────────────────────────────
  app.post("/api/agente/classificar", async (req, res) => {
    if (job.rodando) return res.status(409).json({ error: "Já há um lote rodando", job });
    if (!process.env.GEMINI_API_KEY) return res.status(400).json({ error: "Falta GEMINI_API_KEY no Railway" });
    const alvo = Math.min(parseInt(req.body?.total || "50", 10) || 50, 1000);
    const refazer = req.body?.refazer === true;
    rodarLote(pool, alvo, "manual", refazer);   // sem await
    res.json({ ok: true, mensagem: `Classificando até ${alvo} obras da Entrada.` });
  });

  app.post("/api/agente/reclassificar", async (req, res) => {
    try {
      const ids = (req.body?.ids || []).map(String).slice(0, 500);
      await pool.query(
        `UPDATE artworks SET ala_sugerida=NULL, ala_sugerida2=NULL, ala_confianca=NULL, ala_motivo=NULL,
                ala_tipo=NULL, ala_classificada_em=NULL WHERE id = ANY($1::text[])`, [ids]);
      res.json({ ok: true, n: ids.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Remessas ────────────────────────────────────────────────────────────
  app.post("/api/agente/remessa/autorizar", async (req, res) => {
    try {
      if (!process.env.GEMINI_API_KEY) return res.status(400).json({ error: "Falta GEMINI_API_KEY no Railway" });
      if (await remessaAtiva(pool)) return res.status(409).json({ error: "Já há uma remessa em andamento" });
      const total = Math.max(1, Math.min(parseInt(req.body?.total || REMESSA_PADRAO, 10) || REMESSA_PADRAO, REMESSA_PADRAO));
      const r = await pool.query(`INSERT INTO agente_remessas (autorizadas) VALUES ($1) RETURNING id`, [total]);
      executarRemessa(pool).catch(() => {});      // sem await
      res.json({ ok: true, id: r.rows[0].id, mensagem: `Remessa ${r.rows[0].id} autorizada: até ${total} obras novas.` });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/agente/remessa/pausar", async (req, res) => {
    try {
      remessa.parar = true;
      await pool.query(`UPDATE agente_remessas SET pausada=TRUE WHERE fase IN ('importando','classificando')`);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/agente/remessa/retomar", async (req, res) => {
    try {
      await pool.query(`UPDATE agente_remessas SET pausada=FALSE WHERE fase IN ('importando','classificando')`);
      executarRemessa(pool).catch(() => {});
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/agente/verificador", (req, res) => {
    if (typeof req.body?.ligado === "boolean") verif.ligado = req.body.ligado;
    if (req.body?.agora) verificarImagens(pool).catch(() => {});
    res.json({ ok: true, verif });
  });

  app.post("/api/agente/fonte", async (req, res) => {
    try {
      const fonte = String(req.body?.fonte || "");
      if (!ORDEM_FONTES.includes(fonte)) return res.status(400).json({ error: "fonte inválida" });
      await pool.query(`UPDATE agente_fontes SET ativa=$2 WHERE fonte=$1`, [fonte, !!req.body?.ativa]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/agente/remessas", async (req, res) => {
    try {
      const rems = await pool.query(`SELECT * FROM agente_remessas ORDER BY id DESC LIMIT 20`);
      const fontes = await pool.query(`SELECT fonte, esgotada, ativa, vistas, importadas FROM agente_fontes
                                        ORDER BY array_position($1::text[], fonte)`, [ORDEM_FONTES]);
      const im = await pool.query(`
        SELECT COUNT(*) FILTER (WHERE COALESCE(status,'publicada')='publicada')::int AS publicadas,
               COUNT(*) FILTER (WHERE COALESCE(status,'publicada')='publicada' AND img_verificada_em > 0)::int AS verificadas,
               COUNT(*) FILTER (WHERE img_retirada_em IS NOT NULL AND COALESCE(status,'publicada')='rascunho')::int AS retiradas
          FROM artworks`);
      res.json({ remessas: rems.rows, fontes: fontes.rows.map(f => ({ ...f, nome: NOME_FONTE[f.fonte] })),
                 verif, imagens: im.rows[0],
                 execucao: remessa, padrao: REMESSA_PADRAO,
                 europeana_ok: Boolean(process.env.EUROPEANA_KEY) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/agente/auto", (req, res) => {
    auto.ligado = !!req.body?.ligado;
    res.json({ ok: true, auto });
  });

  app.get("/api/agente/status", async (req, res) => {
    try {
      const c = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE ala_classificada_em IS NULL AND ala_decisao IS NULL)::int AS pendentes,
          COUNT(*) FILTER (WHERE ala_sugerida IS NOT NULL AND ala_decisao IS NULL)::int   AS para_revisar,
          COUNT(*) FILTER (WHERE ala_decisao IS NOT NULL AND ala_id NOT IN ('entrada'))::int AS aceitas_aguardando_triagem,
          COUNT(*) FILTER (WHERE ala_sugerida IS NOT NULL AND ala_decisao IS NULL
                             AND COALESCE(ala_tipo,'pintura')<>'pintura')::int          AS nao_pintura
          FROM artworks
         WHERE COALESCE(status,'publicada')='rascunho' AND image_url IS NOT NULL AND image_url<>''`);
      // acerto real do agente, medido pelas decisões do André
      const a = await pool.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE ala_decisao='1')::int AS primeira,
               COUNT(*) FILTER (WHERE ala_decisao='2')::int AS segunda
          FROM artworks WHERE ala_decisao IN ('1','2','outra')`);
      const porAla = await pool.query(`
        SELECT ala_sugerida AS ala, COUNT(*)::int AS n FROM artworks
         WHERE COALESCE(status,'publicada')='rascunho' AND ala_sugerida IS NOT NULL AND ala_decisao IS NULL
         GROUP BY ala_sugerida ORDER BY n DESC`);
      res.json({ job, auto, modelo: MODELO, contagem: c.rows[0], acerto: a.rows[0],
                 por_ala: porAla.rows, alas: ALAS });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/agente/fila", async (req, res) => {
    try {
      const ala = IDS.includes(req.query.ala) ? req.query.ala : null;
      const min = Math.max(0, Math.min(1, parseFloat(req.query.min || "0") || 0));
      const tipo = req.query.tipo === "nao_pintura" ? "nao_pintura" : null;
      const offset = Math.max(0, parseInt(req.query.offset || "0", 10) || 0);
      const r = await pool.query(`
        SELECT id, source, title, artist, date, museum, image_url, external_url, triagem,
               ala_sugerida, ala_sugerida2, ala_confianca, ala_motivo, ala_tipo
          FROM artworks
         WHERE COALESCE(status,'publicada')='rascunho' AND ala_sugerida IS NOT NULL AND ala_decisao IS NULL
           AND ($1::text IS NULL OR ala_sugerida=$1)
           AND COALESCE(ala_confianca,0) >= $2
           AND ($3::text IS NULL OR COALESCE(ala_tipo,'pintura')<>'pintura')
         ORDER BY ala_confianca DESC NULLS LAST, id
         LIMIT 60 OFFSET $4`, [ala, min, tipo, offset]);
      res.json({ obras: r.rows.map(o => ({ ...o, thumb: miniatura(o.image_url) })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // aceitar: { itens: [{ id, ala }] } — publica só se a triagem já estiver 🟢
  app.post("/api/agente/aceitar", async (req, res) => {
    try {
      const itens = (req.body?.itens || []).filter(i => i && i.id && IDS.includes(i.ala)).slice(0, 500);
      let publicadas = 0, aguardando = 0;
      for (const { id, ala } of itens) {
        const r = await pool.query(
          `UPDATE artworks SET
              ala_id = $2, curado = TRUE,
              ala_decisao = CASE WHEN ala_sugerida=$2 THEN '1' WHEN ala_sugerida2=$2 THEN '2' ELSE 'outra' END,
              status = CASE WHEN triagem='verde' THEN 'publicada' ELSE status END
            WHERE id=$1 RETURNING status`, [String(id), ala]);
        if (r.rows[0]?.status === "publicada") publicadas++; else aguardando++;
      }
      cacheExemplos.ts = 0; // as decisões novas entram como exemplo no próximo lote
      res.json({ ok: true, publicadas, aguardando_triagem: aguardando });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // aceitar em lote tudo acima de um limiar (opcionalmente de uma ala)
  app.post("/api/agente/aceitar-lote", async (req, res) => {
    try {
      const min = Math.max(0.5, Math.min(1, parseFloat(req.body?.min || "0.85") || 0.85));
      const ala = IDS.includes(req.body?.ala) ? req.body.ala : null;
      const r = await pool.query(`
        UPDATE artworks SET
           ala_id = ala_sugerida, curado = TRUE, ala_decisao = '1',
           status = CASE WHEN triagem='verde' THEN 'publicada' ELSE status END
         WHERE COALESCE(status,'publicada')='rascunho' AND ala_decisao IS NULL
           AND ala_sugerida IS NOT NULL AND COALESCE(ala_tipo,'pintura')='pintura'
           AND ala_confianca >= $1 AND ($2::text IS NULL OR ala_sugerida=$2)
        RETURNING status`, [min, ala]);
      const publicadas = r.rows.filter(x => x.status === "publicada").length;
      cacheExemplos.ts = 0;
      res.json({ ok: true, aceitas: r.rowCount, publicadas, aguardando_triagem: r.rowCount - publicadas });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // arquivar: { ids: [...] } ou { nao_pintura: true } para tudo que o agente marcou como não-pintura
  app.post("/api/agente/arquivar", async (req, res) => {
    try {
      let r;
      if (req.body?.nao_pintura === true) {
        r = await pool.query(`
          UPDATE artworks SET status='arquivada', curado=TRUE, ala_decisao='arquivada'
           WHERE COALESCE(status,'publicada')='rascunho' AND ala_decisao IS NULL
             AND ala_sugerida IS NOT NULL AND COALESCE(ala_tipo,'pintura')<>'pintura'`);
      } else {
        const ids = (req.body?.ids || []).map(String).slice(0, 500);
        r = await pool.query(
          `UPDATE artworks SET status='arquivada', curado=TRUE, ala_decisao='arquivada'
            WHERE id = ANY($1::text[])`, [ids]);
      }
      res.json({ ok: true, arquivadas: r.rowCount });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // publica as já aceitas cuja triagem ficou 🟢 depois
  app.post("/api/agente/publicar-triadas", async (req, res) => {
    try {
      const r = await pool.query(`
        UPDATE artworks SET status='publicada'
         WHERE COALESCE(status,'publicada')='rascunho' AND triagem='verde'
           AND ala_decisao IN ('1','2','outra') AND ala_id IS NOT NULL AND ala_id<>'entrada'`);
      res.json({ ok: true, publicadas: r.rowCount });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── Painel ──────────────────────────────────────────────────────────────
  app.get("/agente", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(PAINEL);
  });

  console.log(`🧭 Agente de alas montado — /agente (auto ${auto.ligado ? "ligado" : "desligado"}, ${MODELO})`);
}

// ─── HTML do painel ──────────────────────────────────────────────────────────
const PAINEL = `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Germanus — Agente de Alas</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#e0e0e0;font-family:-apple-system,Segoe UI,sans-serif;padding:20px 16px;max-width:1200px;margin:0 auto}
h1{font-size:20px;color:#fff}.sub{color:#666;font-size:12px;margin:4px 0 16px}a{color:#378ADD;text-decoration:none}
.stats{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.st{background:#111;border:1px solid #222;border-radius:10px;padding:10px 12px;min-width:130px;flex:1}
.st b{display:block;font-size:20px;color:#fff}.st span{font-size:11px;color:#777}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}
button,select,input{padding:8px 12px;border-radius:8px;border:1px solid #2a2a2a;background:#161616;color:#ccc;font-size:12px}
button{cursor:pointer}button.go{background:#1D9E7522;border-color:#1D9E7555;color:#5fd6a8}
button.warn{background:#9e1d1d22;border-color:#9e1d1d55;color:#e88}
#job{font-size:12px;color:#aaa;min-height:16px;margin:6px 0}
.alas{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 14px}
.alas button{font-size:11px;padding:5px 9px}.alas button.on{border-color:#1D9E75;color:#5fd6a8}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.card{background:#111;border:1px solid #222;border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.card.feito{opacity:.25;pointer-events:none}
.img{height:200px;background:#0d0d0d;display:flex;align-items:center;justify-content:center}
.img img{max-width:100%;max-height:200px;object-fit:contain}
.info{padding:10px;font-size:12px;flex:1;display:flex;flex-direction:column;gap:6px}
.t{color:#fff;font-weight:600;line-height:1.3}.m{color:#777;font-size:11px}
.mot{color:#aaa;font-style:italic;font-size:11px;line-height:1.4}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{font-size:11px;padding:5px 9px;border-radius:14px;cursor:pointer;border:1px solid #1D9E7555;background:#1D9E7518;color:#5fd6a8}
.chip.b{border-color:#333;background:#181818;color:#bbb}
.tag{font-size:10px;padding:2px 6px;border-radius:4px;background:#9e1d1d33;color:#e88}
.tag.tri{background:#8b7a2a33;color:#d8c46a}
.acts{display:flex;gap:6px;margin-top:auto}
.rem{background:#0f1512;border:1px solid #1D9E7544;border-radius:12px;padding:14px;margin:4px 0 16px}
.rem h2{font-size:14px;color:#fff;margin-bottom:6px}.rem .l{font-size:12px;color:#aaa;line-height:1.6}
.fontes{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.fonte{font-size:11px;padding:6px 9px;border-radius:8px;background:#141414;border:1px solid #262626;color:#bbb}
.fonte.off{opacity:.45}.fonte.fim{border-color:#555;color:#777}.acts select{flex:1;padding:5px}.acts button{padding:5px 8px}
</style></head><body>
<h1>GERMANUS.Art — Agente de Alas</h1>
<p class="sub"><a href="/banco">← banco</a> · <a href="/museus">museus</a> · <a href="/europeana">europeana</a> ·
<a href="/curadoria?ala=entrada&offset=0">entrada</a> · <a href="/triagem">triagem</a> ·
remessas de 500: o agente baixa, coloca nas alas e <b>publica</b>; a próxima só com o seu comando · ajustes de ala em <a href="/curadoria">/curadoria</a></p>

<div class="rem" id="rem"><h2>Remessas</h2><div class="l">carregando…</div></div>
<div class="stats" id="stats"></div>

<div class="bar">
  <button class="go" onclick="classificar()">Classificar agora →</button>
  <label style="font-size:12px;color:#aaa"><input type="checkbox" id="auto" onchange="setAuto()"> ciclo automático (a cada 10 min)</label>
  <span style="flex:1"></span>
  <button onclick="aceitarLote()">Aceitar em lote ≥ confiança…</button>
  <button onclick="publicarTriadas()">Publicar aceitas já 🟢</button>
  <button class="warn" onclick="arquivarNaoPintura()">Arquivar não-pinturas</button>
</div>
<div id="job"></div>

<div class="bar">
  <span style="font-size:12px;color:#777">Confiança mínima</span>
  <select id="min" onchange="carregar()"><option value="0">todas</option><option value="0.6">≥ 0.6</option>
    <option value="0.8">≥ 0.8</option><option value="0.9">≥ 0.9</option></select>
  <button id="bNP" onclick="toggleNP()">só não-pinturas</button>
</div>
<div class="alas" id="alas"></div>
<div class="grid" id="grid"></div>
<div class="bar"><button onclick="mais()">carregar mais</button></div>

<script>
var ALAS={}, filtroAla=null, soNP=false, offset=0;
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
async function j(u,b){var r=await fetch(u,b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{});return r.json()}

async function status(){
  var s=await j('/api/agente/status'); if(s.error){document.getElementById('job').textContent=s.error;return}
  ALAS=s.alas; var c=s.contagem, a=s.acerto;
  var p1=a.total?Math.round(100*a.primeira/a.total):null, p12=a.total?Math.round(100*(a.primeira+a.segunda)/a.total):null;
  document.getElementById('stats').innerHTML=
    st(c.pendentes,'na Entrada sem classificação')+st(c.para_revisar,'sugestões para revisar')+
    st(c.nao_pintura,'marcadas não-pintura')+st(c.aceitas_aguardando_triagem,'aceitas aguardando triagem')+
    st(p1==null?'—':p1+'%','acerto 1ª opção ('+a.total+' decisões)')+st(p12==null?'—':p12+'%','acerto 1ª ou 2ª');
  document.getElementById('auto').checked=!!s.auto.ligado;
  var jb=s.job; document.getElementById('job').innerHTML=(jb.rodando?'⏳ classificando: ':'')+
    (jb.inicio?(jb.feitas+' de '+jb.alvo+' · '+jb.erros+' erros · '+jb.sem_imagem+' sem imagem'+(jb.rodando?'':' · concluído')):'')+
    (jb.ultimo_erro?' · <span style="color:#e88">'+esc(jb.ultimo_erro)+'</span>':'')+' · modelo '+esc(s.modelo);
  var n={}; s.por_ala.forEach(function(x){n[x.ala]=x.n});
  document.getElementById('alas').innerHTML='<button class="'+(filtroAla?'':'on')+'" onclick="setAla(null)">todas</button>'+
    Object.keys(ALAS).map(function(id){return '<button class="'+(filtroAla===id?'on':'')+'" onclick="setAla(\\''+id+'\\')">'+esc(ALAS[id])+' ('+(n[id]||0)+')</button>'}).join('');
  return jb.rodando;
}
function st(v,l){return '<div class="st"><b>'+v+'</b><span>'+l+'</span></div>'}
function setAla(a){filtroAla=a;offset=0;carregar();status()}
function toggleNP(){soNP=!soNP;document.getElementById('bNP').style.borderColor=soNP?'#1D9E75':'';offset=0;carregar()}
function mais(){offset+=60;carregar(true)}

async function carregar(append){
  var q='?min='+document.getElementById('min').value+'&offset='+offset+(filtroAla?'&ala='+filtroAla:'')+(soNP?'&tipo=nao_pintura':'');
  var d=await j('/api/agente/fila'+q); var g=document.getElementById('grid');
  var html=(d.obras||[]).map(card).join('');
  if(append) g.insertAdjacentHTML('beforeend',html); else g.innerHTML=html||'<p style="color:#666;font-size:13px">Nada para revisar com esse filtro.</p>';
}
function opts(sel){return Object.keys(ALAS).map(function(id){return '<option value="'+id+'"'+(id===sel?' selected':'')+'>'+esc(ALAS[id])+'</option>'}).join('')}
function card(o){
  var conf=o.ala_confianca==null?'':Math.round(o.ala_confianca*100)+'%';
  var tags=(o.ala_tipo&&o.ala_tipo!=='pintura'?'<span class="tag">'+esc(o.ala_tipo)+'</span> ':'')+
           (o.triagem!=='verde'?'<span class="tag tri">triagem '+(o.triagem?esc(o.triagem):'pendente')+'</span>':'');
  var id=esc(o.id);
  return '<div class="card" id="c_'+id+'"><div class="img"><img loading="lazy" src="'+esc(o.thumb)+'" data-orig="'+esc(o.image_url)+'" '+
    'onerror="if(!this.dataset.fb){this.dataset.fb=1;this.src=\\'https://api.europeana.eu/thumbnail/v2/url.json?type=IMAGE&size=w400&uri=\\'+encodeURIComponent(this.dataset.orig)}"></div>'+
    '<div class="info"><div class="t">'+esc(o.title)+'</div><div class="m">'+esc(o.artist)+(o.date?' · '+esc(o.date):'')+'<br>'+esc(o.museum||o.source)+
    (o.external_url?' · <a target="_blank" href="'+esc(o.external_url)+'">ficha</a>':'')+'</div>'+
    (tags?'<div>'+tags+'</div>':'')+
    '<div class="chips"><span class="chip" onclick="aceitar(\\''+id+'\\',\\''+o.ala_sugerida+'\\')">✓ '+esc(ALAS[o.ala_sugerida]||o.ala_sugerida)+' '+conf+'</span>'+
    (o.ala_sugerida2?'<span class="chip b" onclick="aceitar(\\''+id+'\\',\\''+o.ala_sugerida2+'\\')">'+esc(ALAS[o.ala_sugerida2]||o.ala_sugerida2)+'</span>':'')+'</div>'+
    '<div class="mot">'+esc(o.ala_motivo)+'</div>'+
    '<div class="acts"><select id="s_'+id+'">'+opts(o.ala_sugerida)+'</select>'+
    '<button onclick="aceitar(\\''+id+'\\',document.getElementById(\\'s_'+id+'\\').value)">mover</button>'+
    '<button title="reclassificar" onclick="reclass(\\''+id+'\\')">↻</button>'+
    '<button class="warn" title="arquivar" onclick="arquivar(\\''+id+'\\')">🗄</button></div></div></div>';
}
function feito(id){var c=document.getElementById('c_'+id); if(c) c.classList.add('feito')}
async function aceitar(id,ala){var r=await j('/api/agente/aceitar',{itens:[{id:id,ala:ala}]}); if(r.error) return alert(r.error); feito(id)}
async function arquivar(id){var r=await j('/api/agente/arquivar',{ids:[id]}); if(r.error) return alert(r.error); feito(id)}
async function reclass(id){await j('/api/agente/reclassificar',{ids:[id]}); feito(id)}
async function classificar(){
  var n=prompt('Quantas obras da Entrada classificar agora? (máx 1000)','50'); if(n===null) return;
  var r=await j('/api/agente/classificar',{total:parseInt(n,10)}); if(r.error) return alert(r.error); acompanhar();
}
async function setAuto(){await j('/api/agente/auto',{ligado:document.getElementById('auto').checked})}
async function aceitarLote(){
  var m=prompt('Aceitar a 1ª sugestão de todas as pinturas com confiança ≥ (0.5 a 1)'+(filtroAla?' na ala '+ALAS[filtroAla]:'')+':','0.9'); if(m===null) return;
  if(!confirm('Confirma aceitar em lote com confiança ≥ '+m+'? Só publica o que já está com triagem 🟢.')) return;
  var r=await j('/api/agente/aceitar-lote',{min:parseFloat(m),ala:filtroAla}); if(r.error) return alert(r.error);
  alert(r.aceitas+' aceitas · '+r.publicadas+' publicadas · '+r.aguardando_triagem+' aguardando triagem'); carregar(); status();
}
async function publicarTriadas(){var r=await j('/api/agente/publicar-triadas',{}); alert((r.publicadas||0)+' publicadas'); status()}
async function arquivarNaoPintura(){
  if(!confirm('Arquivar todas as obras que o agente marcou como desenho, gravura, foto ou outro? (reversível em /curadoria)')) return;
  var r=await j('/api/agente/arquivar',{nao_pintura:true}); alert((r.arquivadas||0)+' arquivadas'); carregar(); status();
}
var FASE={importando:'baixando obras',classificando:'organizando nas alas',concluida:'concluída — aguardando sua autorização'};
function n(x){return Number(x||0).toLocaleString('pt-BR')}
async function remessas(){
  var d=await j('/api/agente/remessas'); var box=document.getElementById('rem'); if(d.error){box.innerHTML='<div class="l">'+esc(d.error)+'</div>';return false}
  var at=d.remessas.find(function(r){return r.fase==='importando'||r.fase==='classificando'});
  var ult=d.remessas[0]; var h='<h2>Remessas — até '+d.padrao.toLocaleString('pt-BR')+' obras novas por vez</h2><div class="l">';
  if(at){
    h+='<b>Remessa '+at.id+'</b> · '+(at.pausada?'⏸ pausada':FASE[at.fase])+'<br>'+
       at.importadas+' de '+at.autorizadas+' baixadas · '+at.classificadas+' organizadas nas alas'+
       (d.execucao.fonte?' · agora em <b>'+esc(d.execucao.fonte)+'</b>':'')+
       (d.execucao.ultimo_erro?'<br><span style="color:#e88">'+esc(d.execucao.ultimo_erro)+'</span>':'')+
       '<div class="prog" style="height:6px;background:#1c1c1c;border-radius:3px;overflow:hidden;margin:8px 0"><div style="height:100%;background:#1D9E75;width:'+
       Math.round(100*(at.fase==='importando'?at.importadas/at.autorizadas/2:0.5+(at.importadas?at.classificadas/at.importadas/2:0.5)))+'%"></div></div>'+
       (at.pausada?'<button class="go" onclick="retomar()">Retomar</button>':'<button onclick="pausar()">Pausar</button>');
  } else {
    h+=(ult?'Última: remessa '+ult.id+' · '+n(ult.importadas)+' baixadas · <b>'+n(ult.introduzidas)+' publicadas nas alas</b> · '+
         n(ult.na_entrada)+' ficaram na <a href="/curadoria?ala=entrada&offset=0">Entrada</a> (não-pintura, sem imagem ou sem ala)'+
         (ult.importadas<ult.autorizadas?' · o acervo das fontes ativas acabou antes da cota':'')+'<br>':'Nenhuma remessa ainda.<br>')+
       '<button class="go" style="margin-top:8px" onclick="autorizar()">Autorizar remessa de '+d.padrao.toLocaleString('pt-BR')+' obras →</button>';
  }
  var v=d.verif||{}, im=d.imagens||{};
  h+='<div style="margin-top:10px;padding-top:10px;border-top:1px solid #1f2a25"><b>Verificador de imagens</b> · '+
     n(im.verificadas)+' de '+n(im.publicadas)+' obras publicadas já checadas · <b>'+n(im.retiradas)+'</b> devolvidas à Entrada por falta de imagem'+
     (v.rodando?' · ⏳ checando ('+n(v.checadas)+')':'')+
     '<br><label><input type="checkbox" '+(v.ligado?'checked':'')+' onchange="verifLigar(this.checked)"> verificar sozinho a cada 10 min</label> '+
     '<button style="margin-left:8px" onclick="verifAgora()">verificar agora</button></div>';
  h+='</div><div class="fontes">'+d.fontes.map(function(f){
    var off=!f.ativa||(f.fonte==='europeana'&&!d.europeana_ok);
    return '<label class="fonte'+(off?' off':'')+(f.esgotada?' fim':'')+'"><input type="checkbox" '+(f.ativa?'checked':'')+
      ' onchange="fonte(\\''+f.fonte+'\\',this.checked)"> '+esc(f.nome)+' · '+f.importadas+' trazidas'+(f.esgotada?' · ✓ acervo percorrido':'')+
      (f.fonte==='europeana'&&!d.europeana_ok?' · falta EUROPEANA_KEY':'')+'</label>'}).join('')+'</div>';
  box.innerHTML=h; return !!at && !at.pausada;
}
async function autorizar(){
  var d=await j('/api/agente/remessas');
  if(!confirm('Autorizar a próxima remessa de até '+d.padrao.toLocaleString('pt-BR')+' obras novas?\\n\\nCusto estimado de API (Gemini): US$ 0,75 a 1,50.\\nO agente baixa, coloca cada pintura na ala sugerida e PUBLICA. Depois para e espera você.')) return;
  var r=await j('/api/agente/remessa/autorizar',{total:d.padrao}); if(r.error) return alert(r.error); remessas(); status();
}
async function verifLigar(v){await j('/api/agente/verificador',{ligado:v}); remessas()}
async function verifAgora(){await j('/api/agente/verificador',{agora:true}); setTimeout(remessas,1500)}
async function pausar(){await j('/api/agente/remessa/pausar',{}); remessas()}
async function retomar(){await j('/api/agente/remessa/retomar',{}); remessas()}
async function fonte(f,v){await j('/api/agente/fonte',{fonte:f,ativa:v}); remessas()}
setInterval(function(){remessas(); status()},10000);
async function acompanhar(){var t=setInterval(async function(){var rodando=await status(); if(!rodando){clearInterval(t);carregar()}},2000)}
remessas(); status().then(function(r){carregar(); if(r) acompanhar()});
</script></body></html>`;

module.exports = { montarAgenteAlas, ALAS, miniatura };

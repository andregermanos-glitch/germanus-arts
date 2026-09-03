// server/atendente_ui.js — Atendente Emmanuel Rio · GERMANUS.Art
//
// Montagem em server.js, junto dos outros módulos, ANTES do catch-all "*":
//   require("./atendente_ui").montarAtendente(app, pool);
//
// Variável de ambiente no Railway: GEMINI_API_KEY
// A chave nunca vai ao frontend — toda chamada passa por aqui.
// Depende das tabelas de 001_tabelas.sql (conteudo_atendente, atendente_log).

const crypto = require("crypto");

// ─── Configuração ────────────────────────────────────────────────────────────
const MODELO         = "gemini-2.5-flash-lite";   // confirme o id no AI Studio
const API            = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_TOKENS     = 700;
const MAX_RODADAS    = 3;      // teto de idas ao modelo por pergunta
const MAX_HISTORICO  = 6;      // últimas 3 trocas
const LIMITE_IP_HORA = 25;
const MAX_PERGUNTA   = 600;

const IDIOMAS = { pt: "português", en: "English", fr: "français", es: "español", it: "italiano", de: "Deutsch" };

// Mapa das alas. O ala_id do banco não bate com o nome exibido em dois casos:
// "cidades" é a ala Emoção e "fase" é a Psiquê. Sem isto o atendente erra feio.
const ALAS = {
  retratos: "Retratos", pessoas_reais: "Pessoas Conhecidas", historico: "História",
  perspectiva: "Perspectiva", objetos: "Objetos", lugares: "Lugares Conhecidos",
  natureza: "Natureza", familiar: "Ambiente Familiar", nudes: "Nu Feminino",
  esoterico: "Esotérico", sacro: "Sacro", arquitetura: "Arquitetura",
  povo: "Pessoas do Povo", luz_sol: "Luz do Sol", cores: "Cores",
  cidades: "Emoção", fase: "Psiquê", femininas: "Artistas Femininas",
};
const ALA_POR_NOME = Object.fromEntries(Object.entries(ALAS).map(([id, n]) => [n.toLowerCase(), id]));

function resolverAla(entrada) {
  const t = String(entrada || "").trim().toLowerCase();
  if (ALAS[t]) return t;
  if (ALA_POR_NOME[t]) return ALA_POR_NOME[t];
  if (["psyche", "psiquê", "psique", "surrealismo"].includes(t)) return "fase";
  if (["emocao", "emoção", "emotion", "abstracao", "abstração"].includes(t)) return "cidades";
  const achou = Object.entries(ALAS).find(([, n]) => n.toLowerCase().includes(t));
  return achou ? achou[0] : null;
}

// ─── Rate limit em memória (reinicia com o processo; suficiente aqui) ────────
const balde = new Map();
function passouNoLimite(ip) {
  const agora = Date.now();
  const reg = balde.get(ip) || { n: 0, desde: agora };
  if (agora - reg.desde > 3600000) { reg.n = 0; reg.desde = agora; }
  reg.n += 1;
  balde.set(ip, reg);
  if (balde.size > 5000) balde.clear();
  return reg.n <= LIMITE_IP_HORA;
}
const hashIp = ip => crypto.createHash("sha256").update(String(ip) + "germanus").digest("hex").slice(0, 16);

// ─── Disponibilidade ─────────────────────────────────────────────────────────
let indisponivelAte = 0;
const marcarIndisponivel = min => { indisponivelAte = Date.now() + min * 60000; };
const estaDisponivel = () => Date.now() > indisponivelAte;

// ─── Ferramentas oferecidas ao modelo ────────────────────────────────────────
const FUNCOES = [
  { name: "buscar_verbete",
    description: "Busca no corpus do site textos sobre história da arte, como olhar uma obra, o funcionamento do GERMANUS.Art, as 18 alas e a biografia de Emmanuel Rio.",
    parameters: { type: "object", properties: { termo: { type: "string", description: "Palavra-chave em português" } }, required: ["termo"] } },
  { name: "ler_verbete",
    description: "Lê um verbete inteiro pelo slug indicado no índice do corpus.",
    parameters: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] } },
  { name: "buscar_obra",
    description: "Busca obras do acervo por título, autor ou museu. Use SEMPRE antes de afirmar que uma obra existe no site.",
    parameters: { type: "object", properties: { termo: { type: "string" } }, required: ["termo"] } },
  { name: "listar_por_ala",
    description: `Lista obras de uma ala do acervo. Nomes válidos: ${Object.values(ALAS).join(", ")}.`,
    parameters: { type: "object", properties: { ala: { type: "string" } }, required: ["ala"] } },
];

// ─── Consultas ───────────────────────────────────────────────────────────────
function montarConsultas(pool) {
  const PUB = `image_url IS NOT NULL AND image_url != '' AND COALESCE(status,'publicada') = 'publicada'`;

  return {
    async buscarVerbete({ termo }) {
      const { rows } = await pool.query(
        `SELECT slug, corpo FROM conteudo_atendente
          WHERE ativo = true AND (chaves_todas ILIKE $1 OR titulo_pt ILIKE $1 OR corpo ILIKE $1)
          ORDER BY prioridade DESC, length(corpo) ASC LIMIT 4`,
        [`%${String(termo || "").toLowerCase()}%`]);
      return rows;
    },
    async lerVerbete({ slug }) {
      const { rows } = await pool.query(
        `SELECT slug, corpo FROM conteudo_atendente WHERE slug = $1 AND ativo = true`, [slug]);
      return rows;
    },
    async buscarObra({ termo }) {
      const { rows } = await pool.query(
        `SELECT id, title, artist, date, museum, ala_id FROM artworks
          WHERE ${PUB} AND (title ILIKE $1 OR artist ILIKE $1 OR museum ILIKE $1) LIMIT 6`,
        [`%${termo}%`]);
      return rows.map(r => ({ id: r.id, titulo: r.title, autor: r.artist, data: r.date, museu: r.museum, ala: ALAS[r.ala_id] || r.ala_id }));
    },
    async listarPorAla({ ala }) {
      const id = resolverAla(ala);
      if (!id) return [];
      const { rows } = await pool.query(
        `SELECT id, title, artist, date, museum FROM artworks
          WHERE ${PUB} AND ala_id = $1 ORDER BY RANDOM() LIMIT 8`, [id]);
      return rows.map(r => ({ id: r.id, titulo: r.title, autor: r.artist, data: r.date, museu: r.museum, ala: ALAS[id] }));
    },
    async indice(lang) {
      const col = IDIOMAS[lang] ? `titulo_${lang}` : "titulo_pt";
      const { rows } = await pool.query(
        `SELECT slug, COALESCE(${col}, titulo_pt) AS titulo FROM conteudo_atendente
          WHERE ativo = true ORDER BY eixo, id`);
      return rows.map(r => `${r.slug} — ${r.titulo}`).join("\n");
    },
    async fixos() {
      const { rows } = await pool.query(
        `SELECT corpo FROM conteudo_atendente WHERE ativo = true AND prioridade = 1`);
      return rows.map(r => r.corpo).join("\n\n");
    },
  };
}

// ─── Prompt do sistema ───────────────────────────────────────────────────────
function montarSystem(indice, fixos, lang) {
  return `Você é o atendente do GERMANUS.Art, uma galeria de arte clássica em domínio público. Fala com a persona de Emmanuel Rio.

QUEM É EMMANUEL RIO
${fixos}

VOZ
Primeira pessoa. Registro calmo, culto, afirmativo. Frases curtas. Sem ironia, sem trocadilho, sem exclamação, sem emoji, sem listas com marcadores — escreva em prosa. Nunca elogie o visitante. No máximo três parágrafos: isto é uma caixa de conversa, não um ensaio.
Exceção à persona: se perguntarem se você é real, diga sem rodeio que Emmanuel Rio foi uma pessoa real, que não deixou nenhuma palavra escrita, e que quem responde aqui é um programa que empresta o nome e a imagem dele.

VERACIDADE
Sobre obras deste acervo: afirme apenas o que vier do retorno das ferramentas. Se buscar_obra não trouxer nada, diga que não encontrou. Nunca invente título, autor, data ou museu.
Sobre a biografia de Emmanuel Rio: apenas o que estiver nos verbetes. Onde o registro é silencioso, diga que é silencioso.
Sobre história da arte em geral: pode responder do seu próprio conhecimento, mas deixe claro que aquilo não é obra deste acervo.
Diga sempre "pintura ocidental", nunca "arte", ao tratar do arco histórico das alas. Esse arco é a leitura proposta por este site, não um fato consagrado da história da arte, e não é escada de qualidade.

AS 18 ALAS
${Object.values(ALAS).join(", ")}.

IDIOMA
Responda em ${IDIOMAS[lang] || IDIOMAS.pt}. Os verbetes estão em português; traduza com naturalidade, sem calque. Termos fixos: natureza-morta = still life / nature morte; pintura de história = history painting / peinture d'histoire; claro-escuro = chiaroscuro / clair-obscur; veladura = glaze / glacis; ponto de fuga = vanishing point / point de fuite; ala = wing / aile; domínio público = public domain / domaine public.

ÍNDICE DO CORPUS (use ler_verbete com o slug, ou buscar_verbete por palavra)
${indice}`;
}

// ─── Chamada ao Gemini ───────────────────────────────────────────────────────
async function chamarGemini(system, contents) {
  const r = await fetch(`${API}/${MODELO}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents,
      tools: [{ function_declarations: FUNCOES }],
      generationConfig: {
        maxOutputTokens: MAX_TOKENS,
        temperature: 0.7,
        thinkingConfig: { thinkingBudget: 0 },  // sem tokens de raciocínio: custo previsível
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!r.ok) {
    const texto = await r.text();
    const e = new Error(texto.slice(0, 300));
    if (r.status === 401 || r.status === 403 || /API_KEY|PERMISSION_DENIED/i.test(texto)) e.semChave = true;
    if (r.status === 429 || /RESOURCE_EXHAUSTED|quota|billing/i.test(texto)) e.semCota = true;
    if (r.status >= 500) e.sobrecarga = true;
    throw e;
  }
  return r.json();
}

// ─── Montagem ────────────────────────────────────────────────────────────────
function montarAtendente(app, pool) {
  const db = montarConsultas(pool);

  function registrar(d) {
    pool.query(
      `INSERT INTO atendente_log (ip_hash, lang, pergunta, slugs, obras_ids, rodadas, tokens_in, tokens_out, match_fraco, erro)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [hashIp(d.ip), d.lang, d.pergunta, d.slugs || [], d.obras || [], d.rodadas || 0,
       d.tokensIn || 0, d.tokensOut || 0, !!d.matchFraco, d.erro || null]
    ).catch(() => {});
  }

  // O frontend consulta isto ao carregar: se false, o avatar não aparece.
  app.get("/api/atendente/status", (req, res) => {
    res.json({ disponivel: Boolean(process.env.GEMINI_API_KEY) && estaDisponivel() });
  });

  app.post("/api/atendente", async (req, res) => {
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "0";
    const lang = IDIOMAS[req.body?.lang] ? req.body.lang : "pt";
    const pergunta = String(req.body?.pergunta || "").slice(0, MAX_PERGUNTA).trim();

    if (!pergunta) return res.status(400).json({ erro: "pergunta_vazia" });
    if (!process.env.GEMINI_API_KEY || !estaDisponivel())
      return res.status(503).json({ erro: "atendente_indisponivel" });
    if (!passouNoLimite(ip)) {
            registrar({ ip, lang, pergunta, erro: ("erro: " + e.message).slice(0, 280) });
      return res.status(500).json({ erro: "tente_de_novo" });
    }

    const historico = Array.isArray(req.body?.historico) ? req.body.historico.slice(-MAX_HISTORICO) : [];
    const contents = [
      ...historico.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: String(m.content || "") }],
      })),
      { role: "user", parts: [{ text: pergunta }] },
    ];

    const slugs = [], obras = [];
    let rodadas = 0, tokensIn = 0, tokensOut = 0;

    try {
      const [indice, fixos] = await Promise.all([db.indice(lang), db.fixos()]);
      const system = montarSystem(indice, fixos, lang);

      let resposta = await chamarGemini(system, contents);
      rodadas = 1;
      tokensIn  += resposta.usageMetadata?.promptTokenCount || 0;
      tokensOut += resposta.usageMetadata?.candidatesTokenCount || 0;

      while (rodadas < MAX_RODADAS) {
        const partes = resposta.candidates?.[0]?.content?.parts || [];
        const chamadas = partes.filter(p => p.functionCall).map(p => p.functionCall);
        if (chamadas.length === 0) break;

        const respostasFn = [];
        for (const c of chamadas) {
          let dados = [];
          try {
            if (c.name === "buscar_verbete")      dados = await db.buscarVerbete(c.args || {});
            else if (c.name === "ler_verbete")    dados = await db.lerVerbete(c.args || {});
            else if (c.name === "buscar_obra")    dados = await db.buscarObra(c.args || {});
            else if (c.name === "listar_por_ala") dados = await db.listarPorAla(c.args || {});
          } catch { dados = []; }

          dados.forEach(d => { if (d.slug) slugs.push(d.slug); if (d.id) obras.push(String(d.id)); });

          respostasFn.push({
            functionResponse: {
              name: c.name,
              response: dados.length
                ? { resultados: dados }
                : { resultados: [], aviso: "Nenhum resultado. Diga ao visitante que não encontrou no acervo." },
            },
          });
        }

        contents.push({ role: "model", parts: partes });
        contents.push({ role: "user", parts: respostasFn });

        resposta = await chamarGemini(system, contents);
        rodadas += 1;
        tokensIn  += resposta.usageMetadata?.promptTokenCount || 0;
        tokensOut += resposta.usageMetadata?.candidatesTokenCount || 0;
      }

      const texto = (resposta.candidates?.[0]?.content?.parts || [])
        .filter(p => p.text).map(p => p.text).join("\n").trim();
      if (!texto) throw new Error("resposta_vazia");

      registrar({ ip, lang, pergunta, slugs, obras, rodadas, tokensIn, tokensOut,
                  matchFraco: slugs.length === 0 && obras.length === 0 });
      return res.json({ resposta: texto });

    } catch (e) {
      if (e.semChave || e.semCota) {
        marcarIndisponivel(30);
        registrar({ ip, lang, pergunta, erro: e.semCota ? "sem_cota" : "sem_chave" });
        return res.status(503).json({ erro: "atendente_indisponivel" });
      }
      if (e.sobrecarga) {
        registrar({ ip, lang, pergunta, erro: "sobrecarga" });
        return res.status(503).json({ erro: "tente_de_novo" });
      }
      console.error("[atendente]", e.message);
      registrar({ ip, lang, pergunta, erro: "erro" });
      return res.status(500).json({ erro: "atendente_indisponivel" });
    }
  });

  console.log("🗣️  Atendente Emmanuel Rio montado — /api/atendente");
}

module.exports = { montarAtendente };

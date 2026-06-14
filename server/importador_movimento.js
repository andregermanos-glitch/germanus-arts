// server/importador_movimento.js — Importação em bloco por movimento artístico
// ─────────────────────────────────────────────────────────────────────────────
// Em vez de garimpar obra por obra nas APIs de museu, puxa TODAS as pinturas de
// um movimento (propriedade P135 do Wikidata) que tenham imagem (P18) e despeja
// numa ÁREA DE ENTRADA (staging) — status='rascunho', invisível no site público.
// Você organiza a partir de lá pela página /curadoria, distribuindo para as alas.
//
// Roda em SEGUNDO PLANO (responde na hora, trabalha depois) para não estourar o
// timeout do proxy do Railway, igual à migrarLoteR2.
//
// COMO LIGAR (1 linha no server.js, antes do app.get("*")):
//     require("./importador_movimento").montarImportador(app, pool);
//
// USO (POST, pelo painel ou curl):
//   POST /api/importar/movimento
//   { "movimento": "impressionismo", "total": 2000 }     ← atalho nomeado
//   { "q": "Q40415", "total": 2000, "ala": "entrada" }   ← Q direto
// ─────────────────────────────────────────────────────────────────────────────

const SPARQL  = "https://query.wikidata.org/sparql";
const UA      = "GermanusArt/1.0 (https://germanus.art; contato@germanus.art)";
const LARGURA = 1000;  // px da miniatura — evita baixar originais de 20–50 MB

// Atalhos nomeados (Q verificados onde possível; rode a query de contagem p/ confirmar)
const MOVIMENTOS = {
  impressionismo: { q: "Q40415",  nome: "Impressionismo" },
  cubismo:        { q: "Q186157", nome: "Cubismo" },
  surrealismo:    { q: "Q39427",  nome: "Surrealismo" },   // corrigido (era Q39447)
  fauvismo:       { q: "Q166593", nome: "Fauvismo" },      // corrigido (era Q179897)
  pop_art:        { q: "Q134751", nome: "Pop Art" },
  abstracionismo: { q: "Q128758", nome: "Arte abstrata (verificar)" },
  vanguarda:      { q: "Q170479", nome: "Vanguarda (verificar)" },
};

async function sparql(query) {
  const url = `${SPARQL}?query=${encodeURIComponent(query)}&format=json`;
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/sparql-results+json" },
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error("SPARQL HTTP " + r.status);
  const d = await r.json();
  return d.results?.bindings || [];
}

function consultaPagina(qcode, limite, offset) {
  return `
    SELECT ?item ?itemLabel ?autorLabel ?img ?data WHERE {
      ?item wdt:P135 wd:${qcode} ;
            wdt:P18  ?img .
      OPTIONAL { ?item wdt:P170 ?autor. }
      OPTIONAL { ?item wdt:P571 ?data.  }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
    }
    LIMIT ${limite} OFFSET ${offset}`;
}

// Importa até `total` obras do movimento para a ala de entrada (em segundo plano)
async function importarMovimento(pool, qcode, alaDestino, total) {
  const LOTE = 500;
  let offset = 0, inseridas = 0, paginasVazias = 0;

  console.log(`📥 Wikidata — iniciando ${qcode} → '${alaDestino}' (alvo ${total})`);

  while (inseridas < total && paginasVazias < 2) {
    let linhas;
    try {
      linhas = await sparql(consultaPagina(qcode, LOTE, offset));
    } catch (e) {
      console.log(`  [Wikidata] ${qcode} off${offset}: ${e.message}`);
      break;
    }
    if (!linhas.length) { paginasVazias++; offset += LOTE; continue; }
    paginasVazias = 0;

    for (const b of linhas) {
      if (inseridas >= total) break;
      const qid = (b.item?.value || "").split("/").pop(); // Q123
      const imgRaw = b.img?.value || "";
      if (!qid || !imgRaw) continue;
      // Miniatura via Special:FilePath?width= — mantém o arquivo pequeno
      const imgUrl = imgRaw.includes("?") ? imgRaw : `${imgRaw}?width=${LARGURA}`;
      const titulo = b.itemLabel?.value || qid;
      const autor  = b.autorLabel?.value || "Desconhecido";
      const data   = (b.data?.value || "").slice(0, 4);
      const id = `wikidata_${qid}`;
      try {
        const r = await pool.query(
          `INSERT INTO artworks
             (id,source,title,artist,date,museum,image_url,ala_id,credit,status,image_cached_at)
           VALUES ($1,'wikidata',$2,$3,$4,'Wikidata / Wikimedia Commons',$5,$6,
                   'Domínio Público — Wikimedia Commons','rascunho',0)
           ON CONFLICT (id) DO NOTHING`,
          [id, titulo, autor, data, imgUrl, alaDestino]
        );
        if (r.rowCount) inseridas++;
      } catch {}
    }

    offset += LOTE;
    await new Promise(r => setTimeout(r, 1200)); // ritmo educado com a Wikidata
  }

  console.log(`📥 Wikidata — ${qcode}: ${inseridas} obras novas em '${alaDestino}'`);
  return inseridas;
}

function montarImportador(app, pool) {
  // Garante a coluna status (idempotente — também criada pelo curadoria_ui)
  pool.query(`ALTER TABLE artworks ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'publicada'`).catch(() => {});

  app.post("/api/importar/movimento", async (req, res) => {
    const chave = req.body?.movimento;
    const q     = req.body?.q || (chave && MOVIMENTOS[chave]?.q);
    const total = Math.min(parseInt(req.body?.total || "1000", 10) || 1000, 12000);
    const ala   = req.body?.ala || "entrada"; // staging por padrão

    if (!q) {
      return res.status(400).json({
        error: "Envie { movimento: 'impressionismo' } ou { q: 'Q40415' }",
        movimentos_disponiveis: Object.keys(MOVIMENTOS),
      });
    }

    // Resposta imediata; trabalho continua em segundo plano (evita timeout)
    res.json({
      ok: true,
      mensagem: `Importação iniciada: ${q} → ala '${ala}' (até ${total}). Acompanhe em /curadoria?ala=entrada`,
      q, ala, total,
    });

    importarMovimento(pool, q, ala, total).catch(e =>
      console.log(`📥 Wikidata erro: ${e.message}`)
    );
  });

  app.get("/api/importar/movimentos", (req, res) => res.json(MOVIMENTOS));

  console.log("📥 Importador de movimentos montado — POST /api/importar/movimento");
}

module.exports = { montarImportador, importarMovimento, MOVIMENTOS };

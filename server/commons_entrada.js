// server/commons_entrada.js — Carga em massa do Wikimedia Commons → ENTRADA
// ─────────────────────────────────────────────────────────────────────────────
// Puxa MILHARES de obras de uma categoria do Commons (e suas subcategorias),
// com paginação (gcmcontinue), em SEGUNDO PLANO, direto para a Entrada como
// rascunho (status='rascunho', ala_id='entrada') — invisíveis no site até você
// distribuir pela página de curadoria.
//
// - Miniaturas de 1000px (iiurlwidth) → não incha o R2 com originais gigantes
// - ON CONFLICT DO NOTHING → nunca puxa de volta obra que já existe/foi publicada
// - Responde na hora; trabalha depois (não estoura o timeout do Railway)
//
// COMO LIGAR (1 linha no server.js, ANTES do app.get("*")):
//     require("./commons_entrada").montarCommonsEntrada(app, pool);
//
// USO:  POST /api/commons/entrada  { "categoria": "Portrait paintings", "total": 3000 }
// ─────────────────────────────────────────────────────────────────────────────

const API = "https://commons.wikimedia.org/w/api.php";
const UA  = "GermanusArt/1.0 (https://germanus.art; contato@germanus.art)";
const LARGURA = 1000;

// Categorias sugeridas (rótulo → categoria do Commons). Servem os botões da curadoria.
const SUGESTOES = {
  retratos:  "Portrait paintings",
  objetos:   "Still-life paintings",
  natureza:  "Landscape paintings",
  sacro:     "Religious paintings",
  nudes:     "Nude paintings",
  historico: "History paintings",
  familiar:  "Genre paintings",
  cores:     "Impressionist paintings",
  fase:      "Surrealist paintings",
};

async function api(params) {
  const u = new URL(API);
  for (const [k, v] of Object.entries({ format: "json", origin: "*", ...params })) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("Commons HTTP " + r.status);
  return r.json();
}

// limpa HTML dos campos do extmetadata
function limpar(s) {
  return String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

async function listarSubcategorias(categoria) {
  try {
    const d = await api({
      action: "query", list: "categorymembers",
      cmtitle: "Category:" + categoria, cmtype: "subcat", cmlimit: "500",
    });
    return (d.query?.categorymembers || []).map(m => (m.title || "").replace(/^Category:/, ""));
  } catch { return []; }
}

// Processa UMA categoria, paginando arquivos, inserindo na Entrada. Retorna nº inserido.
async function processarCategoria(pool, categoria, restante) {
  let inseridas = 0, cont = null, guarda = 0;
  while (inseridas < restante && guarda < 60) {
    guarda++;
    let d;
    try {
      d = await api({
        action: "query",
        generator: "categorymembers",
        gcmtitle: "Category:" + categoria,
        gcmtype: "file",
        gcmlimit: "500",
        ...(cont ? { gcmcontinue: cont } : {}),
        prop: "imageinfo",
        iiprop: "url|mime|extmetadata",
        iiurlwidth: String(LARGURA),
      });
    } catch (e) { console.log(`  [Commons] ${categoria}: ${e.message}`); break; }

    const pages = d.query?.pages ? Object.values(d.query.pages) : [];
    for (const p of pages) {
      if (inseridas >= restante) break;
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      if (ii.mime && !ii.mime.startsWith("image/")) continue; // pula pdf/svg/etc
      const img = ii.thumburl || ii.url;
      if (!img) continue;
      const md = ii.extmetadata || {};
      const id = `commons_${p.pageid}`;
      const titulo = limpar(md.ObjectName?.value) || (p.title || "").replace(/^File:/, "").replace(/\.\w+$/, "");
      const autor  = limpar(md.Artist?.value) || "Desconhecido";
      const data   = limpar(md.DateTimeOriginal?.value).slice(0, 4);
      const credito = limpar(md.Credit?.value) || "Domínio Público — Wikimedia Commons";
      try {
        const r = await pool.query(
          `INSERT INTO artworks
             (id,source,title,artist,date,museum,image_url,ala_id,credit,status,image_cached_at)
           VALUES ($1,'wikimedia_commons',$2,$3,$4,'Wikimedia Commons',$5,'entrada',$6,'rascunho',0)
           ON CONFLICT (id) DO NOTHING`,
          [id, titulo, autor, data, img, credito]
        );
        if (r.rowCount) inseridas++;
      } catch {}
    }

    cont = d.continue?.gcmcontinue || null;
    if (!cont) break; // acabou esta categoria
    await new Promise(r => setTimeout(r, 600)); // ritmo educado
  }
  return inseridas;
}

// Carga em massa de uma categoria + subcategorias (segundo plano)
async function importarCommons(pool, categoria, total, descer) {
  console.log(`📥 Commons — iniciando "${categoria}" (alvo ${total}, descer=${descer})`);
  let inseridas = await processarCategoria(pool, categoria, total);

  if (descer && inseridas < total) {
    const subs = await listarSubcategorias(categoria);
    console.log(`📥 Commons — "${categoria}": ${subs.length} subcategorias`);
    for (const sub of subs) {
      if (inseridas >= total) break;
      const n = await processarCategoria(pool, sub, total - inseridas);
      inseridas += n;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  console.log(`📥 Commons — "${categoria}": ${inseridas} obras novas na Entrada`);
  return inseridas;
}

function montarCommonsEntrada(app, pool) {
  pool.query(`ALTER TABLE artworks ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'publicada'`).catch(() => {});

  app.post("/api/commons/entrada", async (req, res) => {
    const categoria = (req.body?.categoria || "").trim();
    const total = Math.min(parseInt(req.body?.total || "1000", 10) || 1000, 20000);
    const descer = req.body?.descer !== false; // padrão: desce nas subcategorias
    if (!categoria) {
      return res.status(400).json({ error: "Envie { categoria: 'Portrait paintings', total: 3000 }", sugestoes: SUGESTOES });
    }
    // responde já; trabalha em segundo plano
    res.json({
      ok: true,
      mensagem: `Carga iniciada: "${categoria}" → Entrada (até ${total}). Acompanhe em /curadoria?ala=entrada`,
      categoria, total, descer,
    });
    importarCommons(pool, categoria, total, descer).catch(e => console.log(`📥 Commons erro: ${e.message}`));
  });

  app.get("/api/commons/sugestoes", (req, res) => res.json(SUGESTOES));

  console.log("📥 Commons→Entrada montado — POST /api/commons/entrada");
}

module.exports = { montarCommonsEntrada, importarCommons, SUGESTOES };

// server/inserir_da_api.js
// Insere obras no banco, buscando imagem da API do museu quando possível
// Uso: node server/inserir_da_api.js server/obras_iconicas.json
//
// Formatos aceites no JSON:
//   { api: "rijksmuseum", api_id: "SK-C-5", titulo, artista, ano, museu, ala }
//   { api: "met",         met_id: 11417,    titulo, artista, ano, museu, ala }
//   { api: "aic",         aic_id: 27992,    titulo, artista, ano, museu, ala }
//   { imageUrl: "https://...",              titulo, artista, ano, museu, ala }

const { Pool } = require("pg");
const fs   = require("fs");
const path = require("path");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const KEYS = {
  rijksmuseum: process.env.RIJKSMUSEUM_KEY || "",
  harvard:     process.env.HARVARD_KEY     || "",
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

const get = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
  return r.json();
};

// ─── Resolvers por API ────────────────────────────────────────────────────────

async function deMet(met_id) {
  const d = await get(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${met_id}`);
  if (!d.primaryImage || !d.isPublicDomain) throw new Error("Sem imagem pública");
  return {
    imageUrl: d.primaryImageSmall || d.primaryImage,
    museu: `${d.repository || "The Metropolitan Museum of Art"}, Nova York, EUA`,
    titulo: d.title,
    artista: d.artistDisplayName,
    ano: d.objectDate,
  };
}

async function deAIC(aic_id) {
  const d = await get(`https://api.artic.edu/api/v1/artworks/${aic_id}?fields=id,title,artist_display,date_display,image_id,is_public_domain`);
  const obj = d.data;
  if (!obj?.image_id || !obj?.is_public_domain) throw new Error("Sem imagem pública");
  return {
    imageUrl: `https://www.artic.edu/iiif/2/${obj.image_id}/full/800,/0/default.jpg`,
    museu: "Art Institute of Chicago, Chicago, EUA",
    titulo: obj.title,
    artista: obj.artist_display,
    ano: obj.date_display,
  };
}

async function deRijksmuseum(api_id) {
  const key = KEYS.rijksmuseum;
  const url  = key
    ? `https://www.rijksmuseum.nl/api/en/collection/${api_id}?apikey=${key}`
    : `https://www.rijksmuseum.nl/api/en/collection/${api_id}?apikey=0fiHGWSv`;
  const d = await get(url);
  const obj = d.artObject;
  if (!obj) throw new Error("Obra não encontrada no Rijksmuseum");
  const img = obj.webImage?.url || obj.headerImage?.url;
  if (!img) throw new Error("Sem imagem");
  return {
    imageUrl: img,
    museu: `${obj.location || "Rijksmuseum"}, Amsterdam, Países Baixos`,
    titulo: obj.title,
    artista: (obj.principalMakers || []).map(m => m.name).join(", "),
    ano: obj.dating?.presentingDate || "",
  };
}

async function deCleveland(api_id) {
  const d = await get(`https://openaccess-api.clevelandart.org/api/artworks/${api_id}`);
  const obj = d.data;
  if (!obj?.images?.web?.url) throw new Error("Sem imagem");
  return {
    imageUrl: obj.images.web.url,
    museu: "Cleveland Museum of Art, Cleveland, EUA",
    titulo: obj.title,
    artista: (obj.creators || []).map(c => c.description).join(", "),
    ano: obj.creation_date || "",
  };
}

// ─── Resolver uma obra ────────────────────────────────────────────────────────

async function resolver(obra) {
  // 1. URL directa — sem chamada API
  if (obra.imageUrl && !obra.api_id && !obra.met_id && !obra.aic_id) {
    return {
      imageUrl: obra.imageUrl,
      museu:    obra.museu || "",
      titulo:   obra.titulo,
      artista:  obra.artista,
      ano:      String(obra.ano || ""),
    };
  }

  // 2. API por ID
  const api = (obra.api || "").toLowerCase();
  try {
    if (api === "met"          || obra.met_id)  return await deMet(obra.met_id);
    if (api === "aic"          || obra.aic_id)  return await deAIC(obra.aic_id);
    if (api === "rijksmuseum"  || obra.api_id?.startsWith("SK"))
      return await deRijksmuseum(obra.api_id);
    if (api === "cleveland")   return await deCleveland(obra.api_id);
  } catch (e) {
    console.log(`    ⚠ API falhou (${api}): ${e.message} — usando imageUrl de fallback`);
    if (obra.imageUrl) return {
      imageUrl: obra.imageUrl,
      museu: obra.museu || "",
      titulo: obra.titulo,
      artista: obra.artista,
      ano: String(obra.ano || ""),
    };
    throw e;
  }

  throw new Error(`API desconhecida: ${api}`);
}

// ─── Gravar no banco ──────────────────────────────────────────────────────────

function slugify(s) {
  return (s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "_").slice(0, 40);
}

async function gravar(obra, dados) {
  const sufixo = obra.api_id || obra.met_id || obra.aic_id || slugify(obra.titulo);
  const id = `direto_${slugify(obra.artista)}_${sufixo}`.slice(0, 80);

  await pool.query(
    `INSERT INTO artworks
       (id, source, title, artist, date, medium, dimensions, origin,
        style, museum, description, credit, image_url, external_url, ala_id)
     VALUES ($1,'direto',$2,$3,$4,'','','','','','','GERMANUS.Art',$5,'',$6)
     ON CONFLICT (id) DO UPDATE SET
       image_url  = COALESCE(EXCLUDED.image_url, artworks.image_url),
       indexed_at = EXTRACT(EPOCH FROM NOW())::BIGINT`,
    [id,
     dados.titulo  || obra.titulo,
     dados.artista || obra.artista,
     dados.ano     || String(obra.ano || ""),
     dados.imageUrl,
     obra.ala]
  );
  return id;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const ficheiro = process.argv[2];
  if (!ficheiro) {
    console.error("Uso: node inserir_da_api.js <ficheiro.json>");
    process.exit(1);
  }

  const obras = JSON.parse(fs.readFileSync(path.resolve(ficheiro), "utf-8"));
  console.log(`\n📥 Processando ${obras.length} obras...\n`);

  let ok = 0, erros = 0;

  for (const obra of obras) {
    process.stdout.write(`  → ${obra.artista}: ${obra.titulo.slice(0,40)}... `);
    try {
      const dados = await resolver(obra);
      await gravar(obra, dados);
      console.log(`✅`);
      ok++;
    } catch (e) {
      console.log(`❌ ${e.message}`);
      erros++;
    }
    await sleep(500);
  }

  console.log(`\n${"─".repeat(40)}`);
  console.log(`✅ Inseridas: ${ok}   ❌ Erros: ${erros}`);
  console.log(`${"─".repeat(40)}\n`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

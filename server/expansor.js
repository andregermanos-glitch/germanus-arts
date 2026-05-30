// server/expansor.js — Robô de Expansão da Curadoria
// Adiciona 30 novas obras por execução, avaliando importância e diversidade
// POST /api/curadoria/expandir?ala=retratos&n=30

const { buscarShanghaiPorAla } = require("./museums");

// ─── Score de importância por artista (0-100) ─────────────────────────────────
const ARTIST_SCORE = {
  "Leonardo da Vinci":100,"Michelangelo":100,"Rembrandt van Rijn":100,
  "Johannes Vermeer":100,"Vincent van Gogh":100,"Pablo Picasso":100,
  "Raphael":98,"Tiziano Vecellio":98,"Diego Velázquez":98,"Albrecht Dürer":97,
  "Sandro Botticelli":97,"Jan van Eyck":97,"Peter Paul Rubens":96,
  "Caravaggio":96,"El Greco":95,"Francisco Goya":95,"Paul Cézanne":95,
  "Frans Hals":90,"Anthony van Dyck":90,"Jacques-Louis David":90,
  "Eugène Delacroix":89,"Édouard Manet":89,"Claude Monet":88,
  "Pierre-Auguste Renoir":88,"Edgar Degas":88,"Paul Gauguin":87,
  "Georges Seurat":87,"Henri de Toulouse-Lautrec":86,"Gustav Klimt":86,
  "Egon Schiele":85,"Edvard Munch":85,"Henri Matisse":84,
  "Amedeo Modigliani":84,"Frida Kahlo":84,"Edward Hopper":83,
  "John Singer Sargent":83,"James McNeill Whistler":82,
  "Berthe Morisot":82,"Mary Cassatt":82,"Camille Pissarro":81,
  "Artemisia Gentileschi":80,"Sofonisba Anguissola":80,"Lavinia Fontana":78,
  "Ferdinand Bol":75,"Nicolaes Maes":74,"Gerard ter Borch":74,
  "Carel Fabritius":73,"Jan Steen":72,"Govert Flinck":71,
  "Bartholomeus van der Helst":70,"Thomas de Keyser":70,
  "Élisabeth Vigée Le Brun":80,"Angelica Kauffmann":75,
  "Thomas Gainsborough":78,"Joshua Reynolds":76,"George Romney":70,
  "Jean-Baptiste-Camille Corot":76,"Gustave Courbet":77,
  "Théodore Géricault":78,"Jean-Auguste-Dominique Ingres":80,
  "Ilya Repin":79,"Ivan Kramskoi":72,"Vasily Perov":71,
  "Carl Larsson":72,"Anders Zorn":73,"Bruno Liljefors":65,
  "Paula Modersohn-Becker":76,"Käthe Kollwitz":78,"Otto Dix":77,
  "Ernst Ludwig Kirchner":74,"Emil Nolde":73,"Max Beckmann":75,
  "Oskar Kokoschka":74,"Alexej von Jawlensky":70,
  "Tintoretto":82,"Paolo Veronese":80,"Pontormo":78,"Bronzino":77,
  "Hans Holbein the Younger":85,"Lucas Cranach the Elder":78,
  "Rogier van der Weyden":88,"Petrus Christus":75,"Hugo van der Goes":78,"Hans Memling":80,
};

function museumScore(museum) {
  const m = (museum || "").toLowerCase();
  if (m.includes("louvre")) return 30;
  if (m.includes("rijksmuseum")) return 30;
  if (m.includes("metropolitan") || m.includes("met museum")) return 28;
  if (m.includes("national gallery")) return 27;
  if (m.includes("prado")) return 28;
  if (m.includes("uffizi")) return 27;
  if (m.includes("hermitage")) return 27;
  if (m.includes("kunsthistorisches")) return 26;
  if (m.includes("harvard")) return 25;
  if (m.includes("mauritshuis")) return 26;
  if (m.includes("art institute")) return 24;
  if (m.includes("orsay")) return 26;
  if (m.includes("tate")) return 22;
  if (m.includes("victoria")) return 22;
  if (m.includes("cleveland")) return 20;
  return 10;
}

function calcularScore(obra, jaExistentes) {
  let score = 0;
  const nomeArtista = (obra.artist || obra.autor || "").trim();
  const artistKey = Object.keys(ARTIST_SCORE).find(k =>
    nomeArtista.toLowerCase().includes(k.toLowerCase()) ||
    k.toLowerCase().includes(nomeArtista.toLowerCase().split(" ")[0])
  );
  score += artistKey ? ARTIST_SCORE[artistKey] : 20;
  score += museumScore(obra.museum || "");
  const artistCount = jaExistentes.filter(e =>
    e.artist?.toLowerCase().includes(nomeArtista.toLowerCase().split(" ")[0])
  ).length;
  if (artistCount === 0) score += 25;
  else if (artistCount === 1) score += 10;
  else if (artistCount === 2) score -= 10;
  else score -= 30;
  const origem = (obra.origin || obra.origem || "").toLowerCase();
  const origemCount = jaExistentes.filter(e => (e.origin || "").toLowerCase() === origem).length;
  if (origemCount < 3) score += 15;
  else if (origemCount > 8) score -= 10;
  if (obra.imageUrl?.startsWith("http")) score += 15;
  return Math.max(0, score);
}

async function buscarCandidatasRijks(alaHint, existingIds) {
  const criadores = ["Rembrandt","Vermeer","Frans Hals","Van Dyck","Rubens","Van Gogh","Mondrian","Jan Steen"];
  const criador = criadores[Math.floor(Date.now() / 600000) % criadores.length];
  const candidatas = [];
  try {
    const params = new URLSearchParams({ type:"painting", imageAvailable:"true", creator: criador });
    const r = await fetch(`https://data.rijksmuseum.nl/search/collection?${params}`, {
      signal: AbortSignal.timeout(8000),
      headers: { "Accept": "application/ld+json, application/json" }
    });
    const d = await r.json();
    for (const item of (d.orderedItems || []).slice(0, 20)) {
      const parts = (item.id || "").split("/");
      const objNum = parts[parts.length - 1];
      if (!objNum || existingIds.has(`rijks_${objNum}`)) continue;
      candidatas.push({
        id: `rijks_${objNum}`, api: "rijksmuseum", api_id: objNum,
        artist: criador, museum: "Rijksmuseum, Amsterdã, Países Baixos",
        origin: "Países Baixos", imageUrl: `https://iiif.rijksmuseum.nl/iiif/${objNum}/full/400,/0/default.jpg`,
        externalUrl: `https://www.rijksmuseum.nl/en/collection/${objNum}`,
      });
    }
  } catch {}
  return candidatas;
}

async function buscarCandidatasHarvard(alaHint, key, existingIds) {
  if (!key) return [];
  const candidatas = [];
  try {
    const r = await fetch(
      `https://api.harvardartmuseums.org/object?keyword=${encodeURIComponent(alaHint)}&hasimage=1&apikey=${key}&size=20&sort=rank&sortorder=desc`,
      { signal: AbortSignal.timeout(8000) }
    );
    const d = await r.json();
    for (const obj of (d.records || [])) {
      if (!obj.primaryimageurl) continue;
      const id = `harvard_${obj.objectid}`;
      if (existingIds.has(id)) continue;
      candidatas.push({
        id, api: "harvard", api_id: String(obj.objectid),
        title: obj.title || "", artist: obj.people?.[0]?.name || "Desconhecido",
        date: obj.dated || "", museum: "Harvard Art Museums, Cambridge, EUA",
        origin: obj.culture || "", imageUrl: obj.primaryimageurl,
        externalUrl: obj.url || "",
      });
    }
  } catch {}
  return candidatas;
}

async function buscarCandidatasEuropeana(alaHint, key, existingIds) {
  if (!key) return [];
  const candidatas = [];
  const termos = [alaHint.split(" ")[0], "portrait painting", "master portrait"];
  const termo = termos[Math.floor(Date.now() / 300000) % termos.length];
  try {
    const r = await fetch(
      `https://api.europeana.eu/record/v2/search.json?query=${encodeURIComponent(termo + " painting")}&rows=20&media=true&qf=TYPE%3AIMAGE&profile=rich`,
      { signal: AbortSignal.timeout(8000), headers: { "X-Api-Key": key, "Accept": "application/json" } }
    );
    const d = await r.json();
    const arr = (o, f) => Array.isArray(o?.[f]) ? o[f][0] : (o?.[f] || "");
    for (const item of (d.items || [])) {
      const preview = arr(item, "edmPreview");
      if (!preview) continue;
      const id = `europeana_${(item.id || "").replace(/\//g, "_")}`;
      if (existingIds.has(id)) continue;
      candidatas.push({
        id, api: "europeana", title: arr(item, "title") || "",
        artist: arr(item, "dcCreator") || "", date: arr(item, "year") || "",
        museum: arr(item, "dataProvider") || "Europeana", origin: arr(item, "country") || "Europa",
        imageUrl: preview, externalUrl: arr(item, "edmIsShownAt") || item.guid || "",
      });
    }
  } catch {}
  return candidatas;
}

async function expandirAla(pool, keys, ala, alaHint, quantidade = 30) {
  console.log(`🤖 Expansor — iniciando ${ala} (+${quantidade})`);

  const existentes = [];
  const existingIds = new Set();
  try {
    const r = await pool.query(`SELECT id, title, artist, origin FROM artworks WHERE ala_id=$1`, [ala]);
    for (const row of r.rows) {
      existentes.push(row);
      existingIds.add(row.id);
    }
  } catch {}
  console.log(`  📋 Existentes: ${existentes.length} obras`);

  const [rijks, harvard, europeana] = await Promise.all([
    buscarCandidatasRijks(alaHint, existingIds),
    buscarCandidatasHarvard(alaHint, keys.harvard, existingIds),
    buscarCandidatasEuropeana(alaHint, keys.europeana, existingIds),
  ]);
  const candidatas = [...rijks, ...harvard, ...europeana];
  console.log(`  🔍 Candidatas: ${candidatas.length}`);

  if (candidatas.length === 0) {
    console.log(`  ⚠️ Nenhuma candidata nova encontrada`);
    return { adicionadas: 0, total: existentes.length };
  }

  const pontuadas = candidatas
    .map(obra => ({ obra, score: calcularScore(obra, existentes) }))
    .sort((a, b) => b.score - a.score);

  let adicionadas = 0;
  for (const { obra, score } of pontuadas.slice(0, quantidade)) {
    if (obra.api === "rijksmuseum" && !obra.title) {
      try {
        const mr = await fetch(`https://www.rijksmuseum.nl/api/iiif/${obra.api_id}/manifest/json`, { signal: AbortSignal.timeout(4000) });
        const m = await mr.json();
        const lbl = m.label;
        obra.title = typeof lbl === "string" ? lbl : (lbl?.en?.[0] || lbl?.nl?.[0] || obra.api_id);
        const meta = m.metadata || [];
        const cf = meta.find(x => (x.label || "").toLowerCase().includes("maker"));
        if (cf?.value) obra.artist = cf.value;
      } catch {}
    }
    const importancia = score >= 120 ? "iconica" : score >= 90 ? "alta" : "media";
    try {
      await pool.query(
        `INSERT INTO artworks (id,source,title,artist,date,medium,dimensions,origin,style,museum,description,credit,image_url,external_url,ala_id)
         VALUES ($1,'expansao',$2,$3,$4,'','','',$5,$6,'',$7,$8,'',$9)
         ON CONFLICT (id) DO UPDATE SET image_url=EXCLUDED.image_url, indexed_at=EXTRACT(EPOCH FROM NOW())::BIGINT`,
        [obra.id, obra.title || obra.titulo || "Sem título", obra.artist || "Desconhecido",
         obra.date || "", importancia, obra.museum || "", `expansão automática — score: ${score}`, obra.imageUrl, ala]
      );
      adicionadas++;
    } catch {}
  }

  const top5 = pontuadas.slice(0, 5);
  console.log(`  ✅ Adicionadas: ${adicionadas} obras`);
  console.log(`  🏆 Top 5 desta expansão:`);
  top5.forEach(({ obra, score }) => console.log(`     [${score}] ${obra.artist || ""} — ${obra.title || obra.api_id || ""}`));

  return { adicionadas, total: existentes.length + adicionadas };
}

module.exports = { expandirAla };
